const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { createSourceModuleLoader } = require("./helpers/source-module-loader.cjs");

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

test("source HTML has required controls, tabs, and no external runtime assets after build", () => {
  const rootDirectory = path.resolve(__dirname, "..");
  const sourceHtml = fs.readFileSync(path.join(rootDirectory, "src", "index.html"), "utf8");
  const sourceUi = fs.readFileSync(path.join(rootDirectory, "src", "js", "ui", "analyzer-ui.js"), "utf8");
  const sourceWorker = fs.readFileSync(path.join(rootDirectory, "src", "js", "worker", "analyzer-worker.js"), "utf8");
  const builtHtml = fs.readFileSync(path.join(rootDirectory, "mp4-analyzer.html"), "utf8");
  const chunkedHtmlPath = path.join(rootDirectory, "chunked", "index.html");

  for (const id of [
    "fileInput", "languageSelect", "sampleField", "sampleSelect", "openButton",
    "scanButton", "cancelButton", "exportJsonButton", "exportCsvButton",
    "mediaPreviewBar", "summaryPanel", "summaryBody", "boxesPanel", "tracksPanel",
    "tracksBody", "framesPanel", "metricsPanel", "fragmentsPanel", "warningsPanel",
    "warningsBody",
    "frameGraphButton", "frameTableButton", "autoPlaybackSynchronizationToggle",
    "fragmentPlaybackSynchronizationToggle", "fragmentCountText", "fragmentsBody",
    "frameWrap", "frameHeader", "frameScroller", "graphScroller"
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
  assert.match(sourceUi, /synchronizeFragmentSelectionToPlayback/);
  assert.match(sourceUi, /handleFragmentRowPointerActivation/);
  assert.match(sourceUi, /createRecyclerView/);
  assert.match(sourceUi, /createDataGridLayout/);
  assert.match(sourceUi, /renderDataGridCells/);
  assert.match(sourceUi, /frameTableRecycler\.setRows\(rows\)/);
  assert.match(sourceUi, /createAnalysisWorkerClient/);
  assert.match(sourceWorker, /self\.onmessage/);
  assert.match(sourceWorker, /analysisStart/);
  assert.match(sourceWorker, /sampleRows/);
  assert.doesNotMatch(builtHtml, /<script\s+src=|<link\s+rel="stylesheet"/i);
  assert.match(builtHtml, /MP4AnalyzerWorkerSource/);
  assert.match(builtHtml, /window\.MP4AnalyzerCore/);
  assert.match(builtHtml, /window\.MP4AnalyzerDevTools/);
  if (fs.existsSync(chunkedHtmlPath)) {
    const chunkedHtml = fs.readFileSync(chunkedHtmlPath, "utf8");
    assert.match(chunkedHtml, /<base href="\.\.\/">/);
    assert.match(chunkedHtml, /MP4AnalyzerWorkerModuleUrl/);
    assert.match(chunkedHtml, /<script type="module" src="chunked\/assets\/app-/);
    assert.doesNotMatch(chunkedHtml, /MP4AnalyzerWorkerSource/);
  }
});

test("i18n catalog contains matching Korean and English keys for visible UI strings", async () => {
  const loader = await createSourceModuleLoader();
  const { I18N, BOX_TYPE_I18N, setLanguage, getLanguage, t } = await loader.import("src/js/i18n/catalogs.js");

  const englishKeys = Object.keys(I18N.en).sort();
  const koreanKeys = Object.keys(I18N.ko).sort();
  assert.deepEqual(koreanKeys, englishKeys);
  assert.ok(Object.keys(BOX_TYPE_I18N.ko).includes("stco"));
  assert.equal(setLanguage("ko"), "ko");
  assert.equal(getLanguage(), "ko");
  assert.equal(t("app.title"), "스탠드얼론 웹 미디어 분석기");
  assert.equal(t("missing.key"), "missing.key");
  assert.equal(setLanguage("en"), "en");
  assert.equal(t("count.rows", { count: 12 }), "12 rows");
});
