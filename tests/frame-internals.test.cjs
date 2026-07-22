const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createSourceModuleLoader } = require("./helpers/source-module-loader.cjs");

test("actual frame internals model preserves parsed tree geometry and bit accounting", async () => {
  const loader = await createSourceModuleLoader();
  const {
    buildFrameInternalsColorScale,
    buildFrameInternalsModel,
    selectDisplayCells
  } = await loader.import("src/js/core/codecs/frame-internals.js");
  const row = { trackId: 1, sampleIndex: 1, size: 100, frameType: "I" };
  const track = {
    trackId: 1,
    handlerType: "vide",
    codec: "avc1",
    codecDescriptor: "avc",
    width: 32,
    height: 16
  };
  const parsedFrameInternals = {
    complete: true,
    granularity: "partition-tree",
    sampleBits: 800,
    attributedBits: 600,
    overheadBits: 200,
    unitName: "macroblock",
    unitWidth: 16,
    unitHeight: 16,
    columns: 2,
    rows: 1,
    roots: [
      {
        id: "mb-0",
        left: 0,
        top: 0,
        width: 16,
        height: 16,
        type: "I_16x16",
        ownBits: 10,
        subtreeBits: 310,
        children: [
          { id: "mb-0-a", left: 0, top: 0, width: 8, height: 16, type: "partition", syntaxBits: 200 },
          { id: "mb-0-b", left: 8, top: 0, width: 8, height: 16, type: "partition", syntaxBits: 100 }
        ]
      },
      { id: "mb-1", left: 16, top: 0, width: 16, height: 16, type: "I_16x16", syntaxBits: 290 }
    ]
  };
  const model = buildFrameInternalsModel(row, track, { parsedFrameInternals });
  assert.equal(model.kind, "video-grid");
  assert.equal(model.granularity, "partition-tree");
  assert.equal(model.sampleBits, 800);
  assert.equal(model.attributedBits, 600);
  assert.equal(model.overheadBits, 200);
  assert.equal(model.bitAccountingComplete, true);
  assert.equal(model.partitionBlockCount, 4);
  assert.equal(model.leafBlockCount, 3);
  assert.equal(model.cells.length, 3);
  assert.deepEqual(Array.from(model.cells, (cell) => cell.id), ["mb-0-a", "mb-0-b", "mb-1"]);
  assert.ok(model.cells.every((cell) => !("estimatedBits" in cell)));
  assert.equal(model.colorScale.mode, "selected-frame-actual");
  assert.equal(buildFrameInternalsColorScale(track, [], { cells: model.cells }).valueCount, 3);

  const budgetedCells = selectDisplayCells(parsedFrameInternals.roots.map((root) => ({
    ...root,
    children: root.children || []
  })), 2);
  assert.equal(budgetedCells.length, 2);
});

test("ISO BMFF rotation metadata maps intrinsic top-left cells to the correct screen edge", async () => {
  const loader = await createSourceModuleLoader();
  const { buildFrameInternalsModel } = await loader.import("src/js/core/codecs/frame-internals.js");
  const row = { trackId: 1, sampleIndex: 1, size: 1, frameType: "P" };
  const parsedFrameInternals = {
    complete: true,
    granularity: "partition-tree",
    sampleBits: 8,
    attributedBits: 1,
    overheadBits: 7,
    width: 4,
    height: 2,
    codedWidth: 4,
    codedHeight: 2,
    unitWidth: 1,
    unitHeight: 1,
    roots: [{ id: "top-left", left: 0, top: 0, width: 1, height: 1, syntaxBits: 1 }]
  };
  const baseTrack = {
    trackId: 1,
    handlerType: "vide",
    codec: "avc1",
    codecDescriptor: "avc",
    encodedWidth: 4,
    encodedHeight: 2
  };

  const counterClockwiseModel = buildFrameInternalsModel(row, {
    ...baseTrack,
    displayRotationDegrees: -90
  }, { parsedFrameInternals });
  assert.equal(counterClockwiseModel.mediaWidth, 2);
  assert.equal(counterClockwiseModel.mediaHeight, 4);
  assert.deepEqual(
    [
      counterClockwiseModel.cells[0].displayPixelLeft,
      counterClockwiseModel.cells[0].displayPixelTop,
      counterClockwiseModel.cells[0].displayPixelRight,
      counterClockwiseModel.cells[0].displayPixelBottom
    ],
    [1, 0, 2, 1]
  );

  const clockwiseModel = buildFrameInternalsModel(row, {
    ...baseTrack,
    displayRotationDegrees: 90
  }, { parsedFrameInternals });
  assert.deepEqual(
    [
      clockwiseModel.cells[0].displayPixelLeft,
      clockwiseModel.cells[0].displayPixelTop,
      clockwiseModel.cells[0].displayPixelRight,
      clockwiseModel.cells[0].displayPixelBottom
    ],
    [0, 3, 1, 4]
  );
});

test("model never fabricates unsupported, loading, audio, or root-only block bits", async () => {
  const loader = await createSourceModuleLoader();
  const { buildFrameInternalsModel } = await loader.import("src/js/core/codecs/frame-internals.js");
  const videoRow = { trackId: 1, sampleIndex: 1, size: 50, frameType: "I" };
  const av1Track = { trackId: 1, handlerType: "vide", codec: "av01", codecDescriptor: "av1", width: 160, height: 90 };
  assert.equal(buildFrameInternalsModel(videoRow, av1Track).kind, "loading");
  assert.equal(buildFrameInternalsModel(videoRow, av1Track, {
    parsedFrameInternals: { complete: false, reason: "unsupported syntax" }
  }).kind, "unsupported");
  const rootOnlyModel = buildFrameInternalsModel(videoRow, av1Track, {
    parsedFrameInternals: {
      complete: true,
      granularity: "root-units",
      unitWidth: 64,
      unitHeight: 64,
      columns: 3,
      rows: 2,
      roots: [{ id: "sb-0", left: 0, top: 0, width: 64, height: 64, type: "superblock" }]
    }
  });
  assert.equal(rootOnlyModel.kind, "video-grid");
  assert.equal(rootOnlyModel.granularity, "root-units");
  assert.equal(rootOnlyModel.attributedBits, null);
  assert.equal(rootOnlyModel.overheadBits, null);
  assert.equal(rootOnlyModel.cells[0].syntaxBits, null);
  assert.equal(buildFrameInternalsModel(videoRow, { handlerType: "vide", codec: "raw" }).kind, "unsupported");
  assert.equal(buildFrameInternalsModel(videoRow, { handlerType: "soun", codec: "opus" }).kind, "unsupported");
  assert.equal(buildFrameInternalsModel(null, null).kind, "empty");
});

test("AV1 sequence syntax produces exact 64x64 superblock roots for bundled MP4 and WebM", async () => {
  const loader = await createSourceModuleLoader();
  const av1 = await loader.import("src/js/core/codecs/video/av1.js");
  const sequenceHeader = av1.parseAv1SequenceHeader(Uint8Array.from([
    0x00, 0x00, 0x00, 0x03, 0xb4, 0xfd, 0x93, 0x6b, 0xe4, 0x01
  ]));
  assert.equal(sequenceHeader.maximumFrameWidth, 160);
  assert.equal(sequenceHeader.maximumFrameHeight, 90);
  assert.equal(sequenceHeader.superblockSize, 64);
  const fixedFrameSizeContext = {
    reducedStillPictureHeader: false,
    decoderModelInfoPresent: false,
    equalPictureInterval: false,
    framePresentationTimeLength: 0,
    seqForceScreenContentTools: 0,
    seqForceIntegerMv: 2,
    frameIdNumbersPresent: false
  };
  assert.equal(av1.parseAv1FrameSizeOverrideFlag(Uint8Array.of(0x10), fixedFrameSizeContext), false);
  assert.equal(av1.parseAv1FrameSizeOverrideFlag(Uint8Array.of(0x14), fixedFrameSizeContext), true);

  const coreModule = await loader.import("src/js/core/analyzer-core.js");
  for (const fileName of ["av1_mp4.mp4", "webm_av1.webm"]) {
    const fileBytes = fs.readFileSync(path.join(__dirname, "..", "validation", "generated", fileName));
    const file = new Blob([fileBytes], { type: "video/mp4" });
    Object.defineProperty(file, "name", { value: fileName });
    const analysis = await coreModule.Core.analyzeFile(file, {});
    const videoTrack = analysis.tracks.find((track) => track.handlerType === "vide");
    const sampleRow = analysis.sampleRows.find((row) => String(row.trackId) === String(videoTrack.trackId));
    const result = await coreModule.Core.analyzeFrameInternals(analysis, sampleRow);
    assert.equal(result.complete, true, fileName);
    assert.equal(result.granularity, "root-units", fileName);
    assert.equal(result.unitWidth, 64, fileName);
    assert.equal(result.columns, 3, fileName);
    assert.equal(result.rows, 2, fileName);
    assert.equal(result.roots.length, 6, fileName);
    assert.ok(result.roots.every((root) => root.codedBlockWidth === 64 && root.codedBlockHeight === 64), fileName);
    assert.equal(result.roots.at(-1).width, 32, fileName);
    assert.equal(result.roots.at(-1).height, 26, fileName);
    const model = coreModule.Core.buildFrameInternalsModel(sampleRow, videoTrack, {
      parsedFrameInternals: result
    });
    assert.equal(model.intrinsicWidth, 192, fileName);
    assert.equal(model.intrinsicHeight, 128, fileName);
    assert.equal(model.mediaWidth, 160, fileName);
    assert.equal(model.mediaHeight, 90, fileName);
    assert.equal(model.cells.at(-1).blockWidth, 64, fileName);
    assert.equal(model.cells.at(-1).blockHeight, 64, fileName);
    assert.equal(model.cells.at(-1).pixelRight, 160, fileName);
    assert.equal(model.cells.at(-1).pixelBottom, 90, fileName);

    const fourthSampleRow = analysis.sampleRows.filter(
      (row) => String(row.trackId) === String(videoTrack.trackId)
    )[3];
    const showExistingResult = await coreModule.Core.analyzeFrameInternals(analysis, fourthSampleRow);
    assert.equal(showExistingResult.complete, false, fileName);
    assert.match(showExistingResult.reason, /show_existing_frame/, fileName);
    assert.equal(showExistingResult.sampleBits, fourthSampleRow.size * 8, fileName);
    assert.equal(showExistingResult.attributedBits, null, fileName);
    assert.equal(showExistingResult.overheadBits, null, fileName);
  }
});

test("frame internals worker pool creates exactly eight workers and dispatches eight samples concurrently", async () => {
  const loader = await createSourceModuleLoader();
  const {
    FRAME_INTERNALS_WORKER_COUNT,
    FrameInternalsWorkerPool
  } = await loader.import("src/js/ui/analysis-worker-client.js");
  const workers = [];
  class FakeWorker {
    constructor() {
      this.messages = [];
      this.terminated = false;
      workers.push(this);
    }

    postMessage(message) {
      this.messages.push(message);
    }

    emit(message) {
      this.onmessage({ data: message });
    }

    terminate() {
      this.terminated = true;
    }
  }
  const pool = new FrameInternalsWorkerPool(() => new FakeWorker(), FRAME_INTERNALS_WORKER_COUNT);
  const file = new Blob([new Uint8Array(32)]);
  pool.initialize(file, [{ trackId: 1, codec: "av01" }]);
  assert.equal(FRAME_INTERNALS_WORKER_COUNT, 8);
  assert.equal(workers.length, 8);
  assert.ok(workers.every((worker) => worker.messages[0].type === "initialize"));

  const promises = Array.from({ length: 8 }, (_, index) => pool.analyze({
    trackId: 1,
    sampleIndex: index + 1,
    offset: String(index * 4),
    size: 4
  }));
  assert.ok(workers.every((worker) => worker.messages[1].type === "analyzeFrameInternals"));
  workers.forEach((worker, index) => {
    const request = worker.messages[1];
    worker.emit({
      type: "frameInternalsComplete",
      requestId: request.requestId,
      generation: request.generation,
      result: { complete: true, sampleIndex: index + 1 }
    });
  });
  const results = await Promise.all(promises);
  assert.deepEqual(results.map((result) => result.sampleIndex), [1, 2, 3, 4, 5, 6, 7, 8]);
});

test("frame internals worker pool reinitializes readers after cancellation", async () => {
  const loader = await createSourceModuleLoader();
  const {
    FRAME_INTERNALS_WORKER_COUNT,
    FrameInternalsWorkerPool
  } = await loader.import("src/js/ui/analysis-worker-client.js");
  const workers = [];
  class FakeWorker {
    constructor() {
      this.messages = [];
      this.terminated = false;
      workers.push(this);
    }

    postMessage(message) {
      this.messages.push(message);
    }

    emit(message) {
      this.onmessage({ data: message });
    }

    terminate() {
      this.terminated = true;
    }
  }
  const pool = new FrameInternalsWorkerPool(() => new FakeWorker(), FRAME_INTERNALS_WORKER_COUNT);
  const file = new Blob([new Uint8Array(8)]);
  const tracks = [{ trackId: 1, codec: "av01" }];
  pool.initialize(file, tracks);
  const cancelledRequest = pool.analyze({ trackId: 1, sampleIndex: 1, offset: "0", size: 4 });
  pool.cancelAll();
  await assert.rejects(cancelledRequest, /cancelled/);
  assert.ok(workers.every((worker) => worker.terminated));

  pool.initialize(file, tracks);
  assert.equal(workers.length, 16);
  const replacementWorkers = workers.slice(8);
  assert.ok(replacementWorkers.every((worker) => worker.messages.at(-1).type === "initialize"));
  const recoveredRequest = pool.analyze({ trackId: 1, sampleIndex: 2, offset: "4", size: 4 });
  const activeWorker = replacementWorkers.find(
    (worker) => worker.messages.at(-1).type === "analyzeFrameInternals"
  );
  const request = activeWorker.messages.at(-1);
  activeWorker.emit({
    type: "frameInternalsComplete",
    requestId: request.requestId,
    generation: request.generation,
    result: { complete: true, sampleIndex: 2 }
  });
  assert.deepEqual(await recoveredRequest, { complete: true, sampleIndex: 2 });
});

test("frame internals worker pool bounds restart churn and terminates failed workers", async () => {
  const loader = await createSourceModuleLoader();
  const {
    FRAME_INTERNALS_WORKER_COUNT,
    FrameInternalsWorkerPool
  } = await loader.import("src/js/ui/analysis-worker-client.js");
  const workers = [];
  class FailingWorker {
    constructor() {
      this.messages = [];
      this.terminated = false;
      workers.push(this);
    }

    postMessage(message) {
      this.messages.push(message);
    }

    fail(message) {
      this.onerror({ message });
    }

    terminate() {
      this.terminated = true;
    }
  }

  const pool = new FrameInternalsWorkerPool(() => new FailingWorker(), FRAME_INTERNALS_WORKER_COUNT);
  const file = new Blob([new Uint8Array(8)]);
  pool.initialize(file, [{ trackId: 1, handlerType: "vide", codec: "av01" }]);
  const request = pool.analyze({ trackId: 1, sampleIndex: 1, offset: "0", size: 4 });
  const firstWorker = workers[0];
  firstWorker.fail("worker load failed");

  assert.equal(firstWorker.terminated, true);
  assert.equal(workers.length, 9);
  const replacementWorker = workers[8];
  assert.deepEqual(
    replacementWorker.messages.map((message) => message.type),
    ["initialize", "analyzeFrameInternals"]
  );

  replacementWorker.fail("worker load failed again");
  await assert.rejects(request, (error) => (
    error.code === "FRAME_INTERNALS_WORKER_POOL_FAILED" && /repeated worker failure/.test(error.message)
  ));
  assert.equal(workers.length, 9);
  assert.ok(workers.every((worker) => worker.terminated));
  assert.equal(pool.workers.length, 0);
  await assert.rejects(
    pool.analyze({ trackId: 1, sampleIndex: 2, offset: "4", size: 4 }),
    /disabled after a repeated worker failure/
  );
});

test("frame internals workers receive only minimal track and sample descriptors", async () => {
  const loader = await createSourceModuleLoader();
  const {
    createFrameInternalsSampleDescriptor,
    createFrameInternalsTrackDescriptors
  } = await loader.import("src/js/ui/analysis-worker-client.js");
  const codecConfig = { nalLengthSize: 4, sps: [{ bytes: [1, 2, 3] }] };
  const descriptors = createFrameInternalsTrackDescriptors([{
    trackId: 7,
    handlerType: "vide",
    codec: "avc1",
    codecConfig,
    width: 1920,
    height: 1080,
    encodedWidth: 1920,
    encodedHeight: 1088,
    displayRotationDegrees: 90,
    pixelAspectRatioNumerator: 4,
    pixelAspectRatioDenominator: 3,
    sampleEntry: { large: true },
    stbl: { sampleSizes: new Array(1000).fill(1) },
    warnings: ["not copied"]
  }]);

  assert.deepEqual(JSON.parse(JSON.stringify(descriptors)), [{
    trackId: 7,
    handlerType: "vide",
    codec: "avc1",
    codecConfig,
    width: 1920,
    height: 1080,
    encodedWidth: 1920,
    encodedHeight: 1088,
    displayRotationDegrees: 90,
    pixelAspectRatioNumerator: 4,
    pixelAspectRatioDenominator: 3
  }]);
  assert.equal("sampleEntry" in descriptors[0], false);
  assert.equal("stbl" in descriptors[0], false);
  assert.deepEqual(JSON.parse(JSON.stringify(createFrameInternalsSampleDescriptor({
    trackId: 7,
    sampleIndex: 3,
    offset: "128",
    size: 4096,
    frameType: "I",
    warnings: new Array(100).fill("not copied")
  }))), {
    trackId: 7,
    sampleIndex: 3,
    offset: "128",
    size: 4096,
    frameType: "I"
  });
});

test("frame internals rejects oversized samples before reading payload bytes", async () => {
  const loader = await createSourceModuleLoader();
  const {
    MAX_FRAME_INTERNALS_SAMPLE_BYTES,
    readSampleBytes
  } = await loader.import("src/js/core/codecs/frame-internals-analyzer.js");
  let readCalled = false;
  await assert.rejects(() => readSampleBytes({
    reader: {
      async readRange() {
        readCalled = true;
        return new Uint8Array();
      }
    }
  }, {
    offset: "0",
    size: String(MAX_FRAME_INTERNALS_SAMPLE_BYTES + 1)
  }), /32 MiB/);
  assert.equal(readCalled, false);
});

test("AV1 internals reject excessive OBU counts before retaining an unbounded structure", async () => {
  const loader = await createSourceModuleLoader();
  const { parseAv1FrameInternals } = await loader.import("src/js/core/codecs/video/av1.js");
  const sampleBytes = new Uint8Array(10001 * 2);
  for (let offset = 0; offset < sampleBytes.byteLength; offset += 2) {
    sampleBytes[offset] = 0x12;
    sampleBytes[offset + 1] = 0;
  }

  const result = parseAv1FrameInternals(sampleBytes, null, {});

  assert.equal(result.complete, false);
  assert.match(result.reason, /10,000-OBU safety limit/);
  assert.equal(result.sampleBits, sampleBytes.byteLength * 8);
  assert.equal(result.attributedBits, null);
  assert.equal(result.overheadBits, null);
});
