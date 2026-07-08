import {
  ROW_HEIGHT,
  GRAPH_ROW_HEIGHT,
  METRIC_CHART_WIDTH,
  METRIC_CHART_HEIGHT,
  BOX_TYPE_INFO,
  clamp,
  formatBytes,
  formatBitsPerSecond,
  formatPreviewBitrate,
  formatMetricNumber,
  formatTime,
  safeJsonReplacer,
  findDescendants,
  getDefaultSampleFrameType,
  getFrameTypeScanner
} from "../core/analyzer-core.js";
import {
  I18N,
  BOX_TYPE_I18N,
  getLanguage,
  setLanguage as setI18nLanguage,
  t
} from "../i18n/catalogs.js";
import { SAMPLE_FILES } from "../samples/sample-manifest.js";
import {
  canUseSampleCatalogLocation,
  csvCell,
  escapeHtml,
  getFrameRowKey,
  getFrameTypeClass,
  isLikelyMediaFile
} from "./ui-helpers.js";

export function startUserInterface(Core) {
  if (typeof document === "undefined" || !document.getElementById) return;
const FRAME_TABLE_HEADER_HEIGHT = 34;
const state = {
  analysis: null,
  language: getLanguage(),
  activeTab: "summary",
  selectedBox: null,
  selectedFrameKey: "",
  filteredRows: [],
  graphRows: [],
  frameViewMode: "table",
  graphMaxSize: 1,
  filePreviewUrl: "",
  dropHintHideTimer: 0,
  transientWarnings: [],
  progressSourceLabel: "Open or drop a media file to begin.",
  progressRawLabel: t("status.initial"),
  progressPercentValue: 0,
  lastPlaybackSynchronizationFrameKey: "",
  renderFrameRequest: 0
};

const elements = {
  fileInput: document.getElementById("fileInput"),
  languageSelect: document.getElementById("languageSelect"),
  sampleField: document.getElementById("sampleField"),
  sampleSelect: document.getElementById("sampleSelect"),
  openButton: document.getElementById("openButton"),
  scanButton: document.getElementById("scanButton"),
  cancelButton: document.getElementById("cancelButton"),
  exportJsonButton: document.getElementById("exportJsonButton"),
  exportCsvButton: document.getElementById("exportCsvButton"),
  mediaPreviewBar: document.getElementById("mediaPreviewBar"),
  filePreview: document.getElementById("filePreview"),
  mediaPreviewName: document.getElementById("mediaPreviewName"),
  mediaPreviewMeta: document.getElementById("mediaPreviewMeta"),
  dropOverlay: document.getElementById("dropOverlay"),
  boxTree: document.getElementById("boxTree"),
  boxDetail: document.getElementById("boxDetail"),
  summaryPanel: document.getElementById("summaryPanel"),
  boxesPanel: document.getElementById("boxesPanel"),
  tracksPanel: document.getElementById("tracksPanel"),
  framesPanel: document.getElementById("framesPanel"),
  metricsPanel: document.getElementById("metricsPanel"),
  fragmentsPanel: document.getElementById("fragmentsPanel"),
  warningsPanel: document.getElementById("warningsPanel"),
  progressText: document.getElementById("progressText"),
  progressPercent: document.getElementById("progressPercent"),
  progressFill: document.getElementById("progressFill"),
  trackFilter: document.getElementById("trackFilter"),
  typeFilter: document.getElementById("typeFilter"),
  syncFilter: document.getElementById("syncFilter"),
  minSizeFilter: document.getElementById("minSizeFilter"),
  maxSizeFilter: document.getElementById("maxSizeFilter"),
  warningOnlyFilter: document.getElementById("warningOnlyFilter"),
  autoPlaybackSynchronizationToggle: document.getElementById("autoPlaybackSynchronizationToggle"),
  clearFiltersButton: document.getElementById("clearFiltersButton"),
  frameGraphButton: document.getElementById("frameGraphButton"),
  frameTableButton: document.getElementById("frameTableButton"),
  frameCountText: document.getElementById("frameCountText"),
  frameGraphView: document.getElementById("frameGraphView"),
  frameTableView: document.getElementById("frameTableView"),
  frameWrap: document.getElementById("frameWrap"),
  frameScroller: document.getElementById("frameScroller"),
  frameSpacer: document.getElementById("frameSpacer"),
  graphAxisScale: document.getElementById("graphAxisScale"),
  graphAxisUnit: document.getElementById("graphAxisUnit"),
  graphScroller: document.getElementById("graphScroller"),
  graphSpacer: document.getElementById("graphSpacer"),
  metricsTrackFilter: document.getElementById("metricsTrackFilter"),
  metricsWindowInput: document.getElementById("metricsWindowInput"),
  metricsPointLimitInput: document.getElementById("metricsPointLimitInput"),
  metricsBody: document.getElementById("metricsBody")
};

window.MP4AnalyzerDevTools = {
  getAnalysis: () => state.analysis,
  getFilteredRows: () => state.filteredRows,
  getSelectedFrameKey: () => state.selectedFrameKey,
  setAutoPlaybackSynchronization: (enabled) => {
    elements.autoPlaybackSynchronizationToggle.checked = Boolean(enabled);
    state.lastPlaybackSynchronizationFrameKey = "";
    const row = synchronizeFrameSelectionToPlayback({ force: true });
    return row ? getFrameRowKey(row) : "";
  },
  synchronizeFrameSelectionToPlayback: (playbackSeconds) => {
    if (Number.isFinite(Number(playbackSeconds))) elements.filePreview.currentTime = Number(playbackSeconds);
    elements.autoPlaybackSynchronizationToggle.checked = true;
    state.lastPlaybackSynchronizationFrameKey = "";
    const row = synchronizeFrameSelectionToPlayback({ force: true });
    return row ? {
      frameKey: getFrameRowKey(row),
      row,
      frameScrollTop: elements.frameWrap.scrollTop,
      graphScrollTop: elements.graphScroller.scrollTop
    } : null;
  },
  getMetricsSummary: () => {
    const track = getSelectedMetricsTrack();
    if (!track) return null;
    const rows = getRowsForTrack(track.trackId);
    return buildTrackMetrics(track, rows, getMetricsWindowSize()).summary;
  },
  runSmokeTests: () => Core.runParserSelfTests(),
  canUseSamples: () => canUseSampleCatalog(),
  getSamples: () => canUseSampleCatalog() ? SAMPLE_FILES.slice() : [],
  loadSample: (sampleId) => loadSampleById(sampleId),
  analyzeFile: (file) => startAnalysis(file),
  summarize: () => {
    if (!state.analysis) return { loaded: false };
    return {
      loaded: true,
      file: state.analysis.file,
      tracks: state.analysis.tracks.map((track) => ({
        trackId: track.trackId,
        handlerType: track.handlerType,
        codec: track.codec,
        samples: track.sampleCount,
        codecDescriptor: track.codecDescriptor,
        codecConfig: Boolean(track.codecConfig)
      })),
      sampleRows: state.analysis.sampleRows.length,
      warnings: state.analysis.warnings
    };
  }
};

populateSampleSelect();
elements.languageSelect.addEventListener("change", () => setLanguage(elements.languageSelect.value));
elements.sampleSelect.addEventListener("change", () => {
  if (canUseSampleCatalog() && elements.sampleSelect.value) loadSampleById(elements.sampleSelect.value);
});
elements.openButton.addEventListener("click", () => elements.fileInput.click());
elements.fileInput.addEventListener("change", () => {
  const file = elements.fileInput.files && elements.fileInput.files[0];
  if (file) startAnalysis(file);
});

window.addEventListener("dragenter", handleWindowDragEnter, true);
window.addEventListener("dragover", handleWindowDragOver, true);
window.addEventListener("dragleave", handleWindowDragLeave, true);
window.addEventListener("dragend", hideDropOverlay, true);
window.addEventListener("drop", handleWindowDrop, true);

for (const tabButton of document.querySelectorAll(".tab")) {
  tabButton.addEventListener("click", () => setActiveTab(tabButton.dataset.tab));
}

elements.cancelButton.addEventListener("click", () => {
  if (state.analysis && state.analysis.reader) state.analysis.reader.cancel();
  setProgress("Cancelling...", 0);
});

elements.scanButton.addEventListener("click", async () => {
  if (!state.analysis) return;
  await scanCurrentAnalysis();
});

elements.exportJsonButton.addEventListener("click", exportJson);
elements.exportCsvButton.addEventListener("click", exportCsv);
elements.frameWrap.addEventListener("scroll", scheduleFrameRender);
elements.graphScroller.addEventListener("scroll", scheduleFrameRender);
elements.frameSpacer.addEventListener("click", handleFrameRowPointerActivation);
elements.graphSpacer.addEventListener("click", handleFrameRowPointerActivation);
elements.metricsBody.addEventListener("click", handleFrameRowPointerActivation);
elements.frameSpacer.addEventListener("keydown", handleFrameRowKeyboardActivation);
elements.graphSpacer.addEventListener("keydown", handleFrameRowKeyboardActivation);
elements.metricsBody.addEventListener("keydown", handleFrameRowKeyboardActivation);
elements.frameGraphButton.addEventListener("click", () => setFrameViewMode("graph"));
elements.frameTableButton.addEventListener("click", () => setFrameViewMode("table"));
elements.autoPlaybackSynchronizationToggle.addEventListener("change", () => {
  state.lastPlaybackSynchronizationFrameKey = "";
  if (elements.autoPlaybackSynchronizationToggle.checked) synchronizeFrameSelectionToPlayback({ force: true });
});
elements.filePreview.addEventListener("timeupdate", () => synchronizeFrameSelectionToPlayback());
elements.filePreview.addEventListener("seeked", () => synchronizeFrameSelectionToPlayback({ force: true }));
elements.filePreview.addEventListener("loadedmetadata", () => synchronizeFrameSelectionToPlayback({ force: true }));
for (const input of [elements.trackFilter, elements.typeFilter, elements.syncFilter, elements.minSizeFilter, elements.maxSizeFilter, elements.warningOnlyFilter]) {
  input.addEventListener("input", renderFrames);
  input.addEventListener("change", renderFrames);
}
for (const input of [elements.metricsTrackFilter, elements.metricsWindowInput, elements.metricsPointLimitInput]) {
  input.addEventListener("input", renderMetrics);
  input.addEventListener("change", renderMetrics);
}
elements.clearFiltersButton.addEventListener("click", () => {
  elements.trackFilter.value = "";
  elements.typeFilter.value = "";
  elements.syncFilter.value = "";
  elements.minSizeFilter.value = "";
  elements.maxSizeFilter.value = "";
  elements.warningOnlyFilter.checked = false;
  renderFrames();
});

setLanguage(elements.languageSelect.value || "en");

function setLanguage(language) {
  const languageCode = setI18nLanguage(language);
  state.language = languageCode;
  elements.languageSelect.value = languageCode;
  applyStaticTranslations();
  setProgress(state.progressSourceLabel, state.progressPercentValue);
  refreshDynamicLanguage();
}

function applyStaticTranslations() {
  document.documentElement.lang = getLanguage() === "ko" ? "ko" : "en";
  document.title = t("app.title");
  for (const element of document.querySelectorAll("[data-i18n]")) {
    element.textContent = t(element.dataset.i18n);
  }
  for (const element of document.querySelectorAll("[data-i18n-aria-label]")) {
    element.setAttribute("aria-label", t(element.dataset.i18nAriaLabel));
  }
  for (const element of document.querySelectorAll("[data-i18n-placeholder]")) {
    element.setAttribute("placeholder", t(element.dataset.i18nPlaceholder));
  }
}

function refreshDynamicLanguage() {
  populateSampleSelect();
  if (state.analysis) {
    renderAll();
    renderSelectedBox();
  } else {
    elements.summaryPanel.innerHTML = emptyHtml("empty.summary");
    elements.boxDetail.innerHTML = emptyHtml("empty.boxDetailInitial");
    elements.tracksPanel.innerHTML = emptyHtml("empty.noTracks");
    elements.metricsBody.innerHTML = emptyHtml("empty.metrics");
    elements.fragmentsPanel.innerHTML = emptyHtml("empty.noFragments");
    elements.warningsPanel.innerHTML = emptyHtml("empty.noWarnings");
    elements.frameCountText.textContent = t("count.rows", { count: 0 });
    elements.graphAxisUnit.textContent = t("unit.bytes");
    elements.trackFilter.innerHTML = '<option value="">' + escapeHtml(t("option.all")) + '</option>';
    elements.metricsTrackFilter.innerHTML = '<option value="">' + escapeHtml(t("option.noTrack")) + '</option>';
  }
}

function emptyHtml(key, values) {
  return '<div class="empty">' + escapeHtml(t(key, values)) + '</div>';
}

function populateSampleSelect() {
  if (!elements.sampleSelect) return;
  const canUseSamples = canUseSampleCatalog();
  if (elements.sampleField) {
    elements.sampleField.hidden = !canUseSamples;
    elements.sampleField.style.display = canUseSamples ? "" : "none";
    elements.sampleField.setAttribute("aria-hidden", canUseSamples ? "false" : "true");
  }
  elements.sampleSelect.disabled = !canUseSamples;
  if (!canUseSamples) {
    elements.sampleSelect.innerHTML = "";
    elements.sampleSelect.value = "";
    return;
  }
  const selectedSampleId = elements.sampleSelect.value;
  const options = [
    '<option value="">' + escapeHtml(t("option.samplePlaceholder")) + '</option>'
  ];
  for (const sample of SAMPLE_FILES) {
    const selected = sample.id === selectedSampleId ? " selected" : "";
    options.push(
      '<option value="' + escapeHtml(sample.id) + '"' + selected + '>' +
      escapeHtml(getSampleLabel(sample)) +
      '</option>'
    );
  }
  elements.sampleSelect.innerHTML = options.join("");
}

function canUseSampleCatalog() {
  if (typeof window === "undefined" || !window.location) return false;
  return canUseSampleCatalogLocation(window.location);
}

function getSampleLabel(sample) {
  return sample.labels[getLanguage()] || sample.labels.en || sample.fileName;
}

async function loadSampleById(sampleId) {
  if (!canUseSampleCatalog()) return null;
  const sample = SAMPLE_FILES.find((candidate) => candidate.id === sampleId);
  if (!sample) return null;
  await loadSampleFile(sample);
  return sample;
}

async function loadSampleFile(sample) {
  const label = getSampleLabel(sample);
  try {
    state.transientWarnings = [];
    setBusy(true);
    setProgress(t("status.loadingSample", { name: label }), 3);
    const response = await fetch(sample.path, { cache: "no-store" });
    if (!response.ok) throw new Error(response.status + " " + response.statusText);
    const blob = await response.blob();
    const file = new File([blob], sample.fileName, {
      type: sample.type || blob.type || "video/mp4",
      lastModified: 0
    });
    await startAnalysis(file, { keepSampleSelection: true });
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    setBusy(false);
    state.transientWarnings = [t("warning.sampleLoadFailed", { message })];
    setProgress(t("status.sampleLoadFailed", { message }), 0);
    renderWarnings();
  }
}

function handleFrameRowPointerActivation(event) {
  const rowElement = event.target.closest("[data-frame-key]");
  if (!rowElement) return;
  const row = findFrameRowByKey(rowElement.dataset.frameKey);
  if (row) activateFrameRow(row);
}

function handleFrameRowKeyboardActivation(event) {
  if (event.key !== "Enter" && event.key !== " ") return;
  const rowElement = event.target.closest("[data-frame-key]");
  if (!rowElement) return;
  event.preventDefault();
  const row = findFrameRowByKey(rowElement.dataset.frameKey);
  if (row) activateFrameRow(row);
}

function findFrameRowByKey(frameKey) {
  if (!state.analysis || !frameKey) return null;
  return state.analysis.sampleRows.find((row) => getFrameRowKey(row) === frameKey) || null;
}

function activateFrameRow(row) {
  state.selectedFrameKey = getFrameRowKey(row);
  seekPreviewToFrameRow(row);
  scheduleFrameRender();
}

function seekPreviewToFrameRow(row) {
  if (!elements.filePreview || !elements.filePreview.src) return;
  const rowTimeSeconds = getRowTimeSeconds(row);
  if (!Number.isFinite(rowTimeSeconds)) return;
  const seekSeconds = Math.max(0, rowTimeSeconds);
  const applySeek = () => {
    try {
      const duration = Number(elements.filePreview.duration);
      const boundedSeekSeconds = Number.isFinite(duration) && duration > 0
        ? Math.min(seekSeconds, Math.max(0, duration - 0.001))
        : seekSeconds;
      elements.filePreview.currentTime = boundedSeekSeconds;
    } catch (error) {
      console.warn("Unable to seek preview video", error);
    }
  };
  if (elements.filePreview.readyState < 1) {
    elements.filePreview.addEventListener("loadedmetadata", applySeek, { once: true });
    elements.filePreview.load();
  } else {
    applySeek();
  }
}

function synchronizeFrameSelectionToPlayback(options = {}) {
  if (!state.analysis || !elements.autoPlaybackSynchronizationToggle.checked) return null;
  const playbackSeconds = Number(elements.filePreview.currentTime);
  if (!Number.isFinite(playbackSeconds)) return null;
  const row = findFrameRowForPlaybackTime(playbackSeconds);
  if (!row) return null;
  const frameRowKey = getFrameRowKey(row);
  const shouldUpdate = options.force || frameRowKey !== state.selectedFrameKey || frameRowKey !== state.lastPlaybackSynchronizationFrameKey;
  if (!shouldUpdate) return row;
  state.selectedFrameKey = frameRowKey;
  state.lastPlaybackSynchronizationFrameKey = frameRowKey;
  scrollSynchronizedFrameRowIntoView(row);
  scheduleFrameRender();
  return row;
}

function findFrameRowForPlaybackTime(playbackSeconds) {
  const rows = getPlaybackSynchronizationRows();
  if (!rows.length) return null;
  let bestRow = null;
  let bestDistance = Infinity;
  for (const row of rows) {
    const rowTimeSeconds = getRowTimeSeconds(row);
    if (!Number.isFinite(rowTimeSeconds)) continue;
    const rowDurationSeconds = getRowDurationSeconds(row);
    const rowEndSeconds = rowTimeSeconds + Math.max(rowDurationSeconds, 0.000001);
    const distance = playbackSeconds >= rowTimeSeconds && playbackSeconds < rowEndSeconds
      ? 0
      : Math.abs(playbackSeconds - rowTimeSeconds);
    if (distance < bestDistance) {
      bestRow = row;
      bestDistance = distance;
    }
  }
  return bestRow;
}

function getPlaybackSynchronizationRows() {
  const rows = state.filteredRows || [];
  if (!rows.length) return rows;
  if (elements.trackFilter.value) return rows;
  const videoRows = rows.filter((row) => {
    const track = getRowTrack(row);
    return track && track.handlerType === "vide";
  });
  return videoRows.length ? videoRows : rows;
}

function scrollSynchronizedFrameRowIntoView(row) {
  scrollTableFrameRowIntoCenter(row);
  if (state.frameViewMode === "graph") scrollGraphFrameRowIntoCenter(row);
}

function scrollTableFrameRowIntoCenter(row) {
  const rowIndex = findRowIndexByKey(state.filteredRows, getFrameRowKey(row));
  if (rowIndex < 0) return;
  const clientHeight = Number(elements.frameWrap.clientHeight) || 400;
  const contentHeight = FRAME_TABLE_HEADER_HEIGHT + state.filteredRows.length * ROW_HEIGHT;
  const scrollHeight = Number(elements.frameWrap.scrollHeight);
  const maxScrollTop = Math.max(0, (Number.isFinite(scrollHeight) && scrollHeight > 0 ? scrollHeight : contentHeight) - clientHeight);
  const rowCenter = FRAME_TABLE_HEADER_HEIGHT + rowIndex * ROW_HEIGHT + ROW_HEIGHT / 2;
  elements.frameWrap.scrollTop = clamp(rowCenter - clientHeight / 2, 0, maxScrollTop);
}

function scrollGraphFrameRowIntoCenter(row) {
  const rowIndex = findRowIndexByKey(state.graphRows, getFrameRowKey(row));
  if (rowIndex < 0) return;
  const clientHeight = Number(elements.graphScroller.clientHeight) || 400;
  const contentHeight = state.graphRows.length * GRAPH_ROW_HEIGHT;
  const scrollHeight = Number(elements.graphScroller.scrollHeight);
  const maxScrollTop = Math.max(0, (Number.isFinite(scrollHeight) && scrollHeight > 0 ? scrollHeight : contentHeight) - clientHeight);
  const rowCenter = rowIndex * GRAPH_ROW_HEIGHT + GRAPH_ROW_HEIGHT / 2;
  elements.graphScroller.scrollTop = clamp(rowCenter - clientHeight / 2, 0, maxScrollTop);
}

function findRowIndexByKey(rows, frameRowKey) {
  return rows.findIndex((row) => getFrameRowKey(row) === frameRowKey);
}

function hasDraggedFiles(dataTransfer) {
  if (!dataTransfer) return false;
  const types = Array.from(dataTransfer.types || []);
  if (types.includes("Files")) return true;
  return Array.from(dataTransfer.items || []).some((item) => item.kind === "file");
}

function getDroppedMediaFile(fileList) {
  const files = Array.from(fileList || []);
  return files.find(isLikelyMediaFile) || files[0] || null;
}

function handleWindowDragEnter(event) {
  if (!hasDraggedFiles(event.dataTransfer)) return;
  event.preventDefault();
  showDropOverlay();
}

function handleWindowDragOver(event) {
  if (!hasDraggedFiles(event.dataTransfer)) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  showDropOverlay();
}

function handleWindowDragLeave(event) {
  if (!hasDraggedFiles(event.dataTransfer)) return;
  const leftWindow = event.clientX <= 0 || event.clientY <= 0 ||
    event.clientX >= window.innerWidth || event.clientY >= window.innerHeight;
  if (leftWindow) hideDropOverlay();
}

function handleWindowDrop(event) {
  if (!hasDraggedFiles(event.dataTransfer)) return;
  event.preventDefault();
  hideDropOverlay();
  const file = getDroppedMediaFile(event.dataTransfer.files);
  if (file) startAnalysis(file);
}

function showDropOverlay() {
  window.clearTimeout(state.dropHintHideTimer);
  elements.dropOverlay.classList.add("active");
  elements.dropOverlay.setAttribute("aria-hidden", "false");
  state.dropHintHideTimer = window.setTimeout(hideDropOverlay, 1400);
}

function hideDropOverlay() {
  window.clearTimeout(state.dropHintHideTimer);
  state.dropHintHideTimer = 0;
  elements.dropOverlay.classList.remove("active");
  elements.dropOverlay.setAttribute("aria-hidden", "true");
}

async function startAnalysis(file, options = {}) {
  setBusy(true);
  resetView(file, options);
  try {
    const analysis = await Core.analyzeFile(file, { onProgress: setProgress });
    state.analysis = analysis;
    updateMediaPreviewMeta(file, analysis);
    renderAll();
    setBusy(false);
    const canScan = analysis.tracks.some((track) => getFrameTypeScanner(track));
    elements.scanButton.disabled = !canScan;
    elements.exportJsonButton.disabled = false;
    elements.exportCsvButton.disabled = false;
    if (canScan && Core.shouldAutoScan(analysis)) {
      await scanCurrentAnalysis();
    }
  } catch (error) {
    setBusy(false);
    setProgress("Failed: " + error.message, 0);
    elements.summaryPanel.innerHTML = emptyHtml("status.failed", { message: error.message });
  }
}

async function scanCurrentAnalysis() {
  setBusy(true);
  elements.scanButton.disabled = true;
  try {
    await Core.scanFrameTypes(state.analysis, { onProgress: setProgress });
    setProgress("Frame type scan complete", 100);
    renderFrames();
    renderTracks();
    renderMetrics();
    renderWarnings();
  } catch (error) {
    setProgress("Scan stopped: " + error.message, 0);
  } finally {
    setBusy(false);
    elements.scanButton.disabled = false;
  }
}

function setBusy(isBusy) {
  elements.cancelButton.disabled = !isBusy;
  elements.openButton.disabled = isBusy;
  elements.sampleSelect.disabled = isBusy || !canUseSampleCatalog();
}

function resetView(file, options = {}) {
  state.analysis = null;
  state.selectedBox = null;
  state.selectedFrameKey = "";
  state.lastPlaybackSynchronizationFrameKey = "";
  state.transientWarnings = [];
  if (!options.keepSampleSelection && elements.sampleSelect) elements.sampleSelect.value = "";
  setFilePreview(file);
  elements.boxTree.innerHTML = "";
  elements.summaryPanel.innerHTML = emptyHtml("empty.parsingStructure");
  elements.boxDetail.innerHTML = emptyHtml("empty.selectBox");
  elements.tracksPanel.innerHTML = emptyHtml("empty.noTracks");
  elements.fragmentsPanel.innerHTML = emptyHtml("empty.noFragments");
  elements.warningsPanel.innerHTML = emptyHtml("empty.noWarnings");
  elements.metricsBody.innerHTML = emptyHtml("empty.parsingMetrics");
  elements.frameWrap.scrollTop = 0;
  elements.frameWrap.scrollLeft = 0;
  elements.frameSpacer.innerHTML = "";
  elements.frameSpacer.style.height = "0px";
  elements.graphSpacer.innerHTML = "";
  elements.graphSpacer.style.height = "0px";
  elements.graphAxisScale.innerHTML = "";
  elements.graphAxisUnit.textContent = t("unit.bytes");
  elements.frameCountText.textContent = t("count.rows", { count: 0 });
  elements.trackFilter.innerHTML = '<option value="">' + escapeHtml(t("option.all")) + '</option>';
  elements.metricsTrackFilter.innerHTML = '<option value="">' + escapeHtml(t("option.noTrack")) + '</option>';
  elements.scanButton.disabled = true;
  elements.exportJsonButton.disabled = true;
  elements.exportCsvButton.disabled = true;
  setProgress("Reading " + file.name, 0);
}

function setFilePreview(file) {
  if (state.filePreviewUrl) URL.revokeObjectURL(state.filePreviewUrl);
  state.filePreviewUrl = URL.createObjectURL(file);
  elements.filePreview.src = state.filePreviewUrl;
  elements.filePreview.load();
  elements.mediaPreviewName.textContent = file.name || "Unnamed media";
  updateMediaPreviewMeta(file, null);
  elements.mediaPreviewBar.hidden = false;
}

function updateMediaPreviewMeta(file, analysis) {
  const parts = [formatBytes(file.size)];
  const durationSeconds = analysis ? getAnalysisDurationSeconds(analysis) : 0;
  if (durationSeconds > 0) {
    parts.push(formatPreviewBitrate(file.size * 8 / durationSeconds));
  }
  parts.push(file.type || t("value.unknownMime"));
  elements.mediaPreviewMeta.textContent = parts.filter(Boolean).join(" · ");
}

function getAnalysisDurationSeconds(analysis) {
  let maxDurationSeconds = 0;
  for (const track of analysis.tracks || []) {
    const duration = Number(track.duration);
    const timescale = Number(track.timescale);
    if (Number.isFinite(duration) && duration > 0 && timescale > 0) {
      maxDurationSeconds = Math.max(maxDurationSeconds, duration / timescale);
    }
  }
  if (maxDurationSeconds > 0) return maxDurationSeconds;
  const trackById = new Map((analysis.tracks || []).map((track) => [track.trackId, track]));
  for (const row of analysis.sampleRows || []) {
    const track = trackById.get(row.trackId);
    const timescale = Number(track && track.timescale);
    if (!timescale) continue;
    const rowEnd = (Number(row.pts || row.dts || 0) + Number(row.duration || 0)) / timescale;
    if (Number.isFinite(rowEnd)) maxDurationSeconds = Math.max(maxDurationSeconds, rowEnd);
  }
  return maxDurationSeconds;
}

function setProgress(label, percent) {
  const bounded = clamp(Number(percent) || 0, 0, 100);
  state.progressSourceLabel = label;
  state.progressRawLabel = translateRuntimeLabel(label);
  state.progressPercentValue = bounded;
  elements.progressText.textContent = state.progressRawLabel;
  elements.progressPercent.textContent = Math.round(bounded) + "%";
  elements.progressFill.style.width = bounded + "%";
}

function translateRuntimeLabel(label) {
  if (label === "Parsing boxes") return t("status.parsingBoxes");
  if (label === "Building track model") return t("status.buildingTrackModel");
  if (label === "Structure parsed") return t("status.structureParsed");
  if (label === "Scanning video samples") return t("status.scanningVideoSamples");
  if (label === "Cancelling...") return t("status.cancelling");
  if (label === "Frame type scan complete") return t("status.scanComplete");
  if (label.startsWith("Reading ")) return t("status.reading", { name: label.slice("Reading ".length) });
  if (label.startsWith("Failed: ")) return t("status.failed", { message: label.slice("Failed: ".length) });
  if (label.startsWith("Scan stopped: ")) return t("status.scanStopped", { message: label.slice("Scan stopped: ".length) });
  return label;
}

function setActiveTab(tabName) {
  state.activeTab = tabName;
  for (const button of document.querySelectorAll(".tab")) button.classList.toggle("active", button.dataset.tab === tabName);
  for (const panel of document.querySelectorAll(".panel")) panel.classList.remove("active");
  document.getElementById(tabName + "Panel").classList.add("active");
  if (tabName === "frames") renderFrames();
  if (tabName === "metrics") renderMetrics();
}

function setFrameViewMode(mode) {
  state.frameViewMode = mode;
  elements.frameGraphButton.classList.toggle("active", mode === "graph");
  elements.frameTableButton.classList.toggle("active", mode === "table");
  elements.frameGraphView.classList.toggle("active", mode === "graph");
  elements.frameTableView.classList.toggle("active", mode === "table");
  scheduleFrameRender();
}

function renderAll() {
  renderSummary();
  renderBoxTree();
  renderTracks();
  renderFrames();
  renderMetrics();
  renderFragments();
  renderWarnings();
}

function renderSummary() {
  const analysis = state.analysis;
  const videoTracks = analysis.tracks.filter((track) => track.handlerType === "vide").length;
  const audioTracks = analysis.tracks.filter((track) => track.handlerType === "soun").length;
  const fragments = analysis.topBoxes.filter((box) => box.type === "moof").length;
  const avcTracks = analysis.tracks.filter((track) => track.codec === "avc1" || track.codec === "avc3").length;
  const hevcTracks = analysis.tracks.filter((track) => track.codec === "hvc1" || track.codec === "hev1").length;
  const aacTracks = analysis.tracks.filter((track) => track.codec === "mp4a").length;
  const mp3Tracks = analysis.tracks.filter((track) => track.codec === "mp3").length;
  const opusTracks = analysis.tracks.filter((track) => track.codec === "opus" || track.codec === "A_OPUS").length;
  elements.summaryPanel.innerHTML = [
    '<div class="summary-grid">',
    summaryCard(t("summary.fileSize"), formatBytes(analysis.file.size)),
    summaryCard(t("summary.tracks"), String(analysis.tracks.length)),
    summaryCard(t("summary.videoTracks"), String(videoTracks)),
    summaryCard(t("summary.audioTracks"), String(audioTracks)),
    summaryCard(t("summary.fragments"), String(fragments)),
    summaryCard(t("summary.samples"), String(analysis.sampleRows.length)),
    summaryCard(t("summary.avcTracks"), String(avcTracks)),
    summaryCard(t("summary.hevcTracks"), String(hevcTracks)),
    summaryCard(t("summary.aacTracks"), String(aacTracks)),
    summaryCard(t("summary.mp3Tracks"), String(mp3Tracks)),
    summaryCard(t("summary.opusTracks"), String(opusTracks)),
    summaryCard(t("summary.warnings"), String(analysis.warnings.length)),
    '</div>',
    '<p class="split-note">' + escapeHtml(t("summary.note")) + '</p>',
    renderTrackTable(analysis.tracks)
  ].join("");
}

function summaryCard(label, value) {
  return '<div class="card"><span>' + escapeHtml(label) + '</span><strong>' + escapeHtml(value) + '</strong></div>';
}

function renderBoxTree() {
  const analysis = state.analysis;
  elements.boxTree.innerHTML = analysis.topBoxes.map((node) => renderBoxNode(node)).join("");
}

function renderBoxNode(node) {
  const childHtml = node.children && node.children.length ? '<div class="tree-children">' + node.children.map(renderBoxNode).join("") + '</div>' : "";
  return '<div class="tree-node"><button class="tree-row" data-path="' + escapeHtml(node.path) + '" title="' + escapeHtml(formatBoxTypeLabel(node.type)) + '">' +
    '<span class="type">' + escapeHtml(node.type) + '</span><span class="size">' + formatBytes(Number(node.size)) + ' @ ' + escapeHtml(node.offset) + '</span></button>' + childHtml + '</div>';
}

elements.boxTree.addEventListener("click", (event) => {
  const row = event.target.closest(".tree-row");
  if (!row || !state.analysis) return;
  const path = row.dataset.path;
  state.selectedBox = state.analysis.allBoxes.find((box) => box.path === path) || null;
  for (const node of elements.boxTree.querySelectorAll(".tree-row")) node.classList.toggle("selected", node === row);
  renderSelectedBox();
  setActiveTab("boxes");
});

function renderSelectedBox() {
  if (!state.selectedBox) {
    elements.boxDetail.innerHTML = emptyHtml("empty.selectBox");
    return;
  }
  const node = state.selectedBox;
  elements.boxDetail.innerHTML = '<div class="detail-grid"><div>' +
    '<h2>' + escapeHtml(t("boxes.detailTitle")) + '</h2>' + renderKv([
      [t("box.field.type"), formatBoxTypeLabel(node.type)],
      [t("box.field.description"), getBoxTypeDescription(node.type)],
      [t("box.field.path"), node.path],
      [t("box.field.offset"), node.offset],
      [t("box.field.size"), node.size + " (" + formatBytes(Number(node.size)) + ")"],
      [t("box.field.headerSize"), node.headerSize],
      [t("box.field.children"), node.children.length],
      [t("box.field.warnings"), node.warnings.length ? node.warnings.join("; ") : t("value.none")]
    ]) + '</div><div><h2>' + escapeHtml(t("boxes.parsedFields")) + '</h2><pre class="code">' +
    escapeHtml(JSON.stringify(node.fields, safeJsonReplacer, 2)) + '</pre></div></div>';
}

function formatBoxTypeLabel(type) {
  const info = BOX_TYPE_INFO[type];
  const localized = getLocalizedBoxInfo(type);
  return info ? type + " (" + localized.name + ")" : type + " (" + t("boxes.unknownType") + ")";
}

function getBoxTypeDescription(type) {
  return getLocalizedBoxInfo(type).description;
}

function getLocalizedBoxInfo(type) {
  const info = BOX_TYPE_INFO[type];
  if (!info) return { name: t("boxes.unknownType"), description: t("boxes.noDescription") };
  const language = getLanguage();
  const localized = BOX_TYPE_I18N[language] && BOX_TYPE_I18N[language][type];
  if (!localized) return info;
  return { name: localized[0], description: localized[1] };
}

function renderTracks() {
  const analysis = state.analysis;
  if (!analysis.tracks.length) {
    elements.tracksPanel.innerHTML = emptyHtml("empty.noTracks");
    return;
  }
  elements.tracksPanel.innerHTML = renderTrackTable(analysis.tracks);
  elements.trackFilter.innerHTML = '<option value="">' + escapeHtml(t("option.all")) + '</option>' + analysis.tracks.map((track) => '<option value="' + track.trackId + '">' + escapeHtml(formatTrackLabel(track)) + '</option>').join("");
  populateMetricsTrackFilter(analysis.tracks);
}

function renderTrackTable(tracks) {
  return '<table class="table"><thead><tr><th>' + escapeHtml(t("column.track")) + '</th><th>' + escapeHtml(t("column.handler")) + '</th><th>' + escapeHtml(t("column.codec")) + '</th><th>' + escapeHtml(t("column.duration")) + '</th><th>' + escapeHtml(t("column.media")) + '</th><th>' + escapeHtml(t("column.samples")) + '</th><th>' + escapeHtml(t("column.avgBitrate")) + '</th><th>' + escapeHtml(t("column.fpsSamples")) + '</th><th>' + escapeHtml(t("column.avgSample")) + '</th><th>' + escapeHtml(t("column.codecConfig")) + '</th></tr></thead><tbody>' +
    tracks.map((track) => {
      const summaryMetrics = getTrackSummaryMetrics(track);
      return '<tr><td>' + track.trackId + '</td><td>' + escapeHtml(track.handlerType) + '</td><td>' + escapeHtml(track.codec) + '</td><td>' +
        escapeHtml(formatTime(track.duration, track.timescale)) + '</td><td>' + escapeHtml(formatTrackMedia(track)) + '</td><td>' + track.sampleCount + '</td><td>' +
        escapeHtml(summaryMetrics ? formatBitsPerSecond(summaryMetrics.averageBitrate) : t("value.notAvailable")) + '</td><td>' +
        escapeHtml(summaryMetrics ? formatMetricNumber(summaryMetrics.sampleRate, 2) : t("value.notAvailable")) + '</td><td>' +
        escapeHtml(summaryMetrics ? formatBytes(summaryMetrics.averageSampleSize) : t("value.notAvailable")) + '</td><td>' +
        escapeHtml(formatTrackCodecConfig(track)) + '</td></tr>';
    }).join("") +
    '</tbody></table>';
}

function formatTrackLabel(track) {
  return t("field.track") + " " + track.trackId + " (" + track.handlerType + ")";
}

function formatTrackMedia(track) {
  if (track.handlerType === "vide") return track.width + "x" + track.height;
  if (track.handlerType === "soun") {
    const sampleRate = track.codecConfig && track.codecConfig.samplingFrequency ? track.codecConfig.samplingFrequency : track.sampleRate;
    const channels = track.codecConfig && track.codecConfig.channelDescription ? track.codecConfig.channelDescription : (track.channelCount ? track.channelCount + " channels" : "audio");
    return channels + (sampleRate ? " @ " + sampleRate + " Hz" : "");
  }
  return t("value.notAvailable");
}

function formatTrackCodecConfig(track) {
  const config = track.codecConfig;
  if (!config) return t("value.notAvailable");
  if (config.nalLengthSize) {
    const bitDepth = config.bitDepthLuma ? ", " + config.bitDepthLuma + "-bit" : "";
    return (config.codecString || track.codec) + ", NAL length " + config.nalLengthSize + bitDepth;
  }
  if (track.handlerType === "soun") {
    const codecString = config.codecString || track.codec;
    const objectType = config.audioObjectTypeName || track.codec;
    const channels = config.channelDescription || (track.channelCount ? track.channelCount + " channels" : "audio");
    return codecString + ", " + objectType + ", " + channels;
  }
  return config.codecString || track.codec;
}

function populateMetricsTrackFilter(tracks) {
  const currentValue = elements.metricsTrackFilter.value;
  const optionTracks = tracks;
  const defaultTrack = tracks.find((track) => track.handlerType === "vide") || tracks[0] || null;
  elements.metricsTrackFilter.innerHTML = optionTracks.length
    ? optionTracks.map((track) => '<option value="' + track.trackId + '">' + escapeHtml(formatTrackLabel(track) + " / " + track.codec) + '</option>').join("")
    : '<option value="">' + escapeHtml(t("option.noTrack")) + '</option>';
  if (currentValue && optionTracks.some((track) => String(track.trackId) === currentValue)) {
    elements.metricsTrackFilter.value = currentValue;
  } else if (defaultTrack) {
    elements.metricsTrackFilter.value = String(defaultTrack.trackId);
  }
}

function renderMetrics() {
  if (!state.analysis) return;
  const track = getSelectedMetricsTrack();
  if (!track) {
    elements.metricsBody.innerHTML = emptyHtml("empty.noTrackMetrics");
    return;
  }
  const rows = getRowsForTrack(track.trackId);
  if (!rows.length) {
    elements.metricsBody.innerHTML = emptyHtml("empty.noSamplesForTrack", { trackId: track.trackId });
    return;
  }
  const windowSize = getMetricsWindowSize();
  const pointLimit = getMetricsPointLimit();
  const metrics = buildTrackMetrics(track, rows, windowSize);
  elements.metricsBody.innerHTML = renderMetricsBody(track, metrics, pointLimit);
}

function getSelectedMetricsTrack() {
  if (!state.analysis) return null;
  const selectedTrackId = Number(elements.metricsTrackFilter.value);
  return state.analysis.tracks.find((track) => track.trackId === selectedTrackId) ||
    state.analysis.tracks.find((track) => track.handlerType === "vide") ||
    state.analysis.tracks[0] ||
    null;
}

function getRowsForTrack(trackId) {
  if (!state.analysis) return [];
  return state.analysis.sampleRows
    .filter((row) => row.trackId === trackId)
    .slice()
    .sort(compareRowsByPresentationTime);
}

function getMetricsWindowSize() {
  return Math.max(1, Math.min(5000, Math.floor(Number(elements.metricsWindowInput.value) || 1)));
}

function getMetricsPointLimit() {
  return Math.max(120, Math.min(2000, Math.floor(Number(elements.metricsPointLimitInput.value) || 900)));
}

function getTrackSummaryMetrics(track) {
  if (!state.analysis || !track) return null;
  const rows = getRowsForTrack(track.trackId);
  if (!rows.length) return null;
  const totalBytes = rows.reduce((sum, row) => sum + (Number(row.size) || 0), 0);
  const totalDuration = getRowsDurationSeconds(track, rows);
  if (!totalDuration) return null;
  return {
    averageBitrate: totalBytes * 8 / totalDuration,
    sampleRate: rows.length / totalDuration,
    averageSampleSize: totalBytes / rows.length
  };
}

function buildTrackMetrics(track, rows, windowSize) {
  const totalBytes = rows.reduce((sum, row) => sum + (Number(row.size) || 0), 0);
  const totalDuration = getRowsDurationSeconds(track, rows);
  const sizes = rows.map((row) => Number(row.size) || 0).sort((left, right) => left - right);
  const frameTypeCounts = new Map();
  for (const row of rows) {
    const frameType = row.frameType || getDefaultSampleFrameType(track) || "sample";
    frameTypeCounts.set(frameType, (frameTypeCounts.get(frameType) || 0) + 1);
  }
  const movingAveragePoints = buildMovingAveragePoints(track, rows, windowSize);
  const bitrateValues = movingAveragePoints.map((point) => point.bitrate).filter(Number.isFinite);
  const fpsValues = movingAveragePoints.map((point) => point.fps).filter(Number.isFinite);
  const syncRows = rows.filter((row) => row.isSync);
  const keyframeIntervals = [];
  for (let index = 1; index < syncRows.length; index += 1) {
    keyframeIntervals.push(Math.max(0, getRowTimeSeconds(syncRows[index]) - getRowTimeSeconds(syncRows[index - 1])));
  }
  return {
    rows,
    movingAveragePoints,
    summary: {
      durationSeconds: totalDuration,
      totalBytes,
      averageBitrate: totalDuration ? totalBytes * 8 / totalDuration : 0,
      averageFps: totalDuration ? rows.length / totalDuration : 0,
      averageSampleSize: rows.length ? totalBytes / rows.length : 0,
      minSampleSize: sizes.length ? sizes[0] : 0,
      medianSampleSize: getMedian(sizes),
      maxSampleSize: sizes.length ? sizes[sizes.length - 1] : 0,
      syncSamples: syncRows.length,
      averageKeyframeInterval: keyframeIntervals.length ? keyframeIntervals.reduce((sum, value) => sum + value, 0) / keyframeIntervals.length : 0,
      peakMovingBitrate: bitrateValues.length ? Math.max.apply(null, bitrateValues) : 0,
      peakMovingFps: fpsValues.length ? Math.max.apply(null, fpsValues) : 0
    },
    frameTypeCounts,
    topSizeRows: rows.slice().sort((left, right) => (right.size || 0) - (left.size || 0)).slice(0, 10)
  };
}

function buildMovingAveragePoints(track, rows, windowSize) {
  const points = [];
  const windowRows = [];
  let windowBytes = 0;
  let windowDuration = 0;
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const durationSeconds = getSampleDurationSeconds(row, track, rows, index);
    const size = Number(row.size) || 0;
    windowRows.push({ row, size, durationSeconds });
    windowBytes += size;
    windowDuration += durationSeconds;
    while (windowRows.length > windowSize) {
      const removed = windowRows.shift();
      windowBytes -= removed.size;
      windowDuration -= removed.durationSeconds;
    }
    const pointCount = windowRows.length;
    points.push({
      time: getRowTimeSeconds(row),
      bitrate: windowDuration > 0 ? windowBytes * 8 / windowDuration : 0,
      fps: windowDuration > 0 ? pointCount / windowDuration : 0,
      row
    });
  }
  return points;
}

function getSampleDurationSeconds(row, track, rows, index) {
  const timescale = Number(track && track.timescale);
  const duration = Number(row.duration);
  if (timescale > 0 && duration > 0) return duration / timescale;
  if (rows && index < rows.length - 1) {
    const diff = getRowTimeSeconds(rows[index + 1]) - getRowTimeSeconds(row);
    if (diff > 0) return diff;
  }
  return 0;
}

function getRowsDurationSeconds(track, rows) {
  const durationSum = rows.reduce((sum, row, index) => sum + getSampleDurationSeconds(row, track, rows, index), 0);
  if (durationSum > 0) return durationSum;
  const trackDuration = Number(track && track.duration);
  const timescale = Number(track && track.timescale);
  return trackDuration > 0 && timescale > 0 ? trackDuration / timescale : 0;
}

function getMedian(sortedValues) {
  if (!sortedValues.length) return 0;
  const middle = Math.floor(sortedValues.length / 2);
  return sortedValues.length % 2 ? sortedValues[middle] : (sortedValues[middle - 1] + sortedValues[middle]) / 2;
}

function renderMetricsBody(track, metrics, pointLimit) {
  const summary = metrics.summary;
  return [
    '<div class="metrics-summary-grid">',
    summaryCard(t("metrics.track"), formatTrackLabel(track) + " / " + track.codec),
    summaryCard(t("column.duration"), formatMetricNumber(summary.durationSeconds, 3) + "s"),
    summaryCard(t("column.avgBitrate"), formatBitsPerSecond(summary.averageBitrate)),
    summaryCard(track.handlerType === "vide" ? t("metrics.avgFps") : t("metrics.samplesPerSecond"), formatMetricNumber(summary.averageFps, 3)),
    summaryCard(t("metrics.peakMaBitrate"), formatBitsPerSecond(summary.peakMovingBitrate)),
    summaryCard(t("metrics.peakMaFps"), formatMetricNumber(summary.peakMovingFps, 3)),
    summaryCard(t("metrics.medianSample"), formatBytes(summary.medianSampleSize)),
    summaryCard(t("metrics.syncSamples"), String(summary.syncSamples)),
    '</div>',
    '<div class="metrics-chart-grid">',
    renderMetricChart(t("metrics.bitrateMovingAverage"), metrics.movingAveragePoints, "bitrate", pointLimit, formatBitsPerSecond, "bitrate"),
    renderMetricChart(track.handlerType === "vide" ? t("metrics.fpsMovingAverage") : t("metrics.sampleRateMovingAverage"), metrics.movingAveragePoints, "fps", pointLimit, (value) => formatMetricNumber(value, 3), "fps"),
    '</div>',
    '<div class="metrics-insights">',
    renderFrameTypeDistribution(metrics.frameTypeCounts, metrics.rows.length),
    renderTopSampleRows(metrics.topSizeRows),
    '</div>'
  ].join("");
}

function renderMetricChart(title, points, valueKey, pointLimit, formatter, className) {
  if (!points.length) return '<div class="metric-chart-card">' + emptyHtml("empty.noChartPoints") + '</div>';
  const chartPoints = downsamplePoints(points, pointLimit);
  const values = chartPoints.map((point) => Number(point[valueKey]) || 0);
  const maxValue = Math.max(1, Math.max.apply(null, values));
  const minTime = chartPoints[0].time;
  const maxTime = chartPoints[chartPoints.length - 1].time;
  const timeSpan = Math.max(0.000001, maxTime - minTime);
  const polylinePoints = chartPoints.map((point) => {
    const x = ((point.time - minTime) / timeSpan) * METRIC_CHART_WIDTH;
    const y = METRIC_CHART_HEIGHT - ((Number(point[valueKey]) || 0) / maxValue) * METRIC_CHART_HEIGHT;
    return x.toFixed(2) + "," + y.toFixed(2);
  }).join(" ");
  const axisRatios = [0, 0.25, 0.5, 0.75, 1];
  const gridLines = axisRatios.map((ratio) => {
    const y = METRIC_CHART_HEIGHT - ratio * METRIC_CHART_HEIGHT;
    return '<line class="metric-grid-line" x1="0" x2="' + METRIC_CHART_WIDTH + '" y1="' + y.toFixed(2) + '" y2="' + y.toFixed(2) + '"></line>';
  }).join("");
  const yAxisLabels = axisRatios.map((ratio) => {
    const topPercent = 100 - ratio * 100;
    const label = formatter(maxValue * ratio);
    const edgeClass = ratio === 0 ? " bottom" : ratio === 1 ? " top" : "";
    return '<span class="metric-y-axis-label' + edgeClass + '" style="top:' + topPercent.toFixed(2) + '%">' + escapeHtml(label) + '</span>';
  }).join("");
  return '<section class="metric-chart-card"><div class="metric-chart-head"><strong>' + escapeHtml(title) + '</strong><span>' + escapeHtml(t("metrics.chartMax", { value: formatter(maxValue), count: chartPoints.length })) + '</span></div>' +
    '<div class="metric-chart-body" aria-label="' + escapeHtml(title) + '">' +
    '<div class="metric-y-axis" aria-hidden="true">' + yAxisLabels + '</div>' +
    '<div class="metric-plot-area">' +
    '<svg class="metric-chart" viewBox="0 0 ' + METRIC_CHART_WIDTH + ' ' + METRIC_CHART_HEIGHT + '" preserveAspectRatio="none" role="img" aria-label="' + escapeHtml(title) + '">' +
    gridLines + '<polyline class="metric-line ' + escapeHtml(className) + '" points="' + polylinePoints + '"></polyline>' +
    '</svg></div>' +
    '<div class="metric-x-axis" aria-hidden="true"><span>' + escapeHtml(formatMetricNumber(minTime, 2)) + 's</span><span>' + escapeHtml(formatMetricNumber(maxTime, 2)) + 's</span></div>' +
    '</div></section>';
}

function downsamplePoints(points, limit) {
  if (points.length <= limit) return points;
  const result = [];
  const step = points.length / limit;
  for (let index = 0; index < limit; index += 1) {
    result.push(points[Math.min(points.length - 1, Math.floor(index * step))]);
  }
  return result;
}

function renderFrameTypeDistribution(frameTypeCounts, totalRows) {
  const entries = Array.from(frameTypeCounts.entries()).sort((left, right) => right[1] - left[1]);
  if (!entries.length) return '<section class="metric-section"><h3>' + escapeHtml(t("metrics.frameTypeDistribution")) + '</h3>' + emptyHtml("empty.noFrameTypeData") + '</section>';
  return '<section class="metric-section"><h3>' + escapeHtml(t("metrics.frameTypeDistribution")) + '</h3><div class="metric-type-list">' +
    entries.map(([frameType, count]) => {
      const ratio = totalRows ? count * 100 / totalRows : 0;
      return '<div class="metric-type-row"><span>' + escapeHtml(frameType) + '</span><div class="metric-type-bar"><span style="width:' + clamp(ratio, 0, 100).toFixed(2) + '%"></span></div><strong>' + count + '</strong></div>';
    }).join("") +
    '</div></section>';
}

function renderTopSampleRows(rows) {
  if (!rows.length) return '<section class="metric-section"><h3>' + escapeHtml(t("metrics.largestSamples")) + '</h3>' + emptyHtml("empty.noSamples") + '</section>';
  return '<section class="metric-section"><h3>' + escapeHtml(t("metrics.largestSamples")) + '</h3><table class="table"><thead><tr><th>' + escapeHtml(t("value.sample")) + '</th><th>' + escapeHtml(t("column.time")) + '</th><th>' + escapeHtml(t("column.size")) + '</th><th>' + escapeHtml(t("column.type")) + '</th></tr></thead><tbody>' +
    rows.map((row) => {
      const frameRowKey = getFrameRowKey(row);
      return '<tr class="metric-click-row" role="button" tabindex="0" data-frame-key="' + escapeHtml(frameRowKey) + '"><td>#' + row.sampleIndex + '</td><td>' +
        escapeHtml(formatGraphTime(row)) + '</td><td>' + escapeHtml(formatBytes(row.size || 0)) + '</td><td>' + escapeHtml(formatFrameTypeLabel(row.frameType || "sample")) + '</td></tr>';
    }).join("") +
    '</tbody></table></section>';
}

function renderFrames() {
  if (!state.analysis) return;
  const rows = applyFrameFilters(state.analysis.sampleRows);
  state.filteredRows = rows;
  state.graphRows = rows.slice().sort(compareRowsByPresentationTime);
  state.graphMaxSize = Math.max(1, ...state.graphRows.map((row) => row.size || 0));
  elements.frameCountText.textContent = t("count.rows", { count: rows.length });
  elements.frameSpacer.style.height = Math.max(1, rows.length * ROW_HEIGHT) + "px";
  elements.graphSpacer.style.height = Math.max(1, state.graphRows.length * GRAPH_ROW_HEIGHT) + "px";
  renderGraphAxis();
  const synchronizedRow = synchronizeFrameSelectionToPlayback({ force: true });
  if (!synchronizedRow) {
    if (state.selectedFrameKey && !rows.some((row) => getFrameRowKey(row) === state.selectedFrameKey)) state.selectedFrameKey = "";
    scheduleFrameRender();
  }
}

function compareRowsByPresentationTime(left, right) {
  const leftTime = getRowTimeSeconds(left);
  const rightTime = getRowTimeSeconds(right);
  if (leftTime !== rightTime) return leftTime - rightTime;
  if (left.trackId !== right.trackId) return left.trackId - right.trackId;
  return left.sampleIndex - right.sampleIndex;
}

function getRowTrack(row) {
  if (!state.analysis) return null;
  return state.analysis.tracks.find((track) => track.trackId === row.trackId) || null;
}

function getRowTimeSeconds(row) {
  const track = getRowTrack(row);
  if (!track || !track.timescale) return Number(row.pts || row.dts || row.sampleIndex || 0);
  return Number(row.pts || row.dts || 0) / Number(track.timescale);
}

function getRowDurationSeconds(row) {
  const track = getRowTrack(row);
  const rowDuration = Number(row.duration);
  if (!track || !track.timescale || !Number.isFinite(rowDuration) || rowDuration <= 0) return 0;
  return rowDuration / Number(track.timescale);
}

function renderGraphAxis() {
  const maxSize = state.graphMaxSize || 1;
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  elements.graphAxisScale.innerHTML = ticks.map((ratio) => {
    const value = Math.round(maxSize * ratio);
    return '<span class="axis-tick" style="left:' + (ratio * 100) + '%">' + escapeHtml(formatBytes(value)) + '</span>';
  }).join("");
  elements.graphAxisUnit.textContent = t("unit.max", { value: formatBytes(maxSize) });
}

function applyFrameFilters(rows) {
  const trackValue = elements.trackFilter.value;
  const typeValue = elements.typeFilter.value;
  const syncValue = elements.syncFilter.value;
  const minSize = elements.minSizeFilter.value === "" ? null : Number(elements.minSizeFilter.value);
  const maxSize = elements.maxSizeFilter.value === "" ? null : Number(elements.maxSizeFilter.value);
  const warningOnly = elements.warningOnlyFilter.checked;
  return rows.filter((row) => {
    if (trackValue && String(row.trackId) !== trackValue) return false;
    if (typeValue) {
      if (typeValue === "mixed") {
        if (!String(row.frameType).startsWith("mixed")) return false;
      } else if ((row.frameType || "unknown") !== typeValue) return false;
    }
    if (syncValue === "yes" && !row.isSync) return false;
    if (syncValue === "no" && row.isSync) return false;
    if (minSize !== null && row.size < minSize) return false;
    if (maxSize !== null && row.size > maxSize) return false;
    if (warningOnly && (!row.warnings || !row.warnings.length)) return false;
    return true;
  });
}

function scheduleFrameRender() {
  cancelAnimationFrame(state.renderFrameRequest);
  state.renderFrameRequest = requestAnimationFrame(() => {
    if (state.frameViewMode === "graph") renderVisibleGraphRows();
    else renderVisibleFrameRows();
  });
}

function renderVisibleFrameRows() {
  const rows = state.filteredRows;
  const scrollTop = Math.max(0, elements.frameWrap.scrollTop - FRAME_TABLE_HEADER_HEIGHT);
  const height = Math.max(1, (elements.frameWrap.clientHeight || 400) - FRAME_TABLE_HEADER_HEIGHT);
  const first = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 8);
  const last = Math.min(rows.length, Math.ceil((scrollTop + height) / ROW_HEIGHT) + 8);
  const html = [];
  for (let index = first; index < last; index += 1) {
    html.push(renderFrameRow(rows[index], index));
  }
  elements.frameSpacer.innerHTML = html.join("");
}

function renderVisibleGraphRows() {
  const rows = state.graphRows;
  const scrollTop = elements.graphScroller.scrollTop;
  const height = elements.graphScroller.clientHeight || 400;
  const first = Math.max(0, Math.floor(scrollTop / GRAPH_ROW_HEIGHT) - 10);
  const last = Math.min(rows.length, Math.ceil((scrollTop + height) / GRAPH_ROW_HEIGHT) + 10);
  const html = [];
  for (let index = first; index < last; index += 1) {
    html.push(renderGraphRow(rows[index], index));
  }
  elements.graphSpacer.innerHTML = html.join("");
}

function renderFrameRow(row, visualIndex) {
  const type = row.frameType || "unknown";
  const typeClass = getFrameTypeClass(type);
  const chunkOrFragment = row.fragmentIndex ? "frag " + row.fragmentIndex : row.chunkIndex ? "chunk " + row.chunkIndex : "";
  const frameRowKey = getFrameRowKey(row);
  const selectedClass = frameRowKey === state.selectedFrameKey ? " selected" : "";
  const ariaLabel = t("aria.seekFrame", { trackId: row.trackId, sampleIndex: row.sampleIndex, time: formatGraphTime(row) });
  return '<div class="frame-row' + selectedClass + '" role="button" tabindex="0" data-frame-key="' + escapeHtml(frameRowKey) + '" aria-label="' + escapeHtml(ariaLabel) + '" style="top:' + (visualIndex * ROW_HEIGHT) + 'px">' +
    '<div>' + row.sampleIndex + '</div><div>' + row.trackId + '</div><div><span class="pill ' + typeClass + '">' + escapeHtml(formatFrameTypeLabel(type)) + '</span></div><div title="' + escapeHtml(row.offset) + '">' + escapeHtml(row.offset) + '</div><div>' + row.size + '</div><div>' + row.dts + '</div><div>' + row.pts + '</div><div>' + row.duration + '</div><div>' + (row.isSync ? t("value.yes") : t("value.no")) + '</div><div title="' + escapeHtml(row.nalTypes.join(", ")) + '">' + escapeHtml(row.nalTypes.join(",")) + '</div><div>' + escapeHtml(chunkOrFragment) + '</div></div>';
}

function renderGraphRow(row, visualIndex) {
  const type = row.frameType || "unknown";
  const typeClass = getFrameTypeClass(type);
  const widthPercent = state.graphMaxSize ? clamp((row.size || 0) * 100 / state.graphMaxSize, 0, 100) : 0;
  const timeLabel = formatGraphTime(row);
  const frameRowKey = getFrameRowKey(row);
  const selectedClass = frameRowKey === state.selectedFrameKey ? " selected" : "";
  const ariaLabel = t("aria.seekFrame", { trackId: row.trackId, sampleIndex: row.sampleIndex, time: timeLabel });
  const title = [
    "track " + row.trackId + " sample " + row.sampleIndex,
    "PTS " + row.pts,
    "DTS " + row.dts,
    "size " + row.size + " bytes",
    "type " + type,
    "offset " + row.offset
  ].join(" | ");
  return '<div class="graph-row' + selectedClass + '" role="button" tabindex="0" data-frame-key="' + escapeHtml(frameRowKey) + '" aria-label="' + escapeHtml(ariaLabel) + '" style="top:' + (visualIndex * GRAPH_ROW_HEIGHT) + 'px" title="' + escapeHtml(title) + '">' +
    '<div class="graph-time"><span>' + escapeHtml(timeLabel) + '</span><strong>#' + row.sampleIndex + ' T' + row.trackId + '</strong></div>' +
    '<div class="graph-plot"><span class="graph-bar ' + typeClass + '" style="width:' + widthPercent.toFixed(4) + '%"></span></div>' +
    '<div class="graph-size">' + escapeHtml(formatBytes(row.size || 0)) + '</div>' +
    '</div>';
}

function formatFrameTypeLabel(type) {
  if (type === "unknown") return t("value.unknown");
  if (type === "audio") return t("value.audio");
  if (type === "sample") return t("value.sample");
  if (String(type).startsWith("mixed") && getLanguage() === "ko") return type.replace("mixed", "혼합");
  return type;
}

function formatGraphTime(row) {
  const track = getRowTrack(row);
  if (!track || !track.timescale) return String(row.pts || row.dts || row.sampleIndex);
  return formatTime(row.pts, track.timescale);
}

function renderFragments() {
  const analysis = state.analysis;
  const moofs = analysis.topBoxes.filter((box) => box.type === "moof");
  if (!moofs.length) {
    elements.fragmentsPanel.innerHTML = emptyHtml("empty.noMoof");
    return;
  }
  elements.fragmentsPanel.innerHTML = '<table class="table"><thead><tr><th>#</th><th>' + escapeHtml(t("column.offset")) + '</th><th>' + escapeHtml(t("column.size")) + '</th><th>traf</th><th>trun</th><th>' + escapeHtml(t("column.samples")) + '</th></tr></thead><tbody>' +
    moofs.map((moof, index) => {
      const trafs = (moof.children || []).filter((child) => child.type === "traf");
      const truns = findDescendants(moof, "trun", []);
      const samples = truns.reduce((sum, trun) => sum + (trun.fields.sampleCount || 0), 0);
      return '<tr><td>' + (index + 1) + '</td><td>' + escapeHtml(moof.offset) + '</td><td>' + escapeHtml(moof.size) + '</td><td>' + trafs.length + '</td><td>' + truns.length + '</td><td>' + samples + '</td></tr>';
    }).join("") + '</tbody></table>';
}

function renderWarnings() {
  const warnings = state.transientWarnings.slice();
  if (state.analysis) {
    warnings.push.apply(warnings, state.analysis.warnings.map(localizeWarning));
    for (const box of state.analysis.allBoxes) {
      for (const warning of box.warnings || []) warnings.push(box.path + ": " + localizeWarning(warning));
    }
    for (const row of state.analysis.sampleRows) {
      for (const warning of row.warnings || []) warnings.push(t("warning.prefixTrackSample", { trackId: row.trackId, sampleIndex: row.sampleIndex, warning: localizeWarning(warning) }));
    }
  }
  if (!warnings.length) {
    elements.warningsPanel.innerHTML = emptyHtml("empty.noWarnings");
    return;
  }
  elements.warningsPanel.innerHTML = '<div class="warning-list">' + warnings.map((warning) => '<div class="warning-item">' + escapeHtml(warning) + '</div>').join("") + '</div>';
}

function renderKv(values) {
  const entries = Array.isArray(values) ? values : Object.entries(values);
  return '<div class="kv">' + entries.map(([key, value]) => '<div>' + escapeHtml(key) + '</div><div>' + escapeHtml(String(value)) + '</div>').join("") + '</div>';
}

function localizeWarning(warning) {
  if (getLanguage() !== "ko") return warning;
  return String(warning)
    .replace("Sample offset missing.", "샘플 오프셋이 없습니다.")
    .replace("Fragment sample size is missing.", "프래그먼트 샘플 크기가 없습니다.")
    .replace("Payload too large to parse inline:", "payload가 너무 커서 inline 파싱하지 않았습니다:")
    .replace("Could not parse fields:", "필드를 파싱하지 못했습니다:")
    .replace("No moov box found. Fragment-only streams without init segment are not supported.", "moov 박스가 없습니다. init segment 없는 fragment-only stream은 지원하지 않습니다.")
    .replace("AVC sample entry has no avcC box.", "AVC sample entry에 avcC 박스가 없습니다.")
    .replace("HEVC sample entry has no hvcC box.", "HEVC sample entry에 hvcC 박스가 없습니다.")
    .replace("AAC sample entry has no esds AudioSpecificConfig.", "AAC sample entry에 esds AudioSpecificConfig가 없습니다.")
    .replace("scan failed:", "스캔 실패:");
}

function exportJson() {
  if (!state.analysis) return;
  const payload = {
    file: state.analysis.file,
    boxes: state.analysis.topBoxes,
    tracks: state.analysis.tracks.map((track) => ({
      trackId: track.trackId,
      handlerType: track.handlerType,
      codec: track.codec,
      timescale: track.timescale,
      duration: track.duration,
      width: track.width,
      height: track.height,
      channelCount: track.channelCount,
      sampleRate: track.sampleRate,
      sampleCount: track.sampleCount,
      codecDescriptor: track.codecDescriptor,
      codecConfig: track.codecConfig
    })),
    sampleRows: state.analysis.sampleRows,
    warnings: state.analysis.warnings
  };
  downloadText("mp4-analysis.json", JSON.stringify(payload, safeJsonReplacer, 2), "application/json");
}

function exportCsv() {
  if (!state.analysis) return;
  const header = ["trackId", "sampleIndex", "offset", "size", "dts", "pts", "duration", "isSync", "frameType", "nalTypes", "chunkIndex", "fragmentIndex", "warnings"];
  const lines = [header.join(",")];
  for (const row of state.analysis.sampleRows) {
    lines.push(header.map((key) => csvCell(Array.isArray(row[key]) ? row[key].join("|") : row[key])).join(","));
  }
  downloadText("mp4-samples.csv", lines.join("\n"), "text/csv");
}

function downloadText(filename, text, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

}
