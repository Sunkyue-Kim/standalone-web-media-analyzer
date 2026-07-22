const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { SourceModuleLoader, createSourceModuleLoader } = require("./helpers/source-module-loader.cjs");

test("UI helpers keep sample catalog, media detection, escaping, CSV, and frame classes stable", async () => {
  const loader = await createSourceModuleLoader();
  const helpers = await loader.import("src/js/ui/ui-helpers.js");

  assert.equal(helpers.canUseSampleCatalogLocation({ protocol: "file:" }), false);
  assert.equal(helpers.canUseSampleCatalogLocation({ protocol: "https:" }), true);
  assert.equal(helpers.canUseSampleCatalogLocation(null), false);
  assert.equal(helpers.isLikelyMediaFile({ name: "clip.MOV", type: "" }), true);
  assert.equal(helpers.isLikelyMediaFile({ name: "notes.txt", type: "text/plain" }), false);
  assert.equal(helpers.isLikelyMediaFile({ name: "", type: "audio/ogg" }), true);
  assert.equal(helpers.isLikelyMediaFile(null), false);
  assert.equal(helpers.isLikelyMediaFile({ name: "", type: "video/quicktime" }), true);
  assert.equal(helpers.getFrameRowKey({ trackId: 3, sampleIndex: 99 }), "3:99");
  assert.equal(helpers.getFrameTypeClass("I"), "i");
  assert.equal(helpers.getFrameTypeClass("IDR"), "i");
  assert.equal(helpers.getFrameTypeClass("MP3"), "aac");
  assert.equal(helpers.getFrameTypeClass("unknown"), "warn");
  assert.equal(helpers.getFrameTypeClass("mixed(I/P)"), "err");
  assert.equal(helpers.getFrameTypeClass("metadata"), "");
  assert.equal(helpers.escapeHtml("<tag attr=\"x\">&'"), "&lt;tag attr=&quot;x&quot;&gt;&amp;&#39;");
  assert.equal(helpers.csvCell("a,b\n\"c\""), "\"a,b\n\"\"c\"\"\"");
  assert.equal(helpers.csvCell(null), "");
});

test("playback rate model clamps, rounds, formats, and identifies presets", async () => {
  const loader = await createSourceModuleLoader();
  const playbackRate = await loader.import("src/js/ui/playback-rate.js");

  assert.deepEqual(
    JSON.parse(JSON.stringify(playbackRate.PLAYBACK_RATE_PRESETS)),
    [0.25, 0.5, 1, 1.25, 1.5, 2]
  );
  assert.equal(playbackRate.PLAYBACK_RATE_MINIMUM, 0.1);
  assert.equal(playbackRate.PLAYBACK_RATE_MAXIMUM, 5);
  assert.equal(playbackRate.PLAYBACK_RATE_SLIDER_STEP, 0.01);
  assert.equal(playbackRate.normalizePlaybackRate(0), 0.1);
  assert.equal(playbackRate.normalizePlaybackRate(6), 5);
  assert.equal(playbackRate.normalizePlaybackRate(1.236), 1.24);
  assert.equal(playbackRate.normalizePlaybackRate("invalid", 1.25), 1.25);
  assert.equal(playbackRate.normalizePlaybackRate("invalid", "invalid"), 1);
  assert.equal(playbackRate.formatPlaybackRate(1), "1×");
  assert.equal(playbackRate.formatPlaybackRate(1.5), "1.5×");
  assert.equal(playbackRate.formatPlaybackRate(0.25), "0.25×");
  assert.equal(playbackRate.isPlaybackRatePresetActive(1.2501, 1.25), true);
  assert.equal(playbackRate.isPlaybackRatePresetActive(1.26, 1.25), false);
});

test("sample manifest exposes generated media through the shared bootstrap catalog", async () => {
  const loader = await createSourceModuleLoader();
  const { SAMPLE_FILES } = await loader.import("src/js/samples/sample-manifest.js");
  const bootstrapSource = fs.readFileSync(
    path.resolve(__dirname, "..", "src", "js", "ui", "bootstrap-ui.js"),
    "utf8"
  );
  const expectedSamples = new Map([
    ["avc-moving-detail-patch", "avc_moving_detail_patch.mp4"],
    ["hevc-4k-5s", "hevc_4k_5s.mp4"]
  ]);

  for (const [sampleId, expectedFileName] of expectedSamples) {
    const sample = SAMPLE_FILES.find((candidate) => candidate.id === sampleId);
    assert.ok(sample, "missing sample " + sampleId);
    assert.equal(sample.fileName, expectedFileName);
    assert.ok(sample.labels.en);
    assert.ok(sample.labels.ko);
    assert.equal(fs.existsSync(path.resolve(__dirname, "..", sample.path)), true);
  }
  assert.match(bootstrapSource, /import \{ SAMPLE_FILES \} from "\.\.\/samples\/sample-manifest\.js"/);
  assert.match(bootstrapSource, /const BOOTSTRAP_SAMPLE_FILES = SAMPLE_FILES;/);
});

test("media source policy shares preload behavior for local blobs and remote URLs", async () => {
  const loader = await createSourceModuleLoader();
  const mediaSource = await loader.import("src/js/ui/media-source.js");

  assert.equal(mediaSource.MEDIA_PREVIEW_PRELOAD, "metadata");
  assert.equal(mediaSource.MEDIA_PREVIEW_FRAME_SEEK_NUDGE_SECONDS, 0.001);
  assert.equal(mediaSource.REMOTE_SHARED_DOWNLOAD_LIMIT_BYTES, 4 * 1024 * 1024);
  assert.equal(mediaSource.shouldDownloadRemoteOnceForSharedPlayback({ size: 4 * 1024 * 1024 }), true);
  assert.equal(mediaSource.shouldDownloadRemoteOnceForSharedPlayback({ size: 4 * 1024 * 1024 + 1 }), false);
  assert.equal(mediaSource.shouldDownloadRemoteOnceForSharedPlayback({ size: 100 }, { forceStreaming: true }), false);

  const localResource = { name: "local.mp4", size: 1024, type: "video/mp4" };
  const localPlan = mediaSource.createMediaPreviewPlan(localResource, {
    objectUrlFactory: (resource) => "blob:test-" + resource.name
  });
  assert.deepEqual(JSON.parse(JSON.stringify(localPlan)), {
    sourceKind: "local-file",
    url: "blob:test-local.mp4",
    isObjectUrl: true,
    preload: "metadata",
    title: ""
  });

  const remoteResource = {
    kind: "remote-url",
    name: "remote.mp4",
    size: 8 * 1024 * 1024,
    previewUrl: "https://media.test/remote.mp4"
  };
  const remotePlan = mediaSource.createMediaPreviewPlan(remoteResource);
  assert.deepEqual(JSON.parse(JSON.stringify(remotePlan)), {
    sourceKind: "remote-url",
    url: "https://media.test/remote.mp4",
    isObjectUrl: false,
    preload: "metadata",
    title: ""
  });

  const suppliedPreviewPlan = mediaSource.createMediaPreviewPlan({
    kind: "local-file",
    name: "prebuilt.mp4",
    previewUrl: "blob:prebuilt"
  });
  assert.equal(suppliedPreviewPlan.url, "blob:prebuilt");
  assert.equal(suppliedPreviewPlan.isObjectUrl, false);

  const defaultUrlLoader = new SourceModuleLoader({
    rootDirectory: path.resolve(__dirname, ".."),
    globals: {
      URL: {
        createObjectURL(resource) {
          return "blob:default-" + resource.name;
        }
      }
    }
  });
  const defaultUrlMediaSource = await defaultUrlLoader.import("src/js/ui/media-source.js");
  assert.equal(defaultUrlMediaSource.createMediaPreviewPlan({ name: "generated.mp3" }).url, "blob:default-generated.mp3");

  const missingUrlLoader = new SourceModuleLoader({
    rootDirectory: path.resolve(__dirname, ".."),
    globals: { URL: {} }
  });
  const missingUrlMediaSource = await missingUrlLoader.import("src/js/ui/media-source.js");
  assert.throws(() => missingUrlMediaSource.createMediaPreviewPlan({ name: "missing.mp4" }), /Object URL creation is not available/);

  assert.deepEqual(
    JSON.parse(JSON.stringify(mediaSource.prepareMediaPreviewFrame(null))),
    { status: "unavailable", targetTime: null }
  );
  assert.equal(mediaSource.prepareMediaPreviewFrame({ src: "blob:ready", readyState: 2, currentTime: 4 }).status, "ready");
  assert.equal(mediaSource.prepareMediaPreviewFrame({ src: "blob:seeking", readyState: 4, currentTime: 2, seeking: true }).status, "pending");
  assert.equal(mediaSource.prepareMediaPreviewFrame({ src: "blob:metadata", readyState: 0, currentTime: 0 }).status, "metadata-pending");

  const framePendingMedia = {
    src: "blob:first-frame",
    readyState: 1,
    currentTime: 0,
    duration: 10,
    seeking: false
  };
  const frameRequest = mediaSource.prepareMediaPreviewFrame(framePendingMedia);
  assert.equal(frameRequest.status, "requested");
  assert.equal(frameRequest.targetTime, 0.001);
  assert.equal(framePendingMedia.currentTime, 0.001);
  assert.equal(mediaSource.getMediaPreviewFrameSeekTarget({ currentTime: 10, duration: 10 }), 9.999);
  assert.equal(mediaSource.getMediaPreviewFrameSeekTarget({ currentTime: 0, duration: 0.0005 }), 0.00025);

  const rejectedSeekMedia = { src: "blob:rejected", readyState: 1, duration: 10 };
  Object.defineProperty(rejectedSeekMedia, "currentTime", {
    get() { return 0; },
    set() { throw new Error("seek rejected"); }
  });
  assert.equal(mediaSource.prepareMediaPreviewFrame(rejectedSeekMedia).status, "unavailable");
});

test("data grid renderer builds reusable scrollable grid markup", async () => {
  const loader = await createSourceModuleLoader();
  const { createDataGridLayout, renderDataGridTable } = await loader.import("src/js/ui/data-grid.js");
  const html = renderDataGridTable({
    className: "test-grid",
    minimumWidth: "320px",
    columns: [
      { label: "Name", width: "120px" },
      { label: "Value", width: "minmax(120px, 1fr)" }
    ],
    rows: [
      {
        className: "clickable",
        attributes: { role: "button", "data-frame-key": "1:2" },
        cells: ["<unsafe>", { value: "abc", title: "abc" }]
      }
    ]
  });

  assert.match(html, /class="data-grid-shell test-grid"/);
  assert.match(html, /--data-grid-columns:minmax\(120px, 1fr\) minmax\(120px, 1fr\);--data-grid-width:320px;/);
  assert.match(html, /class="data-grid-header"/);
  assert.match(html, /class="data-grid-row clickable" role="button" data-frame-key="1:2"/);
  assert.match(html, /&lt;unsafe&gt;/);
  assert.match(html, /title="abc"/);
  assert.equal(createDataGridLayout({ minimumWidth: "320px", columns: [{ label: "Name", width: "120px" }], rows: [] }).minimumWidth, "320px");
});

test("data grid renderer expands overflow width from headers and cell content", async () => {
  const loader = await createSourceModuleLoader();
  const { renderDataGridTable } = await loader.import("src/js/ui/data-grid.js");
  const html = renderDataGridTable({
    className: "overflow-grid",
    minimumWidth: "160px",
    columns: [
      { label: "FPS / samples/s", width: "60px" },
      { label: "Codec config", width: "60px" }
    ],
    rows: [
      {
        cells: [
          "60.00",
          { value: "avc1.42c00a, NAL length 4", title: "avc1.42c00a, NAL length 4" }
        ]
      }
    ]
  });

  const styleMatch = html.match(/--data-grid-columns:minmax\((\d+)px, 1fr\) minmax\((\d+)px, 1fr\);--data-grid-width:(\d+)px;/);
  assert.ok(styleMatch, html);
  const headerDrivenWidth = Number(styleMatch[1]);
  const contentDrivenWidth = Number(styleMatch[2]);
  const totalGridWidth = Number(styleMatch[3]);
  assert.ok(headerDrivenWidth > 60);
  assert.ok(contentDrivenWidth > 60);
  assert.equal(totalGridWidth, headerDrivenWidth + contentDrivenWidth);
});

test("data grid renderer handles fallback widths, HTML cells, and boolean attributes", async () => {
  const loader = await createSourceModuleLoader();
  const { createDataGridLayout, renderDataGridTable } = await loader.import("src/js/ui/data-grid.js");
  const layout = createDataGridLayout({
    minimumWidth: "70vw",
    columns: [
      { label: "", width: "2fr" },
      { label: "Flag", width: "0" },
      { label: "", width: "12.4px" }
    ],
    rows: [
      { cells: ["", { html: "<strong>ready</strong>" }, ""] }
    ]
  });
  const html = renderDataGridTable({
    columns: [{ label: "A" }],
    rows: [
      {
        attributes: {
          hidden: false,
          inert: null,
          disabled: true,
          "data-index": 3
        },
        cells: [{ html: "<em>raw</em>", title: "\"quoted\"" }]
      }
    ]
  });

  assert.match(layout.minimumWidth, /^max\(70vw, \d+px\)$/);
  assert.match(layout.gridTemplateColumns, /minmax\(0px, 1fr\)/);
  assert.match(layout.gridTemplateColumns, /minmax\(13px, 1fr\)/);
  assert.match(html, / disabled/);
  assert.match(html, / data-index="3"/);
  assert.doesNotMatch(html, / hidden/);
  assert.doesNotMatch(html, / inert/);
  assert.match(html, /<em>raw<\/em>/);
  assert.match(html, /title="&quot;quoted&quot;"/);
});

test("recycler view keeps rendered rows bounded to the visible window", async () => {
  const loader = await createSourceModuleLoader();
  const { calculateRecyclerWindow, createRecyclerView } = await loader.import("src/js/ui/recycler-view.js");
  const range = calculateRecyclerWindow({
    rowCount: 10000,
    rowHeight: 32,
    scrollTop: 3200,
    viewportHeight: 320,
    overscan: 2
  });

  assert.deepEqual(JSON.parse(JSON.stringify(range)), {
    first: 98,
    last: 112,
    count: 14,
    totalHeight: 320000
  });

  const scrollElement = { scrollTop: 3200, clientHeight: 320, scrollHeight: 320000 };
  const spacerElement = { style: {}, innerHTML: "" };
  const recycler = createRecyclerView({
    scrollElement,
    spacerElement,
    rowHeight: 32,
    overscan: 2,
    renderRow: (row, rowIndex) => '<div style="top:' + (rowIndex * 32) + 'px">' + row + '</div>'
  });

  recycler.setRows(Array.from({ length: 10000 }, (_, rowIndex) => "row-" + rowIndex));
  const renderedRange = recycler.renderNow();
  assert.equal(spacerElement.style.height, "320000px");
  assert.deepEqual(JSON.parse(JSON.stringify(renderedRange)), JSON.parse(JSON.stringify(range)));
  assert.match(spacerElement.innerHTML, /row-98/);
  assert.match(spacerElement.innerHTML, /row-111/);
  assert.doesNotMatch(spacerElement.innerHTML, /row-0</);
  recycler.scrollRowIntoCenter(5000);
  assert.ok(scrollElement.scrollTop > 150000);
});

test("recycler view handles empty rows, offsets, fallback heights, and scheduled rerenders", async () => {
  const animationCallbacks = new Map();
  const cancelledAnimationFrameIds = [];
  let nextAnimationFrameId = 1;
  const loader = new SourceModuleLoader({
    rootDirectory: path.resolve(__dirname, ".."),
    globals: {
      requestAnimationFrame(callback) {
        const animationFrameId = nextAnimationFrameId;
        nextAnimationFrameId += 1;
        animationCallbacks.set(animationFrameId, callback);
        return animationFrameId;
      },
      cancelAnimationFrame(animationFrameId) {
        cancelledAnimationFrameIds.push(animationFrameId);
        animationCallbacks.delete(animationFrameId);
      }
    }
  });
  const { calculateRecyclerWindow, createRecyclerView } = await loader.import("src/js/ui/recycler-view.js");

  assert.deepEqual(JSON.parse(JSON.stringify(calculateRecyclerWindow({
    rowCount: -1,
    rowHeight: 0,
    scrollTop: -10,
    viewportHeight: 0,
    overscan: -2
  }))), {
    first: 0,
    last: 0,
    count: 0,
    totalHeight: 1
  });

  const scrollElement = { scrollTop: 50, clientHeight: 90, scrollHeight: 0 };
  const spacerElement = { style: {}, innerHTML: "" };
  const renderedRows = [];
  const recycler = createRecyclerView({
    scrollElement,
    spacerElement,
    rowHeight: 20,
    overscan: 1,
    scrollTopOffset: 10,
    viewportHeightOffset: 10,
    renderRow(row, rowIndex) {
      renderedRows.push([row, rowIndex]);
      return '<div>' + row + '</div>';
    }
  });

  recycler.setRows(null);
  assert.equal(spacerElement.style.height, "1px");
  recycler.scrollRowIntoCenter(10);
  assert.equal(scrollElement.scrollTop, 50);

  recycler.setRows(["a", "b", "c", "d", "e"]);
  assert.equal(spacerElement.style.height, "100px");
  assert.deepEqual(JSON.parse(JSON.stringify(recycler.getVisibleRange())), {
    first: 1,
    last: 5,
    count: 4,
    totalHeight: 100
  });
  recycler.scheduleRender();
  recycler.scheduleRender();
  assert.deepEqual(cancelledAnimationFrameIds, [1]);
  animationCallbacks.get(2)();
  assert.deepEqual(JSON.parse(JSON.stringify(renderedRows)), [["b", 1], ["c", 2], ["d", 3], ["e", 4]]);
  recycler.scrollRowIntoCenter(4);
  assert.equal(scrollElement.scrollTop, 20);
});

test("summary codec track counts only include present codec groups", async () => {
  const loader = await createSourceModuleLoader();
  const { getVisibleSummaryCodecTrackCounts } = await loader.import("src/js/ui/summary-model.js");
  const counts = getVisibleSummaryCodecTrackCounts([
    { codec: "avc1", codecDescriptor: "avc" },
    { codec: "mp4a", codecDescriptor: "aac" },
    { codec: "A_OPUS", codecDescriptor: "opus" },
    { codec: "V_VP9", codecDescriptor: "V_VP9" },
    { codec: "av01", codecDescriptor: "av1" }
  ]);

  assert.deepEqual(JSON.parse(JSON.stringify(counts)), [
    { labelKey: "summary.avcTracks", count: 1 },
    { labelKey: "summary.vp9Tracks", count: 1 },
    { labelKey: "summary.av1Tracks", count: 1 },
    { labelKey: "summary.aacTracks", count: 1 },
    { labelKey: "summary.opusTracks", count: 1 }
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(getVisibleSummaryCodecTrackCounts([{ codec: "raw " }]))), []);
});

test("media row and metrics models keep timing calculations reusable outside UI state", async () => {
  const loader = await createSourceModuleLoader();
  const rowModel = await loader.import("src/js/ui/media-row-model.js");
  const metricsModel = await loader.import("src/js/ui/metrics-model.js");
  const track = { trackId: 1, handlerType: "vide", timescale: 1000, duration: "3000" };
  const rows = [
    { trackId: 1, sampleIndex: 1, dts: 1000, pts: 2000, duration: 500, size: 100, frameType: "I", isSync: true },
    { trackId: 1, sampleIndex: 2, dts: 1500, pts: 1000, duration: 500, size: 200, frameType: "B", isSync: false },
    { trackId: 1, sampleIndex: 3, dts: 2000, pts: 1500, duration: 500, size: 300, frameType: "P", isSync: true }
  ];
  const getTrack = () => track;

  assert.deepEqual(rows.slice().sort((left, right) => rowModel.compareRowsByPresentationTime(left, right, getTrack)).map((row) => row.sampleIndex), [2, 3, 1]);
  assert.deepEqual(rows.slice().sort((left, right) => rowModel.compareRowsByDecodeTime(left, right, getTrack)).map((row) => row.sampleIndex), [1, 2, 3]);
  assert.equal(rowModel.getRowTimeSeconds(rows[0], getTrack), 2);
  assert.equal(rowModel.getRowDecodeTimeSeconds(rows[0], getTrack), 1);
  assert.equal(rowModel.getRowDurationSeconds(rows[0], getTrack), 0.5);
  assert.equal(rowModel.getFirstFiniteNumber(["", null, undefined, "4"], 0), 4);

  const summary = metricsModel.getTrackSummaryMetrics(track, rows);
  const metrics = metricsModel.buildTrackMetrics(track, rows, 2, { getDefaultSampleFrameType: () => "sample" });
  assert.equal(summary.averageSampleSize, 200);
  assert.equal(metrics.movingAveragePoints.length, 2);
  assert.equal(metrics.summary.medianSampleSize, 200);
  assert.equal(metrics.frameTypeCounts.get("I"), 1);
  assert.deepEqual(metrics.topSizeRows.map((row) => row.sampleIndex), [3, 2, 1]);

  const timelineRows = [
    { trackId: 1, sampleIndex: 1, pts: 0, duration: 500, size: 100 },
    { trackId: 1, sampleIndex: 2, pts: 500, duration: 500, size: 100 },
    { trackId: 1, sampleIndex: 3, pts: 1000, duration: 500, size: 100 },
    { trackId: 1, sampleIndex: 4, pts: 1500, duration: 500, size: 100 }
  ];
  const startAnchoredPoints = metricsModel.buildMovingAveragePoints(track, timelineRows, 3);
  assert.deepEqual(JSON.parse(JSON.stringify(startAnchoredPoints.map((point) => point.time))), [0, 0.5]);
  assert.deepEqual(
    JSON.parse(JSON.stringify(startAnchoredPoints.map((point) => [point.windowStartSampleIndex, point.windowEndSampleIndex]))),
    [[1, 3], [2, 4]]
  );
  assert.deepEqual(JSON.parse(JSON.stringify(startAnchoredPoints.map((point) => point.bitrate))), [1600, 1600]);
  assert.deepEqual(JSON.parse(JSON.stringify(startAnchoredPoints.map((point) => point.fps))), [2, 2]);
});

test("media row and metrics models cover fallback timing and empty metrics", async () => {
  const loader = await createSourceModuleLoader();
  const rowModel = await loader.import("src/js/ui/media-row-model.js");
  const metricsModel = await loader.import("src/js/ui/metrics-model.js");
  const track = { trackId: 1, handlerType: "soun", timescale: 1000, duration: 2500 };
  const fallbackRows = [
    { trackId: 1, sampleIndex: 1, pts: 1000, size: 50 },
    { trackId: 1, sampleIndex: 2, pts: 1600, size: 75 },
    { trackId: 1, sampleIndex: 3, pts: 1600, size: 25 }
  ];

  assert.equal(rowModel.getRowTimeSeconds({ sampleIndex: 7, pts: "", dts: null }), 7);
  assert.equal(rowModel.getRowDecodeTimeSeconds({ sampleIndex: 8, dts: "12" }), 12);
  assert.equal(rowModel.getRowDurationSeconds({ duration: -1 }, () => track), 0);
  assert.equal(rowModel.getFirstFiniteNumber(["bad", Number.NaN, 9], 0), 9);
  assert.equal(Number(rowModel.getSampleDurationSeconds(fallbackRows[0], track, fallbackRows, 0).toFixed(6)), 0.6);
  assert.equal(rowModel.getSampleDurationSeconds(fallbackRows[1], track, fallbackRows, 1), 0);
  assert.equal(rowModel.getRowsDurationSeconds(track, [{ trackId: 1, sampleIndex: 1, size: 10 }]), 2.5);
  assert.equal(metricsModel.getTrackSummaryMetrics(null, fallbackRows), null);
  assert.equal(metricsModel.getTrackSummaryMetrics(track, []), null);
  assert.equal(metricsModel.getTrackSummaryMetrics({ trackId: 2, timescale: 1000, duration: 0 }, [
    { trackId: 2, sampleIndex: 1, duration: 0, size: 10 }
  ]), null);

  const emptyPoints = metricsModel.buildMovingAveragePoints(track, [], 4);
  const boundedPoints = metricsModel.buildMovingAveragePoints(track, fallbackRows, 99);
  const invalidWindowPoints = metricsModel.buildMovingAveragePoints(track, fallbackRows, 0);
  const zeroDurationPoints = metricsModel.buildMovingAveragePoints(track, [
    { trackId: 1, sampleIndex: 1, pts: 1000, size: 10 },
    { trackId: 1, sampleIndex: 2, pts: 1000, size: 20 }
  ], 2);
  const emptyMetrics = metricsModel.buildTrackMetrics(track, [], "bad");
  const fallbackMetrics = metricsModel.buildTrackMetrics(track, [
    { trackId: 1, sampleIndex: 1, pts: 0, duration: 500, size: 10 },
    { trackId: 1, sampleIndex: 2, pts: 500, duration: 500, size: 20, frameType: "" }
  ], 1, { getDefaultSampleFrameType: () => "AAC" });
  const positiveSyncMetrics = metricsModel.buildTrackMetrics(track, [
    { trackId: 1, sampleIndex: 1, pts: 0, duration: 500, size: 10, isSync: true },
    { trackId: 1, sampleIndex: 2, pts: 500, duration: 500, size: 20 },
    { trackId: 1, sampleIndex: 3, pts: 1500, duration: 500, size: 30, isSync: true }
  ], 1);

  assert.equal(Array.isArray(emptyPoints), true);
  assert.equal(emptyPoints.length, 0);
  assert.equal(boundedPoints.length, 1);
  assert.equal(invalidWindowPoints.length, 3);
  assert.equal(zeroDurationPoints[0].bitrate, 0);
  assert.equal(zeroDurationPoints[0].fps, 0);
  assert.equal(metricsModel.getMedian([]), 0);
  assert.equal(metricsModel.getMedian([1, 3]), 2);
  assert.equal(emptyMetrics.summary.averageBitrate, 0);
  assert.equal(emptyMetrics.summary.averageFps, 0);
  assert.equal(emptyMetrics.summary.minSampleSize, 0);
  assert.equal(emptyMetrics.summary.maxSampleSize, 0);
  assert.equal(emptyMetrics.frameTypeCounts.size, 0);
  assert.equal(emptyMetrics.movingAveragePoints.length, 0);
  assert.equal(emptyMetrics.topSizeRows.length, 0);
  assert.equal(fallbackMetrics.frameTypeCounts.get("AAC"), 2);
  assert.equal(fallbackMetrics.summary.averageKeyframeInterval, 0);
  assert.equal(positiveSyncMetrics.summary.averageKeyframeInterval, 1.5);
});

test("JSON viewer module renders bytes, hex dumps, and empty values", async () => {
  const loader = await createSourceModuleLoader();
  const jsonViewer = await loader.import("src/js/ui/json-viewer.js");

  assert.match(jsonViewer.renderJsonViewer({ bytes: [0, 15, 255], hexDump: ["00000000  00 0f ff  |...|"] }), /json-byte-array/);
  assert.match(jsonViewer.renderJsonViewer({ bytes: [0, 15, 255], hexDump: ["00000000  00 0f ff  |...|"] }), /json-hex-dump/);
  assert.equal(jsonViewer.isHexDumpField("hexDump", ["00"]), true);
  assert.equal(jsonViewer.isHexDumpField("hexDump", [0]), false);
  assert.match(jsonViewer.renderJsonViewer({ value: 9n }), /&quot;9&quot;|9/);
  assert.match(jsonViewer.renderJsonViewer([1, "two", null]), /json-inline-preview/);
  assert.match(jsonViewer.renderJsonViewer({ bytes: Array.from({ length: 2050 }, (_, index) => index % 256) }), /json-byte-truncation/);
  assert.match(jsonViewer.renderJsonViewer({ bytes: [256] }), /<span class="json-scalar number">256<\/span>/);
  assert.match(jsonViewer.renderJsonViewer(undefined), /json-empty/);
  assert.match(jsonViewer.renderJsonViewer({}), /json-empty/);
});

test("box detail model separates actual stsd fields, synthetic children, and derived convenience data", async () => {
  const loader = await createSourceModuleLoader();
  const boxDetailModel = await loader.import("src/js/ui/box-detail-model.js");
  const stsdNode = {
    type: "stsd",
    path: "/moov/trak/mdia/minf/stbl/stsd",
    offset: 100,
    size: 91,
    fields: {
      version: 0,
      flags: 0,
      entryCount: 1,
      entries: [
        {
          index: 1,
          format: "mp4a",
          size: 75,
          dataReferenceIndex: 1,
          channelCount: 2,
          codecDescriptor: "aac",
          codecConfig: { codecString: "mp4a.40.2" },
          esds: { objectTypeIndication: 64 },
          boxes: [
            { type: "esds", size: 39, fields: { audioConfig: { codecString: "mp4a.40.2" } } }
          ]
        }
      ]
    },
    children: []
  };

  const actualFields = boxDetailModel.getActualBoxFields(stsdNode);
  const derivedFields = boxDetailModel.getDerivedBoxFields(stsdNode);
  const syntheticChildren = boxDetailModel.getBoxNodeChildren(stsdNode);

  assert.deepEqual(JSON.parse(JSON.stringify(actualFields.entries[0].boxes[0])), {
    index: 1,
    type: "esds",
    size: 39,
    parsedFieldKeys: ["audioConfig"]
  });
  assert.equal(actualFields.entries[0].codecConfig, undefined);
  assert.equal(actualFields.entries[0].esds, undefined);
  assert.equal(derivedFields.sampleEntries[0].codecConfig.codecString, "mp4a.40.2");
  assert.equal(derivedFields.sampleEntries[0].esds.objectTypeIndication, 64);
  assert.equal(syntheticChildren[0].syntheticKind, "sample-entry");
  assert.equal(syntheticChildren[0].children[0].type, "esds");
  assert.match(boxDetailModel.formatBoxTypeLabel("stsd"), /stsd \(/);
  assert.match(boxDetailModel.getBoxTypeDescription("unknown-box"), /No built-in description|사용 가능한 기본 설명/);
});

test("box detail model covers synthetic and derived fallbacks", async () => {
  const loader = await createSourceModuleLoader();
  const boxDetailModel = await loader.import("src/js/ui/box-detail-model.js");
  const { setLanguage } = await loader.import("src/js/i18n/catalogs.js");
  const stsdWithoutDerived = {
    type: "stsd",
    path: "/stsd",
    offset: "",
    size: "bad",
    fields: {
      version: 0,
      flags: 0,
      entryCount: 1,
      entries: [
        {
          index: 1,
          format: "raw ",
          size: 16,
          boxes: null,
          dataReferenceIndex: 1
        }
      ]
    },
    children: [{ type: "free", path: "/stsd/free", offset: 20, size: 8, fields: {} }]
  };

  assert.deepEqual(JSON.parse(JSON.stringify(boxDetailModel.getBoxNodeChildren(null))), []);
  assert.deepEqual(JSON.parse(JSON.stringify(boxDetailModel.getSyntheticBoxChildren({ type: "free", fields: {} }))), []);
  assert.deepEqual(JSON.parse(JSON.stringify(boxDetailModel.getActualBoxFields(null))), {});
  assert.deepEqual(JSON.parse(JSON.stringify(boxDetailModel.createActualStsdFields({ version: 0, flags: 0, entryCount: 0, entries: null }))), {
    version: 0,
    flags: 0,
    entryCount: 0,
    entries: []
  });
  assert.deepEqual(JSON.parse(JSON.stringify(boxDetailModel.createActualSampleEntryFields(stsdWithoutDerived.fields.entries[0]))), {
    index: 1,
    format: "raw ",
    size: 16,
    boxes: [],
    dataReferenceIndex: 1
  });
  assert.equal(boxDetailModel.getDerivedBoxFields(stsdWithoutDerived), null);
  assert.equal(boxDetailModel.getDerivedBoxFields({ type: "free", fields: {} }), null);
  assert.equal(boxDetailModel.createSampleEntryDerivedFields({ index: 1, format: "raw " }), null);
  assert.match(boxDetailModel.formatBoxNodeSize(stsdWithoutDerived), /n\/a @/);

  const syntheticEntry = boxDetailModel.getSyntheticBoxChildren(stsdWithoutDerived)[0];
  assert.equal(boxDetailModel.getActualBoxFields(syntheticEntry).format, "raw ");
  assert.match(boxDetailModel.formatBoxNodeSize(syntheticEntry), /16 \(16 B\) · synthetic/);
  assert.match(boxDetailModel.formatBoxTypeLabel("not-a-box"), /Unknown or unregistered box type/);
  setLanguage("ko");
  assert.match(boxDetailModel.formatBoxTypeLabel("stsd"), /stsd \(/);
  setLanguage("en");
});

test("frame internals view renders actual codec blocks, accounting, and tooltips", async () => {
  const loader = await createSourceModuleLoader();
  const frameInternalsView = await loader.import("src/js/ui/frame-internals-view.js");
  const model = {
    kind: "video-grid",
    title: "AVC actual block structure",
    codecFamily: "AVC / H.264",
    frameType: "I",
    granularity: "partition-tree",
    source: "native-js-bitstream-parser",
    accuracy: "bitstream-syntax-decoded",
    unitName: "macroblock",
    unitWidth: 16,
    unitHeight: 16,
    mediaWidth: 16,
    mediaHeight: 32,
    encodedWidth: 32,
    encodedHeight: 16,
    displayRotationDegrees: -90,
    nominalColumns: 2,
    nominalRows: 1,
    nominalUnitCount: 2,
    partitionBlockCount: 3,
    leafBlockCount: 2,
    sampleBits: 8000,
    attributedBits: 6000,
    overheadBits: 2000,
    accountingKind: "cavlc-syntax-bit-length",
    cells: [{
      id: "mb-0-0",
      type: "I_4x4",
      pixelLeft: 0,
      pixelTop: 0,
      pixelRight: 16,
      pixelBottom: 16,
      displayPixelLeft: 0,
      displayPixelTop: 16,
      displayPixelRight: 16,
      displayPixelBottom: 32,
      blockWidth: 16,
      blockHeight: 16,
      codedBlockWidth: 16,
      codedBlockHeight: 16,
      depth: 1,
      partitionMode: "I_4x4",
      ownBits: 4000,
      subtreeBits: 6000,
      aggregatedDescendantCount: 0,
      color: { red: 1, green: 2, blue: 3 },
      intensity: 0.5
    }]
  };
  const videoHtml = frameInternalsView.renderVideoFrameInternals(model, {
    frameLabel: "T1 #1",
    frameOverlay: {
      enabled: true,
      imageUrl: "data:image/jpeg;base64,AA=="
    }
  });
  const presentation = frameInternalsView.createVideoFrameInternalsPresentation(model, {
    frameLabel: "T1 #1"
  });
  const pendingOverlayHtml = frameInternalsView.renderVideoFrameInternals({
    ...model,
    title: "Pending overlay",
    mediaWidth: 16,
    mediaHeight: 16,
    encodedWidth: 16,
    encodedHeight: 16,
    displayRotationDegrees: 0
  }, { frameOverlay: { enabled: true } });
  const audioHtml = frameInternalsView.renderAudioFrameInternals();
  const videoTooltipHtml = frameInternalsView.renderFrameInternalsTooltip(
    frameInternalsView.createVideoBlockTooltipPayload(model.cells[0], model)
  );

  assert.match(videoHtml, /block-cell block-cell-path i/);
  assert.equal(presentation.stats.find(([statName]) => statName === "frame")[2], "T1 #1");
  assert.equal(presentation.pathCount, 1);
  assert.match(presentation.blockPathsHtml, /d="M0 16H16V32H0Z"/);
  assert.match(videoHtml, /block-map-viewport/);
  assert.match(videoHtml, /<svg class="block-map" viewBox="0 0 16 32"/);
  assert.match(videoHtml, /<image class="block-frame-overlay" href="data:image\/jpeg;base64,AA=="/);
  assert.match(videoHtml, /d="M0 16H16V32H0Z"/);
  assert.match(videoHtml, /16x32 \(rotated -90 deg, encoded 32x16\)/);
  assert.match(videoHtml, /Block-attributed syntax bits/);
  assert.match(videoHtml, /6\.00 Kbits/);
  assert.match(videoHtml, /Unattributed \/ overhead bits/);
  assert.match(videoHtml, /2\.00 Kbits/);
  assert.match(videoHtml, /exact CAVLC RBSP syntax length/);
  assert.match(videoHtml, /Native JavaScript codec syntax parser/);
  assert.match(videoHtml, /no random, center-weighted, or pixel-derived block map/);
  assert.match(videoTooltipHtml, /Frame pixel range/);
  assert.match(videoTooltipHtml, /Display pixel range/);
  assert.match(videoTooltipHtml, /Own syntax bits/);
  assert.match(videoTooltipHtml, /4\.00 Kbits/);
  assert.match(videoTooltipHtml, /Attributed subtree bits/);
  assert.match(videoTooltipHtml, /Bit accounting method/);
  assert.match(videoTooltipHtml, /23\.4375/);
  assert.doesNotMatch(videoHtml + videoTooltipHtml, /Estimated bits|estimatedBits/);
  assert.match(pendingOverlayHtml, /Frame overlay pending/);
  assert.match(audioHtml, /Exact audio-band internals are unavailable/);
  assert.doesNotMatch(videoHtml, /data-inspection-tooltip=/);
  assert.equal(frameInternalsView.formatFrameTypeLabel("unknown"), "unknown");
});

test("frame internals view marks exact root-only coverage without fabricated child bits", async () => {
  const loader = await createSourceModuleLoader();
  const frameInternalsView = await loader.import("src/js/ui/frame-internals-view.js");
  const { setLanguage } = await loader.import("src/js/i18n/catalogs.js");
  const model = {
    kind: "video-grid",
    title: "AV1 actual root block grid",
    codecFamily: "AV1",
    frameType: "I",
    granularity: "root-units",
    source: "native-js-bitstream-parser",
    accuracy: "bitstream-root-units",
    unitName: "superblock",
    unitWidth: 64,
    unitHeight: 64,
    mediaWidth: 128,
    mediaHeight: 64,
    encodedWidth: 128,
    encodedHeight: 64,
    nominalColumns: 2,
    nominalRows: 1,
    nominalUnitCount: 2,
    partitionBlockCount: 2,
    leafBlockCount: 2,
    sampleBits: 1600,
    attributedBits: null,
    overheadBits: null,
    cells: [{
      id: "sb-0",
      type: "superblock",
      pixelLeft: 0,
      pixelTop: 0,
      pixelRight: 64,
      pixelBottom: 64,
      blockWidth: 64,
      blockHeight: 64,
      depth: 0,
      partitionMode: "root",
      ownBits: null,
      subtreeBits: null
    }]
  };
  const englishHtml = frameInternalsView.renderVideoFrameInternals(model);
  const tooltipHtml = frameInternalsView.renderFrameInternalsTooltip(
    frameInternalsView.createVideoBlockTooltipPayload(model.cells[0], model)
  );

  assert.match(englishHtml, /Root coding-unit size and frame grid come from codec configuration and frame syntax/);
  assert.match(englishHtml, /Only exact root coding units are available/);
  assert.match(englishHtml, /Block-attributed syntax bits<\/span><strong>n\/a/);
  assert.match(tooltipHtml, /Own syntax bits/);
  assert.match(tooltipHtml, /n\/a/);
  assert.doesNotMatch(englishHtml + tooltipHtml, /Estimated/);

  setLanguage("ko");
  const koreanHtml = frameInternalsView.renderVideoFrameInternals(model);
  assert.match(koreanHtml, /추정한 하위 partition은 추가하지 않습니다/);
  assert.match(koreanHtml, /block별 bit 귀속을 해석했다고 주장하지 않습니다/);
  assert.equal(frameInternalsView.formatFrameTypeLabel("mixed(I/P)"), "혼합(I/P)");
  setLanguage("en");
});

test("frame internals tooltip attributes escape values and omit unavailable rows", async () => {
  const loader = await createSourceModuleLoader();
  const frameInternalsView = await loader.import("src/js/ui/frame-internals-view.js");
  const tooltipAttributes = frameInternalsView.renderFrameInternalsTooltipAttributes({
    title: "<Cell>",
    rows: [["Visible", 0], ["Missing", undefined], null],
    note: ""
  });
  const tooltipHtml = frameInternalsView.renderFrameInternalsTooltip({
    title: "<Cell>",
    rows: [["", "skip"], ["Bits", 0], null],
    note: ""
  });

  assert.match(tooltipAttributes, /Visible/);
  assert.doesNotMatch(tooltipAttributes, /Missing/);
  assert.match(tooltipAttributes, /&lt;Cell&gt;/);
  assert.match(tooltipHtml, /&lt;Cell&gt;/);
  assert.match(tooltipHtml, /<strong>0<\/strong>/);
  assert.doesNotMatch(tooltipHtml, /tooltip-note/);
});

test("frame internals batches large heatmaps and spatially resolves hover cells", async () => {
  const loader = await createSourceModuleLoader();
  const frameInternalsView = await loader.import("src/js/ui/frame-internals-view.js");
  const frameInternalsMap = await loader.import("src/js/ui/frame-internals-map.js");
  const columnCount = 400;
  const rowCount = 250;
  const blockSize = 16;
  const cells = Array.from({ length: columnCount * rowCount }, (_, cellIndex) => {
    const columnIndex = cellIndex % columnCount;
    const rowIndex = Math.floor(cellIndex / columnCount);
    const globalPercentile = (cellIndex % 32) / 31;
    return {
      id: "cell-" + cellIndex,
      pixelLeft: columnIndex * blockSize,
      pixelTop: rowIndex * blockSize,
      pixelRight: (columnIndex + 1) * blockSize,
      pixelBottom: (rowIndex + 1) * blockSize,
      displayPixelLeft: columnIndex * blockSize,
      displayPixelTop: rowIndex * blockSize,
      displayPixelRight: (columnIndex + 1) * blockSize,
      displayPixelBottom: (rowIndex + 1) * blockSize,
      blockWidth: blockSize,
      blockHeight: blockSize,
      depth: 2,
      partitionMode: "split",
      ownBits: (100 + cellIndex) * 8,
      subtreeBits: (100 + cellIndex) * 8,
      attributedBitsPerPixel: (100 + cellIndex) * 8 / (blockSize * blockSize),
      globalPercentile,
      nominalUnits: 1,
      color: {
        red: Math.round(40 + globalPercentile * 180),
        green: Math.round(210 - globalPercentile * 120),
        blue: Math.round(180 - globalPercentile * 80)
      },
      intensity: 0.72 + globalPercentile * 0.28
    };
  });
  const model = {
    kind: "video-grid",
    title: "Large heatmap",
    codecFamily: "AVC / H.264",
    frameType: "P",
    unitName: "macroblock",
    unitWidth: blockSize,
    unitHeight: blockSize,
    mediaWidth: columnCount * blockSize,
    mediaHeight: rowCount * blockSize,
    encodedWidth: columnCount * blockSize,
    encodedHeight: rowCount * blockSize,
    displayRotationDegrees: 0,
    nominalColumns: columnCount,
    nominalRows: rowCount,
    nominalUnitCount: cells.length,
    displayColumns: columnCount,
    displayRows: rowCount,
    aggregation: 1,
    partitionBlockCount: cells.length,
    maxPartitionDepth: 2,
    partitionDepths: [{ depth: 0, count: cells.length }, { depth: 2, count: cells.length }],
    partitionModes: [{ mode: "split", count: cells.length }],
    sampleBits: 80000000,
    note: "performance fixture",
    colorScale: { mode: "global-track-percentile", sampleCount: 1, valueCount: cells.length },
    cells
  };

  const pathGroups = frameInternalsMap.buildFrameInternalsPathGroups(cells);
  const fallbackPathGroups = frameInternalsMap.buildFrameInternalsPathGroups([{
    pixelLeft: 5,
    pixelTop: 6,
    pixelRight: 15,
    pixelBottom: 16,
    displayPixelLeft: null,
    displayPixelTop: null,
    displayPixelRight: null,
    displayPixelBottom: null,
    globalPercentile: null,
    intensity: null,
    color: null
  }]);
  const spatialIndex = frameInternalsMap.createFrameInternalsSpatialIndex(model);
  const gapSpatialIndex = frameInternalsMap.createFrameInternalsSpatialIndex({
    mediaWidth: 20,
    mediaHeight: 20,
    cells: [{
      pixelLeft: 0,
      pixelTop: 0,
      pixelRight: 10,
      pixelBottom: 10
    }]
  });
  const targetCell = cells[4512];
  const targetBounds = frameInternalsMap.getFrameInternalsDisplayBounds(targetCell);
  const foundCell = frameInternalsMap.findFrameInternalsCell(
    spatialIndex,
    (targetBounds.left + targetBounds.right) / 2,
    (targetBounds.top + targetBounds.bottom) / 2
  );
  const videoHtml = frameInternalsView.renderVideoFrameInternals(model);
  const renderedPathCount = (videoHtml.match(/<path class="block-cell block-cell-path/g) || []).length;

  assert.ok(pathGroups.length <= 64);
  assert.ok(pathGroups.every((group) => group.cellCount <= frameInternalsMap.FRAME_INTERNALS_PATH_CELL_LIMIT));
  assert.equal(pathGroups.reduce((total, group) => total + group.cellCount, 0), cells.length);
  assert.equal(fallbackPathGroups[0].pathData, "M5 6H15V16H5Z");
  assert.equal(fallbackPathGroups[0].alpha, 0.75);
  assert.equal(foundCell.id, targetCell.id);
  assert.equal(frameInternalsMap.findFrameInternalsCell(spatialIndex, -1, 10), null);
  assert.equal(frameInternalsMap.findFrameInternalsCell(gapSpatialIndex, 15, 15), null);
  assert.equal(renderedPathCount, pathGroups.length);
  assert.match(videoHtml, /data-block-count="100000"/);
  assert.match(videoHtml, new RegExp('data-path-count="' + pathGroups.length + '"'));
  assert.doesNotMatch(videoHtml, /data-inspection-tooltip=/);
  assert.ok(videoHtml.length < 12000000, "batched heatmap markup should remain bounded");
});

test("analysis worker client falls back to direct core and preserves progress, scan, and cancel hooks", async () => {
  const loader = await createSourceModuleLoader();
  const { createAnalysisWorkerClient } = await loader.import("src/js/ui/analysis-worker-client.js");
  const progressEvents = [];
  let reader = null;
  const Core = {
    async analyzeFile(file, options) {
      reader = {
        cancelled: false,
        cancel() {
          this.cancelled = true;
        }
      };
      options.onReader(reader);
      options.onProgress("Parsing boxes", 50);
      return {
        file: { name: file.name, size: file.size, type: file.type },
        reader,
        topBoxes: [],
        allBoxes: [],
        tracks: [],
        sampleRows: [{ sampleIndex: 1, frameType: "unknown" }],
        warnings: []
      };
    },
    async scanFrameTypes(analysis, options) {
      options.onProgress("Scanning video samples", 100);
      analysis.sampleRows[0].frameType = "I";
    }
  };
  const client = createAnalysisWorkerClient({ Core });
  const file = new File([new Uint8Array([1, 2, 3])], "tiny.mp4", { type: "video/mp4" });
  const analysis = await client.analyzeFile(file, {
    onProgress(label, percent) {
      progressEvents.push([label, percent]);
    }
  });
  const scannedAnalysis = await client.scanFrameTypes(analysis, {
    onProgress(label, percent) {
      progressEvents.push([label, percent]);
    }
  });

  assert.equal(scannedAnalysis.sampleRows[0].frameType, "I");
  assert.deepEqual(progressEvents, [["Parsing boxes", 50], ["Scanning video samples", 100]]);
  client.cancel();
  assert.equal(reader.cancelled, true);
});

test("analysis worker client handles browser worker batches, partial updates, completion, and cancel", async () => {
  const workerInstances = [];
  class FakeWorker {
    constructor(url, options) {
      this.url = url;
      this.options = options;
      this.messages = [];
      this.onmessage = null;
      this.onerror = null;
      workerInstances.push(this);
    }

    postMessage(message) {
      this.messages.push(message);
    }

    emit(message) {
      this.onmessage({ data: message });
    }
  }

  const loader = new SourceModuleLoader({
    rootDirectory: path.resolve(__dirname, ".."),
    globals: {
      Worker: FakeWorker,
      window: {
        MP4AnalyzerWorkerModuleUrl: "chunked/assets/analyzer-worker.mjs"
      }
    }
  });
  const { createAnalysisWorkerClient } = await loader.import("src/js/ui/analysis-worker-client.js");
  const progressEvents = [];
  const partialAnalyses = [];
  const client = createAnalysisWorkerClient({ Core: null });
  const file = new File([new Uint8Array([1, 2, 3])], "tiny.mp4", { type: "video/mp4" });
  const analysisPromise = client.analyzeFile(file, {
    onProgress(label, percent) {
      progressEvents.push([label, percent]);
    },
    onPartialAnalysis(analysis) {
      partialAnalyses.push(analysis.sampleRows.map((row) => row && row.sampleIndex));
    }
  });
  const worker = workerInstances[0];

  assert.equal(worker.url, "chunked/assets/analyzer-worker.mjs");
  assert.equal(worker.options.type, "module");
  assert.equal(worker.messages[0].type, "analyze");
  assert.equal(worker.messages[0].requestId, 1);
  assert.equal(worker.messages[0].file.name, "tiny.mp4");
  client.cancel();
  assert.equal(worker.messages[1].type, "cancel");
  assert.equal(worker.messages[1].requestId, 1);

  worker.emit({ type: "progress", requestId: 1, label: "Parsing boxes", percent: 45 });
  worker.emit({ type: "analysisStart", requestId: 1, analysis: { file: { name: "tiny.mp4" } }, sampleRowCount: 3 });
  worker.emit({ type: "sampleRows", requestId: 1, startIndex: 2, rows: [{ sampleIndex: 3 }] });
  worker.emit({ type: "sampleRows", requestId: 1, startIndex: 0, rows: [{ sampleIndex: 1 }, { sampleIndex: 2 }] });
  worker.emit({ type: "analysisComplete", requestId: 1, kind: "partial" });
  worker.emit({ type: "analysisComplete", requestId: 1, kind: "done" });

  const analysis = await analysisPromise;
  assert.deepEqual(progressEvents, [["Parsing boxes", 45]]);
  assert.deepEqual(JSON.parse(JSON.stringify(partialAnalyses)), [[1, 2, 3]]);
  assert.deepEqual(JSON.parse(JSON.stringify(analysis.sampleRows.map((row) => row.sampleIndex))), [1, 2, 3]);
});

test("analysis worker client uses inline worker source and rejects worker errors", async () => {
  const createdWorkerUrls = [];
  const revokedWorkerUrls = [];
  const workerInstances = [];
  class FakeWorker {
    constructor(url) {
      this.url = url;
      this.messages = [];
      this.onmessage = null;
      this.onerror = null;
      workerInstances.push(this);
    }

    postMessage(message) {
      this.messages.push(message);
    }
  }

  const loader = new SourceModuleLoader({
    rootDirectory: path.resolve(__dirname, ".."),
    globals: {
      Blob,
      Worker: FakeWorker,
      URL: {
        createObjectURL(blob) {
          createdWorkerUrls.push(blob.type);
          return "blob:worker-source";
        },
        revokeObjectURL(url) {
          revokedWorkerUrls.push(url);
        }
      },
      window: {
        MP4AnalyzerWorkerSource: "self.onmessage = function () {};"
      }
    }
  });
  const { createAnalysisWorkerClient } = await loader.import("src/js/ui/analysis-worker-client.js");
  const client = createAnalysisWorkerClient({ Core: null });
  const promise = client.scanFrameTypes({}, {});
  const worker = workerInstances[0];

  assert.equal(worker.url, "blob:worker-source");
  assert.deepEqual(createdWorkerUrls, ["text/javascript"]);
  assert.deepEqual(revokedWorkerUrls, ["blob:worker-source"]);
  assert.equal(worker.messages[0].type, "scanFrameTypes");
  assert.equal(worker.messages[0].requestId, 1);

  worker.onerror({ message: "boom" });
  await assert.rejects(promise, /boom/);
});

test("remote loader chooses HTTP range streaming only when verified and falls back to full download", async () => {
  const calls = [];
  const makeHeaders = (values) => ({
    get(name) {
      return values[String(name).toLowerCase()] || "";
    }
  });
  const loader = new SourceModuleLoader({
    rootDirectory: path.resolve(__dirname, ".."),
    globals: {
      fetch: async (url, options = {}) => {
        const method = options.method || "GET";
        const range = options.headers && options.headers.Range || "";
        calls.push({ url, method, range });
        if (method === "HEAD") {
          return {
            ok: true,
            status: 200,
            headers: makeHeaders({
              "content-length": "12",
              "content-type": "video/mp4",
              "accept-ranges": "bytes"
            })
          };
        }
        if (range) {
          return {
            status: url.includes("no-range") ? 200 : 206,
            headers: makeHeaders({
              "content-range": "bytes 0-0/12",
              "content-type": "video/mp4"
            }),
            async arrayBuffer() {
              return new Uint8Array([0]).buffer;
            }
          };
        }
        return {
          ok: true,
          status: 200,
          headers: makeHeaders({
            "content-length": "3",
            "content-type": "video/mp4"
          }),
          async blob() {
            return new Blob([new Uint8Array([1, 2, 3])], { type: "video/mp4" });
          }
        };
      }
    }
  });
  const remoteLoader = await loader.import("src/js/ui/remote-loader.js");

  const streamingPlan = await remoteLoader.probeRemoteMediaResource("https://media.test/video.mp4");
  assert.equal(streamingPlan.canStream, true);
  assert.equal(streamingPlan.resource.size, 12);
  assert.equal(streamingPlan.resource.rangeSupported, true);
  const explicitStreamingPlan = await remoteLoader.probeRemoteMediaResource("https://media.test/video.mp4", {
    name: "explicit-name.mov",
    type: "video/quicktime"
  });
  assert.equal(explicitStreamingPlan.resource.name, "explicit-name.mov");
  assert.equal(explicitStreamingPlan.resource.type, "video/quicktime");

  const fallbackPlan = await remoteLoader.probeRemoteMediaResource("https://media.test/no-range.mp4");
  assert.equal(fallbackPlan.canStream, false);
  assert.match(fallbackPlan.fallbackReason, /206/);
  const downloadedFile = await remoteLoader.downloadRemoteMediaFile(fallbackPlan.fallback.url, fallbackPlan.fallback);
  assert.equal(downloadedFile.name, "no-range.mp4");
  assert.equal(downloadedFile.size, 3);
  assert.throws(() => remoteLoader.normalizeRemoteMediaUrl("file:///tmp/video.mp4"), /Only http/);
  assert.ok(calls.some((call) => call.range === "bytes=0-0"));
});

test("remote loader preserves metadata overrides and blob type fallbacks", async () => {
  const makeHeaders = (values) => ({
    get(name) {
      return values[String(name).toLowerCase()] || "";
    }
  });
  const loader = new SourceModuleLoader({
    rootDirectory: path.resolve(__dirname, ".."),
    globals: {
      fetch: async (url, options = {}) => {
        if (options.method === "HEAD") {
          return {
            ok: true,
            status: 200,
            headers: makeHeaders({
              "content-disposition": "attachment; filename=\"head-name.ogg\"",
              "content-length": "6"
            })
          };
        }
        if (options.headers && options.headers.Range) {
          return {
            status: 416,
            headers: makeHeaders({}),
            async arrayBuffer() {
              return new ArrayBuffer(0);
            }
          };
        }
        return {
          ok: true,
          status: 200,
          headers: makeHeaders({}),
          async blob() {
            return new Blob([new Uint8Array([1, 2, 3, 4, 5, 6])], { type: "audio/ogg" });
          }
        };
      }
    }
  });
  const remoteLoader = await loader.import("src/js/ui/remote-loader.js");

  const fallbackPlan = await remoteLoader.probeRemoteMediaResource("https://media.test/path/original.ogg");
  assert.equal(fallbackPlan.canStream, false);
  assert.equal(fallbackPlan.fallback.name, "head-name.ogg");
  assert.equal(fallbackPlan.fallback.size, 6);
  const downloadedFile = await remoteLoader.downloadRemoteMediaFile("https://media.test/path/original.ogg", {
    name: "metadata-name.ogg"
  });
  assert.equal(downloadedFile.name, "metadata-name.ogg");
  assert.equal(downloadedFile.type, "audio/ogg");
  assert.equal(downloadedFile.size, 6);
});

test("remote loader handles streamed downloads, filenames, aborts, and non-OK responses", async () => {
  const progressEvents = [];
  const makeHeaders = (values) => ({
    get(name) {
      return values[String(name).toLowerCase()] || "";
    }
  });
  const loader = new SourceModuleLoader({
    rootDirectory: path.resolve(__dirname, ".."),
    globals: {
      fetch: async (url) => {
        if (url.includes("abort")) {
          const error = new Error("aborted");
          error.name = "AbortError";
          throw error;
        }
        if (url.includes("missing")) {
          return {
            ok: false,
            status: 404,
            statusText: "Not Found",
            headers: makeHeaders({})
          };
        }
        return {
          ok: true,
          status: 200,
          headers: makeHeaders({
            "content-disposition": "attachment; filename*=UTF-8''clip%20one.mp4",
            "content-length": "5",
            "content-type": "video/mp4"
          }),
          body: {
            getReader() {
              const chunks = [new Uint8Array([1, 2]), new Uint8Array([3, 4, 5])];
              return {
                async read() {
                  const value = chunks.shift();
                  return value ? { done: false, value } : { done: true };
                }
              };
            }
          }
        };
      }
    }
  });
  const remoteLoader = await loader.import("src/js/ui/remote-loader.js");

  assert.equal(remoteLoader.normalizeRemoteMediaUrl("./movie.mp4", "https://media.test/path/page.html"), "https://media.test/path/movie.mp4");
  assert.equal(remoteLoader.parseContentRangeSize("bytes 0-99/12345"), 12345);
  assert.equal(remoteLoader.parseContentRangeSize("bytes 0-99/*"), 0);
  assert.equal(remoteLoader.inferRemoteFileName("https://media.test/fallback.mp4", "attachment; filename=\"plain.mp4\""), "plain.mp4");
  assert.equal(remoteLoader.inferRemoteFileName("https://media.test/fallback.mp4", "attachment; filename*=UTF-8''clip%20one.mp4"), "clip one.mp4");

  await assert.rejects(remoteLoader.probeRemoteMediaResource("https://media.test/abort.mp4"), /cancelled/);
  await assert.rejects(remoteLoader.downloadRemoteMediaFile("https://media.test/missing.mp4"), /Download failed: 404 Not Found/);
  const downloadedFile = await remoteLoader.downloadRemoteMediaFile("https://media.test/video.mp4", {}, {
    onProgress(loadedBytes, totalSize) {
      progressEvents.push([loadedBytes, totalSize]);
    }
  });

  assert.equal(downloadedFile.name, "clip one.mp4");
  assert.equal(downloadedFile.type, "video/mp4");
  assert.equal(downloadedFile.size, 5);
  assert.deepEqual(progressEvents, [[2, 5], [5, 5]]);
});

test("remote loader uses range metadata when HEAD is weak and falls back to blob downloads without streams", async () => {
  const calls = [];
  const makeHeaders = (values) => ({
    get(name) {
      return values[String(name).toLowerCase()] || "";
    }
  });
  const loader = new SourceModuleLoader({
    rootDirectory: path.resolve(__dirname, ".."),
    globals: {
      fetch: async (url, options = {}) => {
        const method = options.method || "GET";
        const range = options.headers && options.headers.Range || "";
        calls.push({ url, method, range });
        if (url.includes("range-abort") && range) {
          const error = new Error("aborted");
          error.name = "AbortError";
          throw error;
        }
        if (method === "HEAD") {
          return {
            ok: false,
            status: 405,
            statusText: "Method Not Allowed",
            headers: makeHeaders({})
          };
        }
        if (range) {
          return {
            status: 206,
            headers: makeHeaders({
              "content-range": "bytes 0-0/1234",
              "content-type": "video/webm"
            }),
            async arrayBuffer() {
              return new Uint8Array([0]).buffer;
            }
          };
        }
        return {
          ok: true,
          status: 200,
          headers: makeHeaders({
            "content-length": "4",
            "content-type": "audio/mpeg"
          }),
          async blob() {
            return new Blob([new Uint8Array([1, 2, 3, 4])], { type: "audio/mpeg" });
          }
        };
      }
    }
  });
  const remoteLoader = await loader.import("src/js/ui/remote-loader.js");

  const streamingPlan = await remoteLoader.probeRemoteMediaResource("https://media.test/folder/movie.webm");
  assert.equal(streamingPlan.canStream, true);
  assert.equal(streamingPlan.resource.size, 1234);
  assert.equal(streamingPlan.resource.type, "video/webm");
  assert.equal(streamingPlan.resource.name, "movie.webm");

  await assert.rejects(remoteLoader.probeRemoteMediaResource("https://media.test/range-abort.webm"), /cancelled/);
  const progressEvents = [];
  const downloadedFile = await remoteLoader.downloadRemoteMediaFile("https://media.test/no-stream.mp3", {}, {
    onProgress(loadedBytes, totalSize) {
      progressEvents.push([loadedBytes, totalSize]);
    }
  });
  assert.equal(downloadedFile.name, "no-stream.mp3");
  assert.equal(downloadedFile.type, "audio/mpeg");
  assert.deepEqual(progressEvents, [[4, 4]]);
  assert.ok(calls.some((call) => call.method === "HEAD" && call.url.endsWith("movie.webm")));
});

test("remote loader covers empty input, fetch failures, and stream cancellation", async () => {
  const makeHeaders = (values) => ({
    get(name) {
      return values[String(name).toLowerCase()] || "";
    }
  });
  const abortedSignal = { aborted: true };
  const loader = new SourceModuleLoader({
    rootDirectory: path.resolve(__dirname, ".."),
    globals: {
      fetch: async (url, options = {}) => {
        if (options.method === "HEAD") throw new Error("network down");
        if (options.headers && options.headers.Range) throw "range blocked";
        return {
          ok: true,
          status: 200,
          headers: makeHeaders({
            "content-length": "8",
            "content-type": "video/mp4"
          }),
          body: {
            getReader() {
              return {
                async read() {
                  return { done: false, value: new Uint8Array([1, 2]) };
                }
              };
            }
          }
        };
      }
    }
  });
  const remoteLoader = await loader.import("src/js/ui/remote-loader.js");

  assert.throws(() => remoteLoader.normalizeRemoteMediaUrl("   "), /empty/);
  const fallbackPlan = await remoteLoader.probeRemoteMediaResource("https://media.test/fallback.mp4");
  assert.equal(fallbackPlan.canStream, false);
  assert.match(fallbackPlan.fallbackReason, /Range probe failed: range blocked/);
  await assert.rejects(
    () => remoteLoader.downloadRemoteMediaFile("https://media.test/fallback.mp4", {}, { signal: abortedSignal }),
    /cancelled/
  );
});

test("source HTML has required controls, tabs, and no external runtime assets after build", () => {
  const rootDirectory = path.resolve(__dirname, "..");
  const sourceHtml = fs.readFileSync(path.join(rootDirectory, "src", "index.html"), "utf8");
  const sourceCss = fs.readFileSync(path.join(rootDirectory, "src", "styles.css"), "utf8");
  const sourceUi = fs.readFileSync(path.join(rootDirectory, "src", "js", "ui", "analyzer-ui.js"), "utf8");
  const sourceI18n = fs.readFileSync(path.join(rootDirectory, "src", "js", "i18n", "catalogs.js"), "utf8");
  const sourceBoxDetailModel = fs.readFileSync(path.join(rootDirectory, "src", "js", "ui", "box-detail-model.js"), "utf8");
  const sourceFrameInternalsView = fs.readFileSync(path.join(rootDirectory, "src", "js", "ui", "frame-internals-view.js"), "utf8");
  const sourceFrameInternalsMap = fs.readFileSync(path.join(rootDirectory, "src", "js", "ui", "frame-internals-map.js"), "utf8");
  const sourceJsonViewer = fs.readFileSync(path.join(rootDirectory, "src", "js", "ui", "json-viewer.js"), "utf8");
  const sourceMediaRowModel = fs.readFileSync(path.join(rootDirectory, "src", "js", "ui", "media-row-model.js"), "utf8");
  const sourceMetricsModel = fs.readFileSync(path.join(rootDirectory, "src", "js", "ui", "metrics-model.js"), "utf8");
  const sourceMediaSource = fs.readFileSync(path.join(rootDirectory, "src", "js", "ui", "media-source.js"), "utf8");
  const sourceWorker = fs.readFileSync(path.join(rootDirectory, "src", "js", "worker", "analyzer-worker.js"), "utf8");
  const sourceFrameInternalsWorker = fs.readFileSync(path.join(rootDirectory, "src", "js", "worker", "frame-internals-worker.js"), "utf8");
  const builtHtml = fs.readFileSync(path.join(rootDirectory, "mp4-analyzer.html"), "utf8");
  const builtMinifiedHtml = fs.readFileSync(path.join(rootDirectory, "index.html"), "utf8");
  const chunkedHtmlPath = path.join(rootDirectory, "chunked", "index.html");
  const jsonValueCssBlock = sourceCss.match(/\.json-value\s*\{[^}]*\}/)?.[0] || "";
  const renderFrameInternalsSource = sourceUi.slice(
    sourceUi.indexOf("function renderFrameInternals()"),
    sourceUi.indexOf("function buildSelectedFrameInternalsModel()")
  );

  for (const id of [
    "fileInput", "languageSelect", "sampleField", "sampleSelect", "openButton", "openUrlButton",
    "scanButton", "cancelButton", "exportJsonButton", "exportCsvButton",
    "mediaPreviewBar", "playbackRateControl", "playbackRateLabel", "playbackRateSlider",
    "playbackRateNumberInput", "summaryPanel", "summaryBody", "boxesPanel", "tracksPanel",
    "tracksBody", "framesPanel", "metricsPanel", "fragmentsPanel", "warningsPanel",
    "warningsBody",
    "frameGraphButton", "frameTableButton", "autoPlaybackSynchronizationToggle",
    "fragmentPlaybackSynchronizationToggle", "fragmentCountText", "fragmentsBody",
    "frameInternalsPanel", "frameInternalsOverlayToggle", "frameInternalsBody", "frameInternalsLayout",
    "frameInternalsSummary", "frameInternalsResultTitle", "frameInternalsFrameType",
    "frameInternalsAccuracyNote", "frameInternalsStructureBudgetNote", "frameInternalsStats",
    "frameInternalsMapComponent", "frameInternalsMapViewport", "frameInternalsMap",
    "frameInternalsFrameOverlayLayer", "frameInternalsBlockLayer", "frameInternalsMapMessage",
    "frameInternalsOverlayStatus", "frameInternalsLimitationsNote", "frameInternalsTooltip",
    "frameWrap", "frameHeader", "frameScroller", "graphScroller",
    "remoteUrlModal", "remoteUrlForm", "remoteUrlInput", "remoteUrlSubmitButton"
  ]) {
    assert.match(sourceHtml, new RegExp("id=\"" + id + "\""));
  }

  for (const tabName of ["summary", "boxes", "tracks", "frames", "metrics", "fragments", "warnings"]) {
    assert.match(sourceHtml, new RegExp("data-tab=\"" + tabName + "\""));
  }

  assert.match(sourceHtml, /<title>Standalone Web Media Analyzer<\/title>/);
  assert.match(sourceHtml, /data-i18n="frameInternals\.badge">Actual coded blocks<\/span>/);
  assert.equal(Array.from(sourceHtml.matchAll(/data-frame-internals-stat-value="([^"]+)"/g)).length, 18);
  assert.match(sourceHtml, /id="frameInternalsMapViewport"[^>]*tabindex="-1"[^>]*aria-disabled="true"/);
  assert.doesNotMatch(sourceHtml + sourceUi + sourceI18n, /Reading and parsing the selected frame bitstream/);
  assert.match(sourceHtml, /WebM, AV1, MP3/);
  assert.match(sourceHtml, /id="mediaPreviewBar" class="media-preview-bar empty"/);
  assert.doesNotMatch(sourceHtml, /id="mediaPreviewBar"[^>]*hidden/);
  assert.match(sourceHtml, /class="media-preview-stage"/);
  assert.match(sourceHtml, /class="media-preview-skeleton"/);
  assert.match(sourceHtml, /id="mediaPreviewStatus" data-i18n="preview\.placeholderTitle"/);
  assert.deepEqual(
    Array.from(sourceHtml.matchAll(/class="playback-rate-preset(?: active)?" data-playback-rate="([^"]+)"/g), (match) => Number(match[1])),
    [0.25, 0.5, 1, 1.25, 1.5, 2]
  );
  assert.match(sourceHtml, /id="playbackRateSlider" type="range" min="0\.1" max="5" step="0\.01" value="1"/);
  assert.match(sourceHtml, /id="playbackRateNumberInput" type="number" min="0\.1" max="5" step="0\.01" value="1" inputmode="decimal"/);
  assert.match(sourceHtml, /id="playbackRateLabel" data-i18n="preview\.playbackRate">Playback speed<\/span>/);
  assert.match(sourceUi, /renderMediaPreviewPlaceholder/);
  assert.match(sourceUi, /mediaPreviewBar\.classList\.remove\("empty"\)/);
  assert.match(sourceUi, /mediaPreviewBar\.classList\.add\("empty"\)/);
  assert.match(sourceUi, /from "\.\/playback-rate\.js"/);
  assert.match(sourceUi, /filePreview\.addEventListener\("ratechange", synchronizePlaybackRateFromMedia\)/);
  assert.match(sourceUi, /playbackRateSlider\.addEventListener\("input"/);
  assert.match(sourceUi, /playbackRateNumberInput\.addEventListener\("input", synchronizePlaybackRateFromNumberInput\)/);
  assert.match(sourceUi, /playbackRateNumberInput\.addEventListener\("change", commitPlaybackRateFromNumberInput\)/);
  assert.match(sourceUi, /playbackRateNumberInput\.addEventListener\("keydown", adjustPlaybackRateFromNumberInputKey\)/);
  assert.match(sourceUi, /defaultPlaybackRate = state\.playbackRate/);
  assert.match(sourceUi, /setPlaybackRateControlsEnabled\(true\)/);
  assert.doesNotMatch(sourceUi, /mediaPreviewBar\.hidden\s*=\s*false/);
  assert.match(sourceCss, /\.media-preview-bar\s*\{[\s\S]*?min-height:\s*184px;/);
  assert.match(sourceCss, /\.media-preview-stage\s*\{[\s\S]*?aspect-ratio:\s*16\s*\/\s*9;/);
  assert.match(sourceCss, /\.media-preview-skeleton\s*\{[\s\S]*?position:\s*absolute;/);
  assert.match(sourceCss, /\.media-preview-bar:not\(\.empty\) \.media-preview-skeleton\s*\{[\s\S]*?display:\s*none;/);
  assert.match(sourceCss, /\.playback-rate-presets\s*\{[\s\S]*?grid-template-columns:\s*repeat\(6,\s*minmax\(0,\s*1fr\)\);/);
  assert.match(sourceCss, /\.playback-rate-slider-row input\[type="range"\]\s*\{[\s\S]*?accent-color:\s*var\(--accent\);/);
  assert.match(sourceCss, /\.playback-rate-number-field input\s*\{[\s\S]*?font-variant-numeric:\s*tabular-nums;/);
  assert.match(sourceCss, /@media\s*\(max-width:\s*700px\)\s*\{[\s\S]*?\.playback-rate-presets\s*\{\s*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\);/);
  assert.match(sourceHtml, /id="autoPlaybackSynchronizationToggle" type="checkbox" checked/);
  assert.match(sourceUi, /requestVideoFrameCallback/);
  assert.match(sourceUi, /requestAnimationFrame\(runPlaybackSynchronizationStep\)/);
  assert.match(sourceUi, /shouldUseVideoFramePlaybackSynchronization/);
  assert.match(sourceUi, /hasVideoPlaybackSynchronizationTrack/);
  assert.match(sourceUi, /getPlaybackSynchronizationDebug/);
  assert.match(sourceUi, /synchronizeFragmentSelectionToPlayback/);
  assert.match(sourceUi, /handleFragmentRowPointerActivation/);
  assert.match(sourceUi, /from "\.\/json-viewer\.js"/);
  assert.match(sourceUi, /from "\.\/box-detail-model\.js"/);
  assert.match(sourceBoxDetailModel, /getSyntheticBoxChildren/);
  assert.match(sourceBoxDetailModel, /getDerivedBoxFields/);
  assert.match(sourceBoxDetailModel, /SAMPLE_ENTRY_DERIVED_FIELD_NAMES/);
  assert.doesNotMatch(sourceUi, /function getSyntheticBoxChildren/);
  assert.doesNotMatch(sourceUi, /SAMPLE_ENTRY_DERIVED_FIELD_NAMES/);
  assert.match(sourceJsonViewer, /renderJsonViewer/);
  assert.match(sourceJsonViewer, /renderJsonHexDump/);
  assert.match(sourceJsonViewer, /isHexDumpField/);
  assert.match(sourceJsonViewer, /JSON_BYTE_PREVIEW_COUNT/);
  assert.match(sourceUi, /from "\.\/media-row-model\.js"/);
  assert.match(sourceUi, /from "\.\/metrics-model\.js"/);
  assert.match(sourceMediaRowModel, /compareRowsByPresentationTime/);
  assert.match(sourceMediaRowModel, /getRowDecodeTimeSeconds/);
  assert.match(sourceMetricsModel, /buildTrackMetrics/);
  assert.match(sourceMetricsModel, /buildMovingAveragePoints/);
  assert.match(sourceUi, /handleMetricChartPointerMove/);
  assert.match(sourceUi, /updateMetricChartOverlay/);
  assert.match(sourceUi, /updateMetricChartOverlaysAtTime/);
  assert.match(sourceUi, /updateMetricChartOverlaysAtTime\(nearestPoint \? nearestPoint\.time : NaN\)/);
  assert.match(sourceUi, /updateMetricPlaybackCursors/);
  assert.match(sourceUi, /readMetricChartPoints/);
  assert.match(sourceUi, /hasMetricPlaybackCursorTargets/);
  assert.match(sourceUi, /METRIC_PLAYBACK_CURSOR_INTERVAL_MS\s*=\s*100/);
  assert.match(sourceUi, /startMetricPlaybackCursorLoop/);
  assert.match(sourceUi, /stopMetricPlaybackCursorLoop/);
  assert.match(sourceUi, /shouldRunMetricPlaybackCursorLoop/);
  assert.match(sourceUi, /setInterval\(\(\)\s*=>\s*\{/);
  assert.match(sourceUi, /METRIC_PLAYBACK_CURSOR_INTERVAL_MS\)/);
  assert.match(sourceUi, /findNearestMetricChartPoint/);
  assert.match(sourceUi, /hideMetricChartOverlay/);
  assert.match(sourceUi, /metricsBody\.addEventListener\("pointermove"/);
  assert.match(sourceUi, /data-chart-points=/);
  assert.match(sourceUi, /metric-chart-hover/);
  assert.match(sourceUi, /metric-chart-playback/);
  assert.match(sourceCss, /\.metric-chart-hover,\s*\.metric-chart-playback\s*\{/);
  assert.match(sourceCss, /\.metric-chart-playback\[hidden\]/);
  assert.match(sourceCss, /\.metric-hover-line\.vertical,\s*\.metric-playback-line\.vertical\s*\{/);
  assert.match(sourceCss, /\.metric-playback-line\.vertical\s*\{/);
  assert.match(sourceCss, /\.metric-hover-point,\s*\.metric-playback-point\s*\{/);
  assert.match(sourceCss, /\.metric-playback-point\s*\{/);
  assert.match(sourceCss, /\.metric-hover-tooltip,\s*\.metric-playback-tooltip\s*\{/);
  assert.match(sourceCss, /\.metric-playback-tooltip\s*\{/);
  assert.match(sourceCss, /\.json-view\s*\{[\s\S]*?overflow-x:\s*auto;/);
  assert.match(sourceCss, /\.json-entry\s*\{[\s\S]*?min-width:\s*max\(100%,\s*560px\);/);
  assert.match(sourceCss, /\.json-entry\s*\{[\s\S]*?grid-template-columns:\s*minmax\(124px,\s*180px\)\s*minmax\(240px,\s*1fr\);/);
  assert.match(jsonValueCssBlock, /overflow-wrap:\s*break-word;/);
  assert.doesNotMatch(jsonValueCssBlock, /overflow-wrap:\s*anywhere;/);
  assert.match(sourceUi, /createRecyclerView/);
  assert.match(sourceUi, /buildFrameInternalsModel/);
  assert.doesNotMatch(sourceUi, /buildFrameInternalsColorScale|frameInternalsColorScaleCache/);
  assert.match(sourceUi, /frameInternalsAnalysisCache/);
  assert.match(sourceUi, /frameInternalsAnalysisEpoch/);
  assert.match(sourceUi, /frameInternalsAnalysisPaused/);
  assert.match(sourceUi, /mainAnalysisBusy/);
  assert.match(sourceUi, /invalidateFrameInternalsAnalysisRequests\(\)/);
  assert.match(sourceUi, /pauseFrameInternalsAnalysis\(\)/);
  assert.match(sourceUi, /resumeFrameInternalsAnalysis\(\)/);
  assert.match(sourceUi, /updateCancelButtonState\(\)/);
  assert.match(sourceUi, /cancelButton\.disabled = !state\.mainAnalysisBusy && state\.frameInternalsAnalysisRequests\.size === 0/);
  assert.match(sourceUi, /pauseFrameInternalsAnalysis\(\);[\s\S]{0,120}analysisWorkerClient\.cancel\(\);[\s\S]{0,120}renderFrameInternals\(\);/);
  assert.match(sourceUi, /state\.frameInternalsAnalysisEpoch !== requestEpoch/);
  assert.match(sourceUi, /createFrameInternalsCacheValue/);
  assert.match(sourceUi, /analyzeFrameInternals/);
  assert.match(sourceUi, /FRAME_INTERNALS_PREFETCH_COUNT\s*=\s*8/);
  assert.match(sourceUi, /FRAME_INTERNALS_ANALYSIS_CACHE_LIMIT\s*=\s*32/);
  assert.match(sourceUi, /FRAME_INTERNALS_ANALYSIS_CACHE_RECORD_LIMIT\s*=\s*200_000/);
  assert.match(sourceUi, /getFrameInternalsStructureRecordCount/);
  assert.match(sourceUi, /frameInternalsAnalysisRequests\.size\s*>=\s*FRAME_INTERNALS_PREFETCH_COUNT/);
  assert.match(sourceUi, /selectedFrameNeedsRequest/);
  assert.match(sourceUi, /hasActiveFrameInternalsMapInteraction/);
  assert.match(sourceUi, /frameInternalsRenderPending/);
  assert.match(sourceUi, /frameInternalsModelKey/);
  assert.doesNotMatch(renderFrameInternalsSource, /frameInternalsBody\.innerHTML/);
  assert.match(renderFrameInternalsSource, /model\.kind === "loading"[\s\S]{0,240}pendingFrameKey[\s\S]{0,120}return;/);
  assert.match(sourceUi, /updateVideoFrameInternalsDom/);
  assert.match(sourceUi, /frameInternalsBlockLayer\.innerHTML = presentation\.blockPathsHtml/);
  assert.match(sourceUi, /viewport\.tabIndex = 0;[\s\S]{0,100}viewport\.removeAttribute\("aria-disabled"\)/);
  assert.match(sourceUi, /createFrameInternalsSpatialIndex/);
  assert.match(sourceUi, /findFrameInternalsCell/);
  assert.match(sourceUi, /captureFrameInternalsFrameOverlay/);
  assert.match(sourceUi, /prepareMediaPreviewFrame/);
  assert.match(sourceUi, /previewFrame\.status !== "ready"/);
  assert.match(sourceUi, /loadedmetadata[\s\S]{0,180}scheduleFrameInternalsFrameOverlayCapture/);
  assert.match(sourceUi, /frameInternalsFrameOverlayEnabled = Boolean\([\s\S]{0,140}frameInternalsOverlayToggle\.checked/);
  assert.match(sourceUi, /updateFrameInternalsFrameOverlayDom/);
  assert.match(sourceUi, /frameInternalsFrameOverlayEnabled/);
  assert.match(sourceUi, /renderFrameInternals/);
  assert.match(sourceUi, /state\.analysis && state\.activeTab !== "frames"/);
  assert.match(sourceUi, /from "\.\/frame-internals-view\.js"/);
  assert.match(sourceFrameInternalsView, /renderFrameInternalsTooltipAttributes/);
  assert.match(sourceFrameInternalsView, /renderVideoFrameInternals/);
  assert.match(sourceFrameInternalsView, /renderAudioFrameInternals/);
  assert.match(sourceFrameInternalsView, /ownBits/);
  assert.match(sourceFrameInternalsView, /subtreeBits/);
  assert.match(sourceFrameInternalsView, /attributedBitsPerPixel/);
  assert.doesNotMatch(sourceFrameInternalsView, /estimatedBits|normalizedBitDensity|formatBytes|estimatedBytes|B\/px/);
  assert.doesNotMatch(sourceUi, /function renderVideoFrameInternals/);
  assert.match(sourceUi, /handleFrameInternalsTooltipPointerOver/);
  assert.match(sourceUi, /handleFrameInternalsMapWheel/);
  assert.match(sourceUi, /handleFrameInternalsMapPointerDown/);
  assert.match(sourceUi, /function getFrameInternalsMapInteractionSurface\(\)/);
  assert.match(sourceUi, /interactionSurface\.setPointerCapture\(event\.pointerId\)/);
  assert.match(sourceUi, /function getCurrentFrameInternalsMapViewport\(\)/);
  assert.match(sourceUi, /updateFrameInternalsMapPinch\(event, viewport\)/);
  assert.match(sourceUi, /viewport\.classList\.toggle\("dragging", Boolean\(state\.frameInternalsMapDrag\)\)/);
  assert.doesNotMatch(renderFrameInternalsSource, /resetFrameInternalsMapInteractionState/);
  assert.match(sourceUi, /startFrameInternalsMapPinch/);
  assert.match(sourceUi, /updateFrameInternalsMapPinch/);
  assert.match(sourceUi, /zoomFrameInternalsMapViewport/);
  assert.match(sourceUi, /resetFrameInternalsMapViewport/);
  assert.match(sourceUi, /restoreFrameInternalsMapViewport/);
  assert.match(sourceUi, /applyFrameInternalsMapViewBox/);
  assert.match(sourceUi, /getFrameInternalsMapViewBoxMetrics/);
  assert.match(sourceUi, /getFrameInternalsMapViewSize/);
  assert.match(sourceUi, /getFrameInternalsMapViewportAspectRatio/);
  assert.match(sourceUi, /normalizeFrameInternalsMapCenter/);
  assert.match(sourceUi, /frameInternalsMapView/);
  assert.match(sourceUi, /dataset\.mapCenterX/);
  assert.match(sourceFrameInternalsView, /data-inspection-tooltip/);
  assert.match(sourceFrameInternalsView, /<svg class="block-map"/);
  assert.match(sourceFrameInternalsView, /block-frame-overlay/);
  assert.match(sourceFrameInternalsView, /<path class="block-cell block-cell-path/);
  assert.match(sourceFrameInternalsView, /data-path-count/);
  assert.match(sourceFrameInternalsView, /--cell-red:/);
  assert.match(sourceFrameInternalsMap, /globalPercentile/);
  assert.match(sourceFrameInternalsView, /partitionModes/);
  assert.match(sourceFrameInternalsView, /partitionDepths/);
  assert.match(sourceFrameInternalsMap, /DEFAULT_HEATMAP_BUCKET_COUNT = 32/);
  assert.match(sourceFrameInternalsMap, /buildFrameInternalsPathGroups/);
  assert.match(sourceFrameInternalsMap, /createFrameInternalsSpatialIndex/);
  assert.match(sourceFrameInternalsMap, /createPackedFrameInternalsSpatialIndex/);
  assert.match(sourceFrameInternalsMap, /FRAME_INTERNALS_PATH_CELL_LIMIT = 2048/);
  assert.match(sourceFrameInternalsMap, /findFrameInternalsCell/);
  assert.match(sourceCss, /\.block-map-viewport\s*\{[\s\S]*?position:\s*relative;[\s\S]*?width:\s*100%;/);
  assert.match(sourceCss, /\.block-map-viewport\s*\{[\s\S]*?display:\s*flex;/);
  assert.match(sourceCss, /\.block-map-viewport\s*\{[\s\S]*?height:\s*var\(--frame-map-height/);
  assert.match(sourceCss, /\.block-map-viewport\s*\{[\s\S]*?scrollbar-width:\s*none;/);
  assert.match(sourceCss, /\.block-map-viewport::-webkit-scrollbar\s*\{[\s\S]*?display:\s*none;/);
  assert.doesNotMatch(sourceCss.match(/\.block-map\s*\{[\s\S]*?\}/)?.[0] || "", /max-height:/);
  assert.doesNotMatch(sourceCss.match(/\.block-map\s*\{[\s\S]*?\}/)?.[0] || "", /min-width:\s*min/);
  assert.doesNotMatch(sourceCss.match(/\.block-map\s*\{[\s\S]*?\}/)?.[0] || "", /width:\s*min/);
  assert.doesNotMatch(sourceCss.match(/\.block-map\s*\{[\s\S]*?\}/)?.[0] || "", /transform:/);
  assert.doesNotMatch(sourceCss, /\.block-map-viewport\.zoomed/);
  assert.match(sourceCss, /\.block-map\s*\{[\s\S]*?width:\s*100%;[\s\S]*?height:\s*100%;/);
  assert.match(sourceCss, /\.block-map \.block-cell\s*\{[\s\S]*?vector-effect:\s*non-scaling-stroke;/);
  assert.match(sourceCss, /\.block-hover-outline\s*\{[\s\S]*?pointer-events:\s*none;/);
  assert.match(sourceCss, /\.block-map-viewport\.has-frame-image \.block-cell\s*\{[\s\S]*?calc\(var\(--cell-alpha\) \* 0\.46\)/);
  assert.match(sourceCss, /\.block-frame-overlay\s*\{[\s\S]*?pointer-events:\s*none;/);
  assert.match(sourceCss, /\.frame-internals-metrics\s*\{[\s\S]*?display:\s*grid;/);
  assert.match(sourceCss, /\.frame-internals-chart-grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/);
  assert.match(sourceCss, /--frame-i:\s*oklch\(0\.82 0\.09 145\);/);
  assert.match(sourceCss, /--frame-p:\s*oklch\(0\.80 0\.085 260\);/);
  assert.match(sourceCss, /--frame-b:\s*oklch\(0\.82 0\.09 325\);/);
  assert.match(sourceCss, /--frame-audio:\s*oklch\(0\.82 0\.075 205\);/);
  assert.match(sourceCss, /\.graph-bar\.i\s*\{\s*background:\s*var\(--frame-i\);/);
  assert.match(sourceCss, /\.graph-bar\.p\s*\{\s*background:\s*var\(--frame-p\);/);
  assert.match(sourceCss, /\.graph-bar\.b\s*\{\s*background:\s*var\(--frame-b\);/);
  assert.match(sourceCss, /\.graph-bar\.aac\s*\{\s*background:\s*var\(--frame-audio\);/);
  assert.match(sourceCss, /\.pill\.i\s*\{\s*color:\s*var\(--frame-i-text\);\s*border-color:\s*var\(--frame-i-border\);\s*background:\s*var\(--frame-i\);/);
  assert.match(sourceCss, /\.pill\.p\s*\{\s*color:\s*var\(--frame-p-text\);\s*border-color:\s*var\(--frame-p-border\);\s*background:\s*var\(--frame-p\);/);
  assert.match(sourceCss, /\.pill\.b\s*\{\s*color:\s*var\(--frame-b-text\);\s*border-color:\s*var\(--frame-b-border\);\s*background:\s*var\(--frame-b\);/);
  assert.match(sourceCss, /\.pill\.aac\s*\{\s*color:\s*var\(--frame-audio-text\);\s*border-color:\s*var\(--frame-audio-border\);\s*background:\s*var\(--frame-audio\);/);
  assert.doesNotMatch(sourceFrameInternalsView, /block-cell [^"']+["'][\s\S]{0,200}title=/);
  assert.doesNotMatch(sourceFrameInternalsView, /audio-band-row["'][\s\S]{0,200}title=/);
  assert.match(sourceUi, /createDataGridLayout/);
  assert.match(sourceUi, /renderDataGridCells/);
  assert.match(sourceUi, /frameTableRecycler\.setRows\(rows\)/);
  assert.match(sourceUi, /createAnalysisWorkerClient/);
  assert.match(sourceUi, /probeRemoteMediaResource/);
  assert.match(sourceUi, /downloadRemoteMediaFile/);
  assert.match(sourceUi, /createMediaPreviewPlan/);
  assert.match(sourceUi, /filePreview\.preload = previewPlan\.preload/);
  assert.match(sourceMediaSource, /MEDIA_PREVIEW_PRELOAD = "metadata"/);
  assert.match(sourceMediaSource, /getMediaResourceKind/);
  assert.doesNotMatch(sourceUi, /deferPreviewNetwork/);
  assert.doesNotMatch(sourceUi, /preload = "none"/);
  assert.match(sourceUi, /shouldDownloadRemoteOnceForSharedPlayback/);
  assert.match(sourceUi, /openRemoteUrlModal/);
  assert.match(sourceWorker, /self\.onmessage/);
  assert.match(sourceWorker, /analysisStart/);
  assert.match(sourceWorker, /sampleRows/);
  assert.doesNotMatch(sourceWorker, /analyzeFrameInternals/);
  assert.match(sourceFrameInternalsWorker, /analyzeFrameInternals/);
  assert.match(sourceFrameInternalsWorker, /prepareFrameInternalsWorkerResult/);
  assert.match(sourceFrameInternalsWorker, /result\.transferables/);
  assert.match(sourceFrameInternalsWorker, /postMessage\([\s\S]*?transferables\)/);
  assert.match(sourceFrameInternalsWorker, /initialize/);
  assert.doesNotMatch(builtHtml, /<script\s+src=|<link\s+rel="stylesheet"/i);
  assert.match(builtHtml, /MP4AnalyzerWorkerSource/);
  assert.match(builtHtml, /MP4FrameInternalsWorkerSource/);
  assert.match(builtHtml, /window\.MP4AnalyzerCore/);
  assert.match(builtHtml, /window\.MP4AnalyzerDevTools/);
  assert.ok(builtMinifiedHtml.length < builtHtml.length, "minified single-file output must be smaller than the readable single-file output");
  assert.doesNotMatch(builtMinifiedHtml, /sourceMappingURL=data:application\/json/);
  assert.doesNotMatch(builtMinifiedHtml, /sourcesContent/);
  if (fs.existsSync(chunkedHtmlPath)) {
    const chunkedHtml = fs.readFileSync(chunkedHtmlPath, "utf8");
    assert.match(chunkedHtml, /<base href="\.\.\/">/);
    assert.match(chunkedHtml, /MP4AnalyzerWorkerModuleUrl/);
    assert.match(chunkedHtml, /MP4FrameInternalsWorkerModuleUrl/);
    assert.match(chunkedHtml, /<script type="module" src="chunked\/assets\/app-/);
    assert.doesNotMatch(chunkedHtml, /MP4AnalyzerWorkerSource/);
    const javascriptAssetPaths = collectFiles(path.join(rootDirectory, "chunked", "assets"), (filePath) => filePath.endsWith(".mjs"));
    let sourceBackedEntryMapCount = 0;
    for (const javascriptAssetPath of javascriptAssetPaths) {
      const javascript = fs.readFileSync(javascriptAssetPath, "utf8");
      const sourceMapMatch = javascript.match(/\/\/# sourceMappingURL=([^\s]+\.map)\s*$/);
      assert.ok(sourceMapMatch, `${javascriptAssetPath} must reference a source map`);
      const sourceMapPath = path.resolve(path.dirname(javascriptAssetPath), sourceMapMatch[1]);
      const sourceMap = JSON.parse(fs.readFileSync(sourceMapPath, "utf8"));
      assert.equal(sourceMap.version, 3);
      assert.ok(Array.isArray(sourceMap.sources));
      if (sourceMap.sources.length > 0) {
        assert.ok(sourceMap.sourcesContent.some((source) => source && source.length > 0));
      }
      if (/^(app|analyzer-worker|frame-internals-worker)-/.test(path.basename(javascriptAssetPath))) {
        assert.ok(sourceMap.sources.length > 0);
        sourceBackedEntryMapCount += 1;
      }
    }
    assert.equal(sourceBackedEntryMapCount, 3);
  }
});

test("i18n catalog contains matching Korean and English keys for visible UI strings", async () => {
  const loader = await createSourceModuleLoader();
  const { I18N, BOX_TYPE_I18N, setLanguage, getLanguage, t } = await loader.import("src/js/i18n/catalogs.js");

  const englishKeys = Object.keys(I18N.en).sort();
  const koreanKeys = Object.keys(I18N.ko).sort();
  assert.deepEqual(koreanKeys, englishKeys);
  assert.ok(Object.keys(BOX_TYPE_I18N.ko).includes("stco"));
  assert.ok(Object.keys(BOX_TYPE_I18N.ko).includes("av1C"));
  assert.ok(Object.keys(BOX_TYPE_I18N.ko).includes("av01"));
  assert.ok(Object.keys(BOX_TYPE_I18N.ko).includes("@xyz"));
  assert.ok(Object.keys(BOX_TYPE_I18N.ko).includes("caml"));
  assert.equal(setLanguage("ko"), "ko");
  assert.equal(getLanguage(), "ko");
  assert.equal(t("app.title"), "스탠드얼론 웹 미디어 분석기");
  assert.equal(t("preview.playbackRate"), "재생 속도");
  assert.equal(t("missing.key"), "missing.key");
  assert.equal(setLanguage("en"), "en");
  assert.equal(t("preview.playbackRate"), "Playback speed");
  assert.equal(t("count.rows", { count: 12 }), "12 rows");
});

function collectFiles(directoryPath, predicate) {
  const files = [];
  for (const entry of fs.readdirSync(directoryPath, { withFileTypes: true })) {
    const entryPath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFiles(entryPath, predicate));
    } else if (predicate(entryPath)) {
      files.push(entryPath);
    }
  }
  return files;
}
