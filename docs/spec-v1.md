# lectern — v1 engineering spec

Status: revision 2, 16 Nov 2026. It folds in Sol's review, the theme (`theme/README.md`, `theme/v2/`), and the measured benchmarks.
Binding: `docs/rulings.md`, `docs/design-principles.md`. Grew from a hand-built HTML engine (v5), since removed.
Target: remake parser part 8 (7:22) at equal-or-better quality, with a script under 1/3 the tokens of `d8.body.html + d8.js` (39,037 chars). Builds: warm ≤ 20 s, cold ≤ 45 s; the hand-built baseline is 187 s with audio cached.

## 0. Shape of the system

```
script.md ─ parse ─► IR ─┬─► page.html (runtime + blocks + theme + IR) ─► layout + lint (Chrome) ─► Layouts, SceneEntry[]
                         │
                         └─► voiceScene(k) ×all, parallel ─► VoicedScene[k]          (clock A, cached)
VoicedScene[k] + IR ─► planScene(k) ─► ScenePlan[k]                                   (clock S; owns all timing)
ScenePlan[k] + SceneEntry[k] ─► renderScene(k) ─► segment k                           (N pages, VideoToolbox)
segments + planned narration ─► MP4 ; plans ─► .srt, step-through .html, contact sheets
```

- Everything is per scene. A scene is captured as soon as its own audio is verified.
- Stage: 1280×720 CSS px at deviceScaleFactor 1.5 → 1920×1080, **30 fps only**.
- Stack: Bun (CLI, bundler, tests), puppeteer-core on a pinned `chrome-headless-shell` (cached on first run), ffmpeg/ffprobe from PATH.

---

## 1. The script language

### 1.1 Design rules
- The author says **what is on screen and when**. Never where, how big, or what colour.
- One namespace of short lowercase ids. Anything with an id can be targeted from anywhere in its scene.
- Visibility is inferred: a thing starts hidden iff its first cue in the scene is `show`, `grow`, or a swap-in. There are no hidden flags. A block with no block-level cue whose items all start hidden starts hidden too, and appears with its first item (round 5 ruling: no empty frame), unless its other parts are content (a title's heading, a table's header, a custom drawing). Block-level visibility is inferred afresh in every scene, reused blocks included; a reused block inherits only its item visibility, `set` values and markers.
- Narration is exactly what is spoken. Cues sit inline and fire on the next word.

### 1.2 File structure

```
file      := frontmatter? (chapter | scene)*
frontmatter := '---' NL yaml-subset '---' NL
chapter   := '# ' text NL                      -- label in the header chrome until the next '#'; auto-numbered
scene     := '##' (' ' headline)? NL item*     -- '##' alone = no headline
item      := block | reuse | paragraph | comment | blank
block     := ':::' SP type (SP id)? (SP arg)* NL body ':::' NL
           | ':::' SP 'code' (SP id)? (SP arg)* SP 'src=' path (':' int '-' int)? (SP arg)* NL   -- sourced code: no body, no fence
reuse     := ':::' SP id (SP '@' region)? NL    -- re-place a block from an earlier scene; no body, no closing fence
paragraph := non-blank narration lines (joined with spaces) = one BEAT
comment   := '<!--' ... '-->'                   -- outside block bodies
```

| front matter | meaning | default |
|---|---|---|
| `title` | video title; output slug | required |
| `series` | small label in header chrome | none |
| `lang` | default language for `code` | `text` |
| `voice` | TTS voice | `Charon` |
| `say` | pronunciation map, `{ LOWEST: lowest, infix: in-fix }` | `{}` |

### 1.3 Block declarations
`::: type id args… @region`
- `type`: one of §3.4. Reserved words: all verbs and `none`; type names, as block ids only.
- `id`: `[a-z][a-z0-9-]*`, unique across the file. Optional if never targeted.
- args: `key=value`, bare flags, and at most one `"quoted string"` (the block's caption: file name, terminal title, chart title).
- `src=path:from-to` (or `src=path` for the whole file), on `code` only: the body comes from that file, relative to the script's directory, and the block has no body or closing fence. Use it for all real code: it cuts tokens and cannot drift from a file that compiles.
- `@region`: `top`, `left`, `main` (default). See §3.3.
- Body: everything until a line that is exactly `:::`. A line-based item may end with ` #name` to give it a global id. In verbatim bodies (`code`, `terminal`) the name needs two or more spaces before it (`x := 1  #init`); sourced code names lines with `name=12:fn,15:loop` instead.
- Declaration order = reading order. Blocks exist from scene start, wherever they are declared in the scene.

### 1.4 Inline text marks (block bodies, `set` values, headlines)
| mark | meaning |
|---|---|
| `` `x` `` | code. A line that is one code span = display code |
| `{em x}` | primary accent |
| `{alt x}` | secondary accent |
| `{ok x}` / `{bad x}` | outcome right / wrong |
| `{box x}` | slot ("hole") |

`{role` is recognised only with a role name directly after `{` and a space, so `{ x + y; }` is literal. Braces inside a role must balance. Roles work inside backticks. `*` is always literal (there is no `*x*` emphasis). `\{` and `` \` `` escape.

### 1.5 Narration and cues

```
cue      := '[' command (';' command)* ']'
command  := verb+ target+                  -- show hide hl dim grow focus; verbs combine: [show hl ex:2]
          | 'set'   target value           -- value = rest of command; inline marks allowed
          | 'move'  target position
          | 'group' target label ('#' id)?
          | 'swap'  target target
target   := id (':' selector)? | 'none'
selector := part (',' part)* ;  part := int | int '-' int | key | 'cur' | 'peek'
```

- **Anchoring.** A cue fires on the next narration word in its paragraph.
- **Beat-start cues.** Cues before a paragraph's first word (on their own line directly above it, or at its very start) fire at **beat start**, so the visual lands before the voice (§4).
- A cue with no following word in its paragraph is an error (E402).
- Cues at the same instant apply in source order. `]` and `;` inside backticks or braces never end a cue or split a command, so `[set tck next: `;`]` is one command.
- A bare `none` target (`[hl none]`, `[focus none]`) applies to every block placed in the scene.

**Spoken form.** TTS gets narration with cues and marks removed. The rules:
- `say` entries apply to backtick content and also to plain-prose words, by whole-word match.
- Other backtick content is split on camelCase, `_` and `.`, and ALLCAPS is lowercased: `` `parseCallExpression` `` → "parse call expression", `` `LOWEST` `` → "lowest".
- Subtitles show the display form.

**Code-ish text in narration.** The author writes speakable prose:
- Backtick content must be letters, digits or `._` (E411: `` `(` `` → "write 'the open bracket'").
- Prose may not contain `( ) [ ] { } < > = * / + |` (E412). The benchmark heard `add(2, 3)` as "add two comma three"; write "add, 2, 3".
- Digits and ordinary punctuation are fine; the diff tokeniser handles them (§5).

**Verbs.** `src/verbs.ts` owns each verb's meaning: which channels it writes and which theme motion token times it. The durations themselves live in `theme/v2/tokens.css` (§11 seam 6).

| verb | effect | timing token |
|---|---|---|
| `show` | hidden/receded → rest. Edges into a tree/graph node draw first | `--dur-appear`, `--stagger` |
| `hide` | → hidden (space stays reserved) | `--dur-hide` |
| `hl` | highlight target. **Exclusive per block**: clears that block's other highlights. Persists until replaced, `[hl none]`, or scene end | `--dur-highlight` |
| `dim` | → receded; `show` restores | `--dur-recede` |
| `set` | replace content/value; the new value holds as "now" for `--dur-settle`, then settles | `--dur-highlight` + `--dur-settle` |
| `move` | marker/pointer to an item | `--dur-move` |
| `grow` | progressive reveal (tree by depth then left to right, graph edges, chart bars/lines). With an item selector it grows that subset, in DFS order | `--dur-grow`, `--stagger` |
| `group` | bracket + label over a contiguous item range; the group gets an id | `--dur-appear` |
| `swap` | `swap a b`: block a leaves its slot and block b enters it; or item↔item position exchange | `--dur-move` |
| `focus` | recede every other block; `[focus none]` clears | `--dur-recede` |
| (scene change) | crossfade | `--dur-scene`, `--ease-in-out` |

**Highlight model** (theme README rule 7; tokens `--hl-now-*`, `--hl-held-*`, `--hl-fill-*`):
- Each block has at most one **now** target: its latest `hl`, `set` or `move` target (the last on that block, in source order, of the most recent cue instant that acts on it while it is visible; round 5 ruling, "now" is per block). Only `hl`, `set` and `move` take now: `show`, `grow`, `swap`, `group`, `hide`, `dim` and `focus` don't (an appearance is not an emphasis; write `[show hl x]` to light what appears). `[hl none]` clears now.
- When a newer cue on the same block fires, that block's previous now target drops over `--dur-highlight`: to **held** if it still has an active `hl` (and the `cur` marker counts as active), otherwise to rest.
- Levels, highest first: now > held > rest > receded.
- A `set` target is now for `--dur-settle` and then settles, even if no newer cue fires.
- `timing` computes all of this as channel spans (§4.4). Blocks only map the `hl` and `now` channels to `--hl-*` tokens.

At a scene change, `hl`, `now`, `dim` and `focus` reset, as spans over `--dur-scene` starting at S = 0 (§3.2). A reused block keeps its item visibility, `set` values and marker positions.

### 1.6 Worked example: part 8 opening
The full script is `examples/part8.md`, the acceptance script the e2e suite builds.

```md
---
title: Call expressions, and a finished parser
series: Your parser, part 8
lang: go
---

##
::: title
Call expressions, and a finished parser
Your parser, part 8 · book pages 93 to 99
- the bracket that sits in the middle
- `CALL`, the tightest precedence
- let and return, finally complete
:::
The last piece of the parser: calling a function. It comes with a neat puzzle, and once it is solved, we tidy up the let and return statements, and the parser is done.

# What a call looks like
## The shape of a call
::: text
`{em <expression>}({alt <expressions, comma-separated>})`
:::
::: table ex
| `add(2, 3)` | the call you know |
| `add({alt 2 + 2}, {alt 3 * 3 * 3})` | arguments can be {alt any expression} |
| `{em fn(x, y) { x + y; }}(2, 3)` | the function can be {em any expression} too |
| `callsFunction(2, 3, {alt fn(x, y) { x + y; }})` | and a function can be an argument |
:::
[show hl ex:1] The shape is: an expression, then a list of expressions in brackets, separated by commas. Start with the call you know: add, 2, 3.

[show hl ex:2] The arguments do not have to be plain numbers. Each one can be any expression: 2 plus 2, or 3 times 3 times 3.

[show hl ex:3] The thing being called does not have to be a name either. It can be any expression that gives a function, like a function literal, called on the spot.

[show hl ex:4] And because functions are values, you can pass one in as an argument.

## Parameters vs arguments
::: compare pa
defining · last video #def
`fn({box a}, {box b}) { a + b }`
{em Parameters}: names the function is waiting for. Only names allowed.
`[]*ast.Identifier`
---
calling · this video #call
`add({box 1}, {box 2 * 3})`
{alt Arguments}: the values you hand over. Any expression allowed.
`[]ast.Expression`
:::
::: text runs
When the call runs, `{em a}` will hold `{alt 1}` and `{em b}` will hold `{alt 6}`. That happens in the evaluator, later in the book.
:::
[show hl def] Quick vocabulary. When you define a function, the names in brackets are parameters. They are only names, waiting for values.

[show hl call] When you call a function, the things in brackets are arguments. They are the values you hand over, and each can be any expression.

[show runs] When the call actually runs, a gets 1 and b gets 6. But that is the evaluator's job, later in the book. The parser only records the shape.

# The node
##
::: code ast @left "ast/ast.go · book code"
type CallExpression struct {
  Token     token.Token // the '(' token
  Function  Expression  // Identifier or FunctionLiteral
  Arguments []Expression
}
func (ce *CallExpression) expressionNode() {}
func (ce *CallExpression) TokenLiteral() string {…}
func (ce *CallExpression) String() string {…}
... prints add(1, (2 * 3), (4 + 5))
:::
::: tree ctree "the tree for add(1, 2 * 3, 4 + 5)"
{em CallExpression} #ce
  Function | add #fn
  Arg 0 | 1
  Arg 1 | *
    2
    3
  Arg 2 | +
    4
    5
:::
::: callout fnote
Function is an {em Expression}, not just a name, so a function literal fits there too. Its Token is the `{em (}`, the token that marks the call.
:::
[hl ast:1-5] The node has the function, and a list of arguments. Here is [grow ctree; hl ce] the tree for the book's test: add, called with 1, 2 times 3, and 4 plus 5.

[hl ast:2-3; show fnote; hl fn] Function is any expression, not just a name, so a function literal fits there too. And the token stored in the node is the open bracket. That is a clue for what comes next.
```

The CS-pack verbs, from the trace section (`pexpr` was declared in an earlier scene):

```md
# Tracing add(1, 2 * 3, 4 + 5)
##
::: tokens tk markers=cur,peek
add ( 1 , 2 * 3 , 4 + 5 ) ;
IDENT LPAREN INT COMMA INT ASTERISK INT COMMA INT PLUS INT RPAREN SEMICOLON
:::
::: pexpr @left
::: stack frame
CallExpression 0xc210 #ceb
  Token: (
  Function: nil #cfn
  Arguments: nil #cargs
:::
::: text tck
—
:::
[hl pexpr:2-3; move tk 1] Now the full trace. `parseExpression` starts at `LOWEST`. The current token is add, an identifier, so [set tck leftExp = `add`] `leftExp` becomes add.

[hl pexpr:4,6-7; move tk 2; set tck next: `(` CALL 7 · mine: `LOWEST 1` · {ok 1 < 7, the ( takes add}] The loop checks the next token: the bracket, now `CALL`, 7. Is `LOWEST` less than 7? Yes. So it steps onto the bracket and calls `parseCallExpression`, handing it add. [show ceb; set cfn add] Add becomes the function.

[move tk 3; group tk:3 arg 0 #a0] `parseCallArguments`. The list is not empty, so it steps onto 1 …
```

Size: this opening (title, shape, parameters and the node, 10 beats) is 3,449 characters. For the whole remake, see `examples/part8.md` and §10.

### 1.7 Error format
All errors are collected (max 50) and printed in compiler style, each with a fix. `--json` gives `{file,line,col,code,message,fix}`.

```
part8.md:57:14: error E201: unknown target "ex:5"; table "ex" (line 41) has rows 1-4
  fix: use ex:1 … ex:4, or add a row to the table
part8.md:88:3: error E305: verb "move" is not supported by text "tck"
  fix: move works on tokens (markers) and code (pointer); for text write [set tck …]
part8.md:120:40: error E402: cue has no word after it in this paragraph
  fix: put it before a word, or on its own line above the next paragraph
part8.md:131:9: error E412: "add(2, 3)" cannot be spoken reliably
  fix: write it as words, e.g. "add, 2, 3"
part8.md:102:1: error L410: scene 14 "The finished Pratt table" is overfull: even row gap 9px < row-gap-min
  fix: split the scene; the table alone needs 612px of 540px
```
Code families: E1xx syntax, E2xx references, E3xx verb/semantics, E4xx narration, L4xx layout, A5xx audio, T6xx timing.

---

## 2. IR

`src/ir.ts` is frozen on day 0. `parse(text, file) → {ir, errors}` is pure and does all resolution and validation; there is no public AST stage. Where the sketch below and `src/ir.ts` differ (variant-typed `Cue`, structured `Reachable`/`initialVis`, `IdRef`; `docs/reviews/day0-rulings.md`), the file is authoritative.

```ts
export type Id = string;
export type Region = 'top' | 'left' | 'main';
export type Verb = 'show'|'hide'|'hl'|'dim'|'set'|'move'|'grow'|'group'|'swap'|'focus';
export interface Loc { line: number; col: number }

export interface Script {
  file: string;
  meta: { title: string; slug: string; series?: string; lang: string; voice: string;
          ttsModel: string; say: Record<string, string> };
  blocks: Record<Id, BlockDecl>;               // anonymous blocks get "_b12"
  ids: Record<Id, { block: Id; item?: string }>;
  scenes: Scene[];
}
export interface BlockDecl {
  id: Id; type: string; loc: Loc; scene: number;
  args: Record<string, string | true>; caption?: string;
  body: unknown;                               // typed per block module
  items: ItemDecl[];                           // in reading order
}
export interface ItemDecl { key: string; index: number; name?: Id; kind: string; depth?: number; loc: Loc }

export interface Scene {
  index: number; loc: Loc; chapter?: { n: number; text: string }; headline?: string;
  placements: { block: Id; region: Region; reused: boolean; loc: Loc }[];
  swapSlots: [Id, Id][];
  beats: Beat[];
  initialVis: Record<Id, Record<string, boolean>>;  // newly declared blocks only; reused ones inherit (§3.2)
  reachable: Record<Id, Record<string, Inline[]>>;  // every content each item can hold in this scene, incl. inherited and group labels (§3.3)
}
export interface Beat { loc: Loc; words: Word[]; startCues: Cue[] }
export interface Word { display: string; spoken: string[]; loc: Loc; cues: Cue[]; edge: boolean }  // edge = first/last word of its paragraph
export interface Cue { verb: Verb; targets: Target[]; value?: Inline; num?: number; label?: string; groupId?: Id; loc: Loc }
export interface Target { block: Id; sel: Selector; loc: Loc }
export type Selector =
  | { kind: 'block' } | { kind: 'items'; keys: string[] }
  | { kind: 'marker'; name: string } | { kind: 'none' };
export type Inline = (string | { role: 'code'|'em'|'alt'|'ok'|'bad'|'box'; children: Inline })[];
```

A multi-verb command (`[show hl x]`) expands to one `Cue` per verb. A word is a **cue anchor** iff `cues.length > 0`.

**Validation.** A symbolic pass runs over each scene's cues in order, keeping visibility, hl and markers.
- Ids are unique, well-formed and not reserved. Reuse refers to an earlier declaration. A block is placed at most once per scene.
- Targets are placed in the current scene. Selectors are in range and of a kind the block accepts. The verb is allowed for that selector kind.
- `set` has a value. `move` has a position. `swap` pairs are in one scene and region, and both are blocks or both are items of one block.
- No `hl`/`set`/`move` on a hidden thing (the error names where it gets shown). `show` on a visible thing is a warning.
- Every scene has narration or a block. A scene over 400 spoken words is an error (E420, "split the scene").
- Speakability: E411 and E412 (§1.5).
- W330 fires only when two `hl` cues on one block fire at the same instant: `hl` is exclusive per block, so the second replaces the first.

---

## 3. Blocks

### 3.1 Contract
One file per block, `src/blocks/<pack>/<type>.ts`, exporting a `BlockModule`. The compile half runs in Bun and the runtime half is bundled into the page. **Blocks never see time or cues**; they receive evaluated state.

```ts
// src/blocks/contract.ts — frozen day 0
export interface BlockModule<B = unknown> {
  type: string; pack: 'core' | 'cs';
  args: Record<string, 'flag' | 'string' | 'int' | string[]>;
  defaultRegion?: Region;
  flexible: boolean;                            // true: grows to fill leftover width (tree, graph, tokens); false: natural width (code, prose)
  parse(body: BodyLine[], args: Args, ctx: ParseCtx): { body: B; items: ItemDecl[] };  // throws ctx.error(loc, code, msg, fix)
  prepare?(body: B, args: Args): Promise<B>;    // async compile work (shiki, KaTeX); build awaits all after parse, before the page is built. parse stays pure and sync
  verbs: Partial<Record<Verb, Array<Selector['kind']>>>;
  markers?(body: B, args: Args): string[];
  runtime: BlockRuntime<B>;
}
export interface BlockRuntime<B> {
  /** Build DOM once. Every item is sized to the envelope of all its reachable contents, so geometry never changes later. */
  mount(el: HTMLElement, body: B, args: Args, reachable: Reachable): void;   // Reachable: src/ir.ts
  /** Natural width, and height at a given width. Flexible blocks also lay their rows out across `width` (theme rules 1, 13). */
  measure(el: HTMLElement, width: number): { natural: number; height: number };
  /** Cache anchors (edges, markers, group brackets) after layout. Called once per scene. */
  geometry?(el: HTMLElement): void;
  /** Apply evaluated state. Pure and idempotent; reads no layout. */
  render(el: HTMLElement, s: BlockState): void;
  lint?(el: HTMLElement): LintIssue[];
}
export interface Channels { vis: number; hl: number; now: number; recede: number; grow: number }   // 0..1, eased. hl = highlight active (fill); now = amber vs held (§1.5)
export interface Content { cur: Inline; prev?: Inline; p: number }   // p: 0 = prev fully shown, 1 = cur fully shown
export interface ItemState extends Channels { content?: Content; value?: number }   // value: evaluated number (chart)
export interface BlockState {
  self: Channels & { content?: Content };       // block-level set (callout, text)
  items: Record<string, ItemState>;
  markers: Record<string, number>;              // fractional item index
  groups: { id: Id; from: number; to: number; label: string; vis: number }[];
  swap?: { with: Id; p: number };
}
```

`prev` and `p` exist so that a trace can strike through the old value and a `set` can crossfade, without the block keeping any history. Block CSS/TS holds no literal colours, sizes, radii, durations or easings.

### 3.2 State and scene boundaries
- `stateAt(spans, t)` (`src/runtime/state.ts`) evaluates the scene's compiled channel spans (§4.4). It is generic and knows no block types.
- **SceneEntry** (`src/runtime/boundary.ts`) is computed in the page at load, from IR + layouts, before any capture. Every page computes it identically. For each scene k it holds:
  - **entry state**: for reused blocks, the settled final state of their previous placement (visibility, content, markers);
  - **outgoing presentation**: the settled final state of scene k−1, frozen, drawn under the crossfade;
  - **carry-over**: per reused block, `static` only if all four match between the outgoing and incoming scene, otherwise `crossfade`:
    - the region;
    - the outer rect;
    - the internal geometry (a hash of every item and leaf rect plus the cached anchors from `geometry()`), which catches envelope changes from new reachable content;
    - the entry presentation at S = 0, compared to the outgoing final presentation.

    Scene-change resets (`hl`, `now`, `recede`) are spans starting at S = 0 from the outgoing values, so they never break the last condition.

  Settled states are timing-independent, so SceneEntry needs no audio.
- Scene k+1 rendered directly in a fresh page, and again after arbitrary other scenes, gives byte-identical frames (the e2e suite checks it as cold, warm and `LECTERN_SHOOT_EVERY_RUN` builds giving identical outputs).

### 3.3 Layout
Founder ruling: *"Content on the screen should be evenly spaced across the whole scene. Each frame should look aesthetic by itself."*

The rules and every threshold live in **`theme/README.md` (Composition, rules 1–4) and `theme/v2/tokens.css`**. `src/runtime/layout.ts` implements them and holds no numbers of its own.

Mapping script → rows. A frame is the headline, anchored at the top margin, then a vertical list of **rows**:
- each `@top` block is its own row, above the body row (tokens default here);
- if any block is `@left`, the body is one row of two regions, `left | main`. Blocks in a region stack with `--stack-gap`;
- otherwise each `main` block is its own row.

Per scene, at load, in the real browser:
1. **Envelopes first.** Each block mounts with `Scene.reachable`, so every item is sized for its largest content. Hidden things keep their space (opacity only). Geometry is computed once and frozen.
2. **Rows span the content box** (rule 1). Token strips flex cells between `--cell-min` and `--cell-max`. Below the minimum is overfull (L410); at the maximum the row is centred.
3. **Side-by-side** (rule 2). The non-flexible region takes its natural width, and the flexible one fills the rest (tree sibling gap within `--tree-gap-min..max`); two flexible regions share the leftover width equally. Code never wraps: the code column is sized to its longest line first, and code that doesn't fit is L410 (fix: `@main`, a narrower companion block, or a shorter `src=` range). Slack is shared evenly across the outer edges and gutter, so the row's envelope is centred. Each region's content is centred in it both ways, optically per rule 14. Prose is capped at `--measure-max`.
4. **Sparse frames scale up** (rule 9). If the rows fill less than `--sparse-fill-min` of the body height, the scene's type scale becomes min(`--scale-max`, the largest scale at which every row still fits the content width and the even gap stays ≥ `--row-gap-min`). The scale is per scene and uniform. It runs before step 5, so a frame is never a small island in a big void.
5. **Even vertical spacing** (rule 3). All height below the headline is shared evenly above, between and below rows. An even gap under `--row-gap-min` means the frame is overfull: L410, "split it, don't squeeze it". There is no shrink-to-fit.
6. `geometry()` caches anchors. `render` never reads layout.

**Layout lint** (`src/runtime/lint.ts`, gate G2). Runs in Chrome per scene.

Geometric checks, at the initial state and at each cue instant's settled state, over visible `[data-leaf]` elements:

| code | check |
|---|---|
| L401 | off-stage, or outside the content box |
| L402 | text overflow (`scrollWidth > clientWidth + 1`, or clipped) |
| L403 | two non-nested leaves overlap |
| L404 | an edge crosses a leaf that is not its endpoint |
| L405 | rendered text is `undefined`, `NaN`, `[object`, or empty where content was declared |
| L406 | text below the theme floor |
| L410 | overfull (from layout) |

### 3.4 Catalogue v1
Selectors: `n` = 1-based item index, `n-m` ranges, `key` = block-local key, `#name` = global id. `S H L D` = show/hide/hl/dim.

| block | body syntax | items / selectors | verbs |
|---|---|---|---|
| **title** | line 1 title, line 2 subtitle, `- ` chips | chips | S H L D |
| **text** | inline text lines; a one-code-span line = display code | lines | S H L D set |
| **callout** | inline text | block | S H L D set |
| **bullets** | `- item` (flat) | items | S H L D set swap |
| **checklist** | `- [ ] item` / `- [x] item` | items; `set c:2 done\|todo` | S H L D set |
| **table** | GFM rows; a `\|---\|` line makes the row above a header | rows (header excluded), cells `r.c` | S H L D set swap |
| **compare** | columns split by `---`; first line = label | columns | S H L D |
| **code** | verbatim, never wrapped. `... text` = gap row (not counted in numbering); `... @159` renumbers. Args `"file"`, `lang=`, `from=N` (numbers), `diff` (exactly `+ `/`- ` prefixes; `- ` lines count), `src=path:from-to` (body from a real file; numbers and caption from the file), `name=12:fn,15:loop` (line names for sourced code) | lines (displayed number if `from` or a `src` range, else code-line index); marker `ptr` | S H L D set move group swap |
| **tree** | indented 2 spaces/level; `caption \| label`. Nodes size to their label, `--node-w` minimum | nodes (DFS) or `#name` | S H L D set grow (block or item subset); show draws the incoming edge |
| **graph** | `key: label` nodes, `a -> b: label` edges; `dir=LR\|TB` | node keys; edges `a>b` | S H L D set grow |
| **stack** | unindented `Title tag?` = frame (tag optional); indented `key: value` rows | frames, rows `#name` or `n.key` | S H L D set; show pushes, hide pops |
| **chart** | `label: v`, or `x: a b c` + `series: v v v` | bars/series | S H L D set (animated value) grow |
| **math** | KaTeX, one equation per line, rendered at compile time | lines | S H L D set |
| **custom** | sanitised inert HTML/SVG (below); `data-id` → global ids | `data-id` elements | S H L D set(text) |
| **tokens** (cs) | line 1 lexemes (`""` empty, quotes for spaces); optional line 2 types; `markers=cur,peek` | tokens; markers; groups | S H L D set move group swap |
| **terminal** (cs) | verbatim lines (no inline marks); `$ ` = command; `"title"` | lines | S H L D set |
| **trace** (cs) | `name = value` rows; `"title"` | rows by name | S H L D set (old value struck during the settle) |

- **Markers and groups** (theme rule 12): group bracket and label sit **above** the span, `cur`/`peek` sit **below** the cell, so they cannot collide. `move tk 3` moves the first marker, and later markers keep their offset; `move tk:peek 5` moves one marker. Markers are hidden until their first move; before it, each later marker sits one item after the previous (peek = cur + 1).
- **Layout engines.** Trees use d3-flextree on measured node sizes, with orthogonal connectors per rule 13. Graphs use dagre. Code highlighting uses shiki `css-variables` at compile time.
- **`custom` sanitiser** (compile time, allowlist):
  - Elements: HTML text/structure (`div span p b i code pre ul ol li table tr td th`) and static SVG (`svg g path rect circle ellipse line polyline polygon text tspan defs marker use`, with local `href` only).
  - Attributes: `class`, `data-id`, SVG geometry/presentation, and `style` minus `animation*`/`transition*`.
  - Rejected with E150: scripts, `on*`, `javascript:`, SMIL (`animate*`, `set`), `foreignObject`, `iframe`/`object`/`embed`, `video`/`audio`, `img` with external src.

  The stage stylesheet disables CSS animations and transitions in both capture and the exported HTML. The player controls sit outside the stage.
- **Build order** within the blocks lane: whatever the part 8 remake uses (title, text, callout, table, compare, code, tree, stack, tokens, bullets), then terminal, trace, checklist, custom, then graph, chart and math last.

---

## 4. Timing model

`src/timing/` owns **every clock, every conversion, every rounding rule and every constant below**. Callers receive ready-to-use instructions:
- the renderer gets (frame → page time) and repeat counts;
- audio assembly gets sample copies;
- the player gets a global → scene lookup.

No other module knows the frame rate, the sample rate or the splice constants.

```ts
planScene(scene: Scene, voiced: VoicedScene, motion: MotionTokens) → ScenePlan | TimingError[]   // pure
toGlobal(plans: ScenePlan[], k: number, s: number) → number                  // S → G seconds (.srt, sheets)
locate(plans: ScenePlan[], g: number) → { scene: number; t: number }         // G → (scene, S) (player, scrubber)
```

### 4.1 Clocks
| clock | origin | unit | produced by | consumed by |
|---|---|---|---|---|
| **A** audio-local | start of the processed, unspliced scene audio | s | `voiceScene` (word timings, cached) | `planScene` only |
| **S** scene-local, post-splice | first frame of scene k | s | `planScene` | page `render(k, t)`, via the plan |
| **G** global | first frame of the video | s | `toGlobal` / `locate` | .srt, step-through player |

Internal rules, visible only inside `src/timing/`:
- `FPS = 30`, `RATE = 48000`, `SPF = RATE / FPS = 1600` samples per frame.
- Frames are authoritative integers. Frame f of scene k is page time `S = f / FPS`.
- `startFrame_k = Σ_{j<k} F_j`, and `G = startFrame_k / FPS + S`.

### 4.2 Splice map (A → S)
Inputs: A-clock word timings with paragraph membership, and `span(p)`, the longest compiled span among beat p's start cues. `span(p)` depends only on cue structure and theme tokens (§4.4), so there is no circularity.

Constants (s): `LEAD_MIN 0.4`, `GAP_MIN 0.8`, `GAP_MAX 1.6`, `PAD 0.05`, `PREROLL 0.12`, `BEAT_OFFSET 0.1`, `TAIL 0.9`, `HOLD 0.5`, `END_EXTRA 1.5`, `SILENT_SCENE 2.5`.

For paragraph p, with `a_on(p)`, `a_off(p)` = first word start and last word end in A:
```
clip(p)   = [a_on(p) − PAD, a_off(p) + PAD]        clamped to [0, audioDur] and to the midpoint of each A-gap
onset(0)  = clamp(span(0), LEAD_MIN, GAP_MAX)      voice onset of beat 0 (S)
onset(p)  = end_S(p−1) + gap(p),   gap(p) = clamp(span(p), GAP_MIN, GAP_MAX)        p ≥ 1
δ(p)      = onset(p) − a_on(p)                     S = A + δ(p) for every A in clip(p)
end_S(p)  = a_off(p) + δ(p)                        gap = previous speech end → next voice onset
```
The map is piecewise-translational and monotonic, because `gap ≥ GAP_MIN > 2·PAD`.

### 4.3 Beats and cue times (S)
```
beatStart(0) = 0                                   (concurrent with the scene crossfade)
beatStart(p) = end_S(p−1) + BEAT_OFFSET            p ≥ 1
cue time     = beatStart(p)                                     beat-start cue
             = max(beatStart(p), start_A(word) + δ(p) − PREROLL)   word cue
```
Cues at equal times keep source order.

### 4.4 Channel spans
`compileSpans(scene, cueTimes, motion) → Span[] | TimingError[]` runs once per scene. Every later time computation consumes its output.

```ts
interface Span { block: Id; item?: string;
                 channel: 'vis'|'hl'|'now'|'recede'|'grow'|'content'|'value'|'marker'|'group'|'swap'|'scene';
                 t0: number; t1: number; from: number | Inline; to: number | Inline; ease: EaseName }   // S seconds
```
- **Durations and easing** come from the verb's theme tokens. Stagger is `min(i, --stagger-max) × --stagger` in reading order (trees by depth then left to right).
- **`set`** emits a `content` span (prev→cur over `--dur-highlight`) and a `now` span: 1 at `t0`, held for `--dur-settle`, then → 0 (or → held level) over `--dur-highlight`.
- **Highlight levels.** `hl` writes the `hl` channel. The now pointer (§1.5) writes `now` spans: the new target 0→1, and the previous target 1→0, both starting at the cue time.
- **Scene change.** For k > 0 there is a `scene` span `[0, --dur-scene]`. Reused blocks get reset spans `hl`/`now`/`recede` → 0 over the same interval, starting from their outgoing values.
- **Continuity.** A numeric channel's `from` is its evaluated value at `t0` under earlier spans, so there is no jump.
- **T602: overlapping content transitions are an error.** A `content` span that starts while another `content` span on the same item is still running would need three visible values at once. The error is "`set` at 88:3 overlaps the `set` at 87:40 on `tck` (still swapping); fix: move the cue later or merge the values". Estimate mode reports it too.
- **Derived values**, all in S, all computed here:
  - **capture set:** frame f is unique iff f = 0, or some span has `t0 ≤ f/FPS < t1 + 1/FPS`.
  - **settle(p):**
    - X = max `t1` over beat p's spans if it has cues, else `end_S(p) + HOLD`;
    - `settle(p) = min(X, next)`, where next = `beatStart(p+1)` for a non-final beat and the scene end for the final beat;
    - then quantised down to a frame time.

    The cap is safe because a span at its `t0` still evaluates to `from`.
  - **scene length**, computed in seconds and quantised once, last:
    ```
    lastSpan = max t1 over all spans (0 if none)
    raw = narrated ? max(end_S(last) + TAIL, lastSpan + HOLD)
                   : max(SILENT_SCENE,       lastSpan + HOLD)
    if k is the final scene: raw += END_EXTRA
    F_k = ceil(raw × FPS − 1e−9)
    ```
    Motion can never be cut off.

### 4.5 ScenePlan (what callers get)
```ts
interface ScenePlan {
  scene: number;
  frameCount: number;                                   // F_k
  frameRate: { num: 30; den: 1 };                       // opaque to callers; passed through to ffmpeg as-is
  capture: { t: number; repeat: number }[];             // in order: render the page at t (S), the image holds `repeat` frames; Σ repeat = frameCount
  audio: { totalSamples: number;                        // = frameCount × SPF
           copies: { srcSample: number; dstSample: number; length: number; fadeSamples: number }[] };  // from the A-clock wav
  words: { start: number; end: number }[];              // S, one per IR Word (srt via toGlobal)
  beats: { start: number; onset: number; end: number; settle: number }[];   // S; settle is frame-aligned
  spans: Span[];                                        // page evaluates these (stateAt)
}
```
- **Renderer:** `for (c of plan.capture) { render(k, c.t); capture; write image with c.repeat }`. It never computes a time.
- **Audio assembly:** zero-filled buffer of `totalSamples`; apply `copies`. No seconds anywhere.
- **Player:** `locate(g)` for scrubbing and audio sync; beats' `settle` for ←/→.

**Estimate mode** (`check`, `shots`, `--no-audio`) builds a synthetic `VoicedScene` (3.5 words/s, fitted on 80 voiced scenes; 0.3 s per comma or period), so every other step is identical.

**Determinism.** `render(k, t)` depends only on (IR, layouts, SceneEntry, ScenePlan, t). The runtime bundle contains no `Date`, `performance` or `Math.random`. Fonts are local and awaited. Two fresh pages must produce byte-identical frames for 20 random (k, t).

---

## 5. Audio

`src/audio/`: `voiceScene(scene, ir) → Promise<VoicedScene>`. It hides providers, wire formats, caching, retries, hedging, normalisation and verification. All scenes start at once.

```ts
interface VoicedScene {                       // clock A only
  scene: number; wav: string; duration: number;
  words: { start: number; end: number; source: 'heard' | 'split' | 'approx'; conf?: number }[];  // one per IR Word
  diff: DiffReport;                           // fail reasons, W510/W511 warnings
  attempts: number; stt: 'scribe-v2' | 'nova-3';
}
```

1. **Text.** The scene's spoken paragraphs joined with `\n\n`, and nothing else.
2. **TTS.** Gemini `gemini-3.8-flash-tts:generateContent`, `responseModalities:["AUDIO"]`, `voiceName = meta.voice`. It returns `audio/wav` at 24 kHz (measured); decode any container generically.
3. **Hedging.** For each scene, fire **2 TTS attempts at once**. Verify whichever finishes first, use the first attempt that passes, and abort the other. If both fail, fire another; **at most 4 attempts**, then fail G3 with the lowest-WER attempt kept for diagnosis. Concurrency cap is 32 TTS and 16 STT in flight.
4. **Process** (one ffmpeg call per attempt):
   - trim silence at −45 dB;
   - `atempo = clamp(160 / wpm, 1.0, 1.25)`;
   - `ebur128` measure, then linear gain to −16 LUFS, peak ≤ −1.5 dBTP;
   - output 48 kHz mono.
5. **STT.** OpenRouter `/api/v1/audio/transcriptions`: multipart `file` (16 kHz mono FLAC, WAV fallback), `model=elevenlabs/scribe-v2`, `timestamp_granularities[]=word`, `response_format=verbose_json`. Keep word entries with text, start, end and confidence. Fallback `deepgram/nova-3` is used when Scribe exhausts its retries, and to resolve anchors (step 8). Wire formats live only in `src/audio/stt.ts`.
6. **Tokenise** (one pass over both sides, provenance kept). Recognise, before any folding:
   - decimals, integers, ordinals, `%`, `&`;
   - camelCase and ALLCAPS boundaries;
   - `_ . -` separators, contractions; a `.` between letters, or before letters at a word's start, is the word "dot" (recognisers write "example dot com" as `example.com`, "dot git" as `.git`).

   A spoken decimal may start at "point": "point zero nine two" is 0.092, as `0.092` and `.092` are.

   Then expand numbers to words and lowercase. Each output token keeps its source word index. Frozen examples:

   | input | tokens |
   |---|---|
   | `2.5` | two point five |
   | `CALL 7` | call seven |
   | `parseCallExpression` | parse call expression |
   | `50%` | fifty percent |
   | `don't` | don't |
   | `a & b` | a and b |
   | `1st` | first |
   | `p.nextToken()` | p dot next token |
   | `example.com` | example dot com |
   | `.092` | point zero nine two |
   | `x-ray` | x ray |
   | `Add, 2, 3` | add two three |
7. **Diff.** Tokens become units first: a number (digits or any spoken reading: "nineteen seventy five", "four hundred and eighty", "$400,000") is its value; a word is its spelling key (accents, possessive or plural s, and British -our/-re/-ise dropped from long stems); a `say` word matches its display form or its respelling. Levenshtein over units; adjacent heard tokens are also tried joined (edit distance ≤ 2) so a split aligns as one substitution.
   - **Fail** if any insertion or deletion run is ≥ 2 tokens, if WER > 5%, or if the last 3 script tokens are unmatched.
   - **Warn W510** on each substitution or split ("heard 'in fixed' for 'infix'"), and **W511** on a single deleted word. Both are reviewable, with the fix `say: { infix: in-fix }`. They are listed in `build.json` and on the contact-sheet tile.
8. **Timing provenance.** A script word gets `heard` (direct match), `split` (joined match: first onset, last end) or `approx` (interpolated).
   - **Cue anchors and paragraph-edge words must not be `approx`.**
   - If any are, run nova-3 on the same audio and take its matches for those words. If still unresolved, the attempt fails timing verification (T601) and counts as a failed attempt.
9. **Cache.** `key = sha256({provider, model, voice, spoken text, PIPELINE_V})` → `~/.cache/lectern/voice/<key>.{wav,json}`.
   - It stores the **verified, processed, unspliced** audio and the heard tokens with times and provenance.
   - On a hit, the projection onto the current IR words (steps 7–8) is re-run. It is cheap, and the visual-only edits that change splices or word splits stay correct because splicing and timing always run in `planScene` on the current script.
   - Failed attempts are never cached; they are kept in `.work/` for diagnosis.
10. **HTTP retries.** Backoff 1, 2, 4, 8, 16 s on 429/5xx/timeout, honouring `Retry-After`, 60 s timeout per call. STT that can't verify fails G3; it never passes silently.

---

## 6. Renderer and outputs

`src/render/`: `renderScene(k, plan, page) → segment`. It hides Chrome, capture format, the pool and ffmpeg.

**Page API** (`src/runtime/page.ts`):
```ts
window.lectern = { ready: Promise<void>, layouts(): Layouts,
                   plan(k: number, p: ScenePlan): void,          // hand the page its spans
                   render(k: number, t: number): void,           // t is always a value taken from the plan (capture[].t, beats[].settle) or from locate(); the page never derives one
                   settle(k: number, cueCount: number): void,    // timing-free settled state (lint, estimate sheets)
                   lint(k: number): LintIssue[] }
```
`ready` resolves after fonts, all scene layouts, and SceneEntry. Chrome flags: `--force-color-profile=srgb --font-render-hinting=none --disable-lcd-text --hide-scrollbars --disable-gpu`.

**Capture.** For each `plan.capture` entry in order: `evaluate(render(k, c.t))`, then CDP `Page.captureScreenshot`. The image is stored with `c.repeat`. A job is one scene, and the pool spawns an encode when a scene finishes capturing. The format and pool size are **calibration candidates, locked from §10.3 data**:
- **Default candidate: JPEG q92** (`optimizeForSpeed`). Chrome encodes it 3–4× faster than PNG, it is 5–8× fewer base64 bytes, and decode is cheaper.
- **Control: PNG → VideoToolbox.** JPEG adds a lossy stage that the final yuv420p does not make free, so the calibration measures luma and chroma edges.
- Rejected: raw capture (not offered by CDP); screencast (asynchronous to `render(t)`); `beginFrame` (unsupported on macOS).
- Pool size N is swept over {2, 4, 6, 8}.

**Encode per segment.** The ffconcat is generated from `plan.capture` with an **explicit time base of 1/R** (R = `plan.frameRate`, passed through). Without it, still-image inputs default to 25 fps and `fps` would silently drop or repeat planned images.
- Every `file` entry, **including each hold's repeated last image** (it makes the final hold explicit and makes a seek inside a hold land on the held image), is followed by `option framerate R`, so each image input is read at R.
- Each entry also gets `duration` = `repeat / R`, written as an exact rational string.
```
ffmpeg -f concat -safe 0 -i k.ffconcat -vf "fps=R,scale=out_color_matrix=bt709:out_range=tv,format=yuv420p"
  -frames:v <plan.frameCount> -c:v h264_videotoolbox -profile:v high -q:v Q -allow_sw 0 -g 300
  -color_primaries bt709 -color_trc bt709 -colorspace bt709 k.mp4
```
- `-frames:v` bounds the count.
- Frame i shows the image the plan assigns to frame i, which a count check alone would not catch (drops and repeats). The e2e suite grabs frames mid-hold and matches them to the contact sheets.
- After encoding, `ffprobe -count_frames` must equal `plan.frameCount`, or the build fails (R701) before concat.
- `Q` is locked by §10.3.

**Narration and mux.** Per scene: a zero buffer of `plan.audio.totalSamples`, with `plan.audio.copies` applied from the cached A-clock wav. Then concat → AAC 128 kb/s → `narration.m4a`. Mux: `ffmpeg -f concat -i segments.txt -i narration.m4a -c copy -movflags +faststart`. Asserted:
- `totalSamples = frameCount × SPF` for every plan (the e2e suite checks the MP4's audio against build.json's frames);
- the mux step checks that the muxed audio sample count equals Σ `audio.totalSamples`, and the video frame count equals Σ `frameCount`.

The renderer never multiplies by a rate itself.

**Subtitles.** One function, `subtitles(scene, plan)` in `src/timing/subtitles.ts`, cuts the narration into cues: display form, ≤ 2 lines × 42 chars, ≤ 6 s each. The page burns the current cue into every frame, in a `--subtitle-band` the layout reserves under the body (ruling, `docs/rulings.md`). The `.srt` sidecar is the same cues shifted by `toGlobal`. The MP4 has no subtitle track.

**Step-through HTML.** One self-contained file: runtime, theme, fonts, IR, plans, narration (base64 m4a).
- The audio element is the clock; `locate(plans, audio.currentTime)` gives (scene, t).
- ←/→ jumps to each beat's `settle`.
- Scrubber, scene list, and the beat's narration text under the stage (never in the video).

**Contact sheets.** See §7.

---

## 7. Quality gates

| gate | check | blocks MP4 |
|---|---|---|
| G1 schema | parse + validate (§2) | yes; nothing else runs |
| G2 layout | geometric lint at every cue instant (§3.3) | yes |
| G3 audio | per-scene diff + anchor timing verification (§5.7–8) | yes |
| G4 contact sheet | always produced; paths printed last with "Read every sheet before finishing" | n/a (the skill enforces looking) |

With `--force`, the MP4 is written despite failures and `build.json` records `forced: true`. HTML, .srt and sheets are always written.

**Contact sheet.** `<out>/sheets/sheet-NN.png`, 1920×1530: a 3×4 grid of 640×360 tiles (DSF 0.5), one per beat at `settle(p)`.
- Label strip: `S3·B2  0:41  "Look at where the open…"`.
- Lint issues are red rects with their code, and those tiles get a red label.
- W510/W511 appear as an amber line on their beat's tile.

`lectern shots` produces the same in estimate mode, with no network.

---

## 8. CLI and on-disk layout

```
lectern check  <script.md>                 G1 + G2. No network. Target < 3 s.
lectern shots  <script.md> [--scenes 3-5]  G1 + G2 + sheets, estimate mode. No network.
lectern build  <script.md> [flags]
  --out <dir>    default ./out/<slug>/
  --scenes 3-5   subset (outputs suffixed .s3-5)
  --force        MP4 despite failing gates
  --no-video     audio + srt + html + sheets
  --no-audio     estimate timing, silent video
  --revoice 4,7  bypass voice cache for these scenes
  --jobs N  --keep  --json
exit: 0 ok · 1 gate failed · 2 usage/internal
```

```
out/<slug>/   <slug>.mp4  <slug>.html  <slug>.srt  build.json  sheets/  .work/ (removed on success unless --keep)
~/.cache/lectern/   voice/<sha>.wav|.json   chrome/<version>/
```
`build.json` holds gates and issues, per-stage wall times, unique/total frames, cache hits, per-scene attempts and the STT provider used.

Order: parse → in parallel {page load + layout + G2 + estimate sheets; `voiceScene` for all scenes} → each scene is planned and captured once its audio verifies → narration + mux → html/srt → final sheets. If G2 fails, capture is cancelled and voicing still finishes so the cache warms.

---

## 9. The skill

`skill/SKILL.md` (workflow, ≤ 120 lines) and `skill/reference.md` (language card, ≤ ~2.5k tokens).

SKILL.md outline:
1. **When to use:** any request for a narrated explainer video.
2. **Workflow** (best-effort, rulings §16): outline (examples first, one idea per scene) → verify (run every code example, check every claim) → script → `lectern check` until clean → `lectern build` → **Read every contact sheet** and the warnings → fix → rebuild (only changed scenes re-voice).
3. **Content rules** (hand-built lessons):
   - readable sentences, less text on screen;
   - examples before definitions;
   - full-width token strips with groups;
   - trees that grow;
   - narration in speakable words;
   - scenes up to ~250 words.
4. **No appearance in the script.** If something cannot be expressed, use `custom` and leave a comment saying why.
5. **Reading failures:** G2 codes (overfull → split), G3 (W510 → `say`).

reference.md outline: skeleton · inline marks · cue grammar and anchoring · verb table · catalogue table · visibility rule · speakable narration · the part 8 opening · top 10 errors and fixes.

---

## 10. Evidence

1. **Real data.** `examples/part8.md` is the full remake.
   - Acceptance: side-by-side review by the founder, equal or better.
   - Script tokens (Anthropic count_tokens) < 1/3 of `d8.body.html + d8.js`.
2. **Speed.**
   - **Baseline (measured):** the hand-built part 8 takes **187 s** wall with audio cached, for 13,273 frames (442 s). It took 2,069 screenshots, but every frame paid a `page.evaluate` round-trip, and all 13,273 PNGs went through CPU libx264 `-preset medium`. Historic TTS was 43 per-step calls, 4 at a time, each with a separate check: several minutes more.
   - **Targets** (same machine, per-stage times from `build.json`):
     - warm (audio cached, visuals edited): **≤ 20 s**;
     - cold (empty cache): **≤ 45 s** = ~20 s TTS + ~4 s STT, with capture and encode overlapped.
   - Report the unique-frame ratio and capture ms/frame.
3. **Calibration** (locks §6). On 10 text-heavy frames:
   - PNG → libx264 crf 16 is the reference;
   - candidates are {JPEG q92, PNG} → VideoToolbox at Q ∈ {55, 65, 75};
   - measure SSIM on Y, ΔE on chroma edges (coloured syntax on near-black), and 200% crops;
   - also sweep pool size N ∈ {2, 4, 6, 8}.

   Lock the fastest combination that is indistinguishable from the reference by these measures.
4. **Determinism and boundaries.**
   - Two-page byte-identical frames (§4.5).
   - Direct vs sequential scene rendering (§3.2).
   - 50 repeated (non-captured) frames must equal a fresh render at their own time.
   - Segment frame count = `plan.frameCount`; the numbered-image ffconcat test; audio sample totals (§6).
5. **STT benchmark (done):** 8 sentence clips + 4 six-sentence scene clips, via OpenRouter).

   | model | scene latency | WER | word ts | verdict |
   |---|---|---|---|---|
   | elevenlabs/scribe-v2 | 3.4 s (4 parallel 4.8 s) | 0.8% | yes + confidence | **primary** |
   | deepgram/nova-3 | 2.1 s (4 parallel 4.4 s) | 0.9% | yes | **fallback** |
   | openai/whisper-1 | 5.0 s | 1.3% | yes | digit-ises numbers |
   | google/gemini-3.8-flash | 11.2 s | n/a | no | unsuitable |
   | gpt-4o(-mini)-transcribe | n/a | n/a | no verbose_json | unsuitable |

   Findings: "infix" heard as "in fixed" by both providers (→ W510 + prose `say`); `add(2, 3)` heard as "add two comma three" (→ E412).
6. **Scene-length TTS (done).** The 43 part-8 paragraphs were grouped into 8 scenes of 156–181 words, 2 attempts each, 16 calls in parallel, Scribe-checked.
   - Gemini returns `audio/wav` 24 kHz.
   - TTS takes 13.6–20.1 s for 50–65 s of audio; STT 3.1–6.0 s; the whole batch 24 s wall.
   - **15/16 attempts were faithful** (0–1.3% WER). One repeated a sentence (+14 words); the diff caught it, and the scene's other attempt was clean.
   - Conclusion: one call per scene holds. Hedging 2 attempts per scene (§5.3) keeps a ~20 s re-voice off the critical path.
7. **Still to measure** (audio lane L3, first): with Scribe v2 on the 43 real clips:
   - fault catch rate on synthetic faults: dropped sentence, repeated phrase, truncated tail, swapped word, **single dropped cue-anchor word**, **paragraph-edge deletion**;
   - false-fail rate on clean clips;
   - onset error on 5 clips × 20 hand-labelled words (≤ 50 ms).

   Tune §5.7 thresholds only from this data.

---

## 11. Seams, lanes, order

### 11.1 Frozen seams (day 0)
Each passes the design-principles tests: small interface over large behaviour, split by hidden knowledge rather than pipeline step, and no format known by two modules.

| # | seam | hides | alternative considered, and why it lost |
|---|---|---|---|
| 1 | `parse(text, file) → {ir, errors}` (`src/ir.ts`) | grammar, inline marks, spoken form, resolution, validation | Public AST + separate resolver/validator. Callers would have to know the pass order (temporal decomposition), and errors would be split across layers. |
| 2 | `BlockModule` (`src/blocks/contract.ts`) | how one block looks, measures, and draws evaluated state | Blocks receive cues + t and animate themselves. Every block would re-implement easing, hl exclusivity and stagger, and the capture set would become unknowable. |
| 3 | `voiceScene(scene, ir) → VoicedScene` (`src/audio/types.ts`) | providers, wire formats, hedging, retries, tokenising, diff, provenance, cache | Exported `tts()`, `stt()`, `diff()` steps. Retry, hedge and fallback need all three, and the cache key and provenance would leak to the caller. |
| 4 | `planScene(scene, voiced, motion) → ScenePlan` + `toGlobal` + `locate` (`src/timing/types.ts`) | every clock, rate and rounding rule; the splice map; beat/cue times; span compilation and highlight levels; scene length; capture instructions; sample-copy instructions | Splice inside audio and cue times inside a timeline module. Both would need the splice map: Sol's #2 and #6 were exactly this leak. |
| 5 | `window.lectern` page API + `renderScene(k, plan) → segment` | layout, lint, SceneEntry, state evaluation; Chrome, capture format, pool, ffmpeg | One global `render(t)` driven sequentially. No parallelism, and scene-entry state would live implicitly in render history (Sol #5). |
| 6 | `theme/v2/tokens.css` + `theme/README.md` | every visual and motion number, composition thresholds | Durations and sizes as TS constants in `src/verbs.ts` / layout. That is two sources of truth with the theme, and the theme agent could not tune motion. `verbs.ts` keeps only semantics and token names. |

### 11.2 Lanes
| lane | owns (disjoint) | delivers |
|---|---|---|
| **L1 Language** | `src/script/**` | `parse()`; spoken form; `reachable`; validation; error catalogue; goldens (opening fixture, `examples/part8.md`, error fixtures) |
| **L2 Runtime + all blocks** (one owner; may run two builders) | `src/runtime/**`, `src/blocks/**` | page API, layout per theme README, sparse scale-up, lint, SceneEntry, `stateAt`, step-through player, block dev harness (day 1), the catalogue in §3.4 build order |
| **L3 Audio** | `src/audio/**`, `bench/**` | §10.7 measurements first; `voiceScene()` with hedging, tokeniser, diff, provenance, nova-3 fallback, cache |
| **L4 Timing + render + outputs** | `src/timing/**`, `src/render/**` | `planScene`, `compileSpans`, `toGlobal`, `locate`, narration assembly, capture pool, encode + frame verification, mux, srt, html export, sheets, §10.3 calibration, determinism tests |
| **L5 Integrator (end-to-end owner)** | `src/cli.ts`, `src/build.ts`, `src/report.ts`, `skill/**`, `examples/**`, `test/**` | day-0 seams; `examples/part8.md` (day 1); orchestration and gates; skill; evidence report |

### 11.3 Order
- **Day 0:** L5 commits the seams from §2, §3.1, §4.5, §5 and §6 (page API). Changes after that go through L5.
- **Day 1:** `part8.md`, L2 harness + stub page, L3 starts §10.7.
- **Days 1–3:** lanes in parallel, each green on its own tests (L4 on `--no-audio`).
- **Days 3–4:** L5 runs e2e on the first 4 scenes, then the full part 8, then the evidence report.

Theme tokens that are missing are requested from the theme agent, never invented.

---

## 12. Open questions

1. **FLAC upload** acceptance on OpenRouter for both providers (1-minute check in L3).

(Closed: the theme tokens `--dur-scene`, `--dur-settle`, `--sparse-fill-min` and `--scale-max` landed, and the highlight model is now theme README rule 7, §1.5.)
