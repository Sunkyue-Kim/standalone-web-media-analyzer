# Validation Media

Files under `validation/generated/` are ordinary GitHub Pages assets and parser regression fixtures.

## Moving high-detail AVC patch

`avc_moving_detail_patch.mp4` is a 5-second, 1280x720, 30 fps AVC sample. A 192x192 high-frequency patch moves over a nearly flat background. Its first frame is also the reference fixture for the H.264 frame-internals grid.

FFmpeg's H.264 decoder exports one `AVVideoBlockParams` entry per 16x16 macroblock for this frame. The 1280x720 image therefore has an 80x45 grid, or 3,600 macroblocks. The JavaScript model must return the same count and geometry, including visible-edge clipping when a frame dimension is not divisible by 16.

Render FFmpeg's decoder-exported boundaries for a visual comparison:

```powershell
ffmpeg -y -hide_banner -loglevel warning -export_side_data +venc_params -i validation/generated/avc_moving_detail_patch.mp4 -vf 'select=eq(n\,0),codecview=block=1' -frames:v 1 avc-frame-0-ffmpeg-blocks.png
```

Inspect FFmpeg's decoder diagnostics when the macroblock count or QP range needs an independent textual check:

```powershell
ffmpeg -hide_banner -threads 1 -debug 'mb_type+qp' -i validation/generated/avc_moving_detail_patch.mp4 -frames:v 1 -an -f null NUL
```

`AVVideoBlockParams` provides geometry and `delta_qp`; it does not provide a per-block encoded bit count. The native JavaScript parser independently traverses the implemented progressive I-, P-, and B-slice CAVLC/CABAC syntax. For this fixture's first frame, FFmpeg reports 3,454 `I_16x16` and 146 `I_NxN` macroblocks with QP 3 through 34; JavaScript resolves those 146 roots into 96 `I_4x4` and 50 `I_8x8` roots with the same QP range.

`1000024017.mp4` independently checks a rotated Android AVC stream. FFprobe reports the ISO BMFF display matrix as `rotation=-90`; the intrinsic top-left macroblock therefore appears at the display's top-right, not bottom-left. For sample 2, FFmpeg's `-debug mb_type` map reports 1,962 `S` skip roots, 1,530 `>` 16x16 roots, 36 `>-` 16x8 roots, 43 `>|` 8x16 roots, 27 `>+` 8x8 roots, and 2 intra roots. The JavaScript CABAC walker is regression-tested against those exact 3,600 macroblock classes and expands their actual partitions.

```powershell
ffprobe -v error -export_side_data +venc_params -select_streams v:0 -show_frames -read_intervals "%+#2" -show_entries frame=pict_type:frame_side_data -of json validation/generated/1000024017.mp4
ffmpeg -hide_banner -threads 1 -debug mb_type -i validation/generated/1000024017.mp4 -frames:v 2 -an -f null NUL
```

CAVLC block values are exact RBSP syntax lengths. A shared `mb_skip_run` codeword describes a run rather than one macroblock, so it remains unattributed overhead. CABAC block values are the raw decoder-cursor consumption observed while the block's bins renormalize the arithmetic decoder; prefetch, termination, and trailing data remain unattributed. They must not be described as a uniquely separable physical contribution from that block. Unsupported SP/SI, interlaced, or otherwise unimplemented syntax is never filled with synthetic partitions or bits.

```powershell
ffmpeg -y -f lavfi -i "color=c=0x243447:s=1280x720:r=30:d=5" -f lavfi -i "testsrc2=s=192x192:r=30:d=5" -filter_complex "[0:v]format=yuv420p[background];[1:v]noise=alls=80:allf=t+u,eq=contrast=1.45:saturation=1.35,drawbox=x=0:y=0:w=iw:h=ih:color=white@0.9:t=3[detail];[background][detail]overlay=x='40+(W-w-80)*t/5':y='(H-h)/2+180*sin(2*PI*t/2.5)':shortest=1,format=yuv420p[video]" -map "[video]" -c:v libx264 -preset veryfast -crf 20 -pix_fmt yuv420p -g 30 -keyint_min 30 -bf 2 -x264-params "scenecut=0" -movflags +faststart -an validation/generated/avc_moving_detail_patch.mp4
```

## 4K HEVC

`hevc_4k_5s.mp4` is a 5-second, 3840x2160, 24 fps HEVC Main sample with 64x64 CTUs, a fixed 24-frame GOP, and B-frames.

The retained SPS gives a 64x64 CTU size and a 60x34 raster: 2,040 exact root CTUs, with 48 visible pixels in the last row. FFmpeg `trace_headers` is the independent reference for these SPS values and WPP entry-point metadata. The current native parser deliberately stops at this root grid because its experimental CABAC child traversal did not match FFmpeg's substream boundaries; CU/PU/TU children and per-block bits are therefore `n/a`, not estimated.

```powershell
ffmpeg -hide_banner -i validation/generated/hevc_4k_5s.mp4 -c:v copy -bsf:v trace_headers -an -f null NUL
```

```powershell
ffmpeg -y -f lavfi -i "testsrc2=s=3840x2160:r=24:d=5" -c:v libx265 -preset ultrafast -crf 28 -pix_fmt yuv420p -tag:v hvc1 -g 24 -keyint_min 24 -bf 2 -x265-params "keyint=24:min-keyint=24:scenecut=0:bframes=2:pools=8:ctu=64:min-cu-size=8" -movflags +faststart -an validation/generated/hevc_4k_5s.mp4
```

## VP9 and AV1

`webm_vp9_opus.webm` supplies an independent VP9 Profile 0 keyframe. The JavaScript range decoder traverses its complete keyframe partition syntax and verifies non-overlapping coverage of the visible 320x180 frame. Physical per-block bits remain unavailable because Boolean arithmetic-coded bytes do not have unique block boundaries. Probability self-information may be retained as parser diagnostics but is never presented as physical block bits. Stateful inter frames fail closed instead of reusing an incorrect default context.

`av1_mp4.mp4` and `webm_av1.webm` verify 64x64 superblock roots for a 160x90 frame. The root grid is exposed only when the uncompressed frame header confirms sequence dimensions and the sequence disables super-resolution. Frame-size overrides, `show_existing_frame`, and entropy-coded child partitions remain unavailable.

Use `ffprobe` to cross-check container dimensions, codec identity, and keyframe flags without making it a runtime dependency:

```powershell
ffprobe -v error -select_streams v:0 -show_streams -show_frames -read_intervals "%+#2" validation/generated/webm_vp9_opus.webm
ffprobe -v error -select_streams v:0 -show_streams -show_frames -read_intervals "%+#2" validation/generated/av1_mp4.mp4
```

## All-frame reference verification

Run the external reference verifier after rebuilding the standalone output:

```powershell
node tools/build.cjs
node tools/verify-frame-internals.cjs
```

The verifier discovers git-tracked video samples and excludes only `avc_10020.mp4`, the requested 10,020-frame stress fixture. It matches FFprobe decoded frames back to parsed samples, checks every exact `sample size * 8` total, rejects synthetic block fields, and applies the strongest available independent comparison for each codec.

The current fixture set covers 10 files and 2,046 video frames. AVC I/P/B traversal is complete for all 1,164 included AVC frames. FFmpeg `-debug mb_type` supplies independently decoded prediction and root-partition characters; 6,666,363 comparable macroblock fields match exactly. FFmpeg derives the partition shape of 588,837 B-direct/skip roots from reference-frame state, so those specific partition characters are reported as unavailable rather than counted as matches. CAVLC/CABAC child geometry is then checked for bounds, complete syntax consumption, and non-synthetic bit accounting.

FFmpeg does not export comparable child trees for the remaining codecs. `trace_headers` independently verifies HEVC SPS dimensions/CTU size and AV1/VP9 sequence dimensions/root size. The result report therefore labels HEVC's 804 frames as exact-root-only, AV1's two 15-frame fixtures as 9 coded root frames plus 6 `show_existing_frame` samples each, and VP9 as 2 decoded keyframe trees plus 46 fail-closed inter frames. None of those unavailable child trees is reported as an FFmpeg match.
