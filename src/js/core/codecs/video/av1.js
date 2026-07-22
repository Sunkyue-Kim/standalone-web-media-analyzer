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

const MAX_AV1_OBU_COUNT = 10000;

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
    configOBUBytes: new Uint8Array(configOBUs),
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

function parseAv1SequenceHeader(payload) {
  const bitReader = new BitReader(payload);
  const seqProfile = bitReader.readBits(3);
  const stillPicture = Boolean(bitReader.readBit());
  const reducedStillPictureHeader = Boolean(bitReader.readBit());
  let decoderModelInfoPresent = false;
  let initialDisplayDelayPresent = false;
  let bufferDelayLength = 0;
  let framePresentationTimeLength = 0;
  let equalPictureInterval = false;
  if (reducedStillPictureHeader) {
    bitReader.readBits(5);
  } else {
    const timingInfoPresent = Boolean(bitReader.readBit());
    if (timingInfoPresent) {
      bitReader.readBits(32);
      bitReader.readBits(32);
      equalPictureInterval = Boolean(bitReader.readBit());
      if (equalPictureInterval) bitReader.readUE();
      decoderModelInfoPresent = Boolean(bitReader.readBit());
      if (decoderModelInfoPresent) {
        bufferDelayLength = bitReader.readBits(5) + 1;
        bitReader.readBits(32);
        bitReader.readBits(5);
        framePresentationTimeLength = bitReader.readBits(5) + 1;
      }
    }
    initialDisplayDelayPresent = Boolean(bitReader.readBit());
    const operatingPointsCount = bitReader.readBits(5) + 1;
    for (let index = 0; index < operatingPointsCount; index += 1) {
      bitReader.readBits(12);
      const sequenceLevelIndex = bitReader.readBits(5);
      if (sequenceLevelIndex > 7) bitReader.readBit();
      if (decoderModelInfoPresent) {
        const decoderModelPresentForPoint = Boolean(bitReader.readBit());
        if (decoderModelPresentForPoint) {
          bitReader.readBits(bufferDelayLength);
          bitReader.readBits(bufferDelayLength);
          bitReader.readBit();
        }
      }
      if (initialDisplayDelayPresent && bitReader.readBit()) bitReader.readBits(4);
    }
  }
  const frameWidthBits = bitReader.readBits(4) + 1;
  const frameHeightBits = bitReader.readBits(4) + 1;
  const maximumFrameWidth = bitReader.readBits(frameWidthBits) + 1;
  const maximumFrameHeight = bitReader.readBits(frameHeightBits) + 1;
  const frameIdNumbersPresent = reducedStillPictureHeader ? false : Boolean(bitReader.readBit());
  let deltaFrameIdLengthMinus2 = 0;
  let additionalFrameIdLengthMinus1 = 0;
  if (frameIdNumbersPresent) {
    deltaFrameIdLengthMinus2 = bitReader.readBits(4);
    additionalFrameIdLengthMinus1 = bitReader.readBits(3);
  }
  const use128x128Superblock = Boolean(bitReader.readBit());
  bitReader.readBit();
  bitReader.readBit();
  let seqForceScreenContentTools = 2;
  let seqForceIntegerMv = 2;
  let orderHintBits = 0;
  if (!reducedStillPictureHeader) {
    bitReader.readBit();
    bitReader.readBit();
    bitReader.readBit();
    bitReader.readBit();
    const enableOrderHint = Boolean(bitReader.readBit());
    if (enableOrderHint) {
      bitReader.readBit();
      bitReader.readBit();
    }
    const seqChooseScreenContentTools = Boolean(bitReader.readBit());
    if (!seqChooseScreenContentTools) seqForceScreenContentTools = bitReader.readBit();
    if (seqForceScreenContentTools > 0) {
      const seqChooseIntegerMv = Boolean(bitReader.readBit());
      if (!seqChooseIntegerMv) seqForceIntegerMv = bitReader.readBit();
    }
    if (enableOrderHint) orderHintBits = bitReader.readBits(3) + 1;
  }
  const enableSuperres = Boolean(bitReader.readBit());
  return {
    seqProfile,
    stillPicture,
    reducedStillPictureHeader,
    maximumFrameWidth,
    maximumFrameHeight,
    frameWidthBits,
    frameHeightBits,
    frameIdNumbersPresent,
    deltaFrameIdLengthMinus2,
    additionalFrameIdLengthMinus1,
    decoderModelInfoPresent,
    equalPictureInterval,
    framePresentationTimeLength,
    seqForceScreenContentTools,
    seqForceIntegerMv,
    orderHintBits,
    enableSuperres,
    use128x128Superblock,
    superblockSize: use128x128Superblock ? 128 : 64,
    bitsRead: bitReader.bitOffset
  };
}

function parseAv1FrameSizeOverrideFlag(payload, sequenceHeader) {
  if (sequenceHeader.reducedStillPictureHeader) return false;
  const bitReader = new BitReader(payload);
  const showExistingFrame = Boolean(bitReader.readBit());
  if (showExistingFrame) return null;
  const frameType = bitReader.readBits(2);
  const showFrame = Boolean(bitReader.readBit());
  if (showFrame && sequenceHeader.decoderModelInfoPresent && !sequenceHeader.equalPictureInterval) {
    bitReader.readBits(sequenceHeader.framePresentationTimeLength);
  }
  if (!showFrame) bitReader.readBit();
  if (frameType !== 3 && !(frameType === 0 && showFrame)) bitReader.readBit();
  bitReader.readBit();
  let allowScreenContentTools = sequenceHeader.seqForceScreenContentTools;
  if (allowScreenContentTools === 2) allowScreenContentTools = bitReader.readBit();
  if (allowScreenContentTools) {
    if (sequenceHeader.seqForceIntegerMv === 2) bitReader.readBit();
  }
  if (sequenceHeader.frameIdNumbersPresent) {
    const frameIdLength = sequenceHeader.additionalFrameIdLengthMinus1 + sequenceHeader.deltaFrameIdLengthMinus2 + 3;
    bitReader.readBits(frameIdLength);
  }
  return frameType === 3 ? true : Boolean(bitReader.readBit());
}

function getAv1ObuPayloads(bytes) {
  const payloads = [];
  let offset = 0;
  while (offset < bytes.byteLength) {
    if (payloads.length >= MAX_AV1_OBU_COUNT) {
      throw new Error("AV1 sample exceeds the 10,000-OBU safety limit.");
    }
    const obuOffset = offset;
    const header = parseAv1ObuHeader(bytes, offset);
    if (!header) break;
    offset += header.headerSize;
    let payloadSize = bytes.byteLength - offset;
    let sizeFieldLength = 0;
    if (header.hasSizeField) {
      const leb128 = readLeb128(bytes, offset);
      if (!leb128) break;
      payloadSize = Number(leb128.value);
      sizeFieldLength = leb128.length;
      offset += sizeFieldLength;
    }
    if (!Number.isSafeInteger(payloadSize) || payloadSize < 0 || offset + payloadSize > bytes.byteLength) break;
    payloads.push({
      ...header,
      obuOffset,
      payloadOffset: offset,
      payloadSize,
      sizeFieldLength,
      payload: bytes.subarray(offset, offset + payloadSize)
    });
    offset += payloadSize;
    if (!header.hasSizeField) break;
  }
  return payloads;
}

function createAv1RootBlocks(width, height, superblockSize) {
  const columns = Math.max(1, Math.ceil(width / superblockSize));
  const rows = Math.max(1, Math.ceil(height / superblockSize));
  if (columns * rows > 100000) throw new Error("AV1 superblock grid exceeds the 100,000-cell safety limit.");
  const roots = [];
  for (let rowIndex = 0; rowIndex < rows; rowIndex += 1) {
    for (let columnIndex = 0; columnIndex < columns; columnIndex += 1) {
      const index = rowIndex * columns + columnIndex;
      roots.push({
        id: "av1-sb-" + index,
        left: columnIndex * superblockSize,
        top: rowIndex * superblockSize,
        width: Math.min(superblockSize, width - columnIndex * superblockSize),
        height: Math.min(superblockSize, height - rowIndex * superblockSize),
        codedBlockWidth: superblockSize,
        codedBlockHeight: superblockSize,
        depth: 0,
        type: "superblock",
        partitionMode: "root",
        ownBits: null,
        subtreeBits: null,
        children: []
      });
    }
  }
  return { roots, columns, rows };
}

function createAv1UnavailableFrameInternals(sampleBytes, reason, warnings = []) {
  return {
    kind: "unavailable",
    complete: false,
    sampleBits: sampleBytes.byteLength * 8,
    attributedBits: null,
    overheadBits: null,
    reason,
    warnings
  };
}

function parseAv1FrameInternals(sampleBytes, codecConfig, track = {}) {
  let sampleObus;
  let configurationObus;
  try {
    sampleObus = getAv1ObuPayloads(sampleBytes);
    const configurationBytes = codecConfig && codecConfig.configOBUBytes;
    configurationObus = configurationBytes instanceof Uint8Array
      ? getAv1ObuPayloads(configurationBytes)
      : [];
  } catch (error) {
    return createAv1UnavailableFrameInternals(sampleBytes, error.message);
  }
  const sequenceHeaderObu = sampleObus.find((obu) => obu.type === 1) || configurationObus.find((obu) => obu.type === 1);
  if (!sequenceHeaderObu) {
    return createAv1UnavailableFrameInternals(sampleBytes, "AV1 sequence header OBU is unavailable.");
  }
  let sequenceHeader;
  try {
    sequenceHeader = parseAv1SequenceHeader(sequenceHeaderObu.payload);
  } catch (error) {
    return createAv1UnavailableFrameInternals(
      sampleBytes,
      "AV1 sequence header is truncated: " + error.message
    );
  }
  const frameObu = sampleObus.find((obu) => obu.type === 3 || obu.type === 6 || obu.type === 7);
  if (!frameObu) {
    return createAv1UnavailableFrameInternals(
      sampleBytes,
      "The AV1 sample does not contain a frame header or frame OBU."
    );
  }
  if (!sequenceHeader.reducedStillPictureHeader) {
    try {
      const frameHeaderReader = new BitReader(frameObu.payload);
      if (frameHeaderReader.readBit()) {
        return createAv1UnavailableFrameInternals(
          sampleBytes,
          "show_existing_frame carries no coded block tree in this sample."
        );
      }
    } catch (error) {
      return createAv1UnavailableFrameInternals(
        sampleBytes,
        "AV1 frame header is truncated: " + error.message
      );
    }
  }
  let frameSizeOverrideFlag;
  try {
    frameSizeOverrideFlag = parseAv1FrameSizeOverrideFlag(frameObu.payload, sequenceHeader);
  } catch (error) {
    return createAv1UnavailableFrameInternals(
      sampleBytes,
      "AV1 frame size flags are truncated: " + error.message
    );
  }
  if (frameSizeOverrideFlag || sequenceHeader.enableSuperres) {
    return createAv1UnavailableFrameInternals(
      sampleBytes,
      frameSizeOverrideFlag
        ? "The AV1 frame overrides the sequence dimensions; exact frame-size traversal is not implemented."
        : "AV1 super-resolution can change the coded block grid; exact super-resolution traversal is not implemented."
    );
  }
  const width = sequenceHeader.maximumFrameWidth;
  const height = sequenceHeader.maximumFrameHeight;
  let rootLayout;
  try {
    rootLayout = createAv1RootBlocks(width, height, sequenceHeader.superblockSize);
  } catch (error) {
    return createAv1UnavailableFrameInternals(sampleBytes, error.message);
  }
  return {
    kind: "av1-frame-internals",
    complete: true,
    granularity: "root-units",
    codecFamily: "AV1",
    unitName: "superblock",
    unitWidth: sequenceHeader.superblockSize,
    unitHeight: sequenceHeader.superblockSize,
    codedWidth: rootLayout.columns * sequenceHeader.superblockSize,
    codedHeight: rootLayout.rows * sequenceHeader.superblockSize,
    width,
    height,
    columns: rootLayout.columns,
    rows: rootLayout.rows,
    roots: rootLayout.roots,
    structureRecordCount: rootLayout.roots.length,
    decodedStructureRecordCount: rootLayout.roots.length,
    sampleBits: sampleBytes.byteLength * 8,
    attributedBits: null,
    overheadBits: null,
    sequenceHeader,
    warnings: ["AV1 entropy-coded child partitions are not decoded; only exact sequence-signaled superblock roots are shown."]
  };
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
  parseFrameInternals(sampleBytes, codecConfig, track) {
    return parseAv1FrameInternals(sampleBytes, codecConfig, track);
  },
  getNalTypeName: av1ObuTypeName
};

export {
  av1VideoCodec,
  parseAv1C,
  parseAv1Sample,
  parseAv1ObuStream,
  parseAv1SequenceHeader,
  parseAv1FrameSizeOverrideFlag,
  parseAv1FrameInternals,
  createAv1RootBlocks,
  av1ObuTypeName
};
