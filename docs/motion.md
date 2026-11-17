# Motion: things that travel (design, 2026-11-17)

Status: built (M1). The design and its reasons; the code and `skill/reference.md` are the source of truth.
The examples below, with the new syntax stripped, passed `check` and `shots` on the engine of the day; the path
geometry claims were checked by a probe in the
pinned Chrome. A script applied the reference edits of section 5 to a copy: the result is 220 lines, its
Example still passes `check`, and its tables still list what the reference test expects.

## The design in short

`move` learns to slide two more things. No new verb, no new block, no new declaration in charts.

- **A chart `point` slides along its series to an x**: `[move ball 1.22]`.
- **A custom SVG item slides along a path drawn in the same SVG**: `data-along="orbit"` on the item, then
  `[move earth 0.5]`.

One rule decides what qualifies: **a position is one number that can be eased in a straight line.** Cells in a
strip, lines of code, x along a series and length along a path all are. The runtime eases the number and the
block turns it into a place, so timing, state, lint, capture and the cache need no new mechanism. A graph's
nodes are not such a line, which is why the graph is left out (below).

What I changed from the proposal:
- The mover is an **existing item**, not a new marker kind. A chart already has a labelled dot on a series
  (`point`). A custom drawing already has `data-id` items. Markers stay what they are on `tokens` and `code`.
- **Custom paths carry most of the evidence**, not charts. They come first, not third.
- **No graph traveller.** No trial asked for one on a `graph`.

## 1. Primitives, and what the trials asked for

| Trial | Wanted | Answer |
|---|---|---|
| r5-gradient | a ball rolling down the loss curve, `[move ch:ball 1.22]`; "descent never really rolls" | chart point (example 1) |
| seasons, r2-seasons | Earth round its orbit; "motion along a path" | custom path (example 2) |
| r3-heat-pump | piston stroke; "move for custom data-id items" | custom path, a straight one |
| r4-vaccines | antibodies docking, mRNA entering a cell | custom path |
| r4-elo | rating number line with sliding dots | custom path (example 3) |
| tcp-handshake | packets in flight, on a ladder diagram | already built: `show` on a `sequence` message (example 4) |
| r3-git | a branch pointer that moves to another commit | not here: a pointer label on a graph (open question 1) |
| r4-vaccines | a cell dividing | rejected: morphing |
| r4-sky | an oscillating wave | rejected: a loop on its own clock |
| r5-linkedlist | array items shifting to open a gap | rejected: items re-flowing, not a traveller |

Five trials want something to travel inside a picture they drew. One wants it on a chart. In round 5 the
gradient agent spent 4,999 characters of generated SVG, plus a Python generator, on the scene that example 1
writes in 568.

**Accepted**
1. `move` on a line chart's `point`.
2. `move` on a custom SVG item that names a path with `data-along`.

**Rejected, and why**
- **A traveller on `graph`.** The packet request was on a ladder diagram, and `sequence` now draws a message
  from sender to receiver over 700 ms. Git wanted a pointer label, which is a different thing from a packet.
  Walking the highlight (`[hl g:a]` … `[hl g:b]`, entering edge amber) was listed under "good" in linkedlist and
  gc. A graph traveller also breaks the one-number rule: between two nodes there is no number to ease, so the
  state would need a second position model (from, to, progress), a resting look beside a node, layout room for
  it, and lint for its label. That is a feature of its own. Open question 1.
- **New chart words** (`ball`, `markers=` on a chart). `point` is already a named, labelled dot on a series.
- **Free flight**: `move` to coordinates, or straight to another item. Draw the line it should follow; one
  `<line>` is enough, and it may be invisible. The route is then part of the picture, not the engine's guess.
- **Numbered or named stops on a path.** Nicer for a polyline with corners, but it needs a path-data parser
  and a rule per shape. A fraction works on every shape with one sentence. Revisit if trials show agents
  getting fractions wrong.
- **Duration, speed or easing in the script.** The theme owns motion. Also rejected: duration scaled by
  distance, because timing would need pixel geometry and it has none.
- **Rotation along the path, scaling, trails, keyframes, morphing, loops, physics, `set` on an SVG
  attribute.** General animation. For a trail, declare still points and `show` each one.
- **Moving a chart `mark`, a bar or a series.** No trial asked. Bars and lines already animate with `set`.
- **`shift` on tokens, re-pointable edges.** They re-flow items or rewire structure. Hiding one edge and
  showing another "read clearly" in linkedlist.

## 2. Syntax, as an agent writes it

`[move target position]`. The target is one marker (as today) or one movable item. The position is one word.

| Host | Target | Position |
|---|---|---|
| `tokens`, `code` (today) | a marker, or the block | an item number |
| line `chart` | a `point` | an x: an x label, or a number between numeric labels (the same `<x>` the annotations take) |
| `custom` SVG | an item with `data-along="ID"` | a number from 0 (the path's start) to 1 (its end) |

**Example 1: gradient descent.** The curve, the axes and the ball are one chart.

```
::: chart roll x="w, the dial" y="loss" "rate 0.05, starting at w 0.5"
x: 0 0.25 0.5 0.75 1 1.25 1.5 1.75 2 2.25 2.5 2.75 3 3.25 3.5 3.75 4
loss: 19.75 15.29 11.42 8.12 5.42 3.29 1.75 0.79 0.42 0.62 1.42 2.79 4.75 7.29 10.42 14.12 18.42
point loss 0.5 #ball
:::
[hl ball] Now repeat. Measure the slope, take a step, and measure again.

[move ball 1.22] The first step is large, because the ground is steep. [move ball 1.6] The second is smaller. [move ball 1.8] Then smaller again.

[move ball 2] Near the bottom the slope flattens, so the steps shrink on their own.
```

The ball rolls along the drawn line. Its label, left out here, counts the loss down as it goes: 11.42 to 3.55.

**Example 2: an orbit.** A closed path. The item is drawn where the ellipse starts, at its right.

```
::: custom sky "the orbit, seen from above"
<svg viewBox="0 0 760 320">
  <ellipse id="orbit" cx="380" cy="160" rx="240" ry="110" fill="none" stroke="var(--line-strong)"/>
  <circle cx="380" cy="160" r="26" fill="var(--ink-2)"/>
  <text x="380" y="210" text-anchor="middle" font-size="16">Sun</text>
  <text x="640" y="165" font-size="16">March</text>
  <text x="380" y="300" text-anchor="middle" font-size="16">June</text>
  <text x="120" y="165" text-anchor="end" font-size="16">September</text>
  <text x="380" y="34" text-anchor="middle" font-size="16">December</text>
  <circle data-id="earth" data-along="orbit" cx="620" cy="160" r="10" fill="currentColor"/>
</svg>
:::
[hl earth] In March the Earth is here. [move earth 0.25] By June it has gone a quarter of the way round. [move earth 0.5] Then September, [move earth 0.75] and December.

[move earth 1] After one year it is back where it started.
```

**Example 3: two dots on a number line.** A straight path, two movers, both drawn at its middle.

```
::: custom elo
<svg viewBox="0 0 700 130">
  <line id="scale" x1="50" y1="80" x2="650" y2="80"/>
  <text x="50" y="112" text-anchor="middle" font-size="16">1400</text>
  <text x="350" y="112" text-anchor="middle" font-size="16">1500</text>
  <text x="650" y="112" text-anchor="middle" font-size="16">1600</text>
  <g data-id="ana" data-along="scale 0.5"><circle cx="350" cy="80" r="9" fill="currentColor"/><text x="350" y="58" text-anchor="middle" font-size="16">Ana</text></g>
  <g data-id="ben" data-along="scale 0.5" class="alt"><circle cx="350" cy="80" r="9" fill="currentColor"/><text x="350" y="36" text-anchor="middle" font-size="16">Ben</text></g>
</svg>
:::
Both players start at fifteen hundred. [move ben 0.42; move ana 0.58] Ana wins, so sixteen points move from Ben to Ana.
```

A piston, an antibody docking and mRNA entering a cell are the same shape: one item, one short path, `0` to `1`.

**Example 4: a packet. Nothing new.** Between two parties it is a `sequence` message, whose `show` is its
flight. Through a structure it is the highlight walking a `graph`, with the entering edge amber.

```
::: sequence req
Client | Server
Client -> Server: GET /cart
Server -> Client: 200 OK
:::
[show req:1] The request travels to the server. [show req:2] The answer travels back.
```

```
[hl g:head] Start at the head. [hl g:a] Follow the pointer to ten, [hl g:b] then twenty, [hl g:c] then thirty.
```

## 3. Semantics

**Position.**
- *Chart.* An x on the point's own series. The dot sits on the line as it is drawn at that instant, on the
  straight segment between two x labels, so a `set` that morphs the series carries the dot with it. An x off
  the axis is an error. The point starts at the x it was declared with.
- *Custom.* A fraction of the path's length. The item is displaced by the path's displacement: at position p it
  is drawn where the author drew it, shifted by (path point at p) minus (path point at its start position). So
  the picture as written is the first frame, a group moves rigidly with its label, and the path need not pass
  through the item: a piston can follow a line drawn beside it. The start position is 0, or the second word of
  `data-along="ID 0.5"` for an item drawn part-way along. No rotation.
- *Direction.* Towards the number written. On an open path, `[move piston 0]` goes back. On a closed path
  (circle, ellipse, rect, polygon, a path ending in `Z`) the item always travels forward, the way the path is
  drawn, so `0.25` after `0.75` continues through the start. `1` from the start is one whole turn. An agent
  cannot see direction on a contact sheet, so a backward orbit must not be writable by accident.
- *Shapes.* A circle or ellipse starts at its right and runs clockwise; a rect starts at its top left
  (checked in the pinned Chrome). The path may be invisible (`stroke="none"`); its length is still measured.

**Time.** A move starts on its cue's word like every verb, lasts the theme's move duration and uses
`--ease-move`. The theme gives charts and custom their own duration with the existing per-type override:
`--dur-move-chart` and `--dur-move-custom`, both starting at 700 ms, the value `--dur-show-sequence` already
uses for a flight. Tokens and code keep 320 ms. A move at beat start follows the existing rule: the voice waits
for start cues, within the gap limits. A second move on a mover in flight continues from where it is. No error.

**Other verbs on a mover.** It is still an item, so nothing changes.

| Verb | Effect |
|---|---|
| `show`, `hide` | fades in or out where it stands. First cue `show` means it starts hidden; first cue `move` does not |
| `hl` | lights it like any item. A chart dot is amber while now; custom follows "What `hl` paints in custom" |
| `move` | takes "now" (it already does for markers), so the mover is its block's amber thing until the next `hl`, `set` or `move` there |
| `set` | chart: replaces the point's label. Custom: replaces its text |
| `dim` | recedes it |
| `grow` (chart) | a point still waits for its line to reach it, at the x where it now stands |
| `move` while hidden | E301, as `hl` and `set` are today |

**Across scenes.** A re-placed block keeps where its movers stand, as it keeps marker positions.

**Look.** Tokens only, and no new ones for colour or size.
- *Chart.* The dot is today's `.ch-dot`: `--chart-dot-r`, ink at rest, amber while now, a `--bg` ring. A point
  that moves in the scene carries its label in a row above the plot, straight above the dot, joined by the
  hairline leader that row labels already have. The row is reserved across its whole sweep, so the label meets
  no other label at any instant: the chart's "labels never meet, by construction" rule survives. The leader
  may pass over a line or a still point's label, as a row label's leader can today. A point that does not move
  in the scene is placed exactly as today.
- *Custom.* The item as drawn.
- If the riding label reads badly in the remake, the alternative is a place near the dot chosen per stop,
  gliding between stops. Rest frames would then match a still point exactly, but a label could cross its own
  line in flight. Not built first, because it gives up the every-instant guarantee.

**Lint needs nothing new.**
- *Rest positions.* Lint already draws the settled state after every cue instant, so each stop is checked like
  any frame, and a finding lands on the `move` cue that caused it. In custom, a mover whose text rests on other
  text is the author's L403, with the existing "your custom content overlaps itself" fix. A shape resting on a
  label is not caught, as it is not caught today (linkedlist: "custom SVG collisions unflagged").
- *The route.* It is the host's own geometry: the series line, or the authored path. Nothing computes it.
- *Bounds.* A chart x must be on the axis, so the dot stays in the plot. A custom block's box grows to take in
  the item everywhere along its path, the way it already grows for anything drawn outside the viewBox. A
  mover cannot leave its block at rest or in flight.
- *In flight.* Overlaps are allowed and not checked. A dot passing a label for a few frames is what motion is.

## 4. Errors and fixes

No new codes. Every fix can be applied as written.

| Code | When | Message | Fix |
|---|---|---|---|
| E303 | no position, or more than one word | `move "ball" needs one position to move to` | `write [move ball 4]`, with a position valid on that block: an item number, the chart's last x label, or `1` on a path |
| E303 | chart x off the axis | `move ball 4.5: chart "roll" has x from 0 to 4` | `use an x label or a number between them, e.g. [move ball 4]; to go further, add x labels` |
| E303 | chart, text labels | `move dot Apr: "Apr" is not an x label of chart "sales"` | `use one of: Jan Feb Mar, e.g. [move dot Mar]` |
| E303 | marker, not an item number | `move tk:hi 2.5: a marker moves to an item number; tokens "tk" has tokens 1-4` | `use [move tk:hi 1] … [move tk:hi 4]` |
| E303 | path, not a number from 0 to 1 | `move earth halfway: a position on a path is a number from 0 (its start) to 1 (its end)` | `write [move earth 0.5]` |
| E305 | chart target is not a point | `move on series "loss": a chart moves its points` | with a point on it: `move the point: [move roll:point1 2]`; with none: `add the line "point loss 0 #ball" to the chart, then write [move ball 2]` |
| E305 | bar chart | `move on bar "Go": bars do not move` | `change its value instead: [set ch:Go 40]` |
| E305 | custom item without a path | `move on "piston" needs a path to move along` | `give the element with data-id="piston" data-along="ID", the id of a line or path in the same SVG that runs from where it is to where it goes` |
| E305 | any other block | unchanged; the list of types that support `move` now includes chart and custom | |
| E301 | mover is hidden | `move on "ball" while it is hidden` (today's message) | `show it first: [show ball; move ball 1.22]`, printing the real position, not `…` |
| E150 | `data-along` names no shape | `data-along="orbit" names no shape in this SVG` | `give the path it moves along id="orbit" (a path, line, polyline, polygon, rect, circle or ellipse in the same <svg>)` |
| E150 | `data-along` without `data-id` | `data-along needs a data-id on the same element: cues name the item to move` | `add data-id="name" to it` |
| E150 | `data-along` outside an SVG | `data-along works on SVG elements` | `draw the item and its path inside one <svg>` |
| E150 | bad start position | `data-along="scale 1500": the second word is where the item is drawn on the path, 0 to 1` | `write data-along="scale 0.5", or drop the number for an item drawn at the path's start` |
| E150 | path with several strokes | `path "loop" has more than one M: an item moves along one stroke` | `keep one M in its d and draw the other strokes as separate paths` |
| E150 | the path is inside the item | `"earth" would carry its own path "orbit" with it` | `move the path out of the element` |

One hint this repairs: today `[move ball 1.22]` on a chart point prints E303 `write [move ball 3]`, and
applying that prints E305.

## 5. Reference and skill text

`skill/reference.md` stays at 220 lines. Three table rows grow (rows are single lines), three lines are added,
and three are recovered without losing content.

1. **Custom SVG size**, reworded to free one line:
   ```
   600 × 300px, and `font-size="16"` is 16px text. It may grow up to 1.5× when the frame has room; it never shrinks
   or stretches to fill a row, so to make it wider, draw a wider viewBox (1152 for a full row, about half beside a
   block @left). Leave out `width` and `height` (W153). Anything drawn outside the viewBox adds to the box.
   ```
2. **`chart` row**, last cell: `` `set` `grow`; `move` slides a point along its series to an `<x>` (`[move roll:ball 1.22]`): its label rides above the plot and, left out, counts the value as it goes ``
3. **`custom` row**, last cell: `` `set`; `move` slides an SVG item along its `data-along` path (see Custom) ``
4. **Custom paragraph**, three lines added at its end:
   ```
   Moving: an SVG item with `data-along="ID"` slides along the shape with that `id` (a path, line, polyline, circle
   or ellipse in the same SVG; `stroke="none"` hides it). Draw the item where the shape starts (a circle or ellipse
   starts at its right and runs clockwise), or part-way along and say where: `data-along="ID 0.5"`.
   ```
5. **`move` row**: `` `[move tk 3]`: the first marker to item 3, later markers keep their distance; `[move tk:hi 4]`: that marker alone. `[move roll:ball 1.22]`: a chart point along its series to that x. `[move sky:earth 0.5]`: a custom item halfway along its path (`0` its start, `1` its end; round a closed path it always travels forward) ``
6. **Visibility rule**, last line: `and where its markers and moved items stand; the block itself follows the rule again.`
7. **Example heading** takes over the file's last line, which frees two:
   `` ## Example (passes `lectern check`; real scripts keep code in a file: `::: code lex @left src=lexer.py:1-10`) ``
   and the closing "In real scripts keep code in a file…" line and the blank before it go. The reference test's
   Example pattern still matches.

`skill/SKILL.md`: no change. The workflow is the same. A contact sheet shows where a mover rests after each
beat, which is what it already shows for markers.

## 6. Where it lands

**Seams.** Timing still owns every clock. Blocks still never see time. Each block alone knows what its position
number means. The generic runtime only eases it.

| File | Change |
|---|---|
| `src/blocks/contract.ts` | `BlockModule.movers?(body, args): Movers`, and `ItemState.at?: number` ("where `move` has put it, in the block's units; absent means where it was declared"), handled the way `value` is |
| `src/script/cues.ts` | `move` reads one word as its position. A marker or block target takes an item number as today. An item target asks the block's `movers` |
| `src/script/scene.ts` | the pass that tracks marker positions tracks movers too: start at `home`, `carry` across re-placement, `Reachable.markers` lists every stop. It resolves the written position against where the mover stands, so `Cue.to` in the IR is absolute. E301's fix prints the real cue |
| `src/timing/spans.ts` | `move` on an item emits one `marker` span on that item. `base` is `home`, or the carried-in position for a reused block. `finalMarkers` includes movers |
| `src/runtime/state.ts`, `settle.ts` | evaluate and settle `at` for items; a reused block's base carries it |
| `src/blocks/core/chart.ts` | `movers` (home is the point's x; `stop` is the annotation's x rule, factored out of `parse`). A point with more than one stop in `reachable.markers` takes a reserved row, and its label follows the dot's x. `renderLines` reads `at` |
| `src/blocks/core/custom.ts` | allow and check `data-along`; `movers` (closed or open from the tag or a trailing `Z`; forward-only on closed). On first measure, sample each path every 2 px into the item's parent coordinates (`getPointAtLength` through the two `getCTM`s, which ignore outer CSS scale: checked), add the swept box to the block's box. `render` writes a `transform` attribute |
| `theme/v2/tokens.css` | `--dur-move-chart`, `--dur-move-custom` |
| `src/verbs.ts`, `src/ir.ts` | comments only |
| `skill/reference.md` | section 5 |

```ts
export interface Movers {
  /** Movable item key → where it stands as declared, in the block's own position units. */
  home: Readonly<Record<string, number>>;
  /**
   * The position a cue wrote for `key` (the word after the target), given where the item stands, as an
   * absolute number the block can ease to; or what is wrong and the literal fix. Also asked about a key that
   * cannot move.
   */
  stop(key: string, text: string, from: number): number | { message: string; fix: string };
}
```

Alternative considered: movers as markers (`MarkerState`). It lost because a chart point and a custom item
are already items with `show`, `hl`, `set` and `dim`; as markers they would lose those or exist twice.

**Unchanged:** `src/render/*`, `timing/plan.ts`, `clock.ts`, `runtime/lint.ts`, `layout.ts`, `page.ts`, the
player, and every other block. About 250 lines of source.

**Speed invariants, by construction.**
- A mover's place is written into the stage markup on every frame: `cx`, `cy` and the label's inline `left` and
  text on a chart; a `transform` attribute in custom. No CSS animation, canvas or timer. Numbers go through
  `num()`, so equal states give equal markup.
- An item without `data-along` keeps its markup exactly as today, so existing scripts draw the same bytes. An
  item with it always carries a `transform`, from mount on (`translate(0 0)` at home when none was authored;
  the authored one is put back as written), so its markup never depends on what the page drew before.
- The capture set already takes every frame of a span and one after it. A 700 ms move is 21 frames.

## 7. Test plan

*Superseded by lane E1 (2026-11-17): tests are e2e through the CLI (`docs/design-principles.md`, Engineering practice). Motion is covered by `test/blocks.test.ts` and `test/diagnostics.test.ts`; `docs/test-coverage.md` maps each item below.*

**Unit (bun, no browser)**
- `cues`: each host resolves (`1.22` between labels 1 and 1.25 is index 4.88; a text label; a path fraction).
  Every row of section 4 has a fixture in the error catalogue, and each fix is applied literally and passes
  (the pattern in `chart-features.test.ts` "errors give fixes that work when applied literally").
- `chart.movers`, `custom.movers`: `home`; `stop` on numeric, text and unevenly spaced labels; closed against
  open; forward-only (`0.75 → 0.25` is 1.25, `0 → 1` is 1, `1 → 0` stays); every `data-along` rejection.
- `scene`: stops in `Reachable.markers`; carry across a re-placement; E301 on a hidden mover; first cue `move`
  leaves the item visible.
- `timing`: one span per move; `from` is home, then the last stop, then the in-flight value on a retarget; the
  per-type duration; a move at the start of beat 0 holds the voice for its 0.7 s; a reused block enters where
  it stopped; move takes now. The 200-scene property test gains item moves ("every numeric from equals what the page shows just
  before t0").
- `state`, `settle`: `at` absent before any move; eased between; held after; a backward seek restores it.

**Page (headless Chrome, as `test/runtime/render.test.ts` and `test/blocks/*`)**
- Chart: at rest at x, the dot's `cx` and `cy` equal those of a still `point` declared at x. Mid-move the dot
  is on the line. With a `set` on the series in the same cue it stays on the morphing line. With `grow` it
  waits for the line.
- Chart label: at 50 positions across the sweep the label is inside the block and meets no mark label, point
  label or series name.
- Custom: at 0, 0.25, 0.5 and 1 the item's displacement equals the path's, within 0.5 px, with the path inside
  `scale(2)`, the item under its own `transform`, and the block scaled 1.5× by the layout.
- Custom, closed: `0.75 → 0.25` passes the start; positions only rise. Open: `1 → 0` returns.
- Custom box: the block contains the item at 100 samples along a path that leaves the viewBox; lint is clean
  at every stop.
- Lint: a mover whose text rests on other text is L403 at that `move` cue with the authored fix. Passing the
  same text mid-flight gives no finding.

**Determinism**
- `test/render/determinism.test.ts`: the fixture gains a chart move and a custom move. Two fresh pages draw
  byte-identical frames at 20 random (k, t), mid-flight included; 50 repeated frames equal a fresh render.
- Two builds of a motion script with the same voice: `bench/fingerprint.ts` identical.

**Speed invariants**
- *Skip.* For a scene with a move, the frames whose markup changes are exactly the span's frames plus one, and
  each capture with skipping on equals a forced fresh shot (the pattern in `capture.test.ts`).
- *Markup carries the motion.* Any two capture runs where the eased position differs have different stage
  markup. The speed audit's converse is re-run on the motion fixture: group runs by markup, and every image in
  a group is identical.
- *Cache.* Changing one stop in scene k changes scene k's key and no earlier scene's. A rebuild with no edit
  hits every segment. The edit matrix gains three cases (change a stop, add a move, remove a move), each
  identical to a no-cache build.
- *No regression.* The five round-5 scripts and part 8, which use none of the new forms: `fingerprint.ts`
  gives the same video frames, audio, `.srt` and sheets before and after. Only the HTML differs, because it
  carries the runtime.
- *No clocks.* The grep test over `src/blocks` and `src/runtime` also rejects `requestAnimationFrame`,
  `setTimeout`, `setInterval`, `Date.now`, `performance.now`, `<canvas`, `animate(`.

**Acceptance, by eye.** Remake r5-gradient scene 5 as example 1 (and scene 6 as far as its axis reaches), and
the seasons orbit as example 2. The founder watches both.

## 8. Open questions for the founder

1. **Graph.** Leave it out of this lane? My recommendation is yes. If you want motion on graphs now, the
   cheapest step has no new words: as `hl` walks from a node to the next, the amber draws along the edge
   between them (one theme token, and `hl` on graphs becomes slower than 160 ms). Named pointers on nodes
   (`markers=head,cur` on a graph, which is what git asked for) are a separate lane with a look to design.
2. **The ball.** It is today's chart dot: amber-filled while now, value label riding above the plot. Decided on
   the remake: 4 px was too small to follow on a phone, so `--chart-dot-r` is 6 px, for every point.
3. **Flight time.** 700 ms for every chart and custom move, whatever the distance. Decide on the remake.
4. **The reference's last line** ("In real scripts keep code in a file…") moves into the Example heading to
   hold 220 lines. Fine?
