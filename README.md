# Standalone Web Media Analyzer

Client-side media container analyzer for MP4/fMP4/MOV, WebM, MP3, and Ogg Opus files.

Live app: https://sunkyue-kim.github.io/standalone-web-media-analyzer/

This project is a local-first inspection tool. It opens files with standard browser APIs, parses metadata and sample structures in chunks, and does not upload local files to a server. It is useful when you need to inspect a media file quickly without installing FFmpeg, Bento4, MP4Box, MediaInfo, or a desktop hex viewer.

The runtime is fully static. You can use it as a single self-contained HTML file, or use the chunked lazy-load build when you want smaller initial downloads and CDN-friendly caching. Both modes run entirely in the browser without server-side compute.

## At A Glance

| Area | Supported |
| --- | --- |
| Local files | Drag and drop anywhere in the window, or use the open-file button |
| Hosted samples | Available from GitHub Pages when the app is served over HTTP/HTTPS |
| Remote URLs | Supported when CORS and range-read requirements are satisfied |
| Containers | ISO BMFF MP4/fMP4/MOV, WebM/Matroska, MP3, Ogg Opus |
| Video codecs | AVC/H.264, HEVC/H.265, AV1 metadata/OBU scan, VP9 metadata, ProRes metadata, unknown-codec fallback |
| Audio codecs | AAC, MP3, Opus, unknown-codec fallback |
| Views | Summary, boxes/elements, tracks, frames, metrics, fragments, warnings |
| Frame internals | Native-JavaScript AVC, HEVC, VP9, and AV1 syntax inspection with exact-only block geometry, optional source-frame overlay, and no synthetic block bits |
| Exports | JSON and CSV |
| Languages | English and Korean |
| Output builds | Single-file HTML and chunked lazy-load HTML |
| Hosting model | Direct local file, static hosting, GitHub Pages, or CDN |
| License | Beerware |

## What It Shows

- Container structure: ISO BMFF box trees, WebM EBML elements, MP3 headers, Ogg pages, offsets, sizes, parsed fields, and warnings
- QuickTime/Android private metadata: selected text, GPS, Samsung `smta` child atoms, and raw hex payload previews for unknown private boxes
- Track summaries: codec, handler/type, duration, timescale, dimensions, sample counts, audio configuration, and codec configuration
- Sample/frame rows: index, track, type, offset, size, DTS, PTS, duration, sync/keyframe state, NAL/OBU tags, chunks, and fragments where available
- Visual analysis: frame-size graph, bitrate moving average, FPS moving average, largest samples, and fragment timing
- Selected-frame internals: codec-syntax-derived AVC partitions, HEVC CTU roots, VP9 keyframe partitions, AV1 superblock roots, optional source-frame overlay, and exact frame-level sample bits
- Playback-assisted navigation: selecting frame/fragment rows can seek the preview player when browser playback supports the file
- Large tables: recycler-style grids keep DOM size bounded for high sample counts
- Background analysis: frame-internals parsing uses a dedicated eight-Web-Worker pool; the selected frame and up to seven nearby samples can be parsed without blocking the UI thread

## What It Is Not

This is not a transcoder, decoder, repair tool, or compliance validator.

- It does not decode video frames into pixels or audio frames into PCM samples.
- Exact detail is syntax-dependent. Progressive AVC I, P, and B slices in the implemented CAVLC/CABAC subset and independent VP9 Profile 0 keyframes can expose syntax-signalled child partitions. AVC SP/SI slices, interlaced pictures, and unsupported syntax fall back to proven roots or report unavailable. HEVC currently exposes exact SPS-signalled CTU roots; AV1 exposes exact superblock roots only when the frame uses the sequence dimensions without super-resolution. VP9 inter-frame child syntax remains unavailable rather than being decoded with a reset context.
- It does not infer block partitions or bit allocation from decoded pixels. The source-frame overlay is only a visual background captured from the browser preview. No random, center-weighted, or area-distributed block bits are generated.
- CAVLC values are measured RBSP syntax lengths; shared `mb_skip_run` codewords remain unattributed overhead instead of being assigned to an arbitrary skipped block. CABAC values are decoder cursor consumption during renormalization, not a claim that an arithmetic-coded byte has a uniquely separable physical owner. HEVC, VP9, AV1, and root-only results leave per-block physical bits unavailable.
- It does not rewrite, transmux, optimize, or repair media files.
- It does not implement DASH/HLS manifest loading.
- It does not bypass DRM, encrypted media, browser CORS policy, or server range-request policy.
- It does not guarantee full recovery from malformed or truncated files.

## Use

Open `index.html` locally or use the GitHub Pages URL.

For local files:

1. Drop a media file anywhere in the window, or click `Open file`.
2. Inspect the summary, structure, tracks, frames, metrics, fragments, and warnings tabs.
3. Set preview playback speed in any of four linked ways: click a 0.25×, 0.5×, 1×, 1.25×, 1.5×, or 2× preset; drag the 0.1× to 5× slider; type a number directly; or press Up/Down in the number input to adjust by 0.01×. The selected rate is retained when another file is opened.
4. Use frame/fragment rows to seek the preview player when playback is available.
5. In the Frames tab, select an AVC, HEVC, VP9, or AV1 row to inspect the exact syntax coverage available for that sample. Enable `Overlay source frame` to align the parsed boundaries with the browser-decoded preview frame.
6. Export JSON or CSV when you need a durable analysis artifact.

For hosted validation samples:

- The sample selector is shown only when the app is served through HTTP/HTTPS and bundled samples can be fetched.
- The selector is hidden for direct `file://` usage because browsers generally block relative sample loading from local files.

For remote URLs:

- Use `Load URL` from the app toolbar.
- Files up to 4 MB are downloaded once and reused through a Blob URL for both analysis and playback.
- Larger files use script-driven HTTP range reads for analysis when the server and CORS policy allow it.
- The preview player uses native `preload="metadata"` for remote URLs. Browsers do not expose a precise "first frame only" preload mode, so the browser may fetch metadata and a small initial media range.

## Supported Formats

| Format | Structure | Samples/Packets | Frame Type | Notes |
| --- | --- | --- | --- | --- |
| MP4/MOV | Box tree and parsed sample tables | Yes | AVC/HEVC slice headers; AV1 OBU headers/light frame-header bits | Includes `ftyp`, `moov`, `trak`, `stbl`, `mdat`, `uuid`, `av1C`, and many common media boxes |
| fMP4 | `moov`/`mvex`, `moof`/`traf`/`trun`, fragment timing | Yes | AVC/HEVC slice headers; AV1 OBU headers/light frame-header bits | Expects init data and fragments in the same analyzed resource |
| WebM | EBML hierarchy, tracks, clusters, blocks | Yes | VP9 keyframe partition syntax; AV1 OBU and fixed-size superblock roots | Stateful VP9 inter frames and AV1 entropy partitions fail closed |
| MP3 | ID3 detection and MPEG audio frame scanning | Yes | Not applicable | Audio metadata and frame rows only |
| Ogg Opus | Ogg pages, lacing, Opus identification | Packet-level rows | Not applicable | Opus packets are parsed structurally, not decoded |

The selected-frame internals panel follows a truth-only policy. AVC roots are 16x16 macroblocks, HEVC roots come from the SPS CTU size, and VP9/AV1 roots come from their frame and sequence syntax. A child tree is shown only after the parser traverses that syntax completely. Visible edge clipping affects the map and source-frame alignment, while intrinsic coded block dimensions remain unchanged for statistics. Track rotation and pixel aspect ratio are display transforms only.

The selected sample's `size * 8` is always an exact frame-level total. Per-block values appear only for supported AVC syntax and are labelled by their accounting method; the analyzer never spreads the remaining sample bits over cells. Header, alignment, or shared arithmetic-coder consumption that cannot be assigned safely stays unattributed. Audio-band allocation is not synthesized. Remote media can make the optional source-frame overlay unavailable when browser CORS/canvas-taint rules block pixel reads.

Frame-internals work is isolated from the GUI in a fixed pool of eight Web Workers. Cancellation terminates active parsing workers, invalidates their request epoch, and cannot immediately restart the cancelled selection; worker restart is bounded. Only minimal codec track descriptors are cloned into the pool. Syntax-tree normalization, SVG path batching, and hover-index construction also run in the worker. The main thread receives no raw NAL summaries or object tree: hover data arrives in seven transferable typed buffers, and each SVG path contains at most 2,048 cells. Results use a bounded 32-frame and 200,000-display-record LRU-style cache; each decoded structure preserves every root unit within the 100,000-record parser output ceiling before retaining child detail. Active drag or pinch gestures defer synchronized frame-map replacement until the interaction ends.

## Privacy And Network Model

Local files stay local. The browser grants the page a `File`/`Blob` handle, and the app reads only the ranges it needs with `slice()` and `arrayBuffer()`.

Remote URLs are different because the app must fetch bytes from the remote server:

- Remote media requires browser CORS permission. If CORS blocks `HEAD`, `GET`, or `Range` requests, the app cannot analyze that URL.
- Range analysis needs a server that returns `206 Partial Content`. Reliable size detection depends on `Content-Length` or `Content-Range`; cross-origin servers may need to expose `Content-Range`.
- Header and metadata probes use a 4 KB small-range cache to avoid both tiny per-box requests and early 4 MB downloads.
- Larger sample and payload reads use a 4 MB range cache with a 64 MB LRU cap.
- For remote files over 4 MB, the analyzer and native media player cannot share the browser media element's private network buffer.
- The preview player uses `preload="metadata"` rather than `preload="none"` so the first visible frame or nearby initial chunk can become available when the browser chooses to fetch it. This can add small native media requests before playback.
- If the user later plays or seeks a large remote preview, the browser may issue additional media requests.
- Source-frame overlays are captured from the preview element. Local files normally work; remote files require the browser to permit canvas reads from that media response.
- `Response.blob()` is only available after a full download completes. Partial response chunks cannot become a normal Blob-backed `<video>` source before the full resource is loaded.
- MediaSource-based reuse is not implemented because it would require a separate segmenting and playback pipeline and would not cover all supported inputs uniformly.

## Security

This project parses untrusted media bytes in the browser. The local-first model avoids server uploads for local files, but parser bugs, malformed binary input, excessive CPU/memory use, and metadata injection issues are still possible.

Please do not publish exploit details, malicious samples, or crash repro payloads in public issues. Use GitHub private vulnerability reporting or another private maintainer contact path when available. If no private channel is available, open a minimal public issue that says security contact is needed, without attaching exploit details.

See [SECURITY.md](SECURITY.md) for scope and reporting guidance.

## Architecture

The source is split so new containers and codecs can be added without coupling everything to MP4-specific code.

```text
src/
  app.js                         build entry
  index.html                     source HTML shell
  js/
    main.js                      browser bootstrap
    core/
      analyzer-core.js           public analyzer facade
      common/                    binary readers, bitstream helpers, formatting
      containers/                pluggable container analyzers
        isobmff/                 MP4/fMP4/MOV parser
        webm/                    WebM/Matroska parser
        mp3/                     MP3 parser
        ogg/                     Ogg/Opus parser
      codecs/
        registry.js              codec descriptor registry
        frame-internals.js       actual-only selected-frame block visualization models
        audio/                   AAC, MP3, Opus
        video/                   AVC, HEVC, AV1
    i18n/                        English/Korean catalogs and descriptions
    samples/                     hosted sample manifest
    ui/                          rendering, data grids, filters, playback, exports
      box-detail-model.js        box detail field separation and synthetic stsd children
      frame-internals-map.js     batched vector block paths and spatial hover lookup
      frame-internals-view.js    selected-frame block structure and accounting rendering
      frame-internals-worker-result.js  transferable render-model preparation
      json-viewer.js             collapsible JSON/hex field viewer
      media-row-model.js         reusable sample timing and ordering helpers
      metrics-model.js           bitrate/FPS/sample metric calculations
      media-source.js            shared local/remote media preview and download policy
      remote-loader.js           remote URL probing, range capability checks, downloads
    worker/                      main analyzer worker plus the eight-worker frame-internals protocol
tests/                           node:test coverage for core, containers, UI models/helpers
tools/                           build, verification, and sample-check scripts
validation/generated/            generated validation media used by tests and Pages samples
```

Design boundaries:

- Container analyzers produce normalized tracks, samples, fragments, warnings, and structure nodes.
- Codec modules expose interchangeable parser/scanner functions through a registry.
- UI code consumes normalized analysis models rather than container-specific internals where possible.
- Local files and remote URLs share media-source policy for preview setup and small-file download reuse; remote-loader only handles network probing and download mechanics.
- Heavy parsing and sample scanning should stay out of direct DOM rendering paths.
- Final deployable artifacts remain static files that can be hosted on GitHub Pages.

## Build Outputs

```powershell
npm install
npm run build
```

| Output | Purpose |
| --- | --- |
| `mp4-analyzer.html` | Readable single-file HTML for inspection and debugging |
| `index.html` | Minified single-file HTML and GitHub Pages entry point, without inline source maps to keep the file small |
| `chunked/index.html` | Minified shell for the chunked lazy-load build |
| `chunked/assets/` | Minified ESM chunks, worker bundle, CSS, and JavaScript source maps |

Build scripts:

```powershell
npm run build          # single-file and chunked builds
npm run build:single   # only mp4-analyzer.html and index.html
npm run build:chunked  # only chunked/index.html and chunked/assets/
```

The chunked build keeps the first app load small. It loads the analyzer runtime after a file or sample is opened, then dynamically imports only the needed container and codec modules. For example, opening an MP4 does not load WebM/Ogg/MP3 analyzers, and scanning an AVC file does not load the HEVC scanner.

Source maps are emitted for the chunked `.mjs` assets as separate `.map` files. The minified single-file `index.html` intentionally omits inline source maps because embedding app and worker maps inside the page can make the minified output larger than the readable build.

## Test And Validation

```powershell
npm test
npm run test:coverage
npm run verify:samples
npm run verify:frame-internals
npm run verify:ui
npm run verify
```

`npm run verify` runs the full local verification chain: build, unit/integration tests, sample verification, FFmpeg/FFprobe frame-internals reference verification, and UI smoke verification. The frame-internals reference step requires `ffmpeg` and `ffprobe` on `PATH`; neither tool is a browser runtime dependency.

Validation samples live under `validation/generated/` and are exposed by the GitHub Pages build when available. They intentionally remain ordinary repository files because GitHub Pages does not serve Git LFS files as normal static sample assets.

The catalog includes a moving high-detail AVC patch used to compare JavaScript macroblock type/QP output with FFmpeg, a 5-second 4K HEVC sample used to verify the 60x34 CTU root grid, and compact VP9/AV1 fixtures for exact-only partition/root regression checks. `npm run verify:frame-internals` checks every video frame in every git-tracked sample except the explicitly excluded 10,020-frame stress sample. Reproduction commands, current comparison counts, and interpretation limits are documented in [`validation/README.md`](validation/README.md).

Current coverage snapshot from `npm run test:coverage`:

- Tests: 107 passed, 0 failed
- All files: 89.30% line coverage, 79.77% branch coverage, 94.04% function coverage
- Strong coverage areas: binary readers, HTTP range readers and range failures, remote URL fallback/progress/abort handling, shared media-source preview/download policy, playback-rate normalization and preset matching, eight-worker frame-internals scheduling and cancellation, bitstream helpers, formatting edge cases, AAC/MP3/Opus parser branches, MP3 ID3v2/ID3v1/Info frame handling, H.264 I/P/B macroblock syntax/geometry/edge clipping, display-matrix rotation, HEVC CTU roots, VP9 partition syntax, AV1 superblock roots, batched vector block rendering, stable frame-internals interaction wiring, spatial hover lookup, codec registry, i18n, data grid/recycler helpers, UI box-detail/json-viewer/frame-internals/media-row/metrics model boundaries, ISO BMFF sample modeling, ISO BMFF rare/private box parsing, WebM Xiph/fixed/EBML lacing, source-map build wiring, and bundled sample container integration
- Lower branch coverage remains mainly in the separately executed FFmpeg validation CLI, browser-worker runtime branches, uncommon or unsupported codec syntax, and malformed/edge container branches such as oversized/invalid MP4 boxes, Ogg page edge cases, uncommon WebM element variants, and recycler/remote UI fallback paths that require live browser event timing

## Contribution Policy

This project accepts bug reports, feature requests, parser regressions, and reproducible test cases through GitHub Issues.

Pull requests are not accepted at this time. The maintainer implements and commits all code changes directly to keep the parser architecture, validation samples, generated build artifacts, and GitHub Pages output consistent.

Helpful issues include:

- sample media file, public URL, or minimal ffmpeg reproduction command
- browser and OS information
- expected result vs actual result
- exported JSON, console logs, screenshots, ffprobe output, or MediaInfo/MP4Box comparison when relevant
- whether the issue affects local files, remote URLs, hosted samples, or all input paths

Use the parser-regression issue form when sample counts, offsets, frame types, fragment timing, block internals, or metrics disagree with a known-good reference. Use the feature-request form for new containers, codecs, visualizations, exports, or workflow changes.

## Export Model

JSON export is intended to be stable enough for debugging and regression comparison, but not a formal public API yet. The core records are:

- `BoxNode` / structure node: `type`, `path`, `offset`, `size`, `headerSize`, `children`, `fields`, `warnings`
- `TrackSummary`: `trackId`, `handlerType`, `codec`, `timescale`, `duration`, dimensions/audio settings, sample count, codec configuration
- `SampleRow`: `trackId`, `sampleIndex`, `offset`, `size`, `dts`, `pts`, `duration`, `isSync`, `frameType`, `nalTypes`, `chunkIndex`, `fragmentIndex`, `warnings`
- Fragment rows: fragment index, file offsets, sample range, byte range, start/end time, and warnings

Large integer offsets and sizes are kept safe for UI/export by preferring string representations when a number may exceed JavaScript's safe integer range.

## Development Notes

- Keep source changes in `src/`; root HTML files are build outputs.
- Keep manual app behavior in the browser APIs available to static pages: `File`, `Blob.slice()`, `ArrayBuffer`, `DataView`, `fetch`, `Worker`, and standard DOM APIs.
- Keep new format support pluggable: add a container analyzer under `src/js/core/containers/` or a codec module under `src/js/core/codecs/audio/` or `src/js/core/codecs/video/`.
- Keep rendering reusable through shared UI helpers and data-grid components so tabs do not diverge in layout behavior.
- Keep large-file behavior range-based and cancellable.
- Add validation samples and tests when fixing parser regressions.
- Keep frame-internals math based on intrinsic codec block dimensions. Treat orientation and pixel aspect ratio as display transforms only.
- Treat source-frame overlay as a preview-only visual aid. Do not use decoded pixels as a substitute for container or codec syntax parsing.
- Rebuild after source changes so `mp4-analyzer.html`, `index.html`, and `chunked/` stay aligned.

## Related Projects

This project is intentionally smaller and more specialized than mature media tools:

- MP4Box.js demonstrates progressive MP4 parsing, sample extraction, and browser demos for file inspection.
- mediainfo.js demonstrates browser-compatible media metadata extraction through WebAssembly.
- CyberChef is a useful reference for clear client-side privacy messaging and local/offline browser-tool positioning.

## License

Standalone Web Media Analyzer is licensed under the [Beerware License](LICENSE). Retain the license notice, do what you want with the project, and buy the maintainer a beer if you meet someday and think the project was worth it.
