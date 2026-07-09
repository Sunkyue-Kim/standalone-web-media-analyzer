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
    [t("frameInternals.mediaSize"), formatVideoMediaSize(model)],
    [t("frameInternals.nominalGrid"), model.nominalColumns + "x" + model.nominalRows + " (" + model.nominalUnitCount + ")"],
    [t("frameInternals.displayedGrid"), formatVideoDisplayedGrid(model)],
    [t("frameInternals.partitionModes"), formatPartitionModes(model.partitionModes)],
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
    '<div class="block-map-viewport" tabindex="0" role="button" aria-pressed="false" aria-label="' + escapeHtml(t("frameInternals.zoomPlotAria")) + '" style="' + renderVideoBlockMapStyle(model) + '">' +
    '<div class="block-map">' +
      model.cells.map((cell) => renderVideoBlockCell(cell, model, frameClass)).join("") +
    '</div>' +
    '</div>' +
    '<p class="frame-internals-note">' + escapeHtml(t("frameInternals.videoEstimateNote")) + '</p>' +
    '</div>' +
    '</div>' +
    renderVideoInternalsMetrics(model);
}

function renderVideoBlockMapStyle(model) {
  const mediaWidth = Math.max(1, Number(model.mediaWidth) || 1);
  const mediaHeight = Math.max(1, Number(model.mediaHeight) || 1);
  const maxHeight = Math.max(160, Number(model.mapMaxHeight) || 280);
  const maxWidth = Math.max(1, Math.round(maxHeight * mediaWidth / mediaHeight));
  return [
    "--frame-aspect-ratio:" + mediaWidth + " / " + mediaHeight,
    "--frame-map-max-width:" + maxWidth + "px"
  ].join(";");
}

function formatVideoDisplayedGrid(model) {
  const blocks = model.partitionBlockCount || model.displayCellCount || 0;
  const roots = model.displayColumns && model.displayRows ? model.displayColumns + "x" + model.displayRows : t("value.notAvailable");
  const depth = model.maxPartitionDepth ? ", " + t("frameInternals.maxDepth", { depth: model.maxPartitionDepth }) : "";
  const aggregation = model.aggregation > 1 ? ", " + t("frameInternals.rootAggregation", { value: model.aggregation }) : "";
  return t("frameInternals.partitionBlocks", { count: blocks }) + " (" + roots + depth + aggregation + ")";
}

function formatPartitionModes(modes) {
  if (!Array.isArray(modes) || !modes.length) return t("value.notAvailable");
  return modes.slice(0, 4).map((entry) => entry.mode + " " + entry.count).join(", ");
}

function formatVideoMediaSize(model) {
  const displaySize = model.mediaWidth + "x" + model.mediaHeight;
  const encodedWidth = Number(model.encodedWidth) || 0;
  const encodedHeight = Number(model.encodedHeight) || 0;
  const rotationDegrees = Number(model.displayRotationDegrees) || 0;
  const details = [];
  if (rotationDegrees) details.push(t("frameInternals.rotatedDegrees", { degrees: rotationDegrees }));
  if (encodedWidth && encodedHeight && (encodedWidth !== model.mediaWidth || encodedHeight !== model.mediaHeight)) {
    details.push(t("frameInternals.encodedSize", { size: encodedWidth + "x" + encodedHeight }));
  }
  return details.length ? displaySize + " (" + details.join(", ") + ")" : displaySize;
}

function renderVideoBlockCell(cell, model, frameClass) {
  const displayBounds = getDisplayCellBounds(cell);
  const title = model.unitName + " " + (cell.blockWidth || 0) + "x" + (cell.blockHeight || 0) + " @ " + cell.pixelLeft + "," + cell.pixelTop;
  const tooltipRows = [
    [t("frameInternals.tooltip.encodedPixelRange"), cell.pixelLeft + "," + cell.pixelTop + " - " + cell.pixelRight + "," + cell.pixelBottom],
    [t("frameInternals.tooltip.displayPixelRange"), formatCellBounds(displayBounds)],
    [t("frameInternals.tooltip.blockSize"), (cell.blockWidth || 0) + "x" + (cell.blockHeight || 0)],
    [t("frameInternals.tooltip.partition"), cell.partitionMode || t("value.notAvailable")],
    [t("frameInternals.tooltip.depth"), cell.depth || 0],
    [t("frameInternals.tooltip.estimatedBytes"), formatBytes(cell.estimatedBytes)],
    [t("frameInternals.tooltip.byteDensity"), formatByteDensity(cell.estimatedBytesPerPixel, cell.normalizedByteDensity)],
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
    ' style="' + renderVideoBlockCellStyle(cell, model) + '"></div>';
}

function renderVideoBlockCellStyle(cell, model) {
  const color = cell.color || { red: 31, green: 122, blue: 140 };
  const alpha = Number.isFinite(cell.intensity) ? cell.intensity : 0.75;
  const displayBounds = getDisplayCellBounds(cell);
  const mediaWidth = Math.max(1, Number(model.mediaWidth) || 1);
  const mediaHeight = Math.max(1, Number(model.mediaHeight) || 1);
  return [
    '--cell-red:' + color.red,
    '--cell-green:' + color.green,
    '--cell-blue:' + color.blue,
    '--cell-alpha:' + alpha.toFixed(3),
    '--cell-left:' + (displayBounds.left * 100 / mediaWidth).toFixed(5) + '%',
    '--cell-top:' + (displayBounds.top * 100 / mediaHeight).toFixed(5) + '%',
    '--cell-width:' + ((displayBounds.right - displayBounds.left) * 100 / mediaWidth).toFixed(5) + '%',
    '--cell-height:' + ((displayBounds.bottom - displayBounds.top) * 100 / mediaHeight).toFixed(5) + '%',
    '--cell-depth:' + (cell.depth || 0)
  ].join(";");
}

function getDisplayCellBounds(cell) {
  return {
    left: getFiniteNumber(cell.displayPixelLeft, cell.pixelLeft),
    top: getFiniteNumber(cell.displayPixelTop, cell.pixelTop),
    right: getFiniteNumber(cell.displayPixelRight, cell.pixelRight),
    bottom: getFiniteNumber(cell.displayPixelBottom, cell.pixelBottom)
  };
}

function formatCellBounds(bounds) {
  return formatCellCoordinate(bounds.left) + "," + formatCellCoordinate(bounds.top) +
    " - " + formatCellCoordinate(bounds.right) + "," + formatCellCoordinate(bounds.bottom);
}

function formatCellCoordinate(value) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return "0";
  return Math.abs(numberValue - Math.round(numberValue)) < 0.001
    ? String(Math.round(numberValue))
    : formatMetricNumber(numberValue, 2);
}

function formatByteDensity(bytesPerPixel, normalizedByteDensity) {
  const density = Number(bytesPerPixel);
  const normalized = Number(normalizedByteDensity);
  if (!Number.isFinite(density) || density < 0) return t("value.notAvailable");
  const normalizedText = Number.isFinite(normalized) && normalized >= 0
    ? ", " + formatMetricNumber(normalized, 2) + "x"
    : "";
  return formatMetricNumber(density, density < 0.01 ? 4 : 3) + " B/px" + normalizedText;
}

function getFiniteNumber(primaryValue, fallbackValue) {
  const primaryNumber = Number(primaryValue);
  if (Number.isFinite(primaryNumber)) return primaryNumber;
  const fallbackNumber = Number(fallbackValue);
  return Number.isFinite(fallbackNumber) ? fallbackNumber : 0;
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

function renderVideoInternalsMetrics(model) {
  const cells = Array.isArray(model.cells) ? model.cells : [];
  if (!cells.length) return "";
  const densities = cells.map((cell) => Number(cell.estimatedBytesPerPixel)).filter(isFiniteNonNegative);
  const estimatedBytes = cells.map((cell) => Number(cell.estimatedBytes)).filter(isFiniteNonNegative);
  const areas = cells.map((cell) => Math.max(1, Number(cell.blockWidth) * Number(cell.blockHeight) || 1));
  const blockSizeGroups = getTopCountGroups(cells.map((cell) => (cell.blockWidth || 0) + "x" + (cell.blockHeight || 0)), 6);
  const depthGroups = getTopCountGroups(cells.map((cell) => t("frameInternals.depthLabel", { depth: cell.depth || 0 })), 8);
  const modeGroups = getTopCountGroups(cells.map((cell) => cell.partitionMode || t("value.unknown")), 8);
  const commonBlock = blockSizeGroups[0];
  const sampleBytes = Math.max(0, Number(model.sampleSize) || sumNumbers(estimatedBytes));
  const cards = [
    [t("frameInternals.stats.blocks"), formatMetricNumber(cells.length, 0)],
    [t("frameInternals.stats.totalBits"), formatBits(sampleBytes * 8)],
    [t("frameInternals.stats.commonBlock"), commonBlock ? commonBlock.label + " (" + commonBlock.count + ")" : t("value.notAvailable")],
    [t("frameInternals.stats.medianArea"), formatArea(getQuantile(areas, 0.5))],
    [t("frameInternals.stats.medianDensity"), formatDensityValue(getQuantile(densities, 0.5))],
    [t("frameInternals.stats.p95Density"), formatDensityValue(getQuantile(densities, 0.95))],
    [t("frameInternals.stats.maxBlockBits"), formatBits(Math.max(0, ...estimatedBytes) * 8)],
    [t("frameInternals.stats.p95BlockBits"), formatBits(getQuantile(estimatedBytes, 0.95) * 8)]
  ];
  return renderInternalsMetricsSection([
    renderInternalMetricCards(cards),
    '<div class="frame-internals-chart-grid">' +
      renderInternalsBarChart(t("frameInternals.stats.blockSizeDistribution"), blockSizeGroups.map((group) => ({
        label: group.label,
        value: group.count,
        detail: t("frameInternals.stats.blockCount", { count: group.count })
      }))) +
      renderInternalsBarChart(t("frameInternals.stats.byteDensityDistribution"), buildHistogramEntries(densities, 6, formatDensityValue)) +
      renderInternalsBarChart(t("frameInternals.stats.partitionModes"), modeGroups.map((group) => ({
        label: group.label,
        value: group.count,
        detail: t("frameInternals.stats.blockCount", { count: group.count })
      }))) +
      renderInternalsBarChart(t("frameInternals.stats.partitionDepth"), depthGroups.map((group) => ({
        label: group.label,
        value: group.count,
        detail: t("frameInternals.stats.blockCount", { count: group.count })
      }))) +
    '</div>'
  ].join(""));
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
    '</div>' +
    renderAudioInternalsMetrics(model);
}

function renderAudioInternalsMetrics(model) {
  const bands = Array.isArray(model.bands) ? model.bands : [];
  if (!bands.length) return "";
  const estimatedBytes = bands.map((band) => Number(band.estimatedBytes)).filter(isFiniteNonNegative);
  const totalBytes = Math.max(0, Number(model.sampleSize) || sumNumbers(estimatedBytes));
  const activeBands = bands.filter((band) => band.active).length;
  const peakBand = bands.reduce((currentPeak, band) =>
    Number(band.estimatedBytes) > Number(currentPeak && currentPeak.estimatedBytes || -1) ? band : currentPeak,
  null);
  const cards = [
    [t("frameInternals.stats.bands"), formatMetricNumber(bands.length, 0)],
    [t("frameInternals.stats.activeBands"), formatMetricNumber(activeBands, 0)],
    [t("frameInternals.stats.totalBits"), formatBits(totalBytes * 8)],
    [t("frameInternals.stats.peakBand"), peakBand ? peakBand.label : t("value.notAvailable")],
    [t("frameInternals.stats.medianBandBits"), formatBits(getQuantile(estimatedBytes, 0.5) * 8)],
    [t("frameInternals.activeBandwidth"), formatAudioFrequency(model.activeBandwidthHz)]
  ];
  return renderInternalsMetricsSection([
    renderInternalMetricCards(cards),
    '<div class="frame-internals-chart-grid">' +
      renderInternalsBarChart(t("frameInternals.stats.bandByteShare"), bands.map((band) => ({
        label: band.label,
        value: Number(band.estimatedBytes) || 0,
        detail: formatBits((Number(band.estimatedBytes) || 0) * 8) + " · " + formatMetricNumber((band.ratio || 0) * 100, 1) + "%"
      }))) +
      renderInternalsBarChart(t("frameInternals.stats.bandActivity"), bands.map((band) => ({
        label: band.label,
        value: band.active ? 1 : 0.08,
        detail: band.active ? t("frameInternals.stats.active") : t("frameInternals.stats.inactive")
      }))) +
    '</div>'
  ].join(""));
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

function renderInternalsMetricsSection(content) {
  return '<section class="frame-internals-metrics">' +
    '<div class="frame-internals-metrics-head">' +
      '<h3>' + escapeHtml(t("frameInternals.stats.title")) + '</h3>' +
      '<span>' + escapeHtml(t("frameInternals.stats.subtitle")) + '</span>' +
    '</div>' +
    content +
  '</section>';
}

function renderInternalMetricCards(cards) {
  return '<div class="frame-internals-metric-cards">' + cards.map(([label, value]) =>
    '<div class="frame-internals-metric-card"><span>' + escapeHtml(label) + '</span><strong>' + escapeHtml(String(value)) + '</strong></div>'
  ).join("") + '</div>';
}

function renderInternalsBarChart(title, entries) {
  const visibleEntries = (Array.isArray(entries) ? entries : []).filter((entry) => entry && isFiniteNonNegative(entry.value));
  if (!visibleEntries.length) return '<section class="frame-internals-chart-card"><h4>' + escapeHtml(title) + '</h4>' + escapeHtml(t("value.notAvailable")) + '</section>';
  const maxValue = Math.max(...visibleEntries.map((entry) => entry.value), 1);
  return '<section class="frame-internals-chart-card">' +
    '<h4>' + escapeHtml(title) + '</h4>' +
    '<div class="frame-internals-bar-list">' +
      visibleEntries.map((entry) => renderInternalsBarRow(entry, maxValue)).join("") +
    '</div>' +
  '</section>';
}

function renderInternalsBarRow(entry, maxValue) {
  const widthPercent = clamp((Number(entry.value) || 0) * 100 / Math.max(1, maxValue), 1.2, 100);
  return '<div class="frame-internals-bar-row">' +
    '<span class="frame-internals-bar-label">' + escapeHtml(entry.label) + '</span>' +
    '<span class="frame-internals-bar-track"><span style="width:' + widthPercent.toFixed(3) + '%"></span></span>' +
    '<strong>' + escapeHtml(entry.detail || formatMetricNumber(entry.value, 0)) + '</strong>' +
  '</div>';
}

function getTopCountGroups(values, limit) {
  const counts = new Map();
  for (const value of values) {
    const label = String(value || t("value.unknown"));
    counts.set(label, (counts.get(label) || 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([label, count]) => ({ label, count, value: count }))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label))
    .slice(0, limit);
}

function buildHistogramEntries(values, binCount, formatter) {
  const sortedValues = values.filter(isFiniteNonNegative).sort((left, right) => left - right);
  if (!sortedValues.length) return [];
  const minValue = sortedValues[0];
  const maxValue = sortedValues[sortedValues.length - 1];
  if (minValue === maxValue) {
    return [{
      label: formatter(minValue),
      value: sortedValues.length,
      detail: t("frameInternals.stats.blockCount", { count: sortedValues.length })
    }];
  }
  const bins = Array.from({ length: binCount }, (_, index) => ({
    index,
    start: minValue + (maxValue - minValue) * index / binCount,
    end: minValue + (maxValue - minValue) * (index + 1) / binCount,
    count: 0
  }));
  for (const value of sortedValues) {
    const rawIndex = Math.floor((value - minValue) * binCount / (maxValue - minValue));
    bins[Math.min(binCount - 1, Math.max(0, rawIndex))].count += 1;
  }
  return bins
    .filter((bin) => bin.count > 0)
    .map((bin) => ({
      label: formatter(bin.start) + " - " + formatter(bin.end),
      value: bin.count,
      detail: t("frameInternals.stats.blockCount", { count: bin.count })
    }));
}

function getQuantile(values, quantile) {
  const sortedValues = values.filter(isFiniteNonNegative).sort((left, right) => left - right);
  if (!sortedValues.length) return 0;
  const position = (sortedValues.length - 1) * clamp(quantile, 0, 1);
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  if (lowerIndex === upperIndex) return sortedValues[lowerIndex];
  const weight = position - lowerIndex;
  return sortedValues[lowerIndex] * (1 - weight) + sortedValues[upperIndex] * weight;
}

function formatBits(value) {
  const bits = Math.max(0, Number(value) || 0);
  if (bits < 1000) return formatMetricNumber(bits, 0) + " bits";
  if (bits < 1000000) return formatMetricNumber(bits / 1000, bits < 10000 ? 2 : 1) + " Kbits";
  return formatMetricNumber(bits / 1000000, bits < 10000000 ? 2 : 1) + " Mbits";
}

function formatArea(value) {
  return formatMetricNumber(Math.max(0, Number(value) || 0), 0) + " px";
}

function formatDensityValue(value) {
  const density = Math.max(0, Number(value) || 0);
  return formatMetricNumber(density, density < 0.01 ? 4 : 3) + " B/px";
}

function sumNumbers(values) {
  return values.reduce((sum, value) => sum + (Number(value) || 0), 0);
}

function isFiniteNonNegative(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue >= 0;
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
