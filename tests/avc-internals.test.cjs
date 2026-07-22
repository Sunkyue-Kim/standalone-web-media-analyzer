const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { createSourceModuleLoader } = require("./helpers/source-module-loader.cjs");

const fixturePromises = new Map();

test("AVC internals parser is self-contained native JavaScript sourced to the H.264 specification", () => {
  const source = fs.readFileSync(path.join(
    __dirname,
    "..",
    "src",
    "js",
    "core",
    "codecs",
    "video",
    "internals",
    "avc-internals.js"
  ), "utf8");
  assert.doesNotMatch(source, /^\s*import\s/m);
  assert.match(source, /ITU-T H\.264 \(06\/2026\)/);
  assert.match(source, /H\.264 Table 9-44/);
  assert.match(source, /H\.264 clause 9\.2/);
});

function loadAvcFixture(fileName) {
  if (!fixturePromises.has(fileName)) {
    fixturePromises.set(fileName, (async () => {
      const loader = await createSourceModuleLoader();
      const { Core } = await loader.import("src/js/core/analyzer-core.js");
      const avc = await loader.import("src/js/core/codecs/video/avc.js");
      const fileBytes = fs.readFileSync(path.join(__dirname, "..", "validation", "generated", fileName));
      const file = new Blob([fileBytes], { type: "video/mp4" });
      Object.defineProperty(file, "name", { value: fileName });
      const analysis = await Core.analyzeFile(file, {});
      const track = analysis.tracks.find((candidate) => candidate.handlerType === "vide");
      assert.ok(track, fileName + " must expose a video track");
      const sampleRows = analysis.sampleRows.filter((row) => String(row.trackId) === String(track.trackId));
      return { analysis, avc, Core, sampleRows, track };
    })());
  }
  return fixturePromises.get(fileName);
}

async function parseFixtureSample(fileName, sampleIndex) {
  const fixture = await loadAvcFixture(fileName);
  const sampleRow = fixture.sampleRows.find((row) => row.sampleIndex === sampleIndex);
  assert.ok(sampleRow, fileName + " must contain sample " + sampleIndex);
  const sampleBytes = typeof fixture.analysis.reader.readExactRange === "function"
    ? await fixture.analysis.reader.readExactRange(BigInt(sampleRow.offset), BigInt(sampleRow.size))
    : await fixture.analysis.reader.readRange(BigInt(sampleRow.offset), BigInt(sampleRow.size));
  assert.equal(sampleBytes.byteLength, sampleRow.size);
  return {
    ...fixture,
    result: fixture.avc.parseAvcFrameInternals(sampleBytes, fixture.track.codecConfig, fixture.track),
    sampleBytes,
    sampleRow
  };
}

function countMacroblockTypes(macroblocks) {
  const counts = {};
  for (const macroblock of macroblocks) counts[macroblock.type] = (counts[macroblock.type] || 0) + 1;
  return counts;
}

function assertNoSyntheticBitFields(nodes) {
  for (const node of nodes) {
    assert.equal("estimatedBits" in node, false);
    assert.equal("bitDensity" in node, false);
    assert.equal("percentile" in node, false);
    assertNoSyntheticBitFields(node.children || []);
  }
}

function createLengthPrefixedNalUnit(nalUnit, lengthFieldSize) {
  const bytes = nalUnit instanceof Uint8Array ? nalUnit : Uint8Array.from(nalUnit);
  const output = new Uint8Array(lengthFieldSize + bytes.byteLength);
  let remainingLength = bytes.byteLength;
  for (let index = lengthFieldSize - 1; index >= 0; index -= 1) {
    output[index] = remainingLength & 0xff;
    remainingLength = Math.floor(remainingLength / 256);
  }
  output.set(bytes, lengthFieldSize);
  return output;
}

function concatenateByteArrays(byteArrays) {
  const byteLength = byteArrays.reduce((total, bytes) => total + bytes.byteLength, 0);
  const output = new Uint8Array(byteLength);
  let offset = 0;
  for (const bytes of byteArrays) {
    output.set(bytes, offset);
    offset += bytes.byteLength;
  }
  return output;
}

function createRbspNalUnit(nalHeader, writeSyntax) {
  const bits = [];
  const bitWriter = {
    writeBit(value) {
      bits.push(value ? 1 : 0);
    },
    writeBits(value, bitCount) {
      for (let bitIndex = bitCount - 1; bitIndex >= 0; bitIndex -= 1) {
        bits.push((value >> bitIndex) & 1);
      }
    },
    writeUnsignedExpGolomb(value) {
      const codeNumber = value + 1;
      const bitCount = Math.floor(Math.log2(codeNumber)) + 1;
      for (let index = 1; index < bitCount; index += 1) bits.push(0);
      this.writeBits(codeNumber, bitCount);
    },
    writeSignedExpGolomb(value) {
      this.writeUnsignedExpGolomb(value <= 0 ? -2 * value : 2 * value - 1);
    }
  };
  writeSyntax(bitWriter);
  bitWriter.writeBit(1);
  while (bits.length % 8) bitWriter.writeBit(0);

  const rbspBytes = [];
  for (let bitOffset = 0; bitOffset < bits.length; bitOffset += 8) {
    let byte = 0;
    for (let bitIndex = 0; bitIndex < 8; bitIndex += 1) {
      byte = byte * 2 + bits[bitOffset + bitIndex];
    }
    rbspBytes.push(byte);
  }
  const escapedBytes = [];
  let consecutiveZeroBytes = 0;
  for (const byte of rbspBytes) {
    if (consecutiveZeroBytes >= 2 && byte <= 3) {
      escapedBytes.push(3);
      consecutiveZeroBytes = 0;
    }
    escapedBytes.push(byte);
    consecutiveZeroBytes = byte === 0 ? consecutiveZeroBytes + 1 : 0;
  }
  return Uint8Array.from([nalHeader, ...escapedBytes]);
}

function createFullyCroppedEdgeFixture(
  writeSliceData = (bitWriter) => {
    bitWriter.writeUnsignedExpGolomb(4);
  },
  { sliceType = 0 } = {}
) {
  const sequenceParameterSet = createRbspNalUnit(0x67, (bitWriter) => {
    bitWriter.writeBits(66, 8);
    bitWriter.writeBits(0, 8);
    bitWriter.writeBits(10, 8);
    bitWriter.writeUnsignedExpGolomb(0);
    bitWriter.writeUnsignedExpGolomb(0);
    bitWriter.writeUnsignedExpGolomb(2);
    bitWriter.writeUnsignedExpGolomb(1);
    bitWriter.writeBit(0);
    bitWriter.writeUnsignedExpGolomb(1);
    bitWriter.writeUnsignedExpGolomb(1);
    bitWriter.writeBit(1);
    bitWriter.writeBit(1);
    bitWriter.writeBit(1);
    bitWriter.writeUnsignedExpGolomb(8);
    bitWriter.writeUnsignedExpGolomb(0);
    bitWriter.writeUnsignedExpGolomb(8);
    bitWriter.writeUnsignedExpGolomb(0);
    bitWriter.writeBit(0);
  });
  const pictureParameterSet = createRbspNalUnit(0x68, (bitWriter) => {
    bitWriter.writeUnsignedExpGolomb(0);
    bitWriter.writeUnsignedExpGolomb(0);
    bitWriter.writeBit(0);
    bitWriter.writeBit(0);
    bitWriter.writeUnsignedExpGolomb(0);
    bitWriter.writeUnsignedExpGolomb(0);
    bitWriter.writeUnsignedExpGolomb(0);
    bitWriter.writeBit(0);
    bitWriter.writeBits(0, 2);
    bitWriter.writeSignedExpGolomb(0);
    bitWriter.writeSignedExpGolomb(0);
    bitWriter.writeSignedExpGolomb(0);
    bitWriter.writeBit(0);
    bitWriter.writeBit(0);
    bitWriter.writeBit(0);
  });
  const slice = createRbspNalUnit(0x61, (bitWriter) => {
    bitWriter.writeUnsignedExpGolomb(0);
    bitWriter.writeUnsignedExpGolomb(sliceType);
    bitWriter.writeUnsignedExpGolomb(0);
    bitWriter.writeBits(0, 4);
    if (sliceType % 5 === 1) bitWriter.writeBit(1);
    bitWriter.writeBit(0);
    bitWriter.writeBit(0);
    if (sliceType % 5 === 1) bitWriter.writeBit(0);
    bitWriter.writeBit(0);
    bitWriter.writeSignedExpGolomb(0);
    writeSliceData(bitWriter);
  });
  const sampleBytes = new Uint8Array(4 + slice.byteLength);
  sampleBytes[3] = slice.byteLength;
  sampleBytes.set(slice, 4);
  return {
    codecConfig: {
      nalLengthSize: 4,
      sps: [{ bytes: Array.from(sequenceParameterSet) }],
      pps: [{ bytes: Array.from(pictureParameterSet) }]
    },
    sampleBytes
  };
}

test("AVC CAVLC traversal accounts exact macroblock syntax for the bundled baseline fixture", async () => {
  const { avc, result, sampleBytes, track } = await parseFixtureSample("avc_10020.mp4", 1);

  assert.equal(typeof avc.avcVideoCodec.parseFrameInternals, "function");
  assert.ok(track.codecConfig.sps[0].bytes.length > 0);
  assert.ok(track.codecConfig.pps[0].bytes.length > 0);
  assert.equal(track.codecConfig.sps[0].parsed.width, 64);
  assert.equal(track.codecConfig.sps[0].parsed.height, 64);
  assert.equal(track.codecConfig.pps[0].parsed.entropyCodingModeFlag, false);

  assert.equal(result.kind, "avc-frame-internals");
  assert.equal(result.complete, true);
  assert.equal(result.granularity, "partition-tree");
  assert.equal(result.entropyCodingMode, "CAVLC");
  assert.equal(result.accountingKind, "cavlc-syntax-bit-length");
  assert.equal(result.width, 64);
  assert.equal(result.height, 64);
  assert.equal(result.macroblockColumns, 4);
  assert.equal(result.macroblockRows, 4);
  assert.equal(result.macroblockCount, 16);
  assert.equal(result.macroblocks.length, 16);
  assert.equal(new Set(result.macroblocks.map((macroblock) => macroblock.id)).size, 16);
  assert.equal(result.partitions.length, 16);
  assert.deepEqual(countMacroblockTypes(result.macroblocks), { I_16x16: 16 });
  assert.ok(result.macroblocks.every((macroblock) => macroblock.qpY === 20));
  assert.deepEqual(
    [
      result.macroblocks[15].left,
      result.macroblocks[15].top,
      result.macroblocks[15].width,
      result.macroblocks[15].height
    ],
    [48, 48, 16, 16]
  );

  assert.equal(result.sampleBits, sampleBytes.byteLength * 8);
  assert.equal(result.sampleBits, 21744);
  assert.equal(result.attributedBits, 16882);
  assert.equal(result.overheadBits, 4862);
  assert.ok(result.attributedBits <= result.sampleBits);
  assert.equal(
    result.attributedBits,
    result.macroblocks.reduce((total, macroblock) => total + macroblock.syntaxBits, 0)
  );
  assert.equal(result.sampleBits, result.attributedBits + result.overheadBits);
  assert.ok(result.macroblocks.every((macroblock) => (
    macroblock.subtreeBits === macroblock.syntaxBits &&
    macroblock.ownBits + macroblock.children.reduce((total, child) => total + child.syntaxBits, 0) ===
      macroblock.syntaxBits
  )));
  assertNoSyntheticBitFields(result.macroblocks);
});

test("AVC CABAC traversal matches FFmpeg macroblock classes and QP range for the bundled fixture", async () => {
  const { result, sampleBytes } = await parseFixtureSample("avc_moving_detail_patch.mp4", 1);

  assert.equal(result.complete, true);
  assert.equal(result.granularity, "partition-tree");
  assert.equal(result.entropyCodingMode, "CABAC");
  assert.equal(result.accountingKind, "cabac-renormalization-cursor-delta");
  assert.equal(result.width, 1280);
  assert.equal(result.height, 720);
  assert.equal(result.macroblockColumns, 80);
  assert.equal(result.macroblockRows, 45);
  assert.equal(result.macroblockCount, 3600);
  assert.equal(result.macroblocks.length, 3600);
  assert.equal(new Set(result.macroblocks.map((macroblock) => macroblock.id)).size, 3600);
  assert.deepEqual(countMacroblockTypes(result.macroblocks), {
    I_4x4: 96,
    I_16x16: 3454,
    I_8x8: 50
  });
  assert.equal(result.partitions.length, 5190);
  assert.equal(Math.min(...result.macroblocks.map((macroblock) => macroblock.qpY)), 3);
  assert.equal(Math.max(...result.macroblocks.map((macroblock) => macroblock.qpY)), 34);
  assert.deepEqual(
    [
      result.macroblocks[3599].left,
      result.macroblocks[3599].top,
      result.macroblocks[3599].width,
      result.macroblocks[3599].height
    ],
    [1264, 704, 16, 16]
  );
  assert.ok(result.partitions.every((partition) => [4, 8, 16].includes(partition.codedWidth)));
  assert.ok(result.macroblocks.every((macroblock) => (
    Number.isInteger(macroblock.syntaxBits) && macroblock.syntaxBits >= 0
  )));

  assert.equal(result.sampleBits, sampleBytes.byteLength * 8);
  assert.equal(result.sampleBits, 145920);
  assert.equal(result.attributedBits, 140058);
  assert.equal(result.overheadBits, 5862);
  assert.ok(result.attributedBits <= result.sampleBits);
  assert.equal(
    result.attributedBits,
    result.macroblocks.reduce((total, macroblock) => total + macroblock.syntaxBits, 0)
  );
  assert.equal(result.sampleBits, result.attributedBits + result.overheadBits);
  assert.ok(result.macroblocks.every((macroblock) => (
    macroblock.subtreeBits === macroblock.syntaxBits &&
    macroblock.ownBits + macroblock.children.reduce((total, child) => total + child.syntaxBits, 0) ===
      macroblock.syntaxBits
  )));
  assertNoSyntheticBitFields(result.macroblocks);
});

test("AVC internals applies in-band SPS and PPS before avc3/avc4 slices", async () => {
  const { avc, result: configuredResult, sampleBytes, track } = await parseFixtureSample(
    "avc_moving_detail_patch.mp4",
    1
  );
  const nalLengthSize = track.codecConfig.nalLengthSize;
  const parameterSetNalUnits = [
    ...track.codecConfig.sps.map((entry) => Uint8Array.from(entry.bytes)),
    ...track.codecConfig.pps.map((entry) => Uint8Array.from(entry.bytes))
  ];
  const inBandSampleBytes = concatenateByteArrays([
    ...parameterSetNalUnits.map((nalUnit) => createLengthPrefixedNalUnit(nalUnit, nalLengthSize)),
    sampleBytes
  ]);
  const inBandOnlyConfiguration = {
    ...track.codecConfig,
    sps: [],
    pps: [],
    spsCount: 0,
    ppsCount: 0
  };

  const inBandResult = avc.parseAvcFrameInternals(
    inBandSampleBytes,
    inBandOnlyConfiguration,
    { ...track, codec: "avc3" }
  );

  assert.equal(inBandResult.complete, true);
  assert.equal(inBandResult.granularity, "partition-tree");
  assert.deepEqual(countMacroblockTypes(inBandResult.macroblocks), countMacroblockTypes(configuredResult.macroblocks));
  assert.equal(inBandResult.macroblockCount, configuredResult.macroblockCount);
  assert.equal(inBandResult.partitions.length, configuredResult.partitions.length);
  assert.ok(inBandResult.nals.some((nalUnit) => nalUnit.type === 7));
  assert.ok(inBandResult.nals.some((nalUnit) => nalUnit.type === 8));
});

test("AVC worker output preserves roots and caps the complete returned tree record count", async () => {
  const { avc, Core, sampleBytes, sampleRow, track } = await parseFixtureSample(
    "avc_moving_detail_patch.mp4",
    1
  );
  const result = avc.parseAvcFrameInternals(sampleBytes, track.codecConfig, track, {
    maximumStructureRecords: 3600
  });

  assert.equal(result.complete, true);
  assert.equal(result.macroblocks.length, 3600);
  assert.equal(result.structureRecordCount, 3600);
  assert.equal(result.decodedStructureRecordCount, 8790);
  assert.equal(result.structureTruncated, true);
  assert.equal(result.omittedPartitionCount, 5190);
  assert.equal(result.leafBlockCount, 5190);
  assert.equal(result.partitions.length, 0);
  assert.ok(result.macroblocks.every((macroblock) => (
    macroblock.children.length === 0 && macroblock.omittedDescendantCount > 0
  )));
  assert.deepEqual(JSON.parse(JSON.stringify(result.partitionDepths)), [
    { depth: 0, count: 3600 },
    { depth: 1, count: 5190 }
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(result.partitionModes)), [
    { mode: "I_16x16", count: 6908 },
    { mode: "I_4x4", count: 1632 },
    { mode: "I_8x8", count: 250 }
  ]);
  assert.ok(result.warnings.some((warning) => warning.includes("capped at 3600 records")));

  const model = Core.buildFrameInternalsModel(sampleRow, track, { parsedFrameInternals: result });
  assert.equal(model.partitionBlockCount, 8790);
  assert.equal(model.leafBlockCount, 5190);
  assert.equal(model.retainedStructureRecordCount, 3600);
  assert.equal(model.structureTruncated, true);
  assert.equal(model.cells.length, 3600);
  assert.equal(
    model.cells.reduce((total, cell) => total + cell.aggregatedDescendantCount, 0),
    5190
  );
});

test("AVC CABAC P traversal matches FFmpeg macroblock classes for the rotated Android fixture", async () => {
  const { Core, result, sampleBytes, sampleRow, track } = await parseFixtureSample(
    "1000024017.mp4",
    2
  );

  assert.equal(result.kind, "avc-frame-internals");
  assert.equal(result.complete, true);
  assert.equal(result.granularity, "partition-tree");
  assert.equal(result.reason, undefined);
  assert.equal(result.entropyCodingMode, "CABAC");
  assert.equal(result.accountingKind, "cabac-renormalization-cursor-delta");
  assert.equal(result.frameType, "P");
  assert.equal(result.macroblockCount, 3600);
  assert.equal(result.macroblocks.length, 3600);
  assert.deepEqual(countMacroblockTypes(result.macroblocks), {
    P_L0_16x16: 1530,
    P_Skip: 1962,
    P_L0_L0_8x16: 43,
    P_L0_L0_16x8: 36,
    P_8x8: 27,
    I_16x16: 2
  });
  assert.equal(result.partitions.length, 3760);
  assert.ok(result.macroblocks.every((macroblock) => (
    Number.isInteger(macroblock.syntaxBits) &&
    macroblock.syntaxBits >= 0 &&
    macroblock.subtreeBits === macroblock.syntaxBits &&
    macroblock.ownBits + macroblock.children.reduce((total, child) => total + child.syntaxBits, 0) ===
      macroblock.syntaxBits
  )));
  const horizontalPartitionMacroblock = result.macroblocks.find(
    (macroblock) => macroblock.type === "P_L0_L0_16x8"
  );
  assert.ok(horizontalPartitionMacroblock);
  assert.deepEqual(
    Array.from(horizontalPartitionMacroblock.children, (partition) => [
      partition.codedWidth,
      partition.codedHeight,
      partition.referenceIndexL0,
      Number.isInteger(partition.motionVectorDifferenceL0X),
      Number.isInteger(partition.motionVectorDifferenceL0Y)
    ]),
    [
      [16, 8, 0, true, true],
      [16, 8, 0, true, true]
    ]
  );
  assert.deepEqual(
    [
      result.macroblocks[3599].left,
      result.macroblocks[3599].top,
      result.macroblocks[3599].width,
      result.macroblocks[3599].height
    ],
    [1264, 704, 16, 16]
  );
  assert.equal(result.sampleBits, sampleBytes.byteLength * 8);
  assert.equal(result.sampleBits, 44120);
  assert.equal(result.attributedBits, 43942);
  assert.equal(result.overheadBits, 178);
  assert.equal(result.sampleBits, result.attributedBits + result.overheadBits);
  assertNoSyntheticBitFields(result.macroblocks);

  const model = Core.buildFrameInternalsModel(sampleRow, track, { parsedFrameInternals: result });
  assert.equal(model.kind, "video-grid");
  assert.equal(model.granularity, "partition-tree");
  assert.equal(model.attributedBits, 43942);
  assert.equal(model.overheadBits, 178);
  assert.equal(model.displayRotationDegrees, -90);
  assert.equal(model.mediaWidth, 720);
  assert.equal(model.mediaHeight, 1280);
  assert.equal(model.cells.length, 3760);
  assert.deepEqual(
    [
      model.cells[0].displayPixelLeft,
      model.cells[0].displayPixelTop,
      model.cells[0].displayPixelRight,
      model.cells[0].displayPixelBottom
    ],
    [704, 0, 720, 16]
  );
});

test("AVC CABAC B traversal decodes actual macroblock partitions and syntax bits", async () => {
  const { result, sampleBytes } = await parseFixtureSample("avc_bframes.mp4", 3);

  assert.equal(result.complete, true);
  assert.equal(result.frameType, "B");
  assert.equal(result.granularity, "partition-tree");
  assert.equal(result.accountingKind, "cabac-renormalization-cursor-delta");
  assert.equal(result.sampleBits, sampleBytes.byteLength * 8);
  assert.equal(result.sampleBits, 93336);
  assert.equal(result.attributedBits, 93152);
  assert.equal(result.overheadBits, 184);
  assert.equal(result.sampleBits, result.attributedBits + result.overheadBits);
  const macroblockTypes = countMacroblockTypes(result.macroblocks);
  assert.equal(macroblockTypes.B_Skip, 3079);
  assert.equal(macroblockTypes.B_8x8, 29);
  assert.equal(macroblockTypes.B_Direct_16x16, 27);
  assert.equal(macroblockTypes.B_L0_L0_16x8, 10);
  assert.equal(macroblockTypes.B_L0_L1_8x16, 15);
  assert.equal(result.partitions.length, 4269);
  assert.ok(result.macroblocks.every((macroblock) => (
    Number.isInteger(macroblock.syntaxBits) && macroblock.syntaxBits >= 0 &&
    macroblock.children.length > 0
  )));
  assertNoSyntheticBitFields(result.macroblocks);
});

test("AVC CAVLC P traversal decodes explicit 16x8 geometry and skip runs", async () => {
  const loader = await createSourceModuleLoader();
  const avc = await loader.import("src/js/core/codecs/video/avc.js");
  const { codecConfig, sampleBytes } = createFullyCroppedEdgeFixture((bitWriter) => {
    bitWriter.writeUnsignedExpGolomb(0);
    bitWriter.writeUnsignedExpGolomb(1);
    bitWriter.writeSignedExpGolomb(0);
    bitWriter.writeSignedExpGolomb(0);
    bitWriter.writeSignedExpGolomb(0);
    bitWriter.writeSignedExpGolomb(0);
    bitWriter.writeUnsignedExpGolomb(0);
    bitWriter.writeUnsignedExpGolomb(3);
  });
  const result = avc.parseAvcFrameInternals(sampleBytes, codecConfig, null);

  assert.equal(result.complete, true);
  assert.equal(result.granularity, "partition-tree");
  assert.equal(result.entropyCodingMode, "CAVLC");
  assert.deepEqual(countMacroblockTypes(result.macroblocks), {
    P_L0_L0_16x8: 1,
    P_Skip: 3
  });
  assert.equal(result.partitions.length, 5);
  assert.deepEqual(
    Array.from(result.macroblocks[0].children, (partition) => [
      partition.codedLeft,
      partition.codedTop,
      partition.codedWidth,
      partition.codedHeight,
      partition.referenceIndexL0,
      partition.motionVectorDifferenceL0X,
      partition.motionVectorDifferenceL0Y
    ]),
    [
      [0, 0, 16, 8, 0, 0, 0],
      [0, 8, 16, 8, 0, 0, 0]
    ]
  );
  assert.equal(result.macroblocks[0].syntaxBits, 8);
  assert.equal(result.macroblocks[0].ownBits, 4);
  assert.equal(result.macroblocks[1].syntaxBits, 0);
  assert.equal(result.attributedBits, 8);
  assert.equal(result.sampleBits, result.attributedBits + result.overheadBits);
});

test("AVC CAVLC B traversal keeps B mb_type 4 reference syntax distinct from P_8x8ref0", async () => {
  const loader = await createSourceModuleLoader();
  const avc = await loader.import("src/js/core/codecs/video/avc.js");
  const { codecConfig, sampleBytes } = createFullyCroppedEdgeFixture((bitWriter) => {
    bitWriter.writeUnsignedExpGolomb(0);
    bitWriter.writeUnsignedExpGolomb(4);
    bitWriter.writeSignedExpGolomb(0);
    bitWriter.writeSignedExpGolomb(0);
    bitWriter.writeSignedExpGolomb(0);
    bitWriter.writeSignedExpGolomb(0);
    bitWriter.writeUnsignedExpGolomb(0);
    bitWriter.writeUnsignedExpGolomb(3);
  }, { sliceType: 1 });
  const result = avc.parseAvcFrameInternals(sampleBytes, codecConfig, null);

  assert.equal(result.complete, true);
  assert.equal(result.frameType, "B");
  assert.equal(result.granularity, "partition-tree");
  assert.equal(result.entropyCodingMode, "CAVLC");
  assert.deepEqual(countMacroblockTypes(result.macroblocks), {
    B_L0_L0_16x8: 1,
    B_Skip: 3
  });
  assert.deepEqual(
    Array.from(result.macroblocks[0].children, (partition) => [
      partition.codedLeft,
      partition.codedTop,
      partition.codedWidth,
      partition.codedHeight,
      partition.referenceIndexL0,
      partition.motionVectorDifferenceL0X,
      partition.motionVectorDifferenceL0Y
    ]),
    [
      [0, 0, 16, 8, 0, 0, 0],
      [0, 8, 16, 8, 0, 0, 0]
    ]
  );
  assert.equal(result.sampleBits, result.attributedBits + result.overheadBits);
});

test("AVC cropping retains fully cropped intrinsic macroblocks in root statistics", async () => {
  const loader = await createSourceModuleLoader();
  const { Core } = await loader.import("src/js/core/analyzer-core.js");
  const avc = await loader.import("src/js/core/codecs/video/avc.js");
  const { codecConfig, sampleBytes } = createFullyCroppedEdgeFixture();
  const result = avc.parseAvcFrameInternals(sampleBytes, codecConfig, null);

  assert.equal(result.complete, true);
  assert.equal(result.granularity, "partition-tree");
  assert.equal(result.reason, undefined);
  assert.equal(result.entropyCodingMode, "CAVLC");
  assert.equal(result.codedWidth, 32);
  assert.equal(result.codedHeight, 32);
  assert.equal(result.width, 16);
  assert.equal(result.height, 16);
  assert.equal(result.macroblockCount, 4);
  assert.deepEqual(countMacroblockTypes(result.macroblocks), { P_Skip: 4 });
  assert.equal(result.partitions.length, 4);
  assert.deepEqual(
    Array.from(result.macroblocks, (macroblock) => [
      macroblock.left,
      macroblock.top,
      macroblock.width,
      macroblock.height
    ]),
    [
      [-16, -16, 16, 16],
      [0, -16, 16, 16],
      [-16, 0, 16, 16],
      [0, 0, 16, 16]
    ]
  );

  const model = Core.buildFrameInternalsModel(
    { frameType: "P", size: sampleBytes.byteLength },
    {
      handlerType: "vide",
      codec: "avc1",
      codecDescriptor: "avc",
      encodedWidth: 32,
      encodedHeight: 32,
      width: 16,
      height: 16
    },
    { parsedFrameInternals: result }
  );
  assert.equal(model.kind, "video-grid");
  assert.equal(model.nominalUnitCount, 4);
  assert.equal(model.partitionBlockCount, 8);
  assert.equal(model.cells.length, 4);
  assert.deepEqual(
    Array.from(model.roots, (macroblock) => [
      macroblock.pixelLeft,
      macroblock.pixelTop,
      macroblock.blockWidth,
      macroblock.blockHeight
    ]),
    [
      [-16, -16, 16, 16],
      [0, -16, 16, 16],
      [-16, 0, 16, 16],
      [0, 0, 16, 16]
    ]
  );
});

test("AVC syntax bounds and NAL count budget fail closed before unbounded work", async () => {
  const loader = await createSourceModuleLoader();
  const internals = await loader.import("src/js/core/codecs/video/internals/avc-internals.js");
  const createBaselineSequenceParameterSet = (writeRemainingSyntax) => createRbspNalUnit(0x67, (bitWriter) => {
    bitWriter.writeBits(66, 8);
    bitWriter.writeBits(0, 8);
    bitWriter.writeBits(10, 8);
    bitWriter.writeUnsignedExpGolomb(0);
    writeRemainingSyntax(bitWriter);
  });
  const invalidBitDepth = createRbspNalUnit(0x67, (bitWriter) => {
    bitWriter.writeBits(100, 8);
    bitWriter.writeBits(0, 8);
    bitWriter.writeBits(10, 8);
    bitWriter.writeUnsignedExpGolomb(0);
    bitWriter.writeUnsignedExpGolomb(1);
    bitWriter.writeUnsignedExpGolomb(7);
    bitWriter.writeUnsignedExpGolomb(0);
  });
  const invalidFrameNumberWidth = createBaselineSequenceParameterSet((bitWriter) => {
    bitWriter.writeUnsignedExpGolomb(13);
  });
  const invalidPictureOrderCountWidth = createBaselineSequenceParameterSet((bitWriter) => {
    bitWriter.writeUnsignedExpGolomb(0);
    bitWriter.writeUnsignedExpGolomb(0);
    bitWriter.writeUnsignedExpGolomb(13);
  });
  const invalidPictureOrderCountCycle = createBaselineSequenceParameterSet((bitWriter) => {
    bitWriter.writeUnsignedExpGolomb(0);
    bitWriter.writeUnsignedExpGolomb(1);
    bitWriter.writeBit(0);
    bitWriter.writeSignedExpGolomb(0);
    bitWriter.writeSignedExpGolomb(0);
    bitWriter.writeUnsignedExpGolomb(256);
  });
  const invalidSliceGroupCount = createRbspNalUnit(0x68, (bitWriter) => {
    bitWriter.writeUnsignedExpGolomb(0);
    bitWriter.writeUnsignedExpGolomb(0);
    bitWriter.writeBit(0);
    bitWriter.writeBit(0);
    bitWriter.writeUnsignedExpGolomb(8);
  });

  for (const [nalUnit, expectedCode] of [
    [invalidBitDepth, "invalid-bit-depth"],
    [invalidFrameNumberWidth, "invalid-frame-number-width"],
    [invalidPictureOrderCountWidth, "invalid-poc-width"],
    [invalidPictureOrderCountCycle, "invalid-poc-cycle-length"]
  ]) {
    assert.throws(
      () => internals.parseSpsNalUnit(nalUnit),
      (error) => error && error.code === expectedCode
    );
  }
  assert.throws(
    () => internals.parsePpsNalUnit(invalidSliceGroupCount, new Map()),
    (error) => error && error.code === "invalid-slice-group-count"
  );

  const excessiveNalSample = new Uint8Array(65_537 * 5);
  for (let offset = 0; offset < excessiveNalSample.byteLength; offset += 5) {
    excessiveNalSample[offset + 3] = 1;
    excessiveNalSample[offset + 4] = 9;
  }
  assert.throws(
    () => internals.splitLengthPrefixedNalUnits(excessiveNalSample, 4),
    (error) => error && error.code === "nal-unit-budget-exceeded"
  );
});

test("AVC internals fail closed when retained SPS and PPS bytes are unavailable", async () => {
  const loader = await createSourceModuleLoader();
  const avc = await loader.import("src/js/core/codecs/video/avc.js");
  const sampleBytes = Uint8Array.from([0x00, 0x00, 0x00, 0x01, 0x65]);
  const result = avc.parseAvcFrameInternals(sampleBytes, { nalLengthSize: 4 }, null);

  assert.equal(result.kind, "unavailable");
  assert.equal(result.complete, false);
  assert.equal(result.reason, "missing-parameter-sets");
  assert.equal(result.sampleBits, 40);
  assert.equal(result.attributedBits, null);
  assert.equal(result.overheadBits, null);
  assert.equal(result.unattributedBits, 40);
  assert.equal("macroblocks" in result, false);
});
