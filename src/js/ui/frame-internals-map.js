const DEFAULT_HEATMAP_BUCKET_COUNT = 32;
const MINIMUM_SPATIAL_BUCKET_COUNT = 8;
const MAXIMUM_SPATIAL_BUCKET_COUNT = 64;

export function buildFrameInternalsPathGroups(cells, options = {}) {
  const heatmapBucketCount = normalizePositiveInteger(
    options.heatmapBucketCount,
    DEFAULT_HEATMAP_BUCKET_COUNT
  );
  const groupsByBucket = new Map();

  for (const cell of Array.isArray(cells) ? cells : []) {
    const bounds = getFrameInternalsDisplayBounds(cell);
    if (bounds.right <= bounds.left || bounds.bottom <= bounds.top) continue;
    const heatmapBucketIndex = getHeatmapBucketIndex(cell, heatmapBucketCount);
    let group = groupsByBucket.get(heatmapBucketIndex);
    if (!group) {
      group = {
        heatmapBucketIndex,
        pathSegments: [],
        redTotal: 0,
        greenTotal: 0,
        blueTotal: 0,
        alphaTotal: 0,
        cellCount: 0
      };
      groupsByBucket.set(heatmapBucketIndex, group);
    }
    const color = getCellColor(cell);
    group.pathSegments.push(renderRectanglePath(bounds));
    group.redTotal += color.red;
    group.greenTotal += color.green;
    group.blueTotal += color.blue;
    group.alphaTotal += getCellAlpha(cell);
    group.cellCount += 1;
  }

  return Array.from(groupsByBucket.values())
    .sort((left, right) => left.heatmapBucketIndex - right.heatmapBucketIndex)
    .map((group) => ({
      heatmapBucketIndex: group.heatmapBucketIndex,
      pathData: group.pathSegments.join(""),
      red: Math.round(group.redTotal / group.cellCount),
      green: Math.round(group.greenTotal / group.cellCount),
      blue: Math.round(group.blueTotal / group.cellCount),
      alpha: group.alphaTotal / group.cellCount,
      cellCount: group.cellCount
    }));
}

export function createFrameInternalsSpatialIndex(model, options = {}) {
  const cells = Array.isArray(model && model.cells) ? model.cells : [];
  const mediaWidth = Math.max(1, Number(model && model.mediaWidth) || 1);
  const mediaHeight = Math.max(1, Number(model && model.mediaHeight) || 1);
  const spatialBucketCounts = getSpatialBucketCounts(
    cells.length,
    mediaWidth,
    mediaHeight,
    options.maximumBucketCount
  );
  const buckets = Array.from(
    { length: spatialBucketCounts.columns * spatialBucketCounts.rows },
    () => []
  );

  cells.forEach((cell, cellIndex) => {
    const bounds = getFrameInternalsDisplayBounds(cell);
    const firstColumn = getSpatialBucketCoordinate(
      bounds.left,
      mediaWidth,
      spatialBucketCounts.columns
    );
    const lastColumn = getSpatialBucketCoordinate(
      Math.max(bounds.left, bounds.right - Number.EPSILON),
      mediaWidth,
      spatialBucketCounts.columns
    );
    const firstRow = getSpatialBucketCoordinate(
      bounds.top,
      mediaHeight,
      spatialBucketCounts.rows
    );
    const lastRow = getSpatialBucketCoordinate(
      Math.max(bounds.top, bounds.bottom - Number.EPSILON),
      mediaHeight,
      spatialBucketCounts.rows
    );
    for (let bucketRow = firstRow; bucketRow <= lastRow; bucketRow += 1) {
      for (let bucketColumn = firstColumn; bucketColumn <= lastColumn; bucketColumn += 1) {
        buckets[bucketRow * spatialBucketCounts.columns + bucketColumn].push(cellIndex);
      }
    }
  });

  return {
    cells,
    mediaWidth,
    mediaHeight,
    bucketColumnCount: spatialBucketCounts.columns,
    bucketRowCount: spatialBucketCounts.rows,
    buckets
  };
}

export function findFrameInternalsCell(spatialIndex, mapCoordinateX, mapCoordinateY) {
  if (!spatialIndex || !Array.isArray(spatialIndex.cells)) return null;
  const coordinateX = Number(mapCoordinateX);
  const coordinateY = Number(mapCoordinateY);
  if (
    !Number.isFinite(coordinateX) ||
    !Number.isFinite(coordinateY) ||
    coordinateX < 0 ||
    coordinateY < 0 ||
    coordinateX > spatialIndex.mediaWidth ||
    coordinateY > spatialIndex.mediaHeight
  ) {
    return null;
  }
  const bucketColumn = getSpatialBucketCoordinate(
    coordinateX,
    spatialIndex.mediaWidth,
    spatialIndex.bucketColumnCount
  );
  const bucketRow = getSpatialBucketCoordinate(
    coordinateY,
    spatialIndex.mediaHeight,
    spatialIndex.bucketRowCount
  );
  const candidateIndexes = spatialIndex.buckets[
    bucketRow * spatialIndex.bucketColumnCount + bucketColumn
  ] || [];

  for (const candidateIndex of candidateIndexes) {
    const cell = spatialIndex.cells[candidateIndex];
    const bounds = getFrameInternalsDisplayBounds(cell);
    if (
      coordinateX >= bounds.left &&
      coordinateX <= bounds.right &&
      coordinateY >= bounds.top &&
      coordinateY <= bounds.bottom
    ) {
      return cell;
    }
  }
  return null;
}

export function getFrameInternalsDisplayBounds(cell) {
  return {
    left: getFiniteNumber(cell && cell.displayPixelLeft, cell && cell.pixelLeft),
    top: getFiniteNumber(cell && cell.displayPixelTop, cell && cell.pixelTop),
    right: getFiniteNumber(cell && cell.displayPixelRight, cell && cell.pixelRight),
    bottom: getFiniteNumber(cell && cell.displayPixelBottom, cell && cell.pixelBottom)
  };
}

function getHeatmapBucketIndex(cell, heatmapBucketCount) {
  const rawGlobalPercentile = cell && cell.globalPercentile;
  const globalPercentile = Number(rawGlobalPercentile);
  const normalizedPercentile = isPresentFiniteValue(rawGlobalPercentile, globalPercentile)
    ? clamp(globalPercentile, 0, 1)
    : clamp((getCellAlpha(cell) - 0.72) / 0.28, 0, 1);
  return Math.min(
    heatmapBucketCount - 1,
    Math.floor(normalizedPercentile * heatmapBucketCount)
  );
}

function getCellColor(cell) {
  const color = cell && cell.color;
  return {
    red: clampColorChannel(color && color.red, 31),
    green: clampColorChannel(color && color.green, 122),
    blue: clampColorChannel(color && color.blue, 140)
  };
}

function getCellAlpha(cell) {
  const rawIntensity = cell && cell.intensity;
  const intensity = Number(rawIntensity);
  return isPresentFiniteValue(rawIntensity, intensity) ? clamp(intensity, 0, 1) : 0.75;
}

function clampColorChannel(value, fallbackValue) {
  if (value === null || value === undefined || value === "") return fallbackValue;
  const numberValue = Number(value);
  return Math.round(clamp(Number.isFinite(numberValue) ? numberValue : fallbackValue, 0, 255));
}

function renderRectanglePath(bounds) {
  return "M" + formatSvgNumber(bounds.left) + " " + formatSvgNumber(bounds.top) +
    "H" + formatSvgNumber(bounds.right) +
    "V" + formatSvgNumber(bounds.bottom) +
    "H" + formatSvgNumber(bounds.left) + "Z";
}

function formatSvgNumber(value) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return "0";
  return Math.abs(numberValue - Math.round(numberValue)) < 0.001
    ? String(Math.round(numberValue))
    : numberValue.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

function getSpatialBucketCounts(cellCount, mediaWidth, mediaHeight, maximumBucketCount) {
  const maximumCount = Math.max(
    MINIMUM_SPATIAL_BUCKET_COUNT,
    normalizePositiveInteger(maximumBucketCount, MAXIMUM_SPATIAL_BUCKET_COUNT)
  );
  const aspectRatio = mediaWidth / mediaHeight;
  const targetBucketCount = clamp(
    Math.ceil(Math.sqrt(Math.max(1, cellCount))),
    MINIMUM_SPATIAL_BUCKET_COUNT,
    maximumCount
  );
  return {
    columns: Math.max(
      MINIMUM_SPATIAL_BUCKET_COUNT,
      Math.min(maximumCount, Math.round(targetBucketCount * Math.sqrt(aspectRatio)))
    ),
    rows: Math.max(
      MINIMUM_SPATIAL_BUCKET_COUNT,
      Math.min(maximumCount, Math.round(targetBucketCount / Math.sqrt(aspectRatio)))
    )
  };
}

function getSpatialBucketCoordinate(value, mediaLength, bucketCount) {
  const normalizedValue = clamp(Number(value) / Math.max(1, mediaLength), 0, 1);
  return Math.min(bucketCount - 1, Math.floor(normalizedValue * bucketCount));
}

function getFiniteNumber(primaryValue, fallbackValue) {
  const primaryNumber = Number(primaryValue);
  if (isPresentFiniteValue(primaryValue, primaryNumber)) return primaryNumber;
  const fallbackNumber = Number(fallbackValue);
  return isPresentFiniteValue(fallbackValue, fallbackNumber) ? fallbackNumber : 0;
}

function isPresentFiniteValue(rawValue, numberValue) {
  return rawValue !== null && rawValue !== undefined && rawValue !== "" && Number.isFinite(numberValue);
}

function normalizePositiveInteger(value, fallbackValue) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue > 0
    ? Math.max(1, Math.round(numberValue))
    : fallbackValue;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}
