const CACHE_CHUNK_BYTES = 4 * 1024 * 1024;
const SMALL_RANGE_CHUNK_BYTES = 4 * 1024;
const MAX_CACHE_BYTES = 64 * 1024 * 1024;
const MAX_SMALL_RANGE_CACHE_BYTES = 4 * 1024 * 1024;
const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

function toBig(value) {
  return typeof value === "bigint" ? value : BigInt(value);
}

function toSafeNumber(value, context) {
  const bigValue = toBig(value);
  if (bigValue > MAX_SAFE_BIGINT) {
    throw new Error(context + " is too large for browser File.slice(): " + bigValue.toString());
  }
  return Number(bigValue);
}

function hexByte(value) {
  return value.toString(16).padStart(2, "0");
}

function fourCcFromBytes(bytes, offset) {
  return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
}

function safeJsonReplacer(key, value) {
  if (typeof value === "bigint") return value.toString();
  if (key.endsWith("Big")) return undefined;
  return value;
}

class ByteCursor {
  constructor(bytes) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  get length() {
    return this.bytes.byteLength;
  }

  ensure(offset, size) {
    return offset >= 0 && offset + size <= this.length;
  }

  uint8(offset) {
    if (!this.ensure(offset, 1)) throw new Error("Unexpected EOF at " + offset);
    return this.view.getUint8(offset);
  }

  uint16(offset) {
    if (!this.ensure(offset, 2)) throw new Error("Unexpected EOF at " + offset);
    return this.view.getUint16(offset, false);
  }

  int32(offset) {
    if (!this.ensure(offset, 4)) throw new Error("Unexpected EOF at " + offset);
    return this.view.getInt32(offset, false);
  }

  uint32(offset) {
    if (!this.ensure(offset, 4)) throw new Error("Unexpected EOF at " + offset);
    return this.view.getUint32(offset, false);
  }

  uint64(offset) {
    const high = this.uint32(offset);
    const low = this.uint32(offset + 4);
    return (BigInt(high) << 32n) + BigInt(low);
  }

  string(offset, length) {
    if (!this.ensure(offset, length)) throw new Error("Unexpected EOF at " + offset);
    let result = "";
    for (let index = 0; index < length; index += 1) {
      const byte = this.bytes[offset + index];
      if (byte === 0) break;
      result += String.fromCharCode(byte);
    }
    return result;
  }

  bytesAt(offset, length) {
    if (!this.ensure(offset, length)) throw new Error("Unexpected EOF at " + offset);
    return this.bytes.subarray(offset, offset + length);
  }
}

function readFullBoxHeader(cursor) {
  return {
    version: cursor.uint8(0),
    flags: (cursor.uint8(1) << 16) | (cursor.uint8(2) << 8) | cursor.uint8(3)
  };
}

class CachedRangeReader {
  constructor(file) {
    this.file = file;
    this.cache = new Map();
    this.smallRangeCache = new Map();
    this.cacheBytes = 0;
    this.smallRangeCacheBytes = 0;
    this.cancelled = false;
  }

  cancel() {
    this.cancelled = true;
  }

  async readRange(offsetBig, lengthBig) {
    if (this.cancelled) throw new Error("Analysis cancelled.");
    const offset = toSafeNumber(offsetBig, "offset");
    const length = toSafeNumber(lengthBig, "length");
    if (length <= 0) return new Uint8Array(0);
    const result = new Uint8Array(length);
    let written = 0;
    let cursor = offset;
    const end = offset + length;
    while (cursor < end) {
      if (this.cancelled) throw new Error("Analysis cancelled.");
      const chunkIndex = Math.floor(cursor / CACHE_CHUNK_BYTES);
      const chunkStart = chunkIndex * CACHE_CHUNK_BYTES;
      const chunk = await this.getCachedChunk(chunkIndex);
      const localStart = cursor - chunkStart;
      if (localStart >= chunk.byteLength) throw new Error("Range reader returned too few bytes at " + cursor);
      const copyLength = Math.min(chunk.byteLength - localStart, end - cursor);
      result.set(chunk.subarray(localStart, localStart + copyLength), written);
      written += copyLength;
      cursor += copyLength;
    }
    return result;
  }

  async readExactRange(offsetBig, lengthBig) {
    if (this.cancelled) throw new Error("Analysis cancelled.");
    const offset = toSafeNumber(offsetBig, "offset");
    const length = toSafeNumber(lengthBig, "length");
    if (length <= 0) return new Uint8Array(0);
    const resourceSize = Number(this.file && this.file.size || 0);
    if (offset >= resourceSize) return new Uint8Array(0);
    const clippedLength = Math.min(length, resourceSize - offset);
    if (clippedLength <= SMALL_RANGE_CHUNK_BYTES) {
      return this.readSmallCachedRange(offset, clippedLength);
    }
    return this.readExactRangeBytes(offset, clippedLength);
  }

  async readSmallCachedRange(offset, length) {
    const result = new Uint8Array(length);
    let written = 0;
    let cursor = offset;
    const end = offset + length;
    while (cursor < end) {
      if (this.cancelled) throw new Error("Analysis cancelled.");
      const chunkIndex = Math.floor(cursor / SMALL_RANGE_CHUNK_BYTES);
      const chunkStart = chunkIndex * SMALL_RANGE_CHUNK_BYTES;
      const chunk = await this.getCachedSmallRangeChunk(chunkIndex);
      const localStart = cursor - chunkStart;
      if (localStart >= chunk.byteLength) throw new Error("Small range reader returned too few bytes at " + cursor);
      const copyLength = Math.min(chunk.byteLength - localStart, end - cursor);
      result.set(chunk.subarray(localStart, localStart + copyLength), written);
      written += copyLength;
      cursor += copyLength;
    }
    return result;
  }

  async getCachedChunk(chunkIndex) {
    const cached = this.cache.get(chunkIndex);
    if (cached) {
      this.cache.delete(chunkIndex);
      this.cache.set(chunkIndex, cached);
      return cached.bytes;
    }
    const bytes = await this.readChunk(chunkIndex);
    this.cache.set(chunkIndex, { bytes, size: bytes.byteLength });
    this.cacheBytes += bytes.byteLength;
    this.evict();
    return bytes;
  }

  async getCachedSmallRangeChunk(chunkIndex) {
    const cached = this.smallRangeCache.get(chunkIndex);
    if (cached) {
      this.smallRangeCache.delete(chunkIndex);
      this.smallRangeCache.set(chunkIndex, cached);
      return cached.bytes;
    }
    const chunkStart = chunkIndex * SMALL_RANGE_CHUNK_BYTES;
    const resourceSize = Number(this.file && this.file.size || 0);
    const chunkLength = Math.min(SMALL_RANGE_CHUNK_BYTES, Math.max(0, resourceSize - chunkStart));
    const bytes = chunkLength > 0 ? await this.readExactRangeBytes(chunkStart, chunkLength) : new Uint8Array(0);
    this.smallRangeCache.set(chunkIndex, { bytes, size: bytes.byteLength });
    this.smallRangeCacheBytes += bytes.byteLength;
    this.evictSmallRangeCache();
    return bytes;
  }

  async readChunk() {
    throw new Error("readChunk must be implemented by a range reader.");
  }

  async readExactRangeBytes() {
    throw new Error("readExactRangeBytes must be implemented by a range reader.");
  }

  evict() {
    while (this.cacheBytes > MAX_CACHE_BYTES && this.cache.size > 1) {
      const firstKey = this.cache.keys().next().value;
      const item = this.cache.get(firstKey);
      this.cache.delete(firstKey);
      this.cacheBytes -= item.size;
    }
  }

  evictSmallRangeCache() {
    while (this.smallRangeCacheBytes > MAX_SMALL_RANGE_CACHE_BYTES && this.smallRangeCache.size > 1) {
      const firstKey = this.smallRangeCache.keys().next().value;
      const item = this.smallRangeCache.get(firstKey);
      this.smallRangeCache.delete(firstKey);
      this.smallRangeCacheBytes -= item.size;
    }
  }
}

class BlobRangeReader extends CachedRangeReader {
  async readChunk(chunkIndex) {
    const chunkStart = chunkIndex * CACHE_CHUNK_BYTES;
    const chunkEnd = Math.min(chunkStart + CACHE_CHUNK_BYTES, this.file.size);
    const buffer = await this.file.slice(chunkStart, chunkEnd).arrayBuffer();
    return new Uint8Array(buffer);
  }

  async readExactRangeBytes(offset, length) {
    const buffer = await this.file.slice(offset, offset + length).arrayBuffer();
    return new Uint8Array(buffer);
  }
}

class HttpRangeReader extends CachedRangeReader {
  constructor(file) {
    super(file);
    this.activeControllers = new Set();
  }

  cancel() {
    super.cancel();
    for (const controller of this.activeControllers) controller.abort();
    this.activeControllers.clear();
  }

  async readChunk(chunkIndex) {
    const chunkStart = chunkIndex * CACHE_CHUNK_BYTES;
    const chunkEndExclusive = Math.min(chunkStart + CACHE_CHUNK_BYTES, this.file.size);
    if (chunkEndExclusive <= chunkStart) return new Uint8Array(0);
    const controller = new AbortController();
    this.activeControllers.add(controller);
    try {
      const response = await fetch(this.file.url, {
        cache: "no-store",
        headers: {
          Range: "bytes=" + chunkStart + "-" + (chunkEndExclusive - 1)
        },
        signal: controller.signal
      });
      if (this.cancelled) throw new Error("Analysis cancelled.");
      if (response.status !== 206) {
        throw new Error("HTTP range request failed: expected 206, got " + response.status);
      }
      const buffer = await response.arrayBuffer();
      return new Uint8Array(buffer);
    } catch (error) {
      if (this.cancelled || error.name === "AbortError") throw new Error("Analysis cancelled.");
      throw error;
    } finally {
      this.activeControllers.delete(controller);
    }
  }

  async readExactRangeBytes(offset, length) {
    if (length <= 0) return new Uint8Array(0);
    const controller = new AbortController();
    this.activeControllers.add(controller);
    try {
      const response = await fetch(this.file.url, {
        cache: "no-store",
        headers: {
          Range: "bytes=" + offset + "-" + (offset + length - 1)
        },
        signal: controller.signal
      });
      if (this.cancelled) throw new Error("Analysis cancelled.");
      if (response.status !== 206) {
        throw new Error("HTTP range request failed: expected 206, got " + response.status);
      }
      const buffer = await response.arrayBuffer();
      return new Uint8Array(buffer);
    } catch (error) {
      if (this.cancelled || error.name === "AbortError") throw new Error("Analysis cancelled.");
      throw error;
    } finally {
      this.activeControllers.delete(controller);
    }
  }
}

function createRangeReader(file) {
  if (file && file.kind === "remote-url" && file.rangeSupported && file.url) return new HttpRangeReader(file);
  return new BlobRangeReader(file);
}

async function readResourcePrefix(file, length) {
  const prefixLength = Math.min(Number(file && file.size || 0), length);
  if (prefixLength <= 0) return new Uint8Array(0);
  const reader = createRangeReader(file);
  return reader.readExactRange(0n, BigInt(prefixLength));
}

function getResourceInfo(file) {
  return {
    name: file && file.name || "unnamed",
    size: file && file.size || 0,
    type: file && file.type || "",
    source: file && file.kind === "remote-url" ? "remote-url" : "local-file",
    url: file && file.kind === "remote-url" ? file.url : undefined,
    rangeSupported: Boolean(file && file.kind === "remote-url" && file.rangeSupported)
  };
}

export {
  MAX_SAFE_BIGINT,
  SMALL_RANGE_CHUNK_BYTES,
  toSafeNumber,
  hexByte,
  fourCcFromBytes,
  safeJsonReplacer,
  ByteCursor,
  readFullBoxHeader,
  BlobRangeReader,
  HttpRangeReader,
  createRangeReader,
  readResourcePrefix,
  getResourceInfo
};
