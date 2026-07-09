const MAX_VIDEO_DISPLAY_CELLS = 9000;
const MAX_GLOBAL_DISTRIBUTION_VALUES = 120000;

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
    matches: (track) => track.codecDescriptor === "avc" || ["avc1", "avc2", "avc3", "avc4"].includes(track.codec),
    codecFamily: "AVC / H.264",
    unitName: "macroblock",
    unitWidth: 16,
    unitHeight: 16,
    accuracy: "nominal-exact-grid",
    note: "AVC uses a 16x16 macroblock raster. This view can show estimated rectangular macroblock partitions, but exact mb_type/sub_mb_type and transform block structure require slice-data syntax decoding.",
    partitionProfile: {
      baseWidth: 16,
      baseHeight: 16,
      minimumWidth: 4,
      minimumHeight: 4,
      maxDepth: 2,
      modes: ["split", "vertical", "horizontal"]
    }
  },
  {
    matches: (track) => track.codecDescriptor === "hevc" || ["hvc1", "hev1"].includes(track.codec),
    codecFamily: "HEVC / H.265",
    unitName: "CTU",
    unitWidth: 64,
    unitHeight: 64,
    accuracy: "nominal-grid",
    note: "HEVC CTU size is signaled in SPS. This view shows an estimated CTU/CU rectangular partition map using the common 64x64 CTU base until SPS/CABAC partition parsing is added.",
    partitionProfile: {
      baseWidth: 64,
      baseHeight: 64,
      minimumWidth: 8,
      minimumHeight: 8,
      maxDepth: 4,
      modes: ["split", "vertical", "horizontal"]
    }
  },
  {
    matches: (track) => track.codec === "V_VP9" || track.codecDescriptor === "V_VP9" || String(track.codec).toLowerCase() === "vp9",
    codecFamily: "VP9",
    unitName: "superblock",
    unitWidth: 64,
    unitHeight: 64,
    accuracy: "nominal-grid",
    note: "VP9 superblock partition data is entropy coded in frame payloads. This view shows an estimated rectangular superblock partition map until frame-payload partition parsing is added.",
    partitionProfile: {
      baseWidth: 64,
      baseHeight: 64,
      minimumWidth: 4,
      minimumHeight: 4,
      maxDepth: 4,
      modes: ["split", "vertical", "horizontal", "verticalA", "verticalB", "horizontalA", "horizontalB"]
    }
  },
  {
    matches: (track) => track.codec === "av01" || track.codecDescriptor === "av1",
    codecFamily: "AV1",
    unitName: "superblock",
    unitWidth: 128,
    unitHeight: 128,
    accuracy: "future-nominal-grid",
    note: "AV1 can use 64x64 or 128x128 superblocks and many non-square partition modes. This view uses a partition-ready rectangular block model that supports AV1-style non-square splits until sequence/frame syntax parsing is added.",
    partitionProfile: {
      baseWidth: 128,
      baseHeight: 128,
      minimumWidth: 4,
      minimumHeight: 4,
      maxDepth: 5,
      modes: [
        "split",
        "vertical",
        "horizontal",
        "vertical4",
        "horizontal4",
        "verticalA",
        "verticalB",
        "horizontalA",
        "horizontalB"
      ]
    }
  }
];

const AUDIO_BANDS = [
  { label: "Sub", range: "20-60 Hz", startHz: 20, endHz: 60 },
  { label: "Bass", range: "60-250 Hz", startHz: 60, endHz: 250 },
  { label: "Low mid", range: "250-500 Hz", startHz: 250, endHz: 500 },
  { label: "Mid", range: "500 Hz-2 kHz", startHz: 500, endHz: 2000 },
  { label: "High mid", range: "2-4 kHz", startHz: 2000, endHz: 4000 },
  { label: "Presence", range: "4-6 kHz", startHz: 4000, endHz: 6000 },
  { label: "Brilliance", range: "6-12 kHz", startHz: 6000, endHz: 12000 },
  { label: "Air", range: "12-20 kHz", startHz: 12000, endHz: 20000 }
];

function buildFrameInternalsModel(row, track, options = {}) {
  if (!row || !track) {
    return {
      kind: "empty",
      title: "No frame selected",
      note: "Select a frame row to inspect its nominal internal structure."
    };
  }
  if (track.handlerType === "vide") return buildVideoInternalsModel(row, track, options);
  if (track.handlerType === "soun") return buildAudioInternalsModel(row, track);
  return {
    kind: "unsupported",
    title: "Internal structure unavailable",
    note: "This track type does not expose a supported nominal frame structure."
  };
}

function buildVideoInternalsModel(row, track, options = {}) {
  const descriptor = VIDEO_CODING_UNITS.find((candidate) => candidate.matches(track));
  const dimensions = getVideoTrackDimensions(track);
  const width = dimensions.encodedWidth;
  const height = dimensions.encodedHeight;
  if (!descriptor || !width || !height) {
    return {
      kind: "unsupported",
      title: "Video block view unavailable",
      note: "This video codec or track size is not mapped to a nominal coding-unit grid yet.",
      codec: track.codec
    };
  }

  const nominalColumns = Math.max(1, Math.ceil(width / descriptor.unitWidth));
  const nominalRows = Math.max(1, Math.ceil(height / descriptor.unitHeight));
  const cells = buildVideoPartitionCells({
    row,
    descriptor,
    width,
    height,
    maxCells: MAX_VIDEO_DISPLAY_CELLS
  });
  const intrinsicBounds = getPartitionCellIntrinsicBounds(cells, width, height);
  const displayDimensions = getDisplayDimensionsForIntrinsicBounds(intrinsicBounds, dimensions);
  orientVideoPartitionCells(cells, dimensions, intrinsicBounds);
  const partitionSummary = summarizePartitionCells(cells);
  const colorScale = options.colorScale || buildFrameInternalsColorScale(track, options.sampleRows, {
    descriptor,
    width,
    height,
    fallbackCells: cells
  });
  applyVideoColorScale(cells, colorScale);

  return {
    kind: "video-grid",
    title: descriptor.codecFamily + " " + descriptor.unitName + " grid",
    codecFamily: descriptor.codecFamily,
    codec: track.codec,
    frameType: row.frameType || "unknown",
    sampleSize: Number(row.size) || 0,
    unitName: descriptor.unitName,
    unitWidth: descriptor.unitWidth,
    unitHeight: descriptor.unitHeight,
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
    nominalUnitCount: nominalColumns * nominalRows,
    displayColumns: partitionSummary.rootColumns,
    displayRows: partitionSummary.rootRows,
    displayCellCount: cells.length,
    aggregation: partitionSummary.aggregation,
    partitionBlockCount: cells.length,
    maxPartitionDepth: partitionSummary.maxDepth,
    partitionModes: partitionSummary.modes,
    accuracy: descriptor.accuracy,
    colorScale: summarizeColorScale(colorScale),
    note: descriptor.note,
    cells
  };
}

function buildFrameInternalsColorScale(track, sampleRows, options = {}) {
  if (!track || track.handlerType !== "vide") return buildValueDistribution([], "unavailable", 0);
  const descriptor = options.descriptor || VIDEO_CODING_UNITS.find((candidate) => candidate.matches(track));
  const dimensions = getVideoTrackDimensions(track);
  const width = options.width || dimensions.encodedWidth;
  const height = options.height || dimensions.encodedHeight;
  if (!descriptor || !width || !height) return buildValueDistribution([], "unavailable", 0);

  const rows = getVideoScaleRows(track, sampleRows);

  if (!rows.length) {
    const fallbackValues = (options.fallbackCells || [])
      .map((cell) => getCellHeatValue(cell))
      .filter((value) => value >= 0);
    return buildValueDistribution(fallbackValues, "selected-frame-percentile", fallbackValues.length ? 1 : 0);
  }

  const scaleOptions = {
    descriptor,
    width,
    height
  };
  const estimatedCellCount = estimateVideoPartitionCellCount(scaleOptions);
  const rowStride = Math.max(1, Math.ceil((rows.length * estimatedCellCount) / MAX_GLOBAL_DISTRIBUTION_VALUES));
  const sampledValues = [];
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += rowStride) {
    const sampleRow = rows[rowIndex];
    const sampleSize = Math.max(0, Number(sampleRow.size) || 0);
    if (!sampleSize) continue;
    const cells = buildVideoPartitionCells({
      row: sampleRow,
      descriptor,
      width,
      height,
      maxCells: MAX_VIDEO_DISPLAY_CELLS
    });
    const cellStride = Math.max(1, Math.ceil(cells.length / Math.max(1, Math.floor(MAX_GLOBAL_DISTRIBUTION_VALUES / Math.ceil(rows.length / rowStride)))));
    for (let cellIndex = 0; cellIndex < cells.length; cellIndex += cellStride) {
      sampledValues.push(getCellHeatValue(cells[cellIndex]));
    }
  }
  return buildValueDistribution(sampledValues, "global-track-percentile", rows.length);
}

function getVideoTrackDimensions(track) {
  const encodedWidth = positiveRoundedDimension(track.encodedWidth) || positiveRoundedDimension(track.width);
  const encodedHeight = positiveRoundedDimension(track.encodedHeight) || positiveRoundedDimension(track.height);
  const displayRotationDegrees = normalizeRotationDegrees(track.displayRotationDegrees);
  const pixelAspectRatio = getTrackPixelAspectRatio(track);
  return {
    encodedWidth,
    encodedHeight,
    displayWidth: getOrientedDisplayWidth(encodedWidth, encodedHeight, displayRotationDegrees, pixelAspectRatio.value),
    displayHeight: getOrientedDisplayHeight(encodedWidth, encodedHeight, displayRotationDegrees, pixelAspectRatio.value),
    displayRotationDegrees,
    pixelAspectRatioNumerator: pixelAspectRatio.numerator,
    pixelAspectRatioDenominator: pixelAspectRatio.denominator,
    pixelAspectRatio: pixelAspectRatio.value
  };
}

function getTrackPixelAspectRatio(track) {
  const numerator = positiveDimension(track && track.pixelAspectRatioNumerator) ||
    positiveDimension(track && track.pixelAspectRatio && track.pixelAspectRatio.numerator) ||
    positiveDimension(track && track.pixelAspectRatio && track.pixelAspectRatio.hSpacing) ||
    1;
  const denominator = positiveDimension(track && track.pixelAspectRatioDenominator) ||
    positiveDimension(track && track.pixelAspectRatio && track.pixelAspectRatio.denominator) ||
    positiveDimension(track && track.pixelAspectRatio && track.pixelAspectRatio.vSpacing) ||
    1;
  const value = numerator > 0 && denominator > 0 ? numerator / denominator : 1;
  return {
    numerator,
    denominator,
    value: Number.isFinite(value) && value > 0 ? value : 1
  };
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

function getSafePixelAspectRatio(pixelAspectRatio) {
  const value = Number(pixelAspectRatio);
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function positiveRoundedDimension(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue > 0 ? Math.round(numberValue) : 0;
}

function positiveDimension(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : 0;
}

function normalizeRotationDegrees(value) {
  const numberValue = Number(value) || 0;
  let normalized = numberValue % 360;
  if (normalized > 180) normalized -= 360;
  if (normalized <= -180) normalized += 360;
  return Object.is(normalized, -0) ? 0 : normalized;
}

function getVideoScaleRows(track, sampleRows) {
  if (!Array.isArray(sampleRows)) return [];
  return sampleRows.filter((row) =>
    row &&
    String(row.trackId) === String(track.trackId) &&
    Math.max(0, Number(row.size) || 0) > 0
  );
}

function buildVideoPartitionCells(options) {
  const profile = options.descriptor.partitionProfile || getDefaultPartitionProfile(options.descriptor);
  const rootLayout = getPartitionRootLayout(options, profile);
  let cells = buildRootPartitionCells(options, profile, rootLayout);
  const expansionDepth = getTrackPartitionExpansionDepth(cells.length, profile, options.maxCells);
  cells = refinePartitionCells(cells, options, profile, expansionDepth);
  return assignPartitionByteEstimates(cells, options);
}

function getDefaultPartitionProfile(descriptor) {
  return {
    baseWidth: descriptor.unitWidth,
    baseHeight: descriptor.unitHeight,
    minimumWidth: descriptor.unitWidth,
    minimumHeight: descriptor.unitHeight,
    maxDepth: 0,
    modes: []
  };
}

function getPartitionRootLayout(options, profile) {
  const baseWidth = Math.max(1, profile.baseWidth || options.descriptor.unitWidth);
  const baseHeight = Math.max(1, profile.baseHeight || options.descriptor.unitHeight);
  const rawColumns = Math.max(1, Math.ceil(options.width / baseWidth));
  const rawRows = Math.max(1, Math.ceil(options.height / baseHeight));
  const rootCount = rawColumns * rawRows;
  const maxCells = Math.max(1, options.maxCells || MAX_VIDEO_DISPLAY_CELLS);
  const splitReserve = getFullDepthSplitReserve(profile);
  const aggregation = Math.max(1, Math.ceil(Math.sqrt(rootCount * splitReserve / maxCells)));
  const rootWidth = baseWidth * aggregation;
  const rootHeight = baseHeight * aggregation;
  return {
    baseWidth,
    baseHeight,
    rawColumns,
    rawRows,
    aggregation,
    columns: Math.max(1, Math.ceil(options.width / rootWidth)),
    rows: Math.max(1, Math.ceil(options.height / rootHeight)),
    rootWidth,
    rootHeight
  };
}

function getFullDepthSplitReserve(profile) {
  if (!profile.maxDepth || !Array.isArray(profile.modes) || !profile.modes.length) return 1;
  return Math.max(2, ...profile.modes.map(getPartitionModeMaximumFanOut));
}

function getPartitionModeMaximumFanOut(mode) {
  if (mode === "verticalA" || mode === "verticalB" || mode === "horizontalA" || mode === "horizontalB") return 3;
  if (mode === "split" || mode === "vertical4" || mode === "horizontal4") return 4;
  if (mode === "vertical" || mode === "horizontal") return 2;
  return 1;
}

function buildRootPartitionCells(options, profile, layout) {
  const cells = [];
  for (let rowIndex = 0; rowIndex < layout.rows; rowIndex += 1) {
    for (let columnIndex = 0; columnIndex < layout.columns; columnIndex += 1) {
      const pixelLeft = columnIndex * layout.rootWidth;
      const pixelTop = rowIndex * layout.rootHeight;
      const pixelRight = pixelLeft + layout.rootWidth;
      const pixelBottom = pixelTop + layout.rootHeight;
      cells.push(createPartitionCell({
        descriptor: options.descriptor,
        profile,
        layout,
        rowIndex,
        columnIndex,
        pixelLeft,
        pixelTop,
        pixelRight,
        pixelBottom,
        depth: 0,
        partitionMode: layout.aggregation > 1 ? "aggregated-root" : "root"
      }));
    }
  }
  return cells;
}

function refinePartitionCells(cells, options, profile, expansionDepth) {
  if (!profile.maxDepth || !profile.modes.length) return cells;
  const depthLimit = Math.min(profile.maxDepth, Math.max(0, Number(expansionDepth) || 0));
  for (let depth = 0; depth < depthLimit; depth += 1) {
    const currentDepthCells = cells.filter((cell) => cell.depth === depth);
    if (currentDepthCells.length !== cells.length) break;
    if (currentDepthCells.some((cell) => !canSplitPartitionCell(cell, profile))) break;
    const replacementMap = new Map();
    for (const cell of currentDepthCells) {
      const mode = choosePartitionMode(cell, options.row, profile);
      const children = splitPartitionCell(cell, mode, profile, options);
      if (children.length <= 1) continue;
      replacementMap.set(cell.id, children);
    }
    if (replacementMap.size !== currentDepthCells.length) break;
    cells = cells.flatMap((cell) => replacementMap.get(cell.id) || [cell]);
  }
  return cells;
}

function canSplitPartitionCell(cell, profile) {
  return (cell.pixelRight - cell.pixelLeft) >= profile.minimumWidth * 2 ||
    (cell.pixelBottom - cell.pixelTop) >= profile.minimumHeight * 2;
}

function choosePartitionMode(cell, row, profile) {
  const availableModes = profile.modes.filter((mode) => splitPartitionCell(cell, mode, profile, null).length > 1);
  if (!availableModes.length) return "none";
  const noise = deterministicNoise(row, cell.rowIndex + 11, cell.columnIndex + 17 + cell.depth);
  const area = Math.max(1, (cell.pixelRight - cell.pixelLeft) * (cell.pixelBottom - cell.pixelTop));
  const rectangularBias = Math.abs(cell.pixelRight - cell.pixelLeft - (cell.pixelBottom - cell.pixelTop)) / Math.sqrt(area);
  const modeIndex = Math.min(availableModes.length - 1, Math.floor((noise + rectangularBias * 0.071) * availableModes.length) % availableModes.length);
  return availableModes[modeIndex];
}

function splitPartitionCell(cell, mode, profile, options) {
  const width = cell.pixelRight - cell.pixelLeft;
  const height = cell.pixelBottom - cell.pixelTop;
  if (mode === "none" || width <= 0 || height <= 0) return [cell];
  const verticalHalf = Math.floor(width / 2);
  const horizontalHalf = Math.floor(height / 2);
  if (mode === "vertical" && width >= profile.minimumWidth * 2) {
    return createSplitChildren(cell, mode, [
      [cell.pixelLeft, cell.pixelTop, cell.pixelLeft + verticalHalf, cell.pixelBottom],
      [cell.pixelLeft + verticalHalf, cell.pixelTop, cell.pixelRight, cell.pixelBottom]
    ], profile, options);
  }
  if (mode === "horizontal" && height >= profile.minimumHeight * 2) {
    return createSplitChildren(cell, mode, [
      [cell.pixelLeft, cell.pixelTop, cell.pixelRight, cell.pixelTop + horizontalHalf],
      [cell.pixelLeft, cell.pixelTop + horizontalHalf, cell.pixelRight, cell.pixelBottom]
    ], profile, options);
  }
  if (mode === "split" && width >= profile.minimumWidth * 2 && height >= profile.minimumHeight * 2) {
    return createSplitChildren(cell, mode, [
      [cell.pixelLeft, cell.pixelTop, cell.pixelLeft + verticalHalf, cell.pixelTop + horizontalHalf],
      [cell.pixelLeft + verticalHalf, cell.pixelTop, cell.pixelRight, cell.pixelTop + horizontalHalf],
      [cell.pixelLeft, cell.pixelTop + horizontalHalf, cell.pixelLeft + verticalHalf, cell.pixelBottom],
      [cell.pixelLeft + verticalHalf, cell.pixelTop + horizontalHalf, cell.pixelRight, cell.pixelBottom]
    ], profile, options);
  }
  if (mode === "vertical4" && width >= profile.minimumWidth * 4) return splitIntoBands(cell, mode, 4, "vertical", profile, options);
  if (mode === "horizontal4" && height >= profile.minimumHeight * 4) return splitIntoBands(cell, mode, 4, "horizontal", profile, options);
  if (mode === "verticalA" && width >= profile.minimumWidth * 2 && height >= profile.minimumHeight * 2) {
    return createSplitChildren(cell, mode, [
      [cell.pixelLeft, cell.pixelTop, cell.pixelLeft + verticalHalf, cell.pixelBottom],
      [cell.pixelLeft + verticalHalf, cell.pixelTop, cell.pixelRight, cell.pixelTop + horizontalHalf],
      [cell.pixelLeft + verticalHalf, cell.pixelTop + horizontalHalf, cell.pixelRight, cell.pixelBottom]
    ], profile, options);
  }
  if (mode === "verticalB" && width >= profile.minimumWidth * 2 && height >= profile.minimumHeight * 2) {
    return createSplitChildren(cell, mode, [
      [cell.pixelLeft, cell.pixelTop, cell.pixelLeft + verticalHalf, cell.pixelTop + horizontalHalf],
      [cell.pixelLeft, cell.pixelTop + horizontalHalf, cell.pixelLeft + verticalHalf, cell.pixelBottom],
      [cell.pixelLeft + verticalHalf, cell.pixelTop, cell.pixelRight, cell.pixelBottom]
    ], profile, options);
  }
  if (mode === "horizontalA" && width >= profile.minimumWidth * 2 && height >= profile.minimumHeight * 2) {
    return createSplitChildren(cell, mode, [
      [cell.pixelLeft, cell.pixelTop, cell.pixelRight, cell.pixelTop + horizontalHalf],
      [cell.pixelLeft, cell.pixelTop + horizontalHalf, cell.pixelLeft + verticalHalf, cell.pixelBottom],
      [cell.pixelLeft + verticalHalf, cell.pixelTop + horizontalHalf, cell.pixelRight, cell.pixelBottom]
    ], profile, options);
  }
  if (mode === "horizontalB" && width >= profile.minimumWidth * 2 && height >= profile.minimumHeight * 2) {
    return createSplitChildren(cell, mode, [
      [cell.pixelLeft, cell.pixelTop, cell.pixelLeft + verticalHalf, cell.pixelTop + horizontalHalf],
      [cell.pixelLeft + verticalHalf, cell.pixelTop, cell.pixelRight, cell.pixelTop + horizontalHalf],
      [cell.pixelLeft, cell.pixelTop + horizontalHalf, cell.pixelRight, cell.pixelBottom]
    ], profile, options);
  }
  return [cell];
}

function splitIntoBands(cell, mode, count, direction, profile, options) {
  const rectangles = [];
  if (direction === "vertical") {
    const width = cell.pixelRight - cell.pixelLeft;
    for (let index = 0; index < count; index += 1) {
      rectangles.push([
        cell.pixelLeft + Math.floor(width * index / count),
        cell.pixelTop,
        cell.pixelLeft + Math.floor(width * (index + 1) / count),
        cell.pixelBottom
      ]);
    }
  } else {
    const height = cell.pixelBottom - cell.pixelTop;
    for (let index = 0; index < count; index += 1) {
      rectangles.push([
        cell.pixelLeft,
        cell.pixelTop + Math.floor(height * index / count),
        cell.pixelRight,
        cell.pixelTop + Math.floor(height * (index + 1) / count)
      ]);
    }
  }
  return createSplitChildren(cell, mode, rectangles, profile, options);
}

function createSplitChildren(parent, mode, rectangles, profile, options) {
  const descriptor = options && options.descriptor ? options.descriptor : null;
  return rectangles
    .filter(([left, top, right, bottom]) => right > left && bottom > top)
    .map(([left, top, right, bottom], childIndex) => createPartitionCell({
      descriptor: descriptor || parent.descriptor,
      profile,
      layout: parent.layout,
      rowIndex: parent.rowIndex,
      columnIndex: parent.columnIndex,
      pixelLeft: left,
      pixelTop: top,
      pixelRight: right,
      pixelBottom: bottom,
      depth: parent.depth + 1,
      partitionMode: mode,
      parentId: parent.id,
      childIndex
    }));
}

function createPartitionCell(options) {
  const descriptor = options.descriptor;
  const unitWidth = descriptor ? descriptor.unitWidth : Math.max(1, options.profile.minimumWidth);
  const unitHeight = descriptor ? descriptor.unitHeight : Math.max(1, options.profile.minimumHeight);
  const width = Math.max(0, options.pixelRight - options.pixelLeft);
  const height = Math.max(0, options.pixelBottom - options.pixelTop);
  const nominalUnits = Math.max(1, Math.round((width * height) / Math.max(1, unitWidth * unitHeight)));
  return {
    id: [
      options.rowIndex,
      options.columnIndex,
      options.depth || 0,
      Math.round(options.pixelLeft),
      Math.round(options.pixelTop),
      options.childIndex || 0
    ].join(":"),
    descriptor,
    layout: options.layout,
    rowIndex: options.rowIndex,
    columnIndex: options.columnIndex,
    unitColumnStart: Math.floor(options.pixelLeft / unitWidth),
    unitColumnEnd: Math.max(1, Math.ceil(options.pixelRight / unitWidth)),
    unitRowStart: Math.floor(options.pixelTop / unitHeight),
    unitRowEnd: Math.max(1, Math.ceil(options.pixelBottom / unitHeight)),
    nominalUnits,
    pixelLeft: Math.round(options.pixelLeft),
    pixelTop: Math.round(options.pixelTop),
    pixelRight: Math.round(options.pixelRight),
    pixelBottom: Math.round(options.pixelBottom),
    blockWidth: Math.round(width),
    blockHeight: Math.round(height),
    depth: options.depth || 0,
    partitionMode: options.partitionMode,
    parentId: options.parentId || "",
    childIndex: options.childIndex || 0
  };
}

function getTrackPartitionExpansionDepth(rootCellCount, profile, maxCells) {
  if (!profile.maxDepth || !Array.isArray(profile.modes) || !profile.modes.length) return 0;
  const maximumFanOut = getFullDepthSplitReserve(profile);
  const cellLimit = Math.max(1, maxCells || MAX_VIDEO_DISPLAY_CELLS);
  let expansionDepth = 0;
  let worstCaseCellCount = Math.max(1, rootCellCount);
  while (expansionDepth < profile.maxDepth && worstCaseCellCount * maximumFanOut <= cellLimit) {
    worstCaseCellCount *= maximumFanOut;
    expansionDepth += 1;
  }
  return expansionDepth;
}

function estimateVideoPartitionCellCount(options) {
  const profile = options.descriptor.partitionProfile || getDefaultPartitionProfile(options.descriptor);
  const rootLayout = getPartitionRootLayout({ ...options, maxCells: MAX_VIDEO_DISPLAY_CELLS }, profile);
  let cellCount = rootLayout.columns * rootLayout.rows;
  const maximumFanOut = getFullDepthSplitReserve(profile);
  const expansionDepth = getTrackPartitionExpansionDepth(cellCount, profile, MAX_VIDEO_DISPLAY_CELLS);
  for (let depth = 0; depth < expansionDepth; depth += 1) {
    cellCount *= maximumFanOut;
  }
  return Math.max(1, Math.min(MAX_VIDEO_DISPLAY_CELLS, cellCount));
}

function assignPartitionByteEstimates(cells, options) {
  let totalWeight = 0;
  const intrinsicBounds = getPartitionCellIntrinsicBounds(cells, options.width, options.height);
  const intrinsicWidth = Math.max(1, intrinsicBounds.width);
  const intrinsicHeight = Math.max(1, intrinsicBounds.height);
  for (const cell of cells) {
    const centerColumn = clamp((cell.pixelLeft + cell.pixelRight) / 2 / intrinsicWidth, 0, 1);
    const centerRow = clamp((cell.pixelTop + cell.pixelBottom) / 2 / intrinsicHeight, 0, 1);
    const area = Math.max(1, cell.blockWidth * cell.blockHeight);
    const areaWeight = Math.sqrt(area / Math.max(1, options.descriptor.unitWidth * options.descriptor.unitHeight));
    const depthWeight = 1 + cell.depth * 0.17;
    const modeWeight = getPartitionModeWeight(cell.partitionMode);
    cell.weight = areaWeight * depthWeight * modeWeight * getSyntheticSpatialWeightAt(options.row, centerColumn, centerRow);
    totalWeight += cell.weight;
  }
  const sampleSize = Math.max(0, Number(options.row.size) || 0);
  const frameArea = Math.max(1, sumPartitionCellAreas(cells));
  const frameAverageBytesPerPixel = sampleSize / frameArea;
  for (const cell of cells) {
    const byteEstimate = totalWeight > 0 ? sampleSize * cell.weight / totalWeight : 0;
    const cellArea = Math.max(1, cell.blockWidth * cell.blockHeight);
    const estimatedBytesPerPixel = byteEstimate / cellArea;
    cell.estimatedBytes = byteEstimate;
    cell.estimatedBytesPerPixel = estimatedBytesPerPixel;
    cell.normalizedByteDensity = frameAverageBytesPerPixel > 0 ? estimatedBytesPerPixel / frameAverageBytesPerPixel : 0;
    cell.localRatio = sampleSize > 0 ? byteEstimate * cells.length / sampleSize : 0;
    delete cell.weight;
  }
  return cells;
}

function sumPartitionCellAreas(cells) {
  return cells.reduce((total, cell) => total + Math.max(1, cell.blockWidth * cell.blockHeight), 0);
}

function getPartitionCellIntrinsicBounds(cells, fallbackWidth, fallbackHeight) {
  let maximumRight = Math.max(1, Number(fallbackWidth) || 1);
  let maximumBottom = Math.max(1, Number(fallbackHeight) || 1);
  for (const cell of cells || []) {
    maximumRight = Math.max(maximumRight, Number(cell.pixelRight) || 0);
    maximumBottom = Math.max(maximumBottom, Number(cell.pixelBottom) || 0);
  }
  return {
    width: maximumRight,
    height: maximumBottom
  };
}

function getDisplayDimensionsForIntrinsicBounds(intrinsicBounds, dimensions) {
  return {
    width: getOrientedDisplayWidth(
      intrinsicBounds.width,
      intrinsicBounds.height,
      dimensions.displayRotationDegrees,
      dimensions.pixelAspectRatio
    ),
    height: getOrientedDisplayHeight(
      intrinsicBounds.width,
      intrinsicBounds.height,
      dimensions.displayRotationDegrees,
      dimensions.pixelAspectRatio
    )
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
  return cells;
}

function transformIntrinsicRectangleToDisplay(cell, dimensions, intrinsicBounds) {
  const intrinsicWidth = Math.max(1, intrinsicBounds.width);
  const intrinsicHeight = Math.max(1, intrinsicBounds.height);
  const displayDimensions = getDisplayDimensionsForIntrinsicBounds(intrinsicBounds, dimensions);
  const displayWidth = Math.max(1, displayDimensions.width);
  const displayHeight = Math.max(1, displayDimensions.height);
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
  const left = Math.min(...corners.map((point) => point.x));
  const top = Math.min(...corners.map((point) => point.y));
  const right = Math.max(...corners.map((point) => point.x));
  const bottom = Math.max(...corners.map((point) => point.y));
  return {
    left: clampDisplayCoordinate(left, displayWidth),
    top: clampDisplayCoordinate(top, displayHeight),
    right: clampDisplayCoordinate(right, displayWidth),
    bottom: clampDisplayCoordinate(bottom, displayHeight)
  };
}

function rotateIntrinsicPointToDisplay(x, y, rotation, pixelAspectRatio, squarePixelWidth, squarePixelHeight) {
  const squarePixelX = x * pixelAspectRatio;
  const squarePixelY = y;
  if (rotation === 90) return { x: squarePixelHeight - squarePixelY, y: squarePixelX };
  if (rotation === -90) return { x: squarePixelY, y: squarePixelWidth - squarePixelX };
  if (Math.abs(rotation) === 180) return { x: squarePixelWidth - squarePixelX, y: squarePixelHeight - squarePixelY };
  return { x: squarePixelX, y: squarePixelY };
}

function clampDisplayCoordinate(value, maximum) {
  if (!Number.isFinite(value)) return 0;
  return clamp(value, 0, maximum);
}

function getPartitionModeWeight(mode) {
  if (mode === "split") return 1.08;
  if (mode === "vertical4" || mode === "horizontal4") return 1.18;
  if (mode && /A$|B$/.test(mode)) return 1.12;
  if (mode === "vertical" || mode === "horizontal") return 1.04;
  return 1;
}

function summarizePartitionCells(cells) {
  const modes = new Map();
  let maxDepth = 0;
  let rootColumns = 1;
  let rootRows = 1;
  let aggregation = 1;
  for (const cell of cells) {
    maxDepth = Math.max(maxDepth, cell.depth || 0);
    modes.set(cell.partitionMode || "unknown", (modes.get(cell.partitionMode || "unknown") || 0) + 1);
    if (cell.layout) {
      rootColumns = cell.layout.columns || rootColumns;
      rootRows = cell.layout.rows || rootRows;
      aggregation = cell.layout.aggregation || aggregation;
    }
  }
  return {
    rootColumns,
    rootRows,
    aggregation,
    maxDepth,
    modes: Array.from(modes.entries())
      .sort((left, right) => right[1] - left[1])
      .map(([mode, count]) => ({ mode, count }))
  };
}

function applyVideoColorScale(cells, colorScale) {
  const values = colorScale && colorScale.values || [];
  for (const cell of cells) {
    const percentile = getPercentileRank(values, getCellHeatValue(cell));
    const color = getPercentileHeatColor(percentile);
    cell.globalPercentile = percentile;
    cell.intensity = getPercentileAlpha(percentile);
    cell.color = color;
  }
}

function getCellHeatValue(cell) {
  const value = Number(cell && cell.estimatedBytesPerPixel);
  if (Number.isFinite(value) && value >= 0) return value;
  const bytes = Number(cell && cell.estimatedBytes) || 0;
  const area = Math.max(1, Number(cell && cell.blockWidth) * Number(cell && cell.blockHeight) || 1);
  return bytes / area;
}

function buildValueDistribution(values, mode, sampleCount) {
  const sortedValues = values
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value >= 0)
    .sort((left, right) => left - right);
  if (!sortedValues.length) sortedValues.push(0);
  return {
    mode,
    values: sortedValues,
    valueCount: sortedValues.length,
    sampleCount,
    min: sortedValues[0],
    max: sortedValues[sortedValues.length - 1],
    p10: getQuantile(sortedValues, 0.1),
    p25: getQuantile(sortedValues, 0.25),
    p50: getQuantile(sortedValues, 0.5),
    p75: getQuantile(sortedValues, 0.75),
    p90: getQuantile(sortedValues, 0.9),
    p95: getQuantile(sortedValues, 0.95),
    p99: getQuantile(sortedValues, 0.99)
  };
}

function summarizeColorScale(colorScale) {
  const { values, ...summary } = colorScale || buildValueDistribution([], "unavailable", 0);
  return summary;
}

function getQuantile(sortedValues, percentile) {
  if (!sortedValues.length) return 0;
  const position = clamp(percentile, 0, 1) * (sortedValues.length - 1);
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  if (lowerIndex === upperIndex) return sortedValues[lowerIndex];
  const ratio = position - lowerIndex;
  return sortedValues[lowerIndex] * (1 - ratio) + sortedValues[upperIndex] * ratio;
}

function getPercentileRank(sortedValues, value) {
  if (!sortedValues.length) return 0.5;
  const minimum = sortedValues[0];
  const maximum = sortedValues[sortedValues.length - 1];
  if (maximum <= minimum) return 0.5;
  const index = upperBound(sortedValues, value);
  return clamp((index - 1) / (sortedValues.length - 1), 0, 1);
}

function upperBound(sortedValues, value) {
  let low = 0;
  let high = sortedValues.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (sortedValues[middle] <= value) low = middle + 1;
    else high = middle;
  }
  return low;
}

function getPercentileAlpha(percentile) {
  const mappedPercentile = getNonlinearHeatPercentile(percentile);
  return 0.72 + mappedPercentile * 0.28;
}

function getPercentileHeatColor(percentile) {
  const mappedPercentile = getNonlinearHeatPercentile(percentile);
  let lowerStop = HEAT_COLOR_STOPS[0];
  let upperStop = HEAT_COLOR_STOPS[HEAT_COLOR_STOPS.length - 1];
  for (let index = 1; index < HEAT_COLOR_STOPS.length; index += 1) {
    if (mappedPercentile <= HEAT_COLOR_STOPS[index].percentile) {
      lowerStop = HEAT_COLOR_STOPS[index - 1];
      upperStop = HEAT_COLOR_STOPS[index];
      break;
    }
  }
  const span = Math.max(0.000001, upperStop.percentile - lowerStop.percentile);
  const ratio = clamp((mappedPercentile - lowerStop.percentile) / span, 0, 1);
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

function getSyntheticSpatialWeight(row, rowIndex, columnIndex, rowCount, columnCount) {
  const x = columnCount <= 1 ? 0.5 : columnIndex / (columnCount - 1);
  const y = rowCount <= 1 ? 0.5 : rowIndex / (rowCount - 1);
  return getSyntheticSpatialWeightAt(row, x, y);
}

function getSyntheticSpatialWeightAt(row, x, y) {
  const centerX = x - 0.5;
  const centerY = y - 0.5;
  const centerBias = 1.1 - Math.min(0.65, Math.sqrt(centerX * centerX + centerY * centerY));
  const type = row.frameType || "";
  const typeBias = type === "I" || type === "IDR" ? 1.15 : type === "B" ? 0.92 : 1;
  return Math.max(0.1, centerBias * typeBias * (0.72 + deterministicNoise(row, Math.round(y * 1000), Math.round(x * 1000)) * 0.56));
}

function deterministicNoise(row, rowIndex, columnIndex) {
  let value = (
    (Number(row.trackId) || 0) * 73856093 ^
    (Number(row.sampleIndex) || 0) * 19349663 ^
    rowIndex * 83492791 ^
    columnIndex * 2654435761
  ) >>> 0;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  return ((value >>> 0) % 1000) / 999;
}

function buildAudioInternalsModel(row, track) {
  const sampleSize = Math.max(0, Number(row.size) || 0);
  const sampleRate = getAudioSampleRate(track);
  const activeBandwidthHz = getActiveAudioBandwidth(row, track, sampleRate);
  const weights = AUDIO_BANDS.map((band, index) => getAudioBandWeight(band, index, row, activeBandwidthHz));
  const totalWeight = weights.reduce((sum, value) => sum + value, 0) || 1;
  const bands = AUDIO_BANDS.map((band, index) => {
    const estimatedBytes = sampleSize * weights[index] / totalWeight;
    return {
      ...band,
      active: band.startHz < activeBandwidthHz,
      estimatedBytes,
      ratio: sampleSize > 0 ? estimatedBytes / sampleSize : 0,
      intensity: clamp(weights[index] / Math.max(...weights), 0.12, 1)
    };
  });
  return {
    kind: "audio-bands",
    title: (track.codecConfig && track.codecConfig.audioObjectTypeName || track.codec || "Audio") + " band budget",
    codec: track.codec,
    frameType: row.frameType || "audio",
    sampleSize,
    sampleRate,
    activeBandwidthHz,
    channelCount: track.channelCount || 0,
    note: "This is a packet-size and codec-metadata estimate. Exact per-band bit allocation requires codec payload decoding.",
    bands
  };
}

function getAudioSampleRate(track) {
  const configRate = track.codecConfig && (track.codecConfig.samplingFrequency || track.codecConfig.inputSampleRate);
  return Math.max(0, Number(configRate || track.sampleRate || 0));
}

function getActiveAudioBandwidth(row, track, sampleRate) {
  const tags = (row.nalTypes || []).map((value) => String(value));
  const bandwidthTag = tags.find((value) => /^(NB|MB|WB|SWB|FB)$/.test(value));
  const bandwidthMap = { NB: 4000, MB: 6000, WB: 8000, SWB: 12000, FB: 20000 };
  if (bandwidthTag) return bandwidthMap[bandwidthTag];
  const nyquist = sampleRate > 0 ? sampleRate / 2 : 20000;
  return Math.max(4000, Math.min(20000, nyquist));
}

function getAudioBandWeight(band, index, row, activeBandwidthHz) {
  if (band.startHz >= activeBandwidthHz) return 0.04;
  const activeEnd = Math.min(band.endHz, activeBandwidthHz);
  const activeSpan = Math.max(0, activeEnd - band.startHz);
  const spanWeight = Math.log2(1 + activeSpan / 40);
  return Math.max(0.08, spanWeight * (0.72 + deterministicNoise(row, index, band.endHz) * 0.56));
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

export {
  AUDIO_BANDS,
  VIDEO_CODING_UNITS,
  buildFrameInternalsColorScale,
  buildFrameInternalsModel
};
