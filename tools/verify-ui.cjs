const fs = require("node:fs");
const path = require("node:path");

const rootDirectory = path.resolve(__dirname, "..");
const htmlPath = path.join(rootDirectory, "mp4-analyzer.html");
const sourceHtmlPath = path.join(rootDirectory, "src", "index.html");
const sourceStylePath = path.join(rootDirectory, "src", "styles.css");
const sourceUiPath = path.join(rootDirectory, "src", "js", "ui", "analyzer-ui.js");
const samplePath = path.join(rootDirectory, "validation", "generated", "avc_fragmented.mp4");
const webmSamplePath = path.join(rootDirectory, "validation", "generated", "webm_vp9_opus.webm");

class FakeElement {
  constructor(id = "") {
    this.id = id;
    this.dataset = {};
    this.style = {};
    this.children = [];
    this.value = "";
    this.checked = false;
    this.disabled = false;
    this.hidden = false;
    this.innerHTML = "";
    this.textContent = "";
    this.src = "";
    this.scrollTop = 0;
    this.scrollLeft = 0;
    this.scrollHeight = 0;
    this.clientHeight = 640;
    this.classList = {
      add() {},
      remove() {},
      toggle() {}
    };
  }

  addEventListener() {}
  setAttribute(name, value) { this[name] = value; }
  appendChild(child) { this.children.push(child); return child; }
  remove() {}
  click() {}
  load() {}
  closest() { return null; }
}

function createFakeDocument() {
  const elements = new Map();
  return {
    documentElement: new FakeElement("html"),
    body: new FakeElement("body"),
    title: "",
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, new FakeElement(id));
      return elements.get(id);
    },
    querySelectorAll() {
      return [];
    },
    createElement(tagName) {
      return new FakeElement(tagName);
    },
    _elements: elements
  };
}

function createFakeWindow(protocol) {
  return {
    location: { protocol },
    addEventListener() {},
    clearTimeout,
    setTimeout,
    requestAnimationFrame(callback) {
      callback();
      return 1;
    },
    cancelAnimationFrame() {}
  };
}

function loadAnalyzerIntoFakeDom(protocol) {
  const fakeDocument = createFakeDocument();
  const fakeWindow = createFakeWindow(protocol);

  global.document = fakeDocument;
  global.window = fakeWindow;
  global.requestAnimationFrame = fakeWindow.requestAnimationFrame;
  global.cancelAnimationFrame = fakeWindow.cancelAnimationFrame;
  global.URL = {
    createObjectURL() { return "blob:fake"; },
    revokeObjectURL() {}
  };

  const html = fs.readFileSync(htmlPath, "utf8");
  const scriptMatch = html.match(/<script>([\s\S]*)<\/script>/i);
  if (!scriptMatch) throw new Error("mp4-analyzer.html has no inline script.");
  eval(scriptMatch[1]);

  return { fakeDocument, fakeWindow };
}

function assertCssRule(css, pattern, message) {
  if (!pattern.test(css)) {
    throw new Error(message);
  }
}

function verifyResponsiveLayoutCss() {
  const sourceCss = fs.readFileSync(sourceStylePath, "utf8");

  assertCssRule(
    sourceCss,
    /--frame-table-width:\s*1048px;/,
    "Frame table must define a desktop intrinsic width for internal horizontal scrolling."
  );
  assertCssRule(
    sourceCss,
    /\.toolbar\s*\{[\s\S]*?flex-wrap:\s*wrap;/,
    "Toolbar must wrap controls instead of clipping them at boundary widths."
  );
  assertCssRule(
    sourceCss,
    /\.filters\s*\{[\s\S]*?display:\s*flex;[\s\S]*?flex-wrap:\s*wrap;/,
    "Frame filters must wrap before the mobile breakpoint."
  );
  assertCssRule(
    sourceCss,
    /\.checkbox-stack\s*\{[\s\S]*?display:\s*grid;[\s\S]*?flex:\s*0 1 170px;/,
    "Frame warning and playback synchronization checkboxes must share a compact stacked filter slot."
  );
  assertCssRule(
    sourceCss,
    /\.filters\s*\{[\s\S]*?width:\s*100%;[\s\S]*?max-width:\s*100%;/,
    "Frame filters must stay constrained to the panel width."
  );
  assertCssRule(
    sourceCss,
    /\.frame-view\s*\{[\s\S]*?width:\s*100%;[\s\S]*?max-width:\s*100%;[\s\S]*?min-width:\s*0;[\s\S]*?overflow:\s*hidden;/,
    "Frame view must not let the table intrinsic width expand the filter row."
  );
  assertCssRule(
    sourceCss,
    /\.data-grid-shell\s*\{[\s\S]*?width:\s*100%;[\s\S]*?max-width:\s*100%;[\s\S]*?overflow:\s*hidden;/,
    "Reusable data grid shell must constrain horizontal overflow like the frame table."
  );
  assertCssRule(
    sourceCss,
    /\.data-grid-scroll\s*\{[\s\S]*?overflow:\s*auto;[\s\S]*?scrollbar-gutter:\s*stable;/,
    "Reusable data grid must own horizontal scrolling."
  );
  assertCssRule(
    sourceCss,
    /\.data-grid-header,[\s\S]*?\.data-grid-row\s*\{[\s\S]*?display:\s*grid;[\s\S]*?grid-template-columns:\s*var\(--data-grid-columns\);/,
    "Reusable data grid must share grid row/header layout rules."
  );
  assertCssRule(
    sourceCss,
    /\.frame-wrap\s*\{[\s\S]*?width:\s*100%;[\s\S]*?max-width:\s*100%;[\s\S]*?min-width:\s*0;[\s\S]*?overflow:\s*auto;[\s\S]*?contain:\s*inline-size;/,
    "Frame table wrapper must own both horizontal and vertical scrolling."
  );
  assertCssRule(
    sourceCss,
    /\.data-grid-header\s*\{[\s\S]*?position:\s*sticky;[\s\S]*?top:\s*0;/,
    "Shared data grid header must stay visible inside its scroll container."
  );
  assertCssRule(
    sourceCss,
    /\.frame-header\s*\{[\s\S]*?width:\s*var\(--frame-table-width\);[\s\S]*?min-width:\s*var\(--frame-table-width\);/,
    "Frame header must use the same intrinsic width as virtualized rows."
  );
  assertCssRule(
    sourceCss,
    /\.frame-scroller\s*\{[\s\S]*?overflow:\s*visible;[\s\S]*?width:\s*var\(--frame-table-width\);/,
    "Frame virtual scroller must not own scrollbars."
  );
  assertCssRule(
    sourceCss,
    /@media\s*\(max-width:\s*1120px\)\s*\{[\s\S]*?\.topbar\s*\{[\s\S]*?flex-direction:\s*column;/,
    "Top bar must switch to stacked layout before controls become crowded."
  );
  assertCssRule(
    sourceCss,
    /@media\s*\(max-width:\s*700px\)\s*\{[\s\S]*?\.filters\s*\{[\s\S]*?display:\s*grid;/,
    "Mobile layout must use full-width compact frame controls."
  );
  if (/--frame-table-width:\s*100%;/.test(sourceCss)) {
    throw new Error("Frame table must not collapse to viewport width on mobile.");
  }
  if (/\.frame-(?:header|row)\s+div:nth-child\([\s\S]*?display:\s*none;/.test(sourceCss)) {
    throw new Error("Frame table columns must not be hidden at narrow widths.");
  }
}

async function main() {
  const sourceHtml = fs.readFileSync(sourceHtmlPath, "utf8");
  const sourceUi = fs.readFileSync(sourceUiPath, "utf8");
  verifyResponsiveLayoutCss();

  if (!/column\.index[\s\S]*column\.track[\s\S]*column\.type[\s\S]*column\.offset/.test(sourceHtml)) {
    throw new Error("Frame table header must place Type immediately after Index and Track.");
  }
  if (!/class="frame-header data-grid-header"/.test(sourceHtml)) {
    throw new Error("Frame table header must use the reusable data grid header style.");
  }
  if (!/warningOnlyFilter[\s\S]*autoPlaybackSynchronizationToggle/.test(sourceHtml)) {
    throw new Error("Playback synchronization checkbox must be stacked with the warning-only checkbox.");
  }
  if (!/row\.sampleIndex[\s\S]*row\.trackId[\s\S]*formatFrameTypeLabel\(type\)[\s\S]*row\.offset/.test(sourceUi)) {
    throw new Error("Frame table row renderer must place Type immediately after Index and Track.");
  }
  if (!/renderDataGridTable/.test(sourceUi) || !/className:\s*"tracks-grid"/.test(sourceUi) || !/className:\s*"fragments-grid"/.test(sourceUi) || !/className:\s*"largest-samples-grid"/.test(sourceUi)) {
    throw new Error("Tracks, fragments, and largest samples must use the reusable data grid component.");
  }
  if (!/frameWrap\.addEventListener\("scroll"/.test(sourceUi) || /frameScroller\.addEventListener\("scroll"/.test(sourceUi)) {
    throw new Error("Frame table virtual scroll must listen on frameWrap, not frameScroller.");
  }
  if (!/metric-y-axis-label/.test(sourceUi) || !/metric-x-axis/.test(sourceUi)) {
    throw new Error("Metric chart axis labels must be rendered outside the stretched SVG.");
  }
  if (/metric-axis-label/.test(sourceUi)) {
    throw new Error("Metric chart must not render axis text inside the stretched SVG.");
  }

  const sourceSampleFieldMatch = sourceHtml.match(/<label[^>]+id="sampleField"[^>]*>/);
  if (!sourceSampleFieldMatch || !sourceSampleFieldMatch[0].includes("hidden") || !sourceSampleFieldMatch[0].includes("display: none")) {
    throw new Error("Source HTML sample selector must be hidden by default for file:// src/index.html.");
  }

  const fileModeDom = loadAnalyzerIntoFakeDom("file:");
  const fileModeSampleField = fileModeDom.fakeDocument.getElementById("sampleField");
  if (!fileModeSampleField.hidden) {
    throw new Error("Sample selector should be hidden when loaded from file://.");
  }
  if (fileModeSampleField.style.display !== "none") {
    throw new Error("Sample selector should use display:none when loaded from file://.");
  }
  if (window.MP4AnalyzerDevTools.getSamples().length !== 0) {
    throw new Error("Dev tools sample catalog should be empty when loaded from file://.");
  }

  const { fakeDocument } = loadAnalyzerIntoFakeDom("https:");
  const sampleField = fakeDocument.getElementById("sampleField");
  if (sampleField.hidden) {
    throw new Error("Sample selector should be visible when loaded from http/https.");
  }
  if (sampleField.style.display === "none") {
    throw new Error("Sample selector should not use display:none when loaded from http/https.");
  }

  if (!window.MP4AnalyzerDevTools || typeof window.MP4AnalyzerDevTools.analyzeFile !== "function") {
    throw new Error("MP4AnalyzerDevTools.analyzeFile is not exposed.");
  }
  if (typeof window.MP4AnalyzerDevTools.synchronizeFrameSelectionToPlayback !== "function") {
    throw new Error("MP4AnalyzerDevTools.synchronizeFrameSelectionToPlayback is not exposed.");
  }

  const sampleBytes = fs.readFileSync(samplePath);
  const sampleFile = new File([sampleBytes], "avc_fragmented.mp4", { type: "video/mp4" });
  await window.MP4AnalyzerDevTools.analyzeFile(sampleFile);

  const summary = window.MP4AnalyzerDevTools.summarize();
  if (!summary.loaded) throw new Error("UI analysis did not load.");
  if (summary.sampleRows !== 120) throw new Error(`Expected 120 sample rows, got ${summary.sampleRows}.`);
  if (summary.tracks.length !== 1) throw new Error(`Expected 1 track, got ${summary.tracks.length}.`);

  const metricsSummary = window.MP4AnalyzerDevTools.getMetricsSummary();
  if (!metricsSummary || metricsSummary.averageBitrate <= 0) {
    throw new Error("Metrics summary was not rendered/calculable.");
  }
  const tracksHtml = fakeDocument.getElementById("tracksPanel").innerHTML;
  if (!tracksHtml.includes("data-grid-shell tracks-grid") || !tracksHtml.includes("data-grid-header")) {
    throw new Error("Tracks panel did not render the reusable data grid.");
  }
  const metricsHtml = fakeDocument.getElementById("metricsBody").innerHTML;
  if (!metricsHtml.includes("data-grid-shell largest-samples-grid") || !metricsHtml.includes("data-frame-key=")) {
    throw new Error("Largest samples panel did not render clickable rows with the reusable data grid.");
  }

  const fragmentsHtml = fakeDocument.getElementById("fragmentsPanel").innerHTML;
  if (!fragmentsHtml.includes("data-grid-shell fragments-grid") || !fragmentsHtml.includes("data-grid-header") || !fragmentsHtml.includes(">5</div>")) {
    throw new Error("Fragment panel did not render the fMP4 fragments data grid.");
  }

  const frameTypes = new Set(window.MP4AnalyzerDevTools.getAnalysis().sampleRows.map((row) => row.frameType));
  for (const expectedType of ["I", "P", "B"]) {
    if (!frameTypes.has(expectedType)) throw new Error(`Missing frame type ${expectedType}.`);
  }
  if (frameTypes.has("unknown")) throw new Error("UI analysis still contains unknown frame types.");

  const frameWrap = fakeDocument.getElementById("frameWrap");
  frameWrap.clientHeight = 194;
  frameWrap.scrollHeight = 34 + summary.sampleRows * 32;
  const synchronizationResult = window.MP4AnalyzerDevTools.synchronizeFrameSelectionToPlayback(2);
  if (!synchronizationResult || !synchronizationResult.frameKey) {
    throw new Error("Playback synchronization did not select a frame row.");
  }
  const synchronizedRowIndex = window.MP4AnalyzerDevTools.getFilteredRows()
    .findIndex((row) => String(row.trackId) + ":" + String(row.sampleIndex) === synchronizationResult.frameKey);
  if (synchronizedRowIndex < 0) throw new Error("Playback synchronization selected a row outside the filtered table.");
  const rowCenter = 34 + synchronizedRowIndex * 32 + 16;
  const viewportCenter = frameWrap.scrollTop + frameWrap.clientHeight / 2;
  if (Math.abs(rowCenter - viewportCenter) > 18) {
    throw new Error(`Synchronized frame row should be centered when space allows. row=${rowCenter} viewport=${viewportCenter}`);
  }

  const progressText = fakeDocument.getElementById("progressText").textContent;
  if (progressText.startsWith("Failed:")) throw new Error(progressText);

  const webmSampleBytes = fs.readFileSync(webmSamplePath);
  const webmSampleFile = new File([webmSampleBytes], "webm_vp9_opus.webm", { type: "video/webm" });
  await window.MP4AnalyzerDevTools.analyzeFile(webmSampleFile);

  const webmSummary = window.MP4AnalyzerDevTools.summarize();
  if (webmSummary.tracks.length !== 2) throw new Error(`Expected 2 WebM tracks, got ${webmSummary.tracks.length}.`);
  const metricsTrackOptionsHtml = fakeDocument.getElementById("metricsTrackFilter").innerHTML;
  for (const expectedTrack of webmSummary.tracks) {
    if (!metricsTrackOptionsHtml.includes('value="' + expectedTrack.trackId + '"') || !metricsTrackOptionsHtml.includes(expectedTrack.codec)) {
      throw new Error(`Metrics track selector is missing track ${expectedTrack.trackId} (${expectedTrack.codec}).`);
    }
  }
  const audioTrack = webmSummary.tracks.find((track) => track.handlerType === "soun");
  if (!audioTrack) throw new Error("WebM Opus track was not parsed.");
  fakeDocument.getElementById("metricsTrackFilter").value = String(audioTrack.trackId);
  const audioMetricsSummary = window.MP4AnalyzerDevTools.getMetricsSummary();
  if (!audioMetricsSummary || audioMetricsSummary.averageBitrate <= 0 || audioMetricsSummary.averageFps <= 0) {
    throw new Error("Metrics summary should be calculable for the WebM Opus track.");
  }

  console.log(JSON.stringify({
    loaded: summary.loaded,
    sampleRows: summary.sampleRows,
    frameTypes: Array.from(frameTypes).sort(),
    averageBitrate: metricsSummary.averageBitrate,
    webmMetricTrackCodecs: webmSummary.tracks.map((track) => track.codec).sort()
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
