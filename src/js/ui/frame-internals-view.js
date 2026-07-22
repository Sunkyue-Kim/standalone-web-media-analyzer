import {
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
import {
  buildFrameInternalsPathGroups,
  getFrameInternalsDisplayBounds
} from "./frame-internals-map.js";

export function renderVideoFrameInternals(model, options = {}) {
  const presentation = createVideoFrameInternalsPresentation(model, options);
  return '<div class="frame-internals-layout">' +
    '<div class="frame-internals-summary">' +
    '<div class="frame-internals-title-row"><strong>' + escapeHtml(presentation.title) + '</strong><span class="pill ' + presentation.frameClass + '">' + escapeHtml(presentation.frameTypeLabel) + '</span></div>' +
    '<p class="frame-internals-note">' + escapeHtml(presentation.accuracyNote) + '</p>' +
    (presentation.structureBudgetNote
      ? '<p class="frame-internals-note">' + escapeHtml(presentation.structureBudgetNote) + '</p>'
      : '') +
    renderFrameInternalsStats(presentation.stats) +
    '</div>' +
    '<div class="block-heatmap-wrap">' +
    '<div class="' + presentation.viewportClass + '" tabindex="0" role="region" aria-label="' + escapeHtml(presentation.mapAriaLabel) + '" style="' + presentation.mapStyle + '">' +
    '<svg class="block-map" viewBox="0 0 ' + formatSvgNumber(presentation.mediaWidth) + ' ' + formatSvgNumber(presentation.mediaHeight) + '" data-media-width="' + escapeHtml(String(presentation.mediaWidth)) + '" data-media-height="' + escapeHtml(String(presentation.mediaHeight)) + '" data-block-count="' + escapeHtml(String(presentation.displayCellCount)) + '" data-path-count="' + escapeHtml(String(presentation.pathCount)) + '" preserveAspectRatio="xMidYMid meet" aria-hidden="true">' +
      presentation.frameOverlayImageHtml +
      presentation.blockPathsHtml +
      '<rect class="block-hover-outline" visibility="hidden"></rect>' +
    '</svg>' +
    (presentation.frameOverlayStatus
      ? '<div class="frame-overlay-status">' + escapeHtml(presentation.frameOverlayStatus) + '</div>'
      : '') +
    '</div>' +
    '<p class="frame-internals-note">' + escapeHtml(presentation.limitationsNote) + '</p>' +
    '</div>' +
    '</div>';
}

export function createVideoFrameInternalsPresentation(model, options = {}) {
  const cells = Array.isArray(model.cells) ? model.cells : [];
  const frameClass = getFrameTypeClass(model.frameType);
  const frameOverlay = normalizeFrameOverlayOptions(options.frameOverlay);
  const pathGroups = getFrameInternalsPathGroups(model, cells, options);
  const displayCellCount = getFrameInternalsDisplayCellCount(model, cells, pathGroups);
  const viewportClass = [
    "block-map-viewport",
    frameOverlay.enabled ? "frame-overlay-enabled" : "",
    frameOverlay.imageUrl ? "has-frame-image" : ""
  ].filter(Boolean).join(" ");
  const stats = [
    ["codec", t("frameInternals.codec"), model.codecFamily],
    ["frame", t("frameInternals.frame"), options.frameLabel || t("value.notAvailable")],
    ["unit", t("frameInternals.unit"), formatCodingUnit(model)],
    ["mediaSize", t("frameInternals.mediaSize"), formatVideoMediaSize(model)],
    ["blockGrid", t("frameInternals.blockGrid"), formatBlockGrid(model)],
    ["rootBlocks", t("frameInternals.rootBlocks"), formatMetricNumber(model.nominalUnitCount, 0)],
    ["codedBlocks", t("frameInternals.codedBlocks"), formatMetricNumber(model.partitionBlockCount, 0)],
    ["leafBlocks", t("frameInternals.leafBlocks"), formatMetricNumber(model.leafBlockCount, 0)],
    ["retainedNodes", t("frameInternals.retainedNodes"), formatMetricNumber(model.retainedStructureRecordCount, 0)],
    ["renderedCells", t("frameInternals.renderedCells"), formatMetricNumber(model.displayCellCount, 0)],
    ["partitionModes", t("frameInternals.partitionModes"), formatPartitionModes(model.partitionModes)],
    ["partitionDepths", t("frameInternals.partitionDepths"), formatPartitionDepths(model.partitionDepths)],
    ["frameBits", t("frameInternals.frameBits"), formatBits(model.sampleBits)],
    ["attributedBits", t("frameInternals.attributedBits"), formatBits(model.attributedBits)],
    ["overheadBits", t("frameInternals.overheadBits"), formatBits(model.overheadBits)],
    ["bitAccounting", t("frameInternals.bitAccounting"), formatFrameInternalsBitAccounting(model)],
    ["source", t("frameInternals.source"), formatFrameInternalsSource(model)],
    ["accuracy", t("frameInternals.accuracy"), formatFrameInternalsAccuracy(model)]
  ];
  return {
    title: formatFrameInternalsTitle(model),
    frameClass,
    frameTypeLabel: formatFrameTypeLabel(model.frameType),
    accuracyNote: t(model.granularity === "root-units" ? "frameInternals.rootGridAccuracy" : "frameInternals.bitstreamSyntaxAccuracy"),
    structureBudgetNote: formatStructureBudgetNote(model),
    stats,
    viewportClass,
    mapAriaLabel: t("frameInternals.zoomPlotAria"),
    mapStyle: renderVideoBlockMapStyle(model),
    mediaWidth: model.mediaWidth,
    mediaHeight: model.mediaHeight,
    displayCellCount,
    pathCount: pathGroups.length,
    frameOverlay,
    frameOverlayImageHtml: renderFrameOverlayImage(model, frameOverlay),
    frameOverlayStatus: formatFrameOverlayStatus(frameOverlay),
    blockPathsHtml: pathGroups.map((group) => renderVideoBlockPathGroup(group, frameClass)).join(""),
    limitationsNote: t(model.granularity === "root-units" ? "frameInternals.rootGridLimitations" : "frameInternals.videoLimitations")
  };
}

function getFrameInternalsPathGroups(model, cells, options) {
  if (Array.isArray(options.pathGroups)) return options.pathGroups;
  if (Array.isArray(model.pathGroups)) return model.pathGroups;
  return buildFrameInternalsPathGroups(cells, { heatmapBucketCount: 32 });
}

function getFrameInternalsDisplayCellCount(model, cells, pathGroups) {
  const declaredDisplayCellCount = Number(model.displayCellCount);
  if (Number.isFinite(declaredDisplayCellCount) && declaredDisplayCellCount >= 0) {
    return Math.round(declaredDisplayCellCount);
  }
  if (cells.length) return cells.length;
  return pathGroups.reduce(
    (totalCellCount, pathGroup) => totalCellCount + Math.max(0, Number(pathGroup.cellCount) || 0),
    0
  );
}

function formatStructureBudgetNote(model) {
  if (!model.structureTruncated) return "";
  return t("frameInternals.structureBudgetNote", {
    decoded: formatMetricNumber(model.partitionBlockCount, 0),
    retained: formatMetricNumber(model.retainedStructureRecordCount, 0),
    omitted: formatMetricNumber(model.omittedPartitionCount, 0)
  });
}

function formatFrameInternalsTitle(model) {
  return t(model.granularity === "root-units" ? "frameInternals.rootTitle" : "frameInternals.videoTitle", {
    codec: String(model.codecFamily || model.codec || t("value.unknown"))
  });
}

function normalizeFrameOverlayOptions(frameOverlay) {
  return {
    enabled: Boolean(frameOverlay && frameOverlay.enabled),
    imageUrl: frameOverlay && frameOverlay.imageUrl ? String(frameOverlay.imageUrl) : "",
    unavailable: Boolean(frameOverlay && frameOverlay.unavailable)
  };
}

function renderFrameOverlayImage(model, frameOverlay) {
  if (!frameOverlay.enabled || !frameOverlay.imageUrl) return "";
  return '<image class="block-frame-overlay" href="' + escapeHtml(frameOverlay.imageUrl) + '"' +
    ' x="0" y="0"' +
    ' width="' + formatSvgNumber(model.mediaWidth) + '"' +
    ' height="' + formatSvgNumber(model.mediaHeight) + '"' +
    ' preserveAspectRatio="xMidYMid meet"></image>';
}

function formatFrameOverlayStatus(frameOverlay) {
  if (!frameOverlay.enabled || frameOverlay.imageUrl) return "";
  return t(frameOverlay.unavailable ? "frameInternals.frameOverlayUnavailable" : "frameInternals.frameOverlayPending");
}

function renderVideoBlockMapStyle(model) {
  const mediaWidth = Math.max(1, Number(model.mediaWidth) || 1);
  const mediaHeight = Math.max(1, Number(model.mediaHeight) || 1);
  const maxHeight = Math.max(160, Number(model.mapMaxHeight) || 280);
  const maxWidth = Math.max(1, Math.round(maxHeight * mediaWidth / mediaHeight));
  return [
    "--frame-aspect-ratio:" + mediaWidth + " / " + mediaHeight,
    "--frame-map-width:" + maxWidth + "px",
    "--frame-map-height:" + maxHeight + "px"
  ].join(";");
}

function formatCodingUnit(model) {
  const unitWidth = getPositiveNumber(model.unitWidth);
  const unitHeight = getPositiveNumber(model.unitHeight);
  const size = unitWidth && unitHeight ? " " + unitWidth + "x" + unitHeight : "";
  return String(model.unitName || "block") + size;
}

function formatBlockGrid(model) {
  const columns = getPositiveNumber(model.nominalColumns, model.displayColumns);
  const rows = getPositiveNumber(model.nominalRows, model.displayRows);
  if (!columns || !rows) return t("value.notAvailable");
  return columns + "x" + rows;
}

function formatPartitionModes(modes) {
  if (!Array.isArray(modes) || !modes.length) return t("value.notAvailable");
  return modes.slice(0, 6).map((entry) =>
    String(entry.mode || t("value.unknown")) + " " + formatMetricNumber(entry.count, 0)
  ).join(", ");
}

function formatPartitionDepths(depths) {
  if (!Array.isArray(depths) || !depths.length) return t("value.notAvailable");
  return depths.map((entry) =>
    "D" + formatMetricNumber(entry.depth, 0) + " " + formatMetricNumber(entry.count, 0)
  ).join(", ");
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

export function createVideoBlockTooltipPayload(cell, model) {
  const displayBounds = getFrameInternalsDisplayBounds(cell);
  const codedBlockWidth = getPositiveNumber(cell.codedBlockWidth, cell.blockWidth, Number(cell.pixelRight) - Number(cell.pixelLeft));
  const codedBlockHeight = getPositiveNumber(cell.codedBlockHeight, cell.blockHeight, Number(cell.pixelBottom) - Number(cell.pixelTop));
  const ownSyntaxBits = getNullableNonNegativeNumber(cell.ownBits, cell.syntaxBits);
  const subtreeBits = getNullableNonNegativeNumber(cell.subtreeBits, ownSyntaxBits);
  const blockArea = Math.max(1, codedBlockWidth * codedBlockHeight);
  const attributedBitsPerPixel = subtreeBits === null ? null : subtreeBits / blockArea;
  return {
    title: t("frameInternals.tooltip.blockTitle", {
      type: String(cell.type || cell.partitionMode || model.unitName || "block"),
      id: String(cell.id || t("value.notAvailable"))
    }),
    rows: [
      [t("frameInternals.tooltip.partitionType"), String(cell.partitionMode || cell.type || t("value.notAvailable"))],
      [t("frameInternals.tooltip.partitionDepth"), formatMetricNumber(cell.depth, 0)],
      [t("frameInternals.tooltip.framePixelRange"), formatCellBounds({
        left: cell.pixelLeft,
        top: cell.pixelTop,
        right: cell.pixelRight,
        bottom: cell.pixelBottom
      })],
      [t("frameInternals.tooltip.displayPixelRange"), formatCellBounds(displayBounds)],
      [t("frameInternals.tooltip.codedBlockSize"), codedBlockWidth + "x" + codedBlockHeight],
      [t("frameInternals.tooltip.ownSyntaxBits"), formatBits(ownSyntaxBits)],
      [t("frameInternals.tooltip.subtreeBits"), formatBits(subtreeBits)],
      [t("frameInternals.tooltip.bitAccounting"), formatFrameInternalsBitAccounting(model)],
      [t("frameInternals.tooltip.bitsPerPixel"), attributedBitsPerPixel === null ? t("value.notAvailable") : formatMetricNumber(attributedBitsPerPixel, 4)],
      [t("frameInternals.tooltip.aggregatedBlocks"), formatMetricNumber(cell.aggregatedDescendantCount || 0, 0)],
      [t("frameInternals.tooltip.accuracy"), formatFrameInternalsAccuracy(model)]
    ],
    note: t(model.granularity === "root-units" ? "frameInternals.rootGridLimitations" : "frameInternals.videoLimitations")
  };
}

function renderVideoBlockPathGroup(group, frameClass) {
  return '<path class="block-cell block-cell-path ' + frameClass + '"' +
    ' d="' + escapeHtml(String(group.pathData || "")) + '"' +
    ' style="--cell-red:' + formatSvgNumber(group.red) +
      ';--cell-green:' + formatSvgNumber(group.green) +
      ';--cell-blue:' + formatSvgNumber(group.blue) +
      ';--cell-alpha:' + formatSvgNumber(group.alpha) + '"' +
    ' data-cell-count="' + escapeHtml(String(Math.max(0, Number(group.cellCount) || 0))) + '"></path>';
}

function formatSvgNumber(value) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return "0";
  return Math.abs(numberValue - Math.round(numberValue)) < 0.001
    ? String(Math.round(numberValue))
    : numberValue.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
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

function formatFrameInternalsSource(model) {
  const source = String(model.source || "native-js-bitstream-parser");
  return source === "native-js-bitstream-parser" ? t("frameInternals.nativeJsParser") : source;
}

function formatFrameInternalsAccuracy(model) {
  const accuracy = String(model.accuracy || "bitstream-syntax-decoded");
  if (accuracy === "bitstream-root-units") return t("frameInternals.rootUnitsDecoded");
  return accuracy === "bitstream-syntax-decoded" ? t("frameInternals.syntaxDecoded") : accuracy;
}

function formatFrameInternalsBitAccounting(model) {
  if (model.accountingKind === "cavlc-syntax-bit-length") return t("frameInternals.bitAccounting.cavlc");
  if (model.accountingKind === "cabac-renormalization-cursor-delta") return t("frameInternals.bitAccounting.cabac");
  return t("value.notAvailable");
}

function getPositiveNumber(...values) {
  for (const value of values) {
    const numberValue = Number(value);
    if (Number.isFinite(numberValue) && numberValue > 0) return Math.round(numberValue);
  }
  return 0;
}

function getNullableNonNegativeNumber(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const numberValue = Number(value);
    if (Number.isFinite(numberValue) && numberValue >= 0) return numberValue;
  }
  return null;
}

export function renderAudioFrameInternals() {
  return '<div class="empty compact">' + escapeHtml(t("frameInternals.audioUnsupported")) + '</div>';
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
  return '<div class="frame-internals-stats">' + stats.map(([, label, value]) =>
    '<div class="frame-internals-stat"><span>' + escapeHtml(label) + '</span><strong>' + escapeHtml(String(value)) + '</strong></div>'
  ).join("") + '</div>';
}

function formatBits(value) {
  if (value === null || value === undefined || value === "" || !Number.isFinite(Number(value))) return t("value.notAvailable");
  const bits = Math.max(0, Number(value));
  if (bits < 1000) return formatMetricNumber(bits, getBitPrecision(bits)) + " bits";
  if (bits < 1000000) return formatMetricNumber(bits / 1000, bits < 10000 ? 2 : 1) + " Kbits";
  return formatMetricNumber(bits / 1000000, bits < 10000000 ? 2 : 1) + " Mbits";
}

function getBitPrecision(value) {
  const bits = Math.max(0, Number(value) || 0);
  if (bits < 1) return 3;
  if (bits < 10) return 2;
  if (bits < 100) return 1;
  return 0;
}

export function formatFrameTypeLabel(type) {
  if (type === "unknown") return t("value.unknown");
  if (type === "audio") return t("value.audio");
  if (type === "sample") return t("value.sample");
  if (String(type).startsWith("mixed") && getLanguage() === "ko") return type.replace("mixed", "혼합");
  return type;
}
