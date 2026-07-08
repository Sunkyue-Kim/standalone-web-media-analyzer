import { BlobRangeReader } from "../../common/binary.js";
import { parseBoxes } from "./box-parser.js";
import { buildFragmentSamples, buildNormalSamples, buildTrackModels, flattenBoxes } from "./sample-model.js";

export const isoBmffContainer = {
  id: "isobmff",
  label: "ISO BMFF / MP4",
  async canAnalyze(file) {
    const bytes = new Uint8Array(await file.slice(0, Math.min(file.size, 16)).arrayBuffer());
    if (bytes.byteLength < 8) return false;
    const type = String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7]);
    return new Set(["ftyp", "moov", "mdat", "free", "skip", "wide", "uuid"]).has(type);
  },
  analyzeFile: analyzeIsoBmffFile
};

async function analyzeIsoBmffFile(file, options) {
  const onProgress = options && options.onProgress ? options.onProgress : function () {};
  const warnings = [];
  const reader = new BlobRangeReader(file);
  const fileSizeBig = BigInt(file.size);
  const topBoxes = await parseBoxes(reader, 0n, fileSizeBig, "", 0, warnings, onProgress);
  onProgress("Building track model", 66);
  const tracks = buildTrackModels(topBoxes, warnings);
  const normalRows = buildNormalSamples(tracks, warnings);
  const fragmentRows = buildFragmentSamples(topBoxes, tracks, warnings);
  const sampleRows = normalRows.concat(fragmentRows).sort((a, b) => {
    if (a.trackId !== b.trackId) return a.trackId - b.trackId;
    return a.sampleIndex - b.sampleIndex;
  });
  for (const track of tracks) {
    for (const warning of track.warnings) warnings.push("Track " + track.trackId + ": " + warning);
  }
  const allBoxes = flattenBoxes(topBoxes, []);
  const analysis = {
    file: { name: file.name || "unnamed", size: file.size, type: file.type || "" },
    reader,
    topBoxes,
    allBoxes,
    tracks,
    sampleRows,
    warnings
  };
  onProgress("Structure parsed", 100);
  return analysis;
}

