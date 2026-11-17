# lectern: language reference

A script starts with front matter between two `---` lines: `title:` (required; it names the output),
`series:` (a header label), `lang:` (the default for code blocks) and `say:` (see Narration). Then
`# Chapter` starts a chapter (numbered, shown in the header) and `## Headline` starts a scene (`##` alone has
no headline). A block is `::: type id args "caption" @region`, then its body, then `:::`. A line `::: id`
re-places an earlier block in the region it last had (`@region` moves it), with no body and no closing `:::`.
Each paragraph of narration is one beat, with `[cues]` inside it. `<!-- comments -->` go anywhere outside bodies.

**Ids and names.** Ids are `[a-z][a-z0-9-]*`. Block and group ids are unique in the file. No id or name may be a
verb or `none`, and a block id may not be a block type (`code`, `tree`…). A body line ending ` #name` names that
item (in `code` and `terminal`, put two or more spaces before `#`). A name used in one block can be written bare
(`[hl total]`); one used in two blocks is qualified (`t:total`, else E206). No item name may be a block or group id.

## How blocks behave

**The frame.** The body is 1152 × 554px under a headline (592px under `##` alone), above the burned-in subtitles.
A flexible block (`tree`, `graph`, `chart`, `sequence`, `tokens`) takes the rest of its row; the others are fixed,
as wide as their content. `@top` gives a block its own row above the body; `@left` puts the body in one row, `@left`
beside `@main`, 48px apart; otherwise each `@main` block (the default) gets its own row. Blocks in one region stack.
Code lines and table cells never wrap, so too wide is overfull (L410). Prose wraps at 440px (about 44 characters)
and hugs its longest line. Beside another block, a fixed block is never narrower than 360px (about 36 characters) or
its own width: a row too narrow for that is overfull. A graph fits about 4 nodes of 13 characters across (8 of 5),
or 6 ranks down with `dir=TB`; a `dir=cycle` ring of 4 to 6 nodes is about 400 × 300px. A sparse frame grows, up to
1.5×. No text renders below 14px, nor values, cells and labels below 16px, at final scale (L406).

**Kept space.** Anything hidden (from the start, or by `hide`) holds its place, so nothing moves when it appears.
Early beats may show it empty, which is accepted; to avoid that, reveal the companion sooner or split the scene.

**Custom SVG size.** An SVG is drawn at its viewBox size, one unit per pixel (`font-size="16"` is 16px text), up
to 1.5× larger when the frame has room, never smaller or stretched: for a wider picture, draw a wider viewBox (1152
for a full row, about half beside @left). Leave out `width` and `height` (W153). Drawing outside the viewBox adds.

**What `hl` paints in custom.** Anything in `currentColor`, fill or stroke, follows its item: amber while it is
"now" (see Highlight), full ink while held, faded when dimmed. Named colours and stroke widths stay as written.
Unstyled text is `currentColor`, unstyled shapes rest on `--surface-2` and lift on `hl`, and unstyled lines are
`--line-strong` and brighten (a filled path gets no stroke). Fill large areas with a surface token, as a
`currentColor` fill turns amber. To rest grey and light up on `hl`, put `style="color: var(--ink-3)"` on the item
and draw in `currentColor`. Paints and `font-*` set on a `<g>` reach its children.

## Blocks

Every block takes `show hide hl dim`, on its items too (not `callout`), and a `"caption"` (not `compare`, `title`).

**Selectors.** `id` is the whole block, and the part before `:` is always a block's id: after `::: chart sky`,
`sky:blue` is its bar "blue". `id:3`, `id:2-4` and `id:2,5` pick items by number; where a block has two kinds of
item, numbers count the first (a graph's nodes, a grouped chart's rows). An item's key (what the items column below
names: a node key, a bar or series label, a trace name, a `data-id`) or `#name` works too, and a comma list mixes
them (`[hl g:a,b]`); a key with a space is selected by number or a `#name`. Table cells are `t:row.col` (`t:2.1`,
a label column counts); a column is a list of cells: `[hl t:1.2,2.2,3.2]`. A marker is selected by name: `tk:hi`.

| type | body | items (selector) | also |
|---|---|---|---|
| `text` | lines; a line that is one code span is display code (monospace, larger, never wraps) | lines `1…n` | `set` (on the block: replaces all lines) |
| `bullets` | `- item` | `1…n` | `set` `swap` |
| `checklist` | `- [ ] item`, `- [x] item` | `1…n` | `set c:2 done` / `todo` / new text |
| `callout` | one short paragraph, never empty (write the first text even if `set` replaces it); outcome colour goes in the text, `{ok …}` / `{bad …}` | block only | `set` |
| `title` | title line, subtitle line, `- chip` lines | chips `1…n` | |
| `compare` | columns split by `---`; first line is the label | columns `1…n` | |
| `table` | `\| a \| b \|`; `\|---\|` makes the row above a header | body rows `t:1…n` (the header is not counted and not a target), cells `t:2.1` | `set` `swap` |
| `code` `lang=` `from=N` `diff` | verbatim; `...` gap row; `... @159` renumbers; `+ `/`- ` with `diff` | lines, by displayed number | `set` `group` `swap`, marker `ptr` (`move`) |
| `code src=` `name=` | none (see below) | file line numbers | same |
| `tree` | 2-space indent per level; `caption \| label` puts a smaller grey caption above the label, inside the node | nodes `1…n`, depth-first | `set` `grow` |
| `graph` `dir=LR\|TB\|cycle` | `key: label`, `a -> b`, `a -> b: label`; a node's children are drawn in declaration order; `dir=cycle` puts the nodes on a ring, clockwise from the top in declaration order; labels are prose (backticks for code) | node keys, edges `a>b`; while a node is now, the edge entering it is amber too | `set` `grow` |
| `chart` `format=` `x=` `y=` `log` | see Charts below | bars, rows and series by label; one grouped bar `sky:blue.noon`; `mark1…`, `point1…`, `band1…` | `set` `grow`; `move` slides a point along its series to an `<x>` (`[move roll:ball 1.22]`): its label rides above the plot and, left out, counts the value as it goes |
| `sequence` | `A \| B` participants (optional); `A -> B: label`; `A --> B` dashed (stale); `A -x B` lost; `A: STATE` note on a lifeline. Messages are horizontal, one row each | participants `s:client`, messages `1…n`, notes `s:client.1` | `set` `grow`; `show` draws a message from sender to receiver |
| `math` | one TeX equation per line | `1…n` | `set` |
| `custom` `src=` | inert HTML/SVG, or none with `src=`; `data-id="k"` elements are items (see below) | by `data-id` | `set`; `move` slides an SVG item along its `data-along` path (see Custom) |
| `tokens` `markers=lo,hi` | line 1 lexemes (`""` empty, `"a b"` with space), line 2 types (any short text, drawn small under each cell) | `1…n` | `set` `group` `swap`; markers, named as you like and drawn with their names (`move`: hidden until their first move; markers on one cell sit side by side); default `@top` |
| `stack` | `Frame tag` line (tag optional); indented `key: value` rows | frames `f:1`, rows `f:1.key` | `set` |
| `trace` | `name = value` rows; a name may contain spaces | by name: `tr:x`; a name with a space by number or its `#name` | `set` |
| `terminal` | verbatim; `$ cmd` lines are commands | non-blank lines `1…n` | `set` |

**Charts.** A body whose first line is literally `x: …` is a line chart: then one `name: 1 2 3` line per series. Any
other body is a bar chart: one `label: value` line per bar, drawn horizontally, label left. Grouped bars open with
`series: noon sunset` (two names; not the front-matter key), then one value per series per line (`blue: 80 0.02`):
in `::: chart sky`, `sky:blue` is the row (`hl` lifts its first bar) and `sky:blue.noon` one bar, which `set` takes
one number. Line charts take annotations: `mark <x>: label` (a vertical marker), `point <series> <x>: label` (a
labelled dot), `band <a> <b>: label` (the shaded gap between two series); `<x>` is an x label or a number between
them. Values are plain numbers (`76123`, not `$76,123`): `format=$` shows `$76k`; `format=%` appends % (7 is 7%);
templates like `format=$#k`, `format="#.0 kWh"`. `x="rating gap"` and `y="expected score"` title the axes (on bars
`x=` titles the values). `log` puts values on powers of ten (all above 0, `set` too; log bars get an axis from the
power below the smallest). Other bars start at 0; a negative bar runs left. A line chart's y axis starts at 0 unless
the data sits far from it. `grow` draws a series left to right, revealing its points as the line reaches them; to
bring a point in later, grow the series (`[grow rev:sales]`), then `show` it.

**Custom.** Inert HTML or SVG (sizing and highlight: see How blocks behave), in the body or from a file:
`::: custom id src=pic.svg`, relative to the script, no body and no closing `:::`. Colours: `var(--ink-1)`…
`--ink-4`, `--surface-1`…`--surface-3`, `--bg`, `--line`, `--line-strong`, `--ok` (green), `--error` (red), `--peek`
(calm blue, "next"), `--mark-alt` (rose, the other side of a contrast); type: `--text-meta`, `--text-label`,
`--text-body`, `--font-sans`, `--font-mono`, `--weight-regular`/`-medium`/`-strong`; strokes `--stroke-*`. Any other
`var()` is E150. Classes `ok`, `bad`, `alt` match the inline marks. Amber is not available: `hl` an item instead.
`<marker>` ids are block-private. Moving: an SVG item with `data-along="ID"` slides along the shape with that `id`
(a path, line, polyline, circle or ellipse in the same SVG; `stroke="none"` hides it). Draw the item where the shape
starts (a circle or ellipse starts at its right and runs clockwise), or part-way along and say where:
`data-along="ID 0.5"`. For example, Earth round its orbit:
```
::: custom sky
<svg viewBox="0 0 640 260"><ellipse id="orbit" cx="320" cy="130" rx="260" ry="100" fill="none" stroke="var(--line-strong)"/>
<circle cx="320" cy="130" r="28"/><circle data-id="earth" data-along="orbit" cx="580" cy="130" r="12" fill="var(--surface-3)" stroke="currentColor" stroke-width="3"/></svg>
:::
[move sky:earth 0.25] In three months Earth is a quarter of the way round, [move sky:earth 0.5] and in six, on the far side.
```

**Sourced code.** `::: code id src=path:from-to @left`, no body and no closing `:::`, the path relative to the
script. Ranges may be listed, `src=lexer.py:1-5,12-20`, with a gap row ("6 lines") between them. Selectors are file
line numbers (`id:12`); `name=12:fn,15:loop` names lines. The caption defaults to the path.

## Cues

```
[verb target]  [show hl x:2]  [hl a; dim b]  [set x:2 new value]  [move tk:hi 3]
[group tk:3-5 label #gid]  [swap a b]  [hl none]  [focus lex]  [focus none]
```

| verb | effect |
|---|---|
| `show` | hidden or dimmed → visible (tree and graph edges draw first) |
| `hide` | → hidden; its space stays reserved |
| `hl` | highlight; replaces the block's earlier `hl` (see Highlight) |
| `dim` | recede; `show` restores |
| `set` | replace content; value is the rest of the command, inline marks allowed |
| `move` | `[move tk 3]`: the first marker to item 3, later markers keep their distance; `[move tk:hi 4]`: that marker alone. `[move roll:ball 1.22]`: a chart point along its series to that x. `[move sky:earth 0.5]`: a custom item halfway along its path (`0` its start, `1` its end; round a closed path it always travels forward) |
| `grow` | `tree` (by depth), `graph`, `chart`, `sequence`: progressive reveal; with a selector, that subset |
| `group` | `code` and `tokens`: bracket and label over a contiguous range; `#gid` makes it a target |
| `swap` | `swap a b`: block a leaves its slot, b enters it (both in the same region); or two items trade places |
| `focus` | dim every other block (block targets only) |

Verbs combine in one command (`[show hl x]`); `set move group swap` take a command of their own, and a cue holds
any number of commands split by `;`: `[hl lex:10; set tr:lo 7; move arr:lo 8]`. `;` and `]` inside backticks or
braces do not split. Commands in one cue apply in order: `[hl x; hl none]` ends with nothing lit. A cue fires on
the next word. Cues on their own line above a paragraph, or before its first word, fire at beat start.

**Highlight.** `hl` replaces its block's highlight: `[hl b:2]` after `[hl b:1]` unlights b:1, so to keep both lit
write `[hl b:1,2]`. Each block keeps its own: `[hl a:1; hl b:2]` lights both. In each block the latest `hl`, `set`
or `move` target is "now" (amber); an item its `hl` lit stays lit, "held" (full ink), through later `set` and `move`
there, until the block's next `hl`. `[hl none]` clears every block; a scene change resets `hl` `dim` `focus`.

**Visibility rule.** A block or item starts hidden if and only if its first cue in the scene is `show`, `grow`, or a
swap-in; otherwise it is on screen from the scene's start (holding its space either way). `show` only reveals:
`[show hl x]` reveals x and lights it. Showing a block shows all its items; an item's own cue decides only that item
(`[show x:1]` as x's first cue hides item 1, not the block). To reveal some items later, hide them in the cue that
shows the block: `[show x; hide x:3-4]`, then `[show x:3-4]`. A block with no cue of its own whose items all start
hidden appears with its first item (no empty panel, axes or caption); a title's heading, a table's header and a
custom drawing are on screen from the start. To act on an earlier block, re-place it: `::: id`. It keeps its items'
visibility, `set` values and where its markers and moved items stand; the block itself follows the rule.

## Inline marks (block bodies, `set` values, headlines)

`` `code` `` · `{em x}` accent · `{alt x}` second accent · `{ok x}` / `{bad x}` right / wrong · `{box x}` a
slot. Marks work inside backticks. `*x*` is literal. `\{` and `` \` `` escape.

## Narration

Narration is exactly what is spoken; cues and marks are removed. Backtick words are spoken split on camelCase,
`_` and `.`; ALLCAPS is lowercased. Backticks hold only letters, digits and `._` (E411). Prose may not contain
`( ) [ ] { } < > = * / + |` (E412): write "x equals 3 plus 4". `say` respells a whole word everywhere:
`say: { expectPeek: expect peek }`. A lowercase key matches any case; a key with capitals, only that spelling.

## Example (passes `lectern check`; real scripts keep code in a file: `::: code lex @left src=lexer.py:1-10`)

````
---
title: From text to tree
series: Parsing, part 1
lang: python
---

# Tokens
## Text becomes tokens
::: tokens tk markers=cur
x = 3 + 4
NAME EQUALS NUMBER PLUS NUMBER
:::
::: text note
A lexer reads characters and emits {em tokens}.
:::
[move tk 1] The lexer starts at the first character, x, which is a name. [move tk 2] Then comes an equals sign, [move tk 3] the number 3, [move tk 4] a plus, [move tk 5] and the number 4.

[group tk:3-5 the value #val; show note] The last three tokens are the value. The parser will turn them into a tree.

## The loop that does it
::: tk
::: code lex @left "lexer.py"
KINDS = {"=": "EQUALS", "+": "PLUS"}

def tokens(src):
    for ch in src.replace(" ", ""):
        if ch.isdigit():
            yield ("NUMBER", ch)
        elif ch.isalpha():
            yield ("NAME", ch)
        else:
            yield (KINDS[ch], ch)
:::
::: table kinds
| character | kind |
|---|---|
| digit | `NUMBER` |
| letter | `NAME` |
| `=` | `EQUALS` |
| `+` | `PLUS` |
:::
[hl lex:4] It drops the spaces and looks at one character at a time. [hl lex:5-6; hl kinds:1; hl tk:3,5] A digit becomes a number. [hl lex:7-8; hl kinds:2; hl tk:1] A letter becomes a name. [hl lex:9-10; hl kinds:3-4; hl tk:2,4] Anything else is looked up in a small table of symbols.

# Trees
## Tokens become a tree
::: tk
::: tree ast @left
{em assign}
  target | x
  value | + #plus
    3
    4
:::
::: callout why
The tree shows what belongs together: {em 3 + 4} is one value.
:::
[grow ast:1-2] The parser builds an assignment. Its target is x. [grow ast:3-5; hl plus] Its value is the sum, with 3 and 4 below it. [show why] The shape of the tree says what belongs together.
````
