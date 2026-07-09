import { getCodecByConfigurationBoxType, getCodecBySampleEntryType } from "./codecs/registry.js";

async function runParserSelfTests() {
  const results = [];
  const aac = await import("./codecs/audio/aac.js");
  const mp3 = await import("./codecs/audio/mp3.js");
  const opus = await import("./codecs/audio/opus.js");
  const avc = await import("./codecs/video/avc.js");
  const hevc = await import("./codecs/video/hevc.js");
  const av1 = await import("./codecs/video/av1.js");

  const audioConfig = aac.parseAudioSpecificConfig(new Uint8Array([0x12, 0x10]));
  assertSelfTest(audioConfig.audioObjectType === 2, "AAC LC object type", results);
  assertSelfTest(audioConfig.samplingFrequency === 44100, "AAC 44.1kHz sample rate", results);
  assertSelfTest(audioConfig.channelConfiguration === 2, "AAC stereo channel config", results);

  const esds = aac.parseEsds(new Uint8Array([
    0x00, 0x00, 0x00, 0x00,
    0x03, 0x16, 0x00, 0x01, 0x00,
    0x04, 0x11, 0x40, 0x15, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
    0x05, 0x02, 0x12, 0x10
  ]));
  assertSelfTest(esds.audioConfig && esds.audioConfig.codecString === "mp4a.40.2", "esds mp4a.40.2", results);

  const avcSample = new Uint8Array([0x00, 0x00, 0x00, 0x02, 0x65, 0xb0]);
  assertSelfTest(avc.parseAvcSample(avcSample, 4).frameType === "I", "AVC synthetic I frame", results);

  const hevcConfigBytes = new Uint8Array(23);
  hevcConfigBytes[0] = 1;
  hevcConfigBytes[1] = 1;
  hevcConfigBytes[12] = 93;
  hevcConfigBytes[21] = 3;
  const hevcConfig = hevc.parseHevcC(hevcConfigBytes);
  assertSelfTest(hevcConfig.nalLengthSize === 4, "HEVC hvcC NAL length size", results);

  const hevcSample = new Uint8Array([0x00, 0x00, 0x00, 0x03, 0x26, 0x01, 0xac]);
  assertSelfTest(hevc.parseHevcSample(hevcSample, 4).frameType === "I", "HEVC synthetic I frame", results);

  const av1Config = av1.parseAv1C(new Uint8Array([0x81, 0x08, 0x40, 0x00]));
  assertSelfTest(av1Config.codecString === "av01.0.08M.10", "AV1 av1C codec string", results);
  assertSelfTest(av1.parseAv1Sample(new Uint8Array([0x32, 0x01, 0x00])).frameType === "I", "AV1 synthetic key frame", results);

  const mp3Header = mp3.parseMp3FrameHeader(new Uint8Array([0xff, 0xfb, 0x90, 0x64]), 0);
  assertSelfTest(mp3Header && mp3Header.samplingRate === 44100, "MP3 frame header sample rate", results);
  assertSelfTest(mp3Header && mp3Header.frameLength === 417, "MP3 frame header length", results);

  const opusHead = opus.parseOpusHead(new Uint8Array([
    0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64,
    0x01, 0x02, 0x38, 0x01, 0x80, 0xbb, 0x00, 0x00, 0x00, 0x00, 0x00
  ]));
  assertSelfTest(opusHead && opusHead.channelCount === 2, "OpusHead stereo", results);
  assertSelfTest(opus.parseOpusPacket(new Uint8Array([0x78])).durationSamples === 960, "Opus packet duration", results);

  assertSelfTest(getCodecBySampleEntryType("avc1").id === "avc", "codec registry sample entry lookup", results);
  assertSelfTest(getCodecByConfigurationBoxType("hvcC").id === "hevc", "codec registry config box lookup", results);
  assertSelfTest(getCodecBySampleEntryType("av01").id === "av1", "AV1 codec registry sample entry lookup", results);
  assertSelfTest(getCodecByConfigurationBoxType("av1C").id === "av1", "AV1 codec registry configuration lookup", results);

  return { passed: true, results };
}

function assertSelfTest(condition, name, results) {
  if (!condition) throw new Error("Self-test failed: " + name);
  results.push({ name, passed: true });
}

export {
  runParserSelfTests
};
