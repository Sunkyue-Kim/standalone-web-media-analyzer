const PRO_RES_SAMPLE_ENTRY_TYPES = new Set(["ap4h", "ap4x", "apch", "apcn", "apcs", "apco", "aprn", "aprh"]);

const SUMMARY_CODEC_GROUPS = [
  {
    labelKey: "summary.avcTracks",
    matches: (track) => track.codec === "avc1" || track.codec === "avc3" || track.codecDescriptor === "avc"
  },
  {
    labelKey: "summary.hevcTracks",
    matches: (track) => track.codec === "hvc1" || track.codec === "hev1" || track.codecDescriptor === "hevc"
  },
  {
    labelKey: "summary.vp9Tracks",
    matches: (track) => track.codec === "V_VP9" || track.codec === "vp09" || track.codecDescriptor === "V_VP9"
  },
  {
    labelKey: "summary.av1Tracks",
    matches: (track) => track.codec === "av01" || track.codec === "V_AV1" || track.codecDescriptor === "av1"
  },
  {
    labelKey: "summary.proResTracks",
    matches: (track) => PRO_RES_SAMPLE_ENTRY_TYPES.has(track.codec)
  },
  {
    labelKey: "summary.aacTracks",
    matches: (track) => track.codec === "mp4a" || track.codecDescriptor === "aac"
  },
  {
    labelKey: "summary.mp3Tracks",
    matches: (track) => track.codec === "mp3" || track.codecDescriptor === "mp3"
  },
  {
    labelKey: "summary.opusTracks",
    matches: (track) => track.codec === "opus" || track.codec === "A_OPUS" || track.codecDescriptor === "opus"
  }
];

export function getVisibleSummaryCodecTrackCounts(tracks) {
  return SUMMARY_CODEC_GROUPS.map((group) => ({
    labelKey: group.labelKey,
    count: tracks.filter(group.matches).length
  })).filter((group) => group.count > 0);
}
