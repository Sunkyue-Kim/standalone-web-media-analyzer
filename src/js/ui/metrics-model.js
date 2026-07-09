import {
  getRowTimeSeconds,
  getRowsDurationSeconds,
  getSampleDurationSeconds
} from "./media-row-model.js";

function getTrackSummaryMetrics(track, rows) {
  if (!track || !rows.length) return null;
  const totalBytes = rows.reduce((sum, row) => sum + (Number(row.size) || 0), 0);
  const totalDuration = getRowsDurationSeconds(track, rows);
  if (!totalDuration) return null;
  return {
    averageBitrate: totalBytes * 8 / totalDuration,
    sampleRate: rows.length / totalDuration,
    averageSampleSize: totalBytes / rows.length
  };
}

function buildTrackMetrics(track, rows, windowSize, options = {}) {
  const totalBytes = rows.reduce((sum, row) => sum + (Number(row.size) || 0), 0);
  const totalDuration = getRowsDurationSeconds(track, rows);
  const sizes = rows.map((row) => Number(row.size) || 0).sort((left, right) => left - right);
  const frameTypeCounts = new Map();
  const getDefaultFrameType = options.getDefaultSampleFrameType || function () { return ""; };
  for (const row of rows) {
    const frameType = row.frameType || getDefaultFrameType(track) || "sample";
    frameTypeCounts.set(frameType, (frameTypeCounts.get(frameType) || 0) + 1);
  }
  const movingAveragePoints = buildMovingAveragePoints(track, rows, windowSize);
  const bitrateValues = movingAveragePoints.map((point) => point.bitrate).filter(Number.isFinite);
  const fpsValues = movingAveragePoints.map((point) => point.fps).filter(Number.isFinite);
  const syncRows = rows.filter((row) => row.isSync);
  const keyframeIntervals = [];
  for (let index = 1; index < syncRows.length; index += 1) {
    keyframeIntervals.push(Math.max(0, getRowTimeSeconds(syncRows[index], () => track) - getRowTimeSeconds(syncRows[index - 1], () => track)));
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
      time: getWindowCenterTimeSeconds(first, last, track),
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

function getWindowCenterTimeSeconds(first, last, track) {
  const windowStartTime = getRowTimeSeconds(first.row, () => track);
  const windowEndTime = getRowTimeSeconds(last.row, () => track) + Math.max(0, last.durationSeconds);
  if (!Number.isFinite(windowStartTime) || !Number.isFinite(windowEndTime) || windowEndTime <= windowStartTime) {
    return windowStartTime;
  }
  return windowStartTime + (windowEndTime - windowStartTime) / 2;
}

function getMedian(sortedValues) {
  if (!sortedValues.length) return 0;
  const middle = Math.floor(sortedValues.length / 2);
  return sortedValues.length % 2 ? sortedValues[middle] : (sortedValues[middle - 1] + sortedValues[middle]) / 2;
}

export {
  buildMovingAveragePoints,
  buildTrackMetrics,
  getMedian,
  getTrackSummaryMetrics
};
