import { BlobRangeReader } from "../../common/binary.js";
import { parseOpusHead, parseOpusPacket } from "../../codecs/audio/opus.js";

export const oggOpusContainer = {
  id: "ogg-opus",
  label: "Ogg Opus",
  async canAnalyze(file) {
    const bytes = new Uint8Array(await file.slice(0, Math.min(file.size, 64)).arrayBuffer());
    return bytes.byteLength >= 36 && ascii(bytes, 0, 4) === "OggS";
  },
  analyzeFile: analyzeOggOpusFile
};

async function analyzeOggOpusFile(file, options) {
  const onProgress = options && options.onProgress ? options.onProgress : function () {};
  const warnings = [];
  const reader = new BlobRangeReader(file);
  const topBoxes = [];
  const rows = [];
  let offset = 0;
  let pageIndex = 0;
  let packetIndex = 0;
  let audioPacketIndex = 0;
  let currentPacketParts = [];
  let currentPacketOffset = 0;
  let track = null;
  let dts = 0;

  while (offset + 27 <= file.size) {
    if (reader.cancelled) throw new Error("Analysis cancelled.");
    const header = await reader.readRange(BigInt(offset), 27n);
    if (ascii(header, 0, 4) !== "OggS") break;
    const pageSegments = header[26];
    const segmentTable = await reader.readRange(BigInt(offset + 27), BigInt(pageSegments));
    const payloadSize = Array.from(segmentTable).reduce((sum, value) => sum + value, 0);
    const payloadOffset = offset + 27 + pageSegments;
    const payload = await reader.readRange(BigInt(payloadOffset), BigInt(payloadSize));
    pageIndex += 1;
    const pageNode = createNode({
      type: "OggPage",
      path: "/OggPage[" + pageIndex + "]",
      offset,
      size: 27 + pageSegments + payloadSize,
      headerSize: 27 + pageSegments,
      fields: {
        version: header[4],
        headerType: header[5],
        granulePosition: readUint64Le(header, 6).toString(),
        serialNumber: readUint32Le(header, 14),
        sequenceNumber: readUint32Le(header, 18),
        pageSegments,
        payloadSize
      }
    });
    topBoxes.push(pageNode);
    let payloadCursor = 0;
    for (let segmentIndex = 0; segmentIndex < pageSegments; segmentIndex += 1) {
      const segmentSize = segmentTable[segmentIndex];
      if (!currentPacketParts.length) currentPacketOffset = payloadOffset + payloadCursor;
      currentPacketParts.push(payload.subarray(payloadCursor, payloadCursor + segmentSize));
      payloadCursor += segmentSize;
      if (segmentSize < 255) {
        const packet = concatParts(currentPacketParts);
        currentPacketParts = [];
        packetIndex += 1;
        if (packetIndex === 1) {
          const opusHead = parseOpusHead(packet);
          if (!opusHead) {
            warnings.push("Ogg stream is not Opus.");
          } else {
            track = createOpusTrack(opusHead);
            pageNode.fields.opusHead = opusHead;
          }
        } else if (packetIndex > 2 && track) {
          const packetInfo = parseOpusPacket(packet);
          audioPacketIndex += 1;
          rows.push({
            trackId: 1,
            sampleIndex: audioPacketIndex,
            offset: String(currentPacketOffset),
            size: packet.byteLength,
            dts,
            pts: dts,
            duration: packetInfo.durationSamples,
            isSync: true,
            frameType: "Opus",
            nalTypes: [packetInfo.mode, packetInfo.bandwidth, packetInfo.frameCount + " frames"],
            chunkIndex: pageIndex,
            fragmentIndex: "",
            warnings: []
          });
          dts += packetInfo.durationSamples;
        }
      }
    }
    offset += 27 + pageSegments + payloadSize;
    if (pageIndex % 20 === 0) onProgress("Parsing Ogg pages", Math.min(95, Math.round(offset * 100 / file.size)));
  }

  if (!track) {
    track = createOpusTrack(null);
    warnings.push("No OpusHead packet found.");
  }
  track.sampleCount = rows.length;
  track.duration = String(dts);
  onProgress("Structure parsed", 100);
  return {
    file: { name: file.name || "unnamed", size: file.size, type: file.type || "" },
    reader,
    topBoxes,
    allBoxes: flattenNodes(topBoxes, []),
    tracks: [track],
    sampleRows: rows,
    warnings
  };
}

function createOpusTrack(opusHead) {
  const channelCount = opusHead ? opusHead.channelCount : 0;
  return {
    trackId: 1,
    handlerType: "soun",
    codec: "opus",
    codecDescriptor: "opus",
    timescale: 48000,
    duration: "0",
    width: 0,
    height: 0,
    channelCount,
    sampleRate: 48000,
    sampleCount: 0,
    codecConfig: opusHead || {
      codecString: "opus",
      audioObjectTypeName: "Opus",
      channelDescription: "audio",
      samplingFrequency: 48000
    },
    sampleEntry: null,
    warnings: []
  };
}

function concatParts(parts) {
  const length = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

function ascii(bytes, offset, length) {
  let text = "";
  for (let index = 0; index < length && offset + index < bytes.byteLength; index += 1) {
    text += String.fromCharCode(bytes[offset + index]);
  }
  return text;
}

function readUint32Le(bytes, offset) {
  return (bytes[offset] |
    (bytes[offset + 1] << 8) |
    (bytes[offset + 2] << 16) |
    (bytes[offset + 3] << 24)) >>> 0;
}

function readUint64Le(bytes, offset) {
  let value = 0n;
  for (let index = 7; index >= 0; index -= 1) value = (value << 8n) + BigInt(bytes[offset + index]);
  return value;
}

function createNode({ type, path, offset, size, headerSize, fields }) {
  return {
    type,
    path,
    offset: String(offset),
    offsetBig: BigInt(offset),
    size: String(size),
    sizeBig: BigInt(size),
    headerSize,
    children: [],
    fields: fields || {},
    warnings: []
  };
}

function flattenNodes(nodes, result) {
  for (const node of nodes) {
    result.push(node);
    flattenNodes(node.children || [], result);
  }
  return result;
}
