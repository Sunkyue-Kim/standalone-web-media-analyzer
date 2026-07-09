function canUseSampleCatalogLocation(location) {
  return Boolean(location && (location.protocol === "http:" || location.protocol === "https:"));
}

function getFrameRowKey(row) {
  return String(row.trackId) + ":" + String(row.sampleIndex);
}

function isLikelyMediaFile(file) {
  if (!file) return false;
  const name = String(file.name || "").toLowerCase();
  return name.endsWith(".mp4") || name.endsWith(".m4v") || name.endsWith(".mov") ||
    name.endsWith(".webm") || name.endsWith(".mp3") || name.endsWith(".opus") ||
    file.type === "video/mp4" || file.type === "video/quicktime" || file.type === "video/webm" ||
    file.type === "audio/webm" || file.type === "audio/mpeg" || file.type === "audio/ogg" || file.type === "audio/opus";
}

function getFrameTypeClass(type) {
  if (type === "I" || type === "IDR") return "i";
  if (type === "P") return "p";
  if (type === "B") return "b";
  if (type === "AAC" || type === "MP3" || type === "Opus" || type === "audio") return "aac";
  if (type === "unknown") return "warn";
  if (String(type).startsWith("mixed")) return "err";
  return "";
}

function csvCell(value) {
  const text = value === undefined || value === null ? "" : String(value);
  if (/[",\n]/.test(text)) return '"' + text.replace(/"/g, '""') + '"';
  return text;
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

export {
  canUseSampleCatalogLocation,
  csvCell,
  escapeHtml,
  getFrameRowKey,
  getFrameTypeClass,
  isLikelyMediaFile
};
