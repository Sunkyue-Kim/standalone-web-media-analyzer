const MAX_VIDEO_DISPLAY_CELLS = 100000;

const HEAT_COLOR_STOPS = [
  { percentile: 0, red: 226, green: 245, blue: 241 },
  { percentile: 0.25, red: 116, green: 209, blue: 188 },
  { percentile: 0.5, red: 28, green: 164, blue: 135 },
  { percentile: 0.75, red: 255, green: 191, blue: 0 },
  { percentile: 0.9, red: 247, green: 124, blue: 60 },
  { percentile: 1, red: 198, green: 40, blue: 40 }
];

const VIDEO_CODING_UNITS = [
  {
    id: "avc",
    matches: (track) => track.codecDescriptor === "avc" || ["avc1", "avc2", "avc3", "avc4"].includes(track.codec),
    codecFamily: "AVC / H.264",
    unitName: "macroblock",
    unitWidth: 16,
    unitHeight: 16
  },
  {
    id: "hevc",
    matches: (track) => track.codecDescriptor === "hevc" || ["hvc1", "hev1"].includes(track.codec),
    codecFamily: "HEVC / H.265",
    unitName: "CTU",
    unitWidth: 64,
    unitHeight: 64
  },
  {
    id: "vp9",
    matches: (track) => track.codecDescriptor === "vp9" || ["vp09", "V_VP9", "vp9"].includes(track.codec),
    codecFamily: "VP9",
    unitName: "superblock",
    unitWidth: 64,
    unitHeight: 64
  },
  {
    id: "av1",
    matches: (track) => track.codecDescriptor === "av1" || ["av01", "V_AV1"].includes(track.codec),
    codecFamily: "AV1",
    unitName: "superblock",
    unitWidth: 128,
    unitHeight: 128
  }
];

function buildFrameInternalsModel(row, track, options = {}) {
  if (!row || !track) {
    return {
      kind: "empty",
      title: "No frame selected",
      note: "Select a video frame to inspect its coded block structure."
    };
  }
  if (track.handlerType !== "vide") {
    return {
      kind: "unsupported",
      title: "Block structure unavailable",
      note: "Macroblocks, coding units, and superblocks apply to video coding tracks only."
    };
  }
  const descriptor = VIDEO_CODING_UNITS.find((candidate) => candidate.matches(track));
  if (!descriptor) {
    return {
      kind: "unsupported",
      title: "Video block view unavailable",
      note: "No native JavaScript block-syntax parser is registered for this codec.",
      codec: track.codec
    };
  }
  if (options.loading) {
    return {
      kind: "loading",
      title: descriptor.codecFamily + " block syntax",
      note: "Reading and parsing the selected sample bitstream."
    };
  }
  const parsedFrameInternals = options.parsedFrameInternals;
  if (!parsedFrameInternals) {
    return {
      kind: "loading",
      title: descriptor.codecFamily + " block syntax",
      note: "Reading and parsing the selected sample bitstream."
    };
  }
  if (parsedFrameInternals.complete !== true) {
    return {
      kind: "unsupported",
      title: descriptor.codecFamily + " block syntax unavailable",
      note: parsedFrameInternals.reason || "The selected frame uses syntax that cannot be traversed exactly.",
      codec: track.codec,
      warnings: parsedFrameInternals.warnings || []
    };
  }
  return buildActualVideoInternalsModel(row, track, descriptor, parsedFrameInternals);
}

function buildActualVideoInternalsModel(row, track, descriptor, parsedFrameInternals) {
  const dimensions = getVideoTrackDimensions(track);
  const rawRoots = getParsedRoots(parsedFrameInternals);
  const roots = rawRoots.map((block, index) => normalizeParsedBlock(block, {
    fallbackId: descriptor.id + "-root-" + index,
    depth: 0,
    rootIndex: index,
    parentId: ""
  })).filter(Boolean);
  if (!roots.length) {
    return {
      kind: "unsupported",
      title: descriptor.codecFamily + " block syntax unavailable",
      note: "The syntax parser completed without returning any coded blocks.",
      codec: track.codec
    };
  }

  const allBlocks = flattenBlockTree(roots);
  const cells = selectDisplayCells(roots, MAX_VIDEO_DISPLAY_CELLS);
  const intrinsicBounds = getPartitionCellIntrinsicBounds(
    allBlocks,
    positiveDimension(parsedFrameInternals.codedWidth) || dimensions.encodedWidth,
    positiveDimension(parsedFrameInternals.codedHeight) || dimensions.encodedHeight
  );
  const declaredVisibleWidth = positiveDimension(parsedFrameInternals.width) ||
    positiveDimension(parsedFrameInternals.metadata && parsedFrameInternals.metadata.displayWidth) ||
    dimensions.encodedWidth;
  const declaredVisibleHeight = positiveDimension(parsedFrameInternals.height) ||
    positiveDimension(parsedFrameInternals.metadata && parsedFrameInternals.metadata.displayHeight) ||
    dimensions.encodedHeight;
  const visibleBounds = declaredVisibleWidth && declaredVisibleHeight
    ? { width: declaredVisibleWidth, height: declaredVisibleHeight }
    : getPartitionCellIntrinsicBounds(allBlocks, dimensions.encodedWidth, dimensions.encodedHeight);
  const displayDimensions = getDisplayDimensionsForIntrinsicBounds(visibleBounds, dimensions);
  orientVideoPartitionCells(cells, dimensions, visibleBounds);
  const colorScale = buildFrameInternalsColorScale(track, [], { cells });
  applyVideoColorScale(cells, colorScale);
  const retainedPartitionSummary = summarizeParsedBlocks(allBlocks);
  const partitionSummary = {
    maxDepth: positiveIntegerOrZero(parsedFrameInternals.maxPartitionDepth, retainedPartitionSummary.maxDepth),
    depths: normalizeCountEntries(parsedFrameInternals.partitionDepths, "depth", retainedPartitionSummary.depths),
    modes: normalizeCountEntries(parsedFrameInternals.partitionModes, "mode", retainedPartitionSummary.modes)
  };
  const rootWidth = positiveDimension(parsedFrameInternals.unitWidth) || positiveDimension(roots[0] && roots[0].blockWidth) || descriptor.unitWidth;
  const rootHeight = positiveDimension(parsedFrameInternals.unitHeight) || positiveDimension(roots[0] && roots[0].blockHeight) || descriptor.unitHeight;
  const nominalColumns = positiveInteger(parsedFrameInternals.columns) || Math.max(1, Math.ceil(intrinsicBounds.width / rootWidth));
  const nominalRows = positiveInteger(parsedFrameInternals.rows) || Math.max(1, Math.ceil(intrinsicBounds.height / rootHeight));
  const sampleBits = finiteNonNegative(parsedFrameInternals.sampleBits, Number(row.size) * 8);
  const hasTreeBitAccounting = roots.every((root) => root.subtreeBits !== null);
  const attributedBits = nullableNonNegative(parsedFrameInternals.attributedBits,
    hasTreeBitAccounting ? sumNumbers(roots.map((root) => root.subtreeBits)) : null);
  const overheadBits = nullableNonNegative(parsedFrameInternals.overheadBits,
    attributedBits === null ? null : Math.max(0, sampleBits - attributedBits));
  const granularity = String(parsedFrameInternals.granularity || "partition-tree");

  return {
    kind: "video-grid",
    title: descriptor.codecFamily + (granularity === "root-units" ? " actual root block grid" : " actual block structure"),
    codecFamily: parsedFrameInternals.codecFamily || descriptor.codecFamily,
    codec: track.codec,
    frameType: row.frameType || "unknown",
    sampleBits,
    attributedBits,
    overheadBits,
    accountingKind: String(parsedFrameInternals.accountingKind || "unavailable"),
    bitAccountingComplete: attributedBits !== null && overheadBits !== null &&
      Math.abs(sampleBits - attributedBits - overheadBits) < 0.01,
    granularity,
    unitName: parsedFrameInternals.unitName || descriptor.unitName,
    unitWidth: rootWidth,
    unitHeight: rootHeight,
    mediaWidth: displayDimensions.width,
    mediaHeight: displayDimensions.height,
    intrinsicWidth: intrinsicBounds.width,
    intrinsicHeight: intrinsicBounds.height,
    encodedWidth: dimensions.encodedWidth,
    encodedHeight: dimensions.encodedHeight,
    displayRotationDegrees: dimensions.displayRotationDegrees,
    pixelAspectRatioNumerator: dimensions.pixelAspectRatioNumerator,
    pixelAspectRatioDenominator: dimensions.pixelAspectRatioDenominator,
    pixelAspectRatio: dimensions.pixelAspectRatio,
    layout: "partition-map",
    nominalColumns,
    nominalRows,
    nominalUnitCount: roots.length,
    displayColumns: nominalColumns,
    displayRows: nominalRows,
    displayCellCount: cells.length,
    aggregation: cells.some((cell) => cell.aggregatedDescendantCount > 0) ? "actual-tree-budget" : "none",
    partitionBlockCount: positiveInteger(parsedFrameInternals.decodedStructureRecordCount) || allBlocks.length,
    leafBlockCount: positiveInteger(parsedFrameInternals.leafBlockCount) ||
      allBlocks.filter((block) => !block.children.length).length,
    retainedStructureRecordCount: positiveInteger(parsedFrameInternals.structureRecordCount) || allBlocks.length,
    structureTruncated: Boolean(parsedFrameInternals.structureTruncated),
    omittedPartitionCount: positiveIntegerOrZero(parsedFrameInternals.omittedPartitionCount, 0),
    maxPartitionDepth: partitionSummary.maxDepth,
    partitionDepths: partitionSummary.depths,
    partitionModes: partitionSummary.modes,
    accuracy: granularity === "root-units" ? "bitstream-root-units" : "bitstream-syntax-decoded",
    source: "native-js-bitstream-parser",
    colorScale: summarizeColorScale(colorScale),
    note: granularity === "root-units"
      ? "Root coding-unit geometry is exact; this result does not claim that entropy-coded child partitions were decoded."
      : "Block geometry comes from the selected frame bitstream. No decoded pixels are used to infer partitions.",
    warnings: parsedFrameInternals.warnings || [],
    roots,
    cells
  };
}

function getParsedRoots(parsedFrameInternals) {
  const candidates = [
    parsedFrameInternals.roots,
    parsedFrameInternals.macroblocks,
    parsedFrameInternals.ctus,
    parsedFrameInternals.superblocks,
    parsedFrameInternals.blocks
  ];
  return candidates.find((candidate) => Array.isArray(candidate) && candidate.length) || [];
}

function normalizeParsedBlock(block, context) {
  if (!block || typeof block !== "object") return null;
  const left = firstFiniteNumber(block.left, block.x, block.pixelLeft);
  const top = firstFiniteNumber(block.top, block.y, block.pixelTop);
  const width = firstPositiveNumber(block.visibleWidth, block.metadata && block.metadata.visibleWidth,
    block.width, block.blockWidth, block.codedBlockWidth,
    Number(block.right) - left, Number(block.pixelRight) - left);
  const height = firstPositiveNumber(block.visibleHeight, block.metadata && block.metadata.visibleHeight,
    block.height, block.blockHeight, block.codedBlockHeight,
    Number(block.bottom) - top, Number(block.pixelBottom) - top);
  if (!Number.isFinite(left) || !Number.isFinite(top) || !width || !height) return null;
  const id = String(block.id || context.fallbackId);
  const rawChildren = [block.children, block.partitions, block.blocks]
    .find((candidate) => Array.isArray(candidate)) || [];
  const children = rawChildren.map((child, index) => normalizeParsedBlock(child, {
    fallbackId: id + "-" + index,
    depth: context.depth + 1,
    rootIndex: context.rootIndex,
    parentId: id
  })).filter(Boolean);
  const ownBits = nullableNonNegative(block.ownBits, block.syntaxBits);
  const signaledSubtreeBits = nullableNonNegative(block.subtreeBits);
  const hasCompleteChildBits = children.every((child) => child.subtreeBits !== null);
  const childBits = sumNumbers(children.map((child) => child.subtreeBits));
  const subtreeBits = signaledSubtreeBits !== null
    ? signaledSubtreeBits
    : ownBits !== null && hasCompleteChildBits
      ? ownBits + childBits
      : null;
  const type = String(block.type || block.partitionType || block.partitionMode || block.mode || "block");
  const codedBlockWidth = firstPositiveNumber(block.codedBlockWidth, block.blockWidth, block.width, width);
  const codedBlockHeight = firstPositiveNumber(block.codedBlockHeight, block.blockHeight, block.height, height);
  const normalizedBlock = {
    ...block,
    id,
    parentId: context.parentId,
    rootIndex: context.rootIndex,
    index: context.rootIndex,
    depth: positiveIntegerOrZero(block.depth, context.depth),
    type,
    partitionMode: String(block.partitionMode || block.partitionType || block.mode || type),
    pixelLeft: left,
    pixelTop: top,
    pixelRight: left + width,
    pixelBottom: top + height,
    blockWidth: codedBlockWidth,
    blockHeight: codedBlockHeight,
    codedBlockWidth,
    codedBlockHeight,
    ownBits,
    syntaxBits: ownBits,
    subtreeBits,
    attributedBitsPerPixel: subtreeBits === null ? null : subtreeBits / Math.max(1, codedBlockWidth * codedBlockHeight),
    children
  };
  return normalizedBlock;
}

function flattenBlockTree(roots) {
  const flattened = [];
  const stack = roots.slice().reverse();
  while (stack.length) {
    const block = stack.pop();
    flattened.push(block);
    const children = Array.isArray(block.children) ? block.children : [];
    for (let index = children.length - 1; index >= 0; index -= 1) stack.push(children[index]);
  }
  return flattened;
}

function selectDisplayCells(roots, maximumCells) {
  let cells = roots.slice();
  if (cells.length > maximumCells) return [];
  let expanded = true;
  while (expanded) {
    expanded = false;
    const nextCells = [];
    let availableGrowth = maximumCells - cells.length;
    for (const cell of cells) {
      const children = Array.isArray(cell.children) ? cell.children : [];
      const growth = children.length - 1;
      if (growth > 0 && growth <= availableGrowth) {
        nextCells.push(...children);
        availableGrowth -= growth;
        expanded = true;
      } else {
        nextCells.push(cell);
      }
    }
    cells = nextCells;
  }
  for (const cell of cells) {
    const children = Array.isArray(cell.children) ? cell.children : [];
    const retainedDescendantCount = children.length ? flattenBlockTree(children).length : 0;
    cell.aggregatedDescendantCount = retainedDescendantCount +
      positiveIntegerOrZero(cell.omittedDescendantCount, 0);
  }
  return cells;
}

function summarizeParsedBlocks(blocks) {
  const depthCounts = new Map();
  const modeCounts = new Map();
  let maxDepth = 0;
  for (const block of blocks) {
    const depth = positiveIntegerOrZero(block.depth, 0);
    maxDepth = Math.max(maxDepth, depth);
    depthCounts.set(depth, (depthCounts.get(depth) || 0) + 1);
    modeCounts.set(block.partitionMode, (modeCounts.get(block.partitionMode) || 0) + 1);
  }
  return {
    maxDepth,
    depths: Array.from(depthCounts.entries()).sort((left, right) => left[0] - right[0])
      .map(([depth, count]) => ({ depth, count })),
    modes: Array.from(modeCounts.entries()).sort((left, right) => right[1] - left[1])
      .map(([mode, count]) => ({ mode, count }))
  };
}

function normalizeCountEntries(entries, keyName, fallbackEntries) {
  if (!Array.isArray(entries) || !entries.length) return fallbackEntries;
  const normalizedEntries = entries.map((entry) => ({
    [keyName]: entry && entry[keyName],
    count: positiveIntegerOrZero(entry && entry.count, 0)
  })).filter((entry) => entry[keyName] !== undefined && entry.count > 0);
  return normalizedEntries.length ? normalizedEntries : fallbackEntries;
}

function buildFrameInternalsColorScale(track, _sampleRows, options = {}) {
  if (!track || track.handlerType !== "vide") return buildValueDistribution([], "unavailable", 0);
  const cells = options.cells || options.fallbackCells || [];
  const values = cells.map(getCellHeatValue).filter((value) => value !== null);
  return buildValueDistribution(values, values.length ? "selected-frame-actual" : "unavailable", values.length ? 1 : 0);
}

function getVideoTrackDimensions(track) {
  const encodedWidth = positiveRoundedDimension(track.encodedWidth) || positiveRoundedDimension(track.width);
  const encodedHeight = positiveRoundedDimension(track.encodedHeight) || positiveRoundedDimension(track.height);
  const displayRotationDegrees = normalizeRotationDegrees(track.displayRotationDegrees);
  const pixelAspectRatio = getTrackPixelAspectRatio(track);
  return {
    encodedWidth,
    encodedHeight,
    displayRotationDegrees,
    pixelAspectRatioNumerator: pixelAspectRatio.numerator,
    pixelAspectRatioDenominator: pixelAspectRatio.denominator,
    pixelAspectRatio: pixelAspectRatio.value
  };
}

function getTrackPixelAspectRatio(track) {
  const numerator = positiveDimension(track && track.pixelAspectRatioNumerator) ||
    positiveDimension(track && track.pixelAspectRatio && track.pixelAspectRatio.numerator) ||
    positiveDimension(track && track.pixelAspectRatio && track.pixelAspectRatio.hSpacing) || 1;
  const denominator = positiveDimension(track && track.pixelAspectRatioDenominator) ||
    positiveDimension(track && track.pixelAspectRatio && track.pixelAspectRatio.denominator) ||
    positiveDimension(track && track.pixelAspectRatio && track.pixelAspectRatio.vSpacing) || 1;
  const value = numerator / denominator;
  return { numerator, denominator, value: Number.isFinite(value) && value > 0 ? value : 1 };
}

function getPartitionCellIntrinsicBounds(cells, fallbackWidth, fallbackHeight) {
  let maximumRight = Math.max(1, Number(fallbackWidth) || 1);
  let maximumBottom = Math.max(1, Number(fallbackHeight) || 1);
  for (const cell of cells || []) {
    maximumRight = Math.max(maximumRight, Number(cell.pixelRight) || 0);
    maximumBottom = Math.max(maximumBottom, Number(cell.pixelBottom) || 0);
  }
  return { width: maximumRight, height: maximumBottom };
}

function getDisplayDimensionsForIntrinsicBounds(intrinsicBounds, dimensions) {
  return {
    width: getOrientedDisplayWidth(intrinsicBounds.width, intrinsicBounds.height, dimensions.displayRotationDegrees, dimensions.pixelAspectRatio),
    height: getOrientedDisplayHeight(intrinsicBounds.width, intrinsicBounds.height, dimensions.displayRotationDegrees, dimensions.pixelAspectRatio)
  };
}

function orientVideoPartitionCells(cells, dimensions, intrinsicBounds) {
  for (const cell of cells) {
    const displayBounds = transformIntrinsicRectangleToDisplay(cell, dimensions, intrinsicBounds);
    cell.displayPixelLeft = displayBounds.left;
    cell.displayPixelTop = displayBounds.top;
    cell.displayPixelRight = displayBounds.right;
    cell.displayPixelBottom = displayBounds.bottom;
    cell.displayBlockWidth = displayBounds.right - displayBounds.left;
    cell.displayBlockHeight = displayBounds.bottom - displayBounds.top;
  }
}

function transformIntrinsicRectangleToDisplay(cell, dimensions, intrinsicBounds) {
  const intrinsicWidth = Math.max(1, intrinsicBounds.width);
  const intrinsicHeight = Math.max(1, intrinsicBounds.height);
  const displayDimensions = getDisplayDimensionsForIntrinsicBounds(intrinsicBounds, dimensions);
  const rotation = dimensions.displayRotationDegrees || 0;
  const pixelAspectRatio = getSafePixelAspectRatio(dimensions.pixelAspectRatio);
  const squarePixelWidth = intrinsicWidth * pixelAspectRatio;
  const squarePixelHeight = intrinsicHeight;
  const corners = [
    rotateIntrinsicPointToDisplay(cell.pixelLeft, cell.pixelTop, rotation, pixelAspectRatio, squarePixelWidth, squarePixelHeight),
    rotateIntrinsicPointToDisplay(cell.pixelRight, cell.pixelTop, rotation, pixelAspectRatio, squarePixelWidth, squarePixelHeight),
    rotateIntrinsicPointToDisplay(cell.pixelLeft, cell.pixelBottom, rotation, pixelAspectRatio, squarePixelWidth, squarePixelHeight),
    rotateIntrinsicPointToDisplay(cell.pixelRight, cell.pixelBottom, rotation, pixelAspectRatio, squarePixelWidth, squarePixelHeight)
  ];
  return {
    left: clamp(Math.min(...corners.map((point) => point.x)), 0, displayDimensions.width),
    top: clamp(Math.min(...corners.map((point) => point.y)), 0, displayDimensions.height),
    right: clamp(Math.max(...corners.map((point) => point.x)), 0, displayDimensions.width),
    bottom: clamp(Math.max(...corners.map((point) => point.y)), 0, displayDimensions.height)
  };
}

function rotateIntrinsicPointToDisplay(x, y, rotation, pixelAspectRatio, squarePixelWidth, squarePixelHeight) {
  const squarePixelX = x * pixelAspectRatio;
  // ISO BMFF/FFprobe rotation is counter-clockwise in Cartesian coordinates;
  // browser display coordinates have a downward-positive Y axis, so the screen-space branches are reversed.
  if (rotation === 90) return { x: y, y: squarePixelWidth - squarePixelX };
  if (rotation === -90) return { x: squarePixelHeight - y, y: squarePixelX };
  if (Math.abs(rotation) === 180) return { x: squarePixelWidth - squarePixelX, y: squarePixelHeight - y };
  return { x: squarePixelX, y };
}

function getOrientedDisplayWidth(width, height, rotationDegrees, pixelAspectRatio) {
  const squarePixelWidth = Math.max(0, Number(width) || 0) * getSafePixelAspectRatio(pixelAspectRatio);
  const squarePixelHeight = Math.max(0, Number(height) || 0);
  return Math.abs(rotationDegrees) === 90 ? squarePixelHeight : squarePixelWidth;
}

function getOrientedDisplayHeight(width, height, rotationDegrees, pixelAspectRatio) {
  const squarePixelWidth = Math.max(0, Number(width) || 0) * getSafePixelAspectRatio(pixelAspectRatio);
  const squarePixelHeight = Math.max(0, Number(height) || 0);
  return Math.abs(rotationDegrees) === 90 ? squarePixelWidth : squarePixelHeight;
}

function applyVideoColorScale(cells, colorScale) {
  const values = colorScale.values || [];
  for (const cell of cells) {
    const heatValue = getCellHeatValue(cell);
    const percentile = heatValue === null ? 0.5 : getPercentileRank(values, heatValue);
    cell.globalPercentile = percentile;
    cell.intensity = heatValue === null ? 0.45 : 0.72 + getNonlinearHeatPercentile(percentile) * 0.28;
    cell.color = heatValue === null ? { red: 148, green: 163, blue: 184 } : getPercentileHeatColor(percentile);
  }
}

function getCellHeatValue(cell) {
  const bits = nullableNonNegative(cell && cell.subtreeBits, cell && cell.syntaxBits);
  if (bits === null) return null;
  return bits / Math.max(1, Number(cell.blockWidth) * Number(cell.blockHeight) || 1);
}

function buildValueDistribution(values, mode, sampleCount) {
  const sortedValues = values.map(Number).filter((value) => Number.isFinite(value) && value >= 0).sort((left, right) => left - right);
  if (!sortedValues.length) sortedValues.push(0);
  return {
    mode,
    values: sortedValues,
    valueCount: mode === "unavailable" ? 0 : sortedValues.length,
    sampleCount,
    min: sortedValues[0],
    max: sortedValues[sortedValues.length - 1],
    p50: getQuantile(sortedValues, 0.5),
    p90: getQuantile(sortedValues, 0.9),
    p99: getQuantile(sortedValues, 0.99)
  };
}

function summarizeColorScale(colorScale) {
  const { values: _values, ...summary } = colorScale;
  return summary;
}

function getQuantile(sortedValues, percentile) {
  const position = clamp(percentile, 0, 1) * (sortedValues.length - 1);
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  if (lowerIndex === upperIndex) return sortedValues[lowerIndex];
  const ratio = position - lowerIndex;
  return sortedValues[lowerIndex] * (1 - ratio) + sortedValues[upperIndex] * ratio;
}

function getPercentileRank(sortedValues, value) {
  if (sortedValues.length <= 1 || sortedValues.at(-1) <= sortedValues[0]) return 0.5;
  let low = 0;
  let high = sortedValues.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (sortedValues[middle] <= value) low = middle + 1;
    else high = middle;
  }
  return clamp((low - 1) / (sortedValues.length - 1), 0, 1);
}

function getPercentileHeatColor(percentile) {
  const mappedPercentile = getNonlinearHeatPercentile(percentile);
  let lowerStop = HEAT_COLOR_STOPS[0];
  let upperStop = HEAT_COLOR_STOPS.at(-1);
  for (let index = 1; index < HEAT_COLOR_STOPS.length; index += 1) {
    if (mappedPercentile <= HEAT_COLOR_STOPS[index].percentile) {
      lowerStop = HEAT_COLOR_STOPS[index - 1];
      upperStop = HEAT_COLOR_STOPS[index];
      break;
    }
  }
  const ratio = clamp((mappedPercentile - lowerStop.percentile) / Math.max(0.000001, upperStop.percentile - lowerStop.percentile), 0, 1);
  return {
    red: Math.round(lowerStop.red + (upperStop.red - lowerStop.red) * ratio),
    green: Math.round(lowerStop.green + (upperStop.green - lowerStop.green) * ratio),
    blue: Math.round(lowerStop.blue + (upperStop.blue - lowerStop.blue) * ratio)
  };
}

function getNonlinearHeatPercentile(percentile) {
  const value = clamp(percentile, 0, 1);
  if (value < 0.5) return 0.38 * Math.pow(value / 0.5, 0.9);
  if (value < 0.9) return 0.38 + 0.42 * Math.pow((value - 0.5) / 0.4, 0.72);
  return 0.8 + 0.2 * Math.pow((value - 0.9) / 0.1, 0.45);
}

function firstFiniteNumber(...values) {
  for (const value of values) {
    const numberValue = Number(value);
    if (Number.isFinite(numberValue)) return numberValue;
  }
  return Number.NaN;
}

function firstPositiveNumber(...values) {
  for (const value of values) {
    const numberValue = Number(value);
    if (Number.isFinite(numberValue) && numberValue > 0) return numberValue;
  }
  return 0;
}

function nullableNonNegative(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const numberValue = Number(value);
    if (Number.isFinite(numberValue) && numberValue >= 0) return numberValue;
  }
  return null;
}

function finiteNonNegative(value, fallback) {
  if (value !== null && value !== undefined && value !== "") {
    const numberValue = Number(value);
    if (Number.isFinite(numberValue) && numberValue >= 0) return numberValue;
  }
  const fallbackValue = Number(fallback);
  return Number.isFinite(fallbackValue) && fallbackValue >= 0 ? fallbackValue : 0;
}

function positiveDimension(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : 0;
}

function positiveRoundedDimension(value) {
  return Math.round(positiveDimension(value));
}

function positiveInteger(value) {
  const numberValue = Math.round(Number(value));
  return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : 0;
}

function positiveIntegerOrZero(value, fallback) {
  const numberValue = Math.round(Number(value));
  return Number.isFinite(numberValue) && numberValue >= 0 ? numberValue : fallback;
}

function normalizeRotationDegrees(value) {
  let normalized = (Number(value) || 0) % 360;
  if (normalized > 180) normalized -= 360;
  if (normalized <= -180) normalized += 360;
  return Object.is(normalized, -0) ? 0 : normalized;
}

function getSafePixelAspectRatio(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : 1;
}

function sumNumbers(values) {
  return values.reduce((total, value) => total + (Number(value) || 0), 0);
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

export {
  MAX_VIDEO_DISPLAY_CELLS,
  VIDEO_CODING_UNITS,
  buildFrameInternalsColorScale,
  buildFrameInternalsModel,
  flattenBlockTree,
  normalizeParsedBlock,
  selectDisplayCells
};
