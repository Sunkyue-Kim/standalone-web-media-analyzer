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
  getFrameTypeScanner,
  buildFrameInternalsColorScale,
  buildFrameInternalsModel
} from "../core/analyzer-core.js";
import {
  I18N,
  BOX_TYPE_I18N,
  getLanguage,
  setLanguage as setI18nLanguage,
  t
} from "../i18n/catalogs.js";
import { SAMPLE_FILES } from "../samples/sample-manifest.js";
import { createAnalysisWorkerClient } from "./analysis-worker-client.js";
import {
  createDataGridLayout,
  renderDataGridCells,
  renderDataGridHeaderCells,
  renderDataGridTable
} from "./data-grid.js";
import { createRecyclerView } from "./recycler-view.js";
import { downloadRemoteMediaFile, probeRemoteMediaResource } from "./remote-loader.js";
import { getVisibleSummaryCodecTrackCounts } from "./summary-model.js";
import {
  canUseSampleCatalogLocation,
  csvCell,
  escapeHtml,
  getFrameRowKey,
  getFrameTypeClass,
  isLikelyMediaFile,
  shouldDownloadRemoteOnceForSharedPlayback
} from "./ui-helpers.js";

export function startUserInterface(Core, options = {}) {
  if (typeof document === "undefined" || !document.getElementById) return;
const FRAME_TABLE_HEADER_HEIGHT = 34;
const FRAME_TABLE_MINIMUM_WIDTH = "1048px";
const SAMPLE_ENTRY_DERIVED_FIELD_NAMES = new Set(["codecDescriptor", "codecConfig", "esds"]);
const JSON_BYTE_PREVIEW_COUNT = 16;
const JSON_BYTE_EXPANDED_LIMIT = 2048;
const state = {
  analysis: null,
  language: options.initialLanguage || getLanguage(),
  activeTab: options.initialActiveTab || "summary",
  selectedBox: null,
  selectedFrameKey: "",
  selectedFragmentIndex: 0,
  filteredRows: [],
  graphRows: [],
  fragmentRows: [],
  frameViewMode: "table",
  graphMaxSize: 1,
  filePreviewUrl: "",
  filePreviewObjectUrl: false,
  dropHintHideTimer: 0,
  remoteAbortController: null,
  transientWarnings: [],
  progressSourceLabel: "Open or drop a media file to begin.",
  progressRawLabel: t("status.initial"),
  progressPercentValue: 0,
  lastPlaybackSynchronizationFrameKey: "",
  lastPlaybackSynchronizationFragmentIndex: 0,
  playbackSynchronizationRequestId: 0,
  playbackSynchronizationRequestType: "",
  boxTreeActivationCount: 0,
  lastBoxTreeActivation: null,
  frameInternalsTooltipTarget: null,
  frameInternalsColorScaleCache: new Map()
};

const elements = {
  fileInput: document.getElementById("fileInput"),
  languageSelect: document.getElementById("languageSelect"),
  sampleField: document.getElementById("sampleField"),
  sampleSelect: document.getElementById("sampleSelect"),
  openButton: document.getElementById("openButton"),
  openUrlButton: document.getElementById("openUrlButton"),
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
  summaryBody: document.getElementById("summaryBody"),
  boxesPanel: document.getElementById("boxesPanel"),
  tracksPanel: document.getElementById("tracksPanel"),
  tracksBody: document.getElementById("tracksBody"),
  framesPanel: document.getElementById("framesPanel"),
  metricsPanel: document.getElementById("metricsPanel"),
  fragmentsPanel: document.getElementById("fragmentsPanel"),
  fragmentsBody: document.getElementById("fragmentsBody"),
  fragmentCountText: document.getElementById("fragmentCountText"),
  warningsPanel: document.getElementById("warningsPanel"),
  warningsBody: document.getElementById("warningsBody"),
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
  fragmentPlaybackSynchronizationToggle: document.getElementById("fragmentPlaybackSynchronizationToggle"),
  clearFiltersButton: document.getElementById("clearFiltersButton"),
  frameGraphButton: document.getElementById("frameGraphButton"),
  frameTableButton: document.getElementById("frameTableButton"),
  frameCountText: document.getElementById("frameCountText"),
  frameGraphView: document.getElementById("frameGraphView"),
  frameTableView: document.getElementById("frameTableView"),
  frameInternalsPanel: document.getElementById("frameInternalsPanel"),
  frameInternalsBody: document.getElementById("frameInternalsBody"),
  frameInternalsTooltip: document.getElementById("frameInternalsTooltip"),
  frameWrap: document.getElementById("frameWrap"),
  frameHeader: document.getElementById("frameHeader"),
  frameScroller: document.getElementById("frameScroller"),
  frameSpacer: document.getElementById("frameSpacer"),
  graphAxisScale: document.getElementById("graphAxisScale"),
  graphAxisUnit: document.getElementById("graphAxisUnit"),
  graphScroller: document.getElementById("graphScroller"),
  graphSpacer: document.getElementById("graphSpacer"),
  metricsTrackFilter: document.getElementById("metricsTrackFilter"),
  metricsWindowInput: document.getElementById("metricsWindowInput"),
  metricsPointLimitInput: document.getElementById("metricsPointLimitInput"),
  metricsBody: document.getElementById("metricsBody"),
  remoteUrlModal: document.getElementById("remoteUrlModal"),
  remoteUrlForm: document.getElementById("remoteUrlForm"),
  remoteUrlInput: document.getElementById("remoteUrlInput"),
  remoteUrlStatus: document.getElementById("remoteUrlStatus"),
  remoteUrlCloseButton: document.getElementById("remoteUrlCloseButton"),
  remoteUrlCancelButton: document.getElementById("remoteUrlCancelButton"),
  remoteUrlSubmitButton: document.getElementById("remoteUrlSubmitButton")
};

const frameTableRecycler = createRecyclerView({
  scrollElement: elements.frameWrap,
  spacerElement: elements.frameSpacer,
  rowHeight: ROW_HEIGHT,
  overscan: 8,
  scrollTopOffset: FRAME_TABLE_HEADER_HEIGHT,
  viewportHeightOffset: FRAME_TABLE_HEADER_HEIGHT,
  renderRow: renderFrameRow
});

const frameGraphRecycler = createRecyclerView({
  scrollElement: elements.graphScroller,
  spacerElement: elements.graphSpacer,
  rowHeight: GRAPH_ROW_HEIGHT,
  overscan: 10,
  renderRow: renderGraphRow
});

const analysisWorkerClient = createAnalysisWorkerClient({ Core });

const devToolsApi = {
  getAnalysis: () => state.analysis,
  getFilteredRows: () => state.filteredRows,
  getSelectedFrameKey: () => state.selectedFrameKey,
  getSelectedFrameInternals: () => buildSelectedFrameInternalsModel(),
  getSelectedFragmentIndex: () => state.selectedFragmentIndex,
  getFragmentRows: () => state.fragmentRows.slice(),
  getSelectedBox: () => state.selectedBox,
  selectBoxByPath: (path) => selectBoxByPath(path),
  getBoxSelectionDebug: () => getBoxSelectionDebug(),
  activateFirstBoxForTest: () => {
    const firstRow = elements.boxTree.querySelector(".tree-row");
    return firstRow ? selectBoxByPath(firstRow.dataset.path, firstRow) : null;
  },
  setAutoPlaybackSynchronization: (enabled) => {
    elements.autoPlaybackSynchronizationToggle.checked = Boolean(enabled);
    state.lastPlaybackSynchronizationFrameKey = "";
    if (!elements.autoPlaybackSynchronizationToggle.checked) {
      if (!shouldRunPlaybackSynchronizationLoop()) stopPlaybackSynchronizationLoop();
      return "";
    }
    const row = synchronizeFrameSelectionToPlayback({ force: true });
    startPlaybackSynchronizationLoop();
    return row ? getFrameRowKey(row) : "";
  },
  getPlaybackSynchronizationDebug: () => ({
    requestType: state.playbackSynchronizationRequestType,
    requestId: state.playbackSynchronizationRequestId,
    shouldUseVideoFrameCallback: shouldUseVideoFramePlaybackSynchronization(),
    hasVideoTrack: hasVideoPlaybackSynchronizationTrack(),
    shouldRun: shouldRunPlaybackSynchronizationLoop()
  }),
  synchronizeFrameSelectionToPlayback: (playbackSeconds) => {
    if (Number.isFinite(Number(playbackSeconds))) elements.filePreview.currentTime = Number(playbackSeconds);
    elements.autoPlaybackSynchronizationToggle.checked = true;
    state.lastPlaybackSynchronizationFrameKey = "";
    const row = synchronizeFrameSelectionToPlayback({ force: true });
    startPlaybackSynchronizationLoop();
    return row ? {
      frameKey: getFrameRowKey(row),
      row,
      frameScrollTop: elements.frameWrap.scrollTop,
      graphScrollTop: elements.graphScroller.scrollTop
    } : null;
  },
  synchronizeFragmentSelectionToPlayback: (playbackSeconds) => {
    if (Number.isFinite(Number(playbackSeconds))) elements.filePreview.currentTime = Number(playbackSeconds);
    elements.fragmentPlaybackSynchronizationToggle.checked = true;
    state.lastPlaybackSynchronizationFragmentIndex = 0;
    const fragment = synchronizeFragmentSelectionToPlayback({ force: true });
    startPlaybackSynchronizationLoop();
    return fragment;
  },
  selectFragmentByIndex: (fragmentIndex) => activateFragmentByIndex(Number(fragmentIndex)),
  getMetricsSummary: () => {
    const track = getSelectedMetricsTrack();
    if (!track) return null;
    const rows = getRowsForTrack(track.trackId);
    return buildTrackMetrics(track, rows, getMetricsWindowSize()).summary;
  },
  getMetricsDebug: () => {
    const track = getSelectedMetricsTrack();
    if (!track) return null;
    const rows = getRowsForTrack(track.trackId);
    const windowSize = getMetricsWindowSize();
    const metrics = buildTrackMetrics(track, rows, windowSize);
    return {
      trackId: track.trackId,
      windowSize,
      rows: rows.length,
      movingAveragePointCount: metrics.movingAveragePoints.length,
      firstMovingAveragePoint: metrics.movingAveragePoints[0] || null,
      lastMovingAveragePoint: metrics.movingAveragePoints[metrics.movingAveragePoints.length - 1] || null,
      summary: metrics.summary
    };
  },
  runSmokeTests: () => Core.runParserSelfTests(),
  canUseSamples: () => canUseSampleCatalog(),
  getSamples: () => canUseSampleCatalog() ? SAMPLE_FILES.slice() : [],
  loadSample: (sampleId) => loadSampleById(sampleId),
  loadRemoteUrl: (url) => loadRemoteUrl(url),
  openRemoteUrlModal: () => openRemoteUrlModal(),
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

window.MP4AnalyzerDevTools = devToolsApi;

populateSampleSelect();
elements.languageSelect.addEventListener("change", () => setLanguage(elements.languageSelect.value));
elements.sampleSelect.addEventListener("change", () => {
  if (canUseSampleCatalog() && elements.sampleSelect.value) loadSampleById(elements.sampleSelect.value);
});
elements.openButton.addEventListener("click", () => elements.fileInput.click());
elements.openUrlButton.addEventListener("click", openRemoteUrlModal);
elements.fileInput.addEventListener("change", () => {
  const file = elements.fileInput.files && elements.fileInput.files[0];
  if (file) startAnalysis(file);
});
elements.remoteUrlForm.addEventListener("submit", handleRemoteUrlSubmit);
elements.remoteUrlCloseButton.addEventListener("click", closeRemoteUrlModal);
elements.remoteUrlCancelButton.addEventListener("click", closeRemoteUrlModal);
elements.remoteUrlModal.addEventListener("click", (event) => {
  if (event.target === elements.remoteUrlModal) closeRemoteUrlModal();
});
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !elements.remoteUrlModal.hidden) closeRemoteUrlModal();
  if (event.key === "Escape") hideFrameInternalsTooltip();
});

window.addEventListener("dragenter", handleWindowDragEnter, true);
window.addEventListener("dragover", handleWindowDragOver, true);
window.addEventListener("dragleave", handleWindowDragLeave, true);
window.addEventListener("dragend", hideDropOverlay, true);
window.addEventListener("drop", handleWindowDrop, true);
window.addEventListener("resize", hideFrameInternalsTooltip);
window.addEventListener("scroll", hideFrameInternalsTooltip, true);

for (const tabButton of document.querySelectorAll(".tab")) {
  tabButton.addEventListener("click", () => setActiveTab(tabButton.dataset.tab));
}

elements.boxTree.addEventListener("click", handleBoxTreeClick);
elements.boxTree.addEventListener("pointerup", handleBoxTreePointerUp);
elements.boxTree.addEventListener("keydown", handleBoxTreeKeyDown);
document.addEventListener("click", handleDocumentBoxTreeClick, true);
document.addEventListener("pointerup", handleDocumentBoxTreePointerUp, true);

elements.cancelButton.addEventListener("click", () => {
  if (state.remoteAbortController) state.remoteAbortController.abort();
  analysisWorkerClient.cancel();
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
elements.frameInternalsBody.addEventListener("pointerover", handleFrameInternalsTooltipPointerOver);
elements.frameInternalsBody.addEventListener("pointermove", handleFrameInternalsTooltipPointerMove);
elements.frameInternalsBody.addEventListener("pointerout", handleFrameInternalsTooltipPointerOut);
elements.frameInternalsBody.addEventListener("focusin", handleFrameInternalsTooltipFocusIn);
elements.frameInternalsBody.addEventListener("focusout", hideFrameInternalsTooltip);
elements.frameInternalsBody.addEventListener("scroll", hideFrameInternalsTooltip);
elements.frameSpacer.addEventListener("click", handleFrameRowPointerActivation);
elements.graphSpacer.addEventListener("click", handleFrameRowPointerActivation);
elements.metricsBody.addEventListener("click", handleFrameRowPointerActivation);
elements.fragmentsBody.addEventListener("click", handleFragmentRowPointerActivation);
elements.frameSpacer.addEventListener("keydown", handleFrameRowKeyboardActivation);
elements.graphSpacer.addEventListener("keydown", handleFrameRowKeyboardActivation);
elements.metricsBody.addEventListener("keydown", handleFrameRowKeyboardActivation);
elements.fragmentsBody.addEventListener("keydown", handleFragmentRowKeyboardActivation);
elements.frameGraphButton.addEventListener("click", () => setFrameViewMode("graph"));
elements.frameTableButton.addEventListener("click", () => setFrameViewMode("table"));
elements.autoPlaybackSynchronizationToggle.addEventListener("change", () => {
  state.lastPlaybackSynchronizationFrameKey = "";
  if (elements.autoPlaybackSynchronizationToggle.checked) {
    synchronizeFrameSelectionToPlayback({ force: true });
    startPlaybackSynchronizationLoop();
  } else {
    if (!shouldRunPlaybackSynchronizationLoop()) stopPlaybackSynchronizationLoop();
  }
});
elements.fragmentPlaybackSynchronizationToggle.addEventListener("change", () => {
  state.lastPlaybackSynchronizationFragmentIndex = 0;
  if (elements.fragmentPlaybackSynchronizationToggle.checked) {
    synchronizeFragmentSelectionToPlayback({ force: true });
    startPlaybackSynchronizationLoop();
  } else {
    if (!shouldRunPlaybackSynchronizationLoop()) stopPlaybackSynchronizationLoop();
  }
});
elements.filePreview.addEventListener("timeupdate", () => synchronizeSelectionsToPlayback());
elements.filePreview.addEventListener("play", startPlaybackSynchronizationLoop);
elements.filePreview.addEventListener("playing", startPlaybackSynchronizationLoop);
elements.filePreview.addEventListener("pause", () => {
  stopPlaybackSynchronizationLoop();
  synchronizeSelectionsToPlayback({ force: true });
});
elements.filePreview.addEventListener("ended", () => {
  stopPlaybackSynchronizationLoop();
  synchronizeSelectionsToPlayback({ force: true });
});
elements.filePreview.addEventListener("seeking", () => synchronizeSelectionsToPlayback({ force: true }));
elements.filePreview.addEventListener("seeked", () => synchronizeSelectionsToPlayback({ force: true }));
elements.filePreview.addEventListener("loadedmetadata", () => synchronizeSelectionsToPlayback({ force: true }));
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

setLanguage(options.initialLanguage || elements.languageSelect.value || "en");
if (options.initialActiveTab) setActiveTab(options.initialActiveTab);
if (options.initialFile) Promise.resolve().then(() => startAnalysis(options.initialFile));
if (options.initialSampleId) Promise.resolve().then(() => loadSampleById(options.initialSampleId));
if (options.initialOpenRemoteUrlModal) Promise.resolve().then(openRemoteUrlModal);

return devToolsApi;

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
    elements.summaryBody.innerHTML = emptyHtml("empty.summary");
    elements.boxDetail.innerHTML = emptyHtml("empty.boxDetailInitial");
    elements.tracksBody.innerHTML = emptyHtml("empty.noTracks");
    elements.metricsBody.innerHTML = emptyHtml("empty.metrics");
    state.fragmentRows = [];
    elements.fragmentsBody.innerHTML = emptyHtml("empty.noFragments");
    elements.fragmentCountText.textContent = t("count.rows", { count: 0 });
    elements.warningsBody.innerHTML = emptyHtml("empty.noWarnings");
    elements.frameCountText.textContent = t("count.rows", { count: 0 });
    elements.graphAxisUnit.textContent = t("unit.bytes");
    renderFrameInternals();
    renderFrameTableLayout([]);
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
    await loadRemoteUrl(sample.path, {
      name: sample.fileName,
      type: sample.type || "video/mp4",
      keepSampleSelection: true,
      loadingLabel: t("status.loadingSample", { name: label }),
      failureStatusKey: "status.sampleLoadFailed",
      failureWarningKey: "warning.sampleLoadFailed"
    });
  } catch (_) {
    // The loadRemoteUrl path already rendered the user-visible failure state.
  }
}

function openRemoteUrlModal() {
  elements.remoteUrlStatus.classList.remove("error");
  elements.remoteUrlStatus.textContent = t("remote.statusIdle");
  elements.remoteUrlModal.hidden = false;
  elements.remoteUrlModal.setAttribute("aria-hidden", "false");
  setTimeout(() => elements.remoteUrlInput.focus(), 0);
}

function closeRemoteUrlModal() {
  elements.remoteUrlModal.hidden = true;
  elements.remoteUrlModal.setAttribute("aria-hidden", "true");
}

async function handleRemoteUrlSubmit(event) {
  event.preventDefault();
  const url = elements.remoteUrlInput.value;
  elements.remoteUrlStatus.classList.remove("error");
  elements.remoteUrlStatus.textContent = t("status.probingRemoteUrl");
  try {
    closeRemoteUrlModal();
    await loadRemoteUrl(url);
  } catch (error) {
    openRemoteUrlModal();
    elements.remoteUrlStatus.classList.add("error");
    elements.remoteUrlStatus.textContent = error && error.message ? error.message : String(error);
  }
}

async function loadRemoteUrl(url, options = {}) {
  const abortController = new AbortController();
  state.remoteAbortController = abortController;
  const failureStatusKey = options.failureStatusKey || "status.remoteLoadFailed";
  const failureWarningKey = options.failureWarningKey || "warning.remoteLoadFailed";
  try {
    state.transientWarnings = [];
    setBusy(true);
    setProgress(options.loadingLabel || t("status.probingRemoteUrl"), 3);
    const probe = await probeRemoteMediaResource(url, {
      baseUrl: window.location.href,
      name: options.name,
      type: options.type,
      signal: abortController.signal
    });
    if (probe.canStream) {
      setProgress(t("status.remoteRangeReady"), 8);
      let sharedDownloadWarning = "";
      if (shouldDownloadRemoteOnceForSharedPlayback(probe.resource, options)) {
        try {
          setProgress(t("status.remoteSharedDownload"), 8);
          const file = await downloadRemoteMediaFile(probe.resource.url, probe.resource, {
            baseUrl: window.location.href,
            signal: abortController.signal,
            onProgress: (loadedBytes, totalBytes) => {
              const percent = totalBytes ? 8 + (loadedBytes * 52 / totalBytes) : 12;
              setProgress(t("status.remoteSharedDownload"), percent);
            }
          });
          await startAnalysis(file, {
            keepSampleSelection: options.keepSampleSelection,
            rethrow: true
          });
          return file;
        } catch (downloadError) {
          if (isCancellationError(downloadError)) throw downloadError;
          sharedDownloadWarning = t("warning.remoteSharedDownloadFailed", {
            message: getErrorMessage(downloadError)
          });
        }
      }
      const streamingWarnings = [t("warning.remotePreviewDeferred")];
      if (sharedDownloadWarning) streamingWarnings.push(sharedDownloadWarning);
      try {
        await startAnalysis(probe.resource, {
          keepSampleSelection: options.keepSampleSelection,
          previewUrl: probe.resource.previewUrl,
          initialWarnings: streamingWarnings,
          rethrow: true
        });
        return probe.resource;
      } catch (streamError) {
        if (isCancellationError(streamError)) throw streamError;
        probe.canStream = false;
        probe.fallback = {
          url: probe.resource.url,
          name: probe.resource.name,
          type: probe.resource.type,
          size: probe.resource.size
        };
        probe.fallbackReason = streamError && streamError.message ? streamError.message : String(streamError);
      }
    }
    const fallbackWarning = t("warning.remoteRangeFallback", { reason: probe.fallbackReason });
    state.transientWarnings = [fallbackWarning];
    setProgress(t("status.remoteRangeFallback"), 8);
    const file = await downloadRemoteMediaFile(probe.fallback.url, probe.fallback, {
      baseUrl: window.location.href,
      signal: abortController.signal,
      onProgress: (loadedBytes, totalBytes) => {
        const percent = totalBytes ? 8 + (loadedBytes * 52 / totalBytes) : 12;
        setProgress(t("status.downloadingRemote"), percent);
      }
    });
    await startAnalysis(file, {
      keepSampleSelection: options.keepSampleSelection,
      initialWarnings: [fallbackWarning],
      rethrow: true
    });
    return file;
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    setBusy(false);
    state.transientWarnings = [t(failureWarningKey, { message })];
    setProgress(t(failureStatusKey, { message }), 0);
    renderWarnings();
    throw error;
  } finally {
    if (state.remoteAbortController === abortController) state.remoteAbortController = null;
  }
}

function isCancellationError(error) {
  return Boolean(error && /cancelled|aborted/i.test(error.message || ""));
}

function getErrorMessage(error) {
  return error && error.message ? error.message : String(error);
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

function handleFragmentRowPointerActivation(event) {
  const rowElement = event.target.closest("[data-fragment-index]");
  if (!rowElement) return;
  activateFragmentByIndex(Number(rowElement.dataset.fragmentIndex));
}

function handleFragmentRowKeyboardActivation(event) {
  if (event.key !== "Enter" && event.key !== " ") return;
  const rowElement = event.target.closest("[data-fragment-index]");
  if (!rowElement) return;
  event.preventDefault();
  activateFragmentByIndex(Number(rowElement.dataset.fragmentIndex));
}

function findFrameRowByKey(frameKey) {
  if (!state.analysis || !frameKey) return null;
  return state.analysis.sampleRows.find((row) => getFrameRowKey(row) === frameKey) || null;
}

function activateFrameRow(row) {
  state.selectedFrameKey = getFrameRowKey(row);
  const previousFragmentIndex = state.selectedFragmentIndex;
  synchronizeFragmentSelectionToFrameRow(row);
  seekPreviewToFrameRow(row);
  scheduleFrameRender();
  renderFrameInternals();
  if (previousFragmentIndex !== state.selectedFragmentIndex) renderFragments();
}

function activateFragmentByIndex(fragmentIndex) {
  if (!Number.isFinite(fragmentIndex)) return null;
  const fragment = findFragmentRowByIndex(fragmentIndex);
  if (!fragment) return null;
  state.selectedFragmentIndex = fragment.fragmentIndex;
  state.lastPlaybackSynchronizationFragmentIndex = fragment.fragmentIndex;
  if (fragment.startFrameRow) {
    state.selectedFrameKey = getFrameRowKey(fragment.startFrameRow);
    seekPreviewToFragment(fragment);
  }
  renderFragments();
  scheduleFrameRender();
  renderFrameInternals();
  return fragment;
}

function findFragmentRowByIndex(fragmentIndex) {
  return ensureFragmentRows().find((fragment) => fragment.fragmentIndex === fragmentIndex) || null;
}

function seekPreviewToFrameRow(row) {
  seekPreviewToSeconds(getRowTimeSeconds(row));
}

function seekPreviewToFragment(fragment) {
  const fragmentStartSeconds = Number(fragment && fragment.startTimeSeconds);
  if (Number.isFinite(fragmentStartSeconds)) {
    seekPreviewToSeconds(fragmentStartSeconds);
    return;
  }
  if (fragment && fragment.startFrameRow) seekPreviewToFrameRow(fragment.startFrameRow);
}

function seekPreviewToSeconds(timeSeconds) {
  if (!elements.filePreview || !elements.filePreview.src) return;
  if (!Number.isFinite(timeSeconds)) return;
  const seekSeconds = Math.max(0, timeSeconds);
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

function startPlaybackSynchronizationLoop() {
  if (state.playbackSynchronizationRequestId || !shouldRunPlaybackSynchronizationLoop()) return;
  requestNextPlaybackSynchronizationStep();
}

function stopPlaybackSynchronizationLoop() {
  if (!state.playbackSynchronizationRequestId) return;
  if (
    state.playbackSynchronizationRequestType === "video-frame" &&
    typeof elements.filePreview.cancelVideoFrameCallback === "function"
  ) {
    elements.filePreview.cancelVideoFrameCallback(state.playbackSynchronizationRequestId);
  } else {
    cancelAnimationFrame(state.playbackSynchronizationRequestId);
  }
  state.playbackSynchronizationRequestId = 0;
  state.playbackSynchronizationRequestType = "";
}

function requestNextPlaybackSynchronizationStep() {
  if (shouldUseVideoFramePlaybackSynchronization()) {
    state.playbackSynchronizationRequestType = "video-frame";
    state.playbackSynchronizationRequestId = elements.filePreview.requestVideoFrameCallback(runPlaybackSynchronizationStep);
    return;
  }
  state.playbackSynchronizationRequestType = "animation-frame";
  state.playbackSynchronizationRequestId = requestAnimationFrame(runPlaybackSynchronizationStep);
}

function shouldUseVideoFramePlaybackSynchronization() {
  return Boolean(
    hasVideoPlaybackSynchronizationTrack() &&
    typeof elements.filePreview.requestVideoFrameCallback === "function"
  );
}

function hasVideoPlaybackSynchronizationTrack() {
  return Boolean(
    state.analysis &&
    Array.isArray(state.analysis.tracks) &&
    state.analysis.tracks.some((track) => track.handlerType === "vide")
  );
}

function runPlaybackSynchronizationStep() {
  state.playbackSynchronizationRequestId = 0;
  state.playbackSynchronizationRequestType = "";
  synchronizeSelectionsToPlayback();
  if (shouldRunPlaybackSynchronizationLoop()) requestNextPlaybackSynchronizationStep();
}

function shouldRunPlaybackSynchronizationLoop() {
  return Boolean(
    (elements.autoPlaybackSynchronizationToggle.checked || elements.fragmentPlaybackSynchronizationToggle.checked) &&
    elements.filePreview &&
    elements.filePreview.src &&
    elements.filePreview.paused === false &&
    !elements.filePreview.ended
  );
}

function synchronizeSelectionsToPlayback(options = {}) {
  return {
    frame: synchronizeFrameSelectionToPlayback(options),
    fragment: synchronizeFragmentSelectionToPlayback(options)
  };
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
  const previousFragmentIndex = state.selectedFragmentIndex;
  synchronizeFragmentSelectionToFrameRow(row);
  scrollSynchronizedFrameRowIntoView(row);
  scheduleFrameRender();
  renderFrameInternals();
  if (previousFragmentIndex !== state.selectedFragmentIndex) renderFragments();
  return row;
}

function synchronizeFragmentSelectionToPlayback(options = {}) {
  if (!state.analysis || !elements.fragmentPlaybackSynchronizationToggle.checked) return null;
  const playbackSeconds = Number(elements.filePreview.currentTime);
  if (!Number.isFinite(playbackSeconds)) return null;
  const fragment = findFragmentForPlaybackTime(playbackSeconds);
  if (!fragment) return null;
  const shouldUpdate = options.force ||
    fragment.fragmentIndex !== state.selectedFragmentIndex ||
    fragment.fragmentIndex !== state.lastPlaybackSynchronizationFragmentIndex;
  if (!shouldUpdate) return fragment;
  state.selectedFragmentIndex = fragment.fragmentIndex;
  state.lastPlaybackSynchronizationFragmentIndex = fragment.fragmentIndex;
  if (fragment.startFrameRow && !elements.autoPlaybackSynchronizationToggle.checked) {
    state.selectedFrameKey = getFrameRowKey(fragment.startFrameRow);
    scheduleFrameRender();
    renderFrameInternals();
  }
  renderFragments();
  return fragment;
}

function synchronizeFragmentSelectionToFrameRow(row) {
  const fragmentIndex = Number(row && row.fragmentIndex);
  if (!Number.isFinite(fragmentIndex) || fragmentIndex <= 0) return null;
  const fragment = findFragmentRowByIndex(fragmentIndex);
  if (!fragment) return null;
  state.selectedFragmentIndex = fragment.fragmentIndex;
  state.lastPlaybackSynchronizationFragmentIndex = fragment.fragmentIndex;
  return fragment;
}

function findFragmentForPlaybackTime(playbackSeconds) {
  const fragmentRows = ensureFragmentRows();
  if (!fragmentRows.length) return null;
  let bestFragment = null;
  let bestDistance = Infinity;
  for (const fragment of fragmentRows) {
    if (!Number.isFinite(fragment.startTimeSeconds) || !Number.isFinite(fragment.endTimeSeconds)) continue;
    const endTimeSeconds = Math.max(fragment.endTimeSeconds, fragment.startTimeSeconds + 0.000001);
    const distance = playbackSeconds >= fragment.startTimeSeconds && playbackSeconds < endTimeSeconds
      ? 0
      : Math.min(Math.abs(playbackSeconds - fragment.startTimeSeconds), Math.abs(playbackSeconds - endTimeSeconds));
    if (distance < bestDistance) {
      bestFragment = fragment;
      bestDistance = distance;
    }
  }
  return bestFragment;
}

function ensureFragmentRows() {
  if (!state.fragmentRows.length && state.analysis) state.fragmentRows = buildFragmentRows(state.analysis);
  return state.fragmentRows;
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
  frameTableRecycler.scrollRowIntoCenter(rowIndex);
}

function scrollGraphFrameRowIntoCenter(row) {
  const rowIndex = findRowIndexByKey(state.graphRows, getFrameRowKey(row));
  if (rowIndex < 0) return;
  frameGraphRecycler.scrollRowIntoCenter(rowIndex);
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
    const analysis = await analysisWorkerClient.analyzeFile(file, { onProgress: setProgress });
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
    elements.summaryBody.innerHTML = emptyHtml("status.failed", { message: error.message });
    if (options.rethrow) throw error;
  }
}

async function scanCurrentAnalysis() {
  setBusy(true);
  elements.scanButton.disabled = true;
  try {
    const analysis = await analysisWorkerClient.scanFrameTypes(state.analysis, { onProgress: setProgress });
    state.analysis = analysis;
    state.frameInternalsColorScaleCache = new Map();
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
  elements.openUrlButton.disabled = isBusy;
  elements.remoteUrlSubmitButton.disabled = isBusy;
  elements.sampleSelect.disabled = isBusy || !canUseSampleCatalog();
}

function resetView(file, options = {}) {
  stopPlaybackSynchronizationLoop();
  state.analysis = null;
  state.selectedBox = null;
  state.selectedFrameKey = "";
  state.selectedFragmentIndex = 0;
  state.lastPlaybackSynchronizationFrameKey = "";
  state.lastPlaybackSynchronizationFragmentIndex = 0;
  state.fragmentRows = [];
  state.frameInternalsColorScaleCache = new Map();
  state.transientWarnings = options.initialWarnings ? options.initialWarnings.slice() : [];
  if (!options.keepSampleSelection && elements.sampleSelect) elements.sampleSelect.value = "";
  setFilePreview(file, options);
  elements.boxTree.innerHTML = "";
  elements.summaryBody.innerHTML = emptyHtml("empty.parsingStructure");
  elements.boxDetail.innerHTML = emptyHtml("empty.selectBox");
  elements.tracksBody.innerHTML = emptyHtml("empty.noTracks");
  elements.fragmentsBody.innerHTML = emptyHtml("empty.noFragments");
  elements.fragmentCountText.textContent = t("count.rows", { count: 0 });
  elements.warningsBody.innerHTML = emptyHtml("empty.noWarnings");
  elements.metricsBody.innerHTML = emptyHtml("empty.parsingMetrics");
  elements.frameWrap.scrollTop = 0;
  elements.frameWrap.scrollLeft = 0;
  renderFrameTableLayout([]);
  frameTableRecycler.setRows([]);
  frameTableRecycler.renderNow();
  frameGraphRecycler.setRows([]);
  frameGraphRecycler.renderNow();
  elements.graphAxisScale.innerHTML = "";
  elements.graphAxisUnit.textContent = t("unit.bytes");
  elements.frameCountText.textContent = t("count.rows", { count: 0 });
  renderFrameInternals();
  elements.trackFilter.innerHTML = '<option value="">' + escapeHtml(t("option.all")) + '</option>';
  elements.metricsTrackFilter.innerHTML = '<option value="">' + escapeHtml(t("option.noTrack")) + '</option>';
  elements.scanButton.disabled = true;
  elements.exportJsonButton.disabled = true;
  elements.exportCsvButton.disabled = true;
  setProgress("Reading " + file.name, 0);
}

function setFilePreview(file, options = {}) {
  if (state.filePreviewUrl && state.filePreviewObjectUrl) URL.revokeObjectURL(state.filePreviewUrl);
  state.filePreviewObjectUrl = false;
  state.filePreviewUrl = options.previewUrl || file.previewUrl || "";
  if (!state.filePreviewUrl) {
    state.filePreviewUrl = URL.createObjectURL(file);
    state.filePreviewObjectUrl = true;
  }
  elements.filePreview.preload = "metadata";
  elements.filePreview.title = "";
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
    const rowEnd = (getFirstFiniteNumber([row.pts, row.dts], 0) + Number(row.duration || 0)) / timescale;
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
  if (tabName === "fragments") renderFragments();
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
  const cards = [
    summaryCard(t("summary.fileSize"), formatBytes(analysis.file.size)),
    summaryCard(t("summary.tracks"), String(analysis.tracks.length)),
    summaryCard(t("summary.videoTracks"), String(videoTracks)),
    summaryCard(t("summary.audioTracks"), String(audioTracks)),
    summaryCard(t("summary.fragments"), String(fragments)),
    summaryCard(t("summary.samples"), String(analysis.sampleRows.length))
  ];
  for (const codecTrackCount of getVisibleSummaryCodecTrackCounts(analysis.tracks)) {
    cards.push(summaryCard(t(codecTrackCount.labelKey), String(codecTrackCount.count)));
  }
  cards.push(summaryCard(t("summary.warnings"), String(analysis.warnings.length)));
  elements.summaryBody.innerHTML = [
    '<div class="summary-grid">',
    cards.join(""),
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
  const children = getBoxNodeChildren(node);
  const childHtml = children.length ? '<div class="tree-children">' + children.map(renderBoxNode).join("") + '</div>' : "";
  const syntheticClassName = node.synthetic ? " synthetic" : "";
  const syntheticAttribute = node.synthetic ? ' data-synthetic-box="true"' : "";
  return '<div class="tree-node"><button type="button" class="tree-row' + syntheticClassName + '" data-path="' + escapeHtml(node.path) + '"' + syntheticAttribute + ' title="' + escapeHtml(formatBoxTypeLabel(node.type)) + '">' +
    '<span class="type">' + escapeHtml(node.type) + '</span><span class="size">' + escapeHtml(formatBoxNodeSize(node)) + '</span></button>' + childHtml + '</div>';
}

function handleBoxTreeClick(event) {
  activateBoxTreeEvent(event);
}

function handleBoxTreePointerUp(event) {
  if (event.button !== undefined && event.button !== 0) return;
  activateBoxTreeEvent(event);
}

function handleDocumentBoxTreeClick(event) {
  activateBoxTreeEvent(event);
}

function handleDocumentBoxTreePointerUp(event) {
  if (event.button !== undefined && event.button !== 0) return;
  activateBoxTreeEvent(event);
}

function handleBoxTreeKeyDown(event) {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  activateBoxTreeEvent(event);
}

function activateBoxTreeEvent(event) {
  if (event.__boxTreeSelectionHandled) return;
  const row = findClosestElement(event.target, ".tree-row");
  if (!row || !state.analysis || !isBoxTreeRow(row)) return;
  event.__boxTreeSelectionHandled = true;
  if (typeof event.preventDefault === "function") event.preventDefault();
  selectBoxByPath(row.dataset.path, row);
  setActiveTab("boxes");
}

function findClosestElement(target, selector) {
  const element = target && target.nodeType === 1 ? target : target && target.parentElement;
  return element && typeof element.closest === "function" ? element.closest(selector) : null;
}

function selectBoxByPath(path, row) {
  if (!state.analysis || !path) return null;
  state.boxTreeActivationCount += 1;
  state.lastBoxTreeActivation = {
    path,
    hadRow: Boolean(row),
    rowInTree: Boolean(row && isBoxTreeRow(row)),
    matched: false
  };
  state.selectedBox = findBoxByPath(path);
  state.lastBoxTreeActivation.matched = Boolean(state.selectedBox);
  const selectedRow = row || Array.from(elements.boxTree.querySelectorAll(".tree-row")).find((node) => node.dataset.path === path) || null;
  for (const node of elements.boxTree.querySelectorAll(".tree-row")) node.classList.toggle("selected", node === selectedRow);
  renderSelectedBox();
  return state.selectedBox;
}

function isBoxTreeRow(row) {
  return Boolean(row && elements.boxTree && typeof elements.boxTree.contains === "function" && elements.boxTree.contains(row));
}

function findBoxByPath(path) {
  const fromFlatList = state.analysis.allBoxes.find((box) => box.path === path);
  if (fromFlatList) return fromFlatList;
  return findBoxByPathInTree(state.analysis.topBoxes, path);
}

function findBoxByPathInTree(nodes, path) {
  for (const node of nodes || []) {
    if (node.path === path) return node;
    const childMatch = findBoxByPathInTree(getBoxNodeChildren(node), path);
    if (childMatch) return childMatch;
  }
  return null;
}

function getBoxSelectionDebug() {
  const firstRow = elements.boxTree.querySelector(".tree-row");
  const selectedRow = elements.boxTree.querySelector(".tree-row.selected");
  return {
    hasAnalysis: Boolean(state.analysis),
    topBoxesCount: state.analysis ? state.analysis.topBoxes.length : 0,
    allBoxesCount: state.analysis ? state.analysis.allBoxes.length : 0,
    treeRowCount: elements.boxTree.querySelectorAll(".tree-row").length,
    firstRowPath: firstRow ? firstRow.dataset.path : "",
    firstBoxPath: state.analysis && state.analysis.allBoxes[0] ? state.analysis.allBoxes[0].path : "",
    selectedBoxPath: state.selectedBox ? state.selectedBox.path : "",
    selectedRowPath: selectedRow ? selectedRow.dataset.path : "",
    activationCount: state.boxTreeActivationCount,
    lastActivation: state.lastBoxTreeActivation,
    detailText: elements.boxDetail.textContent || ""
  };
}

function renderSelectedBox() {
  if (!state.selectedBox) {
    elements.boxDetail.innerHTML = emptyHtml("empty.selectBox");
    return;
  }
  const node = state.selectedBox;
  const actualFields = getActualBoxFields(node);
  const derivedFields = getDerivedBoxFields(node);
  const derivedHtml = derivedFields ? [
    '<section class="detail-section derived-section">',
    '<h3>' + escapeHtml(t("boxes.derivedFields")) + '</h3>',
    '<p class="detail-note">' + escapeHtml(t("boxes.derivedNotice")) + '</p>',
    renderJsonViewer(derivedFields, { rootLabel: t("boxes.derivedFields"), defaultOpenDepth: 1 }),
    '</section>'
  ].join("") : "";
  const syntheticNoticeHtml = node.synthetic ? '<p class="detail-note synthetic-note">' + escapeHtml(t("boxes.syntheticNotice")) + '</p>' : "";
  elements.boxDetail.innerHTML = '<div class="detail-grid"><div>' +
    '<h2>' + escapeHtml(t("boxes.detailTitle")) + (node.synthetic ? ' <span class="synthetic-badge">' + escapeHtml(t("boxes.synthetic")) + '</span>' : "") + '</h2>' +
    syntheticNoticeHtml +
    renderKv([
      [t("box.field.type"), formatBoxTypeLabel(node.type)],
      [t("box.field.description"), getBoxTypeDescription(node.type)],
      [t("box.field.path"), node.path],
      [t("box.field.offset"), node.offset || t("value.notAvailable")],
      [t("box.field.size"), formatBoxNodeSize(node).replace(" @ " + String(node.offset || ""), "")],
      [t("box.field.headerSize"), node.headerSize === undefined ? t("value.notAvailable") : node.headerSize],
      [t("box.field.children"), getBoxNodeChildren(node).length],
      [t("box.field.warnings"), node.warnings && node.warnings.length ? node.warnings.join("; ") : t("value.none")]
    ]) + '</div><div class="field-viewer-column"><section class="detail-section">' +
    '<h2>' + escapeHtml(t("boxes.actualFields")) + '</h2>' +
    '<p class="detail-note">' + escapeHtml(t("boxes.actualFieldsNotice")) + '</p>' +
    renderJsonViewer(actualFields, { rootLabel: t("boxes.actualFields"), defaultOpenDepth: 2 }) +
    '</section>' + derivedHtml + '</div></div>';
}

function getBoxNodeChildren(node) {
  return [...(node && node.children || []), ...getSyntheticBoxChildren(node)];
}

function getSyntheticBoxChildren(node) {
  if (!node || node.synthetic || node.type !== "stsd" || !node.fields || !Array.isArray(node.fields.entries)) return [];
  return node.fields.entries.map((entry) => createSyntheticSampleEntryNode(node, entry));
}

function createSyntheticSampleEntryNode(parentNode, entry) {
  const path = parentNode.path + "/entry[" + entry.index + "]:" + entry.format;
  return {
    type: entry.format,
    path,
    offset: parentNode.offset || "",
    size: entry.size,
    headerSize: 0,
    children: (entry.boxes || []).map((childBox, childIndex) => createSyntheticSampleEntryChildNode(path, parentNode, childBox, childIndex)),
    fields: createActualSampleEntryFields(entry),
    warnings: [],
    synthetic: true,
    syntheticKind: "sample-entry",
    sourceBoxPath: parentNode.path,
    sourceEntry: entry
  };
}

function createSyntheticSampleEntryChildNode(sampleEntryPath, parentNode, childBox, childIndex) {
  return {
    type: childBox.type,
    path: sampleEntryPath + "/" + childBox.type + "[" + (childIndex + 1) + "]",
    offset: parentNode.offset || "",
    size: childBox.size,
    headerSize: 8,
    children: [],
    fields: childBox.fields || {},
    warnings: [],
    synthetic: true,
    syntheticKind: "sample-entry-child-box",
    sourceBoxPath: parentNode.path
  };
}

function formatBoxNodeSize(node) {
  const formattedSize = Number.isFinite(Number(node.size)) ? String(node.size) + " (" + formatBytes(Number(node.size)) + ")" : t("value.notAvailable");
  if (node.synthetic) return formattedSize + " · " + t("boxes.synthetic");
  return formattedSize + " @ " + String(node.offset || "");
}

function getActualBoxFields(node) {
  if (!node || !node.fields) return {};
  if (node.syntheticKind === "sample-entry" && node.sourceEntry) return createActualSampleEntryFields(node.sourceEntry);
  if (node.type === "stsd") return createActualStsdFields(node.fields);
  return node.fields;
}

function createActualStsdFields(fields) {
  return {
    version: fields.version,
    flags: fields.flags,
    entryCount: fields.entryCount,
    entries: Array.isArray(fields.entries) ? fields.entries.map(createActualSampleEntryFields) : []
  };
}

function createActualSampleEntryFields(entry) {
  const actualFields = {};
  for (const [fieldName, value] of Object.entries(entry || {})) {
    if (SAMPLE_ENTRY_DERIVED_FIELD_NAMES.has(fieldName)) continue;
    if (fieldName === "boxes") {
      actualFields.boxes = (value || []).map((childBox, childIndex) => ({
        index: childIndex + 1,
        type: childBox.type,
        size: childBox.size,
        parsedFieldKeys: childBox.fields ? Object.keys(childBox.fields) : []
      }));
    } else {
      actualFields[fieldName] = value;
    }
  }
  return actualFields;
}

function getDerivedBoxFields(node) {
  if (!node) return null;
  if (node.syntheticKind === "sample-entry" && node.sourceEntry) {
    const sampleEntryDerivedFields = createSampleEntryDerivedFields(node.sourceEntry);
    return sampleEntryDerivedFields ? { sourceBoxPath: node.sourceBoxPath, sampleEntry: sampleEntryDerivedFields } : null;
  }
  if (node.type !== "stsd" || !node.fields || !Array.isArray(node.fields.entries)) return null;
  const sampleEntries = node.fields.entries
    .map(createSampleEntryDerivedFields)
    .filter(Boolean);
  return sampleEntries.length ? { sourceBoxPath: node.path, sampleEntries } : null;
}

function createSampleEntryDerivedFields(entry) {
  const derivedFields = { index: entry.index, format: entry.format };
  let hasDerivedFields = false;
  for (const fieldName of SAMPLE_ENTRY_DERIVED_FIELD_NAMES) {
    if (entry && entry[fieldName] !== undefined) {
      derivedFields[fieldName] = entry[fieldName];
      hasDerivedFields = true;
    }
  }
  return hasDerivedFields ? derivedFields : null;
}

function renderJsonViewer(value, options = {}) {
  const normalizedValue = normalizeJsonValue(value);
  if (isEmptyJsonValue(normalizedValue)) {
    return '<div class="json-empty">' + escapeHtml(t("boxes.emptyFields")) + '</div>';
  }
  return '<div class="json-view">' + renderJsonValue(normalizedValue, {
    key: options.rootLabel || "root",
    depth: 0,
    isRoot: true,
    defaultOpenDepth: options.defaultOpenDepth || 1
  }) + '</div>';
}

function renderJsonValue(value, context) {
  if (Array.isArray(value)) return renderJsonArray(value, context);
  if (value && typeof value === "object") return renderJsonObject(value, context);
  return renderJsonScalar(value);
}

function renderJsonObject(value, context) {
  const entries = Object.entries(value);
  if (context.isRoot) {
    return entries.map(([fieldName, fieldValue]) => renderJsonEntry(fieldName, fieldValue, context.depth, context.defaultOpenDepth)).join("");
  }
  const openAttribute = context.depth < context.defaultOpenDepth ? " open" : "";
  return '<details class="json-node json-object"' + openAttribute + '><summary><span class="json-summary-type">{ }</span><span class="json-preview">' +
    escapeHtml(t("boxes.jsonProperties", { count: entries.length })) + '</span></summary><div class="json-children">' +
    entries.map(([fieldName, fieldValue]) => renderJsonEntry(fieldName, fieldValue, context.depth + 1, context.defaultOpenDepth)).join("") +
    '</div></details>';
}

function renderJsonArray(value, context) {
  if (isByteArrayField(context.key, value)) return renderJsonByteArray(value);
  const openAttribute = context.depth < context.defaultOpenDepth && value.length <= 20 ? " open" : "";
  return '<details class="json-node json-array"' + openAttribute + '><summary><span class="json-summary-type">[ ]</span><span class="json-preview">' +
    escapeHtml(t("boxes.jsonItems", { count: value.length })) + createJsonArrayPreview(value) + '</span></summary><div class="json-children">' +
    value.map((item, index) => renderJsonEntry(String(index), item, context.depth + 1, context.defaultOpenDepth)).join("") +
    '</div></details>';
}

function renderJsonEntry(fieldName, fieldValue, depth, defaultOpenDepth) {
  return '<div class="json-entry" style="--json-depth:' + depth + '"><span class="json-key">' + escapeHtml(fieldName) + '</span><div class="json-value">' +
    renderJsonValue(fieldValue, { key: fieldName, depth, isRoot: false, defaultOpenDepth }) + '</div></div>';
}

function renderJsonScalar(value) {
  const type = value === null ? "null" : typeof value;
  return '<span class="json-scalar ' + escapeHtml(type) + '">' + escapeHtml(formatJsonScalar(value)) + '</span>';
}

function renderJsonByteArray(value) {
  const preview = value.slice(0, JSON_BYTE_PREVIEW_COUNT).map(formatByteAsHex).join(" ");
  const expandedValues = value.slice(0, JSON_BYTE_EXPANDED_LIMIT).map(formatByteAsHex).join(" ");
  const truncatedHtml = value.length > JSON_BYTE_EXPANDED_LIMIT ? '<div class="json-byte-truncation">' +
    escapeHtml(t("boxes.bytesTruncated", { shown: JSON_BYTE_EXPANDED_LIMIT, count: value.length })) + '</div>' : "";
  return '<details class="json-node json-byte-array"><summary><span class="json-summary-type">bytes</span><span class="json-preview">' +
    escapeHtml(t("boxes.bytesPreview", { count: value.length, preview })) + '</span></summary><code class="json-byte-dump">' +
    escapeHtml(expandedValues) + '</code>' + truncatedHtml + '</details>';
}

function normalizeJsonValue(value) {
  return JSON.parse(JSON.stringify(value === undefined ? null : value, safeJsonReplacer));
}

function isEmptyJsonValue(value) {
  if (value === null || value === undefined) return true;
  if (Array.isArray(value)) return value.length === 0;
  return typeof value === "object" && Object.keys(value).length === 0;
}

function isByteArrayField(fieldName, value) {
  return fieldName === "bytes" && value.every((item) => Number.isInteger(item) && item >= 0 && item <= 255);
}

function createJsonArrayPreview(value) {
  if (!value.length || value.length > 6 || value.some((item) => item && typeof item === "object")) return "";
  return ' · <span class="json-inline-preview">' + escapeHtml(value.map(formatJsonScalar).join(", ")) + '</span>';
}

function formatJsonScalar(value) {
  if (typeof value === "string") return '"' + value + '"';
  if (value === null) return "null";
  return String(value);
}

function formatByteAsHex(value) {
  return Number(value).toString(16).padStart(2, "0").toUpperCase();
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
    elements.tracksBody.innerHTML = emptyHtml("empty.noTracks");
    return;
  }
  elements.tracksBody.innerHTML = renderTrackTable(analysis.tracks);
  elements.trackFilter.innerHTML = '<option value="">' + escapeHtml(t("option.all")) + '</option>' + analysis.tracks.map((track) => '<option value="' + track.trackId + '">' + escapeHtml(formatTrackLabel(track)) + '</option>').join("");
  populateMetricsTrackFilter(analysis.tracks);
}

function renderTrackTable(tracks) {
  return renderDataGridTable({
    className: "tracks-grid",
    minimumWidth: "1080px",
    columns: [
      { label: t("column.track"), width: "72px" },
      { label: t("column.handler"), width: "90px" },
      { label: t("column.codec"), width: "112px" },
      { label: t("column.duration"), width: "100px" },
      { label: t("column.media"), width: "150px" },
      { label: t("column.samples"), width: "90px" },
      { label: t("column.avgBitrate"), width: "130px" },
      { label: t("column.fpsSamples"), width: "110px" },
      { label: t("column.avgSample"), width: "110px" },
      { label: t("column.codecConfig"), width: "minmax(210px, 1fr)" }
    ],
    rows: tracks.map((track) => {
      const summaryMetrics = getTrackSummaryMetrics(track);
      const media = formatTrackMedia(track);
      const codecConfig = formatTrackCodecConfig(track);
      return {
        cells: [
          track.trackId,
          track.handlerType,
          track.codec,
          formatTime(track.duration, track.timescale),
          { value: media, title: media },
          track.sampleCount,
          summaryMetrics ? formatBitsPerSecond(summaryMetrics.averageBitrate) : t("value.notAvailable"),
          summaryMetrics ? formatMetricNumber(summaryMetrics.sampleRate, 2) : t("value.notAvailable"),
          summaryMetrics ? formatBytes(summaryMetrics.averageSampleSize) : t("value.notAvailable"),
          { value: codecConfig, title: codecConfig }
        ]
      };
    })
  });
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
  if (!rows.length) return points;
  const boundedWindowSize = Math.max(1, Math.min(Math.floor(Number(windowSize) || 1), rows.length));
  const sampleMetrics = rows.map((row, index) => ({
    row,
    size: Number(row.size) || 0,
    durationSeconds: getSampleDurationSeconds(row, track, rows, index)
  }));
  let windowBytes = 0;
  let windowDuration = 0;
  for (let index = 0; index < boundedWindowSize; index += 1) {
    windowBytes += sampleMetrics[index].size;
    windowDuration += sampleMetrics[index].durationSeconds;
  }
  const windowCount = sampleMetrics.length - boundedWindowSize + 1;
  for (let startIndex = 0; startIndex < windowCount; startIndex += 1) {
    const first = sampleMetrics[startIndex];
    const last = sampleMetrics[startIndex + boundedWindowSize - 1];
    points.push({
      time: getWindowCenterTimeSeconds(first, last),
      bitrate: windowDuration > 0 ? windowBytes * 8 / windowDuration : 0,
      fps: windowDuration > 0 ? boundedWindowSize / windowDuration : 0,
      sampleCount: boundedWindowSize,
      windowStartSampleIndex: first.row.sampleIndex,
      windowEndSampleIndex: last.row.sampleIndex,
      row: first.row
    });
    const nextIndex = startIndex + boundedWindowSize;
    if (nextIndex < sampleMetrics.length) {
      windowBytes += sampleMetrics[nextIndex].size - first.size;
      windowDuration += sampleMetrics[nextIndex].durationSeconds - first.durationSeconds;
    }
  }
  return points;
}

function getWindowCenterTimeSeconds(first, last) {
  const windowStartTime = getRowTimeSeconds(first.row);
  const windowEndTime = getRowTimeSeconds(last.row) + Math.max(0, last.durationSeconds);
  if (!Number.isFinite(windowStartTime) || !Number.isFinite(windowEndTime) || windowEndTime <= windowStartTime) {
    return windowStartTime;
  }
  return windowStartTime + (windowEndTime - windowStartTime) / 2;
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
  return '<section class="metric-section"><h3>' + escapeHtml(t("metrics.largestSamples")) + '</h3>' +
    renderDataGridTable({
      className: "largest-samples-grid",
      minimumWidth: "480px",
      columns: [
        { label: t("value.sample"), width: "90px" },
        { label: t("column.time"), width: "120px" },
        { label: t("column.size"), width: "110px" },
        { label: t("column.type"), width: "minmax(110px, 1fr)" }
      ],
      rows: rows.map((row) => {
        const type = row.frameType || "sample";
        const frameRowKey = getFrameRowKey(row);
        const ariaLabel = t("aria.seekFrame", { trackId: row.trackId, sampleIndex: row.sampleIndex, time: formatGraphTime(row) });
        return {
          className: "clickable metric-click-row",
          attributes: {
            role: "button",
            tabindex: "0",
            "data-frame-key": frameRowKey,
            "aria-label": ariaLabel
          },
          cells: [
            "#" + row.sampleIndex,
            formatGraphTime(row),
            formatBytes(row.size || 0),
            { html: '<span class="pill ' + getFrameTypeClass(type) + '">' + escapeHtml(formatFrameTypeLabel(type)) + '</span>' }
          ]
        };
      })
    }) +
    '</section>';
}

function renderFrames() {
  if (!state.analysis) return;
  const rows = applyFrameFilters(state.analysis.sampleRows);
  state.filteredRows = rows;
  state.graphRows = rows.slice().sort(compareRowsByPresentationTime);
  state.graphMaxSize = Math.max(1, ...state.graphRows.map((row) => row.size || 0));
  elements.frameCountText.textContent = t("count.rows", { count: rows.length });
  renderFrameTableLayout(rows);
  frameTableRecycler.setRows(rows);
  frameGraphRecycler.setRows(state.graphRows);
  renderGraphAxis();
  const synchronizedRow = synchronizeFrameSelectionToPlayback({ force: true });
  if (!synchronizedRow) {
    if (state.selectedFrameKey && !rows.some((row) => getFrameRowKey(row) === state.selectedFrameKey)) state.selectedFrameKey = "";
    scheduleFrameRender();
  }
  renderFrameInternals();
}

function renderFrameInternals() {
  if (!elements.frameInternalsBody) return;
  hideFrameInternalsTooltip();
  const model = buildSelectedFrameInternalsModel();
  if (model.kind === "empty") {
    elements.frameInternalsBody.innerHTML = emptyHtml("frameInternals.empty");
    return;
  }
  if (model.kind === "video-grid") {
    elements.frameInternalsBody.innerHTML = renderVideoFrameInternals(model);
    return;
  }
  if (model.kind === "audio-bands") {
    elements.frameInternalsBody.innerHTML = renderAudioFrameInternals(model);
    return;
  }
  elements.frameInternalsBody.innerHTML = '<div class="empty compact">' + escapeHtml(model.note || t("frameInternals.unsupported")) + '</div>';
}

function buildSelectedFrameInternalsModel() {
  if (!state.analysis || !state.selectedFrameKey) return buildFrameInternalsModel(null, null);
  const row = findFrameRowByKey(state.selectedFrameKey);
  const track = row ? getRowTrack(row) : null;
  return buildFrameInternalsModel(row, track, {
    colorScale: getFrameInternalsColorScale(track)
  });
}

function getFrameInternalsColorScale(track) {
  if (!track || track.handlerType !== "vide" || !state.analysis) return null;
  const cacheKey = [
    track.trackId,
    track.codec,
    track.codecDescriptor || "",
    track.width || 0,
    track.height || 0,
    state.analysis.sampleRows.length
  ].join(":");
  if (!state.frameInternalsColorScaleCache.has(cacheKey)) {
    state.frameInternalsColorScaleCache.set(
      cacheKey,
      buildFrameInternalsColorScale(track, state.analysis.sampleRows)
    );
  }
  return state.frameInternalsColorScaleCache.get(cacheKey);
}

function renderVideoFrameInternals(model) {
  const frameClass = getFrameTypeClass(model.frameType);
  const stats = [
    [t("frameInternals.codec"), model.codecFamily],
    [t("frameInternals.frame"), formatSelectedFrameLabel()],
    [t("frameInternals.unit"), model.unitName + " " + model.unitWidth + "x" + model.unitHeight],
    [t("frameInternals.mediaSize"), model.mediaWidth + "x" + model.mediaHeight],
    [t("frameInternals.nominalGrid"), model.nominalColumns + "x" + model.nominalRows + " (" + model.nominalUnitCount + ")"],
    [t("frameInternals.displayedGrid"), model.displayColumns + "x" + model.displayRows + (model.aggregation > 1 ? " (x" + model.aggregation + ")" : "")],
    [t("frameInternals.sampleSize"), formatBytes(model.sampleSize)],
    [t("frameInternals.colorScale"), formatFrameInternalsColorScale(model.colorScale)],
    [t("frameInternals.accuracy"), t("frameInternals.nominal")]
  ];
  return '<div class="frame-internals-layout">' +
    '<div class="frame-internals-summary">' +
    '<div class="frame-internals-title-row"><strong>' + escapeHtml(model.title) + '</strong><span class="pill ' + frameClass + '">' + escapeHtml(formatFrameTypeLabel(model.frameType)) + '</span></div>' +
    '<p class="frame-internals-note">' + escapeHtml(model.note) + '</p>' +
    renderFrameInternalsStats(stats) +
    '</div>' +
    '<div class="block-heatmap-wrap">' +
    '<div class="block-heatmap" style="--block-columns:' + model.displayColumns + ';--frame-aspect-ratio:' + model.mediaWidth + ' / ' + model.mediaHeight + '">' +
    model.cells.map((cell) => renderVideoBlockCell(cell, model, frameClass)).join("") +
    '</div>' +
    '<p class="frame-internals-note">' + escapeHtml(t("frameInternals.videoEstimateNote")) + '</p>' +
    '</div>' +
    '</div>';
}

function renderVideoBlockCell(cell, model, frameClass) {
  const title = model.unitName + " x " + (cell.unitColumnStart + 1) + "-" + cell.unitColumnEnd + ", y " + (cell.unitRowStart + 1) + "-" + cell.unitRowEnd;
  const tooltipRows = [
    [t("frameInternals.tooltip.pixelRange"), cell.pixelLeft + "," + cell.pixelTop + " - " + cell.pixelRight + "," + cell.pixelBottom],
    [t("frameInternals.tooltip.estimatedBytes"), formatBytes(cell.estimatedBytes)],
    [t("frameInternals.tooltip.globalPercentile"), formatMetricNumber((cell.globalPercentile || 0) * 100, 1) + "%"],
    [t("frameInternals.tooltip.nominalUnits"), cell.nominalUnits],
    [t("frameInternals.tooltip.accuracy"), t("frameInternals.tooltip.nominalEstimate")]
  ];
  return '<div class="block-cell ' + frameClass + '"' +
    renderFrameInternalsTooltipAttributes({
      title,
      rows: tooltipRows,
      note: t("frameInternals.videoEstimateNote")
    }) +
    ' style="' + renderVideoBlockCellStyle(cell) + '"></div>';
}

function renderVideoBlockCellStyle(cell) {
  const color = cell.color || { red: 31, green: 122, blue: 140 };
  const alpha = Number.isFinite(cell.intensity) ? cell.intensity : 0.75;
  return '--cell-red:' + color.red + ';--cell-green:' + color.green + ';--cell-blue:' + color.blue + ';--cell-alpha:' + alpha.toFixed(3);
}

function formatFrameInternalsColorScale(colorScale) {
  if (!colorScale) return t("value.notAvailable");
  if (colorScale.mode === "global-track-percentile") {
    return t("frameInternals.globalTrackPercentile", {
      count: colorScale.sampleCount,
      values: colorScale.valueCount
    });
  }
  if (colorScale.mode === "selected-frame-percentile") return t("frameInternals.selectedFramePercentile");
  return t("value.notAvailable");
}

function renderAudioFrameInternals(model) {
  const stats = [
    [t("frameInternals.codec"), model.title],
    [t("frameInternals.frame"), formatSelectedFrameLabel()],
    [t("frameInternals.sampleSize"), formatBytes(model.sampleSize)],
    [t("frameInternals.sampleRate"), model.sampleRate ? formatMetricNumber(model.sampleRate, 0) + " Hz" : t("value.notAvailable")],
    [t("frameInternals.activeBandwidth"), formatAudioFrequency(model.activeBandwidthHz)],
    [t("frameInternals.channels"), model.channelCount || t("value.notAvailable")]
  ];
  return '<div class="frame-internals-layout">' +
    '<div class="frame-internals-summary">' +
    '<div class="frame-internals-title-row"><strong>' + escapeHtml(t("frameInternals.audioBands")) + '</strong><span class="pill aac">' + escapeHtml(formatFrameTypeLabel(model.frameType)) + '</span></div>' +
    '<p class="frame-internals-note">' + escapeHtml(model.note) + '</p>' +
    renderFrameInternalsStats(stats) +
    '</div>' +
    '<div class="block-heatmap-wrap">' +
    '<div class="audio-band-plot">' + model.bands.map(renderAudioBandRow).join("") + '</div>' +
    '<p class="frame-internals-note">' + escapeHtml(t("frameInternals.audioEstimateNote")) + '</p>' +
    '</div>' +
    '</div>';
}

function renderAudioBandRow(band) {
  const widthPercent = clamp(band.ratio * 100, band.active ? 2 : 0.8, 100);
  const tooltipRows = [
    [t("frameInternals.tooltip.frequencyRange"), band.range],
    [t("frameInternals.tooltip.estimatedBytes"), formatBytes(band.estimatedBytes)],
    [t("frameInternals.tooltip.relativeShare"), formatMetricNumber(band.ratio * 100, 1) + "%"],
    [t("frameInternals.tooltip.accuracy"), t("frameInternals.tooltip.nominalEstimate")]
  ];
  return '<div class="audio-band-row"' +
    renderFrameInternalsTooltipAttributes({
      title: band.label,
      rows: tooltipRows,
      note: t("frameInternals.audioEstimateNote")
    }) +
    '>' +
    '<div class="audio-band-label">' + escapeHtml(band.label) + '<br><small>' + escapeHtml(band.range) + '</small></div>' +
    '<div class="audio-band-bar"><span class="audio-band-fill" style="width:' + widthPercent.toFixed(3) + '%;--band-alpha:' + band.intensity.toFixed(3) + '"></span></div>' +
    '<div class="audio-band-size">' + escapeHtml(formatBytes(band.estimatedBytes)) + '</div>' +
    '</div>';
}

function renderFrameInternalsTooltipAttributes(payload) {
  const rows = Array.isArray(payload.rows)
    ? payload.rows.filter((row) => row && row[0] !== undefined && row[1] !== undefined)
    : [];
  const normalizedPayload = {
    title: String(payload.title || ""),
    rows: rows.map(([label, value]) => [String(label), String(value)]),
    note: String(payload.note || "")
  };
  const accessibleLabel = [
    normalizedPayload.title,
    ...normalizedPayload.rows.map(([label, value]) => label + ": " + value),
    normalizedPayload.note
  ].filter(Boolean).join(". ");
  return ' data-inspection-tooltip="' + escapeHtml(JSON.stringify(normalizedPayload)) + '"' +
    ' aria-label="' + escapeHtml(accessibleLabel) + '"';
}

function handleFrameInternalsTooltipPointerOver(event) {
  const target = getFrameInternalsTooltipTarget(event.target);
  if (!target) return;
  showFrameInternalsTooltip(target, event.clientX, event.clientY);
}

function handleFrameInternalsTooltipPointerMove(event) {
  const target = getFrameInternalsTooltipTarget(event.target);
  if (!target) {
    hideFrameInternalsTooltip();
    return;
  }
  if (target !== state.frameInternalsTooltipTarget) {
    showFrameInternalsTooltip(target, event.clientX, event.clientY);
    return;
  }
  positionFrameInternalsTooltip(event.clientX, event.clientY, { anchorMode: "pointer" });
}

function handleFrameInternalsTooltipPointerOut(event) {
  const currentTarget = state.frameInternalsTooltipTarget;
  if (!currentTarget) return;
  const relatedTarget = event.relatedTarget;
  if (relatedTarget && (relatedTarget === currentTarget || currentTarget.contains(relatedTarget))) return;
  if (relatedTarget && getFrameInternalsTooltipTarget(relatedTarget) === currentTarget) return;
  hideFrameInternalsTooltip();
}

function handleFrameInternalsTooltipFocusIn(event) {
  const target = getFrameInternalsTooltipTarget(event.target);
  if (!target) return;
  const rect = target.getBoundingClientRect();
  showFrameInternalsTooltip(target, rect.left + rect.width / 2, rect.bottom, { anchorMode: "center" });
}

function getFrameInternalsTooltipTarget(eventTarget) {
  if (!eventTarget || !elements.frameInternalsBody || typeof eventTarget.closest !== "function") return null;
  const target = eventTarget.closest("[data-inspection-tooltip]");
  if (!target || !elements.frameInternalsBody.contains(target)) return null;
  return target;
}

function showFrameInternalsTooltip(target, clientX, clientY, options = {}) {
  if (!elements.frameInternalsTooltip) return;
  const payload = readFrameInternalsTooltipPayload(target);
  if (!payload) {
    hideFrameInternalsTooltip();
    return;
  }
  state.frameInternalsTooltipTarget = target;
  elements.frameInternalsTooltip.innerHTML = renderFrameInternalsTooltip(payload);
  elements.frameInternalsTooltip.hidden = false;
  positionFrameInternalsTooltip(clientX, clientY, options);
}

function hideFrameInternalsTooltip() {
  state.frameInternalsTooltipTarget = null;
  if (!elements.frameInternalsTooltip) return;
  elements.frameInternalsTooltip.hidden = true;
  elements.frameInternalsTooltip.innerHTML = "";
}

function readFrameInternalsTooltipPayload(target) {
  try {
    const payload = JSON.parse(target.dataset.inspectionTooltip || "{}");
    if (!payload || !payload.title) return null;
    return {
      title: String(payload.title || ""),
      rows: Array.isArray(payload.rows) ? payload.rows : [],
      note: String(payload.note || "")
    };
  } catch (_) {
    return null;
  }
}

function renderFrameInternalsTooltip(payload) {
  const rows = payload.rows.map((row) => {
    const label = row && row[0] !== undefined ? String(row[0]) : "";
    const value = row && row[1] !== undefined ? String(row[1]) : "";
    if (!label || !value) return "";
    return '<div class="tooltip-row"><span>' + escapeHtml(label) + '</span><strong>' + escapeHtml(value) + '</strong></div>';
  }).join("");
  return '<div class="tooltip-title">' + escapeHtml(payload.title) + '</div>' +
    '<div class="tooltip-rows">' + rows + '</div>' +
    (payload.note ? '<div class="tooltip-note">' + escapeHtml(payload.note) + '</div>' : "");
}

function positionFrameInternalsTooltip(clientX, clientY, options = {}) {
  if (!elements.frameInternalsTooltip || elements.frameInternalsTooltip.hidden) return;
  const gap = options.anchorMode === "center" ? 10 : 14;
  const viewportPadding = 10;
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 1024;
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 768;
  const tooltipRect = elements.frameInternalsTooltip.getBoundingClientRect();
  let left = options.anchorMode === "center" ? clientX - tooltipRect.width / 2 : clientX + gap;
  let top = clientY + gap;
  if (left + tooltipRect.width + viewportPadding > viewportWidth) left = viewportWidth - tooltipRect.width - viewportPadding;
  if (left < viewportPadding) left = viewportPadding;
  if (top + tooltipRect.height + viewportPadding > viewportHeight) top = clientY - tooltipRect.height - gap;
  if (top < viewportPadding) top = viewportPadding;
  elements.frameInternalsTooltip.style.left = left.toFixed(1) + "px";
  elements.frameInternalsTooltip.style.top = top.toFixed(1) + "px";
}

function renderFrameInternalsStats(stats) {
  return '<div class="frame-internals-stats">' + stats.map(([label, value]) =>
    '<div class="frame-internals-stat"><span>' + escapeHtml(label) + '</span><strong>' + escapeHtml(String(value)) + '</strong></div>'
  ).join("") + '</div>';
}

function formatSelectedFrameLabel() {
  const row = findFrameRowByKey(state.selectedFrameKey);
  return row ? "T" + row.trackId + " #" + row.sampleIndex : t("value.notAvailable");
}

function formatAudioFrequency(value) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || numberValue <= 0) return t("value.notAvailable");
  return numberValue >= 1000 ? formatMetricNumber(numberValue / 1000, 1) + " kHz" : formatMetricNumber(numberValue, 0) + " Hz";
}

function renderFrameTableLayout(rows) {
  const columns = getFrameTableColumns();
  const layout = createDataGridLayout({
    minimumWidth: FRAME_TABLE_MINIMUM_WIDTH,
    columns,
    rows: rows.map((row) => ({ cells: getFrameTableCells(row) }))
  });
  elements.frameWrap.style.setProperty("--data-grid-columns", layout.gridTemplateColumns);
  elements.frameWrap.style.setProperty("--data-grid-width", layout.minimumWidth);
  elements.frameHeader.innerHTML = renderDataGridHeaderCells(columns);
}

function getFrameTableColumns() {
  return [
    { label: t("column.index"), width: "72px" },
    { label: t("column.track"), width: "76px" },
    { label: t("column.type"), width: "92px" },
    { label: t("column.offset"), width: "minmax(120px, 1.2fr)" },
    { label: t("column.size"), width: "92px" },
    { label: "DTS", width: "98px" },
    { label: "PTS", width: "98px" },
    { label: t("column.duration"), width: "90px" },
    { label: t("column.sync"), width: "70px" },
    { label: "NAL", width: "120px" },
    { label: t("column.chunkFragment"), width: "120px" }
  ];
}

function compareRowsByPresentationTime(left, right) {
  const leftTime = getRowTimeSeconds(left);
  const rightTime = getRowTimeSeconds(right);
  if (leftTime !== rightTime) return leftTime - rightTime;
  if (left.trackId !== right.trackId) return left.trackId - right.trackId;
  return left.sampleIndex - right.sampleIndex;
}

function compareRowsByDecodeTime(left, right) {
  const leftTime = getRowDecodeTimeSeconds(left);
  const rightTime = getRowDecodeTimeSeconds(right);
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
  const timestamp = getFirstFiniteNumber([row.pts, row.dts], null);
  if (!track || !track.timescale) return timestamp === null ? getFirstFiniteNumber([row.sampleIndex], 0) : timestamp;
  return (timestamp === null ? 0 : timestamp) / Number(track.timescale);
}

function getRowDurationSeconds(row) {
  const track = getRowTrack(row);
  const rowDuration = Number(row.duration);
  if (!track || !track.timescale || !Number.isFinite(rowDuration) || rowDuration <= 0) return 0;
  return rowDuration / Number(track.timescale);
}

function getRowDecodeTimeSeconds(row) {
  const track = getRowTrack(row);
  const timestamp = getFirstFiniteNumber([row.dts, row.pts], null);
  if (!track || !track.timescale) return timestamp === null ? getFirstFiniteNumber([row.sampleIndex], 0) : timestamp;
  return (timestamp === null ? 0 : timestamp) / Number(track.timescale);
}

function getFirstFiniteNumber(values, fallbackValue) {
  for (const value of values) {
    if (value === undefined || value === null || value === "") continue;
    const numberValue = Number(value);
    if (Number.isFinite(numberValue)) return numberValue;
  }
  return fallbackValue;
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
  if (state.frameViewMode === "graph") frameGraphRecycler.scheduleRender();
  else frameTableRecycler.scheduleRender();
}

function renderVisibleFrameRows() {
  frameTableRecycler.renderNow();
}

function renderVisibleGraphRows() {
  frameGraphRecycler.renderNow();
}

function renderFrameRow(row, visualIndex) {
  const frameRowKey = getFrameRowKey(row);
  const selectedClass = frameRowKey === state.selectedFrameKey ? " selected" : "";
  const ariaLabel = t("aria.seekFrame", { trackId: row.trackId, sampleIndex: row.sampleIndex, time: formatGraphTime(row) });
  return '<div class="frame-row data-grid-row clickable' + selectedClass + '" role="button" tabindex="0" data-frame-key="' + escapeHtml(frameRowKey) + '" aria-label="' + escapeHtml(ariaLabel) + '" style="top:' + (visualIndex * ROW_HEIGHT) + 'px">' +
    renderDataGridCells(getFrameTableCells(row)) +
    '</div>';
}

function getFrameTableCells(row) {
  const type = row.frameType || "unknown";
  const typeClass = getFrameTypeClass(type);
  const nalTypes = row.nalTypes || [];
  const chunkOrFragment = row.fragmentIndex ? "frag " + row.fragmentIndex : row.chunkIndex ? "chunk " + row.chunkIndex : "";
  return [
    row.sampleIndex,
    row.trackId,
    { html: '<span class="pill ' + typeClass + '">' + escapeHtml(formatFrameTypeLabel(type)) + '</span>' },
    { value: row.offset, title: row.offset },
    row.size,
    row.dts,
    row.pts,
    row.duration,
    row.isSync ? t("value.yes") : t("value.no"),
    { value: nalTypes.join(","), title: nalTypes.join(", ") },
    chunkOrFragment
  ];
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
  const timestamp = getFirstFiniteNumber([row.pts, row.dts], null);
  if (!track || !track.timescale || timestamp === null) {
    return String(timestamp === null ? getFirstFiniteNumber([row.sampleIndex], 0) : timestamp);
  }
  return formatTime(timestamp, track.timescale);
}

function renderFragments() {
  if (!state.analysis) {
    state.fragmentRows = [];
    elements.fragmentCountText.textContent = t("count.rows", { count: 0 });
    elements.fragmentsBody.innerHTML = emptyHtml("empty.noFragments");
    return;
  }
  const analysis = state.analysis;
  const fragmentRows = buildFragmentRows(analysis);
  state.fragmentRows = fragmentRows;
  elements.fragmentCountText.textContent = t("count.rows", { count: fragmentRows.length });
  if (state.selectedFragmentIndex && !fragmentRows.some((fragment) => fragment.fragmentIndex === state.selectedFragmentIndex)) {
    state.selectedFragmentIndex = 0;
    state.lastPlaybackSynchronizationFragmentIndex = 0;
  }
  if (!fragmentRows.length) {
    elements.fragmentsBody.innerHTML = emptyHtml("empty.noMoof");
    return;
  }
  elements.fragmentsBody.innerHTML = renderDataGridTable({
    className: "fragments-grid",
    minimumWidth: "1040px",
    columns: [
      { label: "#", width: "72px" },
      { label: t("column.startTime"), width: "120px" },
      { label: t("column.endTime"), width: "120px" },
      { label: t("column.duration"), width: "105px" },
      { label: t("column.startFrame"), width: "120px" },
      { label: t("column.samples"), width: "95px" },
      { label: t("column.offset"), width: "minmax(150px, 1fr)" },
      { label: t("column.size"), width: "130px" },
      { label: "traf", width: "90px" },
      { label: "trun", width: "90px" }
    ],
    rows: fragmentRows.map((fragment) => {
      const selectedClass = fragment.fragmentIndex === state.selectedFragmentIndex ? "selected" : "";
      const ariaLabel = t("aria.seekFragment", {
        fragmentIndex: fragment.fragmentIndex,
        time: formatFragmentTime(fragment.startTimeSeconds)
      });
      return {
        className: "clickable " + selectedClass,
        attributes: {
          role: "button",
          tabindex: "0",
          "data-fragment-index": fragment.fragmentIndex,
          "aria-label": ariaLabel
        },
        cells: [
          fragment.fragmentIndex,
          formatFragmentTime(fragment.startTimeSeconds),
          formatFragmentTime(fragment.endTimeSeconds),
          formatFragmentDuration(fragment),
          fragment.startFrameLabel,
          fragment.sampleCount,
          { value: fragment.offset, title: fragment.offset },
          fragment.size,
          fragment.trafCount,
          fragment.trunCount
        ]
      };
    })
  });
}

function buildFragmentRows(analysis) {
  const moofs = analysis.topBoxes
    .filter((box) => box.type === "moof")
    .slice()
    .sort((left, right) => Number(left.offsetBig - right.offsetBig));
  if (!moofs.length) return [];
  const rowsByFragmentIndex = new Map();
  for (const row of analysis.sampleRows) {
    const fragmentIndex = Number(row.fragmentIndex);
    if (!Number.isFinite(fragmentIndex) || fragmentIndex <= 0) continue;
    if (!rowsByFragmentIndex.has(fragmentIndex)) rowsByFragmentIndex.set(fragmentIndex, []);
    rowsByFragmentIndex.get(fragmentIndex).push(row);
  }
  return moofs.map((moof, index) => {
    const fragmentIndex = index + 1;
    const trafs = (moof.children || []).filter((child) => child.type === "traf");
    const truns = findDescendants(moof, "trun", []);
    const declaredSampleCount = truns.reduce((sum, trun) => sum + (trun.fields.sampleCount || 0), 0);
    const sampleRows = (rowsByFragmentIndex.get(fragmentIndex) || []).slice().sort(compareRowsByDecodeTime);
    const videoRows = sampleRows.filter((row) => {
      const track = getRowTrack(row);
      return track && track.handlerType === "vide";
    });
    const timeRows = videoRows.length ? videoRows : sampleRows;
    const startFrameRow = (videoRows.length ? videoRows : sampleRows)[0] || null;
    const timeRange = getRowsDecodeTimeRangeSeconds(timeRows);
    return {
      fragmentIndex,
      offset: moof.offset,
      size: moof.size,
      trafCount: trafs.length,
      trunCount: truns.length,
      declaredSampleCount,
      sampleCount: sampleRows.length || declaredSampleCount,
      startTimeSeconds: timeRange.start,
      endTimeSeconds: timeRange.end,
      startFrameRow,
      startFrameLabel: startFrameRow ? "#" + startFrameRow.sampleIndex + " T" + startFrameRow.trackId : t("value.notAvailable"),
      sampleRows,
      moof
    };
  });
}

function getRowsDecodeTimeRangeSeconds(rows) {
  if (!rows.length) return { start: NaN, end: NaN };
  let startTimeSeconds = Infinity;
  let endTimeSeconds = -Infinity;
  for (const row of rows) {
    const rowTimeSeconds = getRowDecodeTimeSeconds(row);
    if (!Number.isFinite(rowTimeSeconds)) continue;
    const rowEndTimeSeconds = rowTimeSeconds + Math.max(0, getRowDurationSeconds(row));
    startTimeSeconds = Math.min(startTimeSeconds, rowTimeSeconds);
    endTimeSeconds = Math.max(endTimeSeconds, rowEndTimeSeconds);
  }
  if (!Number.isFinite(startTimeSeconds) || !Number.isFinite(endTimeSeconds)) return { start: NaN, end: NaN };
  return { start: startTimeSeconds, end: endTimeSeconds };
}

function formatFragmentTime(timeSeconds) {
  return Number.isFinite(timeSeconds) ? formatMetricNumber(timeSeconds, 3) + "s" : t("fragments.noTimeRange");
}

function formatFragmentDuration(fragment) {
  const durationSeconds = fragment.endTimeSeconds - fragment.startTimeSeconds;
  return Number.isFinite(durationSeconds) && durationSeconds >= 0 ? formatMetricNumber(durationSeconds, 3) + "s" : t("fragments.noTimeRange");
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
    elements.warningsBody.innerHTML = emptyHtml("empty.noWarnings");
    return;
  }
  elements.warningsBody.innerHTML = '<div class="warning-list">' + warnings.map((warning) => '<div class="warning-item">' + escapeHtml(warning) + '</div>').join("") + '</div>';
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
