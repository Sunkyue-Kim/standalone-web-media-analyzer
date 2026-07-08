function parseOpusHead(bytes) {
  if (bytes.byteLength < 19 || ascii(bytes, 0, 8) !== "OpusHead") return null;
  return {
    codecString: "opus",
    audioObjectTypeName: "Opus",
    version: bytes[8],
    channelCount: bytes[9],
    channelDescription: bytes[9] + (bytes[9] === 1 ? " channel" : " channels"),
    preSkip: readUint16Le(bytes, 10),
    inputSampleRate: readUint32Le(bytes, 12),
    samplingFrequency: 48000,
    outputGain: readInt16Le(bytes, 16),
    mappingFamily: bytes[18]
  };
}

function parseOpusPacket(bytes) {
  if (!bytes || bytes.byteLength < 1) {
    return { codecString: "opus", frameType: "Opus", frameCount: 0, durationSamples: 0, durationMs: 0 };
  }
  const toc = bytes[0];
  const config = toc >> 3;
  const stereo = Boolean((toc >> 2) & 0x01);
  const code = toc & 0x03;
  const frameDurationMs = getOpusFrameDurationMs(config);
  const frameCount = getOpusFrameCount(bytes, code);
  return {
    codecString: "opus",
    frameType: "Opus",
    toc,
    config,
    mode: getOpusMode(config),
    bandwidth: getOpusBandwidth(config),
    stereo,
    code,
    frameCount,
    frameDurationMs,
    durationMs: frameDurationMs * frameCount,
    durationSamples: Math.round(frameDurationMs * 48) * frameCount
  };
}

function getOpusFrameDurationMs(config) {
  if (config <= 11) return [10, 20, 40, 60][config % 4];
  if (config <= 15) return [10, 20][config % 2];
  return [2.5, 5, 10, 20][config % 4];
}

function getOpusFrameCount(bytes, code) {
  if (code === 0) return 1;
  if (code === 1 || code === 2) return 2;
  if (bytes.byteLength < 2) return 0;
  return bytes[1] & 0x3f;
}

function getOpusMode(config) {
  if (config <= 11) return "SILK";
  if (config <= 15) return "Hybrid";
  return "CELT";
}

function getOpusBandwidth(config) {
  if (config <= 3) return "NB";
  if (config <= 7) return "MB";
  if (config <= 11) return "WB";
  if (config <= 13) return "SWB";
  if (config <= 15) return "FB";
  if (config <= 19) return "NB";
  if (config <= 23) return "WB";
  if (config <= 27) return "SWB";
  return "FB";
}

function ascii(bytes, offset, length) {
  let text = "";
  for (let index = 0; index < length && offset + index < bytes.byteLength; index += 1) {
    text += String.fromCharCode(bytes[offset + index]);
  }
  return text;
}

function readUint16Le(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function readInt16Le(bytes, offset) {
  const value = readUint16Le(bytes, offset);
  return value & 0x8000 ? value - 0x10000 : value;
}

function readUint32Le(bytes, offset) {
  return (bytes[offset] |
    (bytes[offset + 1] << 8) |
    (bytes[offset + 2] << 16) |
    (bytes[offset + 3] << 24)) >>> 0;
}

const opusAudioCodec = {
  id: "opus",
  label: "Opus",
  kind: "audio",
  sampleEntryTypes: ["opus", "A_OPUS"],
  configurationBoxTypes: [],
  parseConfiguration: parseOpusHead,
  parseSample: parseOpusPacket
};

export {
  opusAudioCodec,
  parseOpusHead,
  parseOpusPacket
};
