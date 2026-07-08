import { BOX_TYPE_INFO } from "./containers/isobmff/box-types.js";
import { findDescendants, getDefaultSampleFrameType } from "./containers/isobmff/sample-model.js";
import { analyzeFileWithRegisteredContainer } from "./containers/registry.js";
import { parseAudioSpecificConfig, parseEsds } from "./codecs/audio/aac.js";
import { parseAvcSample } from "./codecs/video/avc.js";
import { parseHevcC, parseHevcSample } from "./codecs/video/hevc.js";
import { scanAvcFrameTypes, scanFrameTypes, shouldAutoScan } from "./codecs/frame-scanner.js";
import { runParserSelfTests } from "./self-tests.js";
import {
  ROW_HEIGHT,
  GRAPH_ROW_HEIGHT,
  METRIC_CHART_WIDTH,
  METRIC_CHART_HEIGHT,
  METRIC_CHART_PADDING
} from "./common/ui-constants.js";
import {
  clamp,
  formatBytes,
  formatBitsPerSecond,
  formatPreviewBitrate,
  formatMetricNumber,
  formatTime
} from "./common/formatting.js";
import { safeJsonReplacer } from "./common/binary.js";

async function analyzeFile(file, options) {
  return analyzeFileWithRegisteredContainer(file, options);
}

export const Core = {
  analyzeFile,
  scanFrameTypes,
  scanAvcFrameTypes,
  parseAvcSample,
  parseHevcSample,
  parseAudioSpecificConfig,
  parseEsds,
  parseHevcC,
  runParserSelfTests,
  shouldAutoScan,
  formatBytes,
  getDefaultSampleFrameType
};

export {
  ROW_HEIGHT,
  GRAPH_ROW_HEIGHT,
  METRIC_CHART_WIDTH,
  METRIC_CHART_HEIGHT,
  METRIC_CHART_PADDING,
  BOX_TYPE_INFO,
  clamp,
  formatBytes,
  formatBitsPerSecond,
  formatPreviewBitrate,
  formatMetricNumber,
  formatTime,
  safeJsonReplacer,
  findDescendants,
  getDefaultSampleFrameType
};
