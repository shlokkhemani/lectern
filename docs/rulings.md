# Founder rulings — lectern (then "explain") (16 Nov 2026)

Settled in a design session with the founder. Verbatim notes in quotes.

## Goal
Agents are given a task to make a narrated explainer video and spend their tokens on the best *content*,
not on building the video. The engine gives them a language and primitives they can rely on deterministically;
theming/styling is the engine's job; audio is produced in parallel; everything is as fast as possible.
"These videos have been tremendously useful to me and I want to increase the scale of them in all different scenarios in my life."

## Rulings
1. **Scope:** a general core of building blocks plus domain packs. v1 = core + CS pack, extracted from the
   four real hand-built videos (parser parts 5–8).
2. **What the agent writes:** a Markdown-like script — narration is prose, visuals are `:::` declared blocks with
   ids, cues `[verb target args]` sit inline and fire on the following word; `##` = scene. Parsed into a strict
   schema with line-precise errors. "Totally your call — think about what you as an agent would need."
   Principle: fewest tokens to say *what is on screen and when*; zero appearance information.
3. **Renderer:** own it, evolving the current HTML+CSS engine (deterministic `render(t)`); step-through HTML for free.
4. **Layout:** the engine always. No coordinates/CSS from agents. Overflow/collision = compile error. One escape hatch (`custom`).
5. **Outputs:** MP4 (16:9) + step-through HTML + soft subtitles (.srt). No vertical in v1.
6. **Form:** local CLI (`lectern build script.md`) + a Claude Code skill (language reference + workflow).
7. **Speed:** "as fast as possible without compromising on quality."
8. **Language:** TypeScript (Bun/Node). Speed via rendering only frames that change, parallel browser pages,
   hardware encode (`h264_videotoolbox`). Profile before considering Rust.
9. **Dictation unit:** one TTS call per scene (paragraph), all scenes in parallel, cached by text hash. Gemini TTS
   (`gemini-3.8-flash-tts`, voice Charon), TEXT ONLY — never prepend style instructions. Provider swappable.
10. **Alignment + verification:** hosted STT, not local ("local will be too slow"). ElevenLabs Scribe v2 via
    OpenRouter `/api/v1/audio/transcriptions` (`model=elevenlabs/scribe-v2`, `timestamp_granularities[]=word`,
    `response_format=verbose_json`) returns word timestamps + confidence; 2.4 s for a 10 s clip. Benchmark before locking.
    The same pass verifies the audio: transcript diff vs script; mismatch fails the scene → re-voice.
11. **Cues anchored to words.** Unanchored cues fire at beat start.
12. **Quality gates every build:** schema check, layout lint (measured in real browser), per-scene transcript diff,
    contact sheet the agent must look at. No final MP4 while a gate fails unless `--force`.
13. **Theme:** ONE theme. "Tastefully crafted, no slop, no cringe, every single stroke and color curated super
    selectively." Designed by an Opus subagent from references; founder approves before building on it.
14. **Block catalogue v1 (expand after test videos on several topics):**
    core — title, text, callout, bullets, code (line hl, optional line numbers, diff marks), table, checklist,
    compare, tree (edges grow), graph (boxes+arrows), stack (frames/boxes), chart (bar/line), math (KaTeX), custom.
    CS pack — tokens (cur/peek markers, labelled groups), terminal, trace (variable table updating per step).
15. **Verbs: a closed set** — show, hide, hl, dim, set, move, grow, group, swap, focus. Each block defines how a verb
    looks on it. New verbs are added to the engine deliberately; agents cannot invent them.
16. **Workflow in the skill:** outline → verify (run every code example/claim) → script → build → contact-sheet
    review → fix. Best-effort in v1; the critic/reviewer loop is a separate later project.
17. **Captions:** none burned in. Narration + visuals carry it; soft subtitles; optional short headline per scene.
18. **Repo:** `~/Projects/explainer`. Keys in gitignored `.env` (OPENROUTER_API_KEY, GEMINI_API_KEY).
19. **v1 acceptance:** remake parser part 8 (call expressions, 7:22) in the engine — quality equal or better by the
    founder's judgement, the agent's script < 1/3 the tokens of the hand-built version, build time a fraction of today's.

## Lessons from the hand-built videos (must hold)
- Never prepend style instructions to TTS text ("it keeps dictating after every sentence").
- Always verify all audio by transcription.
- Quality complaint on part 4 ("drop in quality") was fixed by: full-width token strip with outlined groups,
  trees that draw themselves, readable sentences instead of dense text, examples first, less text.
- Recurring hand-built bugs the engine must make impossible: overlapping labels, overflowing rows,
  labels colliding with markers, tree edges crossing labels, helper signature mismatches showing "undefined".

## Voice: keep Gemini (2026-11-16)
The founder compared Gemini Charon with ElevenLabs v3 (George, Brian) and Flash (George) on two part 8 scenes and said "keep gemini". ElevenLabs is on OpenRouter (`elevenlabs/eleven-v3` etc., about 5× the price per minute, no timestamps through OpenRouter). Clarity is handled with subtitles: a soft MP4 track on by default, plus a CC line in the HTML player.

## Subtitles: burned in (2026-11-16)
This reverses "no burned-in captions". The founder said some words are hard to understand. The soft MP4 track doesn't show in QuickTime (it ignores the default flag), so subtitles are drawn into every frame by the page. The MP4, the HTML page and shared clips then all show the same line. The `.srt` stays as a sidecar file for uploads.

## Layout: later blocks keep their space (2026-11-16)
A block revealed later in a scene keeps its place from the scene's start; nothing re-flows or glides when it
appears. Founder, shown today / centre-and-glide / re-layout on three trial scenes
(side by side): "today is fine dont overcomplicate". The fix for a lopsided early beat is the
author's: reveal the companion block sooner, or split the scene. The reference says so.

## Balance lint deleted; callout variants deleted (2026-11-16)
Fable's review of the round-3 feedback plan found the balance gate (L420) failing frames the engine itself
composed — a lone square picture can never span 60% of 1152×554; side-by-side regions get an empty band from the
layout's own space-evenly slack — with hints that loop (overflow → split → stranded → @left → overflow); r2-hashmap
spent 8 rounds and "the passing versions looked worse". Founder, offered warning / delete / fix layout:
**"Delete balance lint".** L420 and W420 go entirely, with the raster, tokens and sheet overlays. Layout still
centres and spaces content; balance is judged by looking at sheets.
Callouts: the ok/bad bar read as a stray mark in two trials and `warn` drew nothing. Founder: **"Remove bars +
arg"** — a callout is one short paragraph; outcome colour stays available in text as `{ok …}`/`{bad …}`.

## Round 5 rulings: empty frames, amber per block, sans labels, `same:` deleted (2026-11-17)
From Fable's third review, all four as recommended:
- **An empty frame appears with its first item.** Narrows round 2's visibility rule. Chart axes, titles and
  legend, and terminal, code, trace and stack panels, stay hidden until their first item is shown. A title's
  heading, a table's header and a custom drawing keep today's rule. Four of five round-5 trials hit empty frames.
- **"Now" (amber) is per block.** Each block's latest `hl`/`set`/`move` target is amber, not only the cue's last
  target. Three trials across three rounds read held as unlit.
- **Labels are sans by default.** Graph node labels and chart series/row names render in the body face;
  backticks mark code, as in prose. Three trials.
- **`same:` deleted.** No uptake in round 5, the heaviest code in the R6 diff. `dir=cycle` stays.
- **Log scale on bar charts and `custom src=`** approved ("add log scale and custom svg from file"), lane R7.

## Outside review triage: one take, brighter headers, landscape phone (2026-11-17)
GPT 6.1 Pro reviewed a context packet; Fable verified and triaged it,
rejecting most proposed machinery. Founder, all as recommended:
- **One TTS take per scene** (`HEDGE` 2 → 1): half the voice spend; a failed take (~1 scene in 36) costs ~10 s.
- **Table headers 16 px in `--ink-2`** (were 14 px `--ink-3`, 3.94:1).
- **"Readable on a phone" means landscape full screen.** Portrait is out of scope.
