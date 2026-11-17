# How code is written here

Founder's instruction: follow the deep-module discipline of *A Philosophy of Software Design* (Ousterhout, 2019).
Every builder and reviewer applies this. Below are the principles as they bite in **this** codebase.

## Principles
1. **Modules are deep.** A small interface hides a lot of behaviour. Examples from our system:
   - `parse(text, file) → {ir, errors}`
   - `voiceScene(scene, ir) → SceneAudio`
   - `renderScene(k, timeline) → segment`
   - a block's `render(el, state)`

   If a module's interface is nearly as complex as its implementation, merge it or rethink it.
2. **Make the common case trivial.** The script author (an LLM) writes the fewest tokens for the common case. Rare features never leak into the common path; there are optional args, not mandatory ones.
3. **Pull complexity downward.** When a choice could go to the author, to a caller, or into the module, put it in the module: layout, timing, retries, normalisation, caching. Config knobs are a last resort.
4. **Define errors out of existence** where possible:
   - hidden things keep their space, so there are no re-layout edge cases;
   - `hl` is exclusive per block, so there are no "clear highlight" bookkeeping errors;
   - visibility is inferred from the first cue.

   Errors that remain are reported once, at the right layer, with the fix.
5. **Information hiding, no leakage.** Each design decision lives in exactly one module:
   - the theme's numbers, including motion durations, live in `theme/`;
   - what each verb *does* lives in `src/verbs.ts`;
   - the STT provider's wire format lives in `src/audio/stt.ts`.

   If two modules both need to know a format, the format is wrong or the split is wrong.
6. **No temporal decomposition.** Do not split modules by "step 1, step 2, step 3" of the pipeline when the steps share knowledge. Split by what knowledge each module hides.
7. **Different layer, different abstraction.** No pass-through functions or wrapper classes that just forward arguments.
8. **General-purpose core, special-purpose edges.** The runtime (state channels, layout, lint) knows nothing about tokens or trees. Blocks know nothing about time.
9. **Design it twice.** For each frozen seam, sketch one alternative and say in a comment why this one won.
10. **Comments say what the code can't.** Interface comments state the contract: what it does, its units, and its invariants. No comments that restate code. No implementation detail in interface comments.
11. **Precise names.** If a name is hard to pick, the abstraction is muddled; fix the abstraction.
12. **Readable over writable.** Obvious code, no cleverness, consistent conventions throughout. Strict TypeScript, no `any` in exported types.

## Red flags (reviewers look for these)
Shallow module · information leakage · temporal decomposition · overexposure · pass-through method · repetition ·
special-general mixture · conjoined methods · comment repeats code · implementation docs in the interface · vague or hard-to-pick name ·
non-obvious code.

## Engineering practice
- Bun + TypeScript strict. Tests are e2e through the CLI, in `test/`: the input is a script (and the files it names)
  run through `lectern check | shots | build` (spawned, or the function `src/cli.ts` calls), and assertions are only
  on what an agent or viewer sees: the exit status, the printed diagnostics (code, script line, `fix:`), `build.json`,
  the MP4 (ffprobe, frames grabbed with `ffmpeg -ss`), the `.srt`, the step-through HTML, the contact sheets and the
  files left in the out dir. No test imports an engine module, and none exists only to be reorganised away: each is a
  journey an agent or viewer goes through, or a promise of the rulings, the spec or the speed invariants. A lane's fix
  comes with such a test when the break is visible there; `docs/test-coverage.md` maps what the suite covers.
- `bun test` runs offline: voiced builds read committed takes (`test/fixtures/voice/`, refreshed with
  `bun bench/voice-fixtures.ts examples/part8.md test/scripts/edits/edits.md test/scripts/edits/said.md`);
  `LECTERN_LIVE=1` adds one networked check → voice → build.
- No dependency without a reason, given in one line in `docs/deps.md`.
- Deterministic by construction: no wall clock, randomness or network in the render path.
- `bun run check` = typecheck + the e2e suite. It must be green before any review.
