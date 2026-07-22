/*
 * Native AVC syntax inspection implemented directly from ITU-T H.264 (06/2026).
 * This is an entropy-syntax walker, not a decoder: it does not reconstruct pixels.
 * Normative CABAC/CAVLC table data below is identified by its H.264 table number.
 * Syntax sources: clauses 7.3.2.1, 7.3.2.2, 7.3.3, 7.3.5, 9.2, and 9.3.
 */

const AVC_MACROBLOCK_SIZE = 16;
const MAX_AVC_MACROBLOCKS = 100_000;
const MAX_AVC_STRUCTURE_RECORDS = 100_000;
const MAX_AVC_NAL_UNITS = 65_536;
const MAX_EXP_GOLOMB_LEADING_ZERO_BITS = 31;
const SLICE_TYPE_P = 0;
const SLICE_TYPE_B = 1;
const SLICE_TYPE_I = 2;
const SLICE_TYPE_SP = 3;
const SLICE_TYPE_SI = 4;
const NAL_TYPE_NON_IDR_SLICE = 1;
const NAL_TYPE_IDR_SLICE = 5;
const NAL_TYPE_SPS = 7;
const NAL_TYPE_PPS = 8;

const HIGH_PROFILE_IDS = new Set([
  44, 83, 86, 100, 110, 118, 122, 128, 134, 135, 138, 139, 244
]);

class AvcSyntaxError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "AvcSyntaxError";
    this.code = code;
  }
}

class RbspBitReader {
  constructor(bytes, bitOffset = 0) {
    this.bytes = bytes;
    this.bitOffset = bitOffset;
  }

  get totalBits() {
    return this.bytes.byteLength * 8;
  }

  get bitsRemaining() {
    return this.totalBits - this.bitOffset;
  }

  readBit() {
    if (this.bitOffset >= this.totalBits) {
      throw new AvcSyntaxError("unexpected-end-of-rbsp", "Unexpected end of AVC RBSP.");
    }
    const byte = this.bytes[this.bitOffset >> 3];
    const bit = (byte >> (7 - (this.bitOffset & 7))) & 1;
    this.bitOffset += 1;
    return bit;
  }

  readBits(count) {
    if (!Number.isInteger(count) || count < 0 || count > 32) {
      throw new AvcSyntaxError("invalid-bit-count", "Invalid AVC bit count " + count + ".");
    }
    let value = 0;
    for (let index = 0; index < count; index += 1) {
      value = value * 2 + this.readBit();
    }
    return value;
  }

  skipBits(count) {
    if (!Number.isInteger(count) || count < 0 || count > this.bitsRemaining) {
      throw new AvcSyntaxError("unexpected-end-of-rbsp", "AVC syntax exceeds the available RBSP bits.");
    }
    this.bitOffset += count;
  }

  readUE() {
    let leadingZeroBits = 0;
    while (this.readBit() === 0) {
      leadingZeroBits += 1;
      if (leadingZeroBits > MAX_EXP_GOLOMB_LEADING_ZERO_BITS) {
        throw new AvcSyntaxError("exp-golomb-too-large", "AVC Exp-Golomb value is too large.");
      }
    }
    const suffix = leadingZeroBits ? this.readBits(leadingZeroBits) : 0;
    return (2 ** leadingZeroBits) - 1 + suffix;
  }

  readSE() {
    const codeNum = this.readUE();
    return codeNum & 1 ? (codeNum + 1) / 2 : -(codeNum / 2);
  }

  readTE(maximumValue) {
    if (!Number.isInteger(maximumValue) || maximumValue < 0) {
      throw new AvcSyntaxError("invalid-truncated-exp-golomb-range", "Invalid AVC truncated Exp-Golomb range.");
    }
    if (maximumValue === 0) return 0;
    if (maximumValue === 1) return 1 - this.readBit();
    const value = this.readUE();
    if (value > maximumValue) {
      throw new AvcSyntaxError("truncated-exp-golomb-out-of-range", "AVC truncated Exp-Golomb value exceeds its range.");
    }
    return value;
  }

  alignToByte(expectedBit = null) {
    while (this.bitOffset & 7) {
      const bit = this.readBit();
      if (expectedBit !== null && bit !== expectedBit) {
        throw new AvcSyntaxError(
          "invalid-alignment-bit",
          "AVC alignment bit was " + bit + ", expected " + expectedBit + "."
        );
      }
    }
  }

  moreRbspData() {
    if (this.bitsRemaining <= 0) return false;
    const savedBitOffset = this.bitOffset;
    const firstBit = this.readBit();
    if (firstBit === 0) {
      this.bitOffset = savedBitOffset;
      return true;
    }
    while (this.bitOffset < this.totalBits) {
      if (this.readBit() !== 0) {
        this.bitOffset = savedBitOffset;
        return true;
      }
    }
    this.bitOffset = savedBitOffset;
    return false;
  }
}

function removeEmulationPreventionBytes(bytes) {
  const output = [];
  let consecutiveZeroBytes = 0;
  for (const byte of bytes) {
    if (consecutiveZeroBytes >= 2 && byte === 0x03) {
      consecutiveZeroBytes = 0;
      continue;
    }
    output.push(byte);
    consecutiveZeroBytes = byte === 0 ? consecutiveZeroBytes + 1 : 0;
  }
  return new Uint8Array(output);
}

function readScalingList(bitReader, size) {
  let lastScale = 8;
  let nextScale = 8;
  for (let index = 0; index < size; index += 1) {
    if (nextScale !== 0) nextScale = (lastScale + bitReader.readSE() + 256) % 256;
    if (nextScale !== 0) lastScale = nextScale;
  }
}

function parseSpsNalUnit(nalUnit) {
  const bytes = normalizeBytes(nalUnit);
  if (!bytes.byteLength || (bytes[0] & 0x1f) !== NAL_TYPE_SPS) {
    throw new AvcSyntaxError("not-sps", "AVC parameter-set entry is not an SPS NAL unit.");
  }
  const bitReader = new RbspBitReader(removeEmulationPreventionBytes(bytes.subarray(1)));
  const profileIdc = bitReader.readBits(8);
  const profileCompatibility = bitReader.readBits(8);
  const levelIdc = bitReader.readBits(8);
  const sequenceParameterSetId = bitReader.readUE();
  let chromaFormatIdc = profileIdc === 138 ? 0 : 1;
  let separateColourPlaneFlag = false;
  let bitDepthLumaMinus8 = 0;
  let bitDepthChromaMinus8 = 0;
  let qpprimeYZeroTransformBypassFlag = false;

  if (HIGH_PROFILE_IDS.has(profileIdc)) {
    chromaFormatIdc = bitReader.readUE();
    if (chromaFormatIdc > 3) {
      throw new AvcSyntaxError("invalid-chroma-format", "Invalid AVC chroma_format_idc " + chromaFormatIdc + ".");
    }
    if (chromaFormatIdc === 3) separateColourPlaneFlag = Boolean(bitReader.readBit());
    bitDepthLumaMinus8 = bitReader.readUE();
    bitDepthChromaMinus8 = bitReader.readUE();
    if (bitDepthLumaMinus8 > 6 || bitDepthChromaMinus8 > 6) {
      throw new AvcSyntaxError("invalid-bit-depth", "AVC bit depth exceeds the normative 14-bit limit.");
    }
    qpprimeYZeroTransformBypassFlag = Boolean(bitReader.readBit());
    const sequenceScalingMatrixPresentFlag = Boolean(bitReader.readBit());
    if (sequenceScalingMatrixPresentFlag) {
      const scalingListCount = chromaFormatIdc === 3 ? 12 : 8;
      for (let listIndex = 0; listIndex < scalingListCount; listIndex += 1) {
        if (bitReader.readBit()) readScalingList(bitReader, listIndex < 6 ? 16 : 64);
      }
    }
  }

  const log2MaxFrameNumMinus4 = bitReader.readUE();
  if (log2MaxFrameNumMinus4 > 12) {
    throw new AvcSyntaxError("invalid-frame-number-width", "AVC log2_max_frame_num_minus4 exceeds 12.");
  }
  const picOrderCntType = bitReader.readUE();
  let log2MaxPicOrderCntLsbMinus4 = 0;
  let deltaPicOrderAlwaysZeroFlag = false;
  if (picOrderCntType === 0) {
    log2MaxPicOrderCntLsbMinus4 = bitReader.readUE();
    if (log2MaxPicOrderCntLsbMinus4 > 12) {
      throw new AvcSyntaxError("invalid-poc-width", "AVC log2_max_pic_order_cnt_lsb_minus4 exceeds 12.");
    }
  } else if (picOrderCntType === 1) {
    deltaPicOrderAlwaysZeroFlag = Boolean(bitReader.readBit());
    bitReader.readSE();
    bitReader.readSE();
    const referenceFrameCount = bitReader.readUE();
    if (referenceFrameCount > 255) {
      throw new AvcSyntaxError(
        "invalid-poc-cycle-length",
        "AVC num_ref_frames_in_pic_order_cnt_cycle exceeds the normative limit of 255."
      );
    }
    for (let index = 0; index < referenceFrameCount; index += 1) bitReader.readSE();
  } else if (picOrderCntType !== 2) {
    throw new AvcSyntaxError("invalid-poc-type", "Invalid AVC pic_order_cnt_type " + picOrderCntType + ".");
  }

  const maxNumRefFrames = bitReader.readUE();
  const gapsInFrameNumValueAllowedFlag = Boolean(bitReader.readBit());
  const picWidthInMbsMinus1 = bitReader.readUE();
  const picHeightInMapUnitsMinus1 = bitReader.readUE();
  const frameMbsOnlyFlag = Boolean(bitReader.readBit());
  const mbAdaptiveFrameFieldFlag = frameMbsOnlyFlag ? false : Boolean(bitReader.readBit());
  const direct8x8InferenceFlag = Boolean(bitReader.readBit());
  const frameCroppingFlag = Boolean(bitReader.readBit());
  let frameCropLeftOffset = 0;
  let frameCropRightOffset = 0;
  let frameCropTopOffset = 0;
  let frameCropBottomOffset = 0;
  if (frameCroppingFlag) {
    frameCropLeftOffset = bitReader.readUE();
    frameCropRightOffset = bitReader.readUE();
    frameCropTopOffset = bitReader.readUE();
    frameCropBottomOffset = bitReader.readUE();
  }

  const frameHeightInMbs = (2 - Number(frameMbsOnlyFlag)) * (picHeightInMapUnitsMinus1 + 1);
  const codedWidth = (picWidthInMbsMinus1 + 1) * AVC_MACROBLOCK_SIZE;
  const codedHeight = frameHeightInMbs * AVC_MACROBLOCK_SIZE;
  const chromaArrayType = separateColourPlaneFlag ? 0 : chromaFormatIdc;
  const subWidthC = chromaArrayType === 1 || chromaArrayType === 2 ? 2 : 1;
  const subHeightC = chromaArrayType === 1 ? 2 : 1;
  const cropUnitX = chromaArrayType === 0 ? 1 : subWidthC;
  const cropUnitY = chromaArrayType === 0
    ? 2 - Number(frameMbsOnlyFlag)
    : subHeightC * (2 - Number(frameMbsOnlyFlag));
  const cropLeftPixels = frameCropLeftOffset * cropUnitX;
  const cropRightPixels = frameCropRightOffset * cropUnitX;
  const cropTopPixels = frameCropTopOffset * cropUnitY;
  const cropBottomPixels = frameCropBottomOffset * cropUnitY;
  const width = codedWidth - cropLeftPixels - cropRightPixels;
  const height = codedHeight - cropTopPixels - cropBottomPixels;
  if (width <= 0 || height <= 0) {
    throw new AvcSyntaxError("invalid-frame-dimensions", "AVC SPS cropping produces invalid frame dimensions.");
  }

  return {
    profileIdc,
    profileCompatibility,
    levelIdc,
    sequenceParameterSetId,
    chromaFormatIdc,
    chromaArrayType,
    separateColourPlaneFlag,
    bitDepthLumaMinus8,
    bitDepthChromaMinus8,
    qpprimeYZeroTransformBypassFlag,
    log2MaxFrameNumMinus4,
    picOrderCntType,
    log2MaxPicOrderCntLsbMinus4,
    deltaPicOrderAlwaysZeroFlag,
    maxNumRefFrames,
    gapsInFrameNumValueAllowedFlag,
    picWidthInMbsMinus1,
    picHeightInMapUnitsMinus1,
    frameHeightInMbs,
    frameMbsOnlyFlag,
    mbAdaptiveFrameFieldFlag,
    direct8x8InferenceFlag,
    frameCropLeftOffset,
    frameCropRightOffset,
    frameCropTopOffset,
    frameCropBottomOffset,
    cropLeftPixels,
    cropRightPixels,
    cropTopPixels,
    cropBottomPixels,
    codedWidth,
    codedHeight,
    width,
    height
  };
}

function parsePpsNalUnit(nalUnit, sequenceParameterSetsById) {
  const bytes = normalizeBytes(nalUnit);
  if (!bytes.byteLength || (bytes[0] & 0x1f) !== NAL_TYPE_PPS) {
    throw new AvcSyntaxError("not-pps", "AVC parameter-set entry is not a PPS NAL unit.");
  }
  const bitReader = new RbspBitReader(removeEmulationPreventionBytes(bytes.subarray(1)));
  const picParameterSetId = bitReader.readUE();
  const sequenceParameterSetId = bitReader.readUE();
  const entropyCodingModeFlag = Boolean(bitReader.readBit());
  const bottomFieldPicOrderInFramePresentFlag = Boolean(bitReader.readBit());
  const numSliceGroupsMinus1 = bitReader.readUE();
  if (numSliceGroupsMinus1 > 7) {
    throw new AvcSyntaxError("invalid-slice-group-count", "AVC num_slice_groups_minus1 exceeds 7.");
  }
  let sliceGroupMapType = 0;
  let picSizeInMapUnitsMinus1 = 0;
  let sliceGroupChangeRateMinus1 = 0;
  if (numSliceGroupsMinus1 > 0) {
    sliceGroupMapType = bitReader.readUE();
    if (sliceGroupMapType === 0) {
      for (let group = 0; group <= numSliceGroupsMinus1; group += 1) bitReader.readUE();
    } else if (sliceGroupMapType === 2) {
      for (let group = 0; group < numSliceGroupsMinus1; group += 1) {
        bitReader.readUE();
        bitReader.readUE();
      }
    } else if (sliceGroupMapType >= 3 && sliceGroupMapType <= 5) {
      bitReader.readBit();
      sliceGroupChangeRateMinus1 = bitReader.readUE();
    } else if (sliceGroupMapType === 6) {
      picSizeInMapUnitsMinus1 = bitReader.readUE();
      if (picSizeInMapUnitsMinus1 >= MAX_AVC_MACROBLOCKS) {
        throw new AvcSyntaxError("slice-group-map-budget-exceeded", "AVC explicit slice-group map is too large.");
      }
      const bitsPerSliceGroupId = Math.ceil(Math.log2(numSliceGroupsMinus1 + 1));
      for (let index = 0; index <= picSizeInMapUnitsMinus1; index += 1) {
        bitReader.readBits(bitsPerSliceGroupId);
      }
    } else {
      throw new AvcSyntaxError(
        "invalid-slice-group-map",
        "Invalid AVC slice_group_map_type " + sliceGroupMapType + "."
      );
    }
  }

  const numRefIdxL0DefaultActiveMinus1 = bitReader.readUE();
  const numRefIdxL1DefaultActiveMinus1 = bitReader.readUE();
  const weightedPredFlag = Boolean(bitReader.readBit());
  const weightedBipredIdc = bitReader.readBits(2);
  const picInitQpMinus26 = bitReader.readSE();
  const picInitQsMinus26 = bitReader.readSE();
  const chromaQpIndexOffset = bitReader.readSE();
  const deblockingFilterControlPresentFlag = Boolean(bitReader.readBit());
  const constrainedIntraPredFlag = Boolean(bitReader.readBit());
  const redundantPicCntPresentFlag = Boolean(bitReader.readBit());
  let transform8x8ModeFlag = false;
  let secondChromaQpIndexOffset = chromaQpIndexOffset;
  if (bitReader.moreRbspData()) {
    transform8x8ModeFlag = Boolean(bitReader.readBit());
    const picScalingMatrixPresentFlag = Boolean(bitReader.readBit());
    if (picScalingMatrixPresentFlag) {
      const sequenceParameterSet = sequenceParameterSetsById.get(sequenceParameterSetId);
      if (!sequenceParameterSet) {
        throw new AvcSyntaxError(
          "missing-sps",
          "AVC PPS " + picParameterSetId + " references missing SPS " + sequenceParameterSetId + "."
        );
      }
      const scalingListCount = 6 + (transform8x8ModeFlag
        ? (sequenceParameterSet.chromaFormatIdc === 3 ? 6 : 2)
        : 0);
      for (let listIndex = 0; listIndex < scalingListCount; listIndex += 1) {
        if (bitReader.readBit()) readScalingList(bitReader, listIndex < 6 ? 16 : 64);
      }
    }
    secondChromaQpIndexOffset = bitReader.readSE();
  }

  return {
    picParameterSetId,
    sequenceParameterSetId,
    entropyCodingModeFlag,
    bottomFieldPicOrderInFramePresentFlag,
    numSliceGroupsMinus1,
    sliceGroupMapType,
    picSizeInMapUnitsMinus1,
    sliceGroupChangeRateMinus1,
    numRefIdxL0DefaultActiveMinus1,
    numRefIdxL1DefaultActiveMinus1,
    weightedPredFlag,
    weightedBipredIdc,
    picInitQpMinus26,
    picInitQsMinus26,
    chromaQpIndexOffset,
    secondChromaQpIndexOffset,
    deblockingFilterControlPresentFlag,
    constrainedIntraPredFlag,
    redundantPicCntPresentFlag,
    transform8x8ModeFlag
  };
}

function parseAvcParameterSets(codecConfig) {
  const parameterSets = {
    sequenceParameterSetsById: new Map(),
    pictureParameterSetsById: new Map(),
    sequenceParameterSetBytesById: new Map(),
    pictureParameterSetBytesById: new Map()
  };
  const sequenceEntries = getParameterSetEntries(codecConfig, "sps", "sequenceParameterSets");
  const pictureEntries = getParameterSetEntries(codecConfig, "pps", "pictureParameterSets");
  for (const entry of sequenceEntries) installSequenceParameterSet(parameterSets, getEntryBytes(entry));
  for (const entry of pictureEntries) installPictureParameterSet(parameterSets, getEntryBytes(entry));
  return parameterSets;
}

function installSequenceParameterSet(parameterSets, nalUnit) {
  const bytes = normalizeBytes(nalUnit);
  const parsed = parseSpsNalUnit(bytes);
  const parameterSetId = parsed.sequenceParameterSetId;
  const previousBytes = parameterSets.sequenceParameterSetBytesById.get(parameterSetId);
  if (previousBytes && byteArraysEqual(previousBytes, bytes)) {
    return parameterSets.sequenceParameterSetsById.get(parameterSetId);
  }
  parameterSets.sequenceParameterSetsById.set(parameterSetId, parsed);
  parameterSets.sequenceParameterSetBytesById.set(parameterSetId, bytes.slice());
  return parsed;
}

function installPictureParameterSet(parameterSets, nalUnit) {
  const bytes = normalizeBytes(nalUnit);
  const parsed = parsePpsNalUnit(bytes, parameterSets.sequenceParameterSetsById);
  const parameterSetId = parsed.picParameterSetId;
  const previousBytes = parameterSets.pictureParameterSetBytesById.get(parameterSetId);
  if (previousBytes && byteArraysEqual(previousBytes, bytes)) {
    return parameterSets.pictureParameterSetsById.get(parameterSetId);
  }
  parameterSets.pictureParameterSetsById.set(parameterSetId, parsed);
  parameterSets.pictureParameterSetBytesById.set(parameterSetId, bytes.slice());
  return parsed;
}

function byteArraysEqual(leftBytes, rightBytes) {
  if (leftBytes.byteLength !== rightBytes.byteLength) return false;
  for (let index = 0; index < leftBytes.byteLength; index += 1) {
    if (leftBytes[index] !== rightBytes[index]) return false;
  }
  return true;
}

function getParameterSetEntries(codecConfig, primaryName, alternateName) {
  if (!codecConfig) return [];
  if (Array.isArray(codecConfig[primaryName])) return codecConfig[primaryName];
  if (Array.isArray(codecConfig[alternateName])) return codecConfig[alternateName];
  return [];
}

function getEntryBytes(entry) {
  if (entry && entry.bytes !== undefined) return normalizeBytes(entry.bytes);
  if (entry && entry.data !== undefined) return normalizeBytes(entry.data);
  return normalizeBytes(entry);
}

function normalizeBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (Array.isArray(value)) return Uint8Array.from(value);
  throw new AvcSyntaxError("invalid-byte-input", "AVC parser requires a byte array.");
}

function parseSliceHeader(nalUnit, parameterSets) {
  const bytes = normalizeBytes(nalUnit);
  if (!bytes.byteLength) throw new AvcSyntaxError("empty-nal-unit", "AVC slice NAL unit is empty.");
  const nalUnitType = bytes[0] & 0x1f;
  if (nalUnitType !== NAL_TYPE_NON_IDR_SLICE && nalUnitType !== NAL_TYPE_IDR_SLICE) {
    throw new AvcSyntaxError("not-slice", "AVC NAL unit does not contain a supported slice header.");
  }
  const nalRefIdc = (bytes[0] >> 5) & 0x03;
  const rbsp = removeEmulationPreventionBytes(bytes.subarray(1));
  const bitReader = new RbspBitReader(rbsp);
  const firstMbInSlice = bitReader.readUE();
  const rawSliceType = bitReader.readUE();
  if (rawSliceType > 9) {
    throw new AvcSyntaxError("invalid-slice-type", "Invalid AVC slice_type " + rawSliceType + ".");
  }
  const sliceType = rawSliceType % 5;
  const picParameterSetId = bitReader.readUE();
  const pictureParameterSet = parameterSets.pictureParameterSetsById.get(picParameterSetId);
  if (!pictureParameterSet) {
    throw new AvcSyntaxError("missing-pps", "AVC slice references missing PPS " + picParameterSetId + ".");
  }
  const sequenceParameterSet = parameterSets.sequenceParameterSetsById.get(
    pictureParameterSet.sequenceParameterSetId
  );
  if (!sequenceParameterSet) {
    throw new AvcSyntaxError(
      "missing-sps",
      "AVC PPS references missing SPS " + pictureParameterSet.sequenceParameterSetId + "."
    );
  }

  let colourPlaneId = 0;
  if (sequenceParameterSet.separateColourPlaneFlag) colourPlaneId = bitReader.readBits(2);
  const frameNum = bitReader.readBits(sequenceParameterSet.log2MaxFrameNumMinus4 + 4);
  let fieldPicFlag = false;
  let bottomFieldFlag = false;
  if (!sequenceParameterSet.frameMbsOnlyFlag) {
    fieldPicFlag = Boolean(bitReader.readBit());
    if (fieldPicFlag) bottomFieldFlag = Boolean(bitReader.readBit());
  }
  let idrPicId = 0;
  if (nalUnitType === NAL_TYPE_IDR_SLICE) idrPicId = bitReader.readUE();

  let picOrderCntLsb = 0;
  if (sequenceParameterSet.picOrderCntType === 0) {
    picOrderCntLsb = bitReader.readBits(sequenceParameterSet.log2MaxPicOrderCntLsbMinus4 + 4);
    if (pictureParameterSet.bottomFieldPicOrderInFramePresentFlag && !fieldPicFlag) bitReader.readSE();
  } else if (sequenceParameterSet.picOrderCntType === 1 && !sequenceParameterSet.deltaPicOrderAlwaysZeroFlag) {
    bitReader.readSE();
    if (pictureParameterSet.bottomFieldPicOrderInFramePresentFlag && !fieldPicFlag) bitReader.readSE();
  }

  let redundantPicCnt = 0;
  if (pictureParameterSet.redundantPicCntPresentFlag) redundantPicCnt = bitReader.readUE();
  const directSpatialMvPredFlag = sliceType === SLICE_TYPE_B
    ? Boolean(bitReader.readBit())
    : false;

  let numRefIdxL0ActiveMinus1 = pictureParameterSet.numRefIdxL0DefaultActiveMinus1;
  let numRefIdxL1ActiveMinus1 = pictureParameterSet.numRefIdxL1DefaultActiveMinus1;
  if (sliceType === SLICE_TYPE_P || sliceType === SLICE_TYPE_SP || sliceType === SLICE_TYPE_B) {
    if (bitReader.readBit()) {
      numRefIdxL0ActiveMinus1 = bitReader.readUE();
      if (sliceType === SLICE_TYPE_B) numRefIdxL1ActiveMinus1 = bitReader.readUE();
    }
  }
  if (numRefIdxL0ActiveMinus1 > 31 || numRefIdxL1ActiveMinus1 > 31) {
    throw new AvcSyntaxError(
      "too-many-active-references",
      "AVC active reference-picture count exceeds the supported normative bound."
    );
  }

  if (sliceType !== SLICE_TYPE_I && sliceType !== SLICE_TYPE_SI) {
    parseRefPicListModification(bitReader);
  }
  if (sliceType === SLICE_TYPE_B) parseRefPicListModification(bitReader);

  if (
    (pictureParameterSet.weightedPredFlag && (sliceType === SLICE_TYPE_P || sliceType === SLICE_TYPE_SP)) ||
    (pictureParameterSet.weightedBipredIdc === 1 && sliceType === SLICE_TYPE_B)
  ) {
    parsePredWeightTable(
      bitReader,
      sequenceParameterSet,
      numRefIdxL0ActiveMinus1,
      sliceType === SLICE_TYPE_B ? numRefIdxL1ActiveMinus1 : -1
    );
  }

  if (nalRefIdc !== 0) parseDecodedReferencePictureMarking(bitReader, nalUnitType);
  let cabacInitIdc = 0;
  if (pictureParameterSet.entropyCodingModeFlag && sliceType !== SLICE_TYPE_I && sliceType !== SLICE_TYPE_SI) {
    cabacInitIdc = bitReader.readUE();
    if (cabacInitIdc > 2) {
      throw new AvcSyntaxError("invalid-cabac-init", "Invalid AVC cabac_init_idc " + cabacInitIdc + ".");
    }
  }
  const sliceQpDelta = bitReader.readSE();
  if (sliceType === SLICE_TYPE_SP || sliceType === SLICE_TYPE_SI) {
    if (sliceType === SLICE_TYPE_SP) bitReader.readBit();
    bitReader.readSE();
  }
  if (pictureParameterSet.deblockingFilterControlPresentFlag) {
    const disableDeblockingFilterIdc = bitReader.readUE();
    if (disableDeblockingFilterIdc !== 1) {
      bitReader.readSE();
      bitReader.readSE();
    }
  }
  if (
    pictureParameterSet.numSliceGroupsMinus1 > 0 &&
    pictureParameterSet.sliceGroupMapType >= 3 &&
    pictureParameterSet.sliceGroupMapType <= 5
  ) {
    const picSizeInMapUnits = (sequenceParameterSet.picWidthInMbsMinus1 + 1) *
      (sequenceParameterSet.picHeightInMapUnitsMinus1 + 1);
    const sliceGroupChangeRate = pictureParameterSet.sliceGroupChangeRateMinus1 + 1;
    const bits = Math.ceil(Math.log2(Math.floor(picSizeInMapUnits / sliceGroupChangeRate) + 1));
    bitReader.readBits(bits);
  }

  return {
    nalUnitType,
    nalRefIdc,
    rbsp,
    firstMbInSlice,
    rawSliceType,
    sliceType,
    picParameterSetId,
    sequenceParameterSet,
    pictureParameterSet,
    colourPlaneId,
    frameNum,
    fieldPicFlag,
    bottomFieldFlag,
    idrPicId,
    picOrderCntLsb,
    redundantPicCnt,
    directSpatialMvPredFlag,
    numRefIdxL0ActiveMinus1,
    numRefIdxL1ActiveMinus1,
    cabacInitIdc,
    sliceQpDelta,
    headerBitOffset: bitReader.bitOffset
  };
}

function parseRefPicListModification(bitReader) {
  if (!bitReader.readBit()) return;
  for (let operationCount = 0; operationCount < 1024; operationCount += 1) {
    const modificationOfPicNumsIdc = bitReader.readUE();
    if (modificationOfPicNumsIdc === 3) return;
    if (modificationOfPicNumsIdc === 0 || modificationOfPicNumsIdc === 1 || modificationOfPicNumsIdc === 2) {
      bitReader.readUE();
    } else if (modificationOfPicNumsIdc === 4 || modificationOfPicNumsIdc === 5) {
      bitReader.readUE();
    } else {
      throw new AvcSyntaxError(
        "invalid-reference-list-modification",
        "Invalid AVC modification_of_pic_nums_idc " + modificationOfPicNumsIdc + "."
      );
    }
  }
  throw new AvcSyntaxError("reference-list-too-long", "AVC reference-list modification did not terminate.");
}

function parsePredWeightTable(
  bitReader,
  sequenceParameterSet,
  numRefIdxL0ActiveMinus1,
  numRefIdxL1ActiveMinus1
) {
  bitReader.readUE();
  if (sequenceParameterSet.chromaArrayType !== 0) bitReader.readUE();
  parseWeightList(bitReader, sequenceParameterSet, numRefIdxL0ActiveMinus1);
  if (numRefIdxL1ActiveMinus1 >= 0) parseWeightList(bitReader, sequenceParameterSet, numRefIdxL1ActiveMinus1);
}

function parseWeightList(bitReader, sequenceParameterSet, activeMinus1) {
  if (activeMinus1 > 31) {
    throw new AvcSyntaxError("too-many-reference-weights", "AVC reference weight count exceeds the supported bound.");
  }
  for (let referenceIndex = 0; referenceIndex <= activeMinus1; referenceIndex += 1) {
    if (bitReader.readBit()) {
      bitReader.readSE();
      bitReader.readSE();
    }
    if (sequenceParameterSet.chromaArrayType !== 0 && bitReader.readBit()) {
      for (let component = 0; component < 2; component += 1) {
        bitReader.readSE();
        bitReader.readSE();
      }
    }
  }
}

function parseDecodedReferencePictureMarking(bitReader, nalUnitType) {
  if (nalUnitType === NAL_TYPE_IDR_SLICE) {
    bitReader.readBit();
    bitReader.readBit();
    return;
  }
  if (!bitReader.readBit()) return;
  for (let operationCount = 0; operationCount < 1024; operationCount += 1) {
    const operation = bitReader.readUE();
    if (operation === 0) return;
    if (operation === 1 || operation === 3) bitReader.readUE();
    if (operation === 2) bitReader.readUE();
    if (operation === 3 || operation === 6) bitReader.readUE();
    if (operation === 4) bitReader.readUE();
    if (operation < 1 || operation > 6) {
      throw new AvcSyntaxError("invalid-memory-management-operation", "Invalid AVC MMCO value " + operation + ".");
    }
  }
  throw new AvcSyntaxError("memory-management-too-long", "AVC memory-management operations did not terminate.");
}

function splitLengthPrefixedNalUnits(sampleBytes, nalLengthSize) {
  if (!Number.isInteger(nalLengthSize) || nalLengthSize < 1 || nalLengthSize > 4) {
    throw new AvcSyntaxError("invalid-nal-length-size", "AVC NAL length size must be between 1 and 4 bytes.");
  }
  const bytes = normalizeBytes(sampleBytes);
  const nalUnits = [];
  let offset = 0;
  while (offset < bytes.byteLength) {
    if (offset + nalLengthSize > bytes.byteLength) {
      throw new AvcSyntaxError("truncated-nal-length", "AVC sample ends inside a NAL length field.");
    }
    const lengthFieldOffset = offset;
    let nalUnitLength = 0;
    for (let index = 0; index < nalLengthSize; index += 1) {
      nalUnitLength = nalUnitLength * 256 + bytes[offset + index];
    }
    offset += nalLengthSize;
    if (nalUnitLength <= 0 || offset + nalUnitLength > bytes.byteLength) {
      throw new AvcSyntaxError(
        "invalid-nal-length",
        "AVC NAL length " + nalUnitLength + " exceeds the remaining sample bytes."
      );
    }
    if (nalUnits.length >= MAX_AVC_NAL_UNITS) {
      throw new AvcSyntaxError("nal-unit-budget-exceeded", "AVC sample contains more than 65,536 NAL units.");
    }
    const data = bytes.subarray(offset, offset + nalUnitLength);
    nalUnits.push({
      index: nalUnits.length,
      lengthFieldOffset,
      offset,
      length: nalUnitLength,
      type: data[0] & 0x1f,
      data
    });
    offset += nalUnitLength;
  }
  return nalUnits;
}

function parseAvcFrameInternals(sampleBytes, codecConfig, track = null, options = {}) {
  const sampleBits = getByteLength(sampleBytes) * 8;
  let rootUnitFallbackContext = null;
  try {
    const parameterSets = parseAvcParameterSets(codecConfig);
    const nalLengthSize = Number(codecConfig && codecConfig.nalLengthSize);
    const nalUnits = splitLengthPrefixedNalUnits(sampleBytes, nalLengthSize);
    if (nalUnits.some((nalUnit) => nalUnit.type >= 2 && nalUnit.type <= 4)) {
      throw new AvcSyntaxError("data-partitioning-unsupported", "AVC data-partitioned slices are not supported.");
    }
    const slices = [];
    for (const nalUnit of nalUnits) {
      if (nalUnit.type === NAL_TYPE_SPS) {
        installSequenceParameterSet(parameterSets, nalUnit.data);
      } else if (nalUnit.type === NAL_TYPE_PPS) {
        installPictureParameterSet(parameterSets, nalUnit.data);
      } else if (nalUnit.type === NAL_TYPE_NON_IDR_SLICE || nalUnit.type === NAL_TYPE_IDR_SLICE) {
        if (!parameterSets.sequenceParameterSetsById.size || !parameterSets.pictureParameterSetsById.size) {
          throw new AvcSyntaxError(
            "missing-parameter-sets",
            "AVC slice syntax was encountered before its SPS/PPS became available."
          );
        }
        slices.push({ nalUnit, header: parseSliceHeader(nalUnit.data, parameterSets) });
      }
    }
    if (!slices.length) {
      throw new AvcSyntaxError("no-slice-nal", "AVC sample contains no VCL slice NAL unit.");
    }
    const sequenceParameterSet = slices[0].header.sequenceParameterSet;
    const macroblockColumns = sequenceParameterSet.picWidthInMbsMinus1 + 1;
    const macroblockRows = sequenceParameterSet.frameHeightInMbs;
    const macroblockCount = macroblockColumns * macroblockRows;
    if (!Number.isSafeInteger(macroblockCount) || macroblockCount <= 0 || macroblockCount > MAX_AVC_MACROBLOCKS) {
      throw new AvcSyntaxError(
        "macroblock-budget-exceeded",
        "AVC picture requires " + macroblockCount + " macroblocks; limit is " + MAX_AVC_MACROBLOCKS + "."
      );
    }
    validateRootUnitPicture(slices);
    rootUnitFallbackContext = {
      nalUnits,
      slices,
      sequenceParameterSet,
      macroblockColumns,
      macroblockRows,
      macroblockCount
    };
    validateSupportedPicture(slices);
    validateSliceOrdering(slices, macroblockCount);
    const maximumStructureRecords = getMaximumStructureRecords(options, macroblockCount);
    const state = createPictureState(
      sequenceParameterSet,
      macroblockColumns,
      macroblockRows,
      maximumStructureRecords
    );
    const sliceResults = [];
    for (let sliceIndex = 0; sliceIndex < slices.length; sliceIndex += 1) {
      const endMacroblockAddress = sliceIndex + 1 < slices.length
        ? slices[sliceIndex + 1].header.firstMbInSlice
        : macroblockCount;
      sliceResults.push(decodeSlice(
        slices[sliceIndex],
        sliceIndex,
        endMacroblockAddress,
        state
      ));
    }
    if (state.macroblocks.some((macroblock) => !macroblock)) {
      throw new AvcSyntaxError("incomplete-picture", "AVC slices did not cover every picture macroblock.");
    }
    const attributedBits = state.macroblocks.reduce((total, macroblock) => total + macroblock.syntaxBits, 0);
    if (attributedBits > sampleBits) {
      throw new AvcSyntaxError("invalid-bit-accounting", "AVC attributed syntax exceeds the encoded sample size.");
    }
    const partitions = state.macroblocks.flatMap((macroblock) => flattenMacroblockDescendants(macroblock));
    const structureRecordCount = state.macroblocks.length + partitions.length;
    const decodedStructureRecordCount = state.macroblocks.length + state.structureBudget.decodedPartitionCount;
    const structureTruncated = structureRecordCount < decodedStructureRecordCount;
    return {
      kind: "avc-frame-internals",
      complete: true,
      granularity: "partition-tree",
      codec: "AVC / H.264",
      frameType: summarizeSliceTypes(slices),
      entropyCodingMode: slices[0].header.pictureParameterSet.entropyCodingModeFlag ? "CABAC" : "CAVLC",
      accountingKind: slices[0].header.pictureParameterSet.entropyCodingModeFlag
        ? "cabac-renormalization-cursor-delta"
        : "cavlc-syntax-bit-length",
      width: sequenceParameterSet.width,
      height: sequenceParameterSet.height,
      codedWidth: sequenceParameterSet.codedWidth,
      codedHeight: sequenceParameterSet.codedHeight,
      macroblockColumns,
      macroblockRows,
      macroblockCount,
      macroblocks: state.macroblocks,
      partitions,
      structureRecordCount,
      decodedStructureRecordCount,
      structureTruncated,
      omittedPartitionCount: state.structureBudget.omittedPartitionCount,
      leafBlockCount: state.structureBudget.decodedPartitionCount,
      partitionDepths: [
        { depth: 0, count: macroblockCount },
        { depth: 1, count: state.structureBudget.decodedPartitionCount }
      ],
      partitionModes: Array.from(state.partitionModeCounts.entries())
        .sort((leftEntry, rightEntry) => rightEntry[1] - leftEntry[1])
        .map(([mode, count]) => ({ mode, count })),
      sampleBits,
      attributedBits,
      overheadBits: sampleBits - attributedBits,
      nals: nalUnits.map((nalUnit) => summarizeNalUnit(nalUnit, sliceResults)),
      warnings: structureTruncated
        ? [
          "The decoded AVC tree contains " + decodedStructureRecordCount +
            " records; all " + macroblockCount + " macroblock roots were preserved and detail output was capped at " +
            maximumStructureRecords + " records."
        ]
        : []
    };
  } catch (error) {
    if (rootUnitFallbackContext && error instanceof AvcSyntaxError) {
      return createRootUnitFallback(rootUnitFallbackContext, sampleBits, error);
    }
    return {
      kind: "unavailable",
      complete: false,
      codec: "AVC / H.264",
      sampleBits,
      attributedBits: null,
      overheadBits: null,
      unattributedBits: sampleBits,
      reason: error && error.code ? error.code : "avc-syntax-parse-failed",
      error: error instanceof Error ? error.message : String(error),
      warnings: []
    };
  }
}

function validateRootUnitPicture(slices) {
  const firstHeader = slices[0].header;
  const sequenceParameterSet = firstHeader.sequenceParameterSet;
  const pictureParameterSet = firstHeader.pictureParameterSet;
  if (!sequenceParameterSet.frameMbsOnlyFlag || slices.some(({ header }) => header.fieldPicFlag)) {
    throw new AvcSyntaxError(
      "interlaced-picture-unsupported",
      "Exact 16x16 AVC root units are unavailable for interlaced or field pictures."
    );
  }
  for (const { header } of slices) {
    if (
      header.sequenceParameterSet.sequenceParameterSetId !== sequenceParameterSet.sequenceParameterSetId ||
      header.pictureParameterSet.picParameterSetId !== pictureParameterSet.picParameterSetId ||
      header.sequenceParameterSet !== sequenceParameterSet ||
      header.pictureParameterSet !== pictureParameterSet ||
      header.frameNum !== firstHeader.frameNum ||
      header.nalUnitType !== firstHeader.nalUnitType ||
      header.idrPicId !== firstHeader.idrPicId
    ) {
      throw new AvcSyntaxError("mixed-picture-parameters", "AVC sample slices do not describe one consistent picture.");
    }
  }
}

function createRootUnitFallback(context, sampleBits, error) {
  const {
    nalUnits,
    slices,
    sequenceParameterSet,
    macroblockColumns,
    macroblockRows,
    macroblockCount
  } = context;
  const macroblocks = buildRootUnitGeometry(sequenceParameterSet, macroblockColumns, macroblockRows);
  return {
    kind: "avc-frame-internals",
    complete: true,
    granularity: "root-units",
    codec: "AVC / H.264",
    frameType: summarizeSliceTypes(slices),
    entropyCodingMode: slices[0].header.pictureParameterSet.entropyCodingModeFlag ? "CABAC" : "CAVLC",
    accountingKind: "unavailable",
    width: sequenceParameterSet.width,
    height: sequenceParameterSet.height,
    codedWidth: sequenceParameterSet.codedWidth,
    codedHeight: sequenceParameterSet.codedHeight,
    macroblockColumns,
    macroblockRows,
    macroblockCount,
    macroblocks,
    partitions: [],
    structureRecordCount: macroblocks.length,
    decodedStructureRecordCount: macroblocks.length,
    structureTruncated: false,
    leafBlockCount: macroblocks.length,
    sampleBits,
    attributedBits: null,
    overheadBits: null,
    unattributedBits: sampleBits,
    nals: nalUnits.map((nalUnit) => summarizeNalUnit(nalUnit, null)),
    reason: error.code,
    error: error.message,
    warnings: [error.message]
  };
}

function buildRootUnitGeometry(sequenceParameterSet, macroblockColumns, macroblockRows) {
  const macroblocks = [];
  for (let macroblockRow = 0; macroblockRow < macroblockRows; macroblockRow += 1) {
    for (let macroblockColumn = 0; macroblockColumn < macroblockColumns; macroblockColumn += 1) {
      const macroblockIndex = macroblockRow * macroblockColumns + macroblockColumn;
      const codedLeft = macroblockColumn * AVC_MACROBLOCK_SIZE;
      const codedTop = macroblockRow * AVC_MACROBLOCK_SIZE;
      const geometry = getTranslatedCodedRectangle(
        sequenceParameterSet,
        codedLeft,
        codedTop,
        AVC_MACROBLOCK_SIZE,
        AVC_MACROBLOCK_SIZE
      );
      macroblocks.push({
        id: "mb:" + macroblockIndex,
        macroblockIndex,
        macroblockColumn,
        macroblockRow,
        codedLeft,
        codedTop,
        left: geometry.left,
        top: geometry.top,
        width: geometry.width,
        height: geometry.height,
        codedWidth: AVC_MACROBLOCK_SIZE,
        codedHeight: AVC_MACROBLOCK_SIZE,
        codedBlockWidth: AVC_MACROBLOCK_SIZE,
        codedBlockHeight: AVC_MACROBLOCK_SIZE,
        depth: 0,
        type: "macroblock-root",
        syntaxBits: null,
        ownBits: null,
        subtreeBits: null,
        children: []
      });
    }
  }
  return macroblocks;
}

function getTranslatedCodedRectangle(sequenceParameterSet, codedLeft, codedTop, codedWidth, codedHeight) {
  return {
    left: codedLeft - sequenceParameterSet.cropLeftPixels,
    top: codedTop - sequenceParameterSet.cropTopPixels,
    width: codedWidth,
    height: codedHeight
  };
}

function summarizeSliceTypes(slices) {
  const names = [];
  for (const { header } of slices) {
    const name = getSliceTypeName(header.sliceType);
    if (!names.includes(name)) names.push(name);
  }
  return names.join("/");
}

function getSliceTypeName(sliceType) {
  return ["P", "B", "I", "SP", "SI"][sliceType] || "unknown";
}

function validateSupportedPicture(slices) {
  const firstHeader = slices[0].header;
  const sequenceParameterSet = firstHeader.sequenceParameterSet;
  const pictureParameterSet = firstHeader.pictureParameterSet;
  if (slices.some(({ header }) => (
    header.sliceType !== SLICE_TYPE_I &&
    header.sliceType !== SLICE_TYPE_P &&
    header.sliceType !== SLICE_TYPE_B
  ))) {
    throw new AvcSyntaxError(
      "slice-type-syntax-unsupported",
      "Exact AVC internals currently support I, P, and B slices; SP/SI macroblock syntax is unavailable."
    );
  }
  if (sequenceParameterSet.mbAdaptiveFrameFieldFlag) {
    throw new AvcSyntaxError("mbaff-unsupported", "AVC MBAFF pictures are not supported.");
  }
  if (sequenceParameterSet.separateColourPlaneFlag || sequenceParameterSet.chromaArrayType > 1) {
    throw new AvcSyntaxError(
      "chroma-format-unsupported",
      "Exact AVC internals currently support monochrome and 4:2:0 pictures only."
    );
  }
  if (pictureParameterSet.numSliceGroupsMinus1 > 0) {
    throw new AvcSyntaxError("slice-groups-unsupported", "AVC flexible macroblock ordering is not supported.");
  }
  if (slices.some(({ header }) => header.redundantPicCnt > 0)) {
    throw new AvcSyntaxError("redundant-slices-unsupported", "AVC redundant slices are not supported.");
  }
}

function validateSliceOrdering(slices, macroblockCount) {
  if (slices[0].header.firstMbInSlice !== 0) {
    throw new AvcSyntaxError("missing-first-macroblock", "AVC picture does not start at macroblock address zero.");
  }
  let previousAddress = -1;
  for (const { header } of slices) {
    if (header.firstMbInSlice <= previousAddress || header.firstMbInSlice >= macroblockCount) {
      throw new AvcSyntaxError("unsupported-slice-order", "AVC slices are duplicated or out of raster order.");
    }
    previousAddress = header.firstMbInSlice;
  }
}

function getMaximumStructureRecords(options, macroblockCount) {
  const requestedLimit = Number(options && options.maximumStructureRecords);
  if (!Number.isFinite(requestedLimit) || requestedLimit <= 0) return MAX_AVC_STRUCTURE_RECORDS;
  return Math.max(macroblockCount, Math.min(MAX_AVC_STRUCTURE_RECORDS, Math.floor(requestedLimit)));
}

function createPictureState(
  sequenceParameterSet,
  macroblockColumns,
  macroblockRows,
  maximumStructureRecords
) {
  return {
    sequenceParameterSet,
    macroblockColumns,
    macroblockRows,
    macroblocks: new Array(macroblockColumns * macroblockRows),
    syntaxState: new Array(macroblockColumns * macroblockRows),
    structureBudget: {
      maximumStructureRecords,
      retainedStructureRecordCount: macroblockColumns * macroblockRows,
      decodedPartitionCount: 0,
      omittedPartitionCount: 0
    },
    partitionModeCounts: new Map()
  };
}

function summarizeNalUnit(nalUnit, sliceResults) {
  const accountingAvailable = Array.isArray(sliceResults);
  const sliceResult = accountingAvailable
    ? sliceResults.find((result) => result.nalIndex === nalUnit.index)
    : null;
  return {
    index: nalUnit.index,
    type: nalUnit.type,
    name: nalTypeName(nalUnit.type),
    offset: nalUnit.offset,
    length: nalUnit.length,
    sampleBits: nalUnit.length * 8,
    attributedBits: accountingAvailable ? (sliceResult ? sliceResult.attributedBits : 0) : null,
    overheadBits: accountingAvailable
      ? nalUnit.length * 8 - (sliceResult ? sliceResult.attributedBits : 0)
      : null
  };
}

function nalTypeName(type) {
  const names = {
    1: "non-IDR slice",
    5: "IDR slice",
    6: "SEI",
    7: "SPS",
    8: "PPS",
    9: "AUD",
    12: "filler"
  };
  return names[type] || "NAL " + type;
}

function getByteLength(value) {
  if (value && Number.isFinite(value.byteLength)) return value.byteLength;
  if (Array.isArray(value)) return value.length;
  return 0;
}

// H.264 Table 9-44: rangeTabLPS for arithmetic decoding (clause 9.3.3.2.1.1).
const CABAC_RANGE_LPS = [
  [128, 176, 208, 240], [128, 167, 197, 227], [128, 158, 187, 216], [123, 150, 178, 205],
  [116, 142, 169, 195], [111, 135, 160, 185], [105, 128, 152, 175], [100, 122, 144, 166],
  [95, 116, 137, 158], [90, 110, 130, 150], [85, 104, 123, 142], [81, 99, 117, 135],
  [77, 94, 111, 128], [73, 89, 105, 122], [69, 85, 100, 116], [66, 80, 95, 110],
  [62, 76, 90, 104], [59, 72, 86, 99], [56, 69, 81, 94], [53, 65, 77, 89],
  [51, 62, 73, 85], [48, 59, 69, 80], [46, 56, 66, 76], [43, 53, 63, 72],
  [41, 50, 59, 69], [39, 48, 56, 65], [37, 45, 54, 62], [35, 43, 51, 59],
  [33, 41, 48, 56], [32, 39, 46, 53], [30, 37, 43, 50], [29, 35, 41, 48],
  [27, 33, 39, 45], [26, 31, 37, 43], [24, 30, 35, 41], [23, 28, 33, 39],
  [22, 27, 32, 37], [21, 26, 30, 35], [20, 24, 29, 33], [19, 23, 27, 31],
  [18, 22, 26, 30], [17, 21, 25, 28], [16, 20, 23, 27], [15, 19, 22, 25],
  [14, 18, 21, 24], [14, 17, 20, 23], [13, 16, 19, 22], [12, 15, 18, 21],
  [12, 14, 17, 20], [11, 14, 16, 19], [11, 13, 15, 18], [10, 12, 15, 17],
  [10, 12, 14, 16], [9, 11, 13, 15], [9, 11, 12, 14], [8, 10, 12, 14],
  [8, 9, 11, 13], [7, 9, 11, 12], [7, 9, 10, 12], [7, 8, 10, 11],
  [6, 8, 9, 11], [6, 7, 9, 10], [6, 7, 8, 9], [2, 2, 2, 2]
];

// H.264 Tables 9-45 and 9-46: pStateIdx transitions after LPS and MPS bins.
const CABAC_TRANSITION_LPS = [
  0, 0, 1, 2, 2, 4, 4, 5, 6, 7, 8, 9, 9, 11, 11, 12,
  13, 13, 15, 15, 16, 16, 18, 18, 19, 19, 21, 21, 22, 22, 23, 24,
  24, 25, 26, 26, 27, 27, 28, 29, 29, 30, 30, 30, 31, 32, 32, 33,
  33, 33, 34, 34, 35, 35, 35, 36, 36, 36, 37, 37, 37, 38, 38, 63
];

const CABAC_TRANSITION_MPS = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
  17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32,
  33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48,
  49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 62, 63
];

// H.264 Tables 9-12 through 9-33: signed (m,n) context-init pairs for I/SI slices.
// The table pairs are packed as hexadecimal int8 values for contexts 0..435 and 1012..1015.
const CABAC_I_CONTEXT_HEAD_HEX =
  "14f10236034a14f10236034ae47fe968fa35ff36073300000000000000000000000000000000000000000000000000000000000000000000" +
  "0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000" +
  "00000000000000000029003f003f003ff75304560061f9480d29033e000b01370045ef7ff3660052f94aeb6be57fe17fe87fee5fe57feb72" +
  "e27fef7bf473f07af573f43ffe44f154f368fd46f85df65ae27fff4afa61f95bec7ffc38fb52f94cea7df95df557fd4dfb47fc3ffc44f454" +
  "f93ef941083d0538fe420140003dfe4e013207340a23002c0b26012d002e052c1f11013307321c1310210e3ef36cf164f365f35bf45ef658" +
  "f054f656f953f357ed5e01460048fb4a123bf866f164005ffc4b0248f54bfd470f2ef345003e00411525f14809391036003e0c4818000f09" +
  "08190d120f090d130a250c12061d14210f1e042d013a003e073d0c260b2d0f270b2a0d2c102d0c290a311e22122a0a371133112e00591aed" +
  "16ef1aef1ee71cec21e925e521e928e426ef21f528f129fa260129111efa1b031a1625f023fc26f826fd250326052a00231027160e301b25" +
  "153c0c440261fd47fa2afb32fd36fe3e003a013ffe48ff4af75bfb43fb1bfd27fe2c002ef040f844f64efa4df656f45cf137f63cfa3efc41" +
  "f449f84cf950f758ef6ef561ec54f54ffa49fc4af356f360f561ed75f84efb21fc30fe35fd3ef347f64ff456f35af2610000fa5dfa54f84f" +
  "0042ff47003efe3cfe3bfb4bfd3efc3af742ff4f004703440a2cf93e0f240e28101b0c1d012c14241220052a01300a3e112e0940f468f561" +
  "f060f958f855f955f755f3580442fd4dfd4cfa4c0a3aff4cff53f963f25f025f004cfb4a0046f54b01440041f249033e043eff44f34b0b37" +
  "05400c460f06061307100c0e120d0d0b0d0f0f100c170d170f140e1a0e2c1128112f1811151519161f1b161d13230e320a39073ffe4dfc52" +
  "fd5e0945f46d24dd24de20e625e22ce022ee22f128f121f923fb21002602210d17230d3a1dfd1a00161e1ff923f122fd220324ff2205200b" +
  "2305220c270b1e1d221a1d2713421f151f1f1932ef78ec70ee72f555f15cf259e647f151f2500044f246e838e944e832f54a17f31af328f1" +
  "31f22c032d062c2221361352fd4bff170122012b0036fe37003d01400044f75c";
const CABAC_I_CONTEXT_TAIL_HEX = "fd46f85df65ae27f";

// H.264 Tables 9-12 through 9-33: signed (m,n) context-init pairs for P/B slices.
// Each entry is selected by cabac_init_idc and covers contexts 0..435 plus 1012..1015.
const CABAC_PB_CONTEXT_HEAD_HEX = [
  "14f10236034a14f10236034ae47fe968fa35ff36073317211702150001090031db760539f34ef541013e0c31fc4911321240092b1d001a43" +
    "105a0968d27fec680143f34ef541013efa56ef5ffa3d092dfd45fa51f56006370743fb560258003afd4cf65e05360445fd510058f943fb4a" +
    "fc4afb50f948013a0029003f003f003ff75304560061f9480d29033e002dfc4efd60e57ee462e765e943e452ec5ef053ea6eeb5bee66f35d" +
    "e37ff95cfb59f960f36cfd2eff41ff39f75dfd4af75cf857e97e0536063c063b0645ff300044fc45f858fe55fa4eff4bf94d02360532fd44" +
    "0132062afc51013ffc4600430239fe4c0b230440013d0b2312190c180d1d0d24f65df949fe490d2e0931f964093502350535fe3d00380038" +
    "f33ffb3cff3e0439fa4504390e2704330d440340013d093f07321027052c04340b30fb3cff3b003b1621052c0e2bff4e003c09450b1c0228" +
    "032c0031002e022c0233002f0427023e062e00360336023a043f063306390735063406370b2d0e240835ff520737fd4e0f2e161fff541907" +
    "1ef91c031c04200022ff1e061e0620091f131a1b1a1e25141c2211460143053b0943101e12201223161d181f1726122b14290b3f093b0940" +
    "ff5efe59f76cfa4cfe2c002d0034fd40fe3bfc46fc4bf852ef66f74d0318002a00300037fa3bf947f453f557e277013afd1dff240126022b" +
    "fa37003a0040fd4af65a0046fc1d051f072a013bfe3afd48fd51f561003a08050a0e0e120d1b0228003afd46fa4ff8550000f36af06af657" +
    "eb72ee6ef262ea6eeb6aee67eb6be96ce670f660f45ffb5bf75dea5efb560943fc50f655ff46073c093a053d0c320f32123111360a29072e" +
    "ff33073108340929062f02370d290a2c063205350d31043f0640fe45fe3b06460a2c091f0c2b03350e220a26fd340d281120072c07260d32" +
    "0a391a2b0e0b0b0e090b120b150917fe20f120f122eb27e92adf29e12ee426f4151d2de835d330e641d52bed27f61e09121a141b0039f252" +
    "fb4bed61dd7d1b001c001ffc1b0622081e0a1816211316201a1f15291a2c172f10410e47083c063f1141151817141a171b201c171c181728" +
    "18201c1d172a13391635163d0b560c280b330e3bfc4ff947fb45f746f842f644ed49f445f046f143ec3eed46f042ea41ec3f09fe1af721f7" +
    "27f929fe2d0331092d1b243bfa42f923f92af82dfb30f438fa3cfb3ef842f84c",
  "14f10236034a14f10236034ae47fe968fa35ff360733161922001000fe090429e3760241fa47f34f05340932fd460a361a22131628003902" +
    "29241a45d37ff165fc4cfa47f34f05340645f35a0034082bfe45fb52f660023b024bfd57fd640138fd4afa55003bfd51f956fb5fff42ff4d" +
    "0146fe56fb48003d0029003f003f003ff75304560061f9480d29033e0d0f07330250d97fee5bef60e651dd62e866e961e577e863eb6eee66" +
    "dc7f0050fb59f95efc5c00270041f154dd7ffe49f468f75be17f033707380737083dfd350044f94af758f367f35bf759f25cf84cf457e96e" +
    "e869f64eec70ef63b27fba7fce7fd27ffc42fb4efc47f848023bff37f946fa4bf859de77fd4b20141e16d47f0036fb3d003aff3cfd3df843" +
    "e754f24afb4105340239003df745f5461237fc47003a073d092912190920052b092f002c0033022e1326fc420f260c2a09220059042d0a1c" +
    "0a1f21f534d5120f1c0023ea26e7220027ee20f466a2000038f121fc1d0a25fb33e327f734de45c643c12cfb200737e3200100001b2421e7" +
    "22e224e426e426e522ee23f022f220f825fa23001e0a1c121a191d29004b0248084d0e23121f1123151e112d142a122d1b1a103607421038" +
    "0b490a43f674e970f147f93d0035fb42f54df750f754f657de7feb65fd27fb35f93df54bf14def5be76be76fe47af54cf62cf634f639f73a" +
    "f048f945fc45fb4af7560242f72201200b1f0534fe37fe430049f859033407040a08110810130325ff3dfb49ff46fc4e0000eb7ee97cec6e" +
    "e67ee77cef69e579e575ef66e675e574df7af65ff264f85fef6fe472fa59fe50fc52f755f851ff48054001430938004501450745f945fa43" +
    "f04dfe40023dfa43fd400239fd41fd42003e0933ff42fe47fe4bff46f7480e3c1025002f12230b250c290a2902300c290d29003b03321328" +
    "0342123213fa12fa0e001af41ff021e721ea25e427e22ae22fd62ddc31de29ef200945b93fc142c04db636d934dd29f6240028ff1e0e1c1a" +
    "17250c370b4125df27dc28db26e22edf2ae228e831e326f428f626fd2efb1f141d1e192c0c300b311a2d161617161b1521141a1c1e181b22" +
    "122a192712320c4615360e470b53192015311536fb55fa51f64df951ef50ee49fc4af653f747f743ff3df842f242003b023b11f620f32af7" +
    "31fb35004003440a421b2f39fb470018ff24fe2afe34f739fa3ffc41fc43f952",
  "14f10236034a14f10236034ae47fe968fa35ff3607331d1019000e00f633fd3ee5631a10fc55e86605390639ef490e391428140a1d003600" +
    "252a0c61e07fea75fe4afc55e8660539fa5df258fa2c0437f559f167eb741339143a04540660013ffb55f36a053f064bfd5aff650337fc4f" +
    "fe4bf461f932013c0029003f003f003ff75304560061f9480d29033e0722f758ec7fdc7fef5bf25fe754e756f459ef5be17ff24cee67f35a" +
    "db7f0b50054c0254054efa37043df253db7ffb4ff568f55be27f0041fe4f0048fc5cfa380344f847f362fc56f458fb52fd48fc43f848f059" +
    "f745ff3b05420439fc47fe47023aff4afc2cff45003ef933fc2ffa2afd29fa35084cf74ef55309340043fb5a0143f148fb4bf850eb53eb40" +
    "f31fe740e35e094b113ff84afb23fe1b0d5b0341f945084df642033efd44ec51001e0107fd17eb4a1042e97c11252cee32deea7f0427002a" +
    "07220b1d081f0625072a032808210d2b0d24042f0337023a063c082c0b2c0e2a0730043804340d250931133a0a300c2d00451421083f23ee" +
    "21e71cfd180a1b0022f234d427e813111f19241d1821220f1e1416491422131f1b2c13100f240f24151c19151e141f0c1b10182a005d0e38" +
    "0f391a26e87fe873ea52f73e0035003bf255f359f35ef55ce37feb64f239f443f547f64deb55f058e968f162db7ff652f830f83df842f946" +
    "f24bf64ff753f45cee6cfc4fea45f04bfe3a013af34ef753fc51f363f351fa26f33efa3afe3bf049f64cf356f753f6570000ea7fe77fe778" +
    "e57fed72e975e776e675e871e476e178db7cf65ef166f663f36ace7ffb5c1139fb56f35ef45bfe4d0047ff490440f95105400f3901430044" +
    "f6430144004d02400044fb4e0737053b02410e360f2c053c0246fe4cee560c460540f4460b37053800450241fa4a05360736fa4cf552fe4d" +
    "fe4d192a11f310f711f41beb25e229d82ad730d127e02ed834cd2ed734d92bed200b3dc938d23ece51bd2dec23fe1c0f220127011e111426" +
    "122d0f36004f24f025f225ef2001220f1d0f181922161f1023121f1c2129241c1b2f153e121f131a241818171b10181e1f1d1629162a103c" +
    "0f340e3c034ef07b15351638193d15211332113dfd4ef84af748f648ee4bf447f53ffb46ef4bf248f043f835f23bf734f54409fe1ef61ffc" +
    "21ff21071f0c25171f261440f747f925f82cf531f638f43bf83ff743fa44f64f"
];
const CABAC_PB_CONTEXT_TAIL_HEX = ["fd4af75cf857e97e", "fe49f468f75be17f", "fb4ff568f55be27f"];

class CabacArithmeticReader {
  constructor(encodedBytes) {
    this.encodedBytes = encodedBytes;
    this.inputBitOffset = 0;
    this.codIRange = 510;
    this.codIOffset = this.readInputBits(9);
  }

  get consumedBitCount() {
    return this.inputBitOffset;
  }

  readInputBit() {
    if (this.inputBitOffset >= this.encodedBytes.byteLength * 8) {
      throw new AvcSyntaxError("unexpected-end-of-cabac", "Unexpected end of AVC CABAC data.");
    }
    const byte = this.encodedBytes[this.inputBitOffset >> 3];
    const bit = (byte >> (7 - (this.inputBitOffset & 7))) & 1;
    this.inputBitOffset += 1;
    return bit;
  }

  readInputBits(bitCount) {
    let value = 0;
    for (let bitIndex = 0; bitIndex < bitCount; bitIndex += 1) {
      value = value * 2 + this.readInputBit();
    }
    return value;
  }

  renormalizeInterval() {
    while (this.codIRange < 256) {
      this.codIRange *= 2;
      this.codIOffset = this.codIOffset * 2 + this.readInputBit();
    }
  }

  decodeContextBin(contextModels, contextIndex) {
    const packedModel = contextModels[contextIndex];
    let probabilityState = packedModel >> 1;
    let mostProbableSymbol = packedModel & 1;
    const rangeClass = (this.codIRange >> 6) & 3;
    const leastProbableRange = CABAC_RANGE_LPS[probabilityState][rangeClass];
    this.codIRange -= leastProbableRange;

    let decodedBin;
    if (this.codIOffset >= this.codIRange) {
      decodedBin = 1 - mostProbableSymbol;
      this.codIOffset -= this.codIRange;
      this.codIRange = leastProbableRange;
      if (probabilityState === 0) mostProbableSymbol = 1 - mostProbableSymbol;
      probabilityState = CABAC_TRANSITION_LPS[probabilityState];
    } else {
      decodedBin = mostProbableSymbol;
      probabilityState = CABAC_TRANSITION_MPS[probabilityState];
    }
    contextModels[contextIndex] = probabilityState * 2 + mostProbableSymbol;
    this.renormalizeInterval();
    return decodedBin;
  }

  decodeBypassBin() {
    this.codIOffset = this.codIOffset * 2 + this.readInputBit();
    if (this.codIOffset < this.codIRange) return 0;
    this.codIOffset -= this.codIRange;
    return 1;
  }

  decodeTerminateBin() {
    this.codIRange -= 2;
    if (this.codIOffset >= this.codIRange) return 1;
    this.renormalizeInterval();
    return 0;
  }
}

function createIntraCabacContextModels(sliceQpY) {
  const contextModels = new Uint8Array(1024);
  initializeCabacContextRange(contextModels, 0, CABAC_I_CONTEXT_HEAD_HEX, sliceQpY);
  initializeCabacContextRange(contextModels, 1012, CABAC_I_CONTEXT_TAIL_HEX, sliceQpY);
  return contextModels;
}

function createPredictiveCabacContextModels(sliceQpY, cabacInitIdc) {
  if (!Number.isInteger(cabacInitIdc) || cabacInitIdc < 0 || cabacInitIdc > 2) {
    throw new AvcSyntaxError("invalid-cabac-init", "Invalid AVC cabac_init_idc " + cabacInitIdc + ".");
  }
  const contextModels = new Uint8Array(1024);
  initializeCabacContextRange(contextModels, 0, CABAC_PB_CONTEXT_HEAD_HEX[cabacInitIdc], sliceQpY);
  initializeCabacContextRange(contextModels, 1012, CABAC_PB_CONTEXT_TAIL_HEX[cabacInitIdc], sliceQpY);
  return contextModels;
}

function initializeCabacContextRange(contextModels, firstContextIndex, packedMnHex, sliceQpY) {
  const clippedQp = clip3(0, 51, sliceQpY);
  for (let hexOffset = 0; hexOffset < packedMnHex.length; hexOffset += 4) {
    const contextIndex = firstContextIndex + hexOffset / 4;
    const m = signedInt8(Number.parseInt(packedMnHex.slice(hexOffset, hexOffset + 2), 16));
    const n = signedInt8(Number.parseInt(packedMnHex.slice(hexOffset + 2, hexOffset + 4), 16));
    const preContextState = clip3(1, 126, ((m * clippedQp) >> 4) + n);
    if (preContextState <= 63) {
      contextModels[contextIndex] = (63 - preContextState) * 2;
    } else {
      contextModels[contextIndex] = (preContextState - 64) * 2 + 1;
    }
  }
}

function signedInt8(value) {
  return value >= 128 ? value - 256 : value;
}

function clip3(minimum, maximum, value) {
  return Math.max(minimum, Math.min(maximum, value));
}

function decodeSlice(slice, sliceIndex, endMacroblockAddress, pictureState) {
  const { header, nalUnit } = slice;
  const sliceQpY = 26 + header.pictureParameterSet.picInitQpMinus26 + header.sliceQpDelta;
  const qpBdOffsetY = 6 * pictureState.sequenceParameterSet.bitDepthLumaMinus8;
  if (sliceQpY < -qpBdOffsetY || sliceQpY > 51) {
    throw new AvcSyntaxError("invalid-slice-qp", "AVC SliceQPY is outside the normative bit-depth range.");
  }
  const syntaxState = createSliceSyntaxState(
    pictureState,
    sliceIndex,
    sliceQpY,
    header.pictureParameterSet
  );
  if (header.pictureParameterSet.entropyCodingModeFlag) {
    const bitReader = new RbspBitReader(header.rbsp, header.headerBitOffset);
    bitReader.alignToByte(1);
    const cabacBytes = header.rbsp.subarray(bitReader.bitOffset >> 3);
    const cabacDecoder = new CabacArithmeticReader(cabacBytes);
    syntaxState.cabacDecoder = cabacDecoder;
    syntaxState.cabacContexts = header.sliceType === SLICE_TYPE_I
      ? createIntraCabacContextModels(sliceQpY)
      : createPredictiveCabacContextModels(sliceQpY, header.cabacInitIdc);
    let macroblockAddress = header.firstMbInSlice;
    for (;;) {
      if (macroblockAddress >= endMacroblockAddress) {
        throw new AvcSyntaxError("missing-end-of-slice", "AVC CABAC slice did not terminate before the next slice.");
      }
      if (header.sliceType === SLICE_TYPE_P) {
        decodeCabacPredictiveMacroblock(syntaxState, macroblockAddress, header);
      } else if (header.sliceType === SLICE_TYPE_B) {
        decodeCabacBipredictiveMacroblock(syntaxState, macroblockAddress, header);
      } else {
        decodeCabacIntraMacroblock(syntaxState, macroblockAddress);
      }
      const endOfSlice = cabacDecoder.decodeTerminateBin();
      macroblockAddress += 1;
      if (endOfSlice) {
        if (macroblockAddress !== endMacroblockAddress) {
          throw new AvcSyntaxError(
            "early-end-of-slice",
            "AVC CABAC slice ended at macroblock " + macroblockAddress +
              " before expected boundary " + endMacroblockAddress + "."
          );
        }
        break;
      }
    }
  } else {
    const bitReader = new RbspBitReader(header.rbsp, header.headerBitOffset);
    syntaxState.bitReader = bitReader;
    if (header.sliceType === SLICE_TYPE_P || header.sliceType === SLICE_TYPE_B) {
      decodeCavlcInterSlice(syntaxState, header, endMacroblockAddress);
    } else {
      for (
        let macroblockAddress = header.firstMbInSlice;
        macroblockAddress < endMacroblockAddress;
        macroblockAddress += 1
      ) {
        decodeCavlcIntraMacroblock(syntaxState, macroblockAddress);
      }
    }
    if (bitReader.moreRbspData()) {
      throw new AvcSyntaxError("unconsumed-cavlc-syntax", "AVC CAVLC slice contains unconsumed macroblock syntax.");
    }
  }
  const attributedBits = pictureState.macroblocks
    .slice(header.firstMbInSlice, endMacroblockAddress)
    .reduce((total, macroblock) => total + macroblock.syntaxBits, 0);
  return { nalIndex: nalUnit.index, attributedBits };
}

function createSliceSyntaxState(pictureState, sliceIndex, sliceQpY, pictureParameterSet) {
  return {
    ...pictureState,
    sliceIndex,
    currentQpY: sliceQpY,
    previousMacroblockQpDeltaNonZero: false,
    pictureParameterSet,
    chromaArrayType: pictureState.sequenceParameterSet.chromaArrayType,
    bitDepthY: 8 + pictureState.sequenceParameterSet.bitDepthLumaMinus8,
    bitDepthC: 8 + pictureState.sequenceParameterSet.bitDepthChromaMinus8,
    bitReader: null,
    cabacDecoder: null,
    cabacContexts: null
  };
}

function createMacroblockSyntaxState(sliceState, macroblockAddress) {
  const syntax = {
    sliceIndex: sliceState.sliceIndex,
    mbType: -1,
    rawMbType: -1,
    isIntra: false,
    isSkipped: false,
    isDirect: false,
    interMode: "",
    interPartitions: [],
    transformSize8x8: false,
    intraPredMode16x16: 0,
    intra4x4PredMode: new Int8Array(16),
    intra8x8PredMode: new Int8Array(4),
    intraChromaPredMode: 0,
    cbpLuma: 0,
    cbpChroma: 0,
    qpY: sliceState.currentQpY,
    qpDelta: 0,
    codedBlockFlag: Array.from({ length: 6 }, () => new Uint8Array(16)),
    nonZeroLuma: new Int8Array(16),
    nonZeroChroma: new Int8Array(8),
    directBlockFlags: new Uint8Array(16),
    referenceIndexL0: new Int8Array(16).fill(-1),
    referenceIndexL1: new Int8Array(16).fill(-1),
    motionVectorDifferenceL0X: new Int32Array(16),
    motionVectorDifferenceL0Y: new Int32Array(16),
    motionVectorDifferenceL1X: new Int32Array(16),
    motionVectorDifferenceL1Y: new Int32Array(16),
    partitionSyntaxBits: []
  };
  sliceState.syntaxState[macroblockAddress] = syntax;
  return syntax;
}

const PREDICTIVE_MACROBLOCK_MODE_NAMES = [
  "P_L0_16x16",
  "P_L0_L0_16x8",
  "P_L0_L0_8x16",
  "P_8x8",
  "P_8x8ref0"
];
const PREDICTIVE_SUB_MACROBLOCK_MODE_NAMES = ["P_L0_8x8", "P_L0_8x4", "P_L0_4x8", "P_L0_4x4"];

// H.264 Tables 7-14 and 7-17: B-slice macroblock and sub-macroblock prediction modes.
const BIPREDICTIVE_MACROBLOCK_MODES = [
  { name: "B_Direct_16x16", layout: "16x16", directions: ["Direct"] },
  { name: "B_L0_16x16", layout: "16x16", directions: ["L0"] },
  { name: "B_L1_16x16", layout: "16x16", directions: ["L1"] },
  { name: "B_Bi_16x16", layout: "16x16", directions: ["Bi"] },
  { name: "B_L0_L0_16x8", layout: "16x8", directions: ["L0", "L0"] },
  { name: "B_L0_L0_8x16", layout: "8x16", directions: ["L0", "L0"] },
  { name: "B_L1_L1_16x8", layout: "16x8", directions: ["L1", "L1"] },
  { name: "B_L1_L1_8x16", layout: "8x16", directions: ["L1", "L1"] },
  { name: "B_L0_L1_16x8", layout: "16x8", directions: ["L0", "L1"] },
  { name: "B_L0_L1_8x16", layout: "8x16", directions: ["L0", "L1"] },
  { name: "B_L1_L0_16x8", layout: "16x8", directions: ["L1", "L0"] },
  { name: "B_L1_L0_8x16", layout: "8x16", directions: ["L1", "L0"] },
  { name: "B_L0_Bi_16x8", layout: "16x8", directions: ["L0", "Bi"] },
  { name: "B_L0_Bi_8x16", layout: "8x16", directions: ["L0", "Bi"] },
  { name: "B_L1_Bi_16x8", layout: "16x8", directions: ["L1", "Bi"] },
  { name: "B_L1_Bi_8x16", layout: "8x16", directions: ["L1", "Bi"] },
  { name: "B_Bi_L0_16x8", layout: "16x8", directions: ["Bi", "L0"] },
  { name: "B_Bi_L0_8x16", layout: "8x16", directions: ["Bi", "L0"] },
  { name: "B_Bi_L1_16x8", layout: "16x8", directions: ["Bi", "L1"] },
  { name: "B_Bi_L1_8x16", layout: "8x16", directions: ["Bi", "L1"] },
  { name: "B_Bi_Bi_16x8", layout: "16x8", directions: ["Bi", "Bi"] },
  { name: "B_Bi_Bi_8x16", layout: "8x16", directions: ["Bi", "Bi"] },
  { name: "B_8x8", layout: "8x8", directions: [] }
];

const BIPREDICTIVE_SUB_MACROBLOCK_MODES = [
  { name: "B_Direct_8x8", direction: "Direct", widthInBlocks: 2, heightInBlocks: 2 },
  { name: "B_L0_8x8", direction: "L0", widthInBlocks: 2, heightInBlocks: 2 },
  { name: "B_L1_8x8", direction: "L1", widthInBlocks: 2, heightInBlocks: 2 },
  { name: "B_Bi_8x8", direction: "Bi", widthInBlocks: 2, heightInBlocks: 2 },
  { name: "B_L0_8x4", direction: "L0", widthInBlocks: 2, heightInBlocks: 1 },
  { name: "B_L0_4x8", direction: "L0", widthInBlocks: 1, heightInBlocks: 2 },
  { name: "B_L1_8x4", direction: "L1", widthInBlocks: 2, heightInBlocks: 1 },
  { name: "B_L1_4x8", direction: "L1", widthInBlocks: 1, heightInBlocks: 2 },
  { name: "B_Bi_8x4", direction: "Bi", widthInBlocks: 2, heightInBlocks: 1 },
  { name: "B_Bi_4x8", direction: "Bi", widthInBlocks: 1, heightInBlocks: 2 },
  { name: "B_L0_4x4", direction: "L0", widthInBlocks: 1, heightInBlocks: 1 },
  { name: "B_L1_4x4", direction: "L1", widthInBlocks: 1, heightInBlocks: 1 },
  { name: "B_Bi_4x4", direction: "Bi", widthInBlocks: 1, heightInBlocks: 1 }
];

function decodeCabacPredictiveMacroblock(sliceState, macroblockAddress, sliceHeader) {
  const decoder = sliceState.cabacDecoder;
  const macroblockStartBit = decoder.consumedBitCount;
  const macroblock = createMacroblockSyntaxState(sliceState, macroblockAddress);
  const skipFlagStartBit = decoder.consumedBitCount;
  if (decodeCabacInterSkipFlag(sliceState, macroblockAddress, SLICE_TYPE_P)) {
    macroblock.isSkipped = true;
    macroblock.interMode = "P_Skip";
    configurePredictivePartitions(macroblock, -1, []);
    fillMacroblockBlockRegion(macroblock.referenceIndexL0, macroblock.interPartitions[0], 0);
    addPartitionSyntaxBits(macroblock, 0, decoder.consumedBitCount - skipFlagStartBit);
    macroblock.qpY = sliceState.currentQpY;
    sliceState.previousMacroblockQpDeltaNonZero = false;
    storeMacroblockResult(sliceState, macroblockAddress, decoder.consumedBitCount - macroblockStartBit);
    return;
  }

  const decodedType = decodeCabacPredictiveMacroblockType(sliceState, macroblockAddress);
  if (decodedType.isIntra) {
    macroblock.isIntra = true;
    macroblock.mbType = decodedType.mbType;
    macroblock.rawMbType = 5 + decodedType.mbType;
    decodeCabacIntraMacroblockSyntax(sliceState, macroblockAddress, macroblock);
  } else {
    macroblock.mbType = decodedType.mbType;
    macroblock.rawMbType = decodedType.mbType;
    macroblock.interMode = PREDICTIVE_MACROBLOCK_MODE_NAMES[decodedType.mbType];
    const subMacroblockTypes = [];
    const subMacroblockSyntaxBits = [];
    if (decodedType.mbType === 3) {
      for (let groupIndex = 0; groupIndex < 4; groupIndex += 1) {
        const startBit = decoder.consumedBitCount;
        subMacroblockTypes.push(decodeCabacPredictiveSubMacroblockType(sliceState));
        subMacroblockSyntaxBits.push(decoder.consumedBitCount - startBit);
      }
    }
    configurePredictivePartitions(macroblock, decodedType.mbType, subMacroblockTypes);
    for (let groupIndex = 0; groupIndex < subMacroblockSyntaxBits.length; groupIndex += 1) {
      const firstPartitionIndex = macroblock.interPartitions.findIndex(
        (partition) => partition.referenceGroupIndex === groupIndex
      );
      addPartitionSyntaxBits(macroblock, firstPartitionIndex, subMacroblockSyntaxBits[groupIndex]);
    }
    decodeCabacPredictiveMotionSyntax(sliceState, macroblockAddress, sliceHeader);
    [macroblock.cbpLuma, macroblock.cbpChroma] = decodeCabacCodedBlockPattern(
      sliceState,
      macroblockAddress
    );
    if (canSignalInterTransformSize8x8Flag(sliceState, macroblock)) {
      macroblock.transformSize8x8 = decodeCabacTransformSize8x8Flag(sliceState, macroblockAddress);
    }
    if (macroblock.cbpLuma > 0 || macroblock.cbpChroma > 0) {
      macroblock.qpDelta = decodeCabacMacroblockQpDelta(sliceState);
      updateMacroblockQp(sliceState, macroblock);
      sliceState.previousMacroblockQpDeltaNonZero = macroblock.qpDelta !== 0;
    } else {
      macroblock.qpY = sliceState.currentQpY;
      sliceState.previousMacroblockQpDeltaNonZero = false;
    }
    decodeCabacMacroblockResidual(sliceState, macroblockAddress);
  }
  storeMacroblockResult(sliceState, macroblockAddress, decoder.consumedBitCount - macroblockStartBit);
}

function decodeCabacBipredictiveMacroblock(sliceState, macroblockAddress, sliceHeader) {
  const decoder = sliceState.cabacDecoder;
  const macroblockStartBit = decoder.consumedBitCount;
  const macroblock = createMacroblockSyntaxState(sliceState, macroblockAddress);
  const skipFlagStartBit = decoder.consumedBitCount;
  if (decodeCabacInterSkipFlag(sliceState, macroblockAddress, SLICE_TYPE_B)) {
    macroblock.isSkipped = true;
    macroblock.isDirect = true;
    macroblock.interMode = "B_Skip";
    configureBipredictivePartitions(
      macroblock,
      -1,
      [],
      sliceState.sequenceParameterSet.direct8x8InferenceFlag
    );
    addPartitionSyntaxBits(macroblock, 0, decoder.consumedBitCount - skipFlagStartBit);
    macroblock.qpY = sliceState.currentQpY;
    sliceState.previousMacroblockQpDeltaNonZero = false;
    storeMacroblockResult(sliceState, macroblockAddress, decoder.consumedBitCount - macroblockStartBit);
    return;
  }

  const decodedType = decodeCabacBipredictiveMacroblockType(sliceState, macroblockAddress);
  if (decodedType.isIntra) {
    macroblock.isIntra = true;
    macroblock.mbType = decodedType.mbType;
    macroblock.rawMbType = 23 + decodedType.mbType;
    decodeCabacIntraMacroblockSyntax(sliceState, macroblockAddress, macroblock);
  } else {
    macroblock.mbType = decodedType.mbType;
    macroblock.rawMbType = decodedType.mbType;
    macroblock.interMode = BIPREDICTIVE_MACROBLOCK_MODES[decodedType.mbType].name;
    macroblock.isDirect = decodedType.mbType === 0;
    const subMacroblockTypes = [];
    const subMacroblockSyntaxBits = [];
    if (decodedType.mbType === 22) {
      for (let groupIndex = 0; groupIndex < 4; groupIndex += 1) {
        const startBit = decoder.consumedBitCount;
        subMacroblockTypes.push(decodeCabacBipredictiveSubMacroblockType(sliceState));
        subMacroblockSyntaxBits.push(decoder.consumedBitCount - startBit);
      }
    }
    configureBipredictivePartitions(
      macroblock,
      decodedType.mbType,
      subMacroblockTypes,
      sliceState.sequenceParameterSet.direct8x8InferenceFlag
    );
    for (let groupIndex = 0; groupIndex < subMacroblockSyntaxBits.length; groupIndex += 1) {
      const firstPartitionIndex = macroblock.interPartitions.findIndex(
        (partition) => partition.referenceGroupIndex === groupIndex
      );
      addPartitionSyntaxBits(macroblock, firstPartitionIndex, subMacroblockSyntaxBits[groupIndex]);
    }
    decodeCabacInterMotionSyntax(sliceState, macroblockAddress, sliceHeader, 2);
    [macroblock.cbpLuma, macroblock.cbpChroma] = decodeCabacCodedBlockPattern(
      sliceState,
      macroblockAddress
    );
    if (canSignalInterTransformSize8x8Flag(sliceState, macroblock)) {
      macroblock.transformSize8x8 = decodeCabacTransformSize8x8Flag(sliceState, macroblockAddress);
    }
    if (macroblock.cbpLuma > 0 || macroblock.cbpChroma > 0) {
      macroblock.qpDelta = decodeCabacMacroblockQpDelta(sliceState);
      updateMacroblockQp(sliceState, macroblock);
      sliceState.previousMacroblockQpDeltaNonZero = macroblock.qpDelta !== 0;
    } else {
      macroblock.qpY = sliceState.currentQpY;
      sliceState.previousMacroblockQpDeltaNonZero = false;
    }
    decodeCabacMacroblockResidual(sliceState, macroblockAddress);
  }
  storeMacroblockResult(sliceState, macroblockAddress, decoder.consumedBitCount - macroblockStartBit);
}

function decodeCabacBipredictiveMacroblockType(sliceState, macroblockAddress) {
  const decoder = sliceState.cabacDecoder;
  const contexts = sliceState.cabacContexts;
  let contextIncrement = 0;
  const left = getMacroblockNeighbor(sliceState, macroblockAddress, -1, 0);
  const top = getMacroblockNeighbor(sliceState, macroblockAddress, 0, -1);
  if (left && !left.isDirect) contextIncrement += 1;
  if (top && !top.isDirect) contextIncrement += 1;
  if (decoder.decodeContextBin(contexts, 27 + contextIncrement) === 0) {
    return { isIntra: false, mbType: 0 };
  }
  if (decoder.decodeContextBin(contexts, 30) === 0) {
    return { isIntra: false, mbType: 1 + decoder.decodeContextBin(contexts, 32) };
  }

  let code = decoder.decodeContextBin(contexts, 31) << 3;
  code |= decoder.decodeContextBin(contexts, 32) << 2;
  code |= decoder.decodeContextBin(contexts, 32) << 1;
  code |= decoder.decodeContextBin(contexts, 32);
  if (code < 8) return { isIntra: false, mbType: code + 3 };
  if (code === 13) {
    return {
      isIntra: true,
      mbType: decodeCabacIntraMacroblockType(sliceState, macroblockAddress, 32, false)
    };
  }
  if (code === 14) return { isIntra: false, mbType: 11 };
  if (code === 15) return { isIntra: false, mbType: 22 };
  code = (code << 1) | decoder.decodeContextBin(contexts, 32);
  const mbType = code - 4;
  if (mbType < 12 || mbType > 21) {
    throw new AvcSyntaxError("invalid-bipredictive-macroblock-type", "Invalid AVC B-slice mb_type.");
  }
  return { isIntra: false, mbType };
}

function decodeCabacBipredictiveSubMacroblockType(sliceState) {
  const decoder = sliceState.cabacDecoder;
  const contexts = sliceState.cabacContexts;
  if (decoder.decodeContextBin(contexts, 36) === 0) return 0;
  if (decoder.decodeContextBin(contexts, 37) === 0) {
    return 1 + decoder.decodeContextBin(contexts, 39);
  }
  let subMacroblockType = 3;
  if (decoder.decodeContextBin(contexts, 38) === 1) {
    if (decoder.decodeContextBin(contexts, 39) === 1) {
      return 11 + decoder.decodeContextBin(contexts, 39);
    }
    subMacroblockType += 4;
  }
  subMacroblockType += 2 * decoder.decodeContextBin(contexts, 39);
  subMacroblockType += decoder.decodeContextBin(contexts, 39);
  return subMacroblockType;
}

function decodeCabacInterSkipFlag(sliceState, macroblockAddress, sliceType) {
  let contextIncrement = 0;
  const left = getMacroblockNeighbor(sliceState, macroblockAddress, -1, 0);
  const top = getMacroblockNeighbor(sliceState, macroblockAddress, 0, -1);
  if (left && !left.isSkipped) contextIncrement += 1;
  if (top && !top.isSkipped) contextIncrement += 1;
  const contextBase = sliceType === SLICE_TYPE_B ? 24 : 11;
  return sliceState.cabacDecoder.decodeContextBin(
    sliceState.cabacContexts,
    contextBase + contextIncrement
  ) === 1;
}

function decodeCabacPredictiveMacroblockType(sliceState, macroblockAddress) {
  const decoder = sliceState.cabacDecoder;
  const contexts = sliceState.cabacContexts;
  if (decoder.decodeContextBin(contexts, 14) === 1) {
    return {
      isIntra: true,
      mbType: decodeCabacIntraMacroblockType(sliceState, macroblockAddress, 17, false)
    };
  }
  if (decoder.decodeContextBin(contexts, 15) === 0) {
    return { isIntra: false, mbType: 3 * decoder.decodeContextBin(contexts, 16) };
  }
  return { isIntra: false, mbType: 2 - decoder.decodeContextBin(contexts, 17) };
}

function decodeCabacPredictiveSubMacroblockType(sliceState) {
  const decoder = sliceState.cabacDecoder;
  const contexts = sliceState.cabacContexts;
  if (decoder.decodeContextBin(contexts, 21) === 1) return 0;
  if (decoder.decodeContextBin(contexts, 22) === 0) return 1;
  return decoder.decodeContextBin(contexts, 23) === 1 ? 2 : 3;
}

function decodeCabacPredictiveMotionSyntax(sliceState, macroblockAddress, sliceHeader) {
  decodeCabacInterMotionSyntax(sliceState, macroblockAddress, sliceHeader, 1);
}

function decodeCabacInterMotionSyntax(sliceState, macroblockAddress, sliceHeader, listCount) {
  const macroblock = sliceState.syntaxState[macroblockAddress];
  const referenceGroups = getPredictiveReferenceGroups(macroblock);
  for (let listIndex = 0; listIndex < listCount; listIndex += 1) {
    const maximumReferenceIndex = listIndex === 0
      ? sliceHeader.numRefIdxL0ActiveMinus1
      : sliceHeader.numRefIdxL1ActiveMinus1;
    const referenceIndexValues = macroblock[listIndex === 0 ? "referenceIndexL0" : "referenceIndexL1"];
    for (const group of referenceGroups) {
      if (!groupUsesReferenceList(group, listIndex)) continue;
      const startBit = sliceState.cabacDecoder.consumedBitCount;
      const referenceIndex = (
        (listCount === 1 && listIndex === 0 && macroblock.rawMbType === 4) ||
        maximumReferenceIndex === 0
      )
        ? 0
        : decodeCabacReferenceIndex(
          sliceState,
          macroblockAddress,
          group,
          listIndex,
          listCount === 2
        );
      if (referenceIndex > maximumReferenceIndex) {
        throw new AvcSyntaxError(
          "reference-index-out-of-range",
          "AVC ref_idx_l" + listIndex + " value " + referenceIndex +
            " exceeds active maximum " + maximumReferenceIndex +
            " at macroblock " + macroblockAddress + " (" + macroblock.interMode + ")."
        );
      }
      fillMacroblockBlockRegion(referenceIndexValues, group, referenceIndex);
      addPartitionSyntaxBits(
        macroblock,
        group.firstPartitionIndex,
        sliceState.cabacDecoder.consumedBitCount - startBit
      );
    }
  }

  for (let listIndex = 0; listIndex < listCount; listIndex += 1) {
    const horizontalValues = macroblock[
      listIndex === 0 ? "motionVectorDifferenceL0X" : "motionVectorDifferenceL1X"
    ];
    const verticalValues = macroblock[
      listIndex === 0 ? "motionVectorDifferenceL0Y" : "motionVectorDifferenceL1Y"
    ];
    const horizontalComponentName = listIndex === 0
      ? "motionVectorDifferenceL0X"
      : "motionVectorDifferenceL1X";
    const verticalComponentName = listIndex === 0
      ? "motionVectorDifferenceL0Y"
      : "motionVectorDifferenceL1Y";
    for (let partitionIndex = 0; partitionIndex < macroblock.interPartitions.length; partitionIndex += 1) {
      const partition = macroblock.interPartitions[partitionIndex];
      if (!partitionUsesReferenceList(partition, listIndex)) continue;
      const startBit = sliceState.cabacDecoder.consumedBitCount;
      const differenceX = decodeCabacMotionVectorDifference(
        sliceState,
        macroblockAddress,
        partition,
        horizontalComponentName,
        40
      );
      const differenceY = decodeCabacMotionVectorDifference(
        sliceState,
        macroblockAddress,
        partition,
        verticalComponentName,
        47
      );
      fillMacroblockBlockRegion(horizontalValues, partition, differenceX);
      fillMacroblockBlockRegion(verticalValues, partition, differenceY);
      addPartitionSyntaxBits(
        macroblock,
        partitionIndex,
        sliceState.cabacDecoder.consumedBitCount - startBit
      );
    }
  }
}

function decodeCabacReferenceIndex(
  sliceState,
  macroblockAddress,
  group,
  listIndex,
  excludeDirectNeighbors
) {
  const referenceArrayName = listIndex === 0 ? "referenceIndexL0" : "referenceIndexL1";
  const leftReferenceIndex = getNeighborReferenceIndex(
    sliceState,
    macroblockAddress,
    group.blockX - 1,
    group.blockY,
    referenceArrayName,
    excludeDirectNeighbors
  );
  const topReferenceIndex = getNeighborReferenceIndex(
    sliceState,
    macroblockAddress,
    group.blockX,
    group.blockY - 1,
    referenceArrayName,
    excludeDirectNeighbors
  );
  let contextIncrement = Number(leftReferenceIndex > 0) + 2 * Number(topReferenceIndex > 0);
  let referenceIndex = 0;
  while (sliceState.cabacDecoder.decodeContextBin(sliceState.cabacContexts, 54 + contextIncrement) === 1) {
    referenceIndex += 1;
    if (referenceIndex > 31) {
      throw new AvcSyntaxError(
        "reference-index-too-large",
        "AVC ref_idx_l" + listIndex + " exceeds 31."
      );
    }
    contextIncrement = (contextIncrement >> 2) + 4;
  }
  return referenceIndex;
}

function decodeCabacMotionVectorDifference(
  sliceState,
  macroblockAddress,
  partition,
  componentName,
  contextBase
) {
  const leftDifference = getNeighborMotionVectorDifference(
    sliceState,
    macroblockAddress,
    partition.blockX - 1,
    partition.blockY,
    componentName
  );
  const topDifference = getNeighborMotionVectorDifference(
    sliceState,
    macroblockAddress,
    partition.blockX,
    partition.blockY - 1,
    componentName
  );
  const neighboringMagnitude = Math.abs(leftDifference) + Math.abs(topDifference);
  const contextIncrement = neighboringMagnitude < 3 ? 0 : neighboringMagnitude > 32 ? 2 : 1;
  const decoder = sliceState.cabacDecoder;
  const contexts = sliceState.cabacContexts;
  if (decoder.decodeContextBin(contexts, contextBase + contextIncrement) === 0) return 0;

  let magnitude = 1;
  let unaryContextIndex = contextBase + 3;
  while (magnitude < 9 && decoder.decodeContextBin(contexts, unaryContextIndex) === 1) {
    if (magnitude < 4) unaryContextIndex += 1;
    magnitude += 1;
  }
  if (magnitude >= 9) {
    let suffixLength = 3;
    while (decoder.decodeBypassBin() === 1) {
      magnitude += 2 ** suffixLength;
      suffixLength += 1;
      if (suffixLength > 24) {
        throw new AvcSyntaxError("motion-vector-difference-too-large", "AVC mvd_l0 is too large.");
      }
    }
    while (suffixLength > 0) {
      suffixLength -= 1;
      magnitude += decoder.decodeBypassBin() * (2 ** suffixLength);
    }
  }
  return decoder.decodeBypassBin() === 1 ? -magnitude : magnitude;
}

function configurePredictivePartitions(macroblock, macroblockType, subMacroblockTypes) {
  const partitions = [];
  const addPartition = (
    blockX,
    blockY,
    blockWidth,
    blockHeight,
    type,
    referenceGroupIndex,
    subMacroblockType = -1
  ) => {
    partitions.push({
      partitionIndex: partitions.length,
      blockX,
      blockY,
      blockWidth,
      blockHeight,
      codedLeft: blockX * 4,
      codedTop: blockY * 4,
      codedWidth: blockWidth * 4,
      codedHeight: blockHeight * 4,
      type,
      referenceGroupIndex,
      subMacroblockType,
      predictionDirection: "L0",
      usesList0: true,
      usesList1: false,
      direct: false
    });
  };

  if (macroblockType < 0) {
    addPartition(0, 0, 4, 4, "P_Skip", 0);
  } else if (macroblockType === 0) {
    addPartition(0, 0, 4, 4, PREDICTIVE_MACROBLOCK_MODE_NAMES[0], 0);
  } else if (macroblockType === 1) {
    addPartition(0, 0, 4, 2, PREDICTIVE_MACROBLOCK_MODE_NAMES[1], 0);
    addPartition(0, 2, 4, 2, PREDICTIVE_MACROBLOCK_MODE_NAMES[1], 1);
  } else if (macroblockType === 2) {
    addPartition(0, 0, 2, 4, PREDICTIVE_MACROBLOCK_MODE_NAMES[2], 0);
    addPartition(2, 0, 2, 4, PREDICTIVE_MACROBLOCK_MODE_NAMES[2], 1);
  } else if (macroblockType === 3 || macroblockType === 4) {
    for (let groupIndex = 0; groupIndex < 4; groupIndex += 1) {
      const groupBlockX = (groupIndex % 2) * 2;
      const groupBlockY = Math.floor(groupIndex / 2) * 2;
      const subMacroblockType = subMacroblockTypes[groupIndex];
      const type = PREDICTIVE_SUB_MACROBLOCK_MODE_NAMES[subMacroblockType];
      if (!type) {
        throw new AvcSyntaxError("invalid-sub-macroblock-type", "Invalid AVC P sub_mb_type.");
      }
      if (subMacroblockType === 0) {
        addPartition(groupBlockX, groupBlockY, 2, 2, type, groupIndex, subMacroblockType);
      } else if (subMacroblockType === 1) {
        addPartition(groupBlockX, groupBlockY, 2, 1, type, groupIndex, subMacroblockType);
        addPartition(groupBlockX, groupBlockY + 1, 2, 1, type, groupIndex, subMacroblockType);
      } else if (subMacroblockType === 2) {
        addPartition(groupBlockX, groupBlockY, 1, 2, type, groupIndex, subMacroblockType);
        addPartition(groupBlockX + 1, groupBlockY, 1, 2, type, groupIndex, subMacroblockType);
      } else {
        addPartition(groupBlockX, groupBlockY, 1, 1, type, groupIndex, subMacroblockType);
        addPartition(groupBlockX + 1, groupBlockY, 1, 1, type, groupIndex, subMacroblockType);
        addPartition(groupBlockX, groupBlockY + 1, 1, 1, type, groupIndex, subMacroblockType);
        addPartition(groupBlockX + 1, groupBlockY + 1, 1, 1, type, groupIndex, subMacroblockType);
      }
    }
  } else {
    throw new AvcSyntaxError("invalid-predictive-macroblock-type", "Invalid AVC P-slice mb_type.");
  }
  macroblock.interPartitions = partitions;
}

function configureBipredictivePartitions(
  macroblock,
  macroblockType,
  subMacroblockTypes,
  direct8x8InferenceFlag
) {
  const partitions = [];
  const addPartition = (
    blockX,
    blockY,
    blockWidth,
    blockHeight,
    type,
    direction,
    referenceGroupIndex,
    subMacroblockType = -1
  ) => {
    const direct = direction === "Direct";
    const partition = {
      partitionIndex: partitions.length,
      blockX,
      blockY,
      blockWidth,
      blockHeight,
      codedLeft: blockX * 4,
      codedTop: blockY * 4,
      codedWidth: blockWidth * 4,
      codedHeight: blockHeight * 4,
      type,
      referenceGroupIndex,
      subMacroblockType,
      predictionDirection: direction,
      usesList0: direction === "L0" || direction === "Bi",
      usesList1: direction === "L1" || direction === "Bi",
      direct
    };
    partitions.push(partition);
    if (direct) fillMacroblockBlockRegion(macroblock.directBlockFlags, partition, 1);
  };

  if (macroblockType < 0) {
    addPartition(0, 0, 4, 4, "B_Skip", "Direct", 0);
  } else {
    const mode = BIPREDICTIVE_MACROBLOCK_MODES[macroblockType];
    if (!mode) {
      throw new AvcSyntaxError(
        "invalid-bipredictive-macroblock-type",
        "Invalid AVC B-slice mb_type " + macroblockType + "."
      );
    }
    if (mode.layout === "16x16") {
      addPartition(0, 0, 4, 4, mode.name, mode.directions[0], 0);
    } else if (mode.layout === "16x8") {
      addPartition(0, 0, 4, 2, mode.name, mode.directions[0], 0);
      addPartition(0, 2, 4, 2, mode.name, mode.directions[1], 1);
    } else if (mode.layout === "8x16") {
      addPartition(0, 0, 2, 4, mode.name, mode.directions[0], 0);
      addPartition(2, 0, 2, 4, mode.name, mode.directions[1], 1);
    } else {
      if (subMacroblockTypes.length !== 4) {
        throw new AvcSyntaxError(
          "invalid-sub-macroblock-count",
          "AVC B_8x8 requires four sub_mb_type values."
        );
      }
      for (let groupIndex = 0; groupIndex < 4; groupIndex += 1) {
        const groupBlockX = (groupIndex % 2) * 2;
        const groupBlockY = Math.floor(groupIndex / 2) * 2;
        const subMacroblockType = subMacroblockTypes[groupIndex];
        const subMode = BIPREDICTIVE_SUB_MACROBLOCK_MODES[subMacroblockType];
        if (!subMode) {
          throw new AvcSyntaxError(
            "invalid-sub-macroblock-type",
            "Invalid AVC B-slice sub_mb_type " + subMacroblockType + "."
          );
        }
        const widthInBlocks = subMode.direction === "Direct" && !direct8x8InferenceFlag
          ? 1
          : subMode.widthInBlocks;
        const heightInBlocks = subMode.direction === "Direct" && !direct8x8InferenceFlag
          ? 1
          : subMode.heightInBlocks;
        for (let blockY = 0; blockY < 2; blockY += heightInBlocks) {
          for (let blockX = 0; blockX < 2; blockX += widthInBlocks) {
            addPartition(
              groupBlockX + blockX,
              groupBlockY + blockY,
              widthInBlocks,
              heightInBlocks,
              subMode.name,
              subMode.direction,
              groupIndex,
              subMacroblockType
            );
          }
        }
      }
    }
  }
  macroblock.interPartitions = partitions;
}

function getPredictiveReferenceGroups(macroblock) {
  const groupsByIndex = new Map();
  for (let partitionIndex = 0; partitionIndex < macroblock.interPartitions.length; partitionIndex += 1) {
    const partition = macroblock.interPartitions[partitionIndex];
    let group = groupsByIndex.get(partition.referenceGroupIndex);
    if (!group) {
      group = {
        referenceGroupIndex: partition.referenceGroupIndex,
        firstPartitionIndex: partitionIndex,
        blockX: partition.blockX,
        blockY: partition.blockY,
        blockRight: partition.blockX + partition.blockWidth,
        blockBottom: partition.blockY + partition.blockHeight,
        usesList0: Boolean(partition.usesList0),
        usesList1: Boolean(partition.usesList1)
      };
      groupsByIndex.set(partition.referenceGroupIndex, group);
    } else {
      group.blockX = Math.min(group.blockX, partition.blockX);
      group.blockY = Math.min(group.blockY, partition.blockY);
      group.blockRight = Math.max(group.blockRight, partition.blockX + partition.blockWidth);
      group.blockBottom = Math.max(group.blockBottom, partition.blockY + partition.blockHeight);
      group.usesList0 = group.usesList0 || Boolean(partition.usesList0);
      group.usesList1 = group.usesList1 || Boolean(partition.usesList1);
    }
  }
  return Array.from(groupsByIndex.values()).sort(
    (left, right) => left.referenceGroupIndex - right.referenceGroupIndex
  ).map((group) => ({
    ...group,
    blockWidth: group.blockRight - group.blockX,
    blockHeight: group.blockBottom - group.blockY
  }));
}

function partitionUsesReferenceList(partition, listIndex) {
  return listIndex === 0 ? Boolean(partition.usesList0) : Boolean(partition.usesList1);
}

function groupUsesReferenceList(group, listIndex) {
  return listIndex === 0 ? Boolean(group.usesList0) : Boolean(group.usesList1);
}

function fillMacroblockBlockRegion(values, region, value) {
  for (let blockY = region.blockY; blockY < region.blockY + region.blockHeight; blockY += 1) {
    for (let blockX = region.blockX; blockX < region.blockX + region.blockWidth; blockX += 1) {
      values[blockY * 4 + blockX] = value;
    }
  }
}

function addPartitionSyntaxBits(macroblock, partitionIndex, syntaxBits) {
  if (partitionIndex < 0 || !Number.isFinite(syntaxBits) || syntaxBits <= 0) return;
  macroblock.partitionSyntaxBits[partitionIndex] = (macroblock.partitionSyntaxBits[partitionIndex] || 0) + syntaxBits;
}

function getNeighborReferenceIndex(
  sliceState,
  macroblockAddress,
  blockX,
  blockY,
  referenceArrayName = "referenceIndexL0",
  excludeDirectNeighbors = false
) {
  const target = getMacroblockBlockTarget(sliceState, macroblockAddress, blockX, blockY);
  if (!target || target.macroblock.isIntra) return -1;
  const blockIndex = target.blockY * 4 + target.blockX;
  if (excludeDirectNeighbors && target.macroblock.directBlockFlags[blockIndex]) return -1;
  if (target.macroblock.isSkipped) return 0;
  return target.macroblock[referenceArrayName][blockIndex];
}

function getNeighborMotionVectorDifference(
  sliceState,
  macroblockAddress,
  blockX,
  blockY,
  componentName
) {
  const target = getMacroblockBlockTarget(sliceState, macroblockAddress, blockX, blockY);
  if (!target || target.macroblock.isIntra || target.macroblock.isSkipped) return 0;
  const blockIndex = target.blockY * 4 + target.blockX;
  if (target.macroblock.directBlockFlags[blockIndex]) return 0;
  return target.macroblock[componentName][blockIndex];
}

function getMacroblockBlockTarget(sliceState, macroblockAddress, blockX, blockY) {
  if (blockX >= 0 && blockX < 4 && blockY >= 0 && blockY < 4) {
    const macroblock = sliceState.syntaxState[macroblockAddress];
    return macroblock ? { macroblock, blockX, blockY } : null;
  }
  if (blockX < 0 && blockY >= 0 && blockY < 4) {
    const macroblock = getMacroblockNeighbor(sliceState, macroblockAddress, -1, 0);
    return macroblock ? { macroblock, blockX: 3, blockY } : null;
  }
  if (blockY < 0 && blockX >= 0 && blockX < 4) {
    const macroblock = getMacroblockNeighbor(sliceState, macroblockAddress, 0, -1);
    return macroblock ? { macroblock, blockX, blockY: 3 } : null;
  }
  return null;
}

function canSignalInterTransformSize8x8Flag(sliceState, macroblock) {
  if (!sliceState.pictureParameterSet.transform8x8ModeFlag || macroblock.cbpLuma === 0) return false;
  if (macroblock.isDirect && !sliceState.sequenceParameterSet.direct8x8InferenceFlag) return false;
  return macroblock.interPartitions.every((partition) => (
    partition.codedWidth >= 8 && partition.codedHeight >= 8
  ));
}

function decodeCabacIntraMacroblock(sliceState, macroblockAddress) {
  const decoder = sliceState.cabacDecoder;
  const macroblockStartBit = decoder.consumedBitCount;
  const macroblock = createMacroblockSyntaxState(sliceState, macroblockAddress);
  macroblock.isIntra = true;
  macroblock.mbType = decodeCabacIntraMacroblockType(sliceState, macroblockAddress);
  macroblock.rawMbType = macroblock.mbType;
  decodeCabacIntraMacroblockSyntax(sliceState, macroblockAddress, macroblock);
  const syntaxBits = decoder.consumedBitCount - macroblockStartBit;
  storeMacroblockResult(sliceState, macroblockAddress, syntaxBits);
}

function decodeCabacIntraMacroblockSyntax(sliceState, macroblockAddress, macroblock) {
  const decoder = sliceState.cabacDecoder;
  if (macroblock.mbType === 25) {
    throw new AvcSyntaxError("cabac-ipcm-unsupported", "AVC CABAC I_PCM restart syntax is not supported.");
  }

  if (macroblock.mbType === 0) {
    if (sliceState.pictureParameterSet.transform8x8ModeFlag) {
      macroblock.transformSize8x8 = decodeCabacTransformSize8x8Flag(sliceState, macroblockAddress);
    }
    const predictionBlockCount = macroblock.transformSize8x8 ? 4 : 16;
    for (let blockIndex = 0; blockIndex < predictionBlockCount; blockIndex += 1) {
      const startBit = decoder.consumedBitCount;
      const predictionMode = decodeCabacIntraPredictionMode(sliceState);
      macroblock.partitionSyntaxBits[blockIndex] = decoder.consumedBitCount - startBit;
      if (macroblock.transformSize8x8) {
        macroblock.intra8x8PredMode[blockIndex] = deriveIntra8x8PredictionMode(
          sliceState,
          macroblockAddress,
          blockIndex,
          predictionMode
        );
      } else {
        macroblock.intra4x4PredMode[blockIndex] = deriveIntra4x4PredictionMode(
          sliceState,
          macroblockAddress,
          blockIndex,
          predictionMode
        );
      }
    }
    if (sliceState.chromaArrayType !== 0) {
      macroblock.intraChromaPredMode = decodeCabacIntraChromaPredMode(sliceState, macroblockAddress);
    }
    [macroblock.cbpLuma, macroblock.cbpChroma] = decodeCabacCodedBlockPattern(
      sliceState,
      macroblockAddress
    );
  } else {
    macroblock.intraPredMode16x16 = (macroblock.mbType - 1) % 4;
    macroblock.cbpLuma = Math.floor((macroblock.mbType - 1) / 12) ? 15 : 0;
    macroblock.cbpChroma = Math.floor((macroblock.mbType - 1) / 4) % 3;
    if (sliceState.chromaArrayType !== 0) {
      macroblock.intraChromaPredMode = decodeCabacIntraChromaPredMode(sliceState, macroblockAddress);
    }
  }

  if (macroblock.cbpLuma > 0 || macroblock.cbpChroma > 0 || isIntra16x16Macroblock(macroblock)) {
    macroblock.qpDelta = decodeCabacMacroblockQpDelta(sliceState);
    updateMacroblockQp(sliceState, macroblock);
    sliceState.previousMacroblockQpDeltaNonZero = macroblock.qpDelta !== 0;
  } else {
    sliceState.previousMacroblockQpDeltaNonZero = false;
    macroblock.qpY = sliceState.currentQpY;
  }
  decodeCabacMacroblockResidual(sliceState, macroblockAddress);
}

function decodeCabacIntraMacroblockType(
  sliceState,
  macroblockAddress,
  contextBase = 3,
  intraSlice = true
) {
  const decoder = sliceState.cabacDecoder;
  const contexts = sliceState.cabacContexts;
  let remainingContextBase = contextBase;
  if (intraSlice) {
    let contextIncrement = 0;
    const left = getMacroblockNeighbor(sliceState, macroblockAddress, -1, 0);
    const top = getMacroblockNeighbor(sliceState, macroblockAddress, 0, -1);
    if (left && isIntra16x16OrPcm(left)) contextIncrement += 1;
    if (top && isIntra16x16OrPcm(top)) contextIncrement += 1;
    if (decoder.decodeContextBin(contexts, contextBase + contextIncrement) === 0) return 0;
    remainingContextBase += 2;
  } else if (decoder.decodeContextBin(contexts, contextBase) === 0) {
    return 0;
  }
  if (decoder.decodeTerminateBin() === 1) return 25;
  const codedBlockPatternLuma = decoder.decodeContextBin(contexts, remainingContextBase + 1);
  const firstChromaBin = decoder.decodeContextBin(contexts, remainingContextBase + 2);
  let codedBlockPatternChroma = 0;
  if (firstChromaBin === 1) {
    codedBlockPatternChroma = decoder.decodeContextBin(
      contexts,
      remainingContextBase + 2 + Number(intraSlice)
    ) === 1 ? 2 : 1;
  }
  const predictionMode = decoder.decodeContextBin(
    contexts,
    remainingContextBase + 3 + Number(intraSlice)
  ) * 2 + decoder.decodeContextBin(
    contexts,
    remainingContextBase + 3 + 2 * Number(intraSlice)
  );
  return 1 + predictionMode + 4 * codedBlockPatternChroma + (codedBlockPatternLuma ? 12 : 0);
}

function decodeCabacTransformSize8x8Flag(sliceState, macroblockAddress) {
  let contextIncrement = 0;
  const left = getMacroblockNeighbor(sliceState, macroblockAddress, -1, 0);
  const top = getMacroblockNeighbor(sliceState, macroblockAddress, 0, -1);
  if (left && left.transformSize8x8) contextIncrement += 1;
  if (top && top.transformSize8x8) contextIncrement += 1;
  return sliceState.cabacDecoder.decodeContextBin(sliceState.cabacContexts, 399 + contextIncrement) === 1;
}

function decodeCabacIntraPredictionMode(sliceState) {
  const decoder = sliceState.cabacDecoder;
  const contexts = sliceState.cabacContexts;
  if (decoder.decodeContextBin(contexts, 68) === 1) return { previous: true, remainder: -1 };
  let remainder = decoder.decodeContextBin(contexts, 69);
  remainder |= decoder.decodeContextBin(contexts, 69) << 1;
  remainder |= decoder.decodeContextBin(contexts, 69) << 2;
  return { previous: false, remainder };
}

function decodeCabacIntraChromaPredMode(sliceState, macroblockAddress) {
  let contextIncrement = 0;
  const left = getMacroblockNeighbor(sliceState, macroblockAddress, -1, 0);
  const top = getMacroblockNeighbor(sliceState, macroblockAddress, 0, -1);
  if (left && left.intraChromaPredMode !== 0) contextIncrement += 1;
  if (top && top.intraChromaPredMode !== 0) contextIncrement += 1;
  const decoder = sliceState.cabacDecoder;
  const contexts = sliceState.cabacContexts;
  if (decoder.decodeContextBin(contexts, 64 + contextIncrement) === 0) return 0;
  if (decoder.decodeContextBin(contexts, 67) === 0) return 1;
  if (decoder.decodeContextBin(contexts, 67) === 0) return 2;
  return 3;
}

function decodeCabacCodedBlockPattern(sliceState, macroblockAddress) {
  let codedBlockPatternLuma = 0;
  const decoder = sliceState.cabacDecoder;
  const contexts = sliceState.cabacContexts;
  for (let blockIndex = 0; blockIndex < 4; blockIndex += 1) {
    const contextIncrement = deriveCabacCodedBlockPatternLumaContext(
      sliceState,
      macroblockAddress,
      blockIndex,
      codedBlockPatternLuma
    );
    if (decoder.decodeContextBin(contexts, 73 + contextIncrement) === 1) {
      codedBlockPatternLuma |= 1 << blockIndex;
    }
  }
  let codedBlockPatternChroma = 0;
  if (sliceState.chromaArrayType === 1) {
    const firstContextIncrement = deriveCabacCodedBlockPatternChromaContext(
      sliceState,
      macroblockAddress,
      false
    );
    if (decoder.decodeContextBin(contexts, 77 + firstContextIncrement) === 1) {
      const secondContextIncrement = deriveCabacCodedBlockPatternChromaContext(
        sliceState,
        macroblockAddress,
        true
      );
      codedBlockPatternChroma = decoder.decodeContextBin(contexts, 81 + secondContextIncrement) === 1 ? 2 : 1;
    }
  }
  return [codedBlockPatternLuma, codedBlockPatternChroma];
}

function deriveCabacCodedBlockPatternLumaContext(
  sliceState,
  macroblockAddress,
  blockIndex,
  currentCodedBlockPattern
) {
  const leftMacroblock = getMacroblockNeighbor(sliceState, macroblockAddress, -1, 0);
  const topMacroblock = getMacroblockNeighbor(sliceState, macroblockAddress, 0, -1);
  const neighborTerm = (macroblock, mask) => (!macroblock || (macroblock.cbpLuma & mask) !== 0 ? 0 : 1);
  let leftTerm;
  let topTerm;
  if (blockIndex === 0) {
    leftTerm = neighborTerm(leftMacroblock, 2);
    topTerm = neighborTerm(topMacroblock, 4);
  } else if (blockIndex === 1) {
    leftTerm = currentCodedBlockPattern & 1 ? 0 : 1;
    topTerm = neighborTerm(topMacroblock, 8);
  } else if (blockIndex === 2) {
    leftTerm = neighborTerm(leftMacroblock, 8);
    topTerm = currentCodedBlockPattern & 1 ? 0 : 1;
  } else {
    leftTerm = currentCodedBlockPattern & 4 ? 0 : 1;
    topTerm = currentCodedBlockPattern & 2 ? 0 : 1;
  }
  return leftTerm + 2 * topTerm;
}

function deriveCabacCodedBlockPatternChromaContext(sliceState, macroblockAddress, secondBin) {
  const left = getMacroblockNeighbor(sliceState, macroblockAddress, -1, 0);
  const top = getMacroblockNeighbor(sliceState, macroblockAddress, 0, -1);
  const threshold = secondBin ? 1 : 0;
  return Number(Boolean(left && left.cbpChroma > threshold)) +
    2 * Number(Boolean(top && top.cbpChroma > threshold));
}

function decodeCabacMacroblockQpDelta(sliceState) {
  const decoder = sliceState.cabacDecoder;
  const contexts = sliceState.cabacContexts;
  const firstContextIndex = sliceState.previousMacroblockQpDeltaNonZero ? 61 : 60;
  if (decoder.decodeContextBin(contexts, firstContextIndex) === 0) return 0;
  let unaryValue = 1;
  while (decoder.decodeContextBin(contexts, unaryValue > 1 ? 63 : 62) === 1) {
    unaryValue += 1;
    if (unaryValue > 1024) {
      throw new AvcSyntaxError("qp-delta-too-large", "AVC mb_qp_delta unary code is too large.");
    }
  }
  return unaryValue & 1 ? (unaryValue + 1) / 2 : -(unaryValue / 2);
}

function updateMacroblockQp(sliceState, macroblock) {
  const qpBdOffsetY = 6 * (sliceState.bitDepthY - 8);
  const minimumQpDelta = -(26 + qpBdOffsetY / 2);
  const maximumQpDelta = 25 + qpBdOffsetY / 2;
  if (macroblock.qpDelta < minimumQpDelta || macroblock.qpDelta > maximumQpDelta) {
    throw new AvcSyntaxError("invalid-macroblock-qp-delta", "AVC mb_qp_delta is outside the normative range.");
  }
  const qpRange = 52 + qpBdOffsetY;
  // H.264 (08/2024) Equation 7-39: add 52 + 2 * QpBdOffsetY before the modulo operation.
  macroblock.qpY = ((sliceState.currentQpY + macroblock.qpDelta + qpRange + qpBdOffsetY) % qpRange) -
    qpBdOffsetY;
  sliceState.currentQpY = macroblock.qpY;
}

const CABAC_BLOCK_CATEGORY_INTRA_16X16_DC = 0;
const CABAC_BLOCK_CATEGORY_INTRA_16X16_AC = 1;
const CABAC_BLOCK_CATEGORY_LUMA_4X4 = 2;
const CABAC_BLOCK_CATEGORY_CHROMA_DC = 3;
const CABAC_BLOCK_CATEGORY_CHROMA_AC = 4;
const CABAC_BLOCK_CATEGORY_LUMA_8X8 = 5;
// H.264 Tables 9-39 through 9-43: residual context offsets and increments.
const CABAC_CODED_BLOCK_FLAG_OFFSETS = [85, 89, 93, 97, 101, 1012];
const CABAC_SIGNIFICANT_COEFFICIENT_FLAG_OFFSETS = [105, 120, 134, 149, 152, 402];
const CABAC_LAST_SIGNIFICANT_COEFFICIENT_FLAG_OFFSETS = [166, 181, 195, 210, 213, 417];
const CABAC_COEFFICIENT_ABS_LEVEL_MINUS1_OFFSETS = [227, 237, 247, 257, 266, 426];
const CABAC_COEFFICIENT_ABS_LEVEL_EQ1_CONTEXTS = [1, 2, 3, 4, 0, 0, 0, 0];
const CABAC_COEFFICIENT_ABS_LEVEL_GT1_CONTEXTS = [5, 5, 5, 5, 6, 7, 8, 9];
const CABAC_COEFFICIENT_ABS_LEVEL_TRANSITIONS = [
  [1, 2, 3, 3, 4, 5, 6, 7],
  [4, 4, 4, 4, 5, 6, 7, 7]
];
const CABAC_LAST_COEFFICIENT_CONTEXT_8X8 = [
  0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
  2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2,
  3, 3, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4, 4,
  5, 5, 5, 5, 6, 6, 6, 6, 7, 7, 7, 7, 8, 8, 8
];
const CABAC_SIGNIFICANT_COEFFICIENT_CONTEXT_8X8 = [
  0, 1, 2, 3, 4, 5, 5, 4, 4, 3, 3, 4, 4, 4, 5, 5,
  4, 4, 4, 4, 3, 3, 6, 7, 7, 7, 8, 9, 10, 9, 8, 7,
  7, 6, 11, 12, 13, 11, 6, 7, 8, 9, 14, 10, 9, 8, 6, 11,
  12, 13, 11, 6, 9, 14, 10, 9, 11, 12, 13, 11, 14, 10, 12
];
const LUMA_LEFT_NEIGHBOR = [-1, 0, -1, 2, 1, 4, 3, 6, -1, 8, -1, 10, 9, 12, 11, 14];
const LUMA_TOP_NEIGHBOR = [-1, -1, 0, 1, -1, -1, 4, 5, 2, 3, 8, 9, 6, 7, 12, 13];
const LUMA_LEFT_FROM_MACROBLOCK_A = [5, -1, 7, -1, -1, -1, -1, -1, 13, -1, 15, -1, -1, -1, -1, -1];
const LUMA_TOP_FROM_MACROBLOCK_B = [10, 11, -1, -1, 14, 15, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1];

function decodeCabacMacroblockResidual(sliceState, macroblockAddress) {
  const macroblock = sliceState.syntaxState[macroblockAddress];
  if (isIntra16x16Macroblock(macroblock)) {
    addCabacResidualSyntaxBits(
      sliceState,
      macroblockAddress,
      CABAC_BLOCK_CATEGORY_INTRA_16X16_DC,
      0,
      16,
      0
    );
    if (macroblock.cbpLuma > 0) {
      for (let blockIndex = 0; blockIndex < 16; blockIndex += 1) {
        if (macroblock.cbpLuma & (1 << Math.floor(blockIndex / 4))) {
          addCabacResidualSyntaxBits(
            sliceState,
            macroblockAddress,
            CABAC_BLOCK_CATEGORY_INTRA_16X16_AC,
            blockIndex,
            15,
            0
          );
        }
      }
    }
  } else if (macroblock.transformSize8x8) {
    for (let blockIndex = 0; blockIndex < 4; blockIndex += 1) {
      if (macroblock.cbpLuma & (1 << blockIndex)) {
        addCabacResidualSyntaxBits(
          sliceState,
          macroblockAddress,
          CABAC_BLOCK_CATEGORY_LUMA_8X8,
          blockIndex,
          64,
          blockIndex
        );
        macroblock.codedBlockFlag[CABAC_BLOCK_CATEGORY_LUMA_8X8][blockIndex] = 1;
      }
    }
  } else {
    for (let blockIndex = 0; blockIndex < 16; blockIndex += 1) {
      if (macroblock.cbpLuma & (1 << Math.floor(blockIndex / 4))) {
        addCabacResidualSyntaxBits(
          sliceState,
          macroblockAddress,
          CABAC_BLOCK_CATEGORY_LUMA_4X4,
          blockIndex,
          16,
          blockIndex
        );
      }
    }
  }

  if (sliceState.chromaArrayType !== 0 && macroblock.cbpChroma > 0) {
    for (let componentIndex = 0; componentIndex < 2; componentIndex += 1) {
      consumeCabacResidualBlock(
        sliceState,
        macroblockAddress,
        CABAC_BLOCK_CATEGORY_CHROMA_DC,
        componentIndex,
        4
      );
    }
    if (macroblock.cbpChroma > 1) {
      for (let componentIndex = 0; componentIndex < 2; componentIndex += 1) {
        for (let blockIndex = 0; blockIndex < 4; blockIndex += 1) {
          consumeCabacResidualBlock(
            sliceState,
            macroblockAddress,
            CABAC_BLOCK_CATEGORY_CHROMA_AC,
            componentIndex * 4 + blockIndex,
            15
          );
        }
      }
    }
  }
}

function addCabacResidualSyntaxBits(
  sliceState,
  macroblockAddress,
  blockCategory,
  blockIndex,
  maximumCoefficientCount,
  partitionIndex
) {
  const startBit = sliceState.cabacDecoder.consumedBitCount;
  consumeCabacResidualBlock(sliceState, macroblockAddress, blockCategory, blockIndex, maximumCoefficientCount);
  const syntaxBits = sliceState.cabacDecoder.consumedBitCount - startBit;
  const macroblock = sliceState.syntaxState[macroblockAddress];
  const syntaxPartitionIndex = getResidualSyntaxPartitionIndex(
    macroblock,
    blockCategory,
    blockIndex,
    partitionIndex
  );
  addPartitionSyntaxBits(macroblock, syntaxPartitionIndex, syntaxBits);
}

function consumeCabacResidualBlock(
  sliceState,
  macroblockAddress,
  blockCategory,
  blockIndex,
  maximumCoefficientCount
) {
  const decoder = sliceState.cabacDecoder;
  const contexts = sliceState.cabacContexts;
  const macroblock = sliceState.syntaxState[macroblockAddress];
  if (blockCategory !== CABAC_BLOCK_CATEGORY_LUMA_8X8) {
    const contextIncrement = deriveCabacCodedBlockFlagContext(
      sliceState,
      macroblockAddress,
      blockCategory,
      blockIndex
    );
    const contextIndex = CABAC_CODED_BLOCK_FLAG_OFFSETS[blockCategory] + contextIncrement;
    const codedBlockFlag = decoder.decodeContextBin(contexts, contextIndex);
    macroblock.codedBlockFlag[blockCategory][blockIndex] = codedBlockFlag;
    if (codedBlockFlag === 0) return;
  }

  const significantCoefficientPositions = [];
  let explicitlySignalledLast = false;
  for (let coefficientIndex = 0; coefficientIndex < maximumCoefficientCount - 1; coefficientIndex += 1) {
    const significantContextIncrement = blockCategory === CABAC_BLOCK_CATEGORY_LUMA_8X8
      ? CABAC_SIGNIFICANT_COEFFICIENT_CONTEXT_8X8[coefficientIndex]
      : coefficientIndex;
    const significantContextIndex = CABAC_SIGNIFICANT_COEFFICIENT_FLAG_OFFSETS[blockCategory] +
      significantContextIncrement;
    if (decoder.decodeContextBin(contexts, significantContextIndex) === 1) {
      significantCoefficientPositions.push(coefficientIndex);
      const lastContextIncrement = blockCategory === CABAC_BLOCK_CATEGORY_LUMA_8X8
        ? CABAC_LAST_COEFFICIENT_CONTEXT_8X8[coefficientIndex]
        : coefficientIndex;
      const lastContextIndex = CABAC_LAST_SIGNIFICANT_COEFFICIENT_FLAG_OFFSETS[blockCategory] +
        lastContextIncrement;
      if (decoder.decodeContextBin(contexts, lastContextIndex) === 1) {
        explicitlySignalledLast = true;
        break;
      }
    }
  }
  if (!explicitlySignalledLast) significantCoefficientPositions.push(maximumCoefficientCount - 1);
  consumeCabacCoefficientLevels(sliceState, blockCategory, significantCoefficientPositions.length);
}

function consumeCabacCoefficientLevels(sliceState, blockCategory, significantCoefficientCount) {
  const decoder = sliceState.cabacDecoder;
  const contexts = sliceState.cabacContexts;
  let nodeContext = 0;
  const coefficientContextBase = CABAC_COEFFICIENT_ABS_LEVEL_MINUS1_OFFSETS[blockCategory];
  for (let coefficientIndex = significantCoefficientCount - 1; coefficientIndex >= 0; coefficientIndex -= 1) {
    let contextIncrement = CABAC_COEFFICIENT_ABS_LEVEL_EQ1_CONTEXTS[nodeContext];
    const firstBin = decoder.decodeContextBin(contexts, coefficientContextBase + contextIncrement);
    if (firstBin === 0) {
      nodeContext = CABAC_COEFFICIENT_ABS_LEVEL_TRANSITIONS[0][nodeContext];
      decoder.decodeBypassBin();
      continue;
    }

    contextIncrement = CABAC_COEFFICIENT_ABS_LEVEL_GT1_CONTEXTS[nodeContext];
    nodeContext = CABAC_COEFFICIENT_ABS_LEVEL_TRANSITIONS[1][nodeContext];
    let absoluteCoefficientLevel = 2;
    while (absoluteCoefficientLevel < 15) {
      if (decoder.decodeContextBin(contexts, coefficientContextBase + contextIncrement) === 0) break;
      absoluteCoefficientLevel += 1;
    }
    if (absoluteCoefficientLevel >= 15) consumeCabacBypassExpGolombSuffix(decoder);
    decoder.decodeBypassBin();
  }
}

function consumeCabacBypassExpGolombSuffix(decoder) {
  let prefixLength = 0;
  while (decoder.decodeBypassBin() === 1) {
    prefixLength += 1;
    if (prefixLength > 31) {
      throw new AvcSyntaxError("cabac-exp-golomb-too-large", "AVC CABAC bypass Exp-Golomb value is too large.");
    }
  }
  for (let index = 0; index < prefixLength; index += 1) decoder.decodeBypassBin();
}

function deriveCabacCodedBlockFlagContext(sliceState, macroblockAddress, blockCategory, blockIndex) {
  const currentMacroblock = sliceState.syntaxState[macroblockAddress];
  const unavailableTerm = currentMacroblock && currentMacroblock.isIntra ? 1 : 0;
  let leftTerm = unavailableTerm;
  let topTerm = unavailableTerm;
  if (blockCategory === CABAC_BLOCK_CATEGORY_INTRA_16X16_DC) {
    const left = getMacroblockNeighbor(sliceState, macroblockAddress, -1, 0);
    const top = getMacroblockNeighbor(sliceState, macroblockAddress, 0, -1);
    if (left) leftTerm = left.codedBlockFlag[blockCategory][0];
    if (top) topTerm = top.codedBlockFlag[blockCategory][0];
  } else if (
    blockCategory === CABAC_BLOCK_CATEGORY_INTRA_16X16_AC ||
    blockCategory === CABAC_BLOCK_CATEGORY_LUMA_4X4
  ) {
    [leftTerm, topTerm] = deriveLumaBlockNeighborCodedFlag(
      sliceState,
      macroblockAddress,
      blockCategory,
      blockIndex
    );
  } else if (blockCategory === CABAC_BLOCK_CATEGORY_CHROMA_DC) {
    const left = getMacroblockNeighbor(sliceState, macroblockAddress, -1, 0);
    const top = getMacroblockNeighbor(sliceState, macroblockAddress, 0, -1);
    if (left) leftTerm = left.codedBlockFlag[blockCategory][blockIndex];
    if (top) topTerm = top.codedBlockFlag[blockCategory][blockIndex];
  } else if (blockCategory === CABAC_BLOCK_CATEGORY_CHROMA_AC) {
    [leftTerm, topTerm] = deriveChromaAcBlockNeighborCodedFlag(
      sliceState,
      macroblockAddress,
      blockIndex
    );
  }
  return leftTerm + 2 * topTerm;
}

function deriveLumaBlockNeighborCodedFlag(sliceState, macroblockAddress, blockCategory, blockIndex) {
  const macroblock = sliceState.syntaxState[macroblockAddress];
  const unavailableTerm = macroblock && macroblock.isIntra ? 1 : 0;
  let leftTerm = unavailableTerm;
  let topTerm = unavailableTerm;
  const leftBlockIndex = LUMA_LEFT_NEIGHBOR[blockIndex];
  if (leftBlockIndex >= 0) {
    leftTerm = macroblock.codedBlockFlag[blockCategory][leftBlockIndex];
  } else {
    const leftMacroblock = getMacroblockNeighbor(sliceState, macroblockAddress, -1, 0);
    if (leftMacroblock) {
      leftTerm = getLumaBlockCodedFlag(leftMacroblock, LUMA_LEFT_FROM_MACROBLOCK_A[blockIndex]);
    }
  }
  const topBlockIndex = LUMA_TOP_NEIGHBOR[blockIndex];
  if (topBlockIndex >= 0) {
    topTerm = macroblock.codedBlockFlag[blockCategory][topBlockIndex];
  } else {
    const topMacroblock = getMacroblockNeighbor(sliceState, macroblockAddress, 0, -1);
    if (topMacroblock) {
      topTerm = getLumaBlockCodedFlag(topMacroblock, LUMA_TOP_FROM_MACROBLOCK_B[blockIndex]);
    }
  }
  return [leftTerm, topTerm];
}

function getLumaBlockCodedFlag(macroblock, blockIndex) {
  if (macroblock.isIntra && macroblock.mbType === 25) return 1;
  if (isIntra16x16Macroblock(macroblock)) {
    return macroblock.codedBlockFlag[CABAC_BLOCK_CATEGORY_INTRA_16X16_AC][blockIndex];
  }
  if (macroblock.transformSize8x8) {
    return macroblock.codedBlockFlag[CABAC_BLOCK_CATEGORY_LUMA_8X8][Math.floor(blockIndex / 4)];
  }
  if (!isIntra16x16Macroblock(macroblock)) {
    return macroblock.codedBlockFlag[CABAC_BLOCK_CATEGORY_LUMA_4X4][blockIndex];
  }
  return 0;
}

function deriveChromaAcBlockNeighborCodedFlag(sliceState, macroblockAddress, blockIndex) {
  const macroblock = sliceState.syntaxState[macroblockAddress];
  const componentBase = Math.floor(blockIndex / 4) * 4;
  const localBlockIndex = blockIndex % 4;
  const blockX = localBlockIndex % 2;
  const blockY = Math.floor(localBlockIndex / 2);
  const unavailableTerm = macroblock && macroblock.isIntra ? 1 : 0;
  let leftTerm = unavailableTerm;
  let topTerm = unavailableTerm;
  if (blockX > 0) {
    leftTerm = macroblock.codedBlockFlag[CABAC_BLOCK_CATEGORY_CHROMA_AC][componentBase + localBlockIndex - 1];
  } else {
    const left = getMacroblockNeighbor(sliceState, macroblockAddress, -1, 0);
    if (left) {
      leftTerm = left.codedBlockFlag[CABAC_BLOCK_CATEGORY_CHROMA_AC][componentBase + blockY * 2 + 1];
    }
  }
  if (blockY > 0) {
    topTerm = macroblock.codedBlockFlag[CABAC_BLOCK_CATEGORY_CHROMA_AC][componentBase + localBlockIndex - 2];
  } else {
    const top = getMacroblockNeighbor(sliceState, macroblockAddress, 0, -1);
    if (top) topTerm = top.codedBlockFlag[CABAC_BLOCK_CATEGORY_CHROMA_AC][componentBase + 2 + blockX];
  }
  return [leftTerm, topTerm];
}

// H.264 clause 9.2, Tables 9-5 through 9-10: normative CAVLC codeword lengths and values.
const CAVLC_COEFFICIENT_TOKEN_LENGTHS = [
  [
    1, 0, 0, 0, 6, 2, 0, 0, 8, 6, 3, 0, 9, 8, 7, 5, 10, 9, 8, 6,
    11, 10, 9, 7, 13, 11, 10, 8, 13, 13, 11, 9, 13, 13, 13, 10,
    14, 14, 13, 11, 14, 14, 14, 13, 15, 15, 14, 14, 15, 15, 15, 14,
    16, 15, 15, 15, 16, 16, 16, 15, 16, 16, 16, 16, 16, 16, 16, 16
  ],
  [
    2, 0, 0, 0, 6, 2, 0, 0, 6, 5, 3, 0, 7, 6, 6, 4, 8, 6, 6, 4,
    8, 7, 7, 5, 9, 8, 8, 6, 11, 9, 9, 6, 11, 11, 11, 7,
    12, 11, 11, 9, 12, 12, 12, 11, 12, 12, 12, 11, 13, 13, 13, 12,
    13, 13, 13, 13, 13, 14, 13, 13, 14, 14, 14, 13, 14, 14, 14, 14
  ],
  [
    4, 0, 0, 0, 6, 4, 0, 0, 6, 5, 4, 0, 6, 5, 5, 4, 7, 5, 5, 4,
    7, 5, 5, 4, 7, 6, 6, 4, 7, 6, 6, 4, 8, 7, 7, 5,
    8, 8, 7, 6, 9, 8, 8, 7, 9, 9, 8, 8, 9, 9, 9, 8,
    10, 9, 9, 9, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10
  ],
  [
    6, 0, 0, 0, 6, 6, 0, 0, 6, 6, 6, 0, 6, 6, 6, 6, 6, 6, 6, 6,
    6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6,
    6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6,
    6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6
  ]
];

const CAVLC_COEFFICIENT_TOKEN_BITS = [
  [
    1, 0, 0, 0, 5, 1, 0, 0, 7, 4, 1, 0, 7, 6, 5, 3, 7, 6, 5, 3,
    7, 6, 5, 4, 15, 6, 5, 4, 11, 14, 5, 4, 8, 10, 13, 4,
    15, 14, 9, 4, 11, 10, 13, 12, 15, 14, 9, 12, 11, 10, 13, 8,
    15, 1, 9, 12, 11, 14, 13, 8, 7, 10, 9, 12, 4, 6, 5, 8
  ],
  [
    3, 0, 0, 0, 11, 2, 0, 0, 7, 7, 3, 0, 7, 10, 9, 5, 7, 6, 5, 4,
    4, 6, 5, 6, 7, 6, 5, 8, 15, 6, 5, 4, 11, 14, 13, 4,
    15, 10, 9, 4, 11, 14, 13, 12, 8, 10, 9, 8, 15, 14, 13, 12,
    11, 10, 9, 12, 7, 11, 6, 8, 9, 8, 10, 1, 7, 6, 5, 4
  ],
  [
    15, 0, 0, 0, 15, 14, 0, 0, 11, 15, 13, 0, 8, 12, 14, 12, 15, 10, 11, 11,
    11, 8, 9, 10, 9, 14, 13, 9, 8, 10, 9, 8, 15, 14, 13, 13,
    11, 14, 10, 12, 15, 10, 13, 12, 11, 14, 9, 12, 8, 10, 13, 8,
    13, 7, 9, 12, 9, 12, 11, 10, 5, 8, 7, 6, 1, 4, 3, 2
  ],
  [
    3, 0, 0, 0, 0, 1, 0, 0, 4, 5, 6, 0, 8, 9, 10, 11, 12, 13, 14, 15,
    16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31,
    32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47,
    48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63
  ]
];

const CAVLC_CHROMA_DC_COEFFICIENT_TOKEN_LENGTHS = [
  2, 0, 0, 0, 6, 1, 0, 0, 6, 6, 3, 0, 6, 7, 7, 6, 6, 8, 8, 7
];
const CAVLC_CHROMA_DC_COEFFICIENT_TOKEN_BITS = [
  1, 0, 0, 0, 7, 1, 0, 0, 4, 6, 1, 0, 3, 3, 2, 5, 2, 3, 2, 0
];
const CAVLC_TOTAL_ZEROS_LENGTHS = [
  [1, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 9],
  [3, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 6, 6, 6, 6],
  [4, 3, 3, 3, 4, 4, 3, 3, 4, 5, 5, 6, 5, 6],
  [5, 3, 4, 4, 3, 3, 3, 4, 3, 4, 5, 5, 5],
  [4, 4, 4, 3, 3, 3, 3, 3, 4, 5, 4, 5],
  [6, 5, 3, 3, 3, 3, 3, 3, 4, 3, 6],
  [6, 5, 3, 3, 3, 2, 3, 4, 3, 6],
  [6, 4, 5, 3, 2, 2, 3, 3, 6],
  [6, 6, 4, 2, 2, 3, 2, 5],
  [5, 5, 3, 2, 2, 2, 4],
  [4, 4, 3, 3, 1, 3],
  [4, 4, 2, 1, 3],
  [3, 3, 1, 2],
  [2, 2, 1],
  [1, 1]
];
const CAVLC_TOTAL_ZEROS_BITS = [
  [1, 3, 2, 3, 2, 3, 2, 3, 2, 3, 2, 3, 2, 3, 2, 1],
  [7, 6, 5, 4, 3, 5, 4, 3, 2, 3, 2, 3, 2, 1, 0],
  [5, 7, 6, 5, 4, 3, 4, 3, 2, 3, 2, 1, 1, 0],
  [3, 7, 5, 4, 6, 5, 4, 3, 3, 2, 2, 1, 0],
  [5, 4, 3, 7, 6, 5, 4, 3, 2, 1, 1, 0],
  [1, 1, 7, 6, 5, 4, 3, 2, 1, 1, 0],
  [1, 1, 5, 4, 3, 3, 2, 1, 1, 0],
  [1, 1, 1, 3, 3, 2, 2, 1, 0],
  [1, 0, 1, 3, 2, 1, 1, 1],
  [1, 0, 1, 3, 2, 1, 1],
  [0, 1, 1, 2, 1, 3],
  [0, 1, 1, 1, 1],
  [0, 1, 1, 1],
  [0, 1, 1],
  [0, 1]
];
const CAVLC_CHROMA_DC_TOTAL_ZEROS_LENGTHS = [[1, 2, 3, 3], [1, 2, 2, 0], [1, 1, 0, 0]];
const CAVLC_CHROMA_DC_TOTAL_ZEROS_BITS = [[1, 1, 1, 0], [1, 1, 0, 0], [1, 0, 0, 0]];
const CAVLC_RUN_BEFORE_LENGTHS = [
  [1, 1],
  [1, 2, 2],
  [2, 2, 2, 2],
  [2, 2, 2, 3, 3],
  [2, 2, 3, 3, 3, 3],
  [2, 3, 3, 3, 3, 3, 3],
  [3, 3, 3, 3, 3, 3, 3, 4, 5, 6, 7, 8, 9, 10, 11]
];
const CAVLC_RUN_BEFORE_BITS = [
  [1, 0],
  [1, 1, 0],
  [3, 2, 1, 0],
  [3, 2, 1, 1, 0],
  [3, 2, 3, 2, 1, 0],
  [3, 0, 1, 3, 2, 5, 4],
  [7, 6, 5, 4, 3, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1]
];
// H.264 Table 9-4: coded_block_pattern mapping for intra macroblocks with ChromaArrayType 1 or 2.
const CAVLC_INTRA_CODED_BLOCK_PATTERN = [
  47, 31, 15, 0, 23, 27, 29, 30, 7, 11, 13, 14, 39, 43, 45, 46,
  16, 3, 5, 10, 12, 19, 21, 26, 28, 35, 37, 42, 44, 1, 2, 4,
  8, 17, 18, 20, 24, 6, 9, 22, 25, 32, 33, 34, 36, 40, 38, 41
];
const CAVLC_INTER_CODED_BLOCK_PATTERN = [
  0, 16, 1, 2, 4, 8, 32, 3, 5, 10, 12, 15, 47, 7, 11, 13,
  14, 6, 9, 31, 35, 37, 42, 44, 33, 34, 36, 40, 39, 43, 45, 46,
  17, 18, 20, 24, 19, 21, 26, 28, 23, 27, 29, 30, 22, 25, 38, 41
];

function decodeCavlcInterSlice(sliceState, sliceHeader, endMacroblockAddress) {
  const bitReader = sliceState.bitReader;
  let macroblockAddress = sliceHeader.firstMbInSlice;
  while (macroblockAddress < endMacroblockAddress) {
    if (!bitReader.moreRbspData()) {
      throw new AvcSyntaxError("early-end-of-slice", "AVC CAVLC P slice ended before its expected macroblock boundary.");
    }
    const skipRun = bitReader.readUE();
    if (skipRun > endMacroblockAddress - macroblockAddress) {
      throw new AvcSyntaxError("invalid-skip-run", "AVC mb_skip_run exceeds the remaining slice macroblocks.");
    }
    for (let skippedIndex = 0; skippedIndex < skipRun; skippedIndex += 1) {
      decodeCavlcSkippedMacroblock(
        sliceState,
        macroblockAddress,
        sliceHeader.sliceType
      );
      macroblockAddress += 1;
    }
    if (macroblockAddress >= endMacroblockAddress) break;
    if (!bitReader.moreRbspData()) {
      throw new AvcSyntaxError("early-end-of-slice", "AVC CAVLC P slice omitted a coded macroblock after mb_skip_run.");
    }
    if (sliceHeader.sliceType === SLICE_TYPE_B) {
      decodeCavlcBipredictiveMacroblock(
        sliceState,
        macroblockAddress,
        sliceHeader
      );
    } else {
      decodeCavlcPredictiveMacroblock(
        sliceState,
        macroblockAddress,
        sliceHeader
      );
    }
    macroblockAddress += 1;
  }
}

function decodeCavlcSkippedMacroblock(sliceState, macroblockAddress, sliceType) {
  const macroblock = createMacroblockSyntaxState(sliceState, macroblockAddress);
  macroblock.isSkipped = true;
  if (sliceType === SLICE_TYPE_B) {
    macroblock.isDirect = true;
    macroblock.interMode = "B_Skip";
    configureBipredictivePartitions(
      macroblock,
      -1,
      [],
      sliceState.sequenceParameterSet.direct8x8InferenceFlag
    );
  } else {
    macroblock.interMode = "P_Skip";
    configurePredictivePartitions(macroblock, -1, []);
    fillMacroblockBlockRegion(macroblock.referenceIndexL0, macroblock.interPartitions[0], 0);
  }
  macroblock.qpY = sliceState.currentQpY;
  sliceState.previousMacroblockQpDeltaNonZero = false;
  storeMacroblockResult(sliceState, macroblockAddress, 0);
}

function decodeCavlcPredictiveMacroblock(
  sliceState,
  macroblockAddress,
  sliceHeader
) {
  const bitReader = sliceState.bitReader;
  const macroblockStartBit = bitReader.bitOffset;
  const macroblock = createMacroblockSyntaxState(sliceState, macroblockAddress);
  macroblock.rawMbType = bitReader.readUE();
  if (macroblock.rawMbType > 30) {
    throw new AvcSyntaxError(
      "invalid-predictive-macroblock-type",
      "Invalid AVC P-slice mb_type " + macroblock.rawMbType + "."
    );
  }
  if (macroblock.rawMbType >= 5) {
    macroblock.isIntra = true;
    macroblock.mbType = macroblock.rawMbType - 5;
    decodeCavlcIntraMacroblockSyntax(sliceState, macroblockAddress, macroblock);
  } else {
    macroblock.mbType = macroblock.rawMbType;
    macroblock.interMode = PREDICTIVE_MACROBLOCK_MODE_NAMES[macroblock.rawMbType];
    const subMacroblockTypes = [];
    const subMacroblockSyntaxBits = [];
    if (macroblock.rawMbType === 3 || macroblock.rawMbType === 4) {
      for (let groupIndex = 0; groupIndex < 4; groupIndex += 1) {
        const startBit = bitReader.bitOffset;
        const subMacroblockType = bitReader.readUE();
        if (subMacroblockType > 3) {
          throw new AvcSyntaxError(
            "invalid-sub-macroblock-type",
            "Invalid AVC P-slice sub_mb_type " + subMacroblockType + "."
          );
        }
        subMacroblockTypes.push(subMacroblockType);
        subMacroblockSyntaxBits.push(bitReader.bitOffset - startBit);
      }
    }
    configurePredictivePartitions(macroblock, macroblock.rawMbType, subMacroblockTypes);
    for (let groupIndex = 0; groupIndex < subMacroblockSyntaxBits.length; groupIndex += 1) {
      const firstPartitionIndex = macroblock.interPartitions.findIndex(
        (partition) => partition.referenceGroupIndex === groupIndex
      );
      addPartitionSyntaxBits(macroblock, firstPartitionIndex, subMacroblockSyntaxBits[groupIndex]);
    }
    decodeCavlcPredictiveMotionSyntax(sliceState, macroblock, sliceHeader);
    const codedBlockPatternIndex = bitReader.readUE();
    if (codedBlockPatternIndex > 47) {
      throw new AvcSyntaxError("invalid-coded-block-pattern", "Invalid AVC inter coded_block_pattern.");
    }
    const codedBlockPattern = CAVLC_INTER_CODED_BLOCK_PATTERN[codedBlockPatternIndex];
    macroblock.cbpLuma = codedBlockPattern & 0x0f;
    macroblock.cbpChroma = (codedBlockPattern >> 4) & 0x03;
    if (canSignalInterTransformSize8x8Flag(sliceState, macroblock)) {
      macroblock.transformSize8x8 = Boolean(bitReader.readBit());
    }
    if (macroblock.cbpLuma > 0 || macroblock.cbpChroma > 0) {
      macroblock.qpDelta = bitReader.readSE();
      updateMacroblockQp(sliceState, macroblock);
    } else {
      macroblock.qpY = sliceState.currentQpY;
    }
    decodeCavlcMacroblockResidual(sliceState, macroblockAddress);
  }
  const syntaxBits = bitReader.bitOffset - macroblockStartBit;
  storeMacroblockResult(sliceState, macroblockAddress, syntaxBits);
}

function decodeCavlcBipredictiveMacroblock(
  sliceState,
  macroblockAddress,
  sliceHeader
) {
  const bitReader = sliceState.bitReader;
  const macroblockStartBit = bitReader.bitOffset;
  const macroblock = createMacroblockSyntaxState(sliceState, macroblockAddress);
  macroblock.rawMbType = bitReader.readUE();
  if (macroblock.rawMbType > 48) {
    throw new AvcSyntaxError(
      "invalid-bipredictive-macroblock-type",
      "Invalid AVC B-slice mb_type " + macroblock.rawMbType + "."
    );
  }
  if (macroblock.rawMbType >= 23) {
    macroblock.isIntra = true;
    macroblock.mbType = macroblock.rawMbType - 23;
    decodeCavlcIntraMacroblockSyntax(sliceState, macroblockAddress, macroblock);
  } else {
    macroblock.mbType = macroblock.rawMbType;
    macroblock.interMode = BIPREDICTIVE_MACROBLOCK_MODES[macroblock.rawMbType].name;
    macroblock.isDirect = macroblock.rawMbType === 0;
    const subMacroblockTypes = [];
    const subMacroblockSyntaxBits = [];
    if (macroblock.rawMbType === 22) {
      for (let groupIndex = 0; groupIndex < 4; groupIndex += 1) {
        const startBit = bitReader.bitOffset;
        const subMacroblockType = bitReader.readUE();
        if (subMacroblockType > 12) {
          throw new AvcSyntaxError(
            "invalid-sub-macroblock-type",
            "Invalid AVC B-slice sub_mb_type " + subMacroblockType + "."
          );
        }
        subMacroblockTypes.push(subMacroblockType);
        subMacroblockSyntaxBits.push(bitReader.bitOffset - startBit);
      }
    }
    configureBipredictivePartitions(
      macroblock,
      macroblock.rawMbType,
      subMacroblockTypes,
      sliceState.sequenceParameterSet.direct8x8InferenceFlag
    );
    for (let groupIndex = 0; groupIndex < subMacroblockSyntaxBits.length; groupIndex += 1) {
      const firstPartitionIndex = macroblock.interPartitions.findIndex(
        (partition) => partition.referenceGroupIndex === groupIndex
      );
      addPartitionSyntaxBits(macroblock, firstPartitionIndex, subMacroblockSyntaxBits[groupIndex]);
    }
    decodeCavlcInterMotionSyntax(sliceState, macroblock, sliceHeader, 2);
    const codedBlockPatternIndex = bitReader.readUE();
    if (codedBlockPatternIndex > 47) {
      throw new AvcSyntaxError("invalid-coded-block-pattern", "Invalid AVC inter coded_block_pattern.");
    }
    const codedBlockPattern = CAVLC_INTER_CODED_BLOCK_PATTERN[codedBlockPatternIndex];
    macroblock.cbpLuma = codedBlockPattern & 0x0f;
    macroblock.cbpChroma = (codedBlockPattern >> 4) & 0x03;
    if (canSignalInterTransformSize8x8Flag(sliceState, macroblock)) {
      macroblock.transformSize8x8 = Boolean(bitReader.readBit());
    }
    if (macroblock.cbpLuma > 0 || macroblock.cbpChroma > 0) {
      macroblock.qpDelta = bitReader.readSE();
      updateMacroblockQp(sliceState, macroblock);
    } else {
      macroblock.qpY = sliceState.currentQpY;
    }
    decodeCavlcMacroblockResidual(sliceState, macroblockAddress);
  }
  const syntaxBits = bitReader.bitOffset - macroblockStartBit;
  storeMacroblockResult(sliceState, macroblockAddress, syntaxBits);
}

function decodeCavlcPredictiveMotionSyntax(sliceState, macroblock, sliceHeader) {
  decodeCavlcInterMotionSyntax(sliceState, macroblock, sliceHeader, 1);
}

function decodeCavlcInterMotionSyntax(sliceState, macroblock, sliceHeader, listCount) {
  const bitReader = sliceState.bitReader;
  const referenceGroups = getPredictiveReferenceGroups(macroblock);
  for (let listIndex = 0; listIndex < listCount; listIndex += 1) {
    const maximumReferenceIndex = listIndex === 0
      ? sliceHeader.numRefIdxL0ActiveMinus1
      : sliceHeader.numRefIdxL1ActiveMinus1;
    const referenceIndexValues = macroblock[listIndex === 0 ? "referenceIndexL0" : "referenceIndexL1"];
    for (const group of referenceGroups) {
      if (!groupUsesReferenceList(group, listIndex)) continue;
      const startBit = bitReader.bitOffset;
      const referenceIndex = listCount === 1 && listIndex === 0 && macroblock.rawMbType === 4
        ? 0
        : bitReader.readTE(maximumReferenceIndex);
      fillMacroblockBlockRegion(referenceIndexValues, group, referenceIndex);
      addPartitionSyntaxBits(macroblock, group.firstPartitionIndex, bitReader.bitOffset - startBit);
    }
  }
  for (let listIndex = 0; listIndex < listCount; listIndex += 1) {
    const horizontalValues = macroblock[
      listIndex === 0 ? "motionVectorDifferenceL0X" : "motionVectorDifferenceL1X"
    ];
    const verticalValues = macroblock[
      listIndex === 0 ? "motionVectorDifferenceL0Y" : "motionVectorDifferenceL1Y"
    ];
    for (let partitionIndex = 0; partitionIndex < macroblock.interPartitions.length; partitionIndex += 1) {
      const partition = macroblock.interPartitions[partitionIndex];
      if (!partitionUsesReferenceList(partition, listIndex)) continue;
      const startBit = bitReader.bitOffset;
      const differenceX = bitReader.readSE();
      const differenceY = bitReader.readSE();
      fillMacroblockBlockRegion(horizontalValues, partition, differenceX);
      fillMacroblockBlockRegion(verticalValues, partition, differenceY);
      addPartitionSyntaxBits(macroblock, partitionIndex, bitReader.bitOffset - startBit);
    }
  }
}

function decodeCavlcIntraMacroblock(sliceState, macroblockAddress) {
  const bitReader = sliceState.bitReader;
  const macroblockStartBit = bitReader.bitOffset;
  const macroblock = createMacroblockSyntaxState(sliceState, macroblockAddress);
  macroblock.isIntra = true;
  macroblock.mbType = bitReader.readUE();
  macroblock.rawMbType = macroblock.mbType;
  decodeCavlcIntraMacroblockSyntax(sliceState, macroblockAddress, macroblock);
  storeMacroblockResult(sliceState, macroblockAddress, bitReader.bitOffset - macroblockStartBit);
}

function decodeCavlcIntraMacroblockSyntax(sliceState, macroblockAddress, macroblock) {
  const bitReader = sliceState.bitReader;
  if (macroblock.mbType > 25) {
    throw new AvcSyntaxError("invalid-intra-macroblock-type", "Invalid AVC I-slice mb_type " + macroblock.mbType + ".");
  }
  if (macroblock.mbType === 25) {
    decodeCavlcPcmMacroblock(sliceState, macroblock);
    return;
  }

  if (macroblock.mbType === 0) {
    if (sliceState.pictureParameterSet.transform8x8ModeFlag) {
      macroblock.transformSize8x8 = Boolean(bitReader.readBit());
    }
    const predictionBlockCount = macroblock.transformSize8x8 ? 4 : 16;
    for (let blockIndex = 0; blockIndex < predictionBlockCount; blockIndex += 1) {
      const startBit = bitReader.bitOffset;
      const previous = Boolean(bitReader.readBit());
      const predictionMode = { previous, remainder: previous ? -1 : bitReader.readBits(3) };
      macroblock.partitionSyntaxBits[blockIndex] = bitReader.bitOffset - startBit;
      if (macroblock.transformSize8x8) {
        macroblock.intra8x8PredMode[blockIndex] = deriveIntra8x8PredictionMode(
          sliceState,
          macroblockAddress,
          blockIndex,
          predictionMode
        );
      } else {
        macroblock.intra4x4PredMode[blockIndex] = deriveIntra4x4PredictionMode(
          sliceState,
          macroblockAddress,
          blockIndex,
          predictionMode
        );
      }
    }
    if (sliceState.chromaArrayType !== 0) {
      macroblock.intraChromaPredMode = bitReader.readUE();
      if (macroblock.intraChromaPredMode > 3) {
        throw new AvcSyntaxError("invalid-chroma-prediction-mode", "Invalid AVC intra_chroma_pred_mode.");
      }
    }
    const codedBlockPatternIndex = bitReader.readUE();
    if (codedBlockPatternIndex > 47) {
      throw new AvcSyntaxError("invalid-coded-block-pattern", "Invalid AVC intra coded_block_pattern.");
    }
    const codedBlockPattern = CAVLC_INTRA_CODED_BLOCK_PATTERN[codedBlockPatternIndex];
    macroblock.cbpLuma = codedBlockPattern & 0x0f;
    macroblock.cbpChroma = (codedBlockPattern >> 4) & 0x03;
  } else {
    macroblock.intraPredMode16x16 = (macroblock.mbType - 1) % 4;
    macroblock.cbpLuma = Math.floor((macroblock.mbType - 1) / 12) ? 15 : 0;
    macroblock.cbpChroma = Math.floor((macroblock.mbType - 1) / 4) % 3;
    if (sliceState.chromaArrayType !== 0) {
      macroblock.intraChromaPredMode = bitReader.readUE();
      if (macroblock.intraChromaPredMode > 3) {
        throw new AvcSyntaxError("invalid-chroma-prediction-mode", "Invalid AVC intra_chroma_pred_mode.");
      }
    }
  }

  if (macroblock.cbpLuma > 0 || macroblock.cbpChroma > 0 || isIntra16x16Macroblock(macroblock)) {
    macroblock.qpDelta = bitReader.readSE();
    updateMacroblockQp(sliceState, macroblock);
  } else {
    macroblock.qpY = sliceState.currentQpY;
  }
  decodeCavlcMacroblockResidual(sliceState, macroblockAddress);
}

function decodeCavlcPcmMacroblock(sliceState, macroblock) {
  const bitReader = sliceState.bitReader;
  const pcmStartBit = bitReader.bitOffset;
  bitReader.alignToByte(0);
  const chromaSampleCount = sliceState.chromaArrayType === 0 ? 0 : 128;
  const pcmBits = 256 * sliceState.bitDepthY + chromaSampleCount * sliceState.bitDepthC;
  bitReader.skipBits(pcmBits);
  macroblock.partitionSyntaxBits[0] = bitReader.bitOffset - pcmStartBit;
  macroblock.nonZeroLuma.fill(16);
  macroblock.nonZeroChroma.fill(16);
  macroblock.qpY = sliceState.currentQpY;
}

function decodeCavlcMacroblockResidual(sliceState, macroblockAddress) {
  const macroblock = sliceState.syntaxState[macroblockAddress];
  if (isIntra16x16Macroblock(macroblock)) {
    const lumaDcCoefficientCount = deriveCavlcNonZeroCount(sliceState, macroblockAddress, 0);
    addCavlcResidualSyntaxBits(
      sliceState,
      macroblockAddress,
      lumaDcCoefficientCount,
      16,
      0,
      null
    );
    if (macroblock.cbpLuma > 0) {
      for (let blockIndex = 0; blockIndex < 16; blockIndex += 1) {
        if (macroblock.cbpLuma & (1 << Math.floor(blockIndex / 4))) {
          addCavlcResidualSyntaxBits(
            sliceState,
            macroblockAddress,
            deriveCavlcNonZeroCount(sliceState, macroblockAddress, blockIndex),
            15,
            0,
            { kind: "luma", blockIndex }
          );
        }
      }
    }
  } else if (macroblock.transformSize8x8) {
    for (let block8x8Index = 0; block8x8Index < 4; block8x8Index += 1) {
      if (!(macroblock.cbpLuma & (1 << block8x8Index))) continue;
      for (let subBlockIndex = 0; subBlockIndex < 4; subBlockIndex += 1) {
        const blockIndex = block8x8Index * 4 + subBlockIndex;
        addCavlcResidualSyntaxBits(
          sliceState,
          macroblockAddress,
          deriveCavlcNonZeroCount(sliceState, macroblockAddress, blockIndex),
          16,
          block8x8Index,
          { kind: "luma", blockIndex }
        );
      }
    }
  } else {
    for (let blockIndex = 0; blockIndex < 16; blockIndex += 1) {
      if (macroblock.cbpLuma & (1 << Math.floor(blockIndex / 4))) {
        addCavlcResidualSyntaxBits(
          sliceState,
          macroblockAddress,
          deriveCavlcNonZeroCount(sliceState, macroblockAddress, blockIndex),
          16,
          blockIndex,
          { kind: "luma", blockIndex }
        );
      }
    }
  }

  if (sliceState.chromaArrayType !== 0 && macroblock.cbpChroma > 0) {
    for (let componentIndex = 0; componentIndex < 2; componentIndex += 1) {
      consumeCavlcResidualBlock(sliceState.bitReader, -1, 4);
    }
    if (macroblock.cbpChroma > 1) {
      for (let componentIndex = 0; componentIndex < 2; componentIndex += 1) {
        for (let blockIndex = 0; blockIndex < 4; blockIndex += 1) {
          const combinedBlockIndex = componentIndex * 4 + blockIndex;
          const result = consumeCavlcResidualBlock(
            sliceState.bitReader,
            deriveCavlcChromaNonZeroCount(sliceState, macroblockAddress, combinedBlockIndex),
            15
          );
          macroblock.nonZeroChroma[combinedBlockIndex] = result.totalCoefficientCount;
        }
      }
    }
  }
}

function addCavlcResidualSyntaxBits(
  sliceState,
  macroblockAddress,
  neighboringCoefficientCount,
  maximumCoefficientCount,
  partitionIndex,
  nonZeroTarget
) {
  const startBit = sliceState.bitReader.bitOffset;
  const result = consumeCavlcResidualBlock(
    sliceState.bitReader,
    neighboringCoefficientCount,
    maximumCoefficientCount
  );
  const macroblock = sliceState.syntaxState[macroblockAddress];
  const syntaxPartitionIndex = macroblock.isIntra || !nonZeroTarget
    ? partitionIndex
    : findInterPartitionIndexForLumaBlock(macroblock, nonZeroTarget.blockIndex);
  addPartitionSyntaxBits(
    macroblock,
    syntaxPartitionIndex,
    sliceState.bitReader.bitOffset - startBit
  );
  if (nonZeroTarget && nonZeroTarget.kind === "luma") {
    macroblock.nonZeroLuma[nonZeroTarget.blockIndex] = result.totalCoefficientCount;
  }
}

function getResidualSyntaxPartitionIndex(macroblock, blockCategory, blockIndex, fallbackPartitionIndex) {
  if (macroblock.isIntra) return fallbackPartitionIndex;
  if (blockCategory === CABAC_BLOCK_CATEGORY_LUMA_8X8) {
    const blockX = (blockIndex % 2) * 2;
    const blockY = Math.floor(blockIndex / 2) * 2;
    return findInterPartitionIndexForBlockCoordinate(macroblock, blockX, blockY);
  }
  if (blockCategory === CABAC_BLOCK_CATEGORY_LUMA_4X4) {
    return findInterPartitionIndexForLumaBlock(macroblock, blockIndex);
  }
  return fallbackPartitionIndex;
}

function findInterPartitionIndexForLumaBlock(macroblock, blockIndex) {
  return findInterPartitionIndexForBlockCoordinate(
    macroblock,
    Z_SCAN_BLOCK_X[blockIndex],
    Z_SCAN_BLOCK_Y[blockIndex]
  );
}

function findInterPartitionIndexForBlockCoordinate(macroblock, blockX, blockY) {
  const partitionIndex = macroblock.interPartitions.findIndex((partition) => (
    blockX >= partition.blockX && blockX < partition.blockX + partition.blockWidth &&
    blockY >= partition.blockY && blockY < partition.blockY + partition.blockHeight
  ));
  return partitionIndex >= 0 ? partitionIndex : 0;
}

function consumeCavlcResidualBlock(bitReader, neighboringCoefficientCount, maximumCoefficientCount) {
  const { totalCoefficientCount, trailingOnes } = readCavlcCoefficientToken(
    bitReader,
    neighboringCoefficientCount
  );
  if (totalCoefficientCount === 0) return { totalCoefficientCount };
  consumeCavlcLevels(bitReader, totalCoefficientCount, trailingOnes);

  let zerosLeft = totalCoefficientCount < maximumCoefficientCount
    ? readCavlcTotalZeros(bitReader, totalCoefficientCount, maximumCoefficientCount)
    : 0;
  for (let coefficientIndex = 0; coefficientIndex < totalCoefficientCount - 1 && zerosLeft > 0; coefficientIndex += 1) {
    zerosLeft -= readCavlcRunBefore(bitReader, zerosLeft);
  }
  return { totalCoefficientCount };
}

function consumeCavlcLevels(bitReader, totalCoefficientCount, trailingOnes) {
  for (let trailingOneIndex = 0; trailingOneIndex < trailingOnes; trailingOneIndex += 1) {
    bitReader.readBit();
  }
  let suffixLength = totalCoefficientCount > 10 && trailingOnes < 3 ? 1 : 0;
  for (let levelIndex = trailingOnes; levelIndex < totalCoefficientCount; levelIndex += 1) {
    const levelPrefix = readUnaryZeroPrefix(bitReader, 25, "AVC CAVLC level_prefix is too long.");
    let levelSuffixSize = suffixLength;
    if (levelPrefix === 14 && suffixLength === 0) levelSuffixSize = 4;
    else if (levelPrefix >= 15) levelSuffixSize = levelPrefix - 3;
    const levelSuffix = levelSuffixSize > 0 ? bitReader.readBits(levelSuffixSize) : 0;
    let levelCode = Math.min(15, levelPrefix) * (2 ** suffixLength) + levelSuffix;
    if (levelPrefix >= 15 && suffixLength === 0) levelCode += 15;
    if (levelPrefix >= 16) levelCode += (2 ** (levelPrefix - 3)) - 4096;
    if (levelIndex === trailingOnes && trailingOnes < 3) levelCode += 2;
    const levelValue = levelCode & 1 ? -((levelCode + 1) / 2) : levelCode / 2 + 1;
    if (suffixLength === 0) suffixLength = 1;
    if (Math.abs(levelValue) > 3 * (2 ** (suffixLength - 1)) && suffixLength < 6) suffixLength += 1;
  }
}

function readCavlcCoefficientToken(bitReader, neighboringCoefficientCount) {
  if (neighboringCoefficientCount === -1) {
    return readCoefficientTokenCodeword(
      bitReader,
      CAVLC_CHROMA_DC_COEFFICIENT_TOKEN_LENGTHS,
      CAVLC_CHROMA_DC_COEFFICIENT_TOKEN_BITS,
      4,
      8,
      "chroma DC coeff_token"
    );
  }
  const tableIndex = neighboringCoefficientCount <= 1
    ? 0
    : neighboringCoefficientCount <= 3
      ? 1
      : neighboringCoefficientCount <= 7
        ? 2
        : 3;
  return readCoefficientTokenCodeword(
    bitReader,
    CAVLC_COEFFICIENT_TOKEN_LENGTHS[tableIndex],
    CAVLC_COEFFICIENT_TOKEN_BITS[tableIndex],
    16,
    [16, 14, 10, 6][tableIndex],
    "coeff_token"
  );
}

function readCoefficientTokenCodeword(
  bitReader,
  codeLengths,
  codeValues,
  maximumTotalCoefficients,
  maximumCodeLength,
  label
) {
  let codeValue = 0;
  for (let codeLength = 1; codeLength <= maximumCodeLength; codeLength += 1) {
    codeValue = codeValue * 2 + bitReader.readBit();
    for (let totalCoefficientCount = 0; totalCoefficientCount <= maximumTotalCoefficients; totalCoefficientCount += 1) {
      const maximumTrailingOnes = Math.min(totalCoefficientCount, 3);
      for (let trailingOnes = 0; trailingOnes <= maximumTrailingOnes; trailingOnes += 1) {
        const tableIndex = 4 * totalCoefficientCount + trailingOnes;
        if (codeLengths[tableIndex] === codeLength && codeValues[tableIndex] === codeValue) {
          return { totalCoefficientCount, trailingOnes };
        }
      }
    }
  }
  throw new AvcSyntaxError("invalid-cavlc-code", "No matching AVC " + label + " code.");
}

function readUnaryZeroPrefix(bitReader, maximumZeroCount, errorMessage) {
  let leadingZeroBits = 0;
  while (bitReader.readBit() === 0) {
    leadingZeroBits += 1;
    if (leadingZeroBits > maximumZeroCount) {
      throw new AvcSyntaxError("cavlc-level-prefix-too-long", errorMessage);
    }
  }
  return leadingZeroBits;
}

function readCavlcTotalZeros(bitReader, totalCoefficientCount, maximumCoefficientCount) {
  if (maximumCoefficientCount === 4) {
    return readScalarVlcCodeword(
      bitReader,
      CAVLC_CHROMA_DC_TOTAL_ZEROS_LENGTHS[totalCoefficientCount - 1],
      CAVLC_CHROMA_DC_TOTAL_ZEROS_BITS[totalCoefficientCount - 1],
      maximumCoefficientCount - totalCoefficientCount,
      "chroma DC total_zeros"
    );
  }
  return readScalarVlcCodeword(
    bitReader,
    CAVLC_TOTAL_ZEROS_LENGTHS[totalCoefficientCount - 1],
    CAVLC_TOTAL_ZEROS_BITS[totalCoefficientCount - 1],
    maximumCoefficientCount - totalCoefficientCount,
    "total_zeros"
  );
}

function readCavlcRunBefore(bitReader, zerosLeft) {
  const tableIndex = Math.min(zerosLeft - 1, 6);
  const maximumRun = tableIndex === 6 ? Math.min(zerosLeft, 14) : Math.min(zerosLeft, tableIndex + 1);
  return readScalarVlcCodeword(
    bitReader,
    CAVLC_RUN_BEFORE_LENGTHS[tableIndex],
    CAVLC_RUN_BEFORE_BITS[tableIndex],
    maximumRun,
    "run_before"
  );
}

function readScalarVlcCodeword(bitReader, codeLengths, codeValues, maximumValue, label) {
  let maximumCodeLength = 0;
  for (let value = 0; value <= maximumValue; value += 1) {
    maximumCodeLength = Math.max(maximumCodeLength, codeLengths[value] || 0);
  }
  let codeValue = 0;
  for (let codeLength = 1; codeLength <= maximumCodeLength; codeLength += 1) {
    codeValue = codeValue * 2 + bitReader.readBit();
    for (let value = 0; value <= maximumValue; value += 1) {
      if (codeLengths[value] === codeLength && codeValues[value] === codeValue) return value;
    }
  }
  throw new AvcSyntaxError("invalid-cavlc-code", "No matching AVC " + label + " code.");
}

function deriveCavlcNonZeroCount(sliceState, macroblockAddress, blockIndex) {
  const macroblock = sliceState.syntaxState[macroblockAddress];
  let leftCount = -1;
  let topCount = -1;
  const leftBlockIndex = LUMA_LEFT_NEIGHBOR[blockIndex];
  if (leftBlockIndex >= 0) {
    leftCount = macroblock.nonZeroLuma[leftBlockIndex];
  } else {
    const leftMacroblock = getMacroblockNeighbor(sliceState, macroblockAddress, -1, 0);
    if (leftMacroblock) leftCount = leftMacroblock.nonZeroLuma[LUMA_LEFT_FROM_MACROBLOCK_A[blockIndex]];
  }
  const topBlockIndex = LUMA_TOP_NEIGHBOR[blockIndex];
  if (topBlockIndex >= 0) {
    topCount = macroblock.nonZeroLuma[topBlockIndex];
  } else {
    const topMacroblock = getMacroblockNeighbor(sliceState, macroblockAddress, 0, -1);
    if (topMacroblock) topCount = topMacroblock.nonZeroLuma[LUMA_TOP_FROM_MACROBLOCK_B[blockIndex]];
  }
  if (leftCount >= 0 && topCount >= 0) return (leftCount + topCount + 1) >> 1;
  if (leftCount >= 0) return leftCount;
  if (topCount >= 0) return topCount;
  return 0;
}

function deriveCavlcChromaNonZeroCount(sliceState, macroblockAddress, blockIndex) {
  const macroblock = sliceState.syntaxState[macroblockAddress];
  const componentBase = Math.floor(blockIndex / 4) * 4;
  const localBlockIndex = blockIndex % 4;
  const blockX = localBlockIndex % 2;
  const blockY = Math.floor(localBlockIndex / 2);
  let leftCount = -1;
  let topCount = -1;
  if (blockX > 0) {
    leftCount = macroblock.nonZeroChroma[componentBase + localBlockIndex - 1];
  } else {
    const leftMacroblock = getMacroblockNeighbor(sliceState, macroblockAddress, -1, 0);
    if (leftMacroblock) leftCount = leftMacroblock.nonZeroChroma[componentBase + blockY * 2 + 1];
  }
  if (blockY > 0) {
    topCount = macroblock.nonZeroChroma[componentBase + localBlockIndex - 2];
  } else {
    const topMacroblock = getMacroblockNeighbor(sliceState, macroblockAddress, 0, -1);
    if (topMacroblock) topCount = topMacroblock.nonZeroChroma[componentBase + 2 + blockX];
  }
  if (leftCount >= 0 && topCount >= 0) return (leftCount + topCount + 1) >> 1;
  if (leftCount >= 0) return leftCount;
  if (topCount >= 0) return topCount;
  return 0;
}

const Z_SCAN_BLOCK_X = [0, 1, 0, 1, 2, 3, 2, 3, 0, 1, 0, 1, 2, 3, 2, 3];
const Z_SCAN_BLOCK_Y = [0, 0, 1, 1, 0, 0, 1, 1, 2, 2, 3, 3, 2, 2, 3, 3];
const RASTER_TO_Z_SCAN = [0, 1, 4, 5, 2, 3, 6, 7, 8, 9, 12, 13, 10, 11, 14, 15];

function deriveIntra4x4PredictionMode(sliceState, macroblockAddress, blockIndex, codedMode) {
  let leftPredictionMode = -1;
  let topPredictionMode = -1;
  const blockX = Z_SCAN_BLOCK_X[blockIndex];
  const blockY = Z_SCAN_BLOCK_Y[blockIndex];
  const macroblock = sliceState.syntaxState[macroblockAddress];
  if (blockX > 0) {
    leftPredictionMode = macroblock.intra4x4PredMode[RASTER_TO_Z_SCAN[blockY * 4 + blockX - 1]];
  } else {
    const left = getMacroblockNeighbor(sliceState, macroblockAddress, -1, 0);
    if (left) leftPredictionMode = getNeighborIntraPredictionMode(left, 3, blockY);
  }
  if (blockY > 0) {
    topPredictionMode = macroblock.intra4x4PredMode[RASTER_TO_Z_SCAN[(blockY - 1) * 4 + blockX]];
  } else {
    const top = getMacroblockNeighbor(sliceState, macroblockAddress, 0, -1);
    if (top) topPredictionMode = getNeighborIntraPredictionMode(top, blockX, 3);
  }
  const predictedMode = leftPredictionMode < 0 || topPredictionMode < 0
    ? 2
    : Math.min(leftPredictionMode, topPredictionMode);
  if (codedMode.previous) return predictedMode;
  return codedMode.remainder >= predictedMode ? codedMode.remainder + 1 : codedMode.remainder;
}

function deriveIntra8x8PredictionMode(sliceState, macroblockAddress, blockIndex, codedMode) {
  const blockX = blockIndex % 2;
  const blockY = Math.floor(blockIndex / 2);
  const macroblock = sliceState.syntaxState[macroblockAddress];
  let leftPredictionMode = -1;
  let topPredictionMode = -1;
  if (blockX > 0) {
    leftPredictionMode = macroblock.intra8x8PredMode[blockIndex - 1];
  } else {
    const left = getMacroblockNeighbor(sliceState, macroblockAddress, -1, 0);
    if (left) leftPredictionMode = getNeighborIntraPredictionMode(left, 3, blockY * 2);
  }
  if (blockY > 0) {
    topPredictionMode = macroblock.intra8x8PredMode[blockIndex - 2];
  } else {
    const top = getMacroblockNeighbor(sliceState, macroblockAddress, 0, -1);
    if (top) topPredictionMode = getNeighborIntraPredictionMode(top, blockX * 2, 3);
  }
  const predictedMode = leftPredictionMode < 0 || topPredictionMode < 0
    ? 2
    : Math.min(leftPredictionMode, topPredictionMode);
  if (codedMode.previous) return predictedMode;
  return codedMode.remainder >= predictedMode ? codedMode.remainder + 1 : codedMode.remainder;
}

function getNeighborIntraPredictionMode(macroblock, blockX, blockY) {
  if (!macroblock.isIntra) return -1;
  if (macroblock.mbType === 0 && macroblock.transformSize8x8) {
    return macroblock.intra8x8PredMode[Math.floor(blockY / 2) * 2 + Math.floor(blockX / 2)];
  }
  if (macroblock.mbType === 0) {
    return macroblock.intra4x4PredMode[RASTER_TO_Z_SCAN[blockY * 4 + blockX]];
  }
  return 2;
}

function isIntra16x16Macroblock(macroblock) {
  return Boolean(macroblock && macroblock.isIntra && macroblock.mbType >= 1 && macroblock.mbType <= 24);
}

function isIntra16x16OrPcm(macroblock) {
  return isIntra16x16Macroblock(macroblock) || Boolean(
    macroblock && macroblock.isIntra && macroblock.mbType === 25
  );
}

function getMacroblockNeighbor(sliceState, macroblockAddress, deltaX, deltaY) {
  const macroblockX = macroblockAddress % sliceState.macroblockColumns;
  const macroblockY = Math.floor(macroblockAddress / sliceState.macroblockColumns);
  const neighborX = macroblockX + deltaX;
  const neighborY = macroblockY + deltaY;
  if (
    neighborX < 0 || neighborX >= sliceState.macroblockColumns ||
    neighborY < 0 || neighborY >= sliceState.macroblockRows
  ) return null;
  const neighbor = sliceState.syntaxState[neighborY * sliceState.macroblockColumns + neighborX];
  return neighbor && neighbor.sliceIndex === sliceState.sliceIndex ? neighbor : null;
}

function storeMacroblockResult(sliceState, macroblockAddress, syntaxBits) {
  const syntax = sliceState.syntaxState[macroblockAddress];
  const macroblockColumn = macroblockAddress % sliceState.macroblockColumns;
  const macroblockRow = Math.floor(macroblockAddress / sliceState.macroblockColumns);
  const codedLeft = macroblockColumn * AVC_MACROBLOCK_SIZE;
  const codedTop = macroblockRow * AVC_MACROBLOCK_SIZE;
  const rootGeometry = getTranslatedCodedRectangle(
    sliceState.sequenceParameterSet,
    codedLeft,
    codedTop,
    AVC_MACROBLOCK_SIZE,
    AVC_MACROBLOCK_SIZE
  );
  const type = getMacroblockTypeName(syntax);
  const partitionCount = syntax.isIntra ? getIntraPartitionCount(type) : syntax.interPartitions.length;
  sliceState.structureBudget.decodedPartitionCount += partitionCount;
  if (syntax.isIntra) {
    sliceState.partitionModeCounts.set(
      type,
      (sliceState.partitionModeCounts.get(type) || 0) + partitionCount + 1
    );
  } else {
    sliceState.partitionModeCounts.set(type, (sliceState.partitionModeCounts.get(type) || 0) + 1);
    for (const partition of syntax.interPartitions) {
      sliceState.partitionModeCounts.set(
        partition.type,
        (sliceState.partitionModeCounts.get(partition.type) || 0) + 1
      );
    }
  }
  const retainPartitionGeometry =
    sliceState.structureBudget.retainedStructureRecordCount + partitionCount <=
      sliceState.structureBudget.maximumStructureRecords;
  const children = retainPartitionGeometry
    ? (syntax.isIntra
      ? buildIntraPartitionGeometry(
        sliceState.sequenceParameterSet,
        macroblockAddress,
        codedLeft,
        codedTop,
        syntax
      )
      : buildPredictivePartitionGeometry(
        sliceState.sequenceParameterSet,
        macroblockAddress,
        codedLeft,
        codedTop,
        syntax
      ))
    : [];
  if (retainPartitionGeometry) {
    sliceState.structureBudget.retainedStructureRecordCount += children.length;
  } else {
    sliceState.structureBudget.omittedPartitionCount += partitionCount;
  }
  const childSyntaxBits = children.reduce((total, child) => total + child.syntaxBits, 0);
  sliceState.macroblocks[macroblockAddress] = {
    id: "mb:" + macroblockAddress,
    macroblockIndex: macroblockAddress,
    macroblockColumn,
    macroblockRow,
    codedLeft,
    codedTop,
    left: rootGeometry.left,
    top: rootGeometry.top,
    width: rootGeometry.width,
    height: rootGeometry.height,
    codedWidth: AVC_MACROBLOCK_SIZE,
    codedHeight: AVC_MACROBLOCK_SIZE,
    codedBlockWidth: AVC_MACROBLOCK_SIZE,
    codedBlockHeight: AVC_MACROBLOCK_SIZE,
    depth: 0,
    type,
    rawMbType: syntax.rawMbType,
    skipped: syntax.isSkipped,
    syntaxBits,
    ownBits: syntaxBits - childSyntaxBits,
    subtreeBits: syntaxBits,
    childSyntaxBits,
    unattributedSyntaxBits: syntaxBits - childSyntaxBits,
    omittedDescendantCount: retainPartitionGeometry ? 0 : partitionCount,
    qpY: syntax.qpY,
    codedBlockPatternLuma: syntax.cbpLuma,
    codedBlockPatternChroma: syntax.cbpChroma,
    children
  };
}

function getIntraMacroblockTypeName(syntax) {
  if (syntax.mbType === 25) return "I_PCM";
  if (syntax.mbType !== 0) return "I_16x16";
  return syntax.transformSize8x8 ? "I_8x8" : "I_4x4";
}

function getMacroblockTypeName(syntax) {
  return syntax.isIntra ? getIntraMacroblockTypeName(syntax) : syntax.interMode;
}

function getIntraPartitionCount(type) {
  if (type === "I_8x8") return 4;
  if (type === "I_4x4") return 16;
  return 1;
}

function buildIntraPartitionGeometry(
  sequenceParameterSet,
  macroblockAddress,
  macroblockCodedLeft,
  macroblockCodedTop,
  syntax
) {
  const type = getIntraMacroblockTypeName(syntax);
  if (type === "I_16x16" || type === "I_PCM") {
    const geometry = getTranslatedCodedRectangle(
      sequenceParameterSet,
      macroblockCodedLeft,
      macroblockCodedTop,
      AVC_MACROBLOCK_SIZE,
      AVC_MACROBLOCK_SIZE
    );
    return [{
      id: "mb:" + macroblockAddress + "/partition:0",
      codedLeft: macroblockCodedLeft,
      codedTop: macroblockCodedTop,
      left: geometry.left,
      top: geometry.top,
      width: geometry.width,
      height: geometry.height,
      codedWidth: AVC_MACROBLOCK_SIZE,
      codedHeight: AVC_MACROBLOCK_SIZE,
      codedBlockWidth: AVC_MACROBLOCK_SIZE,
      codedBlockHeight: AVC_MACROBLOCK_SIZE,
      depth: 1,
      type,
      syntaxBits: syntax.partitionSyntaxBits[0] || 0,
      children: []
    }];
  }
  const partitionSize = type === "I_8x8" ? 8 : 4;
  const partitionCount = type === "I_8x8" ? 4 : 16;
  const partitionsPerRow = AVC_MACROBLOCK_SIZE / partitionSize;
  const children = [];
  for (let blockIndex = 0; blockIndex < partitionCount; blockIndex += 1) {
    const partitionColumn = type === "I_8x8" ? blockIndex % 2 : Z_SCAN_BLOCK_X[blockIndex];
    const partitionRow = type === "I_8x8" ? Math.floor(blockIndex / 2) : Z_SCAN_BLOCK_Y[blockIndex];
    const relativeLeft = partitionColumn * partitionSize;
    const relativeTop = partitionRow * partitionSize;
    const geometry = getTranslatedCodedRectangle(
      sequenceParameterSet,
      macroblockCodedLeft + relativeLeft,
      macroblockCodedTop + relativeTop,
      partitionSize,
      partitionSize
    );
    children.push({
      id: "mb:" + macroblockAddress + "/partition:" + blockIndex,
      partitionIndex: blockIndex,
      partitionColumn,
      partitionRow,
      codedLeft: macroblockCodedLeft + relativeLeft,
      codedTop: macroblockCodedTop + relativeTop,
      left: geometry.left,
      top: geometry.top,
      width: geometry.width,
      height: geometry.height,
      codedWidth: partitionSize,
      codedHeight: partitionSize,
      codedBlockWidth: partitionSize,
      codedBlockHeight: partitionSize,
      depth: 1,
      type,
      syntaxBits: syntax.partitionSyntaxBits[blockIndex] || 0,
      predictionMode: type === "I_8x8"
        ? syntax.intra8x8PredMode[blockIndex]
        : syntax.intra4x4PredMode[blockIndex],
      children: []
    });
  }
  if (children.length !== partitionsPerRow * partitionsPerRow) {
    throw new AvcSyntaxError("invalid-partition-geometry", "AVC partition geometry is inconsistent.");
  }
  return children;
}

function buildPredictivePartitionGeometry(
  sequenceParameterSet,
  macroblockAddress,
  macroblockCodedLeft,
  macroblockCodedTop,
  syntax
) {
  return syntax.interPartitions.map((partition, partitionIndex) => {
    const codedLeft = macroblockCodedLeft + partition.codedLeft;
    const codedTop = macroblockCodedTop + partition.codedTop;
    const geometry = getTranslatedCodedRectangle(
      sequenceParameterSet,
      codedLeft,
      codedTop,
      partition.codedWidth,
      partition.codedHeight
    );
    const topLeftBlockIndex = partition.blockY * 4 + partition.blockX;
    return {
      id: "mb:" + macroblockAddress + "/partition:" + partitionIndex,
      partitionIndex,
      referenceGroupIndex: partition.referenceGroupIndex,
      codedLeft,
      codedTop,
      left: geometry.left,
      top: geometry.top,
      width: geometry.width,
      height: geometry.height,
      codedWidth: partition.codedWidth,
      codedHeight: partition.codedHeight,
      codedBlockWidth: partition.codedWidth,
      codedBlockHeight: partition.codedHeight,
      depth: 1,
      type: partition.type,
      syntaxBits: syntax.partitionSyntaxBits[partitionIndex] || 0,
      predictionDirection: partition.predictionDirection,
      direct: partition.direct,
      referenceIndexL0: syntax.referenceIndexL0[topLeftBlockIndex],
      referenceIndexL1: syntax.referenceIndexL1[topLeftBlockIndex],
      motionVectorDifferenceL0X: syntax.motionVectorDifferenceL0X[topLeftBlockIndex],
      motionVectorDifferenceL0Y: syntax.motionVectorDifferenceL0Y[topLeftBlockIndex],
      motionVectorDifferenceL1X: syntax.motionVectorDifferenceL1X[topLeftBlockIndex],
      motionVectorDifferenceL1Y: syntax.motionVectorDifferenceL1Y[topLeftBlockIndex],
      children: []
    };
  });
}

function flattenMacroblockDescendants(macroblock) {
  const descendants = [];
  const stack = Array.isArray(macroblock.children) ? macroblock.children.slice().reverse() : [];
  while (stack.length) {
    const block = stack.pop();
    descendants.push(block);
    const children = Array.isArray(block.children) ? block.children : [];
    for (let index = children.length - 1; index >= 0; index -= 1) stack.push(children[index]);
  }
  return descendants;
}

export {
  AvcSyntaxError,
  parseAvcFrameInternals,
  parseAvcParameterSets,
  parsePpsNalUnit,
  parseSliceHeader,
  parseSpsNalUnit,
  splitLengthPrefixedNalUnits
};
