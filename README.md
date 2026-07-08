# Standalone Web Media Analyzer

Single-file browser media analyzer for MP4/fMP4/MOV, WebM, MP3, and Ogg Opus files.

The app is designed as a local-first inspection tool: files are opened with standard browser APIs, parsed in chunks, and never uploaded to a server.

GitHub Pages: https://sunkyue-kim.github.io/standalone-web-media-analyzer/

## Use

Open `index.html` or the GitHub Pages URL, then drop a media file anywhere in the window or use the open-file button.

The hosted build can also load bundled validation samples from `validation/generated/`. When the app is opened directly with `file://`, the sample selector is hidden because browsers generally block relative sample loading from local files.

## Features

- MP4, fragmented MP4, and MOV-style ISO BMFF box trees, sample tables, chunks, fragments, and warnings
- AVC/H.264 and HEVC/H.265 video frame scanning from sample payloads, including I/P/B-style frame type classification where the codec bitstream exposes it
- AAC, MP3, Opus, ProRes, VP9, and unknown-codec metadata handling through a pluggable codec descriptor registry
- WebM/Matroska EBML structure parsing, track summaries, clusters, blocks, keyframe flags, and per-block sample rows
- MP3 ID3 detection plus MPEG audio frame scanning
- Ogg Opus page/lacing parsing with packet-level rows and Opus identification metadata
- Frame table, vertical frame-size graph, bitrate/FPS/sample metrics, fragments, box details, and warning views
- English/Korean UI with a centralized i18n catalog
- JSON and CSV export for analysis results

## Build

```powershell
npm install
npm run build
```

Build outputs are still single HTML files:

- `standalone-web-media-analyzer.html`: readable single-file HTML for inspection
- `standalone-web-media-analyzer.min.html`: minified single-file HTML
- `index.html`: minified GitHub Pages entry point

## Source Layout

- `src/app.js`: build entry
- `src/js/main.js`: browser bootstrap
- `src/js/core/analyzer-core.js`: public API facade and container orchestration
- `src/js/core/common/`: binary readers, bitstream helpers, formatting, and shared constants
- `src/js/core/containers/`: pluggable container analyzers
- `src/js/core/containers/isobmff/`: MP4/fMP4/MOV parser, box tree, tracks, samples, fragments
- `src/js/core/containers/webm/`: WebM/Matroska EBML parser and block/sample extraction
- `src/js/core/containers/mp3/`: MP3 ID3 and MPEG audio frame parser
- `src/js/core/containers/ogg/`: Ogg page parser and Opus packet extraction
- `src/js/core/codecs/registry.js`: interchangeable codec descriptor registry
- `src/js/core/codecs/audio/`: audio codec parsers such as AAC, MP3, and Opus
- `src/js/core/codecs/video/`: video codec parsers such as AVC and HEVC
- `src/js/i18n/catalogs.js`: English/Korean UI strings and box descriptions
- `src/js/samples/sample-manifest.js`: static sample file manifest for HTTP/HTTPS builds
- `src/js/ui/analyzer-ui.js`: DOM state, rendering, filters, exports, media preview, and sample loading
- `src/js/ui/ui-helpers.js`: testable UI helper logic shared by rendering and tests
- `tests/`: Node `node:test` suites for common utilities, codecs, ISO BMFF sample models, container integration, i18n, and UI helpers/static structure

## Test And Validation

```powershell
npm run build
npm test
npm run test:coverage
npm run verify:samples
npm run verify:ui
```

`npm run verify` runs the full local verification chain: build, unit/integration tests, sample verification, and UI smoke verification.

Validation samples live under `validation/generated/` and are also exposed by the GitHub Pages build when available.

Current coverage snapshot from `npm run test:coverage`:

- Tests: 16 passed, 0 failed
- All files: 93.01% line coverage, 64.29% branch coverage, 92.73% function coverage
- Strong coverage areas: binary readers, bitstream helpers, formatting, codec registry, i18n, UI helper logic, ISO BMFF sample modeling, and bundled sample container integration
- Lower branch coverage remains mainly in malformed/edge container branches such as uncommon HEVC arrays, oversized/invalid MP4 boxes, MP3 ID3v1 edge metadata, and WebM lacing variants
