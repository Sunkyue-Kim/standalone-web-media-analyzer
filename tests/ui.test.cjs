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
  assert.equal(helpers.isLikelyMediaFile({ name: "clip.MOV", type: "" }), true);
  assert.equal(helpers.isLikelyMediaFile({ name: "notes.txt", type: "text/plain" }), false);
  assert.equal(helpers.isLikelyMediaFile({ name: "", type: "audio/ogg" }), true);
  assert.equal(helpers.getFrameRowKey({ trackId: 3, sampleIndex: 99 }), "3:99");
  assert.equal(helpers.getFrameTypeClass("I"), "i");
  assert.equal(helpers.getFrameTypeClass("mixed(I/P)"), "err");
  assert.equal(helpers.escapeHtml("<tag attr=\"x\">&'"), "&lt;tag attr=&quot;x&quot;&gt;&amp;&#39;");
  assert.equal(helpers.csvCell("a,b\n\"c\""), "\"a,b\n\"\"c\"\"\"");
});

test("media source policy shares preload behavior for local blobs and remote URLs", async () => {
  const loader = await createSourceModuleLoader();
  const mediaSource = await loader.import("src/js/ui/media-source.js");

  assert.equal(mediaSource.MEDIA_PREVIEW_PRELOAD, "metadata");
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
    { codec: "V_VP9", codecDescriptor: "V_VP9" }
  ]);

  assert.deepEqual(JSON.parse(JSON.stringify(counts)), [
    { labelKey: "summary.avcTracks", count: 1 },
    { labelKey: "summary.vp9Tracks", count: 1 },
    { labelKey: "summary.aacTracks", count: 1 },
    { labelKey: "summary.opusTracks", count: 1 }
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(getVisibleSummaryCodecTrackCounts([{ codec: "raw " }]))), []);
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

  const fallbackPlan = await remoteLoader.probeRemoteMediaResource("https://media.test/no-range.mp4");
  assert.equal(fallbackPlan.canStream, false);
  assert.match(fallbackPlan.fallbackReason, /206/);
  const downloadedFile = await remoteLoader.downloadRemoteMediaFile(fallbackPlan.fallback.url, fallbackPlan.fallback);
  assert.equal(downloadedFile.name, "no-range.mp4");
  assert.equal(downloadedFile.size, 3);
  assert.throws(() => remoteLoader.normalizeRemoteMediaUrl("file:///tmp/video.mp4"), /Only http/);
  assert.ok(calls.some((call) => call.range === "bytes=0-0"));
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

test("source HTML has required controls, tabs, and no external runtime assets after build", () => {
  const rootDirectory = path.resolve(__dirname, "..");
  const sourceHtml = fs.readFileSync(path.join(rootDirectory, "src", "index.html"), "utf8");
  const sourceCss = fs.readFileSync(path.join(rootDirectory, "src", "styles.css"), "utf8");
  const sourceUi = fs.readFileSync(path.join(rootDirectory, "src", "js", "ui", "analyzer-ui.js"), "utf8");
  const sourceMediaSource = fs.readFileSync(path.join(rootDirectory, "src", "js", "ui", "media-source.js"), "utf8");
  const sourceWorker = fs.readFileSync(path.join(rootDirectory, "src", "js", "worker", "analyzer-worker.js"), "utf8");
  const builtHtml = fs.readFileSync(path.join(rootDirectory, "mp4-analyzer.html"), "utf8");
  const builtMinifiedHtml = fs.readFileSync(path.join(rootDirectory, "index.html"), "utf8");
  const chunkedHtmlPath = path.join(rootDirectory, "chunked", "index.html");
  const jsonValueCssBlock = sourceCss.match(/\.json-value\s*\{[^}]*\}/)?.[0] || "";

  for (const id of [
    "fileInput", "languageSelect", "sampleField", "sampleSelect", "openButton", "openUrlButton",
    "scanButton", "cancelButton", "exportJsonButton", "exportCsvButton",
    "mediaPreviewBar", "summaryPanel", "summaryBody", "boxesPanel", "tracksPanel",
    "tracksBody", "framesPanel", "metricsPanel", "fragmentsPanel", "warningsPanel",
    "warningsBody",
    "frameGraphButton", "frameTableButton", "autoPlaybackSynchronizationToggle",
    "fragmentPlaybackSynchronizationToggle", "fragmentCountText", "fragmentsBody",
    "frameInternalsPanel", "frameInternalsBody", "frameInternalsTooltip",
    "frameWrap", "frameHeader", "frameScroller", "graphScroller",
    "remoteUrlModal", "remoteUrlForm", "remoteUrlInput", "remoteUrlSubmitButton"
  ]) {
    assert.match(sourceHtml, new RegExp("id=\"" + id + "\""));
  }

  for (const tabName of ["summary", "boxes", "tracks", "frames", "metrics", "fragments", "warnings"]) {
    assert.match(sourceHtml, new RegExp("data-tab=\"" + tabName + "\""));
  }

  assert.match(sourceHtml, /<title>Standalone Web Media Analyzer<\/title>/);
  assert.match(sourceHtml, /id="autoPlaybackSynchronizationToggle" type="checkbox" checked/);
  assert.match(sourceUi, /requestVideoFrameCallback/);
  assert.match(sourceUi, /requestAnimationFrame\(runPlaybackSynchronizationStep\)/);
  assert.match(sourceUi, /shouldUseVideoFramePlaybackSynchronization/);
  assert.match(sourceUi, /hasVideoPlaybackSynchronizationTrack/);
  assert.match(sourceUi, /getPlaybackSynchronizationDebug/);
  assert.match(sourceUi, /synchronizeFragmentSelectionToPlayback/);
  assert.match(sourceUi, /handleFragmentRowPointerActivation/);
  assert.match(sourceUi, /renderJsonViewer/);
  assert.match(sourceUi, /renderJsonHexDump/);
  assert.match(sourceUi, /isHexDumpField/);
  assert.match(sourceUi, /getSyntheticBoxChildren/);
  assert.match(sourceUi, /getDerivedBoxFields/);
  assert.match(sourceUi, /SAMPLE_ENTRY_DERIVED_FIELD_NAMES/);
  assert.match(sourceUi, /JSON_BYTE_PREVIEW_COUNT/);
  assert.match(sourceCss, /\.json-view\s*\{[\s\S]*?overflow-x:\s*auto;/);
  assert.match(sourceCss, /\.json-entry\s*\{[\s\S]*?min-width:\s*max\(100%,\s*560px\);/);
  assert.match(sourceCss, /\.json-entry\s*\{[\s\S]*?grid-template-columns:\s*minmax\(124px,\s*180px\)\s*minmax\(240px,\s*1fr\);/);
  assert.match(jsonValueCssBlock, /overflow-wrap:\s*break-word;/);
  assert.doesNotMatch(jsonValueCssBlock, /overflow-wrap:\s*anywhere;/);
  assert.match(sourceUi, /createRecyclerView/);
  assert.match(sourceUi, /buildFrameInternalsModel/);
  assert.match(sourceUi, /buildFrameInternalsColorScale/);
  assert.match(sourceUi, /frameInternalsColorScaleCache/);
  assert.match(sourceUi, /renderFrameInternals/);
  assert.match(sourceUi, /renderFrameInternalsTooltipAttributes/);
  assert.match(sourceUi, /handleFrameInternalsTooltipPointerOver/);
  assert.match(sourceUi, /data-inspection-tooltip/);
  assert.match(sourceUi, /--cell-red:/);
  assert.match(sourceUi, /globalPercentile/);
  assert.doesNotMatch(sourceUi, /block-cell [^"']+["'][\s\S]{0,200}title=/);
  assert.doesNotMatch(sourceUi, /audio-band-row["'][\s\S]{0,200}title=/);
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
  assert.doesNotMatch(builtHtml, /<script\s+src=|<link\s+rel="stylesheet"/i);
  assert.match(builtHtml, /MP4AnalyzerWorkerSource/);
  assert.match(builtHtml, /window\.MP4AnalyzerCore/);
  assert.match(builtHtml, /window\.MP4AnalyzerDevTools/);
  assert.ok(builtMinifiedHtml.length < builtHtml.length, "minified single-file output must be smaller than the readable single-file output");
  assert.doesNotMatch(builtMinifiedHtml, /sourceMappingURL=data:application\/json/);
  assert.doesNotMatch(builtMinifiedHtml, /sourcesContent/);
  if (fs.existsSync(chunkedHtmlPath)) {
    const chunkedHtml = fs.readFileSync(chunkedHtmlPath, "utf8");
    assert.match(chunkedHtml, /<base href="\.\.\/">/);
    assert.match(chunkedHtml, /MP4AnalyzerWorkerModuleUrl/);
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
      if (/^(app|analyzer-worker)-/.test(path.basename(javascriptAssetPath))) {
        assert.ok(sourceMap.sources.length > 0);
        sourceBackedEntryMapCount += 1;
      }
    }
    assert.equal(sourceBackedEntryMapCount, 2);
  }
});

test("i18n catalog contains matching Korean and English keys for visible UI strings", async () => {
  const loader = await createSourceModuleLoader();
  const { I18N, BOX_TYPE_I18N, setLanguage, getLanguage, t } = await loader.import("src/js/i18n/catalogs.js");

  const englishKeys = Object.keys(I18N.en).sort();
  const koreanKeys = Object.keys(I18N.ko).sort();
  assert.deepEqual(koreanKeys, englishKeys);
  assert.ok(Object.keys(BOX_TYPE_I18N.ko).includes("stco"));
  assert.ok(Object.keys(BOX_TYPE_I18N.ko).includes("@xyz"));
  assert.ok(Object.keys(BOX_TYPE_I18N.ko).includes("caml"));
  assert.equal(setLanguage("ko"), "ko");
  assert.equal(getLanguage(), "ko");
  assert.equal(t("app.title"), "스탠드얼론 웹 미디어 분석기");
  assert.equal(t("missing.key"), "missing.key");
  assert.equal(setLanguage("en"), "en");
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
