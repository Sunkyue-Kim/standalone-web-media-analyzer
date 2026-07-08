import { isoBmffContainer } from "./isobmff/analyzer.js";
import { mp3Container } from "./mp3/analyzer.js";
import { oggOpusContainer } from "./ogg/analyzer.js";
import { webmContainer } from "./webm/analyzer.js";

export const CONTAINER_ANALYZERS = [webmContainer, oggOpusContainer, mp3Container, isoBmffContainer];

export async function analyzeFileWithRegisteredContainer(file, options) {
  for (const analyzer of CONTAINER_ANALYZERS) {
    if (await analyzer.canAnalyze(file, options)) {
      const analysis = await analyzer.analyzeFile(file, options);
      analysis.container = { id: analyzer.id, label: analyzer.label };
      return analysis;
    }
  }
  throw new Error("No registered container analyzer accepted this file.");
}
