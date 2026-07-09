const assert = require("node:assert/strict");
const test = require("node:test");
const { createSourceModuleLoader } = require("./helpers/source-module-loader.cjs");

test("AAC esds and AudioSpecificConfig parsing exposes codec metadata", async () => {
  const loader = await createSourceModuleLoader();
  const { parseAudioSpecificConfig, parseEsds } = await loader.import("src/js/core/codecs/audio/aac.js");

  const audioConfig = parseAudioSpecificConfig(new Uint8Array([0x12, 0x10]));
  assert.equal(audioConfig.audioObjectType, 2);
  assert.equal(audioConfig.audioObjectTypeName, "AAC LC");
  assert.equal(audioConfig.samplingFrequency, 44100);
  assert.equal(audioConfig.channelDescription, "stereo");

  const esds = parseEsds(new Uint8Array([
    0x00, 0x00, 0x00, 0x00,
    0x03, 0x16, 0x00, 0x01, 0x00,
    0x04, 0x11, 0x40, 0x15, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
    0x05, 0x02, 0x12, 0x10
  ]));
  assert.equal(esds.audioConfig.codecString, "mp4a.40.2");
  assert.equal(parseEsds(new Uint8Array([0, 0])).error, "esds too short");
});

test("AAC AudioSpecificConfig covers explicit rates, extension object types, and descriptor edges", async () => {
  const loader = await createSourceModuleLoader();
  const { parseAudioSpecificConfig, parseEsds } = await loader.import("src/js/core/codecs/audio/aac.js");

  const escapedObjectType = parseAudioSpecificConfig(packBits(
    "11111" +
    "000010" +
    "1111" +
    "000000001011101110000000" +
    "1000"
  ));
  assert.equal(escapedObjectType.audioObjectType, 34);
  assert.equal(escapedObjectType.audioObjectTypeName, "Audio object type 34");
  assert.equal(escapedObjectType.samplingFrequency, 48000);
  assert.equal(escapedObjectType.channelDescription, "8 channels");

  const sbrConfig = parseAudioSpecificConfig(packBits(
    "00101" +
    "0100" +
    "0010" +
    "0011" +
    "00010"
  ));
  assert.equal(sbrConfig.audioObjectType, 2);
  assert.equal(sbrConfig.extensionAudioObjectType, 5);
  assert.equal(sbrConfig.extensionSamplingFrequency, 48000);

  const esdsWithoutDecoderSpecificInfo = parseEsds(new Uint8Array([
    0x00, 0x00, 0x00, 0x00,
    0x03, 0x0f, 0x00, 0x01, 0xe0, 0x00, 0x00, 0x00,
    0x04, 0x02, 0x40, 0x15
  ]));
  assert.equal(esdsWithoutDecoderSpecificInfo.objectTypeIndication, null);
  assert.equal(esdsWithoutDecoderSpecificInfo.audioConfig, null);
});

test("MP3 and Opus parsers reject invalid bytes and describe valid packets", async () => {
  const loader = await createSourceModuleLoader();
  const mp3 = await loader.import("src/js/core/codecs/audio/mp3.js");
  const opus = await loader.import("src/js/core/codecs/audio/opus.js");

  const header = mp3.parseMp3FrameHeader(new Uint8Array([0xff, 0xfb, 0x90, 0x64]), 0);
  assert.equal(header.version, "MPEG-1");
  assert.equal(header.layer, "Layer III");
  assert.equal(header.samplingRate, 44100);
  assert.equal(header.frameLength, 417);
  assert.equal(mp3.parseMp3FrameHeader(new Uint8Array([0x00, 0x00, 0x00, 0x00]), 0), null);

  const id3 = mp3.readId3v2Header(new Uint8Array([0x49, 0x44, 0x33, 0x04, 0x00, 0x10, 0x00, 0x00, 0x00, 0x05]));
  assert.equal(id3.version, "2.4.0");
  assert.equal(id3.size, 25);
  assert.equal(id3.footerPresent, true);

  const opusHead = opus.parseOpusHead(new Uint8Array([
    0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64,
    0x01, 0x02, 0x38, 0x01, 0x80, 0xbb, 0x00, 0x00, 0x00, 0x00, 0x00
  ]));
  assert.equal(opusHead.channelCount, 2);
  assert.equal(opusHead.inputSampleRate, 48000);
  assert.equal(opus.parseOpusHead(new Uint8Array([1, 2, 3])), null);
  assert.equal(opus.parseOpusPacket(new Uint8Array([0x78])).durationSamples, 960);
});

test("MP3 and Opus parsers cover layer, channel, lacing-count, and invalid-header branches", async () => {
  const loader = await createSourceModuleLoader();
  const mp3 = await loader.import("src/js/core/codecs/audio/mp3.js");
  const opus = await loader.import("src/js/core/codecs/audio/opus.js");

  assert.equal(mp3.parseMp3FrameHeader(new Uint8Array([0xff, 0xfb, 0x90]), 0), null);
  assert.equal(mp3.parseMp3FrameHeader(makeMp3HeaderBytes({ versionBits: 1, layerBits: 1 }), 0), null);
  const layerOneHeader = mp3.parseMp3FrameHeader(makeMp3HeaderBytes({
    versionBits: 3,
    layerBits: 3,
    bitrateIndex: 1,
    samplingRateIndex: 0,
    padding: 1,
    channelMode: 3
  }), 0);
  assert.equal(layerOneHeader.layer, "Layer I");
  assert.equal(layerOneHeader.samplesPerFrame, 384);
  assert.equal(layerOneHeader.channelCount, 1);
  assert.equal(layerOneHeader.padding, true);

  const mpegTwoLayerThreeHeader = mp3.parseMp3FrameHeader(makeMp3HeaderBytes({
    versionBits: 2,
    layerBits: 1,
    bitrateIndex: 1,
    samplingRateIndex: 0
  }), 0);
  assert.equal(mpegTwoLayerThreeHeader.version, "MPEG-2");
  assert.equal(mpegTwoLayerThreeHeader.layer, "Layer III");
  assert.equal(mpegTwoLayerThreeHeader.samplesPerFrame, 576);

  assert.deepEqual(JSON.parse(JSON.stringify(opus.parseOpusPacket(new Uint8Array([])))), {
    codecString: "opus",
    frameType: "Opus",
    frameCount: 0,
    durationSamples: 0,
    durationMs: 0
  });
  assert.equal(opus.parseOpusPacket(new Uint8Array([0x03])).frameCount, 0);
  const multiFramePacket = opus.parseOpusPacket(new Uint8Array([0xff, 0x83]));
  assert.equal(multiFramePacket.mode, "CELT");
  assert.equal(multiFramePacket.bandwidth, "FB");
  assert.equal(multiFramePacket.frameCount, 3);
  assert.equal(multiFramePacket.stereo, true);
});

test("AVC, HEVC, and AV1 parsers expose config and classify synthetic sample payloads", async () => {
  const loader = await createSourceModuleLoader();
  const avc = await loader.import("src/js/core/codecs/video/avc.js");
  const hevc = await loader.import("src/js/core/codecs/video/hevc.js");
  const av1 = await loader.import("src/js/core/codecs/video/av1.js");

  const avcConfig = avc.parseAvcC(new Uint8Array([
    0x01, 0x64, 0x00, 0x1f, 0xff, 0xe1, 0x00, 0x04,
    0x67, 0x64, 0x00, 0x1f, 0x01, 0x00, 0x02, 0x68, 0xee
  ]));
  assert.equal(avcConfig.codecString, "avc1.64001f");
  assert.equal(avcConfig.nalLengthSize, 4);
  assert.equal(avcConfig.spsCount, 1);
  assert.equal(avc.parseAvcC(new Uint8Array([1, 2, 3])).error, "avcC too short");
  assert.equal(avc.parseAvcSample(new Uint8Array([0x00, 0x00, 0x00, 0x02, 0x65, 0xb0]), 4).frameType, "I");
  assert.equal(avc.parseAvcSample(new Uint8Array([0x00, 0x00, 0x00, 0x02, 0x41, 0xc0]), 4).frameType, "P");
  assert.equal(avc.parseAvcSample(new Uint8Array([0x00, 0x00, 0x00, 0x02, 0x41, 0xa0]), 4).frameType, "B");
  assert.equal(avc.nalTypeName(7), "SPS");

  const hevcConfigBytes = new Uint8Array(23);
  hevcConfigBytes[0] = 1;
  hevcConfigBytes[1] = 1;
  hevcConfigBytes[12] = 93;
  hevcConfigBytes[21] = 3;
  const hevcConfig = hevc.parseHevcC(hevcConfigBytes);
  assert.equal(hevcConfig.nalLengthSize, 4);
  assert.equal(hevcConfig.generalLevelIdc, 93);
  assert.equal(hevc.parseHevcC(new Uint8Array([1, 2])).error, "hvcC too short");
  assert.equal(hevc.parseHevcSample(new Uint8Array([0x00, 0x00, 0x00, 0x03, 0x26, 0x01, 0xac]), 4).frameType, "I");
  assert.equal(hevc.hevcNalTypeName(33), "SPS");

  const av1Config = av1.parseAv1C(new Uint8Array([0x81, 0x08, 0x40, 0x00, 0x0a, 0x00]));
  assert.equal(av1Config.codecString, "av01.0.08M.10");
  assert.equal(av1Config.seqProfile, 0);
  assert.equal(av1Config.seqLevelIdx0, 8);
  assert.equal(av1Config.bitDepth, 10);
  assert.equal(av1Config.chromaFormat, "4:4:4");
  assert.equal(av1.parseAv1C(new Uint8Array([1, 2])).error, "av1C too short");
  assert.equal(av1.parseAv1Sample(new Uint8Array([0x32, 0x01, 0x00])).frameType, "I");
  assert.equal(av1.parseAv1Sample(new Uint8Array([0x32, 0x01, 0x20])).frameType, "P");
  assert.deepEqual(Array.from(av1.parseAv1ObuStream(new Uint8Array([0x1a, 0x01, 0x00])).obus.map((obu) => obu.typeName)), ["Frame Header"]);
  assert.equal(av1.av1ObuTypeName(6), "Frame");
});

test("codec registry provides interchangeable descriptors and scanners", async () => {
  const loader = await createSourceModuleLoader();
  const registry = await loader.import("src/js/core/codecs/registry.js");

  assert.equal(registry.getCodecBySampleEntryType("avc1").id, "avc");
  assert.equal(registry.getCodecByConfigurationBoxType("hvcC").id, "hevc");
  assert.equal(registry.getCodecBySampleEntryType("av01").id, "av1");
  assert.equal(registry.getCodecByConfigurationBoxType("av1C").id, "av1");
  assert.equal(registry.getCodecBySampleEntryType("mp3").kind, "audio");
  assert.equal(registry.getCodecBySampleEntryType("missing"), null);

  const scanner = registry.getFrameTypeScanner({
    codec: "avc1",
    codecConfig: { nalLengthSize: 4 }
  });
  assert.equal(scanner.codec, "AVC / H.264");
  assert.equal((await scanner.parse(new Uint8Array([0x00, 0x00, 0x00, 0x02, 0x65, 0xb0]))).frameType, "I");

  const av1Scanner = registry.getFrameTypeScanner({
    codec: "av01",
    codecConfig: { codecString: "av01.0.08M.08" }
  });
  assert.equal(av1Scanner.codec, "AV1");
  assert.equal((await av1Scanner.parse(new Uint8Array([0x32, 0x01, 0x00]))).frameType, "I");
});

test("frame internals model builds partition-ready video maps and audio band estimates", async () => {
  const loader = await createSourceModuleLoader();
  const { buildFrameInternalsColorScale, buildFrameInternalsModel } = await loader.import("src/js/core/codecs/frame-internals.js");
  const videoTrack = { trackId: 1, handlerType: "vide", codec: "avc1", codecDescriptor: "avc", width: 1920, height: 1080 };
  const globalVideoRows = [
    { trackId: 1, sampleIndex: 1, size: 9000, frameType: "P" },
    { trackId: 1, sampleIndex: 2, size: 18000, frameType: "B" },
    { trackId: 1, sampleIndex: 3, size: 45000, frameType: "P" },
    { trackId: 1, sampleIndex: 10, size: 120000, frameType: "I" },
    { trackId: 2, sampleIndex: 1, size: 999999, frameType: "I" }
  ];
  const colorScale = buildFrameInternalsColorScale(videoTrack, globalVideoRows);
  assert.equal(colorScale.mode, "global-track-percentile");
  assert.equal(colorScale.sampleCount, 4);
  assert.ok(colorScale.valueCount > 4);
  assert.ok(colorScale.max > colorScale.min);

  const videoModel = buildFrameInternalsModel(
    { trackId: 1, sampleIndex: 10, size: 120000, frameType: "I" },
    videoTrack,
    { colorScale }
  );
  assert.equal(videoModel.kind, "video-grid");
  assert.equal(videoModel.unitName, "macroblock");
  assert.equal(videoModel.nominalColumns, 120);
  assert.equal(videoModel.nominalRows, 68);
  assert.equal(videoModel.intrinsicWidth, 1920);
  assert.equal(videoModel.intrinsicHeight, 1088);
  assert.equal(videoModel.mediaWidth, 1920);
  assert.equal(videoModel.mediaHeight, 1088);
  assert.equal(videoModel.layout, "partition-map");
  assert.ok(videoModel.partitionBlockCount > videoModel.displayColumns * videoModel.displayRows);
  assert.ok(videoModel.maxPartitionDepth > 0);
  assertSingleExpandedDepth(assert, videoModel);
  assert.ok(videoModel.partitionModes.some((entry) => entry.mode === "split"));
  assert.ok(videoModel.cells.length <= 9000);
  assert.equal(Math.round(sum(videoModel.cells.map((cell) => cell.estimatedBytes))), 120000);
  assert.ok(videoModel.cells.every((cell) => cell.pixelLeft < 1920 && cell.pixelTop < 1080));
  assert.ok(videoModel.cells.some((cell) => cell.pixelRight > 1920 || cell.pixelBottom > 1080));
  assert.ok(videoModel.cells.every((cell) => cell.displayPixelRight <= 1920 && cell.displayPixelBottom <= 1088));
  assert.ok(videoModel.cells.some((cell) => cell.displayPixelBottom > 1080));
  assert.ok(videoModel.cells.every((cell) => Number.isFinite(cell.estimatedBytesPerPixel) && Number.isFinite(cell.normalizedByteDensity)));
  assert.ok(videoModel.cells.some((cell) => cell.blockWidth !== cell.blockHeight));
  const splitCells = videoModel.cells.filter((cell) => cell.depth > 0);
  const splitQuadrants = new Set(splitCells.map((cell) => {
    const centerX = (cell.pixelLeft + cell.pixelRight) / 2;
    const centerY = (cell.pixelTop + cell.pixelBottom) / 2;
    return (centerX >= 960 ? "right" : "left") + "-" + (centerY >= 540 ? "bottom" : "top");
  }));
  const leftQuarterSplitRatio = splitCells.filter((cell) => ((cell.pixelLeft + cell.pixelRight) / 2) < 480).length / Math.max(1, splitCells.length);
  assert.ok(splitQuadrants.size >= 4);
  assert.ok(leftQuarterSplitRatio < 0.6);
  assert.equal(videoModel.colorScale.mode, "global-track-percentile");
  assert.ok(videoModel.cells.some((cell) => cell.globalPercentile > 0.5));
  assert.ok(videoModel.cells.every((cell) => Number.isFinite(cell.color.red) && Number.isFinite(cell.color.green) && Number.isFinite(cell.color.blue)));

  const smallVideoModel = buildFrameInternalsModel(
    { trackId: 1, sampleIndex: 1, size: 9000, frameType: "P" },
    videoTrack,
    { colorScale }
  );
  assert.equal(smallVideoModel.maxPartitionDepth, videoModel.maxPartitionDepth);
  assert.equal(smallVideoModel.displayColumns, videoModel.displayColumns);
  assert.equal(smallVideoModel.displayRows, videoModel.displayRows);
  assertSingleExpandedDepth(assert, smallVideoModel);

  const rotatedVideoModel = buildFrameInternalsModel(
    { trackId: 7, sampleIndex: 1, size: 64000, frameType: "P" },
    {
      trackId: 7,
      handlerType: "vide",
      codec: "hvc1",
      codecDescriptor: "hevc",
      width: 1920,
      height: 1080,
      encodedWidth: 1920,
      encodedHeight: 1080,
      displayWidth: 1080,
      displayHeight: 1920,
      displayRotationDegrees: -90
    }
  );
  assert.equal(rotatedVideoModel.mediaWidth, 1088);
  assert.equal(rotatedVideoModel.mediaHeight, 1920);
  assert.equal(rotatedVideoModel.intrinsicWidth, 1920);
  assert.equal(rotatedVideoModel.intrinsicHeight, 1088);
  assert.equal(rotatedVideoModel.encodedWidth, 1920);
  assert.equal(rotatedVideoModel.encodedHeight, 1080);
  assert.equal(rotatedVideoModel.displayRotationDegrees, -90);
  assert.equal(rotatedVideoModel.nominalColumns, 30);
  assert.equal(rotatedVideoModel.nominalRows, 17);
  assertSingleExpandedDepth(assert, rotatedVideoModel);
  assert.ok(rotatedVideoModel.cells.every((cell) => cell.pixelLeft < 1920 && cell.pixelTop < 1080));
  assert.ok(rotatedVideoModel.cells.some((cell) => cell.pixelBottom > 1080));
  assert.ok(rotatedVideoModel.cells.every((cell) => cell.displayPixelRight <= 1088 && cell.displayPixelBottom <= 1920));
  assert.ok(rotatedVideoModel.cells.some((cell) => cell.pixelRight !== cell.displayPixelRight || cell.pixelBottom !== cell.displayPixelBottom));
  assert.ok(rotatedVideoModel.cells.every((cell) => Number.isFinite(cell.displayBlockWidth) && Number.isFinite(cell.displayBlockHeight)));
  assert.ok(rotatedVideoModel.cells.every((cell) => cell.blockWidth % 8 === 0 && cell.blockHeight % 8 === 0));

  const croppedDisplayModel = buildFrameInternalsModel(
    { trackId: 8, sampleIndex: 1, size: 64000, frameType: "P" },
    {
      trackId: 8,
      handlerType: "vide",
      codec: "avc1",
      codecDescriptor: "avc",
      width: 1920,
      height: 1080,
      encodedWidth: 1920,
      encodedHeight: 1080,
      displayWidth: 1280,
      displayHeight: 720
    }
  );
  assert.equal(croppedDisplayModel.mediaWidth, 1920);
  assert.equal(croppedDisplayModel.mediaHeight, 1088);
  assert.equal(croppedDisplayModel.intrinsicWidth, 1920);
  assert.equal(croppedDisplayModel.intrinsicHeight, 1088);
  assert.ok(croppedDisplayModel.cells.every((cell) => cell.blockWidth % 4 === 0 && cell.blockHeight % 4 === 0));

  const pixelAspectRatioModel = buildFrameInternalsModel(
    { trackId: 9, sampleIndex: 1, size: 64000, frameType: "P" },
    {
      trackId: 9,
      handlerType: "vide",
      codec: "avc1",
      codecDescriptor: "avc",
      width: 720,
      height: 480,
      pixelAspectRatioNumerator: 8,
      pixelAspectRatioDenominator: 9
    }
  );
  assert.equal(pixelAspectRatioModel.intrinsicWidth, 720);
  assert.equal(pixelAspectRatioModel.intrinsicHeight, 480);
  assert.equal(pixelAspectRatioModel.mediaWidth, 640);
  assert.equal(pixelAspectRatioModel.mediaHeight, 480);
  assert.equal(pixelAspectRatioModel.pixelAspectRatioNumerator, 8);
  assert.equal(pixelAspectRatioModel.pixelAspectRatioDenominator, 9);
  assert.ok(pixelAspectRatioModel.cells.every((cell) => cell.blockWidth % 4 === 0 && cell.blockHeight % 4 === 0));

  const hevcModel = buildFrameInternalsModel(
    { trackId: 2, sampleIndex: 1, size: 90000, frameType: "P" },
    { trackId: 2, handlerType: "vide", codec: "hvc1", codecDescriptor: "hevc", width: 1280, height: 720 }
  );
  assert.equal(hevcModel.unitName, "CTU");
  assert.equal(hevcModel.unitWidth, 64);
  assert.equal(hevcModel.intrinsicWidth, 1280);
  assert.equal(hevcModel.intrinsicHeight, 768);
  assert.equal(hevcModel.mediaWidth, 1280);
  assert.equal(hevcModel.mediaHeight, 768);
  assertSingleExpandedDepth(assert, hevcModel);
  assert.ok(hevcModel.cells.some((cell) => cell.pixelBottom > 720));
  assert.ok(hevcModel.cells.every((cell) => cell.blockWidth % 8 === 0 && cell.blockHeight % 8 === 0));
  assert.ok(!hevcModel.cells.some((cell) => cell.blockWidth === 28 || cell.blockHeight === 28));

  const vp9Model = buildFrameInternalsModel(
    { trackId: 4, sampleIndex: 2, size: 24000, frameType: "P" },
    { trackId: 4, handlerType: "vide", codec: "V_VP9", codecDescriptor: "V_VP9", width: 640, height: 360 }
  );
  assert.equal(vp9Model.unitName, "superblock");
  assert.equal(vp9Model.unitWidth, 64);

  const av1Model = buildFrameInternalsModel(
    { trackId: 5, sampleIndex: 2, size: 24000, frameType: "I" },
    { trackId: 5, handlerType: "vide", codec: "av01", codecDescriptor: "av1", width: 640, height: 360 }
  );
  assert.equal(av1Model.unitWidth, 128);
  assert.equal(av1Model.layout, "partition-map");
  assertSingleExpandedDepth(assert, av1Model);
  assert.ok(av1Model.partitionModes.some((entry) => ["vertical", "horizontal", "verticalA", "verticalB", "horizontalA", "horizontalB", "vertical4", "horizontal4"].includes(entry.mode)));
  assert.ok(av1Model.cells.some((cell) => cell.blockWidth !== cell.blockHeight));

  assert.equal(buildFrameInternalsModel(
    { trackId: 9, sampleIndex: 1, size: 100 },
    { trackId: 9, handlerType: "vide", codec: "raw", width: 0, height: 1080 }
  ).kind, "unsupported");

  const audioModel = buildFrameInternalsModel(
    { trackId: 3, sampleIndex: 4, size: 960, frameType: "Opus", nalTypes: ["Opus", "NB", "1 frames"] },
    { trackId: 3, handlerType: "soun", codec: "opus", channelCount: 2, sampleRate: 48000, codecConfig: { audioObjectTypeName: "Opus", samplingFrequency: 48000 } }
  );
  assert.equal(audioModel.kind, "audio-bands");
  assert.equal(audioModel.activeBandwidthHz, 4000);
  assert.equal(audioModel.bands.length, 8);
  assert.equal(Math.round(sum(audioModel.bands.map((band) => band.estimatedBytes))), 960);
  assert.equal(audioModel.bands.find((band) => band.label === "Air").active, false);

  const zeroAudioModel = buildFrameInternalsModel(
    { trackId: 6, sampleIndex: 1, size: 0, frameType: "audio", nalTypes: [] },
    { trackId: 6, handlerType: "soun", codec: "aac", channelCount: 0, sampleRate: 0, codecConfig: null }
  );
  assert.equal(zeroAudioModel.sampleRate, 0);
  assert.equal(zeroAudioModel.activeBandwidthHz, 20000);
  assert.ok(zeroAudioModel.bands.every((band) => band.ratio === 0));

  assert.equal(buildFrameInternalsModel(null, null).kind, "empty");
  assert.equal(buildFrameInternalsModel({ size: 1 }, { handlerType: "meta", codec: "text" }).kind, "unsupported");
});

function packBits(bits) {
  const bytes = new Uint8Array(Math.ceil(bits.length / 8));
  for (let bitIndex = 0; bitIndex < bits.length; bitIndex += 1) {
    if (bits[bitIndex] === "1") bytes[Math.floor(bitIndex / 8)] |= 1 << (7 - (bitIndex % 8));
  }
  return bytes;
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function assertSingleExpandedDepth(assertModule, model) {
  const depths = new Set(model.cells.map((cell) => cell.depth || 0));
  assertModule.equal(depths.size, 1);
  assertModule.equal([...depths][0], model.maxPartitionDepth);
}

function makeMp3HeaderBytes(options = {}) {
  const versionBits = options.versionBits === undefined ? 3 : options.versionBits;
  const layerBits = options.layerBits === undefined ? 1 : options.layerBits;
  const bitrateIndex = options.bitrateIndex === undefined ? 9 : options.bitrateIndex;
  const samplingRateIndex = options.samplingRateIndex === undefined ? 0 : options.samplingRateIndex;
  const padding = options.padding || 0;
  const channelMode = options.channelMode === undefined ? 0 : options.channelMode;
  const header = (
    0xffe00000 |
    (versionBits << 19) |
    (layerBits << 17) |
    (1 << 16) |
    (bitrateIndex << 12) |
    (samplingRateIndex << 10) |
    (padding << 9) |
    (channelMode << 6)
  ) >>> 0;
  return new Uint8Array([
    (header >>> 24) & 0xff,
    (header >>> 16) & 0xff,
    (header >>> 8) & 0xff,
    header & 0xff
  ]);
}
