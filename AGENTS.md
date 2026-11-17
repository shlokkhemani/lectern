# lectern: working on the engine

This file is for agents changing the engine. Agents *making videos* read `skill/SKILL.md` instead.

## Binding docs
- `docs/rulings.md`: the founder's product decisions. A change that contradicts one goes to the founder first.
- `docs/design-principles.md`: deep modules, and how tests are written (e2e through the CLI only).
- `theme/README.md`: the theme rules; `theme/v2/tokens.css` holds every number.
- `docs/spec-v1.md`: the architecture; code comments cite its § numbers. `docs/motion.md`: why motion is shaped
  as it is.

## Invariants
- **A frame is a pure function of the `#stage` markup.** The page sets attributes and inline styles from the plan,
  and nothing else moves: no CSS animation, timers, canvas, wall clock or randomness. Screenshot skipping and the
  render cache both rely on this.
- **Every clock lives in `src/timing/`.** Blocks draw a state; they never compute time.
- **Tokens only.** Blocks take every colour, size and duration from the theme. Amber means "now" and is a glyph,
  bar or line colour, never a fill.
- **Byte-identical output.** The same script and voice give the same MP4, SRT, HTML and sheets. After touching
  `src/render/`, `src/runtime/` or anything in a cache key, compare builds with `bench/fingerprint.ts`.
- **Every diagnostic carries a fix** an author can paste literally, and applying it passes `check`.
- **`skill/reference.md` stays within 220 lines**, the whole language agents load. Make room by tightening.

## Changing things
- Prefer a fix or a deletion to new syntax, verbs, args or lints; those need the founder's ask. Delete what a
  change replaces.
- Done means `bun run check` is green (typecheck + e2e suite, offline, ~80 s). A visible break gets an e2e test
  in `test/`; `docs/test-coverage.md` maps what is covered.
- Narration changed in `examples/part8.md` or `test/scripts/edits/`? Refresh the saved voice with the command in
  `docs/design-principles.md`, or the suite fails on a cache miss.
- Look at what you changed: `bun src/cli.ts shots <script>` and read the contact sheets.

## Secrets
API keys live in `.env` and stay there: never print it or commit it. TTS and STT receive narration text only.
