import { ByteCursor, readFullBoxHeader } from "../../common/binary.js";
import { BitReader } from "../../common/bitstream.js";

const AUDIO_SAMPLE_RATES = [
  96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050,
  16000, 12000, 11025, 8000, 7350
];

const AUDIO_OBJECT_TYPE_NAMES = {
  1: "AAC Main",
  2: "AAC LC",
  3: "AAC SSR",
  4: "AAC LTP",
  5: "SBR",
  6: "AAC Scalable",
  17: "ER AAC LC",
  29: "PS",
  42: "USAC"
};

function parseEsds(bytes) {
  const cursor = new ByteCursor(bytes);
  if (cursor.length < 4) return { error: "esds too short" };
  const full = readFullBoxHeader(cursor);
  const descriptors = parseDescriptors(cursor, 4, cursor.length, 0);
  const decoderConfig = findDescriptor(descriptors, 0x04);
  const decoderSpecificInfo = findDescriptor(descriptors, 0x05);
  const audioConfig = decoderSpecificInfo ? parseAudioSpecificConfig(decoderSpecificInfo.bytes) : null;
  if (audioConfig && decoderConfig && decoderConfig.objectTypeIndication === 0x40) {
    audioConfig.codecString = "mp4a.40." + audioConfig.audioObjectType;
  }
  return {
    version: full.version,
    flags: full.flags,
    descriptors,
    objectTypeIndication: decoderConfig ? decoderConfig.objectTypeIndication : null,
    streamType: decoderConfig ? decoderConfig.streamType : null,
    bufferSizeDB: decoderConfig ? decoderConfig.bufferSizeDB : null,
    maxBitrate: decoderConfig ? decoderConfig.maxBitrate : null,
    avgBitrate: decoderConfig ? decoderConfig.avgBitrate : null,
    audioConfig
  };
}

function parseDescriptors(cursor, start, end, depth) {
  const descriptors = [];
  let offset = start;
  while (offset + 2 <= end && depth < 8) {
    const tag = cursor.uint8(offset);
    const sizeInfo = readDescriptorSize(cursor, offset + 1, end);
    if (!sizeInfo) break;
    const headerSize = 1 + sizeInfo.bytesRead;
    const dataStart = offset + headerSize;
    const dataEnd = dataStart + sizeInfo.size;
    if (dataEnd > end) break;
    const descriptor = {
      tag,
      tagName: descriptorTagName(tag),
      size: sizeInfo.size,
      bytes: Array.from(cursor.bytesAt(dataStart, sizeInfo.size))
    };
    parseDescriptorFields(cursor, descriptor, dataStart, dataEnd, depth);
    descriptors.push(descriptor);
    offset = dataEnd;
  }
  return descriptors;
}

function readDescriptorSize(cursor, offset, end) {
  let size = 0;
  let bytesRead = 0;
  while (offset + bytesRead < end && bytesRead < 4) {
    const byte = cursor.uint8(offset + bytesRead);
    size = (size << 7) | (byte & 0x7f);
    bytesRead += 1;
    if ((byte & 0x80) === 0) return { size, bytesRead };
  }
  return null;
}

function parseDescriptorFields(cursor, descriptor, start, end, depth) {
  if (descriptor.tag === 0x03 && start + 3 <= end) {
    descriptor.esId = cursor.uint16(start);
    const flags = cursor.uint8(start + 2);
    descriptor.flags = flags;
    let childStart = start + 3;
    if (flags & 0x80) childStart += 2;
    if (flags & 0x40 && childStart < end) childStart += 1 + cursor.uint8(childStart);
    if (flags & 0x20) childStart += 2;
    descriptor.children = parseDescriptors(cursor, childStart, end, depth + 1);
  } else if (descriptor.tag === 0x04 && start + 13 <= end) {
    descriptor.objectTypeIndication = cursor.uint8(start);
    descriptor.streamType = cursor.uint8(start + 1) >> 2;
    descriptor.upStream = Boolean(cursor.uint8(start + 1) & 0x02);
    descriptor.bufferSizeDB = (cursor.uint8(start + 2) << 16) | (cursor.uint8(start + 3) << 8) | cursor.uint8(start + 4);
    descriptor.maxBitrate = cursor.uint32(start + 5);
    descriptor.avgBitrate = cursor.uint32(start + 9);
    descriptor.children = parseDescriptors(cursor, start + 13, end, depth + 1);
  }
}

function findDescriptor(descriptors, tag) {
  for (const descriptor of descriptors || []) {
    if (descriptor.tag === tag) return descriptor;
    const found = findDescriptor(descriptor.children || [], tag);
    if (found) return found;
  }
  return null;
}

function descriptorTagName(tag) {
  const names = {
    0x03: "ES_Descriptor",
    0x04: "DecoderConfigDescriptor",
    0x05: "DecoderSpecificInfo",
    0x06: "SLConfigDescriptor"
  };
  return names[tag] || "Descriptor 0x" + tag.toString(16);
}

function parseAudioSpecificConfig(bytesLike) {
  const bytes = bytesLike instanceof Uint8Array ? bytesLike : new Uint8Array(bytesLike);
  const bitReader = new BitReader(bytes);
  let audioObjectType = readAudioObjectType(bitReader);
  let samplingFrequencyIndex = bitReader.readBits(4);
  let samplingFrequency = samplingFrequencyIndex === 0x0f ? bitReader.readBits(24) : AUDIO_SAMPLE_RATES[samplingFrequencyIndex] || null;
  const channelConfiguration = bitReader.readBits(4);
  let extensionAudioObjectType = null;
  let extensionSamplingFrequency = null;
  if (audioObjectType === 5 || audioObjectType === 29) {
    extensionAudioObjectType = audioObjectType;
    samplingFrequencyIndex = bitReader.readBits(4);
    extensionSamplingFrequency = samplingFrequencyIndex === 0x0f ? bitReader.readBits(24) : AUDIO_SAMPLE_RATES[samplingFrequencyIndex] || null;
    audioObjectType = readAudioObjectType(bitReader);
  }
  return {
    audioObjectType,
    audioObjectTypeName: AUDIO_OBJECT_TYPE_NAMES[audioObjectType] || "Audio object type " + audioObjectType,
    samplingFrequencyIndex,
    samplingFrequency,
    channelConfiguration,
    channelDescription: describeChannelConfiguration(channelConfiguration),
    extensionAudioObjectType,
    extensionSamplingFrequency
  };
}

function readAudioObjectType(bitReader) {
  const value = bitReader.readBits(5);
  return value === 31 ? 32 + bitReader.readBits(6) : value;
}

function describeChannelConfiguration(channelConfiguration) {
  const names = {
    0: "defined in program config element",
    1: "mono",
    2: "stereo",
    3: "3 channels",
    4: "4 channels",
    5: "5 channels",
    6: "5.1 channels",
    7: "7.1 channels"
  };
  return names[channelConfiguration] || channelConfiguration + " channels";
}

const aacAudioCodec = {
  id: "aac",
  label: "AAC",
  kind: "audio",
  sampleEntryTypes: ["mp4a"],
  configurationBoxTypes: ["esds"],
  parseConfiguration: parseEsds,
  extractTrackConfig(fields) {
    return fields.audioConfig || null;
  }
};

export {
  aacAudioCodec,
  parseEsds,
  parseAudioSpecificConfig
};
