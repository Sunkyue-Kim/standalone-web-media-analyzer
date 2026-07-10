const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { SourceModuleLoader, createSourceModuleLoader } = require("./helpers/source-module-loader.cjs");

const rootDirectory = path.resolve(__dirname, "..");
const samplesDirectory = path.join(rootDirectory, "validation", "generated");

const sampleExpectations = [
  ["1000024017.mp4", "video/mp4", "isobmff", 2, 1752, ["I", "P", "AAC"]],
  ["20260612_091058.mp4", "video/mp4", "isobmff", 2, 1752, ["I", "P", "B", "AAC"]],
  ["avc_bframes.mp4", "video/mp4", "isobmff", 1, 120, ["I", "P", "B"]],
  ["avc_fragmented.mp4", "video/mp4", "isobmff", 1, 120, ["I", "P", "B"]],
  ["av1_mp4.mp4", "video/mp4", "isobmff", 1, 15, ["I", "P"]],
  ["audio_mp3.mp3", "audio/mpeg", "mp3", 1, 78, ["MP3"]],
  ["audio_opus.opus", "audio/ogg", "ogg-opus", 1, 101, ["Opus"]],
  ["webm_vp9_opus.webm", "video/webm", "webm", 2, 149, ["I", "P", "Opus"]],
  ["webm_av1.webm", "video/webm", "webm", 1, 15, ["I", "P"]]
];

function loadSampleFile(fileName, type) {
  const bytes = fs.readFileSync(path.join(samplesDirectory, fileName));
  return new File([bytes], fileName, { type });
}

function countFrameTypes(rows) {
  return rows.reduce((counts, row) => {
    const key = row.frameType || "missing";
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

test("registered containers analyze bundled samples and frame scanner fills known frame types", async () => {
  const loader = await createSourceModuleLoader();
  const containers = await loader.import("src/js/core/containers/registry.js");
  const frameScanner = await loader.import("src/js/core/codecs/frame-scanner.js");
  const { BOX_TYPE_INFO } = await loader.import("src/js/core/containers/isobmff/box-types.js");
  const { BOX_TYPE_I18N } = await loader.import("src/js/i18n/catalogs.js");
  const seenBoxTypes = new Set();

  for (const [fileName, type, containerId, trackCount, sampleCount, expectedFrameTypes] of sampleExpectations) {
    const progress = [];
    const analysis = await containers.analyzeFileWithRegisteredContainer(loadSampleFile(fileName, type), {
      onProgress(label, percent) {
        progress.push([label, percent]);
      }
    });
    await frameScanner.scanFrameTypes(analysis, { onProgress() {} });

    assert.equal(analysis.container.id, containerId, fileName);
    assert.equal(analysis.tracks.length, trackCount, fileName);
    assert.equal(analysis.sampleRows.length, sampleCount, fileName);
    assert.equal(analysis.warnings.length, 0, fileName);
    assert.ok(progress.some((entry) => entry[1] === 100), fileName + " should report completion");
    for (const box of analysis.allBoxes) seenBoxTypes.add(box.type);

    const frameTypeCounts = countFrameTypes(analysis.sampleRows);
    for (const expectedFrameType of expectedFrameTypes) {
      assert.ok(frameTypeCounts[expectedFrameType] > 0, fileName + " missing " + expectedFrameType);
    }
    assert.equal(frameTypeCounts.unknown || 0, 0, fileName);
  }

  for (const boxType of seenBoxTypes) {
    assert.ok(!boxType.startsWith("EBML_"), boxType + " should have a parsed WebM/Matroska element name.");
    assert.ok(BOX_TYPE_INFO[boxType], boxType + " should have an English box description.");
    assert.ok(BOX_TYPE_I18N.ko[boxType], boxType + " should have a Korean box description.");
  }
});

test("container registry rejects unsupported files and auto-scan boundary is conservative", async () => {
  const loader = await createSourceModuleLoader();
  const containers = await loader.import("src/js/core/containers/registry.js");
  const frameScanner = await loader.import("src/js/core/codecs/frame-scanner.js");

  await assert.rejects(
    () => containers.analyzeFileWithRegisteredContainer(new File([new Uint8Array([1, 2, 3, 4])], "unknown.bin", { type: "application/octet-stream" }), {}),
    /No registered container/
  );

  assert.equal(frameScanner.shouldAutoScan({
    tracks: [{ trackId: 1, codec: "avc1", codecConfig: { nalLengthSize: 4 } }],
    sampleRows: Array.from({ length: 10001 }, (_, index) => ({
      trackId: 1,
      offset: String(index),
      size: 64 * 1024
    }))
  }), false);
  assert.equal(frameScanner.shouldAutoScan({
    tracks: [{ trackId: 1, codec: "avc1", codecConfig: { nalLengthSize: 4 } }],
    sampleRows: [{ trackId: 1, offset: "0", size: 100 }]
  }), true);
  assert.equal(frameScanner.shouldAutoScan({
    tracks: [{ trackId: 1, codec: "mp4a" }],
    sampleRows: [{ trackId: 1, offset: "0", size: 100 }]
  }), false);
});

test("frame scanner handles read failures, skipped rows, and cancellation", async () => {
  const loader = await createSourceModuleLoader();
  const frameScanner = await loader.import("src/js/core/codecs/frame-scanner.js");
  const progress = [];
  const failingAnalysis = {
    reader: {
      cancelled: false,
      async readRange() {
        throw new Error("read failed");
      }
    },
    tracks: [{ trackId: 1, codec: "avc1", codecConfig: { nalLengthSize: 4 } }],
    sampleRows: [
      { trackId: 1, sampleIndex: 1, offset: "0", size: 6, frameType: "", nalTypes: [], warnings: [] },
      { trackId: 1, sampleIndex: 2, offset: "", size: 6, frameType: "unknown", nalTypes: [], warnings: [] },
      { trackId: 2, sampleIndex: 1, offset: "0", size: 6, frameType: "AAC", nalTypes: [], warnings: [] }
    ]
  };

  await frameScanner.scanFrameTypes(failingAnalysis, {
    onProgress(label, percent) {
      progress.push([label, percent]);
    }
  });
  assert.equal(failingAnalysis.sampleRows[0].frameType, "unknown");
  assert.match(failingAnalysis.sampleRows[0].warnings[0], /AVC \/ H\.264 scan failed: read failed/);
  assert.equal(failingAnalysis.sampleRows[1].frameType, "unknown");
  assert.deepEqual(progress, [["Scanning video samples", 100]]);

  await assert.rejects(() => frameScanner.scanFrameTypes({
    reader: {
      cancelled: true,
      async readRange() {
        return new Uint8Array([]);
      }
    },
    tracks: [{ trackId: 1, codec: "avc1", codecConfig: { nalLengthSize: 4 } }],
    sampleRows: [{ trackId: 1, sampleIndex: 1, offset: "0", size: 1, warnings: [] }]
  }, {}), /Analysis cancelled/);
});

test("MP3 container detection accepts ID3, declared MP3 frames, and verified raw frame pairs", async () => {
  const loader = await createSourceModuleLoader();
  const { mp3Container } = await loader.import("src/js/core/containers/mp3/analyzer.js");
  const id3File = new File([new Uint8Array([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00])], "tagged.bin");
  const declaredFrameFile = new File([makeMp3HeaderBytes()], "single.mp3", { type: "audio/mpeg" });
  const rawFramePairBytes = new Uint8Array(64);
  const shortHeader = makeMp3HeaderBytes({
    versionBits: 3,
    layerBits: 3,
    bitrateIndex: 1,
    samplingRateIndex: 0,
    padding: 1
  });
  rawFramePairBytes.set(shortHeader, 0);
  rawFramePairBytes.set(shortHeader, 38);
  const rawFramePairFile = new File([rawFramePairBytes], "raw.bin");
  const incompleteRawFrameFile = new File([makeMp3HeaderBytes()], "raw.bin");
  const unsupportedFile = new File([new Uint8Array([0x00, 0x01, 0x02, 0x03])], "raw.bin");

  assert.equal(await mp3Container.canAnalyze(id3File), true);
  assert.equal(await mp3Container.canAnalyze(declaredFrameFile), true);
  assert.equal(await mp3Container.canAnalyze(rawFramePairFile), true);
  assert.equal(await mp3Container.canAnalyze(incompleteRawFrameFile), false);
  assert.equal(await mp3Container.canAnalyze(unsupportedFile), false);
});

test("MP3 analyzer handles ID3 tags, Info frames, trailing ID3v1 tags, and empty streams", async () => {
  const loader = await createSourceModuleLoader();
  const { mp3Container } = await loader.import("src/js/core/containers/mp3/analyzer.js");
  const id3v2Bytes = concatBytes([
    makeId3v2Header(5),
    new Uint8Array([1, 2, 3, 4, 5]),
    makeMp3Frame()
  ]);
  const infoFrameBytes = makeMp3Frame();
  writeAscii(infoFrameBytes, 36, "Info");
  const infoFileBytes = concatBytes([
    infoFrameBytes,
    makeMp3Frame()
  ]);
  const id3v1FileBytes = concatBytes([
    makeMp3Frame(),
    makeId3v1Tag({ title: "Song", artist: "Artist", album: "Album", year: "2026" })
  ]);

  const id3v2Analysis = await mp3Container.analyzeFile(new File([id3v2Bytes], "tagged.mp3", { type: "audio/mpeg" }), {});
  assert.deepEqual(JSON.parse(JSON.stringify(id3v2Analysis.topBoxes.map((box) => box.type))), ["ID3v2", "MPEGAudioStream"]);
  assert.equal(id3v2Analysis.topBoxes[0].fields.size, 15);
  assert.equal(id3v2Analysis.sampleRows[0].offset, "15");

  const infoAnalysis = await mp3Container.analyzeFile(new File([infoFileBytes], "info.mp3", { type: "audio/mpeg" }), {});
  assert.equal(infoAnalysis.sampleRows.length, 1);
  assert.equal(infoAnalysis.sampleRows[0].offset, "417");

  const id3v1Analysis = await mp3Container.analyzeFile(new File([id3v1FileBytes], "trailing-id3v1.mp3", { type: "audio/mpeg" }), {});
  assert.deepEqual(JSON.parse(JSON.stringify(id3v1Analysis.topBoxes.map((box) => box.type))), ["MPEGAudioStream", "ID3v1"]);
  assert.equal(id3v1Analysis.topBoxes[1].fields.title, "Song");
  assert.equal(id3v1Analysis.topBoxes[1].fields.artist, "Artist");

  const emptyAnalysis = await mp3Container.analyzeFile(new File([new Uint8Array(64)], "empty.mp3", { type: "audio/mpeg" }), {});
  assert.deepEqual(JSON.parse(JSON.stringify(emptyAnalysis.warnings)), ["No MPEG audio frames found."]);
  assert.equal(emptyAnalysis.sampleRows.length, 0);
  assert.equal(emptyAnalysis.tracks[0].codecConfig.averageBitrate, 0);
});

test("WebM analyzer splits SimpleBlock Xiph, fixed, and EBML lacing", async () => {
  const loader = await createSourceModuleLoader();
  const { webmContainer } = await loader.import("src/js/core/containers/webm/analyzer.js");
  const webmBytes = buildSyntheticWebmFile({
    tracks: [buildSyntheticVideoTrack()],
    clusters: [
      webmElement([0x1f, 0x43, 0xb6, 0x75], concatBytes([
        webmUnsignedElement([0xe7], 0),
        webmElement([0xa3], buildSimpleBlock(1, 0, 0x80, new Uint8Array([1, 2]))),
        webmElement([0xa3], buildSimpleBlock(1, 10, 0x82, new Uint8Array([1, 2, 1, 2, 3, 4, 5]))),
        webmElement([0xa3], buildSimpleBlock(1, 20, 0x84, new Uint8Array([2, 1, 2, 3, 4, 5, 6]))),
        webmElement([0xa3], buildSimpleBlock(1, 30, 0x86, new Uint8Array([2, 0x82, 0xbf, 1, 2, 3, 4, 5, 6])))
      ]))
    ]
  });

  assert.equal(await webmContainer.canAnalyze(new File([webmBytes], "synthetic.webm", { type: "video/webm" })), true);
  const analysis = await webmContainer.analyzeFile(new File([webmBytes], "synthetic.webm", { type: "video/webm" }), {});

  assert.equal(analysis.warnings.length, 0);
  assert.equal(analysis.tracks.length, 1);
  assert.equal(analysis.sampleRows.length, 9);
  assert.deepEqual(JSON.parse(JSON.stringify(analysis.sampleRows.map((row) => row.size))), [2, 2, 3, 2, 2, 2, 2, 2, 2]);
  assert.deepEqual(JSON.parse(JSON.stringify([...new Set(analysis.sampleRows.map((row) => row.frameType))])), ["I"]);
  assert.equal(analysis.tracks[0].sampleCount, 9);
});

test("WebM analyzer reports missing tracks and unknown block references", async () => {
  const loader = await createSourceModuleLoader();
  const { webmContainer } = await loader.import("src/js/core/containers/webm/analyzer.js");
  const webmBytes = buildSyntheticWebmFile({
    tracks: [],
    clusters: [
      webmElement([0x1f, 0x43, 0xb6, 0x75], concatBytes([
        webmUnsignedElement([0xe7], 0),
        webmElement([0xa3], buildSimpleBlock(3, 0, 0x80, new Uint8Array([1, 2, 3])))
      ]))
    ]
  });
  const analysis = await webmContainer.analyzeFile(new File([webmBytes], "missing-track.webm", { type: "video/webm" }), {});

  assert.equal(analysis.tracks.length, 0);
  assert.equal(analysis.sampleRows.length, 0);
  assert.ok(analysis.warnings.includes("No WebM TrackEntry elements found."));
  assert.ok(analysis.warnings.includes("WebM block references unknown track 3."));
});

test("remote ISO BMFF analysis starts with small exact range probes before large cached reads", async () => {
  const fileSize = 5 * 1024 * 1024;
  const bytes = new Uint8Array(fileSize);
  writeUint32(bytes, 0, 24);
  writeAscii(bytes, 4, "ftyp");
  writeAscii(bytes, 8, "isom");
  writeUint32(bytes, 12, 0);
  writeAscii(bytes, 16, "isom");
  writeAscii(bytes, 20, "mp42");
  writeUint32(bytes, 24, fileSize - 24);
  writeAscii(bytes, 28, "free");
  const rangeRequests = [];
  const loader = new SourceModuleLoader({
    rootDirectory,
    globals: {
      fetch: async (_url, options = {}) => {
        const match = String(options.headers && options.headers.Range || "").match(/^bytes=(\d+)-(\d+)$/);
        assert.ok(match, "missing Range header");
        const start = Number(match[1]);
        const end = Number(match[2]);
        rangeRequests.push({ start, end, length: end - start + 1 });
        return {
          status: 206,
          headers: { get: () => "" },
          async arrayBuffer() {
            return bytes.slice(start, end + 1).buffer;
          }
        };
      }
    }
  });
  const containers = await loader.import("src/js/core/containers/registry.js");
  const { SMALL_RANGE_CHUNK_BYTES } = await loader.import("src/js/core/common/binary.js");
  const analysis = await containers.analyzeFileWithRegisteredContainer({
    kind: "remote-url",
    url: "https://media.test/large-header.mp4",
    name: "large-header.mp4",
    type: "video/mp4",
    size: fileSize,
    rangeSupported: true
  }, {});

  assert.equal(analysis.container.id, "isobmff");
  assert.deepEqual(JSON.parse(JSON.stringify(analysis.topBoxes.map((box) => box.type))), ["ftyp", "free"]);
  assert.ok(rangeRequests.length <= 3, JSON.stringify(rangeRequests));
  assert.ok(rangeRequests.every((request) => request.length === SMALL_RANGE_CHUNK_BYTES), JSON.stringify(rangeRequests));
  assert.ok(rangeRequests.every((request) => request.start === 0 && request.end === SMALL_RANGE_CHUNK_BYTES - 1), JSON.stringify(rangeRequests));
});

function writeUint32(bytes, offset, value) {
  bytes[offset] = (value >>> 24) & 0xff;
  bytes[offset + 1] = (value >>> 16) & 0xff;
  bytes[offset + 2] = (value >>> 8) & 0xff;
  bytes[offset + 3] = value & 0xff;
}

function writeAscii(bytes, offset, value) {
  for (let index = 0; index < value.length; index += 1) {
    bytes[offset + index] = value.charCodeAt(index);
  }
}

function asciiBytes(value) {
  return Uint8Array.from(Buffer.from(value, "ascii"));
}

function concatBytes(parts) {
  const length = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

function makeMp3Frame(options = {}) {
  const frameLength = options.frameLength || 417;
  const frame = new Uint8Array(frameLength);
  frame.set(makeMp3HeaderBytes(options), 0);
  return frame;
}

function makeId3v2Header(payloadSize) {
  return new Uint8Array([
    0x49, 0x44, 0x33,
    0x04, 0x00, 0x00,
    (payloadSize >> 21) & 0x7f,
    (payloadSize >> 14) & 0x7f,
    (payloadSize >> 7) & 0x7f,
    payloadSize & 0x7f
  ]);
}

function makeId3v1Tag(fields) {
  const tag = new Uint8Array(128);
  writeAscii(tag, 0, "TAG");
  writeAscii(tag, 3, fields.title || "");
  writeAscii(tag, 33, fields.artist || "");
  writeAscii(tag, 63, fields.album || "");
  writeAscii(tag, 93, fields.year || "");
  return tag;
}

function buildSyntheticWebmFile(options) {
  const segmentPayload = concatBytes([
    webmElement([0x15, 0x49, 0xa9, 0x66], concatBytes([
      webmUnsignedElement([0x2a, 0xd7, 0xb1], 1000000)
    ])),
    webmElement([0x16, 0x54, 0xae, 0x6b], concatBytes(options.tracks || [])),
    ...(options.clusters || [])
  ]);
  return concatBytes([
    webmElement([0x1a, 0x45, 0xdf, 0xa3], new Uint8Array(0)),
    webmElement([0x18, 0x53, 0x80, 0x67], segmentPayload)
  ]);
}

function buildSyntheticVideoTrack() {
  return webmElement([0xae], concatBytes([
    webmUnsignedElement([0xd7], 1),
    webmUnsignedElement([0x83], 1),
    webmStringElement([0x86], "V_VP9"),
    webmUnsignedElement([0x23, 0xe3, 0x83], 33333333),
    webmElement([0xe0], concatBytes([
      webmUnsignedElement([0xb0], 320),
      webmUnsignedElement([0xba], 180)
    ]))
  ]));
}

function buildSimpleBlock(trackNumber, timecode, flags, payload) {
  return concatBytes([
    webmUnsignedVint(trackNumber),
    new Uint8Array([(timecode >> 8) & 0xff, timecode & 0xff, flags]),
    payload
  ]);
}

function webmElement(idBytes, payload) {
  return concatBytes([
    new Uint8Array(idBytes),
    webmSizeVint(payload.byteLength),
    payload
  ]);
}

function webmUnsignedElement(idBytes, value) {
  return webmElement(idBytes, unsignedBigEndianBytes(value));
}

function webmStringElement(idBytes, value) {
  return webmElement(idBytes, asciiBytes(value));
}

function unsignedBigEndianBytes(value) {
  if (!value) return new Uint8Array([0]);
  const bytes = [];
  let remaining = value;
  while (remaining > 0) {
    bytes.unshift(remaining & 0xff);
    remaining = Math.floor(remaining / 256);
  }
  return new Uint8Array(bytes);
}

function webmSizeVint(value) {
  if (value <= 0x7f) return new Uint8Array([0x80 | value]);
  if (value <= 0x3fff) return new Uint8Array([0x40 | ((value >> 8) & 0x3f), value & 0xff]);
  if (value <= 0x1fffff) return new Uint8Array([0x20 | ((value >> 16) & 0x1f), (value >> 8) & 0xff, value & 0xff]);
  throw new Error("Synthetic EBML size is too large.");
}

function webmUnsignedVint(value) {
  if (value <= 0x7f) return new Uint8Array([0x80 | value]);
  if (value <= 0x3fff) return new Uint8Array([0x40 | ((value >> 8) & 0x3f), value & 0xff]);
  throw new Error("Synthetic EBML vint is too large.");
}

function makeMp3HeaderBytes(options = {}) {
  const versionBits = options.versionBits === undefined ? 3 : options.versionBits;
  const layerBits = options.layerBits === undefined ? 1 : options.layerBits;
  const bitrateIndex = options.bitrateIndex === undefined ? 9 : options.bitrateIndex;
  const samplingRateIndex = options.samplingRateIndex === undefined ? 0 : options.samplingRateIndex;
  const padding = options.padding || 0;
  const header = (
    0xffe00000 |
    (versionBits << 19) |
    (layerBits << 17) |
    (1 << 16) |
    (bitrateIndex << 12) |
    (samplingRateIndex << 10) |
    (padding << 9)
  ) >>> 0;
  return new Uint8Array([
    (header >>> 24) & 0xff,
    (header >>> 16) & 0xff,
    (header >>> 8) & 0xff,
    header & 0xff
  ]);
}
