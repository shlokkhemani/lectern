# Render calibration (§10.3) and render-path speed

16 Nov 2026, Apple M4 Pro, 14 cores, ffmpeg 9.0.1, chrome-headless-shell 157.0.8103.50 (pinned). Every number is
at 1920×1080. An earlier pass ran at 1280×720 by mistake (see "Correction") and is superseded.

**The machine was heavily shared** with Xcode builds, an iOS simulator and other lanes' Chrome tests. The load
average was 30–206 on 14 cores, so wall times are pessimistic and noisy (up to ±30%). **CPU-seconds** are the
load-independent measure. Divide them by 14 for an idle-machine floor.

Measured with bench scripts since removed (they drove the hand-built v5 page); the numbers stand. The real
path's per-stage timings: `bun bench/render-e2e.ts`.

## Locked values
| what | value | where |
|---|---|---|
| capture format | **PNG** (lossless) | `src/render/capture.ts` `CAPTURE` |
| encoder | **libx264 `-preset superfast -crf 16 -g 300 -bf 0`**, VFR (one frame per capture, held for its run), yuv420p BT.709 tv, tagged | `src/render/encode.ts` `ENCODER` |
| capture chunk | 32 captures per pool job | `stage.ts` `CHUNK` |
| pool | **6 pages, 2 per browser process** (3 Chrome processes) | `src/render/stage.ts` `POOL_SIZE`, `PAGES_PER_BROWSER` |
| encodes in flight | 3 (x264 threads automatic) | `stage.ts` |
| narration AAC | `aac -aac_coder fast -b:a 128k` (exact end trim; see §7) | `src/render/narration.ts` `AAC` |
| Chrome flags added | `--force-device-scale-factor=1.5 --disable-frame-rate-limit --disable-gpu-vsync --disable-partial-raster` | `src/render/chrome.ts` |

**VideoToolbox (rulings §8) is rejected on the data.**
- It is slower. `h264_videotoolbox` tops out near 180 fps in aggregate on this machine, and parallel sessions do not
  add throughput: 1 session gives 150 fps, 2 give 175, 4 give 182, 8 give 170. Part 8 is 13–16k frames, so
  VideoToolbox alone needs 75–90 s. On the hand-built part 8 it took 80 s, against 34–55 s for x264 under the same load.
- It is worse in quality at every Q tested (§1). It does save CPU (125 against 230 CPU-s), but its throughput cap
  makes that irrelevant.

## 1. Quality: 10 text-heavy frames at 1080p
Frames: the theme v2 specimen (main, dim, held, bullets: near-black, coloured syntax) and 6 frames of the hand-built
part 8. Each candidate is a 150-frame clip (each image held 15 frames) through the production filter chain. It is
compared with the *ideal*: the source PNG through the same BT.709/tv/4:2:0 conversion, uncompressed, so the numbers
isolate what capture format and codec add.

- SSIM-Y: the minimum over all 150 frames.
- ΔE: CIE76 over chroma-edge pixels (C* > 20 beside a luminance step), on the first frame of each hold, where content
  changes. The table gives the mean over the 10 frames and the worst p99.

| capture → encoder | SSIM-Y min | ΔE mean | ΔE p99 | 150-frame clip |
|---|---|---|---|---|
| **PNG → x264 crf16 medium (reference)** | 0.99911 | 1.72 | 8.6 | 706K |
| PNG → VideoToolbox q55 | 0.99397 | 9.17 | 31.7 | 350K |
| PNG → VideoToolbox q65 | 0.99676 | 6.60 | 23.9 | 438K |
| PNG → VideoToolbox q75 | 0.99822 | 3.89 | 15.2 | 594K |
| JPEG92 → VideoToolbox q75 | 0.99832 | 5.52 | 20.6 | 705K |
| **PNG → x264 crf16 superfast (locked)** | **0.99910** | **2.43** | **11.7** | 812K |
| PNG → x264 crf16 ultrafast | 0.99884 | 1.95 | 9.3 | 1621K |
| PNG → x264 crf16 veryfast stillimage | 0.99888 | 3.22 | 15.0 | 613K |
| JPEG98 → x264 crf16 superfast | 0.99940 | 3.52 | 14.2 | 841K |
| JPEG92 → x264 crf16 superfast | 0.99797 | 4.89 | 18.6 | 977K |
| JPEG85 → x264 crf16 superfast | 0.99531 | 6.69 | 24.6 | 1000K |

Reading:
- **JPEG costs chroma accuracy and buys no speed.** At 1080p a PNG screenshot takes 17.9 ms and a JPEG92 one 19.2 ms.
  JPEG92 adds about 2.5 ΔE on chroma edges (the yellow and green syntax on near-black) and JPEG85 about 4.3. The
  spec's default candidate (JPEG q92) is rejected.
- **x264 superfast matches the reference on SSIM** (0.99910 against 0.99911). Its chroma-edge ΔE is +0.7 over the
  reference. A 200% crop of the theme's code field (`crops/ideal.png`, `crops/png__x264-crf16-medium.png`,
  `crops/png__x264-crf16-superfast.png`) shows no visible difference.
- Ultrafast has slightly better ΔE but lower SSIM, twice the bytes, and no measurable speed gain end to end.

## 2. Capture cost
- With default flags, a screenshot waits for the next vsync-paced frame: 39 ms at 720p. With
  `--disable-frame-rate-limit --disable-gpu-vsync` it took 8.7 ms at 720p and takes 17.9 ms (PNG) at 1080p.
  `--run-all-compositor-stages-before-draw` made it worse (50 ms), and hangs when combined with the two flags above.
- **One browser composites every page in one process,** so pages in one browser stop scaling near 180–216 fps
  (`evaluate` rises from 0.5 to 10 ms). Separate browser contexts do not help; separate browsers do. With 3 browsers
  × 2 pages it reached 304 fps at 720p, the best layout.
- **`--force-device-scale-factor=1.5` is required.** In headless shell, `setViewport({deviceScaleFactor: 1.5})` sets
  `devicePixelRatio` but captures stay 1280×720. A test now asserts 1920×1080.
- **`--disable-partial-raster` is required for determinism.** Without it, a scene drawn after other scenes differed
  from a fresh draw by 1 LSB in 12 bytes, on 3 of 3 runs, at the crossfade's first frame. With it, 3 of 3 runs were
  byte-identical.

## 3. Pool-size and encoder sweep (hand-built part 8 page, 1080p)
The page: 43 scenes, 13,273 frames, 2,064 captures (the old pipeline's capture rule).

| pool (pages per browser) | encoder | capture | wall s | CPU-s | load (1 min) |
|---|---|---|---|---|---|
| 2 (2) | superfast | PNG | 46.9 | 212 | 30 |
| 4 (2) | superfast | PNG | 33.7 | 232 | 48 |
| 6 (2) | superfast | PNG | 42.3, 55.0 | 231, 226 | 74, 137 |
| 8 (2) | superfast | PNG | 54.7 | 233 | 101 |
| 6 (1) | superfast | PNG | 45.5 | 244 | 119 |
| 6 (6) | superfast | PNG | 43.9 | 219 | 99 |
| 6 (2) | ultrafast | PNG | 45.8 | 206 | 122 |
| 6 (2) | superfast | JPEG92 | 33.6 | 214 | 106 |
| 6 (2) | **VideoToolbox q75** | PNG | **80.5** | 125 | 66 |

The path is CPU-bound. Pool size changes total CPU very little, and wall time follows the machine's load more than
the pool. I locked 6 pages over 3 browsers: it is the best layout in the capture micro-benchmark (§2) and no worse
than the others here. Encode concurrency (3, 4, 6, 8) and x264 thread caps made no difference beyond noise (720p
pass). Moving colour conversion ahead of `fps` cut decode and filter CPU about threefold.

## 4. Speed of the render path
**Baseline:** 187 s for the hand-built part 8 with audio cached (13,273 frames, 2,069 screenshots, libx264 medium).

| path | frames | captures | wall | CPU-s | idle floor (CPU/14) |
|---|---|---|---|---|---|
| hand-built part 8 page, production capture + encode + concat | 13,273 | 2,064 | 34–55 s (load 48–137) | ~230 | ~16 s |
| **`examples/part8.md`, real end to end** | 16,226 | 851 (5.2%) | **41.4 s, 46.2 s** (load 206) | **184** | **~13 s** |

The real end-to-end run covers parse (L1) → estimate voice → planScene → L2 page → lint → capture + encode →
narration + mux + .srt + HTML → sheets. Its stages (second run): open stage 0.83 s · lint 0.11 s · capture + encode
37.5 s · narration + mux + srt + html 1.8 s · sheets 1.1 s. Parse and plan are under 0.01 s each.

The estimate voice reads slower than real speech (541 s against 442 s), so a real-voice part 8 has about 18% fewer
frames.

**Where the CPU goes:** encoding the real part 8 serially costs **141 CPU-s** (CFR), which is 77% of the total. x264
spends about 8 ms of CPU per 1080p frame even when the frame repeats the one before, and 95% of frames do.

## 5. VFR segments (approved and implemented)
Each captured image is encoded once, as one frame whose duration is its hold. The segment time base is 1/30, so a
frame's presentation time is its plan frame index exactly.
- **No B-frames** (`-bf 0`). With reordering, MP4 sample durations follow decode order and the holds were wrong
  (a 42-frame test clip came out as 10). Without them every duration is exact.
- **The final hold is explicit.** A packet lasts one frame unless another follows it, so the last image is listed
  again on the scene's last frame.
- **Checked on every segment (R701):** packet PTS equal the plan's run starts, and duration_ts = frameCount.
- **Checked on the final MP4:** video duration_ts = Σ frameCount and packets = Σ planned; narration PCM =
  Σ totalSamples; audio and video durations within one frame; BT.709 tags carried through the stream copy.
- Tests: `test/render/encode.test.ts`, including the numbered-image test adapted to VFR (every displayed instant
  shows its planned image, with a 41-frame final hold).
- **Output:** `ftyp isom` (isom, iso2, avc1, mp41), `moov` first, H.264 High@4.0 yuv420p 1920×1080 BT.709 tv,
  AAC-LC 48 kHz mono. Video and audio are both 540.866667 s. A full decode is error-free. QuickTime Player opened it
  and played it: at 150 s it reported `playing=true`, `current time` 153.66 s four seconds later, duration 540.87 s,
  1920×1080.

### Part 8 end to end with VFR (estimate audio)
`examples/part8.md`: 16,226 frames, 851 captures. Load average 35–50 (other work still running: Xcode, a VM and
other apps). The table gives the best run and a run under more load.

| stage | wall s | CPU-s | wall s (busier) | CPU-s |
|---|---|---|---|---|
| parse | 0.05 | 0.1 | 0.06 | 0.1 |
| plan | 0.04 | 0.0 | 0.04 | 0.1 |
| open stage (bundle, 3 browsers, 6 pages ready) | 0.64 | 3.0 | 0.72 | 3.3 |
| lint | 0.13 | 0.9 | 0.15 | 1.0 |
| capture + encode | 9.24 | 55.8 | 16.06 | 59.3 |
| narration + mux + .srt + HTML | 1.76 | 2.4 | 2.19 | 2.5 |
| contact sheets | 1.15 | 2.7 | 1.22 | 3.0 |
| **total** | **13.05** | **65.0** | 20.48 | 69.3 |

Before VFR the same run took 184 CPU-s. Now encode is ~16 CPU-s (4.7 s serial) and Chrome capture is ~40 CPU-s
(about 47 ms of CPU per 1080p PNG capture with full raster). The idle-machine floor is ~65/14 ≈ 5 s. A long scene's
captures are now split into chunks of 32 across the pool, so one scene (270 captures) no longer serialises it.

## 6. Real builds (`bun src/cli.ts build examples/part8.md --force`)
Real voiced audio (430.9 s), 12,928 frames, 864 captures. Load average 16–30. The cold run used an empty voice
cache (`XDG_CACHE_HOME` pointed at a fresh directory). Times are from `build.json`, in seconds.

| stage | warm, before (e979f1f, CFR) | warm, now | cold, now |
|---|---|---|---|
| parse + motion | 0.02 | 0.02 | 0.02 |
| stage (bundle, browsers, pages) | 1.29 | 0.70 | 0.57 |
| lint (G2) | 0.17 | 0.10 | 0.13 |
| voice (overlaps the next row) | 0.16 | 0.09 | 18.53 |
| voice + capture + encode | 14.95 | 7.81 | 20.68 |
| export (narration, mux, .srt, HTML) | 6.82 | 1.83 | 1.82 |
| contact sheets | 1.10 | 1.04 | 0.94 |
| **total** | **24.5** | **11.6** (5 runs: 11.6–14.0) | **24.2** |

**Export.** 5.2 s of the old 6.8 s was a single-threaded AAC encode. Now:
- the encoder was AudioToolbox `aac_at -aac_at_quality 2` (0.96 s, against 4.1 s for ffmpeg's `aac`). It was
  **withdrawn** after review (§7): it records no end trim, so its narration runs up to 1023 samples long. It is now
  `aac -aac_coder fast` at 128 kb/s: 1.7 s, exact length, SNR 43.2 dB against 30.2 dB for the default coder;
- scene WAVs are read in parallel, and PCM goes to ffmpeg by pipe, with no narration.wav round trip;
- the .srt, the HTML and the mux run concurrently once the m4a exists;
- the page bundle is cached after `openStage`, so the HTML re-bundle costs 16 ms, against 217 ms the first time.

**Encode concurrency.** With VFR, capture is the critical path. Warm builds at 2, 3 and 6 encodes in flight took
13.3, 13.5 and 13.1–13.6 s, which is within the noise. It stays at 3.

## 7. Exact A/V lock on the real build (review finding 1)
The final check no longer allows a frame of slack. `verifyFinal` (`src/render/mux.ts`) requires, on the
published file, every video packet at the presentation time timing gives it (`finalMedia`: each scene's runs
plus the frames before it), video and narration both starting at 0, and the narration's effective length
(after the edit list) equal to Σ totalSamples. It costs about 50 ms.

The tolerance had hidden a real defect. AudioToolbox AAC pads to whole 1024-sample frames and records no end
trim. For a 2-scene test whose total is not a multiple of 1024, the narration came out 512 samples long. Part 8's
total happens to be 20,200 × 1024 samples, so it passed by chance. Native `aac` records the trim exactly.

A second rounding, found in verification: edit lists are counted in the movie timescale. At 1000 Hz, the
default in some ffmpeg versions (ffmpeg 9 here picks the audio rate itself), 104 frames trim to 3.466 s =
166,368 samples, not 166,400. The narration encode and the final mux now set `-movie_timescale` to timing's
audio rate. A test remuxes at 1000 Hz and confirms that the final check refuses the result.

A one-off check (since removed) ran a real `build --force` of part 8 (17 scenes, real voices, 43 paragraph copies) and
then checks it independently:

| check | result |
|---|---|
| `verifyFinal` on the published MP4 | pass |
| plans re-derived from the cached voices equal the exported plans | pass (17 scenes) |
| decoded audio samples = Σ totalSamples (20,684,800) | pass |
| every paragraph at its planned sample: SNR of decoded against assembled PCM is best at lag 0, not ±1 | pass (43 copies; worst 40.5 dB at lag 0) |
| decoded video resampled to 30 fps = Σ frameCount (12,928) | pass |

## Correction
The first calibration pass captured at 1280×720: the device scale factor never reached `captureScreenshot`. Its
SSIM and ΔE rankings held at 1080p, with VideoToolbox worst and JPEG adding chroma error, but its ΔE values were
computed on mis-sized buffers, and its speed figures were about 2.25× too optimistic. Those 720p speed lines are
not in `speed.jsonl`; they were moved to `/tmp/speed-720p.jsonl`.
