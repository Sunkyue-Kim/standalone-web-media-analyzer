import {
  clamp,
  formatBytes,
  formatMetricNumber
} from "../core/analyzer-core.js";
import {
  getLanguage,
  t
} from "../i18n/catalogs.js";
import {
  escapeHtml,
  getFrameTypeClass
} from "./ui-helpers.js";

export function renderVideoFrameInternals(model, options = {}) {
  const frameClass = getFrameTypeClass(model.frameType);
  const stats = [
    [t("frameInternals.codec"), model.codecFamily],
    [t("frameInternals.frame"), options.frameLabel || t("value.notAvailable")],
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

export function renderAudioFrameInternals(model, options = {}) {
  const stats = [
    [t("frameInternals.codec"), model.title],
    [t("frameInternals.frame"), options.frameLabel || t("value.notAvailable")],
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

export function renderFrameInternalsTooltipAttributes(payload) {
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

export function renderFrameInternalsTooltip(payload) {
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

function renderFrameInternalsStats(stats) {
  return '<div class="frame-internals-stats">' + stats.map(([label, value]) =>
    '<div class="frame-internals-stat"><span>' + escapeHtml(label) + '</span><strong>' + escapeHtml(String(value)) + '</strong></div>'
  ).join("") + '</div>';
}

export function formatFrameTypeLabel(type) {
  if (type === "unknown") return t("value.unknown");
  if (type === "audio") return t("value.audio");
  if (type === "sample") return t("value.sample");
  if (String(type).startsWith("mixed") && getLanguage() === "ko") return type.replace("mixed", "혼합");
  return type;
}

function formatAudioFrequency(value) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || numberValue <= 0) return t("value.notAvailable");
  return numberValue >= 1000 ? formatMetricNumber(numberValue / 1000, 1) + " kHz" : formatMetricNumber(numberValue, 0) + " Hz";
}
