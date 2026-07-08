const fs = require("node:fs");
const path = require("node:path");

const rootDirectory = path.resolve(__dirname, "..");
const htmlPath = path.join(rootDirectory, "mp4-analyzer.html");
const sourceHtmlPath = path.join(rootDirectory, "src", "index.html");
const samplePath = path.join(rootDirectory, "validation", "generated", "avc_fragmented.mp4");

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

async function main() {
  const sourceHtml = fs.readFileSync(sourceHtmlPath, "utf8");
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

  const fragmentsHtml = fakeDocument.getElementById("fragmentsPanel").innerHTML;
  if (!fragmentsHtml.includes("<table") || !fragmentsHtml.includes("<td>5</td>")) {
    throw new Error("Fragment panel did not render the fMP4 fragment table.");
  }

  const frameTypes = new Set(window.MP4AnalyzerDevTools.getAnalysis().sampleRows.map((row) => row.frameType));
  for (const expectedType of ["I", "P", "B"]) {
    if (!frameTypes.has(expectedType)) throw new Error(`Missing frame type ${expectedType}.`);
  }
  if (frameTypes.has("unknown")) throw new Error("UI analysis still contains unknown frame types.");

  const progressText = fakeDocument.getElementById("progressText").textContent;
  if (progressText.startsWith("Failed:")) throw new Error(progressText);

  console.log(JSON.stringify({
    loaded: summary.loaded,
    sampleRows: summary.sampleRows,
    frameTypes: Array.from(frameTypes).sort(),
    averageBitrate: metricsSummary.averageBitrate
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
