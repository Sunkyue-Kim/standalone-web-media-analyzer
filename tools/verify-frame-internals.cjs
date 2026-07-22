const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const rootDirectory = path.resolve(__dirname, "..");
const readableBuildPath = path.join(rootDirectory, "mp4-analyzer.html");
const excludedLongSamplePath = "validation/generated/avc_10020.mp4";
const videoFileExtensionPattern = /\.(?:mp4|m4v|mov|webm|mkv|ivf)$/i;
const maximumProcessBufferBytes = 512 * 1024 * 1024;

async function main() {
  verifyReferenceTools();
  const core = await loadCoreFromReadableBuild();
  const trackedVideoPaths = listTrackedVideoPaths();
  const requestedFileName = readRequestedFileName(process.argv.slice(2));
  let includedVideoPaths = trackedVideoPaths.filter(
    (relativePath) => normalizeGitPath(relativePath) !== excludedLongSamplePath
  );
  if (requestedFileName) {
    includedVideoPaths = includedVideoPaths.filter(
      (relativePath) => path.basename(relativePath).toLowerCase() === requestedFileName.toLowerCase()
    );
    assert.equal(includedVideoPaths.length, 1, "--file must name one included git-tracked video sample.");
  }
  assert.ok(
    trackedVideoPaths.some((relativePath) => normalizeGitPath(relativePath) === excludedLongSamplePath),
    "The explicitly excluded 10,020-frame sample must remain git-tracked."
  );

  const results = [];
  for (const relativePath of includedVideoPaths) {
    console.log("[frame-internals] " + normalizeGitPath(relativePath));
    results.push(await verifyVideoFile(core, relativePath));
  }

  const totalVideoFrames = results.reduce((total, result) => total + result.videoFrameCount, 0);
  const totalFfmpegMacroblockFields = results.reduce(
    (total, result) => total + result.ffmpegMacroblockFieldsCompared,
    0
  );
  console.log(JSON.stringify({
    excluded: excludedLongSamplePath,
    fileCount: results.length,
    totalVideoFrames,
    totalFfmpegMacroblockFields,
    results
  }, null, 2));
}

async function verifyVideoFile(core, relativePath) {
  const absolutePath = path.join(rootDirectory, relativePath);
  const fileName = path.basename(relativePath);
  const fileBytes = fs.readFileSync(absolutePath);
  const file = new File([fileBytes], fileName, { type: inferMediaType(fileName) });
  const analysis = await core.analyzeFile(file, { onProgress() {} });
  await core.scanFrameTypes(analysis, { onProgress() {} });

  const videoTracks = analysis.tracks.filter((track) => track.handlerType === "vide");
  assert.equal(videoTracks.length, 1, fileName + " must contain exactly one video track for reference validation.");
  const videoTrack = videoTracks[0];
  const sampleRows = analysis.sampleRows.filter(
    (sampleRow) => String(sampleRow.trackId) === String(videoTrack.trackId)
  );
  const probe = probeVideoFrames(absolutePath);
  const probeStream = probe.streams[0];
  const probeFrames = probe.frames.filter((frame) => frame.media_type === "video");
  assert.equal(sampleRows.length, probeFrames.length, fileName + " JS/FFmpeg video frame count");

  const sampleRowsByOffset = new Map(sampleRows.map((sampleRow) => [String(sampleRow.offset), sampleRow]));
  const matchedSampleRows = matchProbeFramesToSampleRows(probeFrames, sampleRows, sampleRowsByOffset);
  const codecFamily = normalizeCodecFamily(probeStream.codec_name, videoTrack.codec);
  const headerReference = readHeaderReference(absolutePath, codecFamily);
  const ffmpegMacroblockMaps = codecFamily === "AVC"
    ? readFfmpegAvcMacroblockMaps(absolutePath, probeFrames, probeStream)
    : [];

  let decodedStructureFrameCount = 0;
  let rootOnlyFrameCount = 0;
  let unavailableFrameCount = 0;
  let ffmpegMacroblockFieldsCompared = 0;
  let ffmpegDirectPartitionFieldsUnavailable = 0;

  for (let frameIndex = 0; frameIndex < probeFrames.length; frameIndex += 1) {
    const probeFrame = probeFrames[frameIndex];
    const sampleRow = matchedSampleRows[frameIndex];
    assert.equal(
      normalizeFrameType(sampleRow.frameType),
      normalizeFrameType(probeFrame.pict_type),
      fileName + " frame " + (frameIndex + 1) + " type"
    );

    const parsedFrameInternals = await core.analyzeFrameInternals(analysis, sampleRow);
    verifyNoSyntheticBlockValues(parsedFrameInternals, fileName, frameIndex);
    verifyExactSampleBits(parsedFrameInternals, sampleRow, fileName, frameIndex);

    if (parsedFrameInternals.complete && parsedFrameInternals.granularity === "partition-tree") {
      decodedStructureFrameCount += 1;
    } else if (parsedFrameInternals.complete && parsedFrameInternals.granularity === "root-units") {
      rootOnlyFrameCount += 1;
    } else {
      unavailableFrameCount += 1;
    }

    if (codecFamily === "AVC") {
      assert.equal(parsedFrameInternals.complete, true, frameLabel(fileName, frameIndex) + " AVC traversal");
      assert.equal(
        parsedFrameInternals.granularity,
        "partition-tree",
        frameLabel(fileName, frameIndex) + " AVC granularity"
      );
      verifyAvcTree(parsedFrameInternals, fileName, frameIndex);
      const comparison = compareAvcMacroblocksWithFfmpeg(
        parsedFrameInternals.macroblocks,
        ffmpegMacroblockMaps[frameIndex],
        fileName,
        frameIndex
      );
      ffmpegMacroblockFieldsCompared += comparison.comparedFieldCount;
      ffmpegDirectPartitionFieldsUnavailable += comparison.unavailableDirectPartitionFieldCount;
    } else if (codecFamily === "HEVC") {
      verifyHevcRoots(parsedFrameInternals, headerReference, fileName, frameIndex);
    } else if (codecFamily === "AV1") {
      verifyAv1Result(parsedFrameInternals, headerReference, fileName, frameIndex);
    } else if (codecFamily === "VP9") {
      verifyVp9Result(parsedFrameInternals, headerReference, probeFrame, fileName, frameIndex);
    } else {
      throw new Error(fileName + " has an unsupported validation codec: " + codecFamily);
    }
  }

  return {
    file: normalizeGitPath(relativePath),
    codec: codecFamily,
    videoFrameCount: sampleRows.length,
    decodedStructureFrameCount,
    rootOnlyFrameCount,
    unavailableFrameCount,
    ffmpegMacroblockFieldsCompared,
    ffmpegDirectPartitionFieldsUnavailable,
    reference: describeReference(codecFamily)
  };
}

function verifyReferenceTools() {
  for (const command of ["ffmpeg", "ffprobe"]) {
    const result = runProcess(command, ["-version"]);
    assert.match(result.stdout + result.stderr, /ffmpeg version|ffprobe version/i, command + " version output");
  }
}

function listTrackedVideoPaths() {
  const result = runProcess("git", ["ls-files"]);
  return result.stdout
    .split(/\r?\n/)
    .map((relativePath) => relativePath.trim())
    .filter((relativePath) => relativePath && videoFileExtensionPattern.test(relativePath));
}

function probeVideoFrames(absolutePath) {
  const result = runProcess("ffprobe", [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_streams",
    "-show_frames",
    "-show_entries",
    "stream=codec_name,width,height,coded_width,coded_height,nb_frames:" +
      "frame=media_type,pict_type,key_frame,pkt_pos,pkt_size,best_effort_timestamp_time",
    "-of", "json",
    absolutePath
  ]);
  const parsed = JSON.parse(result.stdout);
  assert.ok(Array.isArray(parsed.streams) && parsed.streams.length === 1, "ffprobe must return one video stream.");
  assert.ok(Array.isArray(parsed.frames), "ffprobe must return decoded video frames.");
  return parsed;
}

function matchProbeFramesToSampleRows(probeFrames, sampleRows, sampleRowsByOffset) {
  const unusedSampleRows = new Set(sampleRows);
  return probeFrames.map((probeFrame, frameIndex) => {
    let sampleRow = sampleRowsByOffset.get(String(probeFrame.pkt_pos));
    if (!unusedSampleRows.has(sampleRow)) sampleRow = null;
    if (!sampleRow) {
      const packetSize = Number(probeFrame.pkt_size);
      const matchingSizeRows = Array.from(unusedSampleRows).filter(
        (candidate) => Number(candidate.size) === packetSize
      );
      sampleRow = matchingSizeRows.length === 1 ? matchingSizeRows[0] : null;
    }
    if (!sampleRow) {
      const decodeOrderCandidate = sampleRows[frameIndex];
      if (unusedSampleRows.has(decodeOrderCandidate) && Number(decodeOrderCandidate.size) === Number(probeFrame.pkt_size)) {
        sampleRow = decodeOrderCandidate;
      }
    }
    assert.ok(sampleRow, "Could not match FFmpeg frame " + (frameIndex + 1) + " to a parsed sample row.");
    unusedSampleRows.delete(sampleRow);
    return sampleRow;
  });
}

function readHeaderReference(absolutePath, codecFamily) {
  if (!new Set(["HEVC", "AV1", "VP9"]).has(codecFamily)) return null;
  const result = runProcess("ffmpeg", [
    "-hide_banner",
    "-loglevel", "trace",
    "-i", absolutePath,
    "-map", "0:v:0",
    "-c", "copy",
    "-bsf:v", "trace_headers",
    "-frames:v", "1",
    "-f", "null",
    "-"
  ]);
  const trace = result.stderr;
  if (codecFamily === "HEVC") {
    const minimumCodingBlockLog2Minus3 = readTraceInteger(
      trace,
      "log2_min_luma_coding_block_size_minus3"
    );
    const maximumCodingBlockLog2Difference = readTraceInteger(
      trace,
      "log2_diff_max_min_luma_coding_block_size"
    );
    return {
      width: readTraceInteger(trace, "pic_width_in_luma_samples"),
      height: readTraceInteger(trace, "pic_height_in_luma_samples"),
      rootSize: 1 << (minimumCodingBlockLog2Minus3 + 3 + maximumCodingBlockLog2Difference)
    };
  }
  if (codecFamily === "AV1") {
    return {
      width: readTraceInteger(trace, "max_frame_width_minus_1") + 1,
      height: readTraceInteger(trace, "max_frame_height_minus_1") + 1,
      rootSize: readTraceInteger(trace, "use_128x128_superblock") ? 128 : 64
    };
  }
  return {
    width: readTraceInteger(trace, "frame_width_minus_1") + 1,
    height: readTraceInteger(trace, "frame_height_minus_1") + 1,
    rootSize: 64
  };
}

function readTraceInteger(trace, fieldName) {
  const escapedFieldName = fieldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = trace.match(new RegExp("\\b" + escapedFieldName + "\\b[^\\r\\n]*=\\s*(-?\\d+)"));
  assert.ok(match, "FFmpeg trace_headers did not expose " + fieldName + ".");
  return Number(match[1]);
}

function readFfmpegAvcMacroblockMaps(absolutePath, probeFrames, probeStream) {
  const result = runProcess("ffmpeg", [
    "-hide_banner",
    "-nostats",
    "-nostdin",
    "-loglevel", "debug",
    "-debug", "mb_type",
    "-threads", "1",
    "-an",
    "-sn",
    "-i", absolutePath,
    "-map", "0:v:0",
    "-f", "null",
    "-"
  ]);
  const macroblockColumns = Math.ceil(Number(probeStream.coded_width || probeStream.width) / 16);
  const macroblockRows = Math.ceil(Number(probeStream.coded_height || probeStream.height) / 16);
  const maps = parseFfmpegAvcMacroblockMaps(
    result.stderr,
    macroblockColumns,
    macroblockRows,
    probeFrames.length
  );
  assert.equal(maps.length, probeFrames.length, path.basename(absolutePath) + " FFmpeg macroblock-map frame count");
  for (let frameIndex = 0; frameIndex < maps.length; frameIndex += 1) {
    assert.equal(
      maps[frameIndex].pictureType,
      normalizeFrameType(probeFrames[frameIndex].pict_type),
      path.basename(absolutePath) + " FFmpeg debug/probe frame type " + (frameIndex + 1)
    );
  }
  return maps;
}

function parseFfmpegAvcMacroblockMaps(stderr, macroblockColumns, macroblockRows, expectedFrameCount) {
  const maps = [];
  let activeMap = null;
  const finishActiveMap = () => {
    if (!activeMap) return;
    if (activeMap.rows.length !== macroblockRows) {
      activeMap = null;
      return;
    }
    activeMap.signature = activeMap.rows.join("");
    assert.equal(
      activeMap.signature.length,
      macroblockColumns * macroblockRows * 2,
      "FFmpeg AVC debug macroblock signature length"
    );
    maps.push(activeMap);
    activeMap = null;
  };

  for (const line of stderr.split(/\r?\n/)) {
    const frameMatch = line.match(/^\[h264 @ ([^\]]+)\].*New frame, type:\s*([IPB])/);
    if (frameMatch) {
      finishActiveMap();
      activeMap = { decoderContext: frameMatch[1], pictureType: frameMatch[2], rows: [] };
      continue;
    }
    if (!activeMap) continue;
    const closingBracketIndex = line.indexOf("]");
    if (closingBracketIndex < 0) continue;
    if (!line.startsWith("[h264 @ " + activeMap.decoderContext + "]")) continue;
    const body = line.slice(closingBracketIndex + 1).trimStart();
    const rowMatch = body.match(/^(\d+)\s(.*)$/);
    if (!rowMatch || Number(rowMatch[1]) !== activeMap.rows.length * 16) continue;
    const tokenText = rowMatch[2].padEnd(macroblockColumns * 3, " ");
    let rowSignature = "";
    let valid = true;
    for (let macroblockColumn = 0; macroblockColumn < macroblockColumns; macroblockColumn += 1) {
      const token = tokenText.slice(macroblockColumn * 3, macroblockColumn * 3 + 3);
      if (!/[PiIdDgGSA><X]/.test(token[0]) || !/[ +\-|?]/.test(token[1])) {
        valid = false;
        break;
      }
      assert.notEqual(token[2], "=", "Interlaced AVC is outside the progressive sample validation scope.");
      rowSignature += token.slice(0, 2);
    }
    if (valid) activeMap.rows.push(rowSignature);
  }
  finishActiveMap();
  if (!Number.isInteger(expectedFrameCount) || maps.length === expectedFrameCount) return maps;
  const mapsByDecoderContext = new Map();
  for (const map of maps) {
    const contextMaps = mapsByDecoderContext.get(map.decoderContext) || [];
    contextMaps.push(map);
    mapsByDecoderContext.set(map.decoderContext, contextMaps);
  }
  const exactContextMaps = Array.from(mapsByDecoderContext.values()).filter(
    (contextMaps) => contextMaps.length === expectedFrameCount
  );
  assert.equal(exactContextMaps.length, 1, "FFmpeg AVC debug must expose one complete decoder context.");
  return exactContextMaps[0];
}

function compareAvcMacroblocksWithFfmpeg(macroblocks, ffmpegMap, fileName, frameIndex) {
  assert.ok(Array.isArray(macroblocks), frameLabel(fileName, frameIndex) + " AVC macroblocks");
  assert.equal(
    macroblocks.length * 2,
    ffmpegMap.signature.length,
    frameLabel(fileName, frameIndex) + " AVC macroblock count"
  );
  let comparedFieldCount = 0;
  let unavailableDirectPartitionFieldCount = 0;
  for (let macroblockIndex = 0; macroblockIndex < macroblocks.length; macroblockIndex += 1) {
    const expected = getAvcFfmpegComparableToken(macroblocks[macroblockIndex]);
    const actualPredictionCharacter = ffmpegMap.signature[macroblockIndex * 2];
    const actualPartitionCharacter = ffmpegMap.signature[macroblockIndex * 2 + 1];
    assert.equal(
      actualPredictionCharacter,
      expected.predictionCharacter,
      frameLabel(fileName, frameIndex) + " macroblock " + macroblockIndex + " FFmpeg prediction class"
    );
    comparedFieldCount += 1;
    if (expected.partitionCharacter === null) {
      unavailableDirectPartitionFieldCount += 1;
    } else {
      assert.equal(
        actualPartitionCharacter,
        expected.partitionCharacter,
        frameLabel(fileName, frameIndex) + " macroblock " + macroblockIndex + " FFmpeg partition class"
      );
      comparedFieldCount += 1;
    }
  }
  return { comparedFieldCount, unavailableDirectPartitionFieldCount };
}

function getAvcFfmpegComparableToken(macroblock) {
  const type = String(macroblock && macroblock.type || "");
  if (type === "I_PCM") return { predictionCharacter: "P", partitionCharacter: " " };
  if (type === "I_16x16") return { predictionCharacter: "I", partitionCharacter: " " };
  if (type === "I_4x4" || type === "I_8x8") {
    return { predictionCharacter: "i", partitionCharacter: " " };
  }
  if (type === "P_Skip") return { predictionCharacter: "S", partitionCharacter: " " };
  if (type === "B_Skip") return { predictionCharacter: "d", partitionCharacter: null };
  if (type === "B_Direct_16x16") return { predictionCharacter: "D", partitionCharacter: null };

  const children = Array.isArray(macroblock && macroblock.children) ? macroblock.children : [];
  if (type === "B_8x8") return { predictionCharacter: "X", partitionCharacter: "+" };

  let predictionCharacter = ">";
  if (type.startsWith("B_")) {
    const directions = children.map((child) => String(child && child.predictionDirection || ""));
    const usesList0 = directions.some((direction) => direction === "L0" || direction === "Bi");
    const usesList1 = directions.some((direction) => direction === "L1" || direction === "Bi");
    predictionCharacter = usesList0 && usesList1 ? "X" : usesList1 ? "<" : ">";
  }
  const partitionCharacter = type.includes("16x8")
    ? "-"
    : type.includes("8x16")
      ? "|"
      : type.includes("8x8")
        ? "+"
        : " ";
  return { predictionCharacter, partitionCharacter };
}

function verifyAvcTree(result, fileName, frameIndex) {
  const label = frameLabel(fileName, frameIndex) + " AVC";
  assert.equal(result.structureTruncated, false, label + " full partition tree");
  assert.ok(Array.isArray(result.macroblocks), label + " macroblocks");
  assert.equal(
    result.macroblocks.length,
    Number(result.macroblockColumns) * Number(result.macroblockRows),
    label + " root count"
  );

  let attributedBits = 0;
  let partitionCount = 0;
  for (let macroblockIndex = 0; macroblockIndex < result.macroblocks.length; macroblockIndex += 1) {
    const macroblock = result.macroblocks[macroblockIndex];
    const expectedLeft = (macroblockIndex % result.macroblockColumns) * 16;
    const expectedTop = Math.floor(macroblockIndex / result.macroblockColumns) * 16;
    assert.equal(macroblock.codedLeft, expectedLeft, label + " macroblock " + macroblockIndex + " left");
    assert.equal(macroblock.codedTop, expectedTop, label + " macroblock " + macroblockIndex + " top");
    assert.equal(macroblock.codedWidth, 16, label + " macroblock " + macroblockIndex + " width");
    assert.equal(macroblock.codedHeight, 16, label + " macroblock " + macroblockIndex + " height");
    assert.ok(
      Number.isInteger(macroblock.syntaxBits) && macroblock.syntaxBits >= 0,
      label + " macroblock " + macroblockIndex + " syntax bits"
    );
    assert.ok(Array.isArray(macroblock.children) && macroblock.children.length > 0, label + " child partitions");

    let childArea = 0;
    let childSyntaxBits = 0;
    const childRectangles = [];
    for (let childIndex = 0; childIndex < macroblock.children.length; childIndex += 1) {
      const child = macroblock.children[childIndex];
      const childLeft = Number(child.codedLeft);
      const childTop = Number(child.codedTop);
      const childWidth = Number(child.codedWidth);
      const childHeight = Number(child.codedHeight);
      assert.ok(childWidth > 0 && childHeight > 0, label + " positive child size");
      assert.ok(
        childLeft >= expectedLeft && childTop >= expectedTop &&
          childLeft + childWidth <= expectedLeft + 16 && childTop + childHeight <= expectedTop + 16,
        label + " macroblock " + macroblockIndex + " child bounds"
      );
      assert.ok(
        Number.isInteger(child.syntaxBits) && child.syntaxBits >= 0,
        label + " macroblock " + macroblockIndex + " child syntax bits"
      );
      childArea += childWidth * childHeight;
      childSyntaxBits += child.syntaxBits;
      childRectangles.push({
        left: childLeft,
        top: childTop,
        right: childLeft + childWidth,
        bottom: childTop + childHeight
      });
    }
    assert.equal(childArea, 16 * 16, label + " macroblock " + macroblockIndex + " child coverage");
    for (let leftIndex = 0; leftIndex < childRectangles.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < childRectangles.length; rightIndex += 1) {
        const leftRectangle = childRectangles[leftIndex];
        const rightRectangle = childRectangles[rightIndex];
        const overlapWidth = Math.min(leftRectangle.right, rightRectangle.right) -
          Math.max(leftRectangle.left, rightRectangle.left);
        const overlapHeight = Math.min(leftRectangle.bottom, rightRectangle.bottom) -
          Math.max(leftRectangle.top, rightRectangle.top);
        assert.ok(
          overlapWidth <= 0 || overlapHeight <= 0,
          label + " macroblock " + macroblockIndex + " child overlap"
        );
      }
    }
    assert.equal(macroblock.childSyntaxBits, childSyntaxBits, label + " child syntax sum");
    assert.equal(macroblock.subtreeBits, macroblock.syntaxBits, label + " subtree bits");
    assert.equal(macroblock.ownBits + childSyntaxBits, macroblock.syntaxBits, label + " root bit accounting");
    assert.ok(macroblock.ownBits >= 0, label + " non-negative root bits");
    attributedBits += macroblock.syntaxBits;
    partitionCount += macroblock.children.length;
  }

  assert.equal(result.partitions.length, partitionCount, label + " flattened partition count");
  assert.equal(result.attributedBits, attributedBits, label + " attributed bit sum");
  assert.equal(result.overheadBits, result.sampleBits - attributedBits, label + " overhead bit sum");
}

function verifyHevcRoots(result, reference, fileName, frameIndex) {
  assert.equal(result.complete, true, frameLabel(fileName, frameIndex) + " HEVC root result");
  assert.equal(result.granularity, "root-units", frameLabel(fileName, frameIndex) + " HEVC granularity");
  assert.equal(result.unitWidth, reference.rootSize, frameLabel(fileName, frameIndex) + " HEVC CTU width");
  assert.equal(result.unitHeight, reference.rootSize, frameLabel(fileName, frameIndex) + " HEVC CTU height");
  verifyRootGrid(result.roots, reference, fileName, frameIndex, "HEVC");
}

function verifyAv1Result(result, reference, fileName, frameIndex) {
  if (!result.complete) {
    assert.match(
      result.reason,
      /show_existing_frame|overrides the sequence dimensions|super-resolution/,
      frameLabel(fileName, frameIndex) + " AV1 fail-closed reason"
    );
    assert.equal("roots" in result, false, frameLabel(fileName, frameIndex) + " AV1 must not fabricate roots");
    return;
  }
  assert.equal(result.complete, true, frameLabel(fileName, frameIndex) + " AV1 root result");
  assert.equal(result.granularity, "root-units", frameLabel(fileName, frameIndex) + " AV1 granularity");
  assert.equal(result.unitWidth, reference.rootSize, frameLabel(fileName, frameIndex) + " AV1 superblock width");
  assert.equal(result.unitHeight, reference.rootSize, frameLabel(fileName, frameIndex) + " AV1 superblock height");
  verifyRootGrid(result.roots, reference, fileName, frameIndex, "AV1");
}

function verifyVp9Result(result, reference, probeFrame, fileName, frameIndex) {
  if (normalizeFrameType(probeFrame.pict_type) === "I") {
    assert.equal(result.complete, true, frameLabel(fileName, frameIndex) + " VP9 keyframe traversal");
    assert.equal(result.granularity, "partition-tree", frameLabel(fileName, frameIndex) + " VP9 granularity");
    const leafBlocks = flattenResultBlocks(result.roots).filter(
      (block) => !Array.isArray(block.children) || block.children.length === 0
    );
    assertVisibleCoverage(leafBlocks, reference.width, reference.height, fileName, frameIndex, "VP9");
    return;
  }
  assert.equal(result.complete, false, frameLabel(fileName, frameIndex) + " VP9 inter fail-closed result");
  assert.equal(result.reason, "stateful-inter-frame", frameLabel(fileName, frameIndex) + " VP9 inter reason");
  assert.equal("roots" in result, false, frameLabel(fileName, frameIndex) + " VP9 inter must not fabricate roots");
}

function verifyRootGrid(roots, reference, fileName, frameIndex, codecFamily) {
  assert.ok(Array.isArray(roots) && roots.length > 0, frameLabel(fileName, frameIndex) + " " + codecFamily + " roots");
  assert.equal(
    roots.length,
    Math.ceil(reference.width / reference.rootSize) * Math.ceil(reference.height / reference.rootSize),
    frameLabel(fileName, frameIndex) + " " + codecFamily + " root count"
  );
  const columnCount = Math.ceil(reference.width / reference.rootSize);
  for (let rootIndex = 0; rootIndex < roots.length; rootIndex += 1) {
    const root = roots[rootIndex];
    const expectedLeft = (rootIndex % columnCount) * reference.rootSize;
    const expectedTop = Math.floor(rootIndex / columnCount) * reference.rootSize;
    assert.equal(Number(root.left ?? root.x), expectedLeft, frameLabel(fileName, frameIndex) + " " + codecFamily + " root left");
    assert.equal(Number(root.top ?? root.y), expectedTop, frameLabel(fileName, frameIndex) + " " + codecFamily + " root top");
    assert.equal(
      Number(root.visibleWidth ?? (root.metadata && root.metadata.visibleWidth) ?? root.width),
      Math.min(reference.rootSize, reference.width - expectedLeft),
      frameLabel(fileName, frameIndex) + " " + codecFamily + " root width"
    );
    assert.equal(
      Number(root.visibleHeight ?? (root.metadata && root.metadata.visibleHeight) ?? root.height),
      Math.min(reference.rootSize, reference.height - expectedTop),
      frameLabel(fileName, frameIndex) + " " + codecFamily + " root height"
    );
    assert.equal(root.ownBits ?? null, null, frameLabel(fileName, frameIndex) + " " + codecFamily + " own bits");
    assert.equal(root.syntaxBits ?? null, null, frameLabel(fileName, frameIndex) + " " + codecFamily + " block bits");
    assert.equal(root.subtreeBits ?? null, null, frameLabel(fileName, frameIndex) + " " + codecFamily + " subtree bits");
  }
}

function assertVisibleCoverage(blocks, width, height, fileName, frameIndex, codecFamily) {
  const rectangles = blocks.map((block) => ({
    left: Number(block.left ?? block.x),
    top: Number(block.top ?? block.y),
    right: Number(block.left ?? block.x) + Number(block.width ?? block.visibleWidth),
    bottom: Number(block.top ?? block.y) + Number(block.height ?? block.visibleHeight)
  }));
  const area = rectangles.reduce(
    (total, rectangle) => total + Math.max(0, rectangle.right - rectangle.left) * Math.max(0, rectangle.bottom - rectangle.top),
    0
  );
  assert.equal(area, width * height, frameLabel(fileName, frameIndex) + " " + codecFamily + " visible area");
  for (let leftIndex = 0; leftIndex < rectangles.length; leftIndex += 1) {
    const left = rectangles[leftIndex];
    assert.ok(left.left >= 0 && left.top >= 0 && left.right <= width && left.bottom <= height);
    for (let rightIndex = leftIndex + 1; rightIndex < rectangles.length; rightIndex += 1) {
      const right = rectangles[rightIndex];
      const overlapWidth = Math.min(left.right, right.right) - Math.max(left.left, right.left);
      const overlapHeight = Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top);
      assert.ok(
        overlapWidth <= 0 || overlapHeight <= 0,
        frameLabel(fileName, frameIndex) + " " + codecFamily + " blocks overlap"
      );
    }
  }
}

function verifyNoSyntheticBlockValues(result, fileName, frameIndex) {
  const stack = [result];
  const seen = new Set();
  while (stack.length) {
    const value = stack.pop();
    if (!value || typeof value !== "object" || seen.has(value)) continue;
    seen.add(value);
    for (const forbiddenField of [
      "estimatedBits",
      "estimatedBytes",
      "normalizedBitDensity",
      "spatialComplexity",
      "syntheticBitAllocation"
    ]) {
      assert.equal(
        forbiddenField in value,
        false,
        frameLabel(fileName, frameIndex) + " contains synthetic field " + forbiddenField
      );
    }
    for (const childValue of Object.values(value)) {
      if (childValue && typeof childValue === "object") stack.push(childValue);
    }
  }
}

function verifyExactSampleBits(result, sampleRow, fileName, frameIndex) {
  assert.equal(
    result.sampleBits,
    Number(sampleRow.size) * 8,
    frameLabel(fileName, frameIndex) + " exact sample bits"
  );
  if (Number.isFinite(result.attributedBits) && Number.isFinite(result.overheadBits)) {
    assert.equal(
      result.attributedBits + result.overheadBits,
      result.sampleBits,
      frameLabel(fileName, frameIndex) + " attributed plus overhead bits"
    );
  }
}

function flattenResultBlocks(roots) {
  const blocks = [];
  const stack = Array.isArray(roots) ? roots.slice().reverse() : [];
  while (stack.length) {
    const block = stack.pop();
    blocks.push(block);
    const children = Array.isArray(block && block.children) ? block.children : [];
    for (let index = children.length - 1; index >= 0; index -= 1) stack.push(children[index]);
  }
  return blocks;
}

function normalizeCodecFamily(probeCodecName, trackCodec) {
  const value = (String(probeCodecName || "") + " " + String(trackCodec || "")).toLowerCase();
  if (/h264|avc1|avc3/.test(value)) return "AVC";
  if (/hevc|h265|hvc1|hev1/.test(value)) return "HEVC";
  if (/av1|av01|v_av1/.test(value)) return "AV1";
  if (/vp9|vp09|v_vp9/.test(value)) return "VP9";
  return "unknown";
}

function normalizeFrameType(value) {
  const normalized = String(value || "").toUpperCase();
  return normalized === "KEY" ? "I" : normalized;
}

function inferMediaType(fileName) {
  return /\.webm$/i.test(fileName) ? "video/webm" : "video/mp4";
}

function describeReference(codecFamily) {
  if (codecFamily === "AVC") {
    return "FFmpeg -debug mb_type for every comparable macroblock field; direct-mode derived partition fields are reported unavailable";
  }
  if (codecFamily === "HEVC") return "FFmpeg trace_headers SPS dimensions and CTU size; child CABAC partitions unavailable";
  if (codecFamily === "AV1") return "FFmpeg trace_headers sequence dimensions and superblock size; child entropy partitions unavailable";
  return "FFmpeg trace_headers dimensions; keyframe child syntax verified by complete native traversal, inter frames fail closed";
}

function frameLabel(fileName, frameIndex) {
  return fileName + " frame " + (frameIndex + 1);
}

function normalizeGitPath(relativePath) {
  return String(relativePath).replace(/\\/g, "/");
}

function readRequestedFileName(argumentsList) {
  const fileArgumentIndex = argumentsList.indexOf("--file");
  if (fileArgumentIndex < 0) return "";
  assert.ok(argumentsList[fileArgumentIndex + 1], "--file requires a sample file name.");
  return path.basename(argumentsList[fileArgumentIndex + 1]);
}

function runProcess(command, argumentsList) {
  const result = childProcess.spawnSync(command, argumentsList, {
    cwd: rootDirectory,
    encoding: "utf8",
    maxBuffer: maximumProcessBufferBytes,
    windowsHide: true
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      command + " failed with exit code " + result.status + ":\n" +
      String(result.stderr || result.stdout || "").slice(-8000)
    );
  }
  return { stdout: String(result.stdout || ""), stderr: String(result.stderr || "") };
}

async function loadCoreFromReadableBuild() {
  const html = fs.readFileSync(readableBuildPath, "utf8");
  const scriptStart = html.indexOf("<script>");
  const scriptEnd = html.lastIndexOf("</script>");
  assert.ok(scriptStart >= 0 && scriptEnd > scriptStart, "mp4-analyzer.html has no inline runtime script.");
  global.window = {};
  eval(html.slice(scriptStart + "<script>".length, scriptEnd));
  assert.equal(typeof window.MP4AnalyzerLoadRuntime, "function");
  await window.MP4AnalyzerLoadRuntime();
  assert.ok(window.MP4AnalyzerCore, "The readable build did not expose MP4AnalyzerCore.");
  return window.MP4AnalyzerCore;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = {
  getAvcFfmpegComparableToken,
  matchProbeFramesToSampleRows,
  parseFfmpegAvcMacroblockMaps,
  readTraceInteger,
  verifyAvcTree
};
