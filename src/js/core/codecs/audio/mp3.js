const MPEG_VERSION_NAMES = {
  0: "MPEG-2.5",
  2: "MPEG-2",
  3: "MPEG-1"
};

const MPEG_LAYER_NAMES = {
  1: "Layer III",
  2: "Layer II",
  3: "Layer I"
};

const CHANNEL_MODE_NAMES = ["Stereo", "Joint stereo", "Dual channel", "Mono"];

const BITRATE_KBPS = {
  "3:3": [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
  "3:2": [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  "3:1": [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  "2:3": [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
  "2:2": [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
  "2:1": [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160]
};

const SAMPLING_RATES = {
  0: [11025, 12000, 8000],
  2: [22050, 24000, 16000],
  3: [44100, 48000, 32000]
};

function parseMp3FrameHeader(bytes, offset) {
  if (offset + 4 > bytes.byteLength) return null;
  const header = (
    (bytes[offset] << 24) |
    (bytes[offset + 1] << 16) |
    (bytes[offset + 2] << 8) |
    bytes[offset + 3]
  ) >>> 0;
  if (((header & 0xffe00000) >>> 0) !== 0xffe00000) return null;
  const versionBits = (header >> 19) & 0x03;
  const layerBits = (header >> 17) & 0x03;
  const protectionAbsent = Boolean((header >> 16) & 0x01);
  const bitrateIndex = (header >> 12) & 0x0f;
  const samplingRateIndex = (header >> 10) & 0x03;
  const padding = (header >> 9) & 0x01;
  const channelMode = (header >> 6) & 0x03;
  if (versionBits === 1 || layerBits === 0 || bitrateIndex === 0 || bitrateIndex === 0x0f || samplingRateIndex === 0x03) {
    return null;
  }
  const bitrateVersionKey = versionBits === 3 ? 3 : 2;
  const bitrateKbps = BITRATE_KBPS[bitrateVersionKey + ":" + layerBits][bitrateIndex];
  const samplingRate = SAMPLING_RATES[versionBits][samplingRateIndex];
  if (!bitrateKbps || !samplingRate) return null;
  const samplesPerFrame = getMp3SamplesPerFrame(versionBits, layerBits);
  const frameLength = getMp3FrameLength(versionBits, layerBits, bitrateKbps, samplingRate, padding);
  if (!frameLength || frameLength < 4) return null;
  return {
    version: MPEG_VERSION_NAMES[versionBits],
    versionBits,
    layer: MPEG_LAYER_NAMES[layerBits],
    layerBits,
    protectionAbsent,
    bitrateKbps,
    samplingRate,
    padding: Boolean(padding),
    channelMode: CHANNEL_MODE_NAMES[channelMode],
    channelCount: channelMode === 3 ? 1 : 2,
    samplesPerFrame,
    frameLength
  };
}

function getMp3SamplesPerFrame(versionBits, layerBits) {
  if (layerBits === 3) return 384;
  if (layerBits === 2) return 1152;
  return versionBits === 3 ? 1152 : 576;
}

function getMp3FrameLength(versionBits, layerBits, bitrateKbps, samplingRate, padding) {
  if (layerBits === 3) {
    return Math.floor((12 * bitrateKbps * 1000 / samplingRate + padding) * 4);
  }
  const coefficient = layerBits === 1 && versionBits !== 3 ? 72 : 144;
  return Math.floor(coefficient * bitrateKbps * 1000 / samplingRate + padding);
}

function readId3v2Header(bytes) {
  if (bytes.byteLength < 10) return null;
  if (String.fromCharCode(bytes[0], bytes[1], bytes[2]) !== "ID3") return null;
  const flags = bytes[5];
  const tagSize = readSyncSafeInteger(bytes, 6);
  const footerSize = flags & 0x10 ? 10 : 0;
  return {
    version: "2." + bytes[3] + "." + bytes[4],
    flags,
    size: 10 + tagSize + footerSize,
    payloadSize: tagSize,
    footerPresent: Boolean(flags & 0x10)
  };
}

function readSyncSafeInteger(bytes, offset) {
  return ((bytes[offset] & 0x7f) << 21) |
    ((bytes[offset + 1] & 0x7f) << 14) |
    ((bytes[offset + 2] & 0x7f) << 7) |
    (bytes[offset + 3] & 0x7f);
}

const mp3AudioCodec = {
  id: "mp3",
  label: "MP3 / MPEG Audio",
  kind: "audio",
  sampleEntryTypes: ["mp3", ".mp3"],
  configurationBoxTypes: [],
  parseFrameHeader: parseMp3FrameHeader
};

export {
  mp3AudioCodec,
  parseMp3FrameHeader,
  readId3v2Header
};
