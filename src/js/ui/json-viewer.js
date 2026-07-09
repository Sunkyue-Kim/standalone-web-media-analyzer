import { safeJsonReplacer } from "../core/analyzer-core.js";
import { t } from "../i18n/catalogs.js";
import { escapeHtml } from "./ui-helpers.js";

const JSON_BYTE_PREVIEW_COUNT = 16;
const JSON_BYTE_EXPANDED_LIMIT = 2048;

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
  if (isHexDumpField(context.key, value)) return renderJsonHexDump(value);
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

function renderJsonHexDump(value) {
  return '<details class="json-node json-hex-dump" open><summary><span class="json-summary-type">hex</span><span class="json-preview">' +
    escapeHtml(t("boxes.hexRows", { count: value.length })) + '</span></summary><code class="json-byte-dump">' +
    escapeHtml(value.join("\n")) + '</code></details>';
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

function isHexDumpField(fieldName, value) {
  return fieldName === "hexDump" && value.every((item) => typeof item === "string");
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

export {
  isHexDumpField,
  renderJsonHexDump,
  renderJsonViewer
};
