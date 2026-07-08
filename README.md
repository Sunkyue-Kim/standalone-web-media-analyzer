# Standalone Web Media Analyzer

Single-file browser media analyzer for MP4/fMP4/MOV, WebM, MP3, and Ogg Opus files.

The app is designed as a local-first inspection tool: files are opened with standard browser APIs, parsed in chunks, and never uploaded to a server.

GitHub Pages: https://sunkyue-kim.github.io/standalone-web-media-analyzer/

## Use

Open `index.html` or the GitHub Pages URL, then drop a media file anywhere in the window or use the open-file button.

The hosted build can also load bundled validation samples from `validation/generated/`. When the app is opened directly with `file://`, the sample selector is hidden because browsers generally block relative sample loading from local files.

Remote URL loading uses a traffic-conscious policy: files up to 4 MB are downloaded once and shared between analysis and playback through a Blob URL. Larger files use HTTP range reads for analysis when CORS allows it, while preview preload is deferred so the browser does not automatically fetch the same media a second time.

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

## Limitations

This is a browser-side parser and inspector, not a transcoder, decoder, or playback engine. It reads container metadata, sample tables, selected payload ranges, and codec headers where practical, but it does not decode audio/video frames into pixels or PCM samples.

Remote URL loading has unavoidable browser constraints:

- Remote media requires browser CORS permission. If CORS blocks `HEAD`, `GET`, or `Range` requests, the app cannot analyze that URL.
- HTTP range analysis needs a server that returns `206 Partial Content` for `Range` requests. A reliable file size should come from `Content-Length` or `Content-Range`; cross-origin servers may need to expose `Content-Range`.
- Files up to 4 MB are downloaded once and reused through a Blob URL for both analysis and playback.
- Files larger than 4 MB are analyzed with script-driven range requests when possible. The preview player uses `preload="none"` so it does not automatically fetch the same media during analysis.
- If the user later plays or seeks a large remote preview, the browser's native media element may issue its own network requests. JavaScript cannot reuse the browser media element's private fetch buffer, and the native media element cannot consume this app's range-read cache.
- `Response.blob()` is only available after a full download completes. Partial response chunks cannot be turned into a normal Blob-backed `<video>` source before the full resource is loaded.
- MediaSource-based reuse is not implemented. It would require a separate segmenting/playback pipeline and would not cover all supported inputs uniformly, especially regular MP4/MOV/MP3 files.

Container support is intentionally scoped:

- Supported containers are MP4/fMP4/MOV-style ISO BMFF, WebM/Matroska, MP3, and Ogg Opus.
- DASH/HLS manifests, remote segment playlists, external MP4 data references, encrypted/DRM media, and robust malformed-file recovery are outside the current scope.
- fMP4 support expects init data and `moof`/`mdat` fragments in the analyzed file or URL resource.
- Box/element fields are parsed best-effort. Vendor/private boxes may only show type, size, offsets, raw identifiers, and warnings until explicit mappings are added.

Codec and frame-type support is also scoped:

- AVC/H.264 and HEVC/H.265 frame type labels are inferred from parsed video slice headers where the sample payload exposes enough bitstream data.
- VP9/WebM keyframe status is based on WebM block/keyframe metadata, not a full VP9 bitstream decoder.
- ProRes and unknown video codecs show container/sample metadata but do not expose I/P/B frame classification.
- AAC, MP3, and Opus are parsed for stream configuration and packet/frame rows, but audio is not decoded.

Large-file behavior is optimized for responsiveness, not full forensic recovery:

- Header and metadata probes use a 4 KB small-range cache to avoid both tiny per-box requests and early 4 MB downloads.
- Larger sample/payload reads use a 4 MB range cache with a 64 MB LRU cap.
- Frame-type scanning still needs to read video sample payload bytes, so very large files or very high sample counts can take time even though the UI renders rows with a recycler view.

## Build

```powershell
npm install
npm run build
```

Single-file outputs:

- `mp4-analyzer.html`: readable single-file HTML for inspection
- `index.html`: minified single-file HTML and GitHub Pages entry point, with inline JavaScript source maps

The build also emits a chunked lazy-load variant:

- `chunked/index.html`: minified HTML shell that loads ESM chunks from `chunked/assets/`
- `chunked/assets/`: minified app, worker, shared chunks, JavaScript source maps, and CSS

Use `npm run build:single` for only the single-file outputs, or `npm run build:chunked` for only the chunked lazy-load output. The default `npm run build` creates both.

In the chunked build, the initial app chunk only handles the lightweight shell: language, file open/drop, sample selection, and tab switching before analysis starts. The full analyzer runtime is lazy-loaded when a file or hosted sample is opened. Container analyzers and codec implementations are also loaded through dynamic imports, so opening an MP4 does not load WebM/Ogg/MP3 analyzers, and parsing/scanning an AVC file does not load the HEVC codec chunk.

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

- Tests: 33 passed, 0 failed
- All files: 94.50% line coverage, 69.71% branch coverage, 93.02% function coverage
- Strong coverage areas: binary readers, HTTP range readers, browser worker client message flow, remote URL loader fallback/progress handling, bitstream helpers, formatting, codec registry, i18n, data grid/recycler helpers, ISO BMFF sample modeling, ISO BMFF rare box parsing, source-map build wiring, and bundled sample container integration
- Lower branch coverage remains mainly in browser-worker runtime branches and malformed/edge container branches such as oversized/invalid MP4 boxes, remote download fallback branches, MP3 ID3v1 edge metadata, and WebM lacing variants
