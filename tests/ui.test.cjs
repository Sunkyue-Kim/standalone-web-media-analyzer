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

test("source HTML has required controls, tabs, and no external runtime assets after build", () => {
  const rootDirectory = path.resolve(__dirname, "..");
  const sourceHtml = fs.readFileSync(path.join(rootDirectory, "src", "index.html"), "utf8");
  const builtHtml = fs.readFileSync(path.join(rootDirectory, "mp4-analyzer.html"), "utf8");

  for (const id of [
    "fileInput", "languageSelect", "sampleField", "sampleSelect", "openButton",
    "scanButton", "cancelButton", "exportJsonButton", "exportCsvButton",
    "mediaPreviewBar", "summaryPanel", "boxesPanel", "tracksPanel",
    "framesPanel", "metricsPanel", "fragmentsPanel", "warningsPanel",
    "frameGraphButton", "frameTableButton", "frameScroller", "graphScroller"
  ]) {
    assert.match(sourceHtml, new RegExp("id=\"" + id + "\""));
  }

  for (const tabName of ["summary", "boxes", "tracks", "frames", "metrics", "fragments", "warnings"]) {
    assert.match(sourceHtml, new RegExp("data-tab=\"" + tabName + "\""));
  }

  assert.match(sourceHtml, /<title>Standalone Web Media Analyzer<\/title>/);
  assert.doesNotMatch(builtHtml, /<script\s+src=|<link\s+rel="stylesheet"/i);
  assert.match(builtHtml, /window\.MP4AnalyzerCore/);
  assert.match(builtHtml, /window\.MP4AnalyzerDevTools/);
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
