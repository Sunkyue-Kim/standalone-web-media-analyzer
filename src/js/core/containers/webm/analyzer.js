import { createRangeReader, getResourceInfo, readResourcePrefix } from "../../common/binary.js";
import { parseOpusHead, parseOpusPacket } from "../../codecs/audio/opus.js";
import { parseAv1Sample } from "../../codecs/video/av1.js";

const UNKNOWN_SIZE = -1n;
const MAX_INLINE_FIELD_BYTES = 256 * 1024;
const TIMECODE_SCALE_DEFAULT = 1000000;

const ELEMENT_NAMES = new Map([
  [0x1a45dfa3, "EBML"],
  [0x4286, "EBMLVersion"],
  [0x42f7, "EBMLReadVersion"],
  [0x42f2, "EBMLMaxIDLength"],
  [0x42f3, "EBMLMaxSizeLength"],
  [0x4282, "DocType"],
  [0x4287, "DocTypeVersion"],
  [0x4285, "DocTypeReadVersion"],
  [0x18538067, "Segment"],
  [0x114d9b74, "SeekHead"],
  [0x4dbb, "Seek"],
  [0x53ab, "SeekID"],
  [0x53ac, "SeekPosition"],
  [0x1549a966, "Info"],
  [0x2ad7b1, "TimecodeScale"],
  [0x4489, "Duration"],
  [0x4d80, "MuxingApp"],
  [0x5741, "WritingApp"],
  [0x1654ae6b, "Tracks"],
  [0xae, "TrackEntry"],
  [0xd7, "TrackNumber"],
  [0x73c5, "TrackUID"],
  [0x83, "TrackType"],
  [0x86, "CodecID"],
  [0x63a2, "CodecPrivate"],
  [0x23e383, "DefaultDuration"],
  [0x22b59c, "Language"],
  [0x88, "FlagDefault"],
  [0x9a, "FlagInterlaced"],
  [0x9c, "FlagLacing"],
  [0x56aa, "CodecDelay"],
  [0x56bb, "SeekPreRoll"],
  [0xe0, "Video"],
  [0xb0, "PixelWidth"],
  [0xba, "PixelHeight"],
  [0xe1, "Audio"],
  [0xb5, "SamplingFrequency"],
  [0x9f, "Channels"],
  [0x6264, "BitDepth"],
  [0x1f43b675, "Cluster"],
  [0xe7, "Timecode"],
  [0xa3, "SimpleBlock"],
  [0xa0, "BlockGroup"],
  [0xa1, "Block"],
  [0x75a2, "DiscardPadding"],
  [0x1c53bb6b, "Cues"],
  [0xbb, "CuePoint"],
  [0xb3, "CueTime"],
  [0xb7, "CueTrackPositions"],
  [0xf7, "CueTrack"],
  [0xf1, "CueClusterPosition"],
  [0xf0, "CueRelativePosition"],
  [0x1254c367, "Tags"],
  [0x7373, "Tag"],
  [0x63c0, "Targets"],
  [0x63c5, "TagTrackUID"],
  [0x67c8, "SimpleTag"],
  [0x45a3, "TagName"],
  [0x4487, "TagString"],
  [0x447a, "TagLanguage"],
  [0x4484, "TagDefault"],
  [0xec, "Void"]
]);

const MASTER_ELEMENT_IDS = new Set([
  0x1a45dfa3, 0x18538067, 0x114d9b74, 0x4dbb, 0x1549a966, 0x1654ae6b, 0xae, 0xe0, 0xe1, 0x1f43b675, 0xa0,
  0x1c53bb6b, 0xbb, 0xb7, 0x1254c367, 0x7373, 0x63c0, 0x67c8
]);

const UNSIGNED_INTEGER_IDS = new Set([
  0x4286, 0x42f7, 0x42f2, 0x42f3, 0x4287, 0x4285, 0x53ac, 0x2ad7b1, 0xd7, 0x73c5, 0x83,
  0x23e383, 0x88, 0x9a, 0x9c, 0x56aa, 0x56bb, 0xb0, 0xba, 0x9f, 0x6264, 0xe7, 0xb3, 0xf7,
  0xf1, 0xf0, 0x63c5, 0x4484
]);
const STRING_IDS = new Set([0x4282, 0x86, 0x22b59c, 0x4d80, 0x5741, 0x45a3, 0x4487, 0x447a]);
const FLOAT_IDS = new Set([0x4489, 0xb5]);

export const webmContainer = {
  id: "webm",
  label: "WebM / Matroska",
  async canAnalyze(file) {
    const bytes = await readResourcePrefix(file, 16);
    return bytes.byteLength >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
  },
  analyzeFile: analyzeWebmFile
};

async function analyzeWebmFile(file, options) {
  const onProgress = options && options.onProgress ? options.onProgress : function () {};
  const warnings = [];
  const reader = createRangeReader(file);
  if (options && options.onReader) options.onReader(reader);
  onProgress("Parsing EBML elements", 5);
  const topBoxes = await parseEbmlElements(reader, 0n, BigInt(file.size), "", 0, warnings, onProgress);
  const context = buildWebmContext(topBoxes, warnings);
  const tracks = buildWebmTracks(context);
  const sampleRows = await buildWebmSamples(reader, topBoxes, tracks, context, warnings, onProgress);
  for (const track of tracks) {
    track.sampleCount = sampleRows.filter((row) => row.trackId === track.trackId).length;
    const endTime = sampleRows
      .filter((row) => row.trackId === track.trackId)
      .reduce((maxValue, row) => Math.max(maxValue, getSampleTimestamp(row) + Number(row.duration || 0)), 0);
    if (!Number(track.duration)) track.duration = String(endTime);
  }
  onProgress("Structure parsed", 100);
  return {
    file: getResourceInfo(file),
    reader,
    topBoxes,
    allBoxes: flattenNodes(topBoxes, []),
    tracks,
    sampleRows,
    warnings
  };
}

function getSampleTimestamp(row) {
  for (const value of [row.pts, row.dts]) {
    if (value === undefined || value === null || value === "") continue;
    const numberValue = Number(value);
    if (Number.isFinite(numberValue)) return numberValue;
  }
  return 0;
}

async function parseEbmlElements(reader, startBig, endBig, parentPath, depth, warnings, onProgress) {
  const nodes = [];
  let offsetBig = startBig;
  let elementIndex = 0;
  while (offsetBig + 2n <= endBig) {
    if (reader.cancelled) throw new Error("Analysis cancelled.");
    const header = await readEbmlElementHeader(reader, offsetBig, endBig);
    if (!header) break;
    const dataOffsetBig = offsetBig + BigInt(header.headerSize);
    const elementEndBig = header.sizeBig === UNKNOWN_SIZE ? endBig : dataOffsetBig + header.sizeBig;
    if (elementEndBig > endBig && header.sizeBig !== UNKNOWN_SIZE) {
      warnings.push("EBML element " + header.name + " exceeds parent bounds.");
      break;
    }
    elementIndex += 1;
    const path = parentPath + "/" + header.name + "[" + elementIndex + "]";
    const node = {
      type: header.name,
      path,
      offset: offsetBig.toString(),
      offsetBig,
      size: (BigInt(header.headerSize) + (header.sizeBig === UNKNOWN_SIZE ? 0n : header.sizeBig)).toString(),
      sizeBig: BigInt(header.headerSize) + (header.sizeBig === UNKNOWN_SIZE ? 0n : header.sizeBig),
      headerSize: header.headerSize,
      children: [],
      fields: {
        id: "0x" + header.id.toString(16),
        dataSize: header.sizeBig === UNKNOWN_SIZE ? "unknown" : header.sizeBig.toString()
      },
      warnings: []
    };
    if (MASTER_ELEMENT_IDS.has(header.id)) {
      const parseSizeBig = header.sizeBig === UNKNOWN_SIZE ? elementEndBig - dataOffsetBig : header.sizeBig;
      const shouldDescend = depth < 8 && shouldParseMaster(header.id, parseSizeBig);
      if (shouldDescend) {
        node.children = await parseEbmlElements(reader, dataOffsetBig, elementEndBig, path, depth + 1, warnings, onProgress);
      }
    } else {
      await parseEbmlField(reader, node, header, dataOffsetBig);
    }
    nodes.push(node);
    if (Number(offsetBig) % (1024 * 1024) < 32) onProgress("Parsing EBML elements", Math.min(65, Math.round(Number(offsetBig) * 65 / reader.file.size)));
    if (header.sizeBig === UNKNOWN_SIZE) break;
    offsetBig = elementEndBig;
  }
  return nodes;
}

function shouldParseMaster(id, sizeBig) {
  if (id === 0x18538067 || id === 0x1f43b675) return true;
  return sizeBig <= 16n * 1024n * 1024n;
}

async function readEbmlElementHeader(reader, offsetBig, endBig) {
  const maxHeader = Number(endBig - offsetBig > 16n ? 16n : endBig - offsetBig);
  if (maxHeader < 2) return null;
  const bytes = await reader.readRange(offsetBig, BigInt(maxHeader));
  const id = readEbmlId(bytes, 0);
  if (!id) return null;
  const size = readEbmlSize(bytes, id.length);
  if (!size) return null;
  return {
    id: id.value,
    name: ELEMENT_NAMES.get(id.value) || ("EBML_0x" + id.value.toString(16)),
    sizeBig: size.unknown ? UNKNOWN_SIZE : size.value,
    headerSize: id.length + size.length
  };
}

function readEbmlId(bytes, offset) {
  if (offset >= bytes.byteLength) return null;
  const first = bytes[offset];
  let mask = 0x80;
  let length = 1;
  while (length <= 4 && !(first & mask)) {
    mask >>= 1;
    length += 1;
  }
  if (length > 4 || offset + length > bytes.byteLength) return null;
  let value = 0;
  for (let index = 0; index < length; index += 1) value = (value << 8) | bytes[offset + index];
  return { value, length };
}

function readEbmlSize(bytes, offset) {
  if (offset >= bytes.byteLength) return null;
  const first = bytes[offset];
  let mask = 0x80;
  let length = 1;
  while (length <= 8 && !(first & mask)) {
    mask >>= 1;
    length += 1;
  }
  if (length > 8 || offset + length > bytes.byteLength) return null;
  let value = BigInt(first & (mask - 1));
  let unknownValue = BigInt(mask - 1);
  for (let index = 1; index < length; index += 1) {
    value = (value << 8n) + BigInt(bytes[offset + index]);
    unknownValue = (unknownValue << 8n) + 0xffn;
  }
  return { value, length, unknown: value === unknownValue };
}

async function parseEbmlField(reader, node, header, dataOffsetBig) {
  if (header.sizeBig === UNKNOWN_SIZE || header.sizeBig > BigInt(MAX_INLINE_FIELD_BYTES)) return;
  const bytes = await reader.readRange(dataOffsetBig, header.sizeBig);
  if (UNSIGNED_INTEGER_IDS.has(header.id)) node.fields.value = readUnsignedInteger(bytes);
  else if (STRING_IDS.has(header.id)) node.fields.value = decodeAscii(bytes);
  else if (FLOAT_IDS.has(header.id)) node.fields.value = readFloat(bytes);
  else if (header.id === 0xa3 || header.id === 0xa1) node.fields = { ...node.fields, ...parseBlockHeader(bytes, Number(dataOffsetBig), Number(header.sizeBig)) };
  else if (header.id === 0x63a2) {
    node.fields.bytes = bytes;
    node.fields.previewHex = Array.from(bytes.subarray(0, Math.min(bytes.byteLength, 16))).map((value) => value.toString(16).padStart(2, "0")).join("");
  }
}

function buildWebmContext(topBoxes, warnings) {
  const allNodes = flattenNodes(topBoxes, []);
  const infoNode = allNodes.find((node) => node.type === "Info");
  const timecodeScaleNode = infoNode ? findChild(infoNode, "TimecodeScale") : null;
  const durationNode = infoNode ? findChild(infoNode, "Duration") : null;
  const timecodeScale = timecodeScaleNode && timecodeScaleNode.fields.value ? Number(timecodeScaleNode.fields.value) : TIMECODE_SCALE_DEFAULT;
  const duration = durationNode && durationNode.fields.value ? Math.round(Number(durationNode.fields.value) * timecodeScale) : 0;
  const trackEntries = allNodes.filter((node) => node.type === "TrackEntry");
  if (!trackEntries.length) warnings.push("No WebM TrackEntry elements found.");
  return { allNodes, timecodeScale, duration, trackEntries };
}

function buildWebmTracks(context) {
  return context.trackEntries.map((entry, index) => {
    const trackNumber = numberField(entry, "TrackNumber") || index + 1;
    const trackType = numberField(entry, "TrackType");
    const codec = stringField(entry, "CodecID") || "unknown";
    const video = findChild(entry, "Video");
    const audio = findChild(entry, "Audio");
    const defaultDuration = numberField(entry, "DefaultDuration") || 0;
    const codecPrivate = findChild(entry, "CodecPrivate");
    const codecPrivateBytes = codecPrivate ? codecPrivate.fields.bytes : null;
    const opusHead = codec === "A_OPUS" && codecPrivateBytes ? parseOpusHead(codecPrivateBytes) : null;
    const samplingFrequency = audio ? (numberField(audio, "SamplingFrequency") || 0) : 0;
    const channels = audio ? (numberField(audio, "Channels") || 0) : 0;
    const handlerType = trackType === 1 ? "vide" : trackType === 2 ? "soun" : "unknown";
    const codecConfig = handlerType === "soun" ? {
      codecString: codec === "A_OPUS" ? "opus" : codec,
      audioObjectTypeName: codec === "A_OPUS" ? "Opus" : codec,
      channelDescription: channels ? channels + (channels === 1 ? " channel" : " channels") : "audio",
      samplingFrequency: codec === "A_OPUS" ? 48000 : samplingFrequency,
      opusHead
    } : codec === "V_AV1" ? {
      codecString: "av01",
      codecFamily: "AV1"
    } : null;
    return {
      trackId: trackNumber,
      handlerType,
      codec,
      codecDescriptor: codec === "A_OPUS" ? "opus" : codec === "V_AV1" ? "av1" : codec,
      codecConfig,
      timescale: 1000000000,
      duration: String(context.duration || 0),
      width: video ? numberField(video, "PixelWidth") || 0 : 0,
      height: video ? numberField(video, "PixelHeight") || 0 : 0,
      channelCount: channels,
      sampleRate: codec === "A_OPUS" ? 48000 : samplingFrequency,
      sampleCount: 0,
      defaultDuration,
      sampleEntry: entry.fields,
      warnings: []
    };
  });
}

async function buildWebmSamples(reader, topBoxes, tracks, context, warnings, onProgress) {
  const rows = [];
  const trackByNumber = new Map(tracks.map((track) => [track.trackId, track]));
  const sampleIndexByTrack = new Map(tracks.map((track) => [track.trackId, 0]));
  const clusters = context.allNodes.filter((node) => node.type === "Cluster");
  let clusterIndex = 0;
  for (const cluster of clusters) {
    clusterIndex += 1;
    const clusterTimecode = numberField(cluster, "Timecode") || 0;
    const blocks = collectBlockNodes(cluster, []);
    for (const block of blocks) {
      const blockInfo = block.fields.trackNumber ? block.fields : await readBlockInfo(reader, block);
      if (!blockInfo || !blockInfo.trackNumber) continue;
      const track = trackByNumber.get(blockInfo.trackNumber);
      if (!track) {
        warnings.push("WebM block references unknown track " + blockInfo.trackNumber + ".");
        continue;
      }
      const baseTimeNs = Math.round((clusterTimecode + blockInfo.timecode) * context.timecodeScale);
      const payloadBytes = await reader.readRange(BigInt(blockInfo.payloadOffset), BigInt(blockInfo.payloadSize));
      const frames = splitLacedFrames(payloadBytes, blockInfo.lacing);
      let localTimeNs = baseTimeNs;
      for (let frameIndex = 0; frameIndex < frames.length; frameIndex += 1) {
        const frame = frames[frameIndex];
        const sampleIndex = (sampleIndexByTrack.get(track.trackId) || 0) + 1;
        sampleIndexByTrack.set(track.trackId, sampleIndex);
        const duration = getWebmFrameDuration(track, frame.bytes);
        const sampleDescription = describeWebmSample(track, blockInfo, frame.bytes);
        rows.push({
          trackId: track.trackId,
          sampleIndex,
          offset: String(blockInfo.payloadOffset + frame.offset),
          size: frame.size,
          dts: localTimeNs,
          pts: localTimeNs,
          duration,
          isSync: track.handlerType === "vide" ? Boolean(blockInfo.keyframe) : true,
          frameType: sampleDescription.frameType,
          nalTypes: sampleDescription.nalTypes,
          chunkIndex: clusterIndex,
          fragmentIndex: "",
          warnings: sampleDescription.warnings
        });
        localTimeNs += duration;
      }
    }
    onProgress("Parsing WebM blocks", Math.min(95, Math.round(clusterIndex * 100 / Math.max(1, clusters.length))));
  }
  return rows.sort((left, right) => {
    if (left.trackId !== right.trackId) return left.trackId - right.trackId;
    return left.sampleIndex - right.sampleIndex;
  });
}

function collectBlockNodes(node, result) {
  if (node.type === "SimpleBlock" || node.type === "Block") result.push(node);
  for (const child of node.children || []) collectBlockNodes(child, result);
  return result;
}

async function readBlockInfo(reader, block) {
  const dataOffsetBig = block.offsetBig + BigInt(block.headerSize);
  const dataSize = Number(block.sizeBig - BigInt(block.headerSize));
  const bytes = await reader.readRange(dataOffsetBig, BigInt(Math.min(dataSize, 64)));
  return parseBlockHeader(bytes, Number(dataOffsetBig), dataSize);
}

function parseBlockHeader(bytes, dataOffset, totalDataSize) {
  const trackNumber = readEbmlSize(bytes, 0);
  if (!trackNumber || trackNumber.value <= 0n) return {};
  const timecodeOffset = trackNumber.length;
  if (timecodeOffset + 3 > bytes.byteLength) return {};
  const timecode = readInt16Be(bytes, timecodeOffset);
  const flags = bytes[timecodeOffset + 2];
  const headerSize = trackNumber.length + 3;
  const payloadOffset = dataOffset + headerSize;
  return {
    trackNumber: Number(trackNumber.value),
    timecode,
    flags,
    keyframe: Boolean(flags & 0x80),
    invisible: Boolean(flags & 0x08),
    lacing: (flags >> 1) & 0x03,
    discardable: Boolean(flags & 0x01),
    payloadOffset,
    payloadSize: Math.max(0, totalDataSize - headerSize)
  };
}

function splitLacedFrames(payload, lacing) {
  if (!lacing) return [{ offset: 0, size: payload.byteLength, bytes: payload }];
  if (payload.byteLength < 1) return [];
  const frameCount = payload[0] + 1;
  if (frameCount <= 1) return [{ offset: 1, size: payload.byteLength - 1, bytes: payload.subarray(1) }];
  if (lacing === 1) return splitXiphLacing(payload, frameCount);
  if (lacing === 2) return splitFixedLacing(payload, frameCount);
  if (lacing === 3) return splitEbmlLacing(payload, frameCount);
  return [{ offset: 0, size: payload.byteLength, bytes: payload }];
}

function splitXiphLacing(payload, frameCount) {
  let offset = 1;
  const sizes = [];
  for (let index = 0; index < frameCount - 1; index += 1) {
    let size = 0;
    while (offset < payload.byteLength) {
      const value = payload[offset];
      offset += 1;
      size += value;
      if (value !== 255) break;
    }
    sizes.push(size);
  }
  const consumed = sizes.reduce((sum, value) => sum + value, 0);
  sizes.push(Math.max(0, payload.byteLength - offset - consumed));
  return buildLacedFrames(payload, offset, sizes);
}

function splitFixedLacing(payload, frameCount) {
  const dataOffset = 1;
  const size = Math.floor((payload.byteLength - dataOffset) / frameCount);
  return buildLacedFrames(payload, dataOffset, Array(frameCount).fill(size));
}

function splitEbmlLacing(payload, frameCount) {
  let offset = 1;
  const firstSize = readEbmlSize(payload, offset);
  if (!firstSize) return [{ offset: 1, size: payload.byteLength - 1, bytes: payload.subarray(1) }];
  offset += firstSize.length;
  const sizes = [Number(firstSize.value)];
  for (let index = 1; index < frameCount - 1; index += 1) {
    const signed = readSignedEbmlSize(payload, offset);
    if (!signed) break;
    offset += signed.length;
    sizes.push(sizes[sizes.length - 1] + signed.value);
  }
  const consumed = sizes.reduce((sum, value) => sum + value, 0);
  sizes.push(Math.max(0, payload.byteLength - offset - consumed));
  return buildLacedFrames(payload, offset, sizes);
}

function buildLacedFrames(payload, dataOffset, sizes) {
  const frames = [];
  let offset = dataOffset;
  for (const size of sizes) {
    const safeSize = Math.max(0, Math.min(size, payload.byteLength - offset));
    frames.push({ offset, size: safeSize, bytes: payload.subarray(offset, offset + safeSize) });
    offset += safeSize;
  }
  return frames;
}

function readSignedEbmlSize(bytes, offset) {
  const size = readEbmlSize(bytes, offset);
  if (!size) return null;
  const bias = (1 << (7 * size.length - 1)) - 1;
  return { value: Number(size.value) - bias, length: size.length };
}

function getWebmFrameDuration(track, bytes) {
  if (track.codec === "A_OPUS") {
    const opusPacket = parseOpusPacket(bytes);
    return Math.round(opusPacket.durationSamples * 1000000000 / 48000);
  }
  return track.defaultDuration || 0;
}

function describeWebmSample(track, blockInfo, bytes) {
  if (track.codec === "V_AV1") {
    const parsedSample = parseAv1Sample(bytes, { defaultFrameType: blockInfo.keyframe ? "I" : "P" });
    return {
      frameType: parsedSample.frameType,
      nalTypes: parsedSample.nalTypes,
      warnings: parsedSample.warnings || []
    };
  }
  if (track.codec === "A_OPUS") {
    const packet = parseOpusPacket(bytes);
    return {
      frameType: "Opus",
      nalTypes: ["Opus", packet.mode, packet.bandwidth, packet.frameCount + " frames"],
      warnings: []
    };
  }
  if (track.handlerType === "vide") {
    return {
      frameType: blockInfo.keyframe ? "I" : "P",
      nalTypes: [track.codec],
      warnings: []
    };
  }
  if (track.handlerType === "soun") {
    return {
      frameType: "audio",
      nalTypes: [track.codec],
      warnings: []
    };
  }
  return { frameType: "", nalTypes: [track.codec], warnings: [] };
}

function numberField(node, childType) {
  const child = findChild(node, childType);
  if (!child) return 0;
  return Number(child.fields.value || 0);
}

function stringField(node, childType) {
  const child = findChild(node, childType);
  return child ? String(child.fields.value || "") : "";
}

function findChild(node, type) {
  return (node.children || []).find((child) => child.type === type) || null;
}

function flattenNodes(nodes, result) {
  for (const node of nodes) {
    result.push(node);
    flattenNodes(node.children || [], result);
  }
  return result;
}

function readUnsignedInteger(bytes) {
  let value = 0n;
  for (let index = 0; index < bytes.byteLength; index += 1) value = (value << 8n) + BigInt(bytes[index]);
  return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value.toString();
}

function readFloat(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength === 4) return view.getFloat32(0, false);
  if (bytes.byteLength === 8) return view.getFloat64(0, false);
  return 0;
}

function readInt16Be(bytes, offset) {
  const value = (bytes[offset] << 8) | bytes[offset + 1];
  return value & 0x8000 ? value - 0x10000 : value;
}

function decodeAscii(bytes) {
  let text = "";
  for (let index = 0; index < bytes.byteLength; index += 1) {
    if (!bytes[index]) break;
    text += String.fromCharCode(bytes[index]);
  }
  return text;
}
