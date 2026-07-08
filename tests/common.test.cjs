const assert = require("node:assert/strict");
const test = require("node:test");
const { createSourceModuleLoader } = require("./helpers/source-module-loader.cjs");

test("binary helpers read big-endian numbers, strings, and safe JSON values", async () => {
  const loader = await createSourceModuleLoader();
  const binary = await loader.import("src/js/core/common/binary.js");
  const cursor = new binary.ByteCursor(new Uint8Array([
    0x01, 0x02, 0x7f, 0xff,
    0x00, 0x00, 0x00, 0x05,
    0x41, 0x42, 0x00, 0x43
  ]));

  assert.equal(cursor.uint8(0), 1);
  assert.equal(cursor.uint16(0), 0x0102);
  assert.equal(cursor.int32(0), 0x01027fff);
  assert.equal(cursor.uint32(4), 5);
  assert.equal(cursor.string(8, 4), "AB");
  assert.deepEqual(Array.from(cursor.bytesAt(8, 2)), [0x41, 0x42]);
  assert.throws(() => cursor.uint32(10), /Unexpected EOF/);
  assert.equal(binary.hexByte(10), "0a");
  assert.equal(binary.fourCcFromBytes(new Uint8Array([0x6d, 0x6f, 0x6f, 0x76]), 0), "moov");
  assert.equal(binary.toSafeNumber(10n, "offset"), 10);
  assert.throws(() => binary.toSafeNumber(BigInt(Number.MAX_SAFE_INTEGER) + 1n, "offset"), /too large/);
  assert.equal(JSON.stringify({ value: 9n, hiddenBig: 1 }, binary.safeJsonReplacer), "{\"value\":\"9\"}");
});

test("BlobRangeReader chunks, caches, returns empty ranges, and cancels", async () => {
  const loader = await createSourceModuleLoader();
  const { BlobRangeReader } = await loader.import("src/js/core/common/binary.js");
  const bytes = new Uint8Array(4 * 1024 * 1024 + 8);
  bytes[0] = 7;
  bytes[4 * 1024 * 1024 - 1] = 8;
  bytes[4 * 1024 * 1024] = 9;
  bytes[4 * 1024 * 1024 + 7] = 10;
  const reader = new BlobRangeReader(new File([bytes], "range.bin"));

  assert.deepEqual(Array.from(await reader.readRange(0n, 0n)), []);
  assert.deepEqual(Array.from(await reader.readRange(BigInt(4 * 1024 * 1024 - 1), 3n)), [8, 9, 0]);
  assert.ok(reader.cache.size >= 1);
  reader.cancel();
  await assert.rejects(() => reader.readRange(0n, 1n), /cancelled/);
});

test("bitstream helpers remove emulation-prevention bytes and decode Exp-Golomb", async () => {
  const loader = await createSourceModuleLoader();
  const { BitReader, removeEmulationPreventionBytes } = await loader.import("src/js/core/common/bitstream.js");

  assert.deepEqual(
    Array.from(removeEmulationPreventionBytes(new Uint8Array([0x00, 0x00, 0x03, 0x01, 0x02]))),
    [0x00, 0x00, 0x01, 0x02]
  );

  const reader = new BitReader(new Uint8Array([0b10100110]));
  assert.equal(reader.readBit(), 1);
  assert.equal(reader.readBits(3), 0b010);
  assert.equal(reader.readUE(), 2);
});

test("formatting helpers produce stable display units", async () => {
  const loader = await createSourceModuleLoader();
  const formatting = await loader.import("src/js/core/common/formatting.js");

  assert.equal(formatting.clamp(15, 0, 10), 10);
  assert.equal(formatting.formatBytes(1536), "1.50 KB");
  assert.equal(formatting.formatBitsPerSecond(1_500_000), "1.50 Mbps");
  assert.equal(formatting.formatPreviewBitrate(9_876_543), "9877 kbps");
  assert.equal(formatting.formatPreviewBitrate(11_234_567), "11.23 Mbps");
  assert.equal(formatting.formatMetricNumber(1.23456, 2), "1.23");
  assert.equal(formatting.formatTime(1500, 1000), "1.500000s");
});
