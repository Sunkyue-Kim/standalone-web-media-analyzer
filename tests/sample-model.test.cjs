const assert = require("node:assert/strict");
const test = require("node:test");
const { createSourceModuleLoader } = require("./helpers/source-module-loader.cjs");

function box(type, fields = {}, children = [], options = {}) {
  return {
    type,
    path: options.path || "/" + type,
    offset: String(options.offset || 0),
    offsetBig: BigInt(options.offset || 0),
    size: String(options.size || 8),
    sizeBig: BigInt(options.size || 8),
    headerSize: options.headerSize || 8,
    fields,
    children,
    warnings: []
  };
}

function makeTrackTree(extraStblChildren = [], options = {}) {
  const trackHeaderFields = {
    trackId: 7,
    width: 1920,
    height: 1080,
    ...(options.trackHeaderFields || {})
  };
  const sampleEntry = {
    format: "avc1",
    width: 1280,
    height: 720,
    codecConfig: { nalLengthSize: 4 },
    ...(options.sampleEntry || {})
  };
  return box("trak", {}, [
    box("tkhd", trackHeaderFields),
    box("mdia", {}, [
      box("mdhd", { timescale: 90000, duration: "9000" }),
      box("hdlr", { handlerType: "vide" }),
      box("minf", {}, [
        box("stbl", {}, [
          box("stsd", { entries: [sampleEntry] }),
          ...extraStblChildren
        ])
      ])
    ])
  ]);
}

test("sample model builds normal MP4 track and timing rows", async () => {
  const loader = await createSourceModuleLoader();
  const sampleModel = await loader.import("src/js/core/containers/isobmff/sample-model.js");
  const warnings = [];
  const moov = box("moov", {}, [
    makeTrackTree([
      box("stsz", { sampleCount: 3, sampleSize: 0, sizes: [100, 120, 140] }),
      box("stsc", { entries: [{ firstChunk: 1, samplesPerChunk: 2 }, { firstChunk: 2, samplesPerChunk: 1 }] }),
      box("stco", { offsets: ["1000", "2000"] }),
      box("stts", { entries: [{ sampleCount: 3, sampleDelta: 3000 }] }),
      box("ctts", { entries: [{ sampleCount: 1, sampleOffset: 0 }, { sampleCount: 2, sampleOffset: 1500 }] }),
      box("stss", { samples: [1, 3] })
    ])
  ]);

  const tracks = sampleModel.buildTrackModels([moov], warnings);
  assert.equal(tracks.length, 1);
  assert.equal(tracks[0].trackId, 7);
  assert.equal(tracks[0].codecDescriptor, "avc");
  assert.equal(tracks[0].width, 1280);
  assert.equal(tracks[0].displayWidth, 1920);
  assert.equal(tracks[0].displayHeight, 1080);

  const rows = sampleModel.buildNormalSamples(tracks, warnings);
  assert.equal(rows.length, 3);
  assert.deepEqual(Array.from(rows.map((row) => row.offset)), ["1000", "1100", "2000"]);
  assert.deepEqual(Array.from(rows.map((row) => row.dts)), [0, 3000, 6000]);
  assert.deepEqual(Array.from(rows.map((row) => row.pts)), [0, 4500, 7500]);
  assert.deepEqual(Array.from(rows.map((row) => row.isSync)), [true, false, true]);
  assert.equal(tracks[0].sampleCount, 3);
  assert.deepEqual(Array.from(warnings), []);
});

test("sample model keeps encoded and display dimensions separate for rotated video tracks", async () => {
  const loader = await createSourceModuleLoader();
  const sampleModel = await loader.import("src/js/core/containers/isobmff/sample-model.js");
  const warnings = [];
  const moov = box("moov", {}, [
    makeTrackTree([], {
      trackHeaderFields: { rotationDegrees: -90, width: 1920, height: 1080 },
      sampleEntry: { width: 1920, height: 1080 }
    })
  ]);

  const tracks = sampleModel.buildTrackModels([moov], warnings);

  assert.equal(tracks.length, 1);
  assert.equal(tracks[0].width, 1920);
  assert.equal(tracks[0].height, 1080);
  assert.equal(tracks[0].encodedWidth, 1920);
  assert.equal(tracks[0].encodedHeight, 1080);
  assert.equal(tracks[0].displayWidth, 1080);
  assert.equal(tracks[0].displayHeight, 1920);
  assert.equal(tracks[0].displayRotationDegrees, -90);
  assert.deepEqual(Array.from(warnings), []);
});

test("sample model builds fMP4 fragment samples using trex/tfhd/tfdt/trun defaults", async () => {
  const loader = await createSourceModuleLoader();
  const sampleModel = await loader.import("src/js/core/containers/isobmff/sample-model.js");
  const warnings = [];
  const moov = box("moov", {}, [
    box("mvex", {}, [
      box("trex", { trackId: 7, defaultSampleDuration: 1000, defaultSampleSize: 10, defaultSampleFlags: 0x00010000 })
    ]),
    makeTrackTree([])
  ]);
  const moof = box("moof", {}, [
    box("traf", {}, [
      box("tfhd", { trackId: 7, defaultBaseIsMoof: true, defaultSampleDuration: 1200, defaultSampleSize: 20 }),
      box("tfdt", { baseMediaDecodeTime: "9000" }),
      box("trun", {
        dataOffset: 108,
        firstSampleFlags: 0,
        sampleCount: 2,
        samples: [
          { size: 30, duration: 1000, compositionTimeOffset: 200, flags: 0 },
          { compositionTimeOffset: 400 }
        ]
      })
    ])
  ], { offset: 500, size: 100 });
  const mdat = box("mdat", {}, [], { offset: 700, size: 100 });

  const tracks = sampleModel.buildTrackModels([moov, moof, mdat], warnings);
  const rows = sampleModel.buildFragmentSamples([moov, moof, mdat], tracks, warnings);

  assert.equal(rows.length, 2);
  assert.deepEqual(Array.from(rows.map((row) => row.offset)), ["608", "638"]);
  assert.deepEqual(Array.from(rows.map((row) => row.size)), [30, 20]);
  assert.deepEqual(Array.from(rows.map((row) => row.dts)), [9000, 10000]);
  assert.deepEqual(Array.from(rows.map((row) => row.pts)), [9200, 10400]);
  assert.deepEqual(Array.from(rows.map((row) => row.fragmentIndex)), [1, 1]);
  assert.deepEqual(Array.from(rows.map((row) => row.isSync)), [true, false]);
  assert.equal(tracks[0].sampleCount, 2);
});

test("sample model reports missing init and default audio frame labels", async () => {
  const loader = await createSourceModuleLoader();
  const sampleModel = await loader.import("src/js/core/containers/isobmff/sample-model.js");
  const warnings = [];

  assert.deepEqual(Array.from(sampleModel.buildTrackModels([], warnings)), []);
  assert.match(warnings[0], /No moov/);
  assert.equal(sampleModel.getDefaultSampleFrameType({ codec: "mp4a" }), "AAC");
  assert.equal(sampleModel.getDefaultSampleFrameType({ codec: "A_OPUS" }), "Opus");
  assert.deepEqual(Array.from(sampleModel.getDefaultSampleTags({ codec: "av01", codecDescriptor: "av1" })), ["AV1"]);
  assert.deepEqual(Array.from(sampleModel.getDefaultSampleTags({ handlerType: "soun", codec: "alac" })), ["alac"]);
});
