function compareRowsByPresentationTime(left, right, getTrackForRow) {
  const leftTime = getRowTimeSeconds(left, getTrackForRow);
  const rightTime = getRowTimeSeconds(right, getTrackForRow);
  if (leftTime !== rightTime) return leftTime - rightTime;
  if (left.trackId !== right.trackId) return left.trackId - right.trackId;
  return left.sampleIndex - right.sampleIndex;
}

function compareRowsByDecodeTime(left, right, getTrackForRow) {
  const leftTime = getRowDecodeTimeSeconds(left, getTrackForRow);
  const rightTime = getRowDecodeTimeSeconds(right, getTrackForRow);
  if (leftTime !== rightTime) return leftTime - rightTime;
  if (left.trackId !== right.trackId) return left.trackId - right.trackId;
  return left.sampleIndex - right.sampleIndex;
}

function getRowTimeSeconds(row, getTrackForRow) {
  const track = getTrackForRow ? getTrackForRow(row) : null;
  const timestamp = getFirstFiniteNumber([row.pts, row.dts], null);
  if (!track || !track.timescale) return timestamp === null ? getFirstFiniteNumber([row.sampleIndex], 0) : timestamp;
  return (timestamp === null ? 0 : timestamp) / Number(track.timescale);
}

function getRowDurationSeconds(row, getTrackForRow) {
  const track = getTrackForRow ? getTrackForRow(row) : null;
  const duration = Number(row.duration);
  if (!track || !track.timescale || !Number.isFinite(duration) || duration <= 0) return 0;
  return duration / Number(track.timescale);
}

function getRowDecodeTimeSeconds(row, getTrackForRow) {
  const track = getTrackForRow ? getTrackForRow(row) : null;
  const timestamp = getFirstFiniteNumber([row.dts, row.pts], null);
  if (!track || !track.timescale) return timestamp === null ? getFirstFiniteNumber([row.sampleIndex], 0) : timestamp;
  return (timestamp === null ? 0 : timestamp) / Number(track.timescale);
}

function getFirstFiniteNumber(values, fallbackValue) {
  for (const value of values) {
    if (value === undefined || value === null || value === "") continue;
    const numberValue = Number(value);
    if (Number.isFinite(numberValue)) return numberValue;
  }
  return fallbackValue;
}

function getSampleDurationSeconds(row, track, rows, index) {
  const timescale = Number(track && track.timescale);
  const duration = Number(row.duration);
  if (timescale > 0 && duration > 0) return duration / timescale;
  if (rows && index < rows.length - 1) {
    const diff = getRowTimeSeconds(rows[index + 1], () => track) - getRowTimeSeconds(row, () => track);
    if (diff > 0) return diff;
  }
  return 0;
}

function getRowsDurationSeconds(track, rows) {
  const durationSum = rows.reduce((sum, row, index) => sum + getSampleDurationSeconds(row, track, rows, index), 0);
  if (durationSum > 0) return durationSum;
  const trackDuration = Number(track && track.duration);
  const timescale = Number(track && track.timescale);
  return trackDuration > 0 && timescale > 0 ? trackDuration / timescale : 0;
}

export {
  compareRowsByDecodeTime,
  compareRowsByPresentationTime,
  getFirstFiniteNumber,
  getRowDecodeTimeSeconds,
  getRowDurationSeconds,
  getRowTimeSeconds,
  getRowsDurationSeconds,
  getSampleDurationSeconds
};
