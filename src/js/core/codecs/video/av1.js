import { ByteCursor, hexByte } from "../../common/binary.js";
import { BitReader } from "../../common/bitstream.js";

const AV1_OBU_TYPES = {
  1: "Sequence Header",
  2: "Temporal Delimiter",
  3: "Frame Header",
  4: "Tile Group",
  5: "Metadata",
  6: "Frame",
  7: "Redundant Frame Header",
  8: "Tile List",
  15: "Padding"
};

const AV1_FRAME_TYPES = {
  0: { label: "KEY_FRAME", frameType: "I" },
  1: { label: "INTER_FRAME", frameType: "P" },
  2: { label: "INTRA_ONLY_FRAME", frameType: "I" },
  3: { label: "SWITCH_FRAME", frameType: "P" }
};

function parseAv1C(bytes) {
  const cursor = new ByteCursor(bytes);
  if (cursor.length < 4) return { error: "av1C too short" };
  const firstByte = cursor.uint8(0);
  const secondByte = cursor.uint8(1);
  const thirdByte = cursor.uint8(2);
  const fourthByte = cursor.uint8(3);
  const seqProfile = secondByte >> 5;
  const seqLevelIdx0 = secondByte & 0x1f;
  const seqTier0 = Boolean(thirdByte & 0x80);
  const highBitdepth = Boolean(thirdByte & 0x40);
  const twelveBit = Boolean(thirdByte & 0x20);
  const monochrome = Boolean(thirdByte & 0x10);
  const chromaSubsamplingX = Boolean(thirdByte & 0x08);
  const chromaSubsamplingY = Boolean(thirdByte & 0x04);
  const chromaSamplePosition = thirdByte & 0x03;
  const initialPresentationDelayPresent = Boolean(fourthByte & 0x10);
  const configOBUs = cursor.bytesAt(4, cursor.length - 4);
  const parsedObus = parseAv1ObuStream(configOBUs);
  const bitDepth = twelveBit ? 12 : highBitdepth ? 10 : 8;
  return {
    marker: firstByte >> 7,
    version: firstByte & 0x7f,
    codecString: buildAv1CodecString(seqProfile, seqLevelIdx0, seqTier0, bitDepth),
    seqProfile,
    seqLevelIdx0,
    seqTier0,
    highBitdepth,
    twelveBit,
    bitDepth,
    monochrome,
    chromaSubsamplingX,
    chromaSubsamplingY,
    chromaFormat: describeChromaFormat(monochrome, chromaSubsamplingX, chromaSubsamplingY),
    chromaSamplePosition,
    chromaSamplePositionName: chromaSamplePositionName(chromaSamplePosition),
    reserved: fourthByte >> 5,
    initialPresentationDelayPresent,
    initialPresentationDelayMinusOne: initialPresentationDelayPresent ? fourthByte & 0x0f : null,
    configOBUByteLength: configOBUs.byteLength,
    configOBUs: parsedObus.obus,
    warnings: parsedObus.warnings
  };
}

function buildAv1CodecString(seqProfile, seqLevelIdx0, seqTier0, bitDepth) {
  return "av01." + seqProfile + "." + String(seqLevelIdx0).padStart(2, "0") + (seqTier0 ? "H" : "M") +
    "." + String(bitDepth).padStart(2, "0");
}

function describeChromaFormat(monochrome, chromaSubsamplingX, chromaSubsamplingY) {
  if (monochrome) return "monochrome";
  if (chromaSubsamplingX && chromaSubsamplingY) return "4:2:0";
  if (chromaSubsamplingX && !chromaSubsamplingY) return "4:2:2";
  if (!chromaSubsamplingX && !chromaSubsamplingY) return "4:4:4";
  return "4:4:0";
}

function chromaSamplePositionName(value) {
  if (value === 1) return "vertical";
  if (value === 2) return "colocated";
  if (value === 3) return "reserved";
  return "unknown";
}

function parseAv1Sample(bytes, context = {}) {
  const parsedObus = parseAv1ObuStream(bytes);
  const frameTypes = [];
  const nalTypes = [];
  for (const obu of parsedObus.obus) {
    nalTypes.push(obu.typeName);
    if (obu.frameType) frameTypes.push(obu.frameType);
  }
  const uniqueTypes = Array.from(new Set(frameTypes.filter(Boolean)));
  let frameType = "unknown";
  if (uniqueTypes.length === 1) frameType = uniqueTypes[0];
  else if (uniqueTypes.length > 1) frameType = "mixed(" + uniqueTypes.join("/") + ")";
  if (frameType === "unknown" && context && context.defaultFrameType) frameType = context.defaultFrameType;
  return {
    frameType,
    nalTypes: nalTypes.length ? nalTypes : ["AV1"],
    warnings: parsedObus.warnings
  };
}

function parseAv1ObuStream(bytes) {
  const obus = [];
  const warnings = [];
  let offset = 0;
  let guard = 0;
  while (offset < bytes.byteLength) {
    guard += 1;
    if (guard > 10000) {
      warnings.push("Stopped parsing AV1 OBUs after 10000 units.");
      break;
    }
    const header = parseAv1ObuHeader(bytes, offset);
    if (!header) {
      warnings.push("Truncated AV1 OBU header at byte " + offset + ".");
      break;
    }
    offset += header.headerSize;
    let payloadSize = bytes.byteLength - offset;
    let leb128Size = 0;
    if (header.hasSizeField) {
      const leb128 = readLeb128(bytes, offset);
      if (!leb128) {
        warnings.push("Truncated AV1 OBU size at byte " + offset + ".");
        break;
      }
      payloadSize = Number(leb128.value);
      leb128Size = leb128.length;
      offset += leb128.length;
    }
    if (payloadSize < 0 || offset + payloadSize > bytes.byteLength) {
      warnings.push("AV1 OBU payload exceeds sample bounds at byte " + offset + ".");
      break;
    }
    const payload = bytes.subarray(offset, offset + payloadSize);
    const frameHeader = header.type === 3 || header.type === 6 || header.type === 7
      ? parseAv1FrameHeaderPayload(payload)
      : null;
    obus.push({
      type: header.type,
      typeName: av1ObuTypeName(header.type),
      headerSize: header.headerSize,
      leb128Size,
      size: payloadSize,
      extensionFlag: header.extensionFlag,
      hasSizeField: header.hasSizeField,
      temporalId: header.temporalId,
      spatialId: header.spatialId,
      frameType: frameHeader ? frameHeader.frameType : "",
      frameTypeName: frameHeader ? frameHeader.frameTypeName : "",
      showExistingFrame: frameHeader ? frameHeader.showExistingFrame : false,
      previewHex: Array.from(payload.subarray(0, Math.min(payload.byteLength, 12))).map(hexByte).join("")
    });
    offset += payloadSize;
  }
  return { obus, warnings };
}

function parseAv1ObuHeader(bytes, offset) {
  if (offset >= bytes.byteLength) return null;
  const byte = bytes[offset];
  const type = (byte >> 3) & 0x0f;
  const extensionFlag = Boolean(byte & 0x04);
  const hasSizeField = Boolean(byte & 0x02);
  const header = {
    forbiddenBit: Boolean(byte & 0x80),
    type,
    extensionFlag,
    hasSizeField,
    reservedBit: Boolean(byte & 0x01),
    headerSize: extensionFlag ? 2 : 1,
    temporalId: null,
    spatialId: null
  };
  if (extensionFlag) {
    if (offset + 1 >= bytes.byteLength) return null;
    const extensionByte = bytes[offset + 1];
    header.temporalId = extensionByte >> 5;
    header.spatialId = (extensionByte >> 3) & 0x03;
  }
  return header;
}

function parseAv1FrameHeaderPayload(payload) {
  if (!payload.byteLength) return null;
  try {
    const bitReader = new BitReader(payload);
    const showExistingFrame = Boolean(bitReader.readBit());
    if (showExistingFrame) {
      return {
        showExistingFrame,
        frameTypeName: "show_existing_frame",
        frameType: "P"
      };
    }
    const frameTypeCode = bitReader.readBits(2);
    const type = AV1_FRAME_TYPES[frameTypeCode] || { label: "FRAME_TYPE_" + frameTypeCode, frameType: "unknown" };
    return {
      showExistingFrame,
      frameTypeName: type.label,
      frameType: type.frameType
    };
  } catch (_) {
    return null;
  }
}

function readLeb128(bytes, offset) {
  let value = 0n;
  for (let index = 0; index < 8 && offset + index < bytes.byteLength; index += 1) {
    const byte = bytes[offset + index];
    value |= BigInt(byte & 0x7f) << BigInt(index * 7);
    if (!(byte & 0x80)) return { value, length: index + 1 };
  }
  return null;
}

function av1ObuTypeName(type) {
  return AV1_OBU_TYPES[type] || "OBU " + type;
}

const av1VideoCodec = {
  id: "av1",
  label: "AV1",
  kind: "video",
  sampleEntryTypes: ["av01", "V_AV1"],
  configurationBoxTypes: ["av1C"],
  parseConfiguration: parseAv1C,
  extractTrackConfig(fields) {
    return fields;
  },
  getSampleContext(track) {
    return {
      codecConfig: track && track.codecConfig ? track.codecConfig : null
    };
  },
  parseSample(bytes, context) {
    return parseAv1Sample(bytes, context);
  },
  getNalTypeName: av1ObuTypeName
};

export {
  av1VideoCodec,
  parseAv1C,
  parseAv1Sample,
  parseAv1ObuStream,
  av1ObuTypeName
};
