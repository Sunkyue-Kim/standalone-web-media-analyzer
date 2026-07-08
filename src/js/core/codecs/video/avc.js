import { ByteCursor, hexByte } from "../../common/binary.js";
import { BitReader, removeEmulationPreventionBytes } from "../../common/bitstream.js";

function parseAvcC(bytes) {
  const cursor = new ByteCursor(bytes);
  if (cursor.length < 7) return { error: "avcC too short" };
  const profile = cursor.uint8(1);
  const compatibility = cursor.uint8(2);
  const level = cursor.uint8(3);
  const nalLengthSize = (cursor.uint8(4) & 0x03) + 1;
  const spsCount = cursor.uint8(5) & 0x1f;
  const sps = [];
  let offset = 6;
  for (let index = 0; index < spsCount && offset + 2 <= cursor.length; index += 1) {
    const length = cursor.uint16(offset);
    offset += 2;
    if (offset + length > cursor.length) break;
    sps.push({ length, previewHex: Array.from(cursor.bytesAt(offset, Math.min(length, 10))).map(hexByte).join("") });
    offset += length;
  }
  let ppsCount = 0;
  const pps = [];
  if (offset < cursor.length) {
    ppsCount = cursor.uint8(offset);
    offset += 1;
    for (let index = 0; index < ppsCount && offset + 2 <= cursor.length; index += 1) {
      const length = cursor.uint16(offset);
      offset += 2;
      if (offset + length > cursor.length) break;
      pps.push({ length, previewHex: Array.from(cursor.bytesAt(offset, Math.min(length, 10))).map(hexByte).join("") });
      offset += length;
    }
  }
  return {
    configurationVersion: cursor.uint8(0),
    profile,
    compatibility,
    level,
    codecString: "avc1." + hexByte(profile) + hexByte(compatibility) + hexByte(level),
    nalLengthSize,
    spsCount: sps.length,
    ppsCount: pps.length,
    sps,
    pps
  };
}

function classifySliceType(sliceType) {
  const normalized = sliceType % 5;
  if (normalized === 0) return "P";
  if (normalized === 1) return "B";
  if (normalized === 2) return "I";
  if (normalized === 3) return "SP";
  if (normalized === 4) return "SI";
  return "unknown";
}

function nalTypeName(type) {
  const names = {
    1: "non-IDR",
    5: "IDR",
    6: "SEI",
    7: "SPS",
    8: "PPS",
    9: "AUD"
  };
  return names[type] || String(type);
}

function parseAvcSample(bytes, nalLengthSize) {
  const nalTypes = [];
  const frameTypes = [];
  let hasIdr = false;
  let offset = 0;
  while (offset + nalLengthSize <= bytes.byteLength) {
    let nalLength = 0;
    for (let index = 0; index < nalLengthSize; index += 1) {
      nalLength = (nalLength << 8) | bytes[offset + index];
    }
    offset += nalLengthSize;
    if (!nalLength || offset + nalLength > bytes.byteLength) break;
    const nalHeader = bytes[offset];
    const nalType = nalHeader & 0x1f;
    nalTypes.push(nalTypeName(nalType));
    if (nalType === 5) hasIdr = true;
    if (nalType === 1 || nalType === 5) {
      try {
        const rbsp = removeEmulationPreventionBytes(bytes.subarray(offset + 1, offset + nalLength));
        const bitReader = new BitReader(rbsp);
        bitReader.readUE();
        const sliceType = bitReader.readUE();
        frameTypes.push(classifySliceType(sliceType));
      } catch (error) {
        if (nalType === 5) frameTypes.push("IDR");
      }
    }
    offset += nalLength;
  }
  const uniqueTypes = Array.from(new Set(frameTypes.filter(Boolean)));
  let frameType = "unknown";
  if (uniqueTypes.length === 1) frameType = uniqueTypes[0];
  else if (uniqueTypes.length > 1) frameType = "mixed(" + uniqueTypes.join("/") + ")";
  else if (hasIdr) frameType = "IDR";
  return { frameType, nalTypes };
}

const avcVideoCodec = {
  id: "avc",
  label: "AVC / H.264",
  kind: "video",
  sampleEntryTypes: ["avc1", "avc2", "avc3", "avc4"],
  configurationBoxTypes: ["avcC"],
  parseConfiguration: parseAvcC,
  getSampleContext(track) {
    return track && track.codecConfig && track.codecConfig.nalLengthSize
      ? { nalLengthSize: track.codecConfig.nalLengthSize }
      : null;
  },
  parseSample(bytes, context) {
    return parseAvcSample(bytes, context.nalLengthSize);
  },
  getNalTypeName: nalTypeName
};

export {
  avcVideoCodec,
  parseAvcC,
  parseAvcSample,
  nalTypeName
};
