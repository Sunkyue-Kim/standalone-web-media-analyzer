# Agent Guidelines

These instructions are project-specific context for LLM coding agents. They capture decisions made during product iteration that are not fully obvious from the source code alone.

## Product Intent

- This project is `standalone-web-media-analyzer`. Do not use old project names or old output names in new docs, UI, or scripts.
- The app is a local-first browser media inspection tool, not a media player, encoder, decoder, or server-backed analysis service.
- The final distributable must always be standalone HTML. Network services, CDN assets, runtime npm packages, external icons, remote fonts, and hosted parsers are out of scope for the app runtime.
- Large files must be handled by chunked reads and targeted byte ranges. Do not introduce code paths that eagerly read full `mdat`-style media payloads when metadata or sample ranges are sufficient.
- Prefer parser accuracy and inspectability over broad but shallow format support. When a format is supported, expose useful metadata, warnings, and sample rows rather than only a file-level summary.

## Build Artifacts

- Edit `src/` first. Root-level `index.html` and `mp4-analyzer.html` are build outputs and must not be manually edited as the source of truth.
- Run the build pipeline after source changes that affect the app:
  - `mp4-analyzer.html` is the readable single-file build.
  - `index.html` is the minified single-file build and GitHub Pages entry point.
- Do not recreate `mp4-analyzer.min.html`; the minified output is intentionally `index.html`.
- Keep source split into maintainable modules even though outputs are single HTML files.
- The source HTML at `src/index.html` is a template for the build pipeline. It is not required to be directly usable from `file://` as a development entry point.
- The single-file minified `index.html` must not inline source maps. Chunked builds may emit separate `.map` files under `chunked/assets/`.
- Chunked asset filenames are content-hashed. When a build changes hashes, commit the deleted old assets, the new assets, and the updated `chunked/index.html` together.

## Architecture

- Keep container parsing and codec parsing pluggable.
- Container analyzers belong under `src/js/core/containers/<container>/`.
- Codec logic belongs under `src/js/core/codecs/audio/` or `src/js/core/codecs/video/`, with shared registry behavior in `src/js/core/codecs/registry.js`.
- Do not add codec-specific public API names when a common descriptor/scanner interface can express the same behavior. Prefer interchangeable functions and descriptor objects selected by codec identity.
- Use `codecConfig` as the normalized track-level codec configuration field. Do not preserve legacy `avcConfig` or `hevcConfig` compatibility unless explicitly requested later.
- Keep UI-only helpers in `src/js/ui/`, shared parser/binary/time/formatting helpers in `src/js/core/common/`, and format-specific interpretation in the matching container or codec module.
- When adding a new container, return the same analysis shape used by existing containers: boxes/nodes where applicable, tracks, sample rows, warnings, and enough timing/offset data for table, graph, and metrics views.

## Format Support Scope

- ISO BMFF support includes MP4, fMP4, and MOV-style files. Preserve box tree, track, sample, chunk, fragment, and warning views.
- AVC and HEVC frame type scanning should inspect sample payload NAL units when available.
- AV1 frame type scanning should inspect OBU/frame-header metadata where the existing lightweight parser can do so without becoming a full decoder.
- AAC, MP3, Opus, ProRes, VP9, and unknown codecs may expose metadata and sample rows even when detailed video frame type parsing is not possible.
- WebM/Matroska, MP3, and Ogg Opus support are first-class enough to appear in samples, metrics, frames, and warnings. Do not treat them as MP4 box variants.
- Box or node explanations should be registered for every supported container family where the UI shows structure. Avoid MP4-only wording for WebM, Ogg, or MP3 structures.

## UI And UX Rules

- The interface should feel like a quiet desktop analysis tool, not a landing page.
- There is no permanent drop zone. Dragging a media file over the window should show a temporary fullscreen drop hint. Plain text dragging must still behave normally.
- The media preview/player belongs between the top toolbar and the tabbed pane. It must not be rendered inside Summary.
- Keep the top toolbar and tabbed pane stable across content changes. Tab selection should not jump because a tab has more or less content.
- The sample selector is only useful where sample files can be fetched. Hide the sample label and selector entirely for `file://`; show it only for HTTP/HTTPS-style contexts where bundled samples can load.
- The app must be bilingual. Any new visible UI string, aria label, placeholder, warning label, tab, column, or button text must be added to both English and Korean i18n catalogs.
- When changing layout, verify narrow, middle, and wide widths. Do not solve a narrow-screen issue by hiding analysis information unless the user explicitly asks for a compact mode.

## Frames View

- Preserve both frame table and frame graph views.
- Frame table rows and graph rows are clickable across the whole row and should seek the preview player to that frame or sample time when possible.
- The frame table must always show the same information regardless of viewport width. Use horizontal scrolling for narrow screens; do not hide columns at mobile breakpoints.
- The preferred frame table column order is:
  `Index`, `Track`, `Type`, `Offset`, `Size`, `DTS`, `PTS`, `Duration`, `Sync`, `NAL`, `Chunk/Frag`.
- The vertical frame-size graph uses time/sample order vertically and byte size horizontally. Frame type color is part of the graph meaning and should remain clear.

## Frame Internals View

- Frame internals are an inspection aid, not a decoder. Be explicit when a value is estimated, nominal, or derived from lightweight syntax parsing.
- Keep all numeric block statistics based on intrinsic codec block dimensions. Cropping at display edges must not change block-size or byte-density statistics.
- Apply track rotation and pixel aspect ratio only as display transforms for the block map and source-frame alignment.
- Partition depth statistics should describe the partition model tree across depths, not only the final rendered leaf cells.
- The optional source-frame overlay is a visual background captured from the preview element. Do not use decoded pixels to infer block structure or byte allocation.
- Source-frame overlay must remain optional and gracefully unavailable when browser CORS/canvas-taint rules prevent reading remote media pixels.
- Preserve zoom/pan state across selected frames so users can inspect the same region over time.
- Do not create one DOM/SVG element or serialized tooltip payload per block for large heatmaps. Keep vector cells batched into a bounded number of paths and resolve hover details through the spatial index.
- The frame-internals cell budget is currently 100,000. Preserve intrinsic coding-unit roots before spending the remaining budget on estimated partition expansion, and keep performance tests representative before raising it again.
- Playback-synchronized frame updates must not interrupt an active heatmap drag or pinch. Keep pointer capture and interaction state on the stable frame-internals container rather than on SVG content replaced by frame rendering.

## Metrics View

- Metrics must allow selecting any parsed track, including audio tracks. If video tracks exist, default selection may prefer video, but the dropdown must still include audio tracks such as Opus.
- Bitrate/FPS/sample-rate charts should support a configurable moving-average sample window.
- Axis labels must render as normal readable text. Do not put axis text inside a stretched SVG that uses `preserveAspectRatio="none"`, because the text becomes distorted.
- When adding metric charts, keep labels, grid, and plotted data visually aligned at desktop and mobile widths.

## Samples And Validation

- Validation samples under `validation/generated/` are not runtime dependencies, but they are part of the expected local and GitHub Pages demo workflow.
- Hosted builds may expose bundled validation samples for selection. Local `file://` builds should hide the sample selector because browser fetch restrictions commonly block those relative files.
- When adding or changing format support, add or update generated samples where practical and verify at least the representative bundled samples.
- Use `ffmpeg` and `ffprobe` for generated media and cross-checks when validating parsing behavior.
- Keep code-level UI tests for regressions that browser automation may miss or cannot run in this environment.

## Remote Loading And Preview

- Remote URL support must be best-effort and capability-driven. Prefer range streaming only when CORS, size detection, and `206 Partial Content` behavior are verified.
- For remote media up to 4 MB, full-download once and share the resulting Blob between analysis and preview to avoid duplicate traffic.
- For larger remote media, do not assume the analyzer can reuse the native media element's private network buffer. Document or warn when analysis and playback may issue separate requests.
- Header probing should use a small minimum request size, currently 4 KB, rather than tiny per-box requests or an eager multi-megabyte first fetch.
- Keep local-file and remote-URL preview behavior behind shared media-source policy helpers so preload and Blob URL behavior do not diverge silently.

## Verification Expectations

- For app behavior changes, run the build before final verification so root HTML outputs match `src/`.
- Preferred local verification chain:
  - `npm run build`
  - `npm test`
  - `npm run verify:samples`
  - `npm run verify:ui`
  - `git diff --check`
  - Confirm `index.html` and `mp4-analyzer.html` do not contain external script/link runtime dependencies.
- If a visual change is made, try to verify in the in-app browser. If browser automation is unavailable, add or update code-level regression checks and state the limitation clearly.
- Keep README coverage data current when tests or coverage expectations materially change.

## GitHub Pages And Repository

- The public repository name is `standalone-web-media-analyzer`.
- GitHub Pages serves the minified `index.html` from the repository root.
- After changes intended for the hosted app, commit and push to `main`, then confirm the latest GitHub Pages build succeeds.
