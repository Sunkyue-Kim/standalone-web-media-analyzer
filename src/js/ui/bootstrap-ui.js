import { SAMPLE_FILES } from "../samples/sample-manifest.js";

const BOOTSTRAP_I18N = {
  en: {
    "app.title": "Standalone Web Media Analyzer",
    "app.subtitle": "Single-file parser for MP4/fMP4/MOV, WebM, MP3, Ogg Opus, samples, and frame metadata.",
    "language.label": "Language",
    "status.initial": "Open or drop a media file to begin.",
    "status.loadingAnalyzer": "Loading analyzer...",
    "button.open": "Open file",
    "button.openUrl": "Open URL",
    "button.scan": "Scan frame types",
    "button.cancel": "Cancel",
    "button.close": "Close",
    "button.exportJson": "Export JSON",
    "button.exportCsv": "Export CSV",
    "preview.loadedMedia": "Loaded media",
    "preview.playbackRate": "Playback speed",
    "tab.summary": "Summary",
    "tab.boxes": "Boxes",
    "tab.tracks": "Tracks",
    "tab.frames": "Frames",
    "tab.metrics": "Metrics",
    "tab.fragments": "Fragments",
    "tab.warnings": "Warnings",
    "empty.summary": "Open or drop a file to inspect MP4 structure and samples.",
    "empty.boxDetailInitial": "Open a file, then select a box from the tree.",
    "empty.noTracks": "No tracks parsed.",
    "empty.metrics": "Open a file to inspect bitrate and FPS metrics.",
    "empty.noFragments": "No fragments parsed.",
    "empty.noWarnings": "No warnings.",
    "field.sample": "Sample",
    "field.autoFragmentPlaybackSynchronization": "Sync fragment to playback",
    "option.samplePlaceholder": "Sample files...",
    "remote.title": "Open media URL",
    "remote.subtitle": "Files up to 4 MB are downloaded once for shared analysis/playback. Larger files use HTTP range analysis when CORS allows it.",
    "remote.urlLabel": "Media URL",
    "remote.urlPlaceholder": "https://example.com/video.mp4",
    "remote.statusIdle": "Range support is checked before analysis starts.",
    "remote.load": "Load URL",
    "drop.title": "Drop media file to analyze",
    "drop.subtitle": "Release anywhere in this window for MP4/fMP4/MOV, WebM, MP3, or Ogg Opus parsing."
  },
  ko: {
    "app.title": "스탠드얼론 웹 미디어 분석기",
    "app.subtitle": "MP4/fMP4/MOV, WebM, MP3, Ogg Opus, 샘플, 프레임 메타데이터를 분석하는 단일 파일 파서입니다.",
    "language.label": "언어",
    "status.initial": "미디어 파일을 열거나 끌어다 놓으세요.",
    "status.loadingAnalyzer": "분석기 로드 중...",
    "button.open": "파일 열기",
    "button.openUrl": "URL 열기",
    "button.scan": "프레임 타입 스캔",
    "button.cancel": "취소",
    "button.close": "닫기",
    "button.exportJson": "JSON 내보내기",
    "button.exportCsv": "CSV 내보내기",
    "preview.loadedMedia": "로드된 미디어",
    "preview.playbackRate": "재생 속도",
    "tab.summary": "요약",
    "tab.boxes": "박스",
    "tab.tracks": "트랙",
    "tab.frames": "프레임",
    "tab.metrics": "메트릭",
    "tab.fragments": "프래그먼트",
    "tab.warnings": "경고",
    "empty.summary": "파일을 열거나 드롭하면 MP4 구조와 샘플을 검사합니다.",
    "empty.boxDetailInitial": "파일을 연 뒤 트리에서 박스를 선택하세요.",
    "empty.noTracks": "파싱된 트랙이 없습니다.",
    "empty.metrics": "파일을 열면 bitrate와 FPS 메트릭을 확인할 수 있습니다.",
    "empty.noFragments": "파싱된 프래그먼트가 없습니다.",
    "empty.noWarnings": "경고가 없습니다.",
    "field.sample": "샘플",
    "field.autoFragmentPlaybackSynchronization": "프래그먼트 재생 위치 동기화",
    "option.samplePlaceholder": "샘플 파일 선택...",
    "remote.title": "미디어 URL 열기",
    "remote.subtitle": "4MB 이하 파일은 분석/재생 공유를 위해 한 번만 다운로드합니다. 더 큰 파일은 CORS가 허용하면 HTTP range 분석을 사용합니다.",
    "remote.urlLabel": "미디어 URL",
    "remote.urlPlaceholder": "https://example.com/video.mp4",
    "remote.statusIdle": "분석 시작 전에 range 지원 여부를 확인합니다.",
    "remote.load": "URL 로드",
    "drop.title": "분석할 미디어 파일 드롭",
    "drop.subtitle": "이 창 어디에서든 MP4/fMP4/MOV, WebM, MP3, Ogg Opus 파일을 놓으면 파싱합니다."
  }
};

const BOOTSTRAP_SAMPLE_FILES = SAMPLE_FILES;

function startBootstrapUserInterface({ loadRuntime }) {
  if (typeof document === "undefined" || !document.getElementById) return null;
  const elements = collectBootstrapElements();
  let language = elements.languageSelect.value || "en";
  let runtimePromise = null;
  let runtimeApi = null;
  let dropHintHideTimer = 0;

  function translate(key) {
    return (BOOTSTRAP_I18N[language] && BOOTSTRAP_I18N[language][key]) || BOOTSTRAP_I18N.en[key] || key;
  }

  function applyTranslations() {
    document.documentElement.lang = language === "ko" ? "ko" : "en";
    document.title = translate("app.title");
    for (const element of document.querySelectorAll("[data-i18n]")) {
      const key = element.dataset.i18n;
      if (BOOTSTRAP_I18N.en[key]) element.textContent = translate(key);
    }
    for (const element of document.querySelectorAll("[data-i18n-aria-label]")) {
      const key = element.dataset.i18nAriaLabel;
      if (BOOTSTRAP_I18N.en[key]) element.setAttribute("aria-label", translate(key));
    }
    for (const element of document.querySelectorAll("[data-i18n-placeholder]")) {
      const key = element.dataset.i18nPlaceholder;
      if (BOOTSTRAP_I18N.en[key]) element.setAttribute("placeholder", translate(key));
    }
    populateBootstrapSamples();
    setProgress(translate("status.initial"), 0);
  }

  function populateBootstrapSamples() {
    const canUseSamples = canUseSampleCatalog();
    elements.sampleField.hidden = !canUseSamples;
    elements.sampleField.style.display = canUseSamples ? "" : "none";
    elements.sampleField.setAttribute("aria-hidden", canUseSamples ? "false" : "true");
    elements.sampleSelect.disabled = !canUseSamples;
    if (!canUseSamples) {
      elements.sampleSelect.innerHTML = '<option value="">' + escapeHtml(translate("option.samplePlaceholder")) + '</option>';
      return;
    }
    const selectedSampleId = elements.sampleSelect.value;
    elements.sampleSelect.innerHTML = ['<option value="">' + escapeHtml(translate("option.samplePlaceholder")) + '</option>']
      .concat(BOOTSTRAP_SAMPLE_FILES.map((sample) => {
        const selected = sample.id === selectedSampleId ? " selected" : "";
        return '<option value="' + escapeHtml(sample.id) + '"' + selected + '>' + escapeHtml(sample.labels[language] || sample.labels.en || sample.fileName) + '</option>';
      }))
      .join("");
  }

  function canUseSampleCatalog() {
    return Boolean(typeof window !== "undefined" && window.location && (window.location.protocol === "http:" || window.location.protocol === "https:"));
  }

  function setProgress(label, percent) {
    const bounded = Math.max(0, Math.min(100, Number(percent) || 0));
    elements.progressText.textContent = label;
    elements.progressPercent.textContent = Math.round(bounded) + "%";
    elements.progressFill.style.width = bounded + "%";
  }

  function setActiveTab(tabName) {
    for (const button of document.querySelectorAll(".tab")) button.classList.toggle("active", button.dataset.tab === tabName);
    for (const panel of document.querySelectorAll(".panel")) panel.classList.remove("active");
    const panel = document.getElementById(tabName + "Panel");
    if (panel) panel.classList.add("active");
  }

  function ensureRuntime(options = {}) {
    if (runtimeApi) return Promise.resolve(runtimeApi);
    if (!runtimePromise) {
      setProgress(translate("status.loadingAnalyzer"), 5);
      cleanupBootstrapListeners();
      runtimePromise = Promise.resolve(loadRuntime({
        initialActiveTab: getActiveTabName(),
        initialLanguage: language,
        ...options
      })).then((api) => {
        runtimeApi = api;
        return runtimeApi;
      });
    }
    return runtimePromise;
  }

  function getActiveTabName() {
    const activeTab = document.querySelector ? document.querySelector(".tab.active") : null;
    return activeTab && activeTab.dataset.tab ? activeTab.dataset.tab : "summary";
  }

  function handleOpenButtonClick() {
    elements.fileInput.click();
  }

  function handleOpenUrlButtonClick() {
    ensureRuntime({ initialOpenRemoteUrlModal: true });
  }

  function handleFileInputChange() {
    const file = elements.fileInput.files && elements.fileInput.files[0];
    if (file) ensureRuntime({ initialFile: file });
  }

  function handleSampleSelectChange() {
    if (canUseSampleCatalog() && elements.sampleSelect.value) {
      ensureRuntime({ initialSampleId: elements.sampleSelect.value });
    }
  }

  function handleLanguageChange() {
    language = BOOTSTRAP_I18N[elements.languageSelect.value] ? elements.languageSelect.value : "en";
    elements.languageSelect.value = language;
    applyTranslations();
  }

  function handleTabClick(event) {
    const tabButton = event.currentTarget;
    setActiveTab(tabButton.dataset.tab || "summary");
  }

  function handleWindowDragEnter(event) {
    if (!hasDraggedFiles(event.dataTransfer)) return;
    event.preventDefault();
    showDropOverlay();
  }

  function handleWindowDragOver(event) {
    if (!hasDraggedFiles(event.dataTransfer)) return;
    event.preventDefault();
    showDropOverlay();
  }

  function handleWindowDragLeave(event) {
    const leftWindow = event.clientX <= 0 || event.clientY <= 0 ||
      event.clientX >= window.innerWidth || event.clientY >= window.innerHeight;
    if (leftWindow) hideDropOverlay();
  }

  function handleWindowDrop(event) {
    if (!hasDraggedFiles(event.dataTransfer)) return;
    event.preventDefault();
    hideDropOverlay();
    const file = getDroppedMediaFile(event.dataTransfer.files);
    if (file) ensureRuntime({ initialFile: file });
  }

  function showDropOverlay() {
    clearTimeout(dropHintHideTimer);
    elements.dropOverlay.classList.add("active");
  }

  function hideDropOverlay() {
    clearTimeout(dropHintHideTimer);
    elements.dropOverlay.classList.remove("active");
  }

  function hasDraggedFiles(dataTransfer) {
    if (!dataTransfer) return false;
    const types = Array.from(dataTransfer.types || []);
    return types.includes("Files");
  }

  function getDroppedMediaFile(fileList) {
    return Array.from(fileList || []).find(isLikelyMediaFile) || null;
  }

  function isLikelyMediaFile(file) {
    if (!file) return false;
    const name = String(file.name || "").toLowerCase();
    return name.endsWith(".mp4") || name.endsWith(".m4v") || name.endsWith(".mov") ||
      name.endsWith(".webm") || name.endsWith(".mp3") || name.endsWith(".opus") ||
      file.type === "video/mp4" || file.type === "video/quicktime" || file.type === "video/webm" ||
      file.type === "audio/webm" || file.type === "audio/mpeg" || file.type === "audio/ogg" || file.type === "audio/opus";
  }

  function cleanupBootstrapListeners() {
    elements.openButton.removeEventListener("click", handleOpenButtonClick);
    elements.openUrlButton.removeEventListener("click", handleOpenUrlButtonClick);
    elements.fileInput.removeEventListener("change", handleFileInputChange);
    elements.sampleSelect.removeEventListener("change", handleSampleSelectChange);
    elements.languageSelect.removeEventListener("change", handleLanguageChange);
    for (const tabButton of document.querySelectorAll(".tab")) tabButton.removeEventListener("click", handleTabClick);
    window.removeEventListener("dragenter", handleWindowDragEnter, true);
    window.removeEventListener("dragover", handleWindowDragOver, true);
    window.removeEventListener("dragleave", handleWindowDragLeave, true);
    window.removeEventListener("dragend", hideDropOverlay, true);
    window.removeEventListener("drop", handleWindowDrop, true);
  }

  elements.openButton.addEventListener("click", handleOpenButtonClick);
  elements.openUrlButton.addEventListener("click", handleOpenUrlButtonClick);
  elements.fileInput.addEventListener("change", handleFileInputChange);
  elements.sampleSelect.addEventListener("change", handleSampleSelectChange);
  elements.languageSelect.addEventListener("change", handleLanguageChange);
  for (const tabButton of document.querySelectorAll(".tab")) tabButton.addEventListener("click", handleTabClick);
  window.addEventListener("dragenter", handleWindowDragEnter, true);
  window.addEventListener("dragover", handleWindowDragOver, true);
  window.addEventListener("dragleave", handleWindowDragLeave, true);
  window.addEventListener("dragend", hideDropOverlay, true);
  window.addEventListener("drop", handleWindowDrop, true);

  applyTranslations();

  const bootstrapApi = {
    loadRuntime: ensureRuntime,
    canUseSamples: canUseSampleCatalog,
    getSamples: () => canUseSampleCatalog() ? BOOTSTRAP_SAMPLE_FILES.slice() : [],
    runSmokeTests: async () => (await ensureRuntime()).runSmokeTests(),
    analyzeFile: async (file) => (await ensureRuntime()).analyzeFile(file),
    openRemoteUrlModal: async () => (await ensureRuntime({ initialOpenRemoteUrlModal: true })).openRemoteUrlModal(),
    loadSample: async (sampleId) => {
      const alreadyLoaded = Boolean(runtimeApi);
      const api = await ensureRuntime(alreadyLoaded ? {} : { initialSampleId: sampleId });
      return alreadyLoaded ? api.loadSample(sampleId) : BOOTSTRAP_SAMPLE_FILES.find((sample) => sample.id === sampleId) || null;
    }
  };

  if (typeof window !== "undefined") {
    window.MP4AnalyzerBootstrap = bootstrapApi;
    window.MP4AnalyzerDevTools = bootstrapApi;
  }

  return bootstrapApi;
}

function collectBootstrapElements() {
  return {
    fileInput: document.getElementById("fileInput"),
    languageSelect: document.getElementById("languageSelect"),
    sampleField: document.getElementById("sampleField"),
    sampleSelect: document.getElementById("sampleSelect"),
    openButton: document.getElementById("openButton"),
    openUrlButton: document.getElementById("openUrlButton"),
    dropOverlay: document.getElementById("dropOverlay"),
    progressText: document.getElementById("progressText"),
    progressPercent: document.getElementById("progressPercent"),
    progressFill: document.getElementById("progressFill")
  };
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

export { startBootstrapUserInterface };
