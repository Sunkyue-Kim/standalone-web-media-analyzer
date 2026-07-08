import { VIDEO_SAMPLE_ENTRIES, AUDIO_SAMPLE_ENTRIES } from "../../codecs/registry.js";

function findDescendants(node, type, results) {
  if (node.type === type) results.push(node);
  for (const child of node.children || []) findDescendants(child, type, results);
  return results;
}

function findFirst(node, type) {
  if (!node) return null;
  if (node.type === type) return node;
  for (const child of node.children || []) {
    const found = findFirst(child, type);
    if (found) return found;
  }
  return null;
}

function findChild(node, type) {
  return (node.children || []).find((child) => child.type === type) || null;
}

function flattenBoxes(nodes, result) {
  for (const node of nodes) {
    result.push(node);
    flattenBoxes(node.children || [], result);
  }
  return result;
}

function buildTrackModels(topBoxes, warnings) {
  const moov = topBoxes.find((box) => box.type === "moov");
  if (!moov) {
    warnings.push("No moov box found. Fragment-only streams without init segment are not supported.");
    return [];
  }
  const trexByTrack = new Map();
  for (const trex of findDescendants(moov, "trex", [])) trexByTrack.set(trex.fields.trackId, trex.fields);
  const tracks = [];
  for (const trak of (moov.children || []).filter((child) => child.type === "trak")) {
    const tkhd = findFirst(trak, "tkhd");
    const mdhd = findFirst(trak, "mdhd");
    const hdlr = findFirst(trak, "hdlr");
    const stsd = findFirst(trak, "stsd");
    const trackId = tkhd ? tkhd.fields.trackId : tracks.length + 1;
    const sampleEntry = stsd && stsd.fields.entries.length ? stsd.fields.entries[0] : null;
    const codec = sampleEntry ? sampleEntry.format : "unknown";
    const track = {
      trackId,
      handlerType: hdlr ? hdlr.fields.handlerType : "unknown",
      codec,
      timescale: mdhd ? mdhd.fields.timescale : 0,
      duration: mdhd ? mdhd.fields.duration : "0",
      width: sampleEntry && sampleEntry.width ? sampleEntry.width : (tkhd ? tkhd.fields.width : 0),
      height: sampleEntry && sampleEntry.height ? sampleEntry.height : (tkhd ? tkhd.fields.height : 0),
      channelCount: sampleEntry && sampleEntry.channelCount ? sampleEntry.channelCount : 0,
      sampleRate: sampleEntry && sampleEntry.sampleRate ? sampleEntry.sampleRate : 0,
      sampleCount: 0,
      avcConfig: sampleEntry && sampleEntry.avcConfig ? sampleEntry.avcConfig : null,
      hevcConfig: sampleEntry && sampleEntry.hevcConfig ? sampleEntry.hevcConfig : null,
      audioConfig: sampleEntry && sampleEntry.audioConfig ? sampleEntry.audioConfig : null,
      esds: sampleEntry && sampleEntry.esds ? sampleEntry.esds : null,
      sampleEntry,
      trex: trexByTrack.get(trackId) || null,
      stbl: findFirst(trak, "stbl"),
      warnings: []
    };
    if ((codec === "avc1" || codec === "avc3") && !track.avcConfig) {
      track.warnings.push("AVC sample entry has no avcC box.");
    }
    if ((codec === "hvc1" || codec === "hev1") && !track.hevcConfig) {
      track.warnings.push("HEVC sample entry has no hvcC box.");
    }
    if (codec === "mp4a" && !track.audioConfig) {
      track.warnings.push("AAC sample entry has no esds AudioSpecificConfig.");
    }
    tracks.push(track);
  }
  return tracks;
}

function buildNormalSamples(tracks, warnings) {
  const rows = [];
  for (const track of tracks) {
    if (!track.stbl) continue;
    const stsz = findFirst(track.stbl, "stsz");
    const stz2 = findFirst(track.stbl, "stz2");
    const stsc = findFirst(track.stbl, "stsc");
    const stco = findFirst(track.stbl, "stco") || findFirst(track.stbl, "co64");
    const stts = findFirst(track.stbl, "stts");
    if ((!stsz && !stz2) || !stsc || !stco || !stts) continue;
    const sampleCount = stsz ? stsz.fields.sampleCount : stz2.fields.sampleCount;
    if (!sampleCount) continue;
    const sizes = stsz ? (stsz.fields.sampleSize ? Array(sampleCount).fill(stsz.fields.sampleSize) : stsz.fields.sizes) : stz2.fields.sizes;
    const dtsDurations = expandTiming(stts.fields.entries, sampleCount);
    const ctts = findFirst(track.stbl, "ctts");
    const compositionOffsets = ctts ? expandCompositionOffsets(ctts.fields.entries, sampleCount) : Array(sampleCount).fill(0);
    const stss = findFirst(track.stbl, "stss");
    const syncSet = stss ? new Set(stss.fields.samples) : null;
    const offsets = computeSampleOffsets(stsc.fields.entries, stco.fields.offsets, sizes, sampleCount, track, warnings);
    for (let index = 0; index < sampleCount; index += 1) {
      const timing = dtsDurations[index] || { dts: 0, duration: 0 };
      const cts = compositionOffsets[index] || 0;
      rows.push({
        trackId: track.trackId,
        sampleIndex: index + 1,
        offset: offsets[index] ? offsets[index].offset.toString() : "",
        size: sizes[index] || 0,
        dts: timing.dts,
        pts: timing.dts + cts,
        duration: timing.duration,
        isSync: syncSet ? syncSet.has(index + 1) : true,
        frameType: getDefaultSampleFrameType(track),
        nalTypes: getDefaultSampleTags(track),
        chunkIndex: offsets[index] ? offsets[index].chunkIndex : "",
        fragmentIndex: "",
        warnings: offsets[index] ? [] : ["Sample offset missing."]
      });
    }
    track.sampleCount += sampleCount;
  }
  return rows;
}

function expandTiming(entries, sampleCount) {
  const result = new Array(sampleCount);
  let sampleIndex = 0;
  let dts = 0;
  for (const entry of entries) {
    for (let count = 0; count < entry.sampleCount && sampleIndex < sampleCount; count += 1) {
      result[sampleIndex] = { dts, duration: entry.sampleDelta };
      dts += entry.sampleDelta;
      sampleIndex += 1;
    }
  }
  return result;
}

function expandCompositionOffsets(entries, sampleCount) {
  const result = new Array(sampleCount).fill(0);
  let sampleIndex = 0;
  for (const entry of entries) {
    for (let count = 0; count < entry.sampleCount && sampleIndex < sampleCount; count += 1) {
      result[sampleIndex] = entry.sampleOffset;
      sampleIndex += 1;
    }
  }
  return result;
}

function computeSampleOffsets(stscEntries, chunkOffsets, sizes, sampleCount, track, warnings) {
  const result = new Array(sampleCount);
  let sampleIndex = 0;
  let stscIndex = 0;
  for (let chunkIndex = 1; chunkIndex <= chunkOffsets.length && sampleIndex < sampleCount; chunkIndex += 1) {
    while (stscIndex + 1 < stscEntries.length && chunkIndex >= stscEntries[stscIndex + 1].firstChunk) {
      stscIndex += 1;
    }
    const entry = stscEntries[stscIndex];
    let currentOffset;
    try {
      currentOffset = BigInt(chunkOffsets[chunkIndex - 1]);
    } catch (error) {
      warnings.push("Track " + track.trackId + " has an unsafe chunk offset.");
      break;
    }
    for (let sampleInChunk = 0; sampleInChunk < entry.samplesPerChunk && sampleIndex < sampleCount; sampleInChunk += 1) {
      result[sampleIndex] = { offset: currentOffset, chunkIndex };
      currentOffset += BigInt(sizes[sampleIndex] || 0);
      sampleIndex += 1;
    }
  }
  return result;
}

function buildFragmentSamples(topBoxes, tracks, warnings) {
  const rows = [];
  const sampleIndexByTrack = new Map(tracks.map((track) => [track.trackId, track.sampleCount]));
  const trackById = new Map(tracks.map((track) => [track.trackId, track]));
  const topLevel = topBoxes.slice().sort((a, b) => Number(a.offsetBig - b.offsetBig));
  let fragmentIndex = 0;
  for (const moof of topLevel.filter((box) => box.type === "moof")) {
    fragmentIndex += 1;
    const mdat = findFollowingMdat(topLevel, moof);
    const fallbackDataStart = mdat ? mdat.offsetBig + BigInt(mdat.headerSize) : moof.offsetBig + moof.sizeBig;
    let trafDataCursor = fallbackDataStart;
    for (const traf of (moof.children || []).filter((child) => child.type === "traf")) {
      const tfhd = findChild(traf, "tfhd");
      const tfdt = findChild(traf, "tfdt");
      if (!tfhd) {
        warnings.push("Fragment " + fragmentIndex + " has traf without tfhd.");
        continue;
      }
      const track = trackById.get(tfhd.fields.trackId);
      if (!track) {
        warnings.push("Fragment " + fragmentIndex + " references unknown track " + tfhd.fields.trackId + ".");
        continue;
      }
      const trex = track.trex || {};
      let decodeTime = tfdt ? Number(tfdt.fields.baseMediaDecodeTime) : 0;
      let baseDataOffset;
      if (tfhd.fields.baseDataOffset) baseDataOffset = BigInt(tfhd.fields.baseDataOffset);
      else if (tfhd.fields.defaultBaseIsMoof) baseDataOffset = moof.offsetBig;
      else baseDataOffset = trafDataCursor;
      let localDataCursor = trafDataCursor;
      for (const trun of (traf.children || []).filter((child) => child.type === "trun")) {
        const run = trun.fields;
        let dataCursor = run.dataOffset !== undefined ? baseDataOffset + BigInt(run.dataOffset) : localDataCursor;
        for (let index = 0; index < run.samples.length; index += 1) {
          const sample = run.samples[index];
          const duration = sample.duration || tfhd.fields.defaultSampleDuration || trex.defaultSampleDuration || 0;
          const size = sample.size || tfhd.fields.defaultSampleSize || trex.defaultSampleSize || 0;
          let flags = sample.flags;
          if (flags === undefined && index === 0 && run.firstSampleFlags !== undefined) flags = run.firstSampleFlags;
          if (flags === undefined) flags = tfhd.fields.defaultSampleFlags !== undefined ? tfhd.fields.defaultSampleFlags : trex.defaultSampleFlags;
          const ctsOffset = sample.compositionTimeOffset || 0;
          const nextIndex = (sampleIndexByTrack.get(track.trackId) || 0) + 1;
          sampleIndexByTrack.set(track.trackId, nextIndex);
          rows.push({
            trackId: track.trackId,
            sampleIndex: nextIndex,
            offset: dataCursor.toString(),
            size,
            dts: decodeTime,
            pts: decodeTime + ctsOffset,
            duration,
            isSync: sampleFlagsToSync(flags),
            frameType: getDefaultSampleFrameType(track),
            nalTypes: getDefaultSampleTags(track),
            chunkIndex: "",
            fragmentIndex,
            warnings: size ? [] : ["Fragment sample size is missing."]
          });
          dataCursor += BigInt(size || 0);
          decodeTime += duration;
        }
        localDataCursor = dataCursor;
        trafDataCursor = dataCursor;
      }
    }
  }
  for (const track of tracks) track.sampleCount = sampleIndexByTrack.get(track.trackId) || track.sampleCount;
  return rows;
}

function findFollowingMdat(topLevel, moof) {
  const moofEnd = moof.offsetBig + moof.sizeBig;
  return topLevel.find((box) => box.type === "mdat" && box.offsetBig >= moofEnd) || null;
}

function sampleFlagsToSync(flags) {
  if (flags === undefined || flags === null) return false;
  return (flags & 0x00010000) === 0;
}

function getDefaultSampleFrameType(track) {
  if (!track) return "";
  if (track.codec === "mp4a") return "AAC";
  if (track.handlerType === "soun") return "audio";
  return "";
}

function getDefaultSampleTags(track) {
  if (!track) return [];
  if (track.codec === "mp4a") return ["AAC"];
  if (track.handlerType === "soun") return [track.codec];
  return [];
}

export {
  findDescendants,
  findFirst,
  findChild,
  flattenBoxes,
  buildTrackModels,
  buildNormalSamples,
  buildFragmentSamples,
  getDefaultSampleFrameType,
  getDefaultSampleTags
};
