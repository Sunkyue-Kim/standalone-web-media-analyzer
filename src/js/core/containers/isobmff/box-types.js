export const CONTAINER_BOXES = new Set([
  "moov", "trak", "mdia", "minf", "stbl", "edts", "dinf", "mvex", "moof", "traf",
  "mfra", "udta", "ilst", "tref", "ipro", "sinf", "schi"
]);

export const FULLBOX_CONTAINER_OFFSETS = new Map([
  ["meta", 4],
  ["smta", 4]
]);

export const PARSED_FIELD_BOXES = new Set([
  "ftyp", "mvhd", "tkhd", "mdhd", "hdlr", "stsd", "stts", "ctts", "stss", "stsc",
  "stsz", "stz2", "stco", "co64", "trex", "mfhd", "tfhd", "tfdt", "trun",
  "@xyz", "©xyz", "auth", "cami", "caml", "mdln", "saut", "SDLN", "smrd", "smta", "svss"
]);

export const BOX_TYPE_INFO = {
  EBML: {
    name: "EBML Header",
    description: "Extensible Binary Meta Language header that identifies a Matroska/WebM-style file."
  },
  EBMLVersion: {
    name: "EBML Version",
    description: "Version of the EBML document structure used by the file."
  },
  EBMLReadVersion: {
    name: "EBML Read Version",
    description: "Minimum EBML parser version required to read this file."
  },
  EBMLMaxIDLength: {
    name: "EBML Maximum ID Length",
    description: "Maximum byte length used by EBML element IDs in this file."
  },
  EBMLMaxSizeLength: {
    name: "EBML Maximum Size Length",
    description: "Maximum byte length used by EBML element size fields in this file."
  },
  DocType: {
    name: "Document Type",
    description: "EBML document type, such as webm or matroska."
  },
  DocTypeVersion: {
    name: "Document Type Version",
    description: "Version of the declared EBML document type."
  },
  DocTypeReadVersion: {
    name: "Document Type Read Version",
    description: "Minimum reader version required for the declared EBML document type."
  },
  Segment: {
    name: "Matroska Segment",
    description: "Top-level WebM/Matroska segment containing metadata, tracks, clusters, and cues."
  },
  SeekHead: {
    name: "Seek Head",
    description: "WebM/Matroska index that points to important top-level elements in the segment."
  },
  Seek: {
    name: "Seek Entry",
    description: "One entry in SeekHead, pairing an element ID with its segment-relative position."
  },
  SeekID: {
    name: "Seek ID",
    description: "Binary EBML element ID referenced by a Seek entry."
  },
  SeekPosition: {
    name: "Seek Position",
    description: "Segment-relative byte position of the element referenced by a Seek entry."
  },
  Info: {
    name: "Segment Info",
    description: "WebM/Matroska timing metadata such as timecode scale and duration."
  },
  TimecodeScale: {
    name: "Timecode Scale",
    description: "Nanoseconds per timecode unit used to convert WebM timestamps to real time."
  },
  Duration: {
    name: "Duration",
    description: "Segment duration expressed in units of TimecodeScale."
  },
  MuxingApp: {
    name: "Muxing Application",
    description: "Application or library that muxed the WebM/Matroska file."
  },
  WritingApp: {
    name: "Writing Application",
    description: "Application that wrote or finalized the WebM/Matroska file."
  },
  Tracks: {
    name: "Tracks",
    description: "Container for WebM/Matroska track descriptions."
  },
  TrackEntry: {
    name: "Track Entry",
    description: "Describes one WebM/Matroska track, including type, codec, dimensions, and audio settings."
  },
  TrackNumber: {
    name: "Track Number",
    description: "Small integer used by blocks to identify which track a payload belongs to."
  },
  TrackUID: {
    name: "Track UID",
    description: "Stable unique identifier for a WebM/Matroska track."
  },
  TrackType: {
    name: "Track Type",
    description: "Numeric track category such as video, audio, subtitles, or metadata."
  },
  CodecID: {
    name: "Codec ID",
    description: "WebM/Matroska codec identifier such as V_VP9 or A_OPUS."
  },
  CodecPrivate: {
    name: "Codec Private",
    description: "Codec-specific initialization bytes, such as OpusHead for Opus tracks."
  },
  DefaultDuration: {
    name: "Default Duration",
    description: "Default duration of each block or frame for this track, in nanoseconds."
  },
  Language: {
    name: "Language",
    description: "Language code associated with the track."
  },
  FlagDefault: {
    name: "Default Track Flag",
    description: "Indicates whether players should treat this track as default."
  },
  FlagInterlaced: {
    name: "Interlaced Flag",
    description: "Indicates whether video frames in this track are interlaced."
  },
  FlagLacing: {
    name: "Lacing Flag",
    description: "Indicates whether blocks in this track may use lacing to store multiple frames."
  },
  CodecDelay: {
    name: "Codec Delay",
    description: "Codec delay or pre-skip in nanoseconds, commonly used by Opus."
  },
  SeekPreRoll: {
    name: "Seek Pre-roll",
    description: "Amount of audio to decode before the seek target, commonly used by Opus."
  },
  Video: {
    name: "Video Settings",
    description: "WebM/Matroska video track settings such as pixel dimensions."
  },
  PixelWidth: {
    name: "Pixel Width",
    description: "Stored width of the encoded video frame in pixels."
  },
  PixelHeight: {
    name: "Pixel Height",
    description: "Stored height of the encoded video frame in pixels."
  },
  Audio: {
    name: "Audio Settings",
    description: "WebM/Matroska audio track settings such as sampling rate and channel count."
  },
  SamplingFrequency: {
    name: "Sampling Frequency",
    description: "Audio sampling frequency for this track."
  },
  Channels: {
    name: "Channels",
    description: "Number of audio channels in this track."
  },
  BitDepth: {
    name: "Bit Depth",
    description: "Audio bit depth when the track declares one."
  },
  Cluster: {
    name: "Cluster",
    description: "WebM/Matroska media data cluster containing timestamped blocks."
  },
  Timecode: {
    name: "Cluster Timecode",
    description: "Base timecode for blocks contained in this cluster."
  },
  SimpleBlock: {
    name: "Simple Block",
    description: "Timestamped WebM/Matroska block with track number, flags, and encoded frame payload."
  },
  BlockGroup: {
    name: "Block Group",
    description: "WebM/Matroska block container that can carry block-level side metadata such as discard padding."
  },
  Block: {
    name: "Block",
    description: "Encoded WebM/Matroska frame payload inside a BlockGroup."
  },
  DiscardPadding: {
    name: "Discard Padding",
    description: "Amount of padding to discard from a decoded block, often used for audio trimming."
  },
  Cues: {
    name: "Cues",
    description: "WebM/Matroska random-access index containing cue points."
  },
  CuePoint: {
    name: "Cue Point",
    description: "One random-access point in the WebM/Matroska cue index."
  },
  CueTime: {
    name: "Cue Time",
    description: "Timestamp of a cue point."
  },
  CueTrackPositions: {
    name: "Cue Track Positions",
    description: "Cluster and track position information for a cue point."
  },
  CueTrack: {
    name: "Cue Track",
    description: "Track number associated with a cue position."
  },
  CueClusterPosition: {
    name: "Cue Cluster Position",
    description: "Segment-relative byte position of the cluster for a cue point."
  },
  CueRelativePosition: {
    name: "Cue Relative Position",
    description: "Byte position of the referenced block relative to the containing cluster."
  },
  Tags: {
    name: "Tags",
    description: "Container for WebM/Matroska metadata tags."
  },
  Tag: {
    name: "Tag",
    description: "One WebM/Matroska metadata tag entry."
  },
  Targets: {
    name: "Targets",
    description: "Declares which segment, track, chapter, or attachment a tag applies to."
  },
  TagTrackUID: {
    name: "Tag Track UID",
    description: "Track UID targeted by a WebM/Matroska metadata tag."
  },
  SimpleTag: {
    name: "Simple Tag",
    description: "A single WebM/Matroska metadata key/value tag."
  },
  TagName: {
    name: "Tag Name",
    description: "Name or key of a WebM/Matroska metadata tag."
  },
  TagString: {
    name: "Tag String",
    description: "Text value of a WebM/Matroska metadata tag."
  },
  TagLanguage: {
    name: "Tag Language",
    description: "Language code for a WebM/Matroska metadata tag value."
  },
  TagDefault: {
    name: "Tag Default",
    description: "Indicates whether this tag value is the default for its language."
  },
  Void: {
    name: "Void",
    description: "Unused EBML padding that can be overwritten without changing file layout."
  },
  OggPage: {
    name: "Ogg Page",
    description: "Ogg container page with lacing values that assemble Opus packets."
  },
  ID3v2: {
    name: "ID3v2 Tag",
    description: "MP3 metadata tag usually stored before MPEG audio frames."
  },
  ID3v1: {
    name: "ID3v1 Tag",
    description: "Legacy MP3 metadata tag stored in the final 128 bytes of a file."
  },
  MPEGAudioStream: {
    name: "MPEG Audio Stream",
    description: "Sequence of MPEG audio frames parsed from an MP3 elementary stream."
  },
  ftyp: {
    name: "File Type Box",
    description: "Declares the MP4/QuickTime brand, minor version, and compatible brands."
  },
  moov: {
    name: "Movie Box",
    description: "Top-level metadata container for tracks, timing, and sample tables."
  },
  mdat: {
    name: "Media Data Box",
    description: "Contains encoded media payload bytes referenced by sample tables."
  },
  free: {
    name: "Free Space Box",
    description: "Padding or reserved bytes that can be overwritten later."
  },
  skip: {
    name: "Skip Box",
    description: "Padding or ignored bytes, similar to free."
  },
  wide: {
    name: "Wide Box",
    description: "Legacy QuickTime padding used to reserve space for large-size boxes."
  },
  uuid: {
    name: "UUID Box",
    description: "Vendor-specific extension box identified by a 16-byte UUID."
  },
  trak: {
    name: "Track Box",
    description: "Container for one media track, such as video, audio, or subtitles."
  },
  tkhd: {
    name: "Track Header Box",
    description: "Track-level ID, duration, dimensions, layer, and display metadata."
  },
  edts: {
    name: "Edit Box",
    description: "Container for edit-list timing adjustments."
  },
  elst: {
    name: "Edit List Box",
    description: "Maps presentation timeline segments to media timeline ranges."
  },
  mdia: {
    name: "Media Box",
    description: "Container for media timing, handler, and media information."
  },
  mdhd: {
    name: "Media Header Box",
    description: "Track media timescale, duration, and language."
  },
  hdlr: {
    name: "Handler Reference Box",
    description: "Declares the track handler type, such as vide or soun."
  },
  minf: {
    name: "Media Information Box",
    description: "Container for media-specific header, data references, and sample table."
  },
  vmhd: {
    name: "Video Media Header Box",
    description: "Video-track presentation metadata such as graphics mode."
  },
  smhd: {
    name: "Sound Media Header Box",
    description: "Audio-track presentation metadata such as balance."
  },
  hmhd: {
    name: "Hint Media Header Box",
    description: "Hint-track metadata for streaming."
  },
  nmhd: {
    name: "Null Media Header Box",
    description: "Generic media header for tracks without a specialized media header."
  },
  dinf: {
    name: "Data Information Box",
    description: "Container describing where media data is located."
  },
  dref: {
    name: "Data Reference Box",
    description: "Lists data references used by sample entries."
  },
  url: {
    name: "Data Entry URL Box",
    description: "A URL data reference, often self-contained in MP4 files."
  },
  urn: {
    name: "Data Entry URN Box",
    description: "A URN data reference for media data."
  },
  stbl: {
    name: "Sample Table Box",
    description: "Container for tables that map samples to timing, sizes, chunks, and offsets."
  },
  stsd: {
    name: "Sample Description Box",
    description: "Declares codec sample entries and codec configuration boxes."
  },
  stts: {
    name: "Decoding Time to Sample Box",
    description: "Maps samples to decode durations and DTS progression."
  },
  ctts: {
    name: "Composition Time to Sample Box",
    description: "Stores PTS offsets relative to DTS for reordered frames."
  },
  stsc: {
    name: "Sample to Chunk Box",
    description: "Maps sample runs to chunk numbers and samples-per-chunk."
  },
  stsz: {
    name: "Sample Size Box",
    description: "Stores per-sample byte sizes or one constant sample size."
  },
  stz2: {
    name: "Compact Sample Size Box",
    description: "Stores compact 4/8/16-bit per-sample sizes."
  },
  stco: {
    name: "Chunk Offset Box",
    description: "Stores 32-bit file offsets for media data chunks."
  },
  co64: {
    name: "64-bit Chunk Offset Box",
    description: "Stores 64-bit file offsets for media data chunks."
  },
  stss: {
    name: "Sync Sample Box",
    description: "Lists random-access sync samples, usually keyframes."
  },
  stsh: {
    name: "Shadow Sync Sample Box",
    description: "Maps non-sync samples to shadow sync samples."
  },
  sdtp: {
    name: "Sample Dependency Type Box",
    description: "Stores per-sample dependency flags for random access and prediction."
  },
  sbgp: {
    name: "Sample to Group Box",
    description: "Maps sample ranges to sample groups."
  },
  sgpd: {
    name: "Sample Group Description Box",
    description: "Describes sample groups referenced by sbgp."
  },
  saiz: {
    name: "Sample Auxiliary Information Sizes Box",
    description: "Stores sizes for auxiliary per-sample information."
  },
  saio: {
    name: "Sample Auxiliary Information Offsets Box",
    description: "Stores offsets for auxiliary per-sample information."
  },
  mvhd: {
    name: "Movie Header Box",
    description: "Movie-level timescale, duration, rate, volume, and next track ID."
  },
  mvex: {
    name: "Movie Extends Box",
    description: "Declares that the file uses movie fragments and default fragment settings."
  },
  mehd: {
    name: "Movie Extends Header Box",
    description: "Stores overall fragmented movie duration."
  },
  trex: {
    name: "Track Extends Box",
    description: "Default sample description, duration, size, and flags for fragments."
  },
  moof: {
    name: "Movie Fragment Box",
    description: "Container for one fragmented MP4 fragment's track runs."
  },
  mfhd: {
    name: "Movie Fragment Header Box",
    description: "Fragment sequence number."
  },
  traf: {
    name: "Track Fragment Box",
    description: "Container for one track's fragment metadata and sample runs."
  },
  tfhd: {
    name: "Track Fragment Header Box",
    description: "Track ID and default sample values for following trun boxes."
  },
  tfdt: {
    name: "Track Fragment Decode Time Box",
    description: "Base decode time for the first sample in a track fragment."
  },
  trun: {
    name: "Track Run Box",
    description: "Per-sample duration, size, flags, composition offsets, and data offset in fragments."
  },
  mfra: {
    name: "Movie Fragment Random Access Box",
    description: "Container for random-access indices into movie fragments."
  },
  tfra: {
    name: "Track Fragment Random Access Box",
    description: "Random-access entries for one track in fragmented media."
  },
  mfro: {
    name: "Movie Fragment Random Access Offset Box",
    description: "Stores the size of the mfra box for backward lookup."
  },
  meta: {
    name: "Metadata Box",
    description: "Container for timed or file-level metadata."
  },
  keys: {
    name: "Metadata Keys Box",
    description: "Metadata key table used by mdta-style ilst entries."
  },
  ilst: {
    name: "Item List Box",
    description: "QuickTime/iTunes metadata item list."
  },
  metadataItem: {
    name: "Indexed Metadata Item Box",
    description: "Numeric metadata item entry in an ilst box, usually referencing a key from the keys box."
  },
  "©too": {
    name: "Encoding Tool Metadata Item",
    description: "QuickTime/iTunes metadata item that usually stores the encoder or muxing tool name."
  },
  SDLN: {
    name: "Sequence Playback Metadata Box",
    description: "Vendor-specific user-data atom observed in Android-recorded MP4/MOV files, often carrying payload such as SEQ_PLAY."
  },
  smrd: {
    name: "Samsung Recording Metadata Box",
    description: "Samsung/Android vendor-specific user-data atom observed with payload such as TRUEBLUE."
  },
  smta: {
    name: "Samsung Metadata Atom",
    description: "Samsung/Android vendor-specific metadata atom. ExifTool maps it as SamsungSmta; its payload commonly starts with a 4-byte prefix followed by nested atoms such as mdln, saut, or svss."
  },
  auth: {
    name: "Author Metadata Atom",
    description: "QuickTime-style user-data atom carrying author, device, or creator text metadata."
  },
  "@xyz": {
    name: "Location Metadata Item",
    description: "Ricoh/Samsung-style variant of the QuickTime location metadata item, commonly storing ISO 6709-style latitude, longitude, and altitude text."
  },
  "©xyz": {
    name: "Location Metadata Item",
    description: "QuickTime location metadata item, commonly storing ISO 6709-style latitude, longitude, and altitude text."
  },
  cami: {
    name: "Camera Information Metadata Box",
    description: "Vendor-specific camera information atom observed in Android/Samsung camera files."
  },
  caml: {
    name: "Camera Metadata Atom",
    description: "Vendor-specific camera metadata atom. No stable public field layout is known, so this analyzer exposes text candidates and a raw hex payload view."
  },
  mdln: {
    name: "Samsung Model Metadata Atom",
    description: "Nested Samsung smta atom commonly storing the device model string."
  },
  saut: {
    name: "Samsung Authoring Metadata Atom",
    description: "Nested Samsung smta atom observed in Galaxy MP4 files. The public structure is not well documented, so raw bytes are shown."
  },
  svss: {
    name: "Samsung Video Metadata Atom",
    description: "Nested Samsung smta atom mapped by ExifTool as SamsungSvss for Galaxy-era video metadata."
  },
  udta: {
    name: "User Data Box",
    description: "Container for user data and metadata."
  },
  tref: {
    name: "Track Reference Box",
    description: "Container for references between tracks."
  },
  sinf: {
    name: "Protection Scheme Information Box",
    description: "Container for encryption or protection scheme metadata."
  },
  frma: {
    name: "Original Format Box",
    description: "Stores the original unprotected sample entry format."
  },
  schm: {
    name: "Scheme Type Box",
    description: "Identifies the protection or restricted scheme."
  },
  schi: {
    name: "Scheme Information Box",
    description: "Container for scheme-specific protection information."
  },
  avcC: {
    name: "AVC Configuration Box",
    description: "H.264/AVC decoder configuration including profile, level, SPS/PPS, and NAL length size."
  },
  hvcC: {
    name: "HEVC Configuration Box",
    description: "H.265/HEVC decoder configuration including profile, level, VPS/SPS/PPS, and NAL length size."
  },
  av1C: {
    name: "AV1 Configuration Box",
    description: "AV1 decoder configuration including profile, level, tier, bit depth, chroma format, and configuration OBUs."
  },
  esds: {
    name: "Elementary Stream Descriptor Box",
    description: "MPEG-4 descriptors, commonly carrying AAC AudioSpecificConfig for mp4a tracks."
  },
  pasp: {
    name: "Pixel Aspect Ratio Box",
    description: "Horizontal and vertical pixel aspect ratio spacing."
  },
  colr: {
    name: "Colour Information Box",
    description: "Color primaries, transfer characteristics, matrix coefficients, or ICC profile."
  },
  clap: {
    name: "Clean Aperture Box",
    description: "Clean aperture dimensions and offsets for display cropping."
  },
  btrt: {
    name: "Bitrate Box",
    description: "Buffer size, maximum bitrate, and average bitrate hints."
  },
  avc1: {
    name: "AVC Sample Entry",
    description: "H.264/AVC video sample entry using avcC codec configuration."
  },
  avc3: {
    name: "AVC3 Sample Entry",
    description: "H.264/AVC video sample entry where parameter sets may appear in samples."
  },
  hvc1: {
    name: "HEVC Sample Entry",
    description: "H.265/HEVC video sample entry using hvcC codec configuration."
  },
  hev1: {
    name: "HEV1 Sample Entry",
    description: "H.265/HEVC sample entry where parameter sets may appear in samples."
  },
  av01: {
    name: "AV1 Sample Entry",
    description: "AV1 video sample entry using av1C codec configuration."
  },
  mp4a: {
    name: "MPEG-4 Audio Sample Entry",
    description: "Audio sample entry, commonly AAC with esds decoder configuration."
  },
  ap4h: {
    name: "Apple ProRes 4444 Sample Entry",
    description: "Apple ProRes 4444 video sample entry."
  }
};
