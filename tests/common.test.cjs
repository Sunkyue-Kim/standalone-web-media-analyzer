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

test("binary range reader covers base errors, exact prefixes, and cache eviction", async () => {
  const loader = await createSourceModuleLoader();
  const binary = await loader.import("src/js/core/common/binary.js");
  const cursor = new binary.ByteCursor(new Uint8Array([0x00, 0x00, 0x00, 0x00]));
  const reader = new binary.BlobRangeReader(new File([new Uint8Array([1, 2, 3, 4])], "small.bin", { type: "application/octet-stream" }));
  const cachedRangeReaderPrototype = Object.getPrototypeOf(Object.getPrototypeOf(reader));

  assert.equal(cursor.ensure(-1, 1), false);
  assert.throws(() => cursor.string(2, 8), /Unexpected EOF/);
  await assert.rejects(() => cachedRangeReaderPrototype.readChunk.call(reader), /readChunk must be implemented/);
  await assert.rejects(() => cachedRangeReaderPrototype.readExactRangeBytes.call(reader), /readExactRangeBytes must be implemented/);
  assert.deepEqual(Array.from(await reader.readExactRange(10n, 2n)), []);
  assert.deepEqual(Array.from(await binary.readResourcePrefix(new File([], "empty.bin"), 64)), []);
  assert.equal(binary.createRangeReader(new File([new Uint8Array([1])], "local.bin")).constructor.name, "BlobRangeReader");
  assert.deepEqual(JSON.parse(JSON.stringify(binary.getResourceInfo(null))), {
    name: "unnamed",
    size: 0,
    type: "",
    source: "local-file",
    rangeSupported: false
  });

  reader.cache.set(1, { bytes: new Uint8Array(40 * 1024 * 1024), size: 40 * 1024 * 1024 });
  reader.cache.set(2, { bytes: new Uint8Array(40 * 1024 * 1024), size: 40 * 1024 * 1024 });
  reader.cacheBytes = 80 * 1024 * 1024;
  reader.evict();
  assert.equal(reader.cache.size, 1);
  assert.equal(reader.cache.has(1), false);

  reader.smallRangeCache.set(1, { bytes: new Uint8Array(3 * 1024 * 1024), size: 3 * 1024 * 1024 });
  reader.smallRangeCache.set(2, { bytes: new Uint8Array(3 * 1024 * 1024), size: 3 * 1024 * 1024 });
  reader.smallRangeCacheBytes = 6 * 1024 * 1024;
  reader.evictSmallRangeCache();
  assert.equal(reader.smallRangeCache.size, 1);
  assert.equal(reader.smallRangeCache.has(1), false);
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

test("HttpRangeReader reports bad range responses and aborts consistently", async () => {
  let activeReader = null;
  const loader = new SourceModuleLoader({
    rootDirectory,
    globals: {
      fetch: async (url) => {
        if (url.includes("abort")) {
          activeReader.cancel();
          const error = new Error("aborted");
          error.name = "AbortError";
          throw error;
        }
        return {
          status: 200,
          async arrayBuffer() {
            return new Uint8Array([1, 2, 3]).buffer;
          }
        };
      }
    }
  });
  const { HttpRangeReader, createRangeReader, getResourceInfo } = await loader.import("src/js/core/common/binary.js");
  const badStatusResource = {
    kind: "remote-url",
    url: "https://example.test/bad-status.bin",
    name: "bad-status.bin",
    size: 16,
    rangeSupported: true
  };
  const abortResource = {
    kind: "remote-url",
    url: "https://example.test/abort.bin",
    name: "abort.bin",
    size: 16,
    rangeSupported: true
  };

  const badStatusReader = new HttpRangeReader(badStatusResource);
  await assert.rejects(() => badStatusReader.readRange(0n, 1n), /expected 206/);
  await assert.rejects(() => badStatusReader.readExactRange(0n, 1n), /expected 206/);

  activeReader = new HttpRangeReader(abortResource);
  await assert.rejects(() => activeReader.readExactRange(0n, 1n), /Analysis cancelled/);
  assert.equal(createRangeReader(abortResource).constructor.name, "HttpRangeReader");
  assert.deepEqual(JSON.parse(JSON.stringify(getResourceInfo(abortResource))), {
    name: "abort.bin",
    size: 16,
    type: "",
    source: "remote-url",
    url: "https://example.test/abort.bin",
    rangeSupported: true
  });
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

  assert.equal(formatting.clamp(-5, 0, 10), 0);
  assert.equal(formatting.clamp(15, 0, 10), 10);
  assert.equal(formatting.formatBytes("not-a-number"), "not-a-number");
  assert.equal(formatting.formatBytes(1024 ** 4), "1.00 TB");
  assert.equal(formatting.formatBitsPerSecond("not-a-number"), "n/a");
  assert.equal(formatting.formatBitsPerSecond(999), "999 bps");
  assert.equal(formatting.formatBitsPerSecond(1_500_000_000), "1.50 Gbps");
  assert.equal(formatting.formatBytes(1536), "1.50 KB");
  assert.equal(formatting.formatBitsPerSecond(1_500_000), "1.50 Mbps");
  assert.equal(formatting.formatPreviewBitrate(0), "");
  assert.equal(formatting.formatPreviewBitrate(Number.NaN), "");
  assert.equal(formatting.formatPreviewBitrate(1200), "1.200 kbps");
  assert.equal(formatting.formatPreviewBitrate(9_876_543), "9877 kbps");
  assert.equal(formatting.formatPreviewBitrate(11_234_567), "11.23 Mbps");
  assert.equal(formatting.formatMetricNumber(Number.NaN, 2), "n/a");
  assert.equal(formatting.formatMetricNumber(1.23456, 2), "1.23");
  assert.equal(formatting.formatTime(1500, 0), "1500");
  assert.equal(formatting.formatTime("bad", 1000), "bad");
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
