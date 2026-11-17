---
name: lectern
description: Make a narrated explainer video (MP4 with voice, subtitles and a step-through HTML page) from one Markdown file. Use whenever someone asks for an explainer video, a narrated walkthrough, an animated lesson, or a video that teaches a concept, a piece of code or an algorithm.
---

# lectern

You write one Markdown file: narration, plus the blocks on screen and inline cues that say what changes
on which word. The engine does layout, motion, colour, voice, timing and encoding. You never say where,
how big, or what colour. The language is in `reference.md` beside this file; read it before writing.

The CLI is `bun ~/Projects/explainer/src/cli.ts`, written `lectern` below. It runs from any directory and
reads API keys from the engine's `.env`.

## Workflow

1. **Outline.** One idea per scene. Write the concrete example first, then the definition. List the scenes
   as one line each: headline, the example on screen, and the point.
2. **Verify.** Run every code example and paste the real output; check every claim against a source or the
   code. Keep real code in files beside the script and show it with `src=path:from-to`, so it cannot drift
   from what compiles.
3. **Script.** Write the script (start from the example in `reference.md`).
4. **Check.** `lectern check script.md` until it prints no errors. It parses, lays out every scene and lints
   the picture after every cue, from under a second to about ten for a long script. Once the script parses, it
   also starts voicing new narration in the background, so run it after every narration edit and the build
   waits less.
5. **Look early.** `lectern shots script.md` renders contact sheets with estimated timing and no audio.
   Read them now, while fixes are cheap. Shots renders even when lint fails, with the findings boxed.
6. **Build.** `lectern build script.md`. It voices each scene, checks the voice against the script,
   renders, and writes the outputs.
7. **Read every contact sheet** with the Read tool, and the warnings in the report (also in
   `build.json` → `issues`). A clean gate line does not mean the video is good. You see one frame per beat
   with its scene, beat, time and the start of the narration; lint findings are boxed in red. On each tile,
   check that what is lit is what the subtitle in the frame names.
8. **Fix and rebuild.** Only scenes whose narration changed are voiced again (the voice cache is keyed by
   the narration text). `--scenes 3-5` builds a subset while you iterate; `--revoice 4` forces a new take.

You are done when the gates pass, every sheet looks right, and you have decided about every warning.

## Content rules

- **Readable sentences, less text on screen.** The screen shows the thing being explained: code, tokens, a
  tree, a table. Narration carries the explanation. On-screen prose is one short line, never a paragraph.
- **Examples before definitions.** Show `x = 3 + 4` becoming a tree before saying what a parser is.
- **Narration is natural speech.** Write what a person would say aloud: "add, called with 2 and 3", never
  `add(2, 3)` (the voice says "add two comma three"). No symbols in prose; backticks only around
  identifiers (they are spoken as words: `parseExpression` → "parse expression").
- **One idea per scene.** `check` prints each scene's length and the total: use it to hit the length you were
  asked for before you build. Over 400 words in a scene is an error (E420).
- **One paragraph is one beat.** A beat holds as many cues as its sentences need; the contact sheet shows
  one tile per beat, after its cues have landed. Put each cue at the word it belongs to, or on its own line
  above the paragraph so the picture lands before the voice.
- **Every frame makes sense on its own.** Pause anywhere: highlight what the voice is on, and reveal things
  when they are mentioned. A block revealed later keeps its space from the scene's start, so early beats may
  show an empty area; that is accepted. If it looks wrong, reveal the companion block sooner or split the scene.
- **Let the engine lay out.** Choose blocks and regions (`@top`, `@left`, `@main`); nothing else about
  appearance is yours. Token strips run full width at the top; trees and graphs grow; code sits left of what
  it produces.
- **Pictures can move.** `move` rolls a chart point along its series or slides a custom SVG item along a
  path (a planet round its orbit, a ball down a curve): one moving picture often says more than several still ones.
- **Fix lint by restructuring content, never with hacks.** Follow the `fix:` line: split the scene, show a
  shorter excerpt or fewer tokens, or move a block to another row (`@top`, or remove `@left`). Never change
  what is true to pass a gate: no filler text, no empty blocks, no abbreviated names for real identifiers.
- If a picture cannot be expressed with the blocks, use `custom` (inert HTML or SVG) and leave a
  `<!-- comment -->` saying why.

## Reading the report

Each finding is one line, `script.md:LINE S3·B2 "block": severity CODE: message`, then `fix:`, the concrete
change. LINE is the script line to edit: schema findings give `LINE:COL`; a layout finding gives the cue
that caused it, else the block's `:::` line in that scene. `S3·B2` is the contact-sheet tile (scene 3,
beat 2); a finding about a whole scene (A502) shows `S3` alone. `--json` carries the same as `loc` and `beat`. Then the gate line, for example `gates: G1 schema pass · G2 layout FAIL · G3 audio pass · timing pass`. Exit codes:
0 all gates pass, 1 a gate failed, 2 usage or internal error. Scene numbers in messages and sheets are
0-based: S0 is the first `##`.

- **G1 schema (E1xx–E4xx).** The script is wrong. Apply the fix line as written.
- **G2 layout (L4xx), found on the rendered frames.**
  - L410 overfull: too much for the frame. The message says what is too wide or how many px too tall (the
    frame is in `reference.md`, How blocks behave), and the fix names the move: split the scene, put a
    block `@top` or remove `@left`, or a block's own option (`dir=TB` on a wide graph). An overfull scene
    reports only L410; fix it first.
  - A finding whose fix starts "report this" is an engine bug, not your script, but it still fails G2. Try
    one restructure around that block (split the scene, show less); if it persists, build with `--force`
    and tell the user the code, scene and beat, alongside the video.
- **G3 audio (A5xx, W51x).** The voice is checked against the script by two recognisers. A warning is
  printed only when both report it. You cannot listen, so decide from the words.
  - A5xx fails the scene (cut-off take, too many errors). The engine already retried; rephrase the
    sentence it names. If A502's warnings are mostly one word, paste the `say:` line from that word's fix.
    A504/A505 mean a service was unreachable: check the keys and network, rebuild.
  - W510 heard X for Y. When the fix prints a `say:` line and X sounds like Y (a name spelled another way:
    `anna` for `Ana`), paste the line into the front matter. If X is another word (`no` for `node`),
    rephrase if that changes the meaning. If X is Y in another form (`equal` for `equals`), ignore it.
  - W511 a word was not heard: rebuild with `--revoice` and that scene's number; if it is missed again,
    rephrase. W512 an extra word was heard: rephrase so nothing is read aloud there.
- `attempts` in `build.json` counts voice takes: 1 is normal; more means a take failed the check and was
  redone automatically.
- **Timing (T6xx).** Cues cannot be timed. T601: a word was not clearly heard. If a cue is on it, move
  the cue to a neighbouring plain word; if it starts or ends a paragraph, rephrase so the paragraph starts
  and ends on a plain word (numbers and names are the usual cause). T602: two cues write the same thing at
  once; move one.

`--force` writes the MP4 despite failed gates (exit stays 1, `build.json` records `forced: true`). Use it
to look at a draft, or past a "report this" engine bug you could not restructure around; never past a
finding in your own script.

## Outputs

`./out/<slug>/` from the working directory (slug from the title), or `--out <dir>` (all three commands take it).
One build at a time per output directory; a second one stops with R700.

- `<slug>.mp4`: the video. `<slug>.srt`: subtitles. `<slug>.html`: step-through page, one step per beat.
- `sheets/sheet-NN.png`: contact sheets. The report lists every path under "contact sheets".
- `build.json`: gates, every issue, per-stage times, frame counts, output paths.
- A `--scenes 3-5` build writes `<slug>.s3-5.*`, `build.s3-5.json` and `sheets.s3-5/`, beside the full build's.

Report to the user: the MP4 path, the length, the gate line, any warning you decided to keep, and any engine bug you forced past.
