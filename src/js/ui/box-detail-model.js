import {
  BOX_TYPE_INFO,
  formatBytes
} from "../core/analyzer-core.js";
import {
  BOX_TYPE_I18N,
  getLanguage,
  t
} from "../i18n/catalogs.js";

const SAMPLE_ENTRY_DERIVED_FIELD_NAMES = new Set(["codecDescriptor", "codecConfig", "esds"]);

export function getBoxNodeChildren(node) {
  return [...(node && node.children || []), ...getSyntheticBoxChildren(node)];
}

export function getSyntheticBoxChildren(node) {
  if (!node || node.synthetic || node.type !== "stsd" || !node.fields || !Array.isArray(node.fields.entries)) return [];
  return node.fields.entries.map((entry) => createSyntheticSampleEntryNode(node, entry));
}

function createSyntheticSampleEntryNode(parentNode, entry) {
  const path = parentNode.path + "/entry[" + entry.index + "]:" + entry.format;
  return {
    type: entry.format,
    path,
    offset: parentNode.offset || "",
    size: entry.size,
    headerSize: 0,
    children: (entry.boxes || []).map((childBox, childIndex) => createSyntheticSampleEntryChildNode(path, parentNode, childBox, childIndex)),
    fields: createActualSampleEntryFields(entry),
    warnings: [],
    synthetic: true,
    syntheticKind: "sample-entry",
    sourceBoxPath: parentNode.path,
    sourceEntry: entry
  };
}

function createSyntheticSampleEntryChildNode(sampleEntryPath, parentNode, childBox, childIndex) {
  return {
    type: childBox.type,
    path: sampleEntryPath + "/" + childBox.type + "[" + (childIndex + 1) + "]",
    offset: parentNode.offset || "",
    size: childBox.size,
    headerSize: 8,
    children: [],
    fields: childBox.fields || {},
    warnings: [],
    synthetic: true,
    syntheticKind: "sample-entry-child-box",
    sourceBoxPath: parentNode.path
  };
}

export function formatBoxNodeSize(node) {
  const formattedSize = Number.isFinite(Number(node.size)) ? String(node.size) + " (" + formatBytes(Number(node.size)) + ")" : t("value.notAvailable");
  if (node.synthetic) return formattedSize + " · " + t("boxes.synthetic");
  return formattedSize + " @ " + String(node.offset || "");
}

export function getActualBoxFields(node) {
  if (!node || !node.fields) return {};
  if (node.syntheticKind === "sample-entry" && node.sourceEntry) return createActualSampleEntryFields(node.sourceEntry);
  if (node.type === "stsd") return createActualStsdFields(node.fields);
  return node.fields;
}

export function createActualStsdFields(fields) {
  return {
    version: fields.version,
    flags: fields.flags,
    entryCount: fields.entryCount,
    entries: Array.isArray(fields.entries) ? fields.entries.map(createActualSampleEntryFields) : []
  };
}

export function createActualSampleEntryFields(entry) {
  const actualFields = {};
  for (const [fieldName, value] of Object.entries(entry || {})) {
    if (SAMPLE_ENTRY_DERIVED_FIELD_NAMES.has(fieldName)) continue;
    if (fieldName === "boxes") {
      actualFields.boxes = (value || []).map((childBox, childIndex) => ({
        index: childIndex + 1,
        type: childBox.type,
        size: childBox.size,
        parsedFieldKeys: childBox.fields ? Object.keys(childBox.fields) : []
      }));
    } else {
      actualFields[fieldName] = value;
    }
  }
  return actualFields;
}

export function getDerivedBoxFields(node) {
  if (!node) return null;
  if (node.syntheticKind === "sample-entry" && node.sourceEntry) {
    const sampleEntryDerivedFields = createSampleEntryDerivedFields(node.sourceEntry);
    return sampleEntryDerivedFields ? { sourceBoxPath: node.sourceBoxPath, sampleEntry: sampleEntryDerivedFields } : null;
  }
  if (node.type !== "stsd" || !node.fields || !Array.isArray(node.fields.entries)) return null;
  const sampleEntries = node.fields.entries
    .map(createSampleEntryDerivedFields)
    .filter(Boolean);
  return sampleEntries.length ? { sourceBoxPath: node.path, sampleEntries } : null;
}

export function createSampleEntryDerivedFields(entry) {
  const derivedFields = { index: entry.index, format: entry.format };
  let hasDerivedFields = false;
  for (const fieldName of SAMPLE_ENTRY_DERIVED_FIELD_NAMES) {
    if (entry && entry[fieldName] !== undefined) {
      derivedFields[fieldName] = entry[fieldName];
      hasDerivedFields = true;
    }
  }
  return hasDerivedFields ? derivedFields : null;
}

export function formatBoxTypeLabel(type) {
  const info = BOX_TYPE_INFO[type];
  const localized = getLocalizedBoxInfo(type);
  return info ? type + " (" + localized.name + ")" : type + " (" + t("boxes.unknownType") + ")";
}

export function getBoxTypeDescription(type) {
  return getLocalizedBoxInfo(type).description;
}

export function getLocalizedBoxInfo(type) {
  const info = BOX_TYPE_INFO[type];
  if (!info) return { name: t("boxes.unknownType"), description: t("boxes.noDescription") };
  const language = getLanguage();
  const localized = BOX_TYPE_I18N[language] && BOX_TYPE_I18N[language][type];
  if (!localized) return info;
  return { name: localized[0], description: localized[1] };
}
