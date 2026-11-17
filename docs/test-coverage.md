# Test coverage: unit suite → e2e suite (E1, 2026-11-17)

The unit suite (51 files in `test/`, 7 in `src/`, 772 tests) is replaced by an e2e suite in `test/` that drives the
CLI and reads only what an agent or viewer sees. One line per behaviour the old suite protected: **→** the e2e test
that covers it now, or **dropped:** why.

Files: `diagnostics` = test/diagnostics.test.ts · `part8` = test/part8.test.ts · `blocks` = test/blocks.test.ts ·
`outputs` = test/outputs.test.ts · `edits` = test/edits.test.ts · `docs` = test/docs.test.ts · `live` = test/live.test.ts
(opt-in, network).
"Internal" means the behaviour has no output an agent or viewer could see apart from the outputs other lines check.

## Language: diagnostics (test/script/errors, selectors, spoken, language, item-scope, motion; blocks/*parse*)
- Every catalogued code prints `file:line:col: severity CODE: message` + `fix:` exactly (77 fixtures) → diagnostics "every diagnostic prints…"
- A hint in script syntax, applied literally, leaves nothing to fix (45 fixtures) → diagnostics "a fix … makes check pass" (now: `check` exits 0, not just parse)
- Every catalogue code has a fixture, every fixture is catalogued → dropped: bookkeeping over an internal table; each code has its row
- `--json` diagnostics carry file, line, col, code, severity, message, fix → diagnostics "--json"
- At most 50 diagnostics, errors before warnings, source order → diagnostics "at most 50"
- Parsing continues after an error, reports independent ones → diagnostics rejected "parsing continues…"
- Selector errors (14 rows, exact messages), typo suggests nearest id, rejected cue commands (9) → diagnostics rejected
- Selector grammar resolves to IR keys (ranges, commas, #names, code from=, stack keys, groups, `none`) → dropped: IR shape; wrong resolution shows as E201 rows or as wrong pictures (blocks)
- Cue parsing (verbs combine, set value with `;`/`]` in backticks, move/group/swap fields) → dropped: IR shape; escaped delimiters → diagnostics accepted
- Inline marks to IR (roles, escapes, balanced braces) → dropped: IR shape; unclosed marks E112 (5) → diagnostics rejected; W120 vs arithmetic → diagnostics fixtures + accepted
- Front matter defaults, slug, chapters, headlines, comments, declarations, regions, BOM/CRLF → dropped: IR shape, seen in every build (slug names outputs in part8/blocks); comments and BOM/CRLF → diagnostics accepted
- src= reads lines, missing file E213 at declaration, unclosed block stops at next declaration → diagnostics fixtures/rejected
- Visibility inference (first cue show/grow/swap → hidden, block-level show, move not a first cue, swap-in) → dropped: IR; seen as reveals in blocks "cues change the picture"
- Round 5: a block whose items all start hidden appears with its first item → blocks "no empty frame"
- Reused block inherits item visibility; item hidden earlier stays hidden → diagnostics rejected (E301 rows)
- Symbolic pass: E301/E304/W310/W330/E202/E114 cases and their false-positive guards → diagnostics rejected + accepted
- Review findings #1–#9 (swap keeps items, say lookups and `__proto__`, unterminated block, E107 once, broken block quiet, sourced loc, escaped delimiters, show after dim, say in punctuation) → diagnostics rejected/accepted for #1 #3 #4 #5 #6 #7 #8; dropped #2 #9: spoken form, heard only (live)
- `reachable` sets/markers/groups per scene → dropped: internal plan input
- Spoken form (camelCase split, say, possessives, cues never spoken, beats) → dropped: only audible; the live test voices a camelCase identifier through the real path
- E411 advice per symbol (6), E412 per character (12), operators in words, marks in prose, E420 at 400/401 words → diagnostics rejected/accepted
- Item names scoped per block, E206 names the on-screen block, E202 variants → diagnostics fixtures/rejected/accepted
- Motion parse: positions to absolute stops, re-placed block resolves from last stop, reachable markers → dropped: IR; seen as motion in blocks (orbit, ball)
- Motion E301 fixes print the real cue → diagnostics rejected
- Golden IR snapshot of the §1.6 opening; IR invariants → dropped: a snapshot of internal state fails on any reorganisation
- part8 parses with no diagnostics; scenes ≤ 400 words → part8 "part 8 passes every gate" (stricter: G2, G3 and timing too)
- (new) A three-column compare of long prose fits a full row → diagnostics "a three-column compare…"
- Block body errors: trace E136, checklist E130, graph E133, chart E137 forms, sequence E143 forms, custom E150/E151/E152 allowlist, url(), var(), opacity, still vs animated images → diagnostics rejected/accepted
- Chart/data-along/custom src= errors whose fix, applied, parses clean (19) → diagnostics "block errors: the fix…" (now: `check` exits 0); plus the E303 marker-past-the-strip case from "Author feedback"
- `same:` deleted, `dir=cycle` a header value → diagnostics accepted

## Layout and lint (test/runtime/lint-honest, overflow, page, render; blocks/*render*)
- Tiny text L406 (custom SVG too, squeezed transforms), custom self-overlap L403 names the author's content → diagnostics lint.md
- Overfull scene reports only L410; fixes that, applied, fit (side by side → @top, graph → dir=TB, prose beside code); too tall alone vs together; strip limit in tokens → diagnostics lint.md
- Every finding names its beat and the script line (the cue, else the block) → diagnostics lint.md, lint2.md
- Captions drawn and lint clean; formula subscripts and exponents inside the block; bullets beside a growing graph; compare beside a checklist → diagnostics lint.md (clean scenes)
- Token labels placed side by side, never overlap, move continuously (`placeLabels`, `markerOrder`) → dropped: internal geometry; overlaps would be L403 (lint.md scene 1 clean)
- Wrapped text hugs its longest line; short text keeps one line in a scaled row; gap cap; fill growth; measure stable after fill → dropped: pixel geometry, judged on sheets; regressions would show as L410/L403
- Overlong code line is L410, never L402; the panel keeps every line → diagnostics lint2.md
- L405 for sets a chart cannot draw, at each cue → diagnostics lint2.md
- L403 for mover text resting on text at its move cue; passing in flight is clean → diagnostics lint2.md
- L404 ring too crowded is the author's; same ring unlabelled is clean → diagnostics lint2.md
- Lint catches undefined text, overlapping labels, edges through labels (page.test) → partly diagnostics lint.md (L403); dropped: undefined-text injection needs a broken block module
- Visible "undefined" inside envelopes caught → dropped: needs a broken block module to provoke

## Blocks rendered (test/blocks/*, test/runtime/render, settle, state, motion-state)
- Every block type renders lint clean → blocks "every block type builds lint clean"
- Recession once per part; hl is exclusive; set crossfades; plain-text set amber while now; unchanged set stays visible; swaps drawn and undone on backward seek; row set drawn → dropped: per-part CSS state; the whole picture per beat is checked on sheets and frames (blocks "cues change the picture")
- "Now" is per block (round 5) → blocks "each block keeps its own amber"
- Table cell hl: amber glyph, never amber fill; header row 16px ink-2 → dropped: CSS values, judged on sheets
- Chart: formats, ticks, axis from 0, annotations, grouped bars, legend, titles placement, negative bars, band labels, series names never collide mid-set, lone series caption → dropped: geometry/CSS; collisions are L403 (lint); log never 0 → blocks "a tiny value on a log chart…"; log ticks text → blocks (same test)
- Graph: siblings in declaration order, ring layout, chords in two lanes, labels sans, grow order → dropped: geometry, judged on sheets; ring crowding → diagnostics lint2.md
- Sequence: messages horizontal, label above line, message travels on show, set labels → dropped: geometry; sequence builds and changes on cues → blocks
- Custom: SVG at viewBox size, grows with fill, box holds strokes and markers, caption counts toward width, too wide is L410, ids scoped per block, theme tokens in attributes, group paints reach shapes, filled path gains no stroke, rects square unless rx, authored inline colours restored → dropped: geometry/CSS; custom draws and lights → blocks; markup rules → diagnostics
- custom src= draws exactly as inline → diagnostics accepted "src= draws the file" (parses as the same block); dropped: pixel identity of the two
- Tree caption drawn at --text-label and essential to L406 → diagnostics lint2.md (scene clean); dropped: font-size value
- Code: JavaScript highlighted, not plain text (shiki time limit) → dropped: colour of tokens, judged on sheets
- Math: TeX checked at parse, typeset → blocks (math scene builds) + diagnostics lint.md formulas
- Chart point move: rests where a still point would, on the line mid-move, waits for grow, label rides above inside the block → blocks "a chart point rolls…" (monotone, lit, ends lower); dropped: exact on-line geometry
- Custom item along a path: displacement under transforms, closed path forward, open path back, block holds the item → blocks "a planet…" (forward, elsewhere mid-flight); dropped: transform maths
- Motion state: absent before, eased, held, backward seek restores; settled states; re-placed block keeps movers → dropped: page state; backward seek → part8 player scrubbing
- Settle model (hl exclusive, set settles, show reveals hidden block, reused block resets) → dropped: internal; pictures checked per beat
- `stateAt` channels, latest span wins, crossfades, ease solves bezier → dropped: internal maths
- Prepare cache: hit equals miss, body change misses → part8 / blocks determinism (cold vs warm caches identical); edits (code `src=` file changed)
- Theme rule 5: blocks use only theme tokens (grep) → dropped: source lint, not behaviour
- Page bundle has no Date/performance/Math.random, no shiki/KaTeX, no timers → dropped: source grep; determinism itself → part8, blocks fingerprints

## Timing (test/timing/*)
- Motion tokens read from the theme, missing token fails, per-type durations → dropped: internal; a theme error would fail every build
- Frame/sample consistency (Σ repeat = frames, samples = frames × 1600, copies in bounds, spans captured) → part8 "the MP4 … exactly as long as build.json says"; 200-scene property test → dropped: random internal plans
- Splice map (LEAD_MIN onset, paragraph gaps, PREROLL, copies cut mid-gap, silent scene, END_EXTRA) → dropped: internal constants; audible pacing
- T603 voice mismatch → dropped: needs a corrupt cache entry
- T602 second set while the first runs → outputs "a timing error (T602)…"
- Spans: grow/hide stagger, show stagger cap, tree grow by depth, hl/now per block, [hl none], set now then release, move markers, numeric from continuity, reused markers, hidden marker first move, scene crossfade → dropped: internal; visible results in blocks (reveals, amber per block, motion) and sheets
- Global clock toGlobal/locate → part8 player scrubbing shows the cue at that time
- Swap spans → dropped: internal; swap verbs built in diagnostics accepted/rejected rows
- Media instructions (segment frames, final pts, frame-rate refusal) → part8 MP4 length; dropped: refusal needs mismatched plans
- .srt cues are the page's cues on the global clock, ≤2 lines of 42, within scene; every cue change is a captured frame → part8 ".srt" + player subtitles match .srt
- No subtitle orphans (seasons) → part8 ".srt … no sentence tail under 3 words"

## Render (test/render/*)
- Captures 1920×1080; two fresh pages byte-identical; scene direct equals after others; runs independent of draw history; repeated frames equal fresh → part8 + blocks fingerprints (LECTERN_SHOOT_EVERY_RUN vs skipping, cold vs warm)
- Capture skip: a repeated markup reuses its image, chunk's first frame always shot, page without stage → part8/blocks fingerprints with LECTERN_SHOOT_EVERY_RUN
- Motion: mover changes markup every frame of its span; skip on motion scenes equals fresh shots; same markup same image → blocks "motion is deterministic"
- Cache keys: editing a scene changes no earlier key; later scene only in crossfade; inserted scene; reused block carries state; page head in every key; hidden stylesheet; segment reused only for same drawing/plan; narration for same samples → edits: the S3b matrix (theme token, `say:`, code `src=` file, custom `src=` SVG, body of a reused block, scene inserted, scene deleted), each cached rebuild IDENTICAL to a build without the cache, with the scenes it may reuse; part8 "an edit re-renders only its scene"; dropped: the hidden-stylesheet and hidden-id rules (no script can put markup in a hidden scene)
- Cache: reuse makes on miss, copies on hit; LRU pruning past the limit → part8 warm build (all cached); dropped: pruning at 1 GB, too slow to provoke
- Encode: ffconcat holds, numbered images at every instant, frame grab between cues shows the held image, exact lengths → part8 "every contact-sheet tile is a picture the video holds" (mid-hold grabs) and MP4 length
- Mux: H.264 High yuv420p bt709 + AAC 48 kHz, no subtitle track, narration exact length and start → part8 MP4 test
- Final check rejects one tick or sample off (R701/R702) → dropped: needs a corrupted mux
- Edit lists counted in samples → part8 audio duration_ts = frames × 1600
- WAV round trip, narration copies, out-of-bounds copy → dropped: internal; narration audible in part8 (max volume)
- Export: withheld MP4 removes the stale one, still writes HTML and .srt → outputs "a failed layout gate withholds the MP4…"
- Step-through HTML: plans, narration, player; burned-in subtitle equals the .srt cue; no CC line; Play starts at 0:00 / beat start; → steps → part8 "the step-through page…" (no CC line: dropped, UI detail)
- Build order: export and sheets overlap capture → dropped: scheduling, speed only (timed by the S-lanes' bench)
- Publication: T602 skips export and removes earlier outputs, build.json written → outputs T602 test
- An exception withdraws outputs and writes build.json; a success record that cannot be written rolls back → dropped: needs an injected failure
- A directory held by another build is left exactly as it is; custody held from first write to last → outputs "one build at a time…"
- Own scratch, sweeps a dead build's → outputs (scratch emptied); dropped: dead-build sweep needs a killed build
- Subset build writes build.sN-M.json, sheets.sN-M/, .sN-M outputs, leaves the full build's → outputs "a --scenes build…"
- check/shots take --out, --no-audio; check --force is a usage error; length per scene and total → outputs "check and shots…" + "usage errors"
- One-scene sheet is as tall as its rows → outputs (1920×383)
- --no-audio starts no voicer; without it check does → dropped offline (no visible trace without keys); live covers check → voice ahead → build
- Custody: one owner, no lock left, contender before removal, across processes, killed owner frees, racing contenders, scratch removal, flock failures, deadline-killed subprocess, settled() ordering → outputs (R700, no lock); dropped: the flock races and errno paths (internal, need a debugger-level harness)
- Stage: final check failure publishes nothing; export while segments render; player bundle failure; closing kills every browser; lint findings on the right tile; finding boxes; failed job retried on a fresh page; tile divider; audio banner on top; tile waits for first word → part8 sheets test (tiles are video pictures, boxed/bannered tiles counted); dropped: failure injection and pool internals

## Audio (src/audio/*.test.ts, test/audio)
- Transcript diff verdicts (W510/W511/W512, A501–A503), number/contraction/split tolerance, timing provenance → dropped: needs STT output; the part8 build prints real W510 lines (format → part8) and live runs real STT
- verify/judge (two recognisers, A505, T601, say-line fixes, rounds 4–5 cases) → dropped: needs STT; live covers a passing take
- tokenise frozen examples, numbers by value → dropped: internal; the spec keeps the examples
- HTTP retries (429/5xx, Retry-After, limiter, abort) → dropped: network failure injection
- TTS request carries only the narration text; stream cut-off retried → dropped: request body is not visible; live sends real requests
- ffmpeg process failure vs abort → dropped: failure injection
- voiceScene orchestration (shared production, joiners, cancel, retakes, nova outage, edit re-projects, tempo), across processes (join voicer, revoice) → part8 "a moved cue reuses the cached take; changed words are voiced again"; live (check → build joins); dropped: concurrency fakes
- Cache key depends on every part of the take → part8 (changed words miss the cache)
- Narration text and estimate (3.5 words/s) → outputs check length; dropped: exact constants
- Network voice cold/warm (LECTERN_NET) → live (LECTERN_LIVE)

## Docs and CLI report (test/skill, test/cli)
- The reference Example passes check with no findings → docs (now every script snippet in SKILL.md and reference.md)
- Block and verb tables list exactly the registry; type column lists each block's args → docs (against what the CLI prints in E107/E108/E111)
- The flexible sentence names the flexible modules → dropped: internal module flag
- Lint and audio issues print script line, S·B and block; scene-level issue prints S alone → diagnostics lint tests (lint lines), part8 (audio lines); dropped: scene-level A502 needs a failing take

## Counts
Behaviours of the old suite: 108 lines. Covered by an e2e test (fully, or the part an agent or viewer can see; the
line names what is dropped): 67. Dropped outright: 41. Plus one new line (the three-column compare).
New suite: 355 tests in 7 files (1 opt-in). On an M4 Pro: 75 s idle before test/edits.test.ts was added (it takes
13 s alone); 100–110 s for the whole suite under heavy load (load average 80–150).
