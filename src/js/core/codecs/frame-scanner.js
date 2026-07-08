import { getFrameTypeScanner } from "./registry.js";

async function scanFrameTypes(analysis, options) {
  const onProgress = options && options.onProgress ? options.onProgress : function () {};
  const reader = analysis.reader;
  const scannableTracks = new Map();
  for (const track of analysis.tracks) {
    const scanner = getFrameTypeScanner(track);
    if (scanner) scannableTracks.set(track.trackId, { track, scanner });
  }
  const rows = analysis.sampleRows.filter((row) => scannableTracks.has(row.trackId) && row.offset !== "" && row.size > 0);
  for (let index = 0; index < rows.length; index += 1) {
    if (reader.cancelled) throw new Error("Analysis cancelled.");
    const row = rows[index];
    const item = scannableTracks.get(row.trackId);
    try {
      const bytes = await reader.readRange(BigInt(row.offset), BigInt(row.size));
      const result = item.scanner.parse(bytes);
      row.frameType = result.frameType;
      row.nalTypes = result.nalTypes;
    } catch (error) {
      row.frameType = "unknown";
      row.warnings.push(item.scanner.codec + " scan failed: " + error.message);
    }
    if (index % 25 === 0 || index === rows.length - 1) {
      onProgress("Scanning video samples", rows.length ? Math.round((index + 1) * 100 / rows.length) : 100);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
}

function shouldAutoScan(analysis) {
  const videoRows = analysis.sampleRows.filter((row) => {
    const track = analysis.tracks.find((candidate) => candidate.trackId === row.trackId);
    return track && getFrameTypeScanner(track);
  });
  const totalBytes = videoRows.reduce((sum, row) => sum + (row.size || 0), 0);
  return videoRows.length > 0 && (videoRows.length <= 10000 || totalBytes <= 512 * 1024 * 1024);
}

export {
  scanFrameTypes,
  shouldAutoScan
};
