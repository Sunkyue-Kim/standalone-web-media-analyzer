const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { createSourceModuleLoader } = require("./helpers/source-module-loader.cjs");

const rootDirectory = path.resolve(__dirname, "..");
const samplesDirectory = path.join(rootDirectory, "validation", "generated");

const sampleExpectations = [
  ["avc_bframes.mp4", "video/mp4", "isobmff", 1, 120, ["I", "P", "B"]],
  ["avc_fragmented.mp4", "video/mp4", "isobmff", 1, 120, ["I", "P", "B"]],
  ["audio_mp3.mp3", "audio/mpeg", "mp3", 1, 78, ["MP3"]],
  ["audio_opus.opus", "audio/ogg", "ogg-opus", 1, 101, ["Opus"]],
  ["webm_vp9_opus.webm", "video/webm", "webm", 2, 149, ["I", "P", "Opus"]]
];

function loadSampleFile(fileName, type) {
  const bytes = fs.readFileSync(path.join(samplesDirectory, fileName));
  return new File([bytes], fileName, { type });
}

function countFrameTypes(rows) {
  return rows.reduce((counts, row) => {
    const key = row.frameType || "missing";
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

test("registered containers analyze bundled samples and frame scanner fills known frame types", async () => {
  const loader = await createSourceModuleLoader();
  const containers = await loader.import("src/js/core/containers/registry.js");
  const frameScanner = await loader.import("src/js/core/codecs/frame-scanner.js");
  const { BOX_TYPE_INFO } = await loader.import("src/js/core/containers/isobmff/box-types.js");
  const { BOX_TYPE_I18N } = await loader.import("src/js/i18n/catalogs.js");
  const seenBoxTypes = new Set();

  for (const [fileName, type, containerId, trackCount, sampleCount, expectedFrameTypes] of sampleExpectations) {
    const progress = [];
    const analysis = await containers.analyzeFileWithRegisteredContainer(loadSampleFile(fileName, type), {
      onProgress(label, percent) {
        progress.push([label, percent]);
      }
    });
    await frameScanner.scanFrameTypes(analysis, { onProgress() {} });

    assert.equal(analysis.container.id, containerId, fileName);
    assert.equal(analysis.tracks.length, trackCount, fileName);
    assert.equal(analysis.sampleRows.length, sampleCount, fileName);
    assert.equal(analysis.warnings.length, 0, fileName);
    assert.ok(progress.some((entry) => entry[1] === 100), fileName + " should report completion");
    for (const box of analysis.allBoxes) seenBoxTypes.add(box.type);

    const frameTypeCounts = countFrameTypes(analysis.sampleRows);
    for (const expectedFrameType of expectedFrameTypes) {
      assert.ok(frameTypeCounts[expectedFrameType] > 0, fileName + " missing " + expectedFrameType);
    }
    assert.equal(frameTypeCounts.unknown || 0, 0, fileName);
  }

  for (const boxType of seenBoxTypes) {
    assert.ok(!boxType.startsWith("EBML_"), boxType + " should have a parsed WebM/Matroska element name.");
    assert.ok(BOX_TYPE_INFO[boxType], boxType + " should have an English box description.");
    assert.ok(BOX_TYPE_I18N.ko[boxType], boxType + " should have a Korean box description.");
  }
});

test("container registry rejects unsupported files and auto-scan boundary is conservative", async () => {
  const loader = await createSourceModuleLoader();
  const containers = await loader.import("src/js/core/containers/registry.js");
  const frameScanner = await loader.import("src/js/core/codecs/frame-scanner.js");

  await assert.rejects(
    () => containers.analyzeFileWithRegisteredContainer(new File([new Uint8Array([1, 2, 3, 4])], "unknown.bin", { type: "application/octet-stream" }), {}),
    /No registered container/
  );

  assert.equal(frameScanner.shouldAutoScan({
    tracks: [{ trackId: 1, codec: "avc1", codecConfig: { nalLengthSize: 4 } }],
    sampleRows: Array.from({ length: 10001 }, (_, index) => ({
      trackId: 1,
      offset: String(index),
      size: 64 * 1024
    }))
  }), false);
  assert.equal(frameScanner.shouldAutoScan({
    tracks: [{ trackId: 1, codec: "avc1", codecConfig: { nalLengthSize: 4 } }],
    sampleRows: [{ trackId: 1, offset: "0", size: 100 }]
  }), true);
});
