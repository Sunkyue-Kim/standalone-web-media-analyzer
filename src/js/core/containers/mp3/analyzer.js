import { BlobRangeReader } from "../../common/binary.js";
import { parseMp3FrameHeader, readId3v2Header } from "../../codecs/audio/mp3.js";

const MP3_SCAN_CHUNK_BYTES = 512 * 1024;

export const mp3Container = {
  id: "mp3",
  label: "MP3 / MPEG Audio",
  async canAnalyze(file) {
    const bytes = new Uint8Array(await file.slice(0, Math.min(file.size, 64)).arrayBuffer());
    const lowerName = String(file.name || "").toLowerCase();
    const declaredMp3 = lowerName.endsWith(".mp3") || file.type === "audio/mpeg" || file.type === "audio/mp3";
    const id3 = readId3v2Header(bytes);
    if (id3) return true;
    const firstFrame = parseMp3FrameHeader(bytes, 0);
    if (!firstFrame) return false;
    if (declaredMp3) return true;
    const secondOffset = firstFrame.frameLength;
    if (secondOffset + 4 > bytes.byteLength) return false;
    return Boolean(parseMp3FrameHeader(bytes, secondOffset));
  },
  analyzeFile: analyzeMp3File
};

async function analyzeMp3File(file, options) {
  const onProgress = options && options.onProgress ? options.onProgress : function () {};
  const warnings = [];
  const reader = new BlobRangeReader(file);
  const firstBytes = await reader.readRange(0n, BigInt(Math.min(file.size, 4096)));
  const id3 = readId3v2Header(firstBytes);
  let offset = id3 ? id3.size : 0;
  const topBoxes = [];
  if (id3) {
    topBoxes.push(createNode({
      type: "ID3v2",
      path: "/ID3v2",
      offset: 0,
      size: id3.size,
      headerSize: 10,
      fields: id3
    }));
  }

  onProgress("Parsing MPEG audio frames", 15);
  const rows = [];
  let sampleRate = 0;
  let channelCount = 0;
  let version = "";
  let layer = "";
  let bitrateSum = 0;
  let dts = 0;
  let frameIndex = 0;
  let searchOffset = offset;
  while (searchOffset + 4 <= file.size) {
    if (reader.cancelled) throw new Error("Analysis cancelled.");
    const readLength = Math.min(MP3_SCAN_CHUNK_BYTES, file.size - searchOffset);
    const chunk = await reader.readRange(BigInt(searchOffset), BigInt(readLength));
    let localOffset = findMp3Frame(chunk, 0, chunk.byteLength);
    if (localOffset < 0) break;
    while (localOffset + 4 <= chunk.byteLength) {
      const frameOffset = searchOffset + localOffset;
      const header = parseMp3FrameHeader(chunk, localOffset);
      if (!header || frameOffset + header.frameLength > file.size) {
        localOffset += 1;
        continue;
      }
      if (isMp3InfoFrame(chunk, localOffset, header)) {
        localOffset += header.frameLength;
        continue;
      }
      frameIndex += 1;
      if (!sampleRate) {
        sampleRate = header.samplingRate;
        channelCount = header.channelCount;
        version = header.version;
        layer = header.layer;
      }
      bitrateSum += header.bitrateKbps;
      rows.push({
        trackId: 1,
        sampleIndex: frameIndex,
        offset: String(frameOffset),
        size: header.frameLength,
        dts,
        pts: dts,
        duration: header.samplesPerFrame,
        isSync: true,
        frameType: "MP3",
        nalTypes: [header.version + " " + header.layer, header.bitrateKbps + " kbps"],
        chunkIndex: "",
        fragmentIndex: "",
        warnings: []
      });
      dts += header.samplesPerFrame;
      localOffset += header.frameLength;
      if (frameIndex % 200 === 0) onProgress("Parsing MPEG audio frames", Math.min(95, Math.round(frameOffset * 100 / file.size)));
    }
    const nextOffset = rows.length ? Number(rows[rows.length - 1].offset) + rows[rows.length - 1].size : searchOffset + readLength;
    if (nextOffset <= searchOffset) break;
    searchOffset = nextOffset;
  }

  if (!rows.length) warnings.push("No MPEG audio frames found.");
  const track = {
    trackId: 1,
    handlerType: "soun",
    codec: "mp3",
    codecDescriptor: "mp3",
    timescale: sampleRate || 44100,
    duration: String(dts),
    width: 0,
    height: 0,
    channelCount,
    sampleRate,
    sampleCount: rows.length,
    codecConfig: {
      codecString: "mp3",
      audioObjectTypeName: (version + " " + layer).trim() || "MPEG Audio",
      channelDescription: channelCount ? channelCount + (channelCount === 1 ? " channel" : " channels") : "audio",
      samplingFrequency: sampleRate,
      averageBitrate: rows.length ? Math.round(bitrateSum * 1000 / rows.length) : 0
    },
    sampleEntry: null,
    warnings: []
  };

  topBoxes.push(createNode({
    type: "MPEGAudioStream",
    path: "/MPEGAudioStream",
    offset,
    size: Math.max(0, file.size - offset),
    headerSize: 0,
    fields: {
      frameCount: rows.length,
      sampleRate,
      channelCount,
      version,
      layer,
      averageBitrate: track.codecConfig.averageBitrate
    }
  }));

  const id3v1 = await readId3v1Node(reader, file.size);
  if (id3v1) topBoxes.push(id3v1);

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

function findMp3Frame(bytes, start, end) {
  for (let offset = start; offset + 4 <= end; offset += 1) {
    if (parseMp3FrameHeader(bytes, offset)) return offset;
  }
  return -1;
}

function isMp3InfoFrame(bytes, offset, header) {
  if (header.layer !== "Layer III") return false;
  const crcBytes = header.protectionAbsent ? 0 : 2;
  const sideInfoBytes = header.versionBits === 3
    ? (header.channelCount === 1 ? 17 : 32)
    : (header.channelCount === 1 ? 9 : 17);
  const markerOffset = offset + 4 + crcBytes + sideInfoBytes;
  if (markerOffset + 4 > bytes.byteLength) return false;
  const marker = ascii(bytes, markerOffset, 4);
  return marker === "Xing" || marker === "Info";
}

async function readId3v1Node(reader, fileSize) {
  if (fileSize < 128) return null;
  const offset = fileSize - 128;
  const bytes = await reader.readRange(BigInt(offset), 128n);
  if (String.fromCharCode(bytes[0], bytes[1], bytes[2]) !== "TAG") return null;
  return createNode({
    type: "ID3v1",
    path: "/ID3v1",
    offset,
    size: 128,
    headerSize: 3,
    fields: {
      title: ascii(bytes, 3, 30).trim(),
      artist: ascii(bytes, 33, 30).trim(),
      album: ascii(bytes, 63, 30).trim(),
      year: ascii(bytes, 93, 4).trim()
    }
  });
}

function ascii(bytes, offset, length) {
  let text = "";
  for (let index = 0; index < length && offset + index < bytes.byteLength; index += 1) {
    const byte = bytes[offset + index];
    if (!byte) break;
    text += String.fromCharCode(byte);
  }
  return text;
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
