const fs = require("node:fs");
const path = require("node:path");
const acorn = require("acorn");

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
    this.style = createFakeStyleDeclaration();
    this.children = [];
    this.eventListeners = new Map();
    this._innerHTML = "";
    this._treeRows = [];
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
      add: (className) => this._classNames = new Set([...(this._classNames || []), className]),
      remove: (className) => {
        this._classNames = new Set(this._classNames || []);
        this._classNames.delete(className);
      },
      toggle: (className, force) => {
        this._classNames = new Set(this._classNames || []);
        const shouldAdd = force === undefined ? !this._classNames.has(className) : Boolean(force);
        if (shouldAdd) this._classNames.add(className);
        else this._classNames.delete(className);
        return shouldAdd;
      },
      contains: (className) => Boolean(this._classNames && this._classNames.has(className))
    };
  }

  get innerHTML() {
    return this._innerHTML;
  }

  set innerHTML(value) {
    this._innerHTML = String(value);
    if (this.id === "boxTree") this._treeRows = createFakeTreeRows(this._innerHTML);
  }

  addEventListener(type, listener) {
    if (!this.eventListeners.has(type)) this.eventListeners.set(type, []);
    this.eventListeners.get(type).push(listener);
  }

  removeEventListener(type, listener) {
    const listeners = this.eventListeners.get(type) || [];
    this.eventListeners.set(type, listeners.filter((candidate) => candidate !== listener));
  }

  dispatchEvent(event) {
    const listeners = this.eventListeners.get(event.type) || [];
    for (const listener of listeners) listener(event);
    return true;
  }

  setAttribute(name, value) { this[name] = value; }
  appendChild(child) { this.children.push(child); return child; }
  remove() {}
  click() {}
  load() {}
  closest() { return null; }
  contains(candidate) {
    if (candidate === this) return true;
    if (this.id === "boxTree" && (this._treeRows || []).includes(candidate)) return true;
    return this.children.includes(candidate);
  }
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }
  querySelectorAll(selector) {
    if (selector === ".tree-row") return this._treeRows || [];
    if (selector === ".tree-row.selected") return (this._treeRows || []).filter((row) => row.classList.contains("selected"));
    return [];
  }
}

class FakeTreeRow extends FakeElement {
  constructor(pathValue) {
    super("tree-row");
    this.dataset.path = pathValue;
    this.nodeType = 1;
  }

  closest(selector) {
    return selector === ".tree-row" ? this : null;
  }
}

function createFakeTreeRows(html) {
  const rows = [];
  const pattern = /class="tree-row"[^>]*data-path="([^"]+)"/g;
  let match = pattern.exec(html);
  while (match) {
    rows.push(new FakeTreeRow(decodeHtmlAttribute(match[1])));
    match = pattern.exec(html);
  }
  return rows;
}

function decodeHtmlAttribute(value) {
  return String(value)
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function createFakeStyleDeclaration() {
  const properties = {};
  return {
    setProperty(name, value) {
      properties[name] = String(value);
      this[name] = String(value);
    },
    getPropertyValue(name) {
      return properties[name] || "";
    },
    removeProperty(name) {
      const previousValue = properties[name] || "";
      delete properties[name];
      delete this[name];
      return previousValue;
    }
  };
}

function createFakeDocument() {
  const elements = new Map();
  const eventListeners = new Map();
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
    querySelector() {
      return null;
    },
    createElement(tagName) {
      return new FakeElement(tagName);
    },
    addEventListener(type, listener) {
      if (!eventListeners.has(type)) eventListeners.set(type, []);
      eventListeners.get(type).push(listener);
    },
    removeEventListener(type, listener) {
      const listeners = eventListeners.get(type) || [];
      eventListeners.set(type, listeners.filter((candidate) => candidate !== listener));
    },
    dispatchEvent(event) {
      const listeners = eventListeners.get(event.type) || [];
      for (const listener of listeners) listener(event);
      return true;
    },
    _eventListeners: eventListeners,
    _elements: elements
  };
}

function createFakeWindow(protocol) {
  return {
    location: { protocol },
    addEventListener() {},
    removeEventListener() {},
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
    /\.frame-wrap\s*\{[\s\S]*?--data-grid-columns:[\s\S]*?--data-grid-width:\s*1048px;/,
    "Frame table must use the shared data grid layout variables for its fallback intrinsic width."
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
    /\.tab-panel\.active\s*\{[\s\S]*?display:\s*grid;[\s\S]*?min-width:\s*0;[\s\S]*?overflow:\s*hidden;/,
    "Generic tab panels must use the shared constrained layout instead of panel-specific scrolling."
  );
  assertCssRule(
    sourceCss,
    /\.tab-panel-body\s*\{[\s\S]*?min-width:\s*0;[\s\S]*?max-width:\s*100%;[\s\S]*?overflow:\s*auto;/,
    "Generic tab panel bodies must own overflow without expanding the page width."
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
    /\.data-grid-table\s*\{[\s\S]*?width:\s*max\(100%,\s*var\(--data-grid-width\)\);[\s\S]*?min-width:\s*var\(--data-grid-width\);/,
    "Reusable data grid must fill available width while preserving its minimum scroll width."
  );
  assertCssRule(
    sourceCss,
    /\.fragments-controls\s*\{[\s\S]*?display:\s*grid;[\s\S]*?grid-template-columns:\s*minmax\(220px,\s*1fr\) max-content;/,
    "Fragments controls must reserve enough room for the playback synchronization label and right-align row count."
  );
  assertCssRule(
    sourceCss,
    /\.fragments-controls \.frame-count-text\s*\{[\s\S]*?justify-self:\s*end;[\s\S]*?text-align:\s*right;/,
    "Fragments row count must stay right-aligned in the controls row."
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
    /\.frame-header\s*\{[\s\S]*?width:\s*max\(100%,\s*var\(--data-grid-width\)\);[\s\S]*?min-width:\s*var\(--data-grid-width\);/,
    "Frame header must fill available width while preserving the shared data grid minimum width."
  );
  assertCssRule(
    sourceCss,
    /\.frame-scroller\s*\{[\s\S]*?overflow:\s*visible;[\s\S]*?width:\s*max\(100%,\s*var\(--data-grid-width\)\);/,
    "Frame virtual scroller must use the shared data grid width and must not own scrollbars."
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
  assertCssRule(
    sourceCss,
    /@media\s*\(max-width:\s*700px\)\s*\{[\s\S]*?\.app\s*\{[\s\S]*?height:\s*auto;[\s\S]*?min-height:\s*100dvh;[\s\S]*?overflow:\s*visible;/,
    "Mobile layout must allow document scrolling instead of clipping the tab content."
  );
  assertCssRule(
    sourceCss,
    /@media\s*\(max-width:\s*700px\)\s*\{[\s\S]*?\.tabs\s*\{[\s\S]*?position:\s*sticky;[\s\S]*?top:\s*0;[\s\S]*?z-index:\s*30;/,
    "Mobile tab selector must remain sticky while scrolling tab content."
  );
  assertCssRule(
    sourceCss,
    /@media\s*\(max-width:\s*700px\)\s*\{[\s\S]*?\.content\s*\{[\s\S]*?min-height:\s*calc\(100dvh - 48px\);[\s\S]*?overflow:\s*visible;/,
    "Mobile tab content must reserve at least one viewport of height."
  );
  assertCssRule(
    sourceCss,
    /@media\s*\(max-width:\s*700px\)\s*\{[\s\S]*?\.panel\s*\{[\s\S]*?height:\s*auto;[\s\S]*?min-height:\s*calc\(100dvh - 48px\);[\s\S]*?overflow:\s*visible;/,
    "Mobile panels must keep stable viewport-height surfaces across tab changes."
  );
  assertCssRule(
    sourceCss,
    /@media\s*\(max-width:\s*700px\)\s*\{[\s\S]*?\.tab-panel\.active\s*\{[\s\S]*?min-height:\s*calc\(100dvh - 48px\);[\s\S]*?overflow:\s*hidden;/,
    "Mobile generic tab panels must prevent Summary/Tracks content from creating page-level horizontal overflow."
  );
  assertCssRule(
    sourceCss,
    /@media\s*\(max-width:\s*700px\)\s*\{[\s\S]*?\.tab-panel-body\s*\{[\s\S]*?max-width:\s*100%;[\s\S]*?overflow:\s*auto;/,
    "Mobile generic tab panel bodies must own their own overflow."
  );
  assertCssRule(
    sourceCss,
    /@media\s*\(max-width:\s*700px\)\s*\{[\s\S]*?\.frames-panel\.active\s*\{[\s\S]*?grid-template-rows:\s*auto minmax\(320px,\s*auto\);/,
    "Mobile frame panel must preserve a minimum table row instead of collapsing below filters."
  );
  assertCssRule(
    sourceCss,
    /@media\s*\(max-width:\s*700px\)\s*\{[\s\S]*?\.frame-wrap,\s*[\s\S]*?\.graph-wrap\s*\{[\s\S]*?height:\s*clamp\(320px,\s*58dvh,\s*520px\);[\s\S]*?min-height:\s*320px;/,
    "Mobile frame table and graph must keep a scrollable minimum height."
  );
  if (/--frame-table-width/.test(sourceCss)) {
    throw new Error("Frame table must not use a separate frame-only width variable.");
  }
  if (/\.frame-(?:header|row)\s+div:nth-child\([\s\S]*?display:\s*none;/.test(sourceCss)) {
    throw new Error("Frame table columns must not be hidden at narrow widths.");
  }
}

function verifyNoExecutableStatementsAfterUserInterfaceReturn(sourceUi) {
  const syntaxTree = acorn.parse(sourceUi, {
    ecmaVersion: "latest",
    sourceType: "module",
    locations: true
  });
  const exportNode = syntaxTree.body.find((node) =>
    node.type === "ExportNamedDeclaration" &&
    node.declaration &&
    node.declaration.id &&
    node.declaration.id.name === "startUserInterface"
  );
  if (!exportNode) throw new Error("Could not find startUserInterface export.");
  let sawReturnStatement = false;
  const unreachableStatements = [];
  for (const statement of exportNode.declaration.body.body) {
    if (sawReturnStatement && statement.type !== "FunctionDeclaration") {
      unreachableStatements.push(statement.type + " at line " + statement.loc.start.line);
    }
    if (statement.type === "ReturnStatement") sawReturnStatement = true;
  }
  if (unreachableStatements.length) {
    throw new Error("Executable UI setup code appears after return: " + unreachableStatements.join(", "));
  }
}

async function main() {
  const sourceHtml = fs.readFileSync(sourceHtmlPath, "utf8");
  const sourceUi = fs.readFileSync(sourceUiPath, "utf8");
  verifyResponsiveLayoutCss();
  verifyNoExecutableStatementsAfterUserInterfaceReturn(sourceUi);

  if (!/column\.index[\s\S]*column\.track[\s\S]*column\.type[\s\S]*column\.offset/.test(sourceHtml)) {
    throw new Error("Frame table header must place Type immediately after Index and Track.");
  }
  if (!/id="frameHeader"\s+class="frame-header data-grid-header"/.test(sourceHtml)) {
    throw new Error("Frame table header must use the reusable data grid header style.");
  }
  if (!/id="summaryPanel"\s+class="panel tab-panel active"[\s\S]*?id="summaryBody"\s+class="tab-panel-body"/.test(sourceHtml)) {
    throw new Error("Summary tab must use the reusable tab panel body.");
  }
  if (!/id="tracksPanel"\s+class="panel tab-panel"[\s\S]*?id="tracksBody"\s+class="tab-panel-body"/.test(sourceHtml)) {
    throw new Error("Tracks tab must use the reusable tab panel body.");
  }
  if (!/id="warningsPanel"\s+class="panel tab-panel"[\s\S]*?id="warningsBody"\s+class="tab-panel-body"/.test(sourceHtml)) {
    throw new Error("Warnings tab must use the reusable tab panel body.");
  }
  if (!/warningOnlyFilter[\s\S]*autoPlaybackSynchronizationToggle/.test(sourceHtml)) {
    throw new Error("Playback synchronization checkbox must be stacked with the warning-only checkbox.");
  }
  if (!/id="fragmentPlaybackSynchronizationToggle"/.test(sourceHtml) || !/id="fragmentsBody"/.test(sourceHtml)) {
    throw new Error("Fragments tab must expose playback synchronization controls and a render body.");
  }
  if (!/row\.sampleIndex[\s\S]*row\.trackId[\s\S]*formatFrameTypeLabel\(type\)[\s\S]*row\.offset/.test(sourceUi)) {
    throw new Error("Frame table row renderer must place Type immediately after Index and Track.");
  }
  if (/row\.pts\s*\|\|\s*row\.dts/.test(sourceUi)) {
    throw new Error("UI time calculations must treat zero PTS as a valid frame start time.");
  }
  if (!/getFirstFiniteNumber\(\[row\.pts,\s*row\.dts\]/.test(sourceUi)) {
    throw new Error("UI time calculations must use explicit timestamp fallback instead of truthiness.");
  }
  if (!/renderDataGridTable/.test(sourceUi) || !/className:\s*"tracks-grid"/.test(sourceUi) || !/className:\s*"fragments-grid"/.test(sourceUi) || !/className:\s*"largest-samples-grid"/.test(sourceUi)) {
    throw new Error("Tracks, fragments, and largest samples must use the reusable data grid component.");
  }
  if (!/createDataGridLayout/.test(sourceUi) || !/renderDataGridCells/.test(sourceUi) || !/renderDataGridHeaderCells/.test(sourceUi)) {
    throw new Error("Frame table recycler must share the reusable data grid layout and cell renderers.");
  }
  if (!/createAnalysisWorkerClient/.test(sourceUi) || !/analysisWorkerClient\.analyzeFile/.test(sourceUi) || !/analysisWorkerClient\.scanFrameTypes/.test(sourceUi)) {
    throw new Error("File analysis and frame scanning must be routed through the analysis worker client.");
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
  if (!/tree-row" data-path=/.test(sourceUi) && !/tree-row"[^>]*data-path=/.test(sourceUi)) {
    throw new Error("Box tree rows must carry a data-path for selection.");
  }
  if (!/type="button" class="tree-row"/.test(sourceUi)) {
    throw new Error("Box tree rows must be explicit buttons.");
  }
  if (!/boxTree\.addEventListener\("click", handleBoxTreeClick\)/.test(sourceUi) || !/boxTree\.addEventListener\("pointerup", handleBoxTreePointerUp\)/.test(sourceUi)) {
    throw new Error("Box tree must bind robust pointer and click selection handlers.");
  }
  if (!/document\.addEventListener\("click", handleDocumentBoxTreeClick, true\)/.test(sourceUi) || !/document\.addEventListener\("pointerup", handleDocumentBoxTreePointerUp, true\)/.test(sourceUi)) {
    throw new Error("Box tree must also bind document-level capture handlers for reliable selection.");
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
  await window.MP4AnalyzerDevTools.loadRuntime();
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
  fakeDocument.getElementById("metricsWindowInput").value = "30";
  const metricsDebug = window.MP4AnalyzerDevTools.getMetricsDebug();
  if (!metricsDebug || !metricsDebug.firstMovingAveragePoint) {
    throw new Error("Metrics debug data was not available.");
  }
  if (metricsDebug.firstMovingAveragePoint.sampleCount !== 30) {
    throw new Error("Moving average must use a full fixed-size first window.");
  }
  if (metricsDebug.movingAveragePointCount !== summary.sampleRows - 30 + 1) {
    throw new Error(
      "Moving average point count must reflect fixed-size windows only. " +
      "points=" + metricsDebug.movingAveragePointCount +
      " rows=" + summary.sampleRows
    );
  }
  if (
    !Number.isFinite(Number(metricsDebug.firstMovingAveragePoint.windowStartSampleIndex)) ||
    !Number.isFinite(Number(metricsDebug.firstMovingAveragePoint.windowEndSampleIndex))
  ) {
    throw new Error("Moving average debug should expose its fixed window sample range.");
  }
  const tracksHtml = fakeDocument.getElementById("tracksBody").innerHTML;
  if (!tracksHtml.includes("data-grid-shell tracks-grid") || !tracksHtml.includes("data-grid-header")) {
    throw new Error("Tracks panel did not render the reusable data grid.");
  }
  const metricsHtml = fakeDocument.getElementById("metricsBody").innerHTML;
  if (!metricsHtml.includes("data-grid-shell largest-samples-grid") || !metricsHtml.includes("data-frame-key=")) {
    throw new Error("Largest samples panel did not render clickable rows with the reusable data grid.");
  }

  const fragmentsHtml = fakeDocument.getElementById("fragmentsBody").innerHTML;
  if (
    !fragmentsHtml.includes("data-grid-shell fragments-grid") ||
    !fragmentsHtml.includes("data-grid-header") ||
    !fragmentsHtml.includes("data-fragment-index=\"1\"") ||
    !fragmentsHtml.includes("Start time") ||
    !fragmentsHtml.includes("End time")
  ) {
    throw new Error("Fragment panel did not render the fMP4 fragments data grid.");
  }
  const fragmentRows = window.MP4AnalyzerDevTools.getFragmentRows();
  if (fragmentRows.length !== 5) {
    throw new Error(`Expected 5 selectable fragments, got ${fragmentRows.length}.`);
  }
  const firstFragment = fragmentRows[0];
  if (!firstFragment || Math.abs(Number(firstFragment.startTimeSeconds)) > 0.000001) {
    throw new Error(
      "First fMP4 fragment must start at decode time 0 from tfdt/DTS, got " +
      (firstFragment ? firstFragment.startTimeSeconds : "missing")
    );
  }
  if (!firstFragment.startFrameRow || Number(firstFragment.startFrameRow.dts) !== 0) {
    throw new Error("First fMP4 fragment start frame must be selected by decode time.");
  }
  const secondFragment = window.MP4AnalyzerDevTools.selectFragmentByIndex(2);
  if (!secondFragment || secondFragment.fragmentIndex !== 2 || !secondFragment.startFrameRow) {
    throw new Error("Selecting a fragment should return its start frame.");
  }
  if (window.MP4AnalyzerDevTools.getSelectedFragmentIndex() !== 2) {
    throw new Error("Selecting a fragment should update the selected fragment index.");
  }
  if (window.MP4AnalyzerDevTools.getSelectedFrameKey() !== secondFragment.startFrameRow.trackId + ":" + secondFragment.startFrameRow.sampleIndex) {
    throw new Error("Selecting a fragment should select the fragment start frame.");
  }
  const fragmentSynchronizationResult = window.MP4AnalyzerDevTools.synchronizeFragmentSelectionToPlayback(2);
  if (
    !fragmentSynchronizationResult ||
    fragmentSynchronizationResult.fragmentIndex !== window.MP4AnalyzerDevTools.getSelectedFragmentIndex() ||
    !(fragmentSynchronizationResult.startTimeSeconds <= 2 && fragmentSynchronizationResult.endTimeSeconds >= 2)
  ) {
    throw new Error("Fragment playback synchronization did not select the fragment containing the playback time.");
  }

  const boxTree = fakeDocument.getElementById("boxTree");
  const firstBoxRow = boxTree.querySelectorAll(".tree-row")[0];
  if (!firstBoxRow) throw new Error("Box tree did not render clickable rows.");
  const clickListeners = boxTree.eventListeners && boxTree.eventListeners.get("click") || [];
  const documentClickListeners = fakeDocument._eventListeners && fakeDocument._eventListeners.get("click") || [];
  if (!clickListeners.length || !documentClickListeners.length) {
    throw new Error("Box tree click handlers were not registered.");
  }
  let preventedDefault = false;
  fakeDocument.dispatchEvent({
    type: "click",
    target: firstBoxRow,
    preventDefault() {
      preventedDefault = true;
    }
  });
  const selectedBox = window.MP4AnalyzerDevTools.getSelectedBox();
  if (!selectedBox || selectedBox.path !== firstBoxRow.dataset.path) {
    const analysis = window.MP4AnalyzerDevTools.getAnalysis();
    const debug = window.MP4AnalyzerDevTools.getBoxSelectionDebug();
    throw new Error(
      "Clicking a box tree row did not update the selected box. " +
      "clicked=" + firstBoxRow.dataset.path +
      " selected=" + (selectedBox && selectedBox.path || "") +
      " firstAnalysisPath=" + (analysis && analysis.allBoxes[0] && analysis.allBoxes[0].path || "") +
      " rowCount=" + boxTree.querySelectorAll(".tree-row").length +
      " clickListeners=" + clickListeners.length +
      " documentClickListeners=" + documentClickListeners.length +
      " debug=" + JSON.stringify(debug)
    );
  }
  if (!preventedDefault) throw new Error("Box tree click should prevent default button behavior.");
  const boxDetailHtml = fakeDocument.getElementById("boxDetail").innerHTML;
  if (!boxDetailHtml.includes(selectedBox.path) || !boxDetailHtml.includes("Parsed fields")) {
    throw new Error("Clicking a box tree row did not render box details.");
  }
  if (!firstBoxRow.classList.contains("selected")) {
    throw new Error("Clicking a box tree row did not mark the row as selected.");
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
