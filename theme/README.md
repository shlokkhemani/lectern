# lectern — theme

Current: `v2/` — direction A, near-black / Geist (tokens.css, fonts.css, sample.html `?f=main|dim|held|bullets`).
Frames: `v2/sample-a.png`, `v2/sample-a-dim.png`, `v2/sample-a-bullets.png`, `v2/sample-a-held.png`. v1 (top level) is kept for comparison only.

## References and what each gave
- **Vercel / Geist** — near-black with a precise grey ramp; chrome removed, type and spacing do the grouping.
- **Linear** — one state colour, short ease-out motion, small consistent radii.
- **3Blue1Brown** — the object of the lesson is the brightest thing; everything else recedes.
- **Alabaster (N. Prokopov)** — few syntax colours; definitions by weight; punctuation and qualifiers step back.

## Composition (the layout engine applies these to every frame)
1. **Rows span the content box** (x 64–1216). Nothing is left-packed. A row of N items (token strip) shares the full width:
   cells flex between `--cell-min` and `--cell-max`; at max the row is centred. A crowded strip of short entries goes
   below `--cell-min`, down to its widest entry; past that the frame is overfull.
2. **Side-by-side regions** (code | tree, code | bullets): fixed content (code) takes its natural width; flexible content
   (trees: sibling gap `--tree-gap-min..max`) grows to fill what is left. Remaining slack is shared evenly between the two
   outer edges and the gutters (space-evenly), so the row's envelope is always centred. Gutter = `--region-gutter`.
   Each region's content is centred in it, horizontally and vertically. Prose is capped at `--measure-max`.
   A fixed block (prose, code, tables) is never laid out narrower than min(its natural width, `--measure-min`): prose
   beside code wraps at a readable measure, or the row is overfull (L410), never one word per line.
3. **Vertical balance.** The headline is anchored at the top margin. Remaining height is shared evenly above, between and
   below the rows, but an interior gap never exceeds `--row-gap-max`: leftover goes equally above and below the centred stack.
   An even gap under `--row-gap-min` means overfull: split, don't squeeze.
4. **Fill: content reads on a phone.** Code never renders below `--code-min-render` (terminal text is code). A frame is sparse
   if its rows fill < `--sparse-fill-min` of the body height or any block fits < `--region-fit-min` of its region
   (fit = max(w/regionW, h/regionH)). Then, in order: (a) each region's content scales up to min(`--scale-max`,
   regionW/w, its share of the height left after the minimum gaps), never below 1x; (b) flexible pitch (tree levels,
   table/list rows, up to `--flex-pitch-max`) takes the height that scaling left. Scaling goes first because larger
   text is what makes a frame read on a phone; pitch only spreads what is already legible.
   Sizes after scaling: prose ≥ `--prose-code-ratio-min` × code, labels ≥ `--text-meta`, and in a region without code
   labels ≥ `--label-code-ratio-min` × code (labels beside code scale with it).
   Measured on part 8 (scene numbers as of the 17-scene script): s4 1.34x, height-limited; s9 trees 1.36x; s13 code
   only 19→20px, because the 469px-minimum right column caps its width.

## Rules for block authors
6. Tokens only. No literal colours, sizes, radii, durations or easings, and no coordinates (rule 4 of rulings.md).
7. **No box soup.** No borders on cells, nodes or panels. Rest = `--surface-2`; a region = `--surface-1` field;
   state = neutral lift to `--surface-3`. Hairlines only for group brackets.
8. **Highlight model: amber = each block's latest target.** `hl` is exclusive per block, so several blocks may
   hold a highlight at once. In each block, the latest `hl`/`set`/`move` target is "now" (`--hl-now-*`: amber glyph and bar);
   that block's other active highlights, including the cur marker, drop to "held" (`--hl-held-*`: grey bar, full-contrast text,
   same `--hl-fill-*` lift) over `--dur-highlight`. So a block has at most one amber target (plus its connecting edge); a cue
   that lights two blocks lights both (round 5: held read as unlit). Levels: now > held > rest > receded
   (`--recede-opacity`; receded edges change colour to `--ink-4`, not opacity). `set` flashes amber for `--dur-settle`, then settles.
9. Amber is never a fill, heading, label or resting border. `--peek` is lookahead only (not a highlight); `--ok`/`--error` outcomes only.
   `--mark-alt` (rose) marks the second referent of a contrast ({alt}); never "now", never syntax. Diffs use `--diff-add/del` (+ faint `-fill` bands).
10. Code-line highlight = 2px bar at the field edge + `--hl-fill-line` across the full field. Never a colour wash.
   Scenes crossfade over `--dur-scene`; a `set` holds amber for `--dur-settle`.
11. **Syntax.** Greys carry Go; two hues only: keywords and literals (strings, numbers, nil, CONSTANTS). Definitions weight 600.
12. **Type.** Sentence case; no tracked uppercase. Token types are small lowercase meta in the cell. Tabular figures.
    Scene number sits in the headline at headline size, ink-3. Size floor 14px meta only; anything narrated ≥ 16px.
13. **Groups**: hairline bracket and label ABOVE the span; `cur`/`peek` markers BELOW the cell. They can never collide.
14. **Trees**: uniform nodes, orthogonal connectors with `--radius-edge`, sibling edges leave the parent `--edge-spread` apart.
15. **Optical centring**: low glyphs (, ; .) shift by `--optical-low`; `*` by `--optical-high`.
16. **Motion**: show = fade + 4px rise, 200ms `--ease-out`; hide 140ms ease-in; move 320ms in-out; grow 280ms ease-out
    (edge draws, then its node appears); hl/focus 160ms; dim 200ms. Stagger 40ms in reading order, max 6 steps; trees by
    depth then left to right. No springs, overshoot, scale or blur.

## Fonts
Geist + Geist Mono (OFL, vendored in `v2/fonts/`). Geist Mono has no italic, so comments are not italic.

## Deliberately rejected
- Fixed 12-column placement (v2 draft): 9 one-column tokens left a dead band on the right. Replaced by rules 1–3.
- Bordered cells, header bars, left-rule callouts, dashed group boxes, amber washes (read brown on dark).
- Glow, shadows, gradients, pills, circular nodes, emoji, burned-in captions, on-canvas progress bar, uppercase tracked labels.
- Direction B (graphite / Inter + JetBrains Mono): not chosen.
