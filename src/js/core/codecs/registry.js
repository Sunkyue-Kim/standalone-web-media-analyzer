const VIDEO_CODEC_DESCRIPTORS = [
  {
    id: "avc",
    label: "AVC / H.264",
    kind: "video",
    sampleEntryTypes: ["avc1", "avc2", "avc3", "avc4"],
    configurationBoxTypes: ["avcC"],
    canScanSamples: true,
    getSampleContext(track) {
      return track && track.codecConfig && track.codecConfig.nalLengthSize
        ? { nalLengthSize: track.codecConfig.nalLengthSize }
        : null;
    },
    loadImplementation: () => import("./video/avc.js").then((module) => module.avcVideoCodec)
  },
  {
    id: "hevc",
    label: "HEVC / H.265",
    kind: "video",
    sampleEntryTypes: ["hvc1", "hev1"],
    configurationBoxTypes: ["hvcC"],
    canScanSamples: true,
    getSampleContext(track) {
      return track && track.codecConfig && track.codecConfig.nalLengthSize
        ? { nalLengthSize: track.codecConfig.nalLengthSize }
        : null;
    },
    loadImplementation: () => import("./video/hevc.js").then((module) => module.hevcVideoCodec)
  },
  {
    id: "av1",
    label: "AV1",
    kind: "video",
    sampleEntryTypes: ["av01", "V_AV1"],
    configurationBoxTypes: ["av1C"],
    canScanSamples: true,
    getSampleContext(track) {
      return {
        codecConfig: track && track.codecConfig ? track.codecConfig : null
      };
    },
    loadImplementation: () => import("./video/av1.js").then((module) => module.av1VideoCodec)
  }
];

const AUDIO_CODEC_DESCRIPTORS = [
  {
    id: "aac",
    label: "AAC",
    kind: "audio",
    sampleEntryTypes: ["mp4a"],
    configurationBoxTypes: ["esds"],
    loadImplementation: () => import("./audio/aac.js").then((module) => module.aacAudioCodec)
  },
  {
    id: "mp3",
    label: "MP3 / MPEG Audio",
    kind: "audio",
    sampleEntryTypes: ["mp3", ".mp3"],
    configurationBoxTypes: [],
    loadImplementation: () => import("./audio/mp3.js").then((module) => module.mp3AudioCodec)
  },
  {
    id: "opus",
    label: "Opus",
    kind: "audio",
    sampleEntryTypes: ["Opus", "A_OPUS"],
    configurationBoxTypes: ["dOps", "OpusHead"],
    loadImplementation: () => import("./audio/opus.js").then((module) => module.opusAudioCodec)
  }
];

const CODEC_DESCRIPTORS = VIDEO_CODEC_DESCRIPTORS.concat(AUDIO_CODEC_DESCRIPTORS);

export const VIDEO_SAMPLE_ENTRIES = new Set(VIDEO_CODEC_DESCRIPTORS.flatMap((codec) => codec.sampleEntryTypes).concat([
  "encv", "mp4v",
  "ap4h", "ap4x", "apch", "apcn", "apcs", "apco", "aprn", "aprh"
]));

export const AUDIO_SAMPLE_ENTRIES = new Set(AUDIO_CODEC_DESCRIPTORS.flatMap((codec) => codec.sampleEntryTypes).concat(["enca", "ac-3", "ec-3", "Opus", "alac"]));

const implementationPromises = new Map();

function getCodecBySampleEntryType(sampleEntryType) {
  return CODEC_DESCRIPTORS.find((codec) => (codec.sampleEntryTypes || []).includes(sampleEntryType)) || null;
}

function getCodecByConfigurationBoxType(configurationBoxType) {
  return CODEC_DESCRIPTORS.find((codec) => (codec.configurationBoxTypes || []).includes(configurationBoxType)) || null;
}

async function loadCodecImplementation(codecDescriptor) {
  if (!codecDescriptor || typeof codecDescriptor.loadImplementation !== "function") return null;
  if (!implementationPromises.has(codecDescriptor.id)) {
    implementationPromises.set(codecDescriptor.id, codecDescriptor.loadImplementation());
  }
  return implementationPromises.get(codecDescriptor.id);
}

async function parseCodecConfiguration(configurationBoxType, bytes) {
  const codecDescriptor = getCodecByConfigurationBoxType(configurationBoxType);
  if (!codecDescriptor) return null;
  const implementation = await loadCodecImplementation(codecDescriptor);
  if (!implementation || typeof implementation.parseConfiguration !== "function") return null;
  const fields = implementation.parseConfiguration(bytes);
  return {
    codecDescriptor,
    fields,
    trackConfig: implementation.extractTrackConfig ? implementation.extractTrackConfig(fields) : fields
  };
}

function getFrameTypeScanner(track) {
  const codecDescriptor = getCodecBySampleEntryType(track && track.codec);
  if (!codecDescriptor || !codecDescriptor.canScanSamples || typeof codecDescriptor.getSampleContext !== "function") return null;
  const context = codecDescriptor.getSampleContext(track);
  if (!context) return null;
  return {
    codec: codecDescriptor.label,
    async parse(bytes) {
      const implementation = await loadCodecImplementation(codecDescriptor);
      if (!implementation || typeof implementation.parseSample !== "function") {
        throw new Error(codecDescriptor.label + " sample parser is unavailable.");
      }
      return implementation.parseSample(bytes, context);
    }
  };
}

export {
  AUDIO_CODEC_DESCRIPTORS,
  CODEC_DESCRIPTORS,
  VIDEO_CODEC_DESCRIPTORS,
  getCodecByConfigurationBoxType,
  getCodecBySampleEntryType,
  getFrameTypeScanner,
  loadCodecImplementation,
  parseCodecConfiguration
};
