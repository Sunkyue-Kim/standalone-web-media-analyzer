const assert = require("node:assert/strict");
const test = require("node:test");

const {
  getAvcFfmpegComparableToken,
  matchProbeFramesToSampleRows,
  parseFfmpegAvcMacroblockMaps,
  readTraceInteger,
  verifyAvcTree
} = require("../tools/verify-frame-internals.cjs");

test("FFmpeg AVC debug maps preserve prediction and partition characters for every root", () => {
  const stderr = [
    "[h264 @ 0001] New frame, type: P",
    "[h264 @ 0001]    0 >  S  ",
    "[h264 @ 0001]   16 I  i  ",
    "[h264 @ 0001] New frame, type: B",
    "[h264 @ 0001]    0 d  D+ ",
    "[h264 @ 0001]   16 X- <| "
  ].join("\n");

  const maps = parseFfmpegAvcMacroblockMaps(stderr, 2, 2);

  assert.deepEqual(maps.map((map) => ({
    pictureType: map.pictureType,
    signature: map.signature
  })), [
    { pictureType: "P", signature: "> S I i " },
    { pictureType: "B", signature: "d D+X-<|" }
  ]);
});

test("AVC reference tokens distinguish exact syntax partitions and unavailable direct derivation", () => {
  assert.deepEqual(getAvcFfmpegComparableToken({ type: "P_L0_L0_16x8" }), {
    predictionCharacter: ">",
    partitionCharacter: "-"
  });
  assert.deepEqual(getAvcFfmpegComparableToken({
    type: "B_L0_L1_8x16",
    children: [{ predictionDirection: "L0" }, { predictionDirection: "L1" }]
  }), {
    predictionCharacter: "X",
    partitionCharacter: "|"
  });
  assert.deepEqual(getAvcFfmpegComparableToken({ type: "B_Direct_16x16" }), {
    predictionCharacter: "D",
    partitionCharacter: null
  });
  assert.deepEqual(getAvcFfmpegComparableToken({
    type: "B_8x8",
    children: [{ direct: true, predictionDirection: "Direct" }]
  }), {
    predictionCharacter: "X",
    partitionCharacter: "+"
  });
});

test("FFprobe frames match exact offsets first and unambiguous packet sizes second", () => {
  const firstSample = { offset: "48", size: 100 };
  const secondSample = { offset: "200", size: 80 };
  const matched = matchProbeFramesToSampleRows([
    { pkt_pos: "48", pkt_size: "100" },
    { pkt_pos: "196", pkt_size: "80" }
  ], [firstSample, secondSample], new Map([["48", firstSample], ["200", secondSample]]));

  assert.deepEqual(matched, [firstSample, secondSample]);
});

test("trace_headers integer extraction accepts aligned syntax fields", () => {
  const trace = [
    "[trace_headers @ 0001] 124 pic_width_in_luma_samples 000001 = 3840",
    "[trace_headers @ 0001] 193 log2_diff_max_min_luma_coding_block_size 00100 = 3"
  ].join("\n");

  assert.equal(readTraceInteger(trace, "pic_width_in_luma_samples"), 3840);
  assert.equal(readTraceInteger(trace, "log2_diff_max_min_luma_coding_block_size"), 3);
});

test("AVC reference validation requires exact child coverage and bit accounting", () => {
  const child = {
    codedLeft: 0,
    codedTop: 0,
    codedWidth: 16,
    codedHeight: 16,
    syntaxBits: 3
  };
  const macroblock = {
    codedLeft: 0,
    codedTop: 0,
    codedWidth: 16,
    codedHeight: 16,
    syntaxBits: 5,
    childSyntaxBits: 3,
    subtreeBits: 5,
    ownBits: 2,
    children: [child]
  };
  const result = {
    structureTruncated: false,
    macroblockColumns: 1,
    macroblockRows: 1,
    macroblocks: [macroblock],
    partitions: [child],
    sampleBits: 8,
    attributedBits: 5,
    overheadBits: 3
  };

  assert.doesNotThrow(() => verifyAvcTree(result, "fixture.mp4", 0));
  assert.throws(
    () => verifyAvcTree({ ...result, macroblocks: [{ ...macroblock, ownBits: 1 }] }, "fixture.mp4", 0),
    /root bit accounting/
  );
});
