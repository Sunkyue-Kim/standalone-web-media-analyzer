const assert = require("node:assert/strict");
const test = require("node:test");
const { createSourceModuleLoader } = require("./helpers/source-module-loader.cjs");

class MemoryRangeReader {
  constructor(bytes) {
    this.bytes = bytes;
    this.cancelled = false;
  }

  async readRange(offsetBig, sizeBig) {
    const offset = Number(offsetBig);
    const size = Number(sizeBig);
    return this.bytes.slice(offset, offset + size);
  }
}

function concatBytes(parts) {
  const totalLength = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

function fourCharacterCode(value) {
  return Uint8Array.from(Array.from(value).map((character) => character.charCodeAt(0)));
}

function uint8(value) {
  return Uint8Array.of(value & 0xff);
}

function uint16(value) {
  return Uint8Array.of((value >>> 8) & 0xff, value & 0xff);
}

function uint32(value) {
  return Uint8Array.of(
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff
  );
}

function int32(value) {
  return uint32(value >>> 0);
}

function textBytes(value) {
  return Uint8Array.from(Buffer.from(value, "utf8"));
}

function uint64(value) {
  let remaining = BigInt(value);
  const result = new Uint8Array(8);
  for (let index = 7; index >= 0; index -= 1) {
    result[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return result;
}

function fullBoxPayload(version, flags, body) {
  return concatBytes([
    uint8(version),
    uint8((flags >>> 16) & 0xff),
    uint8((flags >>> 8) & 0xff),
    uint8(flags & 0xff),
    body
  ]);
}

function toPlainValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function box(type, payload, options = {}) {
  const userType = options.uuid ? new Uint8Array(16).fill(0x55) : new Uint8Array();
  const normalHeaderSize = 8 + userType.byteLength;
  const largeHeaderSize = 16 + userType.byteLength;
  const size = BigInt((options.largeSize ? largeHeaderSize : normalHeaderSize) + payload.byteLength);
  const header = options.largeSize
    ? concatBytes([uint32(1), fourCharacterCode(type), uint64(size), userType])
    : concatBytes([uint32(Number(size)), fourCharacterCode(type), userType]);
  return concatBytes([header, payload]);
}

function boxWithRawType(typeBytes, payload) {
  return concatBytes([
    uint32(8 + payload.byteLength),
    typeBytes,
    payload
  ]);
}

async function parseSyntheticBoxes(bytes) {
  const loader = await createSourceModuleLoader();
  const { parseBoxes } = await loader.import("src/js/core/containers/isobmff/box-parser.js");
  const warnings = [];
  const nodes = await parseBoxes(new MemoryRangeReader(bytes), 0n, BigInt(bytes.byteLength), "", 0, warnings);
  return { nodes, warnings };
}

test("ISO BMFF box parser handles large co64 offsets and uuid headers", async () => {
  const bytes = concatBytes([
    box("co64", fullBoxPayload(0, 0, concatBytes([
      uint32(2),
      uint64(0x0000000100000000n),
      uint64(BigInt(Number.MAX_SAFE_INTEGER) + 1n)
    ])), { largeSize: true }),
    box("uuid", new Uint8Array(), { uuid: true })
  ]);

  const { nodes, warnings } = await parseSyntheticBoxes(bytes);

  assert.equal(warnings.length, 0);
  assert.equal(nodes[0].type, "co64");
  assert.equal(nodes[0].headerSize, 16);
  assert.equal(nodes[0].warnings.length, 0);
  assert.deepEqual(toPlainValue(nodes[0].fields.offsets), [4294967296, "9007199254740992"]);
  assert.equal(nodes[1].type, "uuid");
  assert.equal(nodes[1].headerSize, 24);
});

test("ISO BMFF box parser handles compact sample sizes and signed composition offsets", async () => {
  const bytes = concatBytes([
    box("stz2", fullBoxPayload(0, 0, concatBytes([
      new Uint8Array([0, 0, 0, 4]),
      uint32(3),
      new Uint8Array([0xab, 0xc0])
    ]))),
    box("ctts", fullBoxPayload(1, 0, concatBytes([
      uint32(1),
      uint32(2),
      int32(-3)
    ])))
  ]);

  const { nodes, warnings } = await parseSyntheticBoxes(bytes);

  assert.equal(warnings.length, 0);
  assert.deepEqual(toPlainValue(nodes[0].fields.sizes), [10, 11, 12]);
  assert.equal(nodes[1].fields.version, 1);
  assert.deepEqual(toPlainValue(nodes[1].fields.entries), [{ sampleCount: 2, sampleOffset: -3 }]);
});

test("ISO BMFF box parser extracts tkhd display matrix rotation", async () => {
  const rotateMinus90Matrix = [
    0, 0x00010000, 0,
    -0x00010000, 0, 0,
    0, 0, 0x40000000
  ];
  const bytes = box("tkhd", fullBoxPayload(0, 7, concatBytes([
    uint32(0),
    uint32(0),
    uint32(7),
    uint32(0),
    uint32(9000),
    new Uint8Array(8),
    uint16(0),
    uint16(0),
    uint16(0),
    uint16(0),
    ...rotateMinus90Matrix.map(int32),
    uint32(1920 << 16),
    uint32(1080 << 16)
  ])));

  const { nodes, warnings } = await parseSyntheticBoxes(bytes);

  assert.equal(warnings.length, 0);
  assert.equal(nodes[0].fields.trackId, 7);
  assert.equal(nodes[0].fields.width, 1920);
  assert.equal(nodes[0].fields.height, 1080);
  assert.equal(nodes[0].fields.rotationDegrees, -90);
  assert.equal(nodes[0].fields.displayWidth, 1080);
  assert.equal(nodes[0].fields.displayHeight, 1920);
  assert.deepEqual(toPlainValue(nodes[0].fields.matrix.raw.slice(0, 5)), [0, 65536, 0, -65536, 0]);
});

test("ISO BMFF box parser detects both FullBox and QuickTime meta child offsets", async () => {
  const handlerReferenceBox = box("hdlr", fullBoxPayload(0, 0, concatBytes([
    uint32(0),
    fourCharacterCode("mdta"),
    new Uint8Array(12)
  ])));
  const itemListBox = box("ilst", boxWithRawType(new Uint8Array([0, 0, 0, 1]), new Uint8Array()));
  const bytes = concatBytes([
    box("meta", concatBytes([new Uint8Array([0, 0, 0, 0]), handlerReferenceBox])),
    box("meta", concatBytes([handlerReferenceBox, itemListBox]))
  ]);

  const { nodes, warnings } = await parseSyntheticBoxes(bytes);

  assert.equal(warnings.length, 0);
  assert.equal(nodes[0].children[0].type, "hdlr");
  assert.equal(nodes[0].children[0].fields.handlerType, "mdta");
  assert.equal(nodes[1].children[0].type, "hdlr");
  assert.equal(nodes[1].children[0].fields.handlerType, "mdta");
  assert.equal(nodes[1].children[1].type, "ilst");
  assert.equal(nodes[1].children[1].children[0].type, "metadataItem");
  assert.equal(nodes[1].children[1].children[0].fields.rawType, "0x00000001");
  assert.equal(nodes[1].children[1].children[0].fields.metadataKeyIndex, 1);
});

test("ISO BMFF box parser loads codec configuration from audio sample entries", async () => {
  const esdsPayload = new Uint8Array([
    0x00, 0x00, 0x00, 0x00,
    0x03, 0x16, 0x00, 0x01, 0x00,
    0x04, 0x11, 0x40, 0x15, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
    0x05, 0x02, 0x12, 0x10
  ]);
  const esdsBox = box("esds", esdsPayload);
  const audioSampleEntry = new Uint8Array(36);
  audioSampleEntry.set(uint32(audioSampleEntry.byteLength + esdsBox.byteLength), 0);
  audioSampleEntry.set(fourCharacterCode("mp4a"), 4);
  audioSampleEntry.set(uint16(1), 14);
  audioSampleEntry.set(uint16(2), 24);
  audioSampleEntry.set(uint16(16), 26);
  audioSampleEntry.set(uint32(48000 << 16), 32);
  const stsdPayload = fullBoxPayload(0, 0, concatBytes([
    uint32(1),
    audioSampleEntry,
    esdsBox
  ]));

  const { nodes, warnings } = await parseSyntheticBoxes(box("stsd", stsdPayload));
  const entry = nodes[0].fields.entries[0];

  assert.equal(warnings.length, 0);
  assert.equal(nodes[0].warnings.length, 0);
  assert.equal(entry.format, "mp4a");
  assert.equal(entry.sampleRate, 48000);
  assert.equal(entry.codecDescriptor, "aac");
  assert.equal(entry.codecConfig.codecString, "mp4a.40.2");
  assert.equal(entry.boxes[0].type, "esds");
});

test("ISO BMFF box parser loads AV1 configuration from video sample entries", async () => {
  const av1ConfigBox = box("av1C", new Uint8Array([0x81, 0x08, 0x40, 0x00, 0x0a, 0x00]));
  const videoSampleEntry = new Uint8Array(86);
  videoSampleEntry.set(uint32(videoSampleEntry.byteLength + av1ConfigBox.byteLength), 0);
  videoSampleEntry.set(fourCharacterCode("av01"), 4);
  videoSampleEntry.set(uint16(1), 14);
  videoSampleEntry.set(uint16(640), 32);
  videoSampleEntry.set(uint16(360), 34);
  videoSampleEntry.set(uint16(24), 82);
  const stsdPayload = fullBoxPayload(0, 0, concatBytes([
    uint32(1),
    videoSampleEntry,
    av1ConfigBox
  ]));

  const { nodes, warnings } = await parseSyntheticBoxes(box("stsd", stsdPayload));
  const entry = nodes[0].fields.entries[0];

  assert.equal(warnings.length, 0);
  assert.equal(entry.format, "av01");
  assert.equal(entry.codecDescriptor, "av1");
  assert.equal(entry.codecConfig.codecString, "av01.0.08M.10");
  assert.equal(entry.codecConfig.bitDepth, 10);
  assert.equal(entry.boxes[0].type, "av1C");
  assert.equal(entry.boxes[0].fields.configOBUByteLength, 2);
});

test("ISO BMFF box parser covers fMP4 tfhd and trun optional fields", async () => {
  const tfhdFlags = 0x000001 | 0x000002 | 0x000008 | 0x000010 | 0x000020 | 0x010000 | 0x020000;
  const trunFlags = 0x000001 | 0x000004 | 0x000100 | 0x000200 | 0x000400 | 0x000800;
  const bytes = concatBytes([
    box("tfhd", fullBoxPayload(0, tfhdFlags, concatBytes([
      uint32(7),
      uint64(1234567890123n),
      uint32(2),
      uint32(1000),
      uint32(321),
      uint32(0x00010000)
    ]))),
    box("trun", fullBoxPayload(1, trunFlags, concatBytes([
      uint32(2),
      int32(48),
      uint32(0x02000000),
      uint32(1000),
      uint32(300),
      uint32(0x00010000),
      int32(-5),
      uint32(900),
      uint32(200),
      uint32(0),
      int32(7)
    ])))
  ]);

  const { nodes, warnings } = await parseSyntheticBoxes(bytes);

  assert.equal(warnings.length, 0);
  assert.equal(nodes[0].fields.trackId, 7);
  assert.equal(nodes[0].fields.baseDataOffset, "1234567890123");
  assert.equal(nodes[0].fields.sampleDescriptionIndex, 2);
  assert.equal(nodes[0].fields.defaultSampleDuration, 1000);
  assert.equal(nodes[0].fields.defaultSampleSize, 321);
  assert.equal(nodes[0].fields.defaultSampleFlags, 0x00010000);
  assert.equal(nodes[0].fields.durationIsEmpty, true);
  assert.equal(nodes[0].fields.defaultBaseIsMoof, true);
  assert.equal(nodes[1].fields.dataOffset, 48);
  assert.equal(nodes[1].fields.firstSampleFlags, 0x02000000);
  assert.deepEqual(toPlainValue(nodes[1].fields.samples), [
    { duration: 1000, size: 300, flags: 0x00010000, compositionTimeOffset: -5 },
    { duration: 900, size: 200, flags: 0, compositionTimeOffset: 7 }
  ]);
});

test("ISO BMFF box parser decodes QuickTime GPS text and Samsung smta children with raw hex fallback", async () => {
  const gpsText = "+37.4183+127.1834/";
  const gpsPayload = concatBytes([
    uint16(gpsText.length),
    uint16(0x15c7),
    textBytes(gpsText)
  ]);
  const smtaPayload = fullBoxPayload(0, 0, concatBytes([
    box("saut", new Uint8Array([0, 0, 0, 0, 0, 0])),
    box("mdln", textBytes("SM-S928N")),
    box("svss", new Uint8Array([1, 2, 3, 4]))
  ]));
  const bytes = concatBytes([
    box("auth", concatBytes([uint32(0), uint16(0x15c7), textBytes("Galaxy S24 Ultra"), uint8(0)])),
    box("@xyz", gpsPayload),
    box("caml", textBytes("3, 4, 1024, 2216, 3.0")),
    box("cami", concatBytes([uint32(0), textBytes("3, 4, 1024, 2216, 3.0")])),
    box("smta", smtaPayload)
  ]);

  const { nodes, warnings } = await parseSyntheticBoxes(bytes);

  assert.equal(warnings.length, 0);
  assert.equal(nodes[0].fields.text, "Galaxy S24 Ultra");
  assert.equal(nodes[0].fields.language, "eng");
  assert.equal(nodes[1].type, "@xyz");
  assert.equal(nodes[1].fields.text, gpsText);
  assert.equal(nodes[1].fields.language, "eng");
  assert.deepEqual(toPlainValue(nodes[1].fields.gpsCoordinates), {
    raw: gpsText,
    parsed: true,
    latitude: 37.4183,
    longitude: 127.1834
  });
  assert.match(nodes[1].fields.rawPayload.hexDump[0], /2b 33 37 2e 34 31 38 33/);
  assert.equal(nodes[2].fields.text, "3, 4, 1024, 2216, 3.0");
  assert.equal(nodes[3].fields.text, "3, 4, 1024, 2216, 3.0");
  assert.equal(nodes[4].type, "smta");
  assert.equal(nodes[4].fields.version, 0);
  assert.equal(nodes[4].children.length, 3);
  assert.equal(nodes[4].children[0].type, "saut");
  assert.equal(nodes[4].children[0].fields.rawPayload.byteLength, 6);
  assert.equal(nodes[4].children[1].fields.text, "SM-S928N");
  assert.equal(nodes[4].children[2].fields.rawPayload.previewHex, "01 02 03 04");
});
