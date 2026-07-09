import { ByteCursor, MAX_SAFE_BIGINT, fourCcFromBytes, hexByte, readFullBoxHeader } from "../../common/binary.js";
import {
  VIDEO_SAMPLE_ENTRIES,
  AUDIO_SAMPLE_ENTRIES,
  parseCodecConfiguration
} from "../../codecs/registry.js";
import { CONTAINER_BOXES, FULLBOX_CONTAINER_OFFSETS, PARSED_FIELD_BOXES } from "./box-types.js";

const SMALL_METADATA_READ_BYTES = 64 * 1024;
const SMALL_PRIVATE_METADATA_READ_BYTES = 1024 * 1024;
const HEX_DUMP_BYTES = 4096;
const HEX_DUMP_ROW_BYTES = 16;
const TEXT_METADATA_BOXES = new Set(["@xyz", "©xyz", "auth", "cami", "caml", "mdln", "SDLN", "smrd"]);
const GPS_METADATA_BOXES = new Set(["@xyz", "©xyz"]);
const BINARY_METADATA_BOXES = new Set(["saut", "svss"]);
const PRIVATE_METADATA_BOXES = new Set([...TEXT_METADATA_BOXES, ...GPS_METADATA_BOXES, ...BINARY_METADATA_BOXES, "smta"]);
const COMMON_QUICKTIME_LANGUAGE_CODES = new Set(["eng", "kor", "jpn", "zho", "spa", "fra", "deu", "ita", "por", "rus", "und"]);

async function readBoxPayload(reader, node, maxBytes) {
  const payloadSize = node.sizeBig - BigInt(node.headerSize);
  if (payloadSize < 0n) throw new Error("Invalid payload size for " + node.path);
  if (maxBytes && payloadSize > BigInt(maxBytes)) {
    node.warnings.push("Payload too large to parse inline: " + payloadSize.toString() + " bytes.");
    return null;
  }
  const payloadOffset = node.offsetBig + BigInt(node.headerSize);
  if (payloadSize <= BigInt(SMALL_METADATA_READ_BYTES) && typeof reader.readExactRange === "function") {
    return reader.readExactRange(payloadOffset, payloadSize);
  }
  return reader.readRange(payloadOffset, payloadSize);
}

function readBoxHeaderProbe(reader, offset, length) {
  if (typeof reader.readExactRange === "function") return reader.readExactRange(offset, length);
  return reader.readRange(offset, length);
}

async function parseBoxes(reader, startBig, endBig, parentPath, depth, warnings, progress) {
  const nodes = [];
  let offset = startBig;
  let guard = 0;
  while (offset + 8n <= endBig) {
    if (reader.cancelled) throw new Error("Analysis cancelled.");
    guard += 1;
    if (guard > 100000) {
      warnings.push("Stopped parsing " + parentPath + " after 100000 boxes.");
      break;
    }
    const remaining = endBig - offset;
    const headerProbe = await readBoxHeaderProbe(reader, offset, remaining < 32n ? remaining : 32n);
    if (headerProbe.byteLength < 8) break;
    const cursor = new ByteCursor(headerProbe);
    const size32 = cursor.uint32(0);
    const decodedType = decodeBoxType(cursor, 4, parentPath);
    const type = decodedType.type;
    let headerSize = 8;
    let boxSizeBig = BigInt(size32);
    if (size32 === 1) {
      if (headerProbe.byteLength < 16) {
        warnings.push("Truncated large-size box header at " + offset.toString());
        break;
      }
      boxSizeBig = cursor.uint64(8);
      headerSize = 16;
    } else if (size32 === 0) {
      boxSizeBig = endBig - offset;
    }
    if (type === "uuid") headerSize += 16;
    if (boxSizeBig < BigInt(headerSize)) {
      warnings.push("Invalid size for box " + type + " at " + offset.toString());
      break;
    }
    let boxEnd = offset + boxSizeBig;
    const nodeWarnings = [];
    if (boxEnd > endBig) {
      nodeWarnings.push("Box exceeds parent bounds. Clamped for parsing.");
      boxEnd = endBig;
    }
    const path = parentPath ? parentPath + "/" + type + "[" + nodes.length + "]" : type + "[" + nodes.length + "]";
    const node = {
      type,
      path,
      offset: offset.toString(),
      offsetBig: offset,
      size: boxSizeBig.toString(),
      sizeBig: boxSizeBig,
      headerSize,
      children: [],
      fields: {},
      warnings: nodeWarnings
    };
    if (decodedType.rawType) node.fields.rawType = decodedType.rawType;
    if (decodedType.metadataKeyIndex !== undefined) node.fields.metadataKeyIndex = decodedType.metadataKeyIndex;
    await parseKnownBoxFields(reader, node);
    const containerSkip = getContainerPayloadSkip(type, headerSize, headerProbe);
    const childStart = offset + BigInt(headerSize + containerSkip);
    if ((CONTAINER_BOXES.has(type) || FULLBOX_CONTAINER_OFFSETS.has(type)) && depth < 24 && childStart < boxEnd) {
      node.children = await parseBoxes(reader, childStart, boxEnd, path, depth + 1, warnings, progress);
    }
    nodes.push(node);
    if (progress && depth === 0) progress("Parsing boxes", Number(offset * 100n / endBig));
    if (boxSizeBig === 0n) break;
    offset = offset + boxSizeBig;
  }
  return nodes;
}

function decodeBoxType(cursor, offset, parentPath) {
  const bytes = cursor.bytesAt(offset, 4);
  const rawType = Array.from(bytes).map(hexByte).join("");
  if (isMetadataItemListPath(parentPath) && !isDisplayableBoxType(bytes)) {
    return {
      type: "metadataItem",
      rawType: "0x" + rawType,
      metadataKeyIndex: cursor.uint32(offset)
    };
  }
  if (!isDisplayableBoxType(bytes)) {
    return { type: "0x" + rawType, rawType: "0x" + rawType };
  }
  return { type: fourCcFromBytes(bytes, 0) };
}

function isMetadataItemListPath(path) {
  return /\/ilst\[\d+\]$/.test(path || "") || /^ilst\[\d+\]$/.test(path || "");
}

function isDisplayableBoxType(bytes) {
  for (const byte of bytes) {
    if (byte === 0xa9) continue;
    if (byte < 0x20 || byte > 0x7e) return false;
  }
  return true;
}

function getContainerPayloadSkip(type, headerSize, headerProbe) {
  const defaultSkip = FULLBOX_CONTAINER_OFFSETS.get(type) || 0;
  if (type !== "meta" || defaultSkip === 0 || headerProbe.byteLength < headerSize + 8) return defaultSkip;
  const cursor = new ByteCursor(headerProbe);
  const possibleChildSize = cursor.uint32(headerSize);
  const possibleChildType = cursor.string(headerSize + 4, 4);
  if ((possibleChildSize === 1 || possibleChildSize >= 8) && looksLikeBoxType(possibleChildType)) {
    return 0;
  }
  return defaultSkip;
}

function looksLikeBoxType(type) {
  if (!type || type.length !== 4) return false;
  for (const character of type) {
    const code = character.charCodeAt(0);
    if (code < 0x20 || code > 0x7e) return false;
  }
  return true;
}

async function parseKnownBoxFields(reader, node) {
  if (node.type === "mdat") {
    node.fields.dataStart = (node.offsetBig + BigInt(node.headerSize)).toString();
    node.fields.dataSize = (node.sizeBig - BigInt(node.headerSize)).toString();
    return;
  }
  if (!PARSED_FIELD_BOXES.has(node.type)) return;
  const smallBoxMax = 128 * 1024 * 1024;
  const payload = await readBoxPayload(reader, node, PRIVATE_METADATA_BOXES.has(node.type) ? SMALL_PRIVATE_METADATA_READ_BYTES : smallBoxMax);
  if (!payload) return;
  const cursor = new ByteCursor(payload);
  try {
    if (node.type === "ftyp") parseFtyp(cursor, node);
    else if (node.type === "mvhd") parseMvhd(cursor, node);
    else if (node.type === "tkhd") parseTkhd(cursor, node);
    else if (node.type === "mdhd") parseMdhd(cursor, node);
    else if (node.type === "hdlr") parseHdlr(cursor, node);
    else if (node.type === "stsd") await parseStsd(cursor, node);
    else if (node.type === "stts") parseStts(cursor, node);
    else if (node.type === "ctts") parseCtts(cursor, node);
    else if (node.type === "stss") parseStss(cursor, node);
    else if (node.type === "stsc") parseStsc(cursor, node);
    else if (node.type === "stsz") parseStsz(cursor, node);
    else if (node.type === "stz2") parseStz2(cursor, node);
    else if (node.type === "stco") parseStco(cursor, node, false);
    else if (node.type === "co64") parseStco(cursor, node, true);
    else if (node.type === "trex") parseTrex(cursor, node);
    else if (node.type === "mfhd") parseMfhd(cursor, node);
    else if (node.type === "tfhd") parseTfhd(cursor, node);
    else if (node.type === "tfdt") parseTfdt(cursor, node);
    else if (node.type === "trun") parseTrun(cursor, node);
    else if (TEXT_METADATA_BOXES.has(node.type)) parseTextMetadata(cursor, node);
    else if (node.type === "smta") parseSmta(cursor, node);
    else if (BINARY_METADATA_BOXES.has(node.type)) parseBinaryMetadata(cursor, node);
  } catch (error) {
    node.warnings.push("Could not parse fields: " + error.message);
  }
}

function parseFtyp(cursor, node) {
  if (cursor.length < 8) return;
  const brands = [];
  for (let offset = 8; offset + 4 <= cursor.length; offset += 4) brands.push(cursor.string(offset, 4));
  node.fields = {
    majorBrand: cursor.string(0, 4),
    minorVersion: cursor.uint32(4),
    compatibleBrands: brands
  };
}

function parseMvhd(cursor, node) {
  const full = readFullBoxHeader(cursor);
  const timescale = full.version === 1 ? cursor.uint32(20) : cursor.uint32(12);
  const duration = full.version === 1 ? cursor.uint64(24).toString() : cursor.uint32(16).toString();
  node.fields = { version: full.version, flags: full.flags, timescale, duration };
}

function parseTkhd(cursor, node) {
  const full = readFullBoxHeader(cursor);
  const trackId = full.version === 1 ? cursor.uint32(20) : cursor.uint32(12);
  const duration = full.version === 1 ? cursor.uint64(28).toString() : cursor.uint32(20).toString();
  const widthRaw = cursor.uint32(cursor.length - 8);
  const heightRaw = cursor.uint32(cursor.length - 4);
  node.fields = {
    version: full.version,
    flags: full.flags,
    trackId,
    duration,
    width: widthRaw / 65536,
    height: heightRaw / 65536
  };
}

function parseMdhd(cursor, node) {
  const full = readFullBoxHeader(cursor);
  const timescale = full.version === 1 ? cursor.uint32(20) : cursor.uint32(12);
  const duration = full.version === 1 ? cursor.uint64(24).toString() : cursor.uint32(16).toString();
  const languageOffset = full.version === 1 ? 32 : 20;
  let language = "";
  if (cursor.ensure(languageOffset, 2)) {
    const packed = cursor.uint16(languageOffset);
    language = String.fromCharCode(((packed >> 10) & 31) + 0x60, ((packed >> 5) & 31) + 0x60, (packed & 31) + 0x60);
  }
  node.fields = { version: full.version, flags: full.flags, timescale, duration, language };
}

function parseHdlr(cursor, node) {
  const full = readFullBoxHeader(cursor);
  const handlerType = cursor.string(8, 4);
  const name = cursor.length > 24 ? cursor.string(24, cursor.length - 24) : "";
  node.fields = { version: full.version, flags: full.flags, handlerType, name };
}

function parseTextMetadata(cursor, node) {
  const decodedText = decodeQuickTimeTextPayload(cursor.bytes);
  const fields = {
    rawPayload: createRawPayloadSummary(cursor.bytes)
  };
  if (decodedText.declaredLength !== null) fields.declaredTextLength = decodedText.declaredLength;
  if (decodedText.languageCode) fields.languageCode = decodedText.languageCode;
  if (decodedText.language) fields.language = decodedText.language;
  if (decodedText.text) {
    fields.text = decodedText.text;
    if (GPS_METADATA_BOXES.has(node.type)) fields.gpsCoordinates = parseIso6709Coordinates(decodedText.text);
  }
  node.fields = fields;
}

function parseSmta(cursor, node) {
  const full = cursor.length >= 4 ? readFullBoxHeader(cursor) : { version: 0, flags: 0 };
  const fields = {
    version: full.version,
    flags: full.flags
  };
  if (cursor.length > 4) {
    fields.payloadAfterPrefix = createRawPayloadSummary(cursor.bytes.subarray(4));
  }
  node.fields = fields;
}

function parseBinaryMetadata(cursor, node) {
  const textCandidate = decodeLooseText(cursor.bytes);
  node.fields = {
    rawPayload: createRawPayloadSummary(cursor.bytes)
  };
  if (textCandidate) node.fields.textCandidate = textCandidate;
}

function decodeQuickTimeTextPayload(bytes) {
  let offset = 0;
  let length = bytes.byteLength;
  let declaredLength = null;
  let languageCode = 0;
  let language = "";
  if (bytes.byteLength >= 4) {
    const cursor = new ByteCursor(bytes);
    const possibleLength = cursor.uint16(0);
    const possibleLanguageCode = cursor.uint16(2);
    if (possibleLength > 0 && possibleLength <= bytes.byteLength - 4) {
      offset = 4;
      length = possibleLength;
      declaredLength = possibleLength;
      languageCode = possibleLanguageCode;
      language = decodeQuickTimeLanguage(languageCode);
    } else if (possibleLength === 0 && possibleLanguageCode > 0) {
      offset = 4;
      length = bytes.byteLength - 4;
      declaredLength = possibleLength;
      languageCode = possibleLanguageCode;
      language = decodeQuickTimeLanguage(languageCode);
    } else if (possibleLength === 0 && possibleLanguageCode === 0) {
      offset = 4;
      length = bytes.byteLength - 4;
      if (bytes.byteLength >= 6) {
        const shiftedLanguageCode = cursor.uint16(4);
        const shiftedLanguage = decodeQuickTimeLanguage(shiftedLanguageCode);
        if (COMMON_QUICKTIME_LANGUAGE_CODES.has(shiftedLanguage)) {
          offset = 6;
          length = bytes.byteLength - 6;
          languageCode = shiftedLanguageCode;
          language = shiftedLanguage;
        }
      }
    }
  }
  const text = decodeTextBytes(bytes.subarray(offset, offset + length));
  return {
    declaredLength,
    languageCode: languageCode || undefined,
    language,
    text
  };
}

function decodeQuickTimeLanguage(packedLanguage) {
  if (!packedLanguage) return "";
  const letters = [
    ((packedLanguage >> 10) & 0x1f) + 0x60,
    ((packedLanguage >> 5) & 0x1f) + 0x60,
    (packedLanguage & 0x1f) + 0x60
  ];
  if (letters.some((code) => code < 0x61 || code > 0x7a)) return "";
  return String.fromCharCode(letters[0], letters[1], letters[2]);
}

function decodeLooseText(bytes) {
  const text = decodeTextBytes(bytes);
  if (!text) return "";
  let printableCount = 0;
  for (const character of text) {
    const code = character.charCodeAt(0);
    if (code === 0x09 || code === 0x0a || code === 0x0d || code >= 0x20) printableCount += 1;
  }
  return printableCount / text.length >= 0.75 ? text : "";
}

function decodeTextBytes(bytes) {
  const trimmedBytes = trimNullBytes(bytes);
  if (!trimmedBytes.byteLength) return "";
  if (trimmedBytes.byteLength >= 2) {
    if (trimmedBytes[0] === 0xfe && trimmedBytes[1] === 0xff) return decodeWithTextDecoder("utf-16be", trimmedBytes.subarray(2));
    if (trimmedBytes[0] === 0xff && trimmedBytes[1] === 0xfe) return decodeWithTextDecoder("utf-16le", trimmedBytes.subarray(2));
  }
  return decodeWithTextDecoder("utf-8", trimmedBytes);
}

function decodeWithTextDecoder(encoding, bytes) {
  try {
    return new TextDecoder(encoding).decode(bytes).replace(/\0+$/g, "").trim();
  } catch (_) {
    return new TextDecoder("utf-8").decode(bytes).replace(/\0+$/g, "").trim();
  }
}

function trimNullBytes(bytes) {
  let start = 0;
  let end = bytes.byteLength;
  while (start < end && bytes[start] === 0) start += 1;
  while (end > start && bytes[end - 1] === 0) end -= 1;
  return bytes.subarray(start, end);
}

function parseIso6709Coordinates(value) {
  const text = String(value || "").trim();
  const numericTokens = text.match(/[+-]\d+(?:\.\d+)?/g) || [];
  if (numericTokens.length < 2) return { raw: text, parsed: false };
  const coordinates = {
    raw: text,
    parsed: true,
    latitude: parseIso6709CoordinateToken(numericTokens[0], false),
    longitude: parseIso6709CoordinateToken(numericTokens[1], true)
  };
  if (numericTokens.length >= 3) coordinates.altitude = Number(numericTokens[2]);
  const crsMatch = text.match(/CRS([^/]+)/i);
  if (crsMatch) coordinates.crs = "CRS" + crsMatch[1];
  return coordinates;
}

function parseIso6709CoordinateToken(token, isLongitude) {
  const sign = token.startsWith("-") ? -1 : 1;
  const absoluteToken = token.slice(1);
  const [integerPart, fractionPart = ""] = absoluteToken.split(".");
  const degreeDigits = isLongitude ? 3 : 2;
  let degrees = Number(absoluteToken);
  if (integerPart.length === degreeDigits + 2) {
    degrees = Number(integerPart.slice(0, degreeDigits)) + Number(integerPart.slice(degreeDigits) + "." + fractionPart) / 60;
  } else if (integerPart.length === degreeDigits + 4) {
    degrees = Number(integerPart.slice(0, degreeDigits)) +
      Number(integerPart.slice(degreeDigits, degreeDigits + 2)) / 60 +
      Number(integerPart.slice(degreeDigits + 2) + "." + fractionPart) / 3600;
  }
  return sign * degrees;
}

function createRawPayloadSummary(bytes) {
  const shownBytes = bytes.subarray(0, Math.min(bytes.byteLength, HEX_DUMP_BYTES));
  return {
    byteLength: bytes.byteLength,
    shownBytes: shownBytes.byteLength,
    truncated: bytes.byteLength > shownBytes.byteLength,
    previewHex: Array.from(shownBytes.subarray(0, Math.min(32, shownBytes.byteLength))).map(hexByte).join(" "),
    previewAscii: bytesToAsciiPreview(shownBytes.subarray(0, Math.min(64, shownBytes.byteLength))),
    hexDump: buildHexDumpRows(shownBytes)
  };
}

function buildHexDumpRows(bytes) {
  const rows = [];
  for (let offset = 0; offset < bytes.byteLength; offset += HEX_DUMP_ROW_BYTES) {
    const rowBytes = bytes.subarray(offset, Math.min(offset + HEX_DUMP_ROW_BYTES, bytes.byteLength));
    rows.push(offset.toString(16).padStart(8, "0") + "  " +
      Array.from(rowBytes).map(hexByte).join(" ").padEnd(HEX_DUMP_ROW_BYTES * 3 - 1, " ") +
      "  |" + bytesToAsciiPreview(rowBytes) + "|");
  }
  return rows;
}

function bytesToAsciiPreview(bytes) {
  let text = "";
  for (const byte of bytes) text += byte >= 0x20 && byte <= 0x7e ? String.fromCharCode(byte) : ".";
  return text;
}

async function parseStsd(cursor, node) {
  const full = readFullBoxHeader(cursor);
  const entryCount = cursor.uint32(4);
  const entries = [];
  let offset = 8;
  for (let index = 0; index < entryCount && offset + 8 <= cursor.length; index += 1) {
    const entryStart = offset;
    const entrySize = cursor.uint32(offset);
    const format = cursor.string(offset + 4, 4);
    const entry = { index: index + 1, format, size: entrySize, boxes: [] };
    const entryEnd = Math.min(entryStart + entrySize, cursor.length);
    if (VIDEO_SAMPLE_ENTRIES.has(format) && entryStart + 86 <= entryEnd) {
      entry.dataReferenceIndex = cursor.uint16(entryStart + 14);
      entry.width = cursor.uint16(entryStart + 32);
      entry.height = cursor.uint16(entryStart + 34);
      entry.depth = cursor.uint16(entryStart + 82);
      await parseSampleEntryChildren(cursor, entryStart + 86, entryEnd, entry);
    } else if (AUDIO_SAMPLE_ENTRIES.has(format) && entryStart + 36 <= entryEnd) {
      entry.dataReferenceIndex = cursor.uint16(entryStart + 14);
      entry.channelCount = cursor.uint16(entryStart + 24);
      entry.sampleSize = cursor.uint16(entryStart + 26);
      entry.sampleRate = cursor.uint32(entryStart + 32) / 65536;
      await parseSampleEntryChildren(cursor, entryStart + 36, entryEnd, entry);
    } else {
      await parseSampleEntryChildren(cursor, entryStart + 16, entryEnd, entry);
    }
    entries.push(entry);
    if (entrySize <= 0) break;
    offset += entrySize;
  }
  node.fields = { version: full.version, flags: full.flags, entryCount, entries };
}

async function parseSampleEntryChildren(cursor, start, end, entry) {
  let offset = start;
  while (offset + 8 <= end) {
    const childSize = cursor.uint32(offset);
    const childType = cursor.string(offset + 4, 4);
    if (childSize < 8 || offset + childSize > end) break;
    const child = { type: childType, size: childSize };
    const codecConfiguration = await parseCodecConfiguration(childType, cursor.bytesAt(offset + 8, childSize - 8));
    if (codecConfiguration) {
      child.fields = codecConfiguration.fields;
      entry.codecDescriptor = codecConfiguration.codecDescriptor.id;
      entry.codecConfig = codecConfiguration.trackConfig;
      if (childType === "esds") entry.esds = child.fields;
    } else if (childType === "pasp" && childSize >= 16) {
      child.fields = { hSpacing: cursor.uint32(offset + 8), vSpacing: cursor.uint32(offset + 12) };
    } else if (childType === "colr") {
      child.fields = { colorType: cursor.string(offset + 8, 4) };
    }
    entry.boxes.push(child);
    offset += childSize;
  }
}

function parseStts(cursor, node) {
  const full = readFullBoxHeader(cursor);
  const entryCount = cursor.uint32(4);
  const entries = [];
  let offset = 8;
  for (let index = 0; index < entryCount && offset + 8 <= cursor.length; index += 1) {
    entries.push({ sampleCount: cursor.uint32(offset), sampleDelta: cursor.uint32(offset + 4) });
    offset += 8;
  }
  node.fields = { version: full.version, flags: full.flags, entryCount, entries };
}

function parseCtts(cursor, node) {
  const full = readFullBoxHeader(cursor);
  const entryCount = cursor.uint32(4);
  const entries = [];
  let offset = 8;
  for (let index = 0; index < entryCount && offset + 8 <= cursor.length; index += 1) {
    entries.push({
      sampleCount: cursor.uint32(offset),
      sampleOffset: full.version === 1 ? cursor.int32(offset + 4) : cursor.uint32(offset + 4)
    });
    offset += 8;
  }
  node.fields = { version: full.version, flags: full.flags, entryCount, entries };
}

function parseStss(cursor, node) {
  const full = readFullBoxHeader(cursor);
  const entryCount = cursor.uint32(4);
  const samples = [];
  let offset = 8;
  for (let index = 0; index < entryCount && offset + 4 <= cursor.length; index += 1) {
    samples.push(cursor.uint32(offset));
    offset += 4;
  }
  node.fields = { version: full.version, flags: full.flags, entryCount, samples };
}

function parseStsc(cursor, node) {
  const full = readFullBoxHeader(cursor);
  const entryCount = cursor.uint32(4);
  const entries = [];
  let offset = 8;
  for (let index = 0; index < entryCount && offset + 12 <= cursor.length; index += 1) {
    entries.push({
      firstChunk: cursor.uint32(offset),
      samplesPerChunk: cursor.uint32(offset + 4),
      sampleDescriptionIndex: cursor.uint32(offset + 8)
    });
    offset += 12;
  }
  node.fields = { version: full.version, flags: full.flags, entryCount, entries };
}

function parseStsz(cursor, node) {
  const full = readFullBoxHeader(cursor);
  const sampleSize = cursor.uint32(4);
  const sampleCount = cursor.uint32(8);
  const sizes = [];
  let offset = 12;
  if (sampleSize === 0) {
    for (let index = 0; index < sampleCount && offset + 4 <= cursor.length; index += 1) {
      sizes.push(cursor.uint32(offset));
      offset += 4;
    }
  }
  node.fields = { version: full.version, flags: full.flags, sampleSize, sampleCount, sizes };
}

function parseStz2(cursor, node) {
  const full = readFullBoxHeader(cursor);
  const fieldSize = cursor.uint8(7);
  const sampleCount = cursor.uint32(8);
  const sizes = [];
  let offset = 12;
  if (fieldSize === 4) {
    for (let index = 0; index < sampleCount && offset < cursor.length; index += 1) {
      const byte = cursor.uint8(offset);
      sizes.push(index % 2 === 0 ? byte >> 4 : byte & 0x0f);
      if (index % 2 === 1) offset += 1;
    }
  } else if (fieldSize === 8) {
    for (let index = 0; index < sampleCount && offset < cursor.length; index += 1) {
      sizes.push(cursor.uint8(offset));
      offset += 1;
    }
  } else if (fieldSize === 16) {
    for (let index = 0; index < sampleCount && offset + 2 <= cursor.length; index += 1) {
      sizes.push(cursor.uint16(offset));
      offset += 2;
    }
  }
  node.fields = { version: full.version, flags: full.flags, fieldSize, sampleCount, sizes };
}

function parseStco(cursor, node, isCo64) {
  const full = readFullBoxHeader(cursor);
  const entryCount = cursor.uint32(4);
  const offsets = [];
  let offset = 8;
  for (let index = 0; index < entryCount; index += 1) {
    if (isCo64) {
      if (offset + 8 > cursor.length) break;
      const value = cursor.uint64(offset);
      offsets.push(value <= MAX_SAFE_BIGINT ? Number(value) : value.toString());
      offset += 8;
    } else {
      if (offset + 4 > cursor.length) break;
      offsets.push(cursor.uint32(offset));
      offset += 4;
    }
  }
  node.fields = { version: full.version, flags: full.flags, entryCount, offsets };
}

function parseTrex(cursor, node) {
  const full = readFullBoxHeader(cursor);
  node.fields = {
    version: full.version,
    flags: full.flags,
    trackId: cursor.uint32(4),
    defaultSampleDescriptionIndex: cursor.uint32(8),
    defaultSampleDuration: cursor.uint32(12),
    defaultSampleSize: cursor.uint32(16),
    defaultSampleFlags: cursor.uint32(20)
  };
}

function parseMfhd(cursor, node) {
  const full = readFullBoxHeader(cursor);
  node.fields = { version: full.version, flags: full.flags, sequenceNumber: cursor.uint32(4) };
}

function parseTfhd(cursor, node) {
  const full = readFullBoxHeader(cursor);
  let offset = 8;
  const fields = { version: full.version, flags: full.flags, trackId: cursor.uint32(4) };
  if (full.flags & 0x000001) {
    fields.baseDataOffset = cursor.uint64(offset).toString();
    offset += 8;
  }
  if (full.flags & 0x000002) {
    fields.sampleDescriptionIndex = cursor.uint32(offset);
    offset += 4;
  }
  if (full.flags & 0x000008) {
    fields.defaultSampleDuration = cursor.uint32(offset);
    offset += 4;
  }
  if (full.flags & 0x000010) {
    fields.defaultSampleSize = cursor.uint32(offset);
    offset += 4;
  }
  if (full.flags & 0x000020) {
    fields.defaultSampleFlags = cursor.uint32(offset);
    offset += 4;
  }
  fields.durationIsEmpty = Boolean(full.flags & 0x010000);
  fields.defaultBaseIsMoof = Boolean(full.flags & 0x020000);
  node.fields = fields;
}

function parseTfdt(cursor, node) {
  const full = readFullBoxHeader(cursor);
  node.fields = {
    version: full.version,
    flags: full.flags,
    baseMediaDecodeTime: full.version === 1 ? cursor.uint64(4).toString() : cursor.uint32(4).toString()
  };
}

function parseTrun(cursor, node) {
  const full = readFullBoxHeader(cursor);
  const sampleCount = cursor.uint32(4);
  let offset = 8;
  const fields = { version: full.version, flags: full.flags, sampleCount, samples: [] };
  if (full.flags & 0x000001) {
    fields.dataOffset = cursor.int32(offset);
    offset += 4;
  }
  if (full.flags & 0x000004) {
    fields.firstSampleFlags = cursor.uint32(offset);
    offset += 4;
  }
  for (let index = 0; index < sampleCount && offset <= cursor.length; index += 1) {
    const sample = {};
    if (full.flags & 0x000100) {
      if (offset + 4 > cursor.length) break;
      sample.duration = cursor.uint32(offset);
      offset += 4;
    }
    if (full.flags & 0x000200) {
      if (offset + 4 > cursor.length) break;
      sample.size = cursor.uint32(offset);
      offset += 4;
    }
    if (full.flags & 0x000400) {
      if (offset + 4 > cursor.length) break;
      sample.flags = cursor.uint32(offset);
      offset += 4;
    }
    if (full.flags & 0x000800) {
      if (offset + 4 > cursor.length) break;
      sample.compositionTimeOffset = full.version === 1 ? cursor.int32(offset) : cursor.uint32(offset);
      offset += 4;
    }
    fields.samples.push(sample);
  }
  node.fields = fields;
}

export {
  parseBoxes
};
