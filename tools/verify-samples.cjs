const fs = require("node:fs");
const path = require("node:path");

const rootDirectory = path.resolve(__dirname, "..");
const htmlPath = path.join(rootDirectory, "mp4-analyzer.html");
const samplesDirectory = path.join(rootDirectory, "validation", "generated");

const expectedSamples = new Map([
  ["avc_10020.mp4", { samples: 10020, frameTypes: ["I", "P"], moofs: 0 }],
  ["avc_bframes.mp4", { samples: 120, frameTypes: ["I", "P", "B"], moofs: 0 }],
  ["avc_fragmented.mp4", { samples: 120, frameTypes: ["I", "P", "B"], moofs: 5 }],
  ["avc_no_bframes.mp4", { samples: 90, frameTypes: ["I", "P"], moofs: 0 }]
]);

async function main() {
  const core = loadCoreFromHtml();
  const selfTestResult = core.runParserSelfTests();
  if (!selfTestResult.passed) throw new Error("Core self-tests failed.");
  if (typeof core.getDefaultSampleFrameType !== "function") {
    throw new Error("Core.getDefaultSampleFrameType is not exported.");
  }

  const results = [];
  for (const [fileName, expectation] of expectedSamples) {
    const filePath = path.join(samplesDirectory, fileName);
    const bytes = fs.readFileSync(filePath);
    const file = new File([bytes], fileName, { type: "video/mp4" });
    const analysis = await core.analyzeFile(file, { onProgress() {} });
    await core.scanFrameTypes(analysis, { onProgress() {} });

    const moofs = analysis.topBoxes.filter((box) => box.type === "moof").length;
    const truns = analysis.allBoxes.filter((box) => box.type === "trun").length;
    const frameTypeCounts = countFrameTypes(analysis.sampleRows);

    assertEqual(analysis.tracks.length, 1, `${fileName} track count`);
    assertEqual(analysis.sampleRows.length, expectation.samples, `${fileName} sample count`);
    assertEqual(moofs, expectation.moofs, `${fileName} moof count`);
    if (expectation.moofs > 0 && truns <= 0) throw new Error(`${fileName} expected trun boxes.`);
    for (const frameType of expectation.frameTypes) {
      if (!frameTypeCounts[frameType]) throw new Error(`${fileName} missing frame type ${frameType}.`);
    }
    if (frameTypeCounts.unknown) throw new Error(`${fileName} still has unknown frame types.`);
    if (analysis.warnings.length) throw new Error(`${fileName} has warnings: ${analysis.warnings.join("; ")}`);

    results.push({
      fileName,
      samples: analysis.sampleRows.length,
      moofs,
      truns,
      frameTypeCounts
    });
  }

  console.log(JSON.stringify({ selfTests: selfTestResult.results.length, results }, null, 2));
}

function loadCoreFromHtml() {
  const html = fs.readFileSync(htmlPath, "utf8");
  const scriptMatch = html.match(/<script>([\s\S]*)<\/script>/i);
  if (!scriptMatch) throw new Error("mp4-analyzer.html has no inline script.");
  global.window = {};
  eval(scriptMatch[1]);
  if (!window.MP4AnalyzerCore) throw new Error("MP4AnalyzerCore was not exposed.");
  return window.MP4AnalyzerCore;
}

function countFrameTypes(rows) {
  const counts = {};
  for (const row of rows) {
    const key = row.frameType || "missing";
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
