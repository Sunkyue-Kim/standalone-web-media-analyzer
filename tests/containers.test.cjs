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
  ["audio_mp3.mp3", "audio/mpeg", "mp3", 1, 78, ["MP3"]],
  ["audio_opus.opus", "audio/ogg", "ogg-opus", 1, 101, ["Opus"]],
  ["webm_vp9_opus.webm", "video/webm", "webm", 2, 149, ["I", "P", "Opus"]]
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
