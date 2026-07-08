import { ByteCursor, hexByte } from "../../common/binary.js";
import { BitReader, removeEmulationPreventionBytes } from "../../common/bitstream.js";

const HEVC_IRAP_NAL_TYPES = new Set([16, 17, 18, 19, 20, 21, 22, 23]);

function parseHevcC(bytes) {
  const cursor = new ByteCursor(bytes);
  if (cursor.length < 23) return { error: "hvcC too short" };
  const profileTierByte = cursor.uint8(1);
  const generalProfileSpace = profileTierByte >> 6;
  const generalTierFlag = Boolean(profileTierByte & 0x20);
  const generalProfileIdc = profileTierByte & 0x1f;
  const generalProfileCompatibilityFlags = cursor.uint32(2);
  let constraintHex = "";
  for (let offset = 6; offset < 12; offset += 1) constraintHex += hexByte(cursor.uint8(offset));
  const generalLevelIdc = cursor.uint8(12);
  const minSpatialSegmentationIdc = cursor.uint16(13) & 0x0fff;
  const parallelismType = cursor.uint8(15) & 0x03;
  const chromaFormat = cursor.uint8(16) & 0x03;
  const bitDepthLuma = (cursor.uint8(17) & 0x07) + 8;
  const bitDepthChroma = (cursor.uint8(18) & 0x07) + 8;
  const averageFrameRate = cursor.uint16(19);
  const packed = cursor.uint8(21);
  const constantFrameRate = packed >> 6;
  const numTemporalLayers = (packed >> 3) & 0x07;
  const temporalIdNested = Boolean(packed & 0x04);
  const nalLengthSize = (packed & 0x03) + 1;
  const arrayCount = cursor.uint8(22);
  const arrays = [];
  let offset = 23;
  for (let arrayIndex = 0; arrayIndex < arrayCount && offset + 3 <= cursor.length; arrayIndex += 1) {
    const arrayHeader = cursor.uint8(offset);
    offset += 1;
    const arrayCompleteness = Boolean(arrayHeader & 0x80);
    const nalUnitType = arrayHeader & 0x3f;
    const nalUnitCount = cursor.uint16(offset);
    offset += 2;
    const nalUnits = [];
    for (let nalIndex = 0; nalIndex < nalUnitCount && offset + 2 <= cursor.length; nalIndex += 1) {
      const nalUnitLength = cursor.uint16(offset);
      offset += 2;
      if (offset + nalUnitLength > cursor.length) break;
      nalUnits.push({
        length: nalUnitLength,
        previewHex: Array.from(cursor.bytesAt(offset, Math.min(nalUnitLength, 12))).map(hexByte).join("")
      });
      offset += nalUnitLength;
    }
    arrays.push({ arrayCompleteness, nalUnitType, nalUnitTypeName: hevcNalTypeName(nalUnitType), nalUnitCount: nalUnits.length, nalUnits });
  }
  return {
    configurationVersion: cursor.uint8(0),
    codecString: "hvc1.profile" + generalProfileIdc + ".L" + generalLevelIdc,
    generalProfileSpace,
    generalTierFlag,
    generalProfileIdc,
    generalProfileCompatibilityFlags,
    generalConstraintIndicatorFlags: constraintHex,
    generalLevelIdc,
    minSpatialSegmentationIdc,
    parallelismType,
    chromaFormat,
    bitDepthLuma,
    bitDepthChroma,
    averageFrameRate,
    constantFrameRate,
    numTemporalLayers,
    temporalIdNested,
    nalLengthSize,
    arrayCount: arrays.length,
    arrays
  };
}

function hevcNalTypeName(type) {
  const names = {
    0: "TRAIL_N",
    1: "TRAIL_R",
    2: "TSA_N",
    3: "TSA_R",
    4: "STSA_N",
    5: "STSA_R",
    6: "RADL_N",
    7: "RADL_R",
    8: "RASL_N",
    9: "RASL_R",
    16: "BLA_W_LP",
    17: "BLA_W_RADL",
    18: "BLA_N_LP",
    19: "IDR_W_RADL",
    20: "IDR_N_LP",
    21: "CRA_NUT",
    32: "VPS",
    33: "SPS",
    34: "PPS",
    35: "AUD",
    39: "PREFIX_SEI",
    40: "SUFFIX_SEI"
  };
  return names[type] || "NAL " + type;
}

function parseHevcSample(bytes, nalLengthSize) {
  const nalTypes = [];
  const frameTypes = [];
  let hasIrap = false;
  let offset = 0;
  while (offset + nalLengthSize <= bytes.byteLength) {
    let nalLength = 0;
    for (let index = 0; index < nalLengthSize; index += 1) {
      nalLength = (nalLength << 8) | bytes[offset + index];
    }
    offset += nalLengthSize;
    if (!nalLength || offset + nalLength > bytes.byteLength || nalLength < 2) break;
    const nalUnitType = (bytes[offset] >> 1) & 0x3f;
    nalTypes.push(hevcNalTypeName(nalUnitType));
    if (HEVC_IRAP_NAL_TYPES.has(nalUnitType)) hasIrap = true;
    if (nalUnitType <= 31) {
      try {
        const rbsp = removeEmulationPreventionBytes(bytes.subarray(offset + 2, offset + nalLength));
        const bitReader = new BitReader(rbsp);
        bitReader.readBit();
        if (HEVC_IRAP_NAL_TYPES.has(nalUnitType)) bitReader.readBit();
        bitReader.readUE();
        const sliceType = bitReader.readUE();
        frameTypes.push(classifyHevcSliceType(sliceType));
      } catch (error) {
        if (HEVC_IRAP_NAL_TYPES.has(nalUnitType)) frameTypes.push("I");
      }
    }
    offset += nalLength;
  }
  const uniqueTypes = Array.from(new Set(frameTypes.filter(Boolean)));
  let frameType = "unknown";
  if (uniqueTypes.length === 1) frameType = uniqueTypes[0];
  else if (uniqueTypes.length > 1) frameType = "mixed(" + uniqueTypes.join("/") + ")";
  else if (hasIrap) frameType = "I";
  return { frameType, nalTypes };
}

function classifyHevcSliceType(sliceType) {
  if (sliceType === 0) return "B";
  if (sliceType === 1) return "P";
  if (sliceType === 2) return "I";
  return "unknown";
}

const hevcVideoCodec = {
  id: "hevc",
  label: "HEVC / H.265",
  kind: "video",
  sampleEntryTypes: ["hvc1", "hev1"],
  configurationBoxTypes: ["hvcC"],
  parseConfiguration: parseHevcC,
  getSampleContext(track) {
    return track && track.codecConfig && track.codecConfig.nalLengthSize
      ? { nalLengthSize: track.codecConfig.nalLengthSize }
      : null;
  },
  parseSample(bytes, context) {
    return parseHevcSample(bytes, context.nalLengthSize);
  },
  getNalTypeName: hevcNalTypeName
};

export {
  hevcVideoCodec,
  parseHevcC,
  parseHevcSample,
  hevcNalTypeName
};
