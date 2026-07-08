import { aacAudioCodec } from "./audio/aac.js";
import { mp3AudioCodec } from "./audio/mp3.js";
import { opusAudioCodec } from "./audio/opus.js";
import { avcVideoCodec } from "./video/avc.js";
import { hevcVideoCodec } from "./video/hevc.js";

const VIDEO_CODEC_DESCRIPTORS = [avcVideoCodec, hevcVideoCodec];
const AUDIO_CODEC_DESCRIPTORS = [aacAudioCodec, mp3AudioCodec, opusAudioCodec];
const CODEC_DESCRIPTORS = VIDEO_CODEC_DESCRIPTORS.concat(AUDIO_CODEC_DESCRIPTORS);

export const VIDEO_SAMPLE_ENTRIES = new Set(VIDEO_CODEC_DESCRIPTORS.flatMap((codec) => codec.sampleEntryTypes).concat([
  "av01", "encv", "mp4v",
  "ap4h", "ap4x", "apch", "apcn", "apcs", "apco", "aprn", "aprh"
]));

export const AUDIO_SAMPLE_ENTRIES = new Set(AUDIO_CODEC_DESCRIPTORS.flatMap((codec) => codec.sampleEntryTypes).concat(["enca", "ac-3", "ec-3", "Opus", "alac"]));

function getCodecBySampleEntryType(sampleEntryType) {
  return CODEC_DESCRIPTORS.find((codec) => (codec.sampleEntryTypes || []).includes(sampleEntryType)) || null;
}

function getCodecByConfigurationBoxType(configurationBoxType) {
  return CODEC_DESCRIPTORS.find((codec) => (codec.configurationBoxTypes || []).includes(configurationBoxType)) || null;
}

function getFrameTypeScanner(track) {
  const codec = getCodecBySampleEntryType(track && track.codec);
  if (!codec || typeof codec.parseSample !== "function" || typeof codec.getSampleContext !== "function") return null;
  const context = codec.getSampleContext(track);
  if (!context) return null;
  return {
    codec: codec.label,
    parse: (bytes) => codec.parseSample(bytes, context)
  };
}

export {
  AUDIO_CODEC_DESCRIPTORS,
  CODEC_DESCRIPTORS,
  VIDEO_CODEC_DESCRIPTORS,
  getCodecByConfigurationBoxType,
  getCodecBySampleEntryType,
  getFrameTypeScanner
};
