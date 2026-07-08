export const SAMPLE_FILES = [
  {
    id: "avc-bframes",
    fileName: "avc_bframes.mp4",
    path: "validation/generated/avc_bframes.mp4",
    type: "video/mp4",
    labels: {
      en: "AVC H.264 with B-frames",
      ko: "AVC H.264 B-frame 포함"
    }
  },
  {
    id: "avc-fragmented",
    fileName: "avc_fragmented.mp4",
    path: "validation/generated/avc_fragmented.mp4",
    type: "video/mp4",
    labels: {
      en: "Fragmented MP4 AVC",
      ko: "Fragmented MP4 AVC"
    }
  },
  {
    id: "avc-no-bframes",
    fileName: "avc_no_bframes.mp4",
    path: "validation/generated/avc_no_bframes.mp4",
    type: "video/mp4",
    labels: {
      en: "AVC H.264 without B-frames",
      ko: "AVC H.264 B-frame 없음"
    }
  },
  {
    id: "avc-10020-samples",
    fileName: "avc_10020.mp4",
    path: "validation/generated/avc_10020.mp4",
    type: "video/mp4",
    labels: {
      en: "AVC 10,020 sample stress file",
      ko: "AVC 10,020 sample 스트레스 파일"
    }
  },
  {
    id: "mp3-audio",
    fileName: "audio_mp3.mp3",
    path: "validation/generated/audio_mp3.mp3",
    type: "audio/mpeg",
    labels: {
      en: "MP3 audio sample",
      ko: "MP3 오디오 샘플"
    }
  },
  {
    id: "ogg-opus-audio",
    fileName: "audio_opus.opus",
    path: "validation/generated/audio_opus.opus",
    type: "audio/ogg",
    labels: {
      en: "Ogg Opus audio sample",
      ko: "Ogg Opus 오디오 샘플"
    }
  },
  {
    id: "webm-vp9-opus",
    fileName: "webm_vp9_opus.webm",
    path: "validation/generated/webm_vp9_opus.webm",
    type: "video/webm",
    labels: {
      en: "WebM VP9 + Opus sample",
      ko: "WebM VP9 + Opus 샘플"
    }
  }
];
