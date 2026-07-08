const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { SourceModuleLoader, createSourceModuleLoader } = require("./helpers/source-module-loader.cjs");

const rootDirectory = path.resolve(__dirname, "..");

function listJavaScriptFiles(directory) {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return listJavaScriptFiles(absolutePath);
    return entry.isFile() && entry.name.endsWith(".js") ? [absolutePath] : [];
  });
}

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

test("HttpRangeReader reads byte ranges without downloading the full resource", async () => {
  const bytes = new Uint8Array(4 * 1024 * 1024 + 8);
  bytes[4 * 1024 * 1024 - 1] = 8;
  bytes[4 * 1024 * 1024] = 9;
  bytes[4 * 1024 * 1024 + 7] = 10;
  const rangeRequests = [];
  const loader = new SourceModuleLoader({
    rootDirectory,
    globals: {
      fetch: async (url, options = {}) => {
        rangeRequests.push({ url, range: options.headers.Range });
        const match = String(options.headers.Range).match(/^bytes=(\d+)-(\d+)$/);
        assert.ok(match, "missing Range header");
        const start = Number(match[1]);
        const end = Number(match[2]);
        return {
          status: 206,
          headers: { get: () => "" },
          async arrayBuffer() {
            return bytes.slice(start, end + 1).buffer;
          }
        };
      }
    }
  });
  const { HttpRangeReader, SMALL_RANGE_CHUNK_BYTES, readResourcePrefix } = await loader.import("src/js/core/common/binary.js");
  const resource = {
    kind: "remote-url",
    url: "https://example.test/range.bin",
    name: "range.bin",
    type: "application/octet-stream",
    size: bytes.byteLength,
    rangeSupported: true
  };
  const reader = new HttpRangeReader(resource);

  assert.deepEqual(Array.from(await reader.readRange(BigInt(4 * 1024 * 1024 - 1), 3n)), [8, 9, 0]);
  assert.equal(rangeRequests.length, 2);
  assert.deepEqual(Array.from(await reader.readExactRange(1n, 2n)), [0, 0]);
  assert.equal(rangeRequests[2].range, "bytes=0-" + (SMALL_RANGE_CHUNK_BYTES - 1));
  assert.deepEqual(Array.from(await reader.readExactRange(16n, 2n)), [0, 0]);
  assert.equal(rangeRequests.length, 3);
  assert.deepEqual(Array.from(await readResourcePrefix(resource, 2)), [0, 0]);
  assert.equal(rangeRequests[3].range, "bytes=0-" + (SMALL_RANGE_CHUNK_BYTES - 1));
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

test("core source modules link without unresolved static imports", async () => {
  const loader = await createSourceModuleLoader();
  const coreDirectory = path.join(rootDirectory, "src", "js", "core");
  const relativePaths = listJavaScriptFiles(coreDirectory)
    .map((absolutePath) => path.relative(rootDirectory, absolutePath).replace(/\\/g, "/"))
    .sort();

  for (const relativePath of relativePaths) {
    await loader.import(relativePath);
  }

  assert.ok(relativePaths.length > 10);
});
