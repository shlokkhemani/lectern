# lectern — theme "paper"

Cards on a desk, after an explainer built of paper (warm grey desk, cream index cards, masking tape, Garamond,
slate-blue names and arrows, a red underline for emphasis). `theme: paper`. Frames: `sample.png` (the Lectern demo).

It is drawn over dark (`tokens.css` overrides, `blocks.css` restyles) and keeps dark's composition rules (1–4). Where
it departs from dark's rules:
- **Paper, not fields** (dark 7). A block drawn as one thing (code, chart, list, table, math, callout, text) is a white
  sheet; a block of several things gives each its own cream card (bullet items, compare columns, cells, nodes, frames).
  Sheets and cards cast a soft shadow and are held by tape (two strips, or one across a small card). Square corners.
- **Tilt.** Each card turns by a seed the page hashes from its block id and place, so a big sheet lifts a corner
  `--tilt-lift` (nearly square) and a small card up to `--tilt-max`. Never random; a block carried into the next scene
  keeps its tilt. Layout and lint measure every frame square (`.x-measure`): tilt is decoration.
- **Highlights** (dark 8–10). "Now" is the red pencil (`--accent`): text, bars, ticks. "Held" is the slate pencil. A
  highlighted line or cell is gone over with a highlighter (`--highlighter`, a fill: on paper that is what a highlight
  is). The red pencil is never a fill.
- **Type** (dark 12). EB Garamond for everything read, Cormorant Garamond for headlines and titles, IBM Plex Mono for
  code. Garamond reads smaller than Geist at equal px, so every size steps up.
- **Motion** (dark 16). `show` places a card: it unfolds from its top edge (`--appear-fold`), turning a little more than
  its tilt (`--appear-turn`), over 560 ms; it is opaque early (paper does not fade). Cards are placed one at a time
  (`--stagger` 110 ms). Scenes change by the camera sliding one stage-width along the desk (`--scene-pan`, 900 ms),
  never by a crossfade: the desk moves with its scene.
- **The desk** is flat colour under a soft mottle drawn once (`desk.png`). A fine grain (an SVG noise filter) was tried
  first and made every frame several times dearer to screenshot and encode; the mottle alone costs ~15% render time
  and ~60% file size over a flat desk. With its longer motion a paper build makes ~1.5x the frames of a dark one.

Fonts are vendored (SIL OFL 1.1) in `fonts/`.
