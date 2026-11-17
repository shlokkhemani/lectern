/**
 * The block contract (§3.1). One file per block type, `src/blocks/<pack>/<type>.ts`, exports a BlockModule.
 * The compile half (`parse`) runs in Bun; `runtime` is bundled into the page.
 * Blocks never see time or cues: they draw evaluated state. They hold no literal colours, sizes, radii,
 * durations or easings (a grep test enforces it); everything visual comes from theme tokens.
 *
 * Seam 2 (§11.1). Alternative considered: blocks receive cues and `t` and animate themselves. It lost because
 * every block would re-implement easing, highlight exclusivity and stagger, and the capture set would be unknowable.
 */
import type { Id, Inline, ItemDecl, Loc, Reachable, Region, Selector, Verb } from '../ir.ts';

/** Declared args after schema checking: `key=value` strings and bare flags. */
export type Args = Record<string, string | true>;

/**
 * One body line as written. `raw` is untouched. `text` has a trailing name removed (and `name` set): ` #name`
 * for marked-up blocks; verbatim blocks (`code`, `terminal`) use `raw` and accept a name only after two or
 * more spaces (`x := 1  #init`). A name becomes a global id only if the block puts it in `ItemDecl.name`.
 * A sourced block (`src=`) gets no body lines; it reads its own via `ParseCtx.source`.
 */
export interface BodyLine { raw: string; text: string; name?: Id; loc: Loc }

export interface ParseCtx {
  /** Script defaults a block may need. */
  meta: { lang: string };
  /**
   * The lines of a `src=` file (relative to the script's directory), without trailing newline.
   * Reports E2xx at `loc` and aborts the block if the file is missing.
   */
  source(path: string, loc: Loc): string[];
  /** Parse inline marks (§1.4) in `text`, which starts at `loc`. Reports its own errors. */
  inline(text: string, loc: Loc): Inline;
  /** Abort this block with an error; the parser records it and continues with the next block. */
  error(loc: Loc, code: string, message: string, fix: string): never;
  warn(loc: Loc, code: string, message: string, fix: string): void;
}

export interface BlockModule<B = unknown> {
  /** Catalogue name (§3.4); also a reserved word. */
  type: string;
  pack: 'core' | 'cs';
  /** Arg schema: a flag, a string, an int, or one of a list of literals. */
  args: Record<string, 'flag' | 'string' | 'int' | string[]>;
  /** Region when the author writes no `@region`; `main` if absent. */
  defaultRegion?: Region;
  /** true: grows to fill leftover width (tree, graph, tokens). false: natural width (code, prose). */
  flexible: boolean;
  /**
   * Its parts outside items are content (a title's heading, a table's header, a custom drawing): they are on
   * screen from the scene's start. Absent: they are a frame (a panel, axes, a caption), which appears with the
   * first item when every item starts hidden, never empty.
   */
  contentOutsideItems?: true;
  /**
   * Body → typed body and items in reading order. Pure and synchronous.
   * `code` owns `src=path:from-to`: the lines come from the file, displayed numbers and selectors use the
   * file's line numbers when a range is given, the caption defaults to the path, and `name=12:fn,15:loop`
   * names lines (sourced code has no inline ` #name`).
   */
  parse(body: BodyLine[], args: Args, ctx: ParseCtx): { body: B; items: ItemDecl[] };
  /**
   * Optional async compile work that cannot be synchronous (shiki highlighting, KaTeX). The build awaits
   * every block's `prepare` after parse and before bundling the page; the result replaces the body.
   * The build always passes `sets`: every value a `set` cue anywhere in the script writes to this block or its items, in source
   * order, without duplicates, so content that only arrives by `set` can be prepared too (math typesets them).
   * Must not change items. Alternative considered: async `parse`. It lost because `check` and the parser's
   * tests would need I/O and the error pass would interleave with awaits.
   */
  prepare?(body: B, args: Args, sets?: Inline[]): Promise<B>;
  /** Which selector kinds each supported verb accepts. A verb absent here is E305 on this block. */
  verbs: Partial<Record<Verb, Selector['kind'][]>>;
  /** Marker names, in order (`['cur', 'peek']`). The first is the one `move <id> n` moves. */
  markers?(body: B, args: Args): string[];
  /**
   * The items `move` slides, for a block that lists `items` under `move` in `verbs`: what one position number
   * means is the block's alone (an x along a chart's series, a length along a custom path). The runtime only
   * eases the number; the block draws the item there from `ItemState.at`.
   */
  movers?(body: B, args: Args): Movers;
  runtime: BlockRuntime<B>;
}

/**
 * Seam (motion spec §6). Alternative considered: movers as markers (`MarkerState`). It lost because a chart point
 * and a custom item are already items with `show`, `hl`, `set` and `dim`; as markers they would lose those or
 * exist twice.
 */
export interface Movers {
  /** Movable item key → where it stands as declared, in the block's own position units. */
  home: Readonly<Record<string, number>>;
  /**
   * The position a cue wrote for `key` (the word after the target; empty when the cue wrote none), given where
   * the item stands (`from`), as an absolute number the block can ease to; or what is wrong and the literal fix,
   * written for the target as the cue wrote it (`as.target`) on block `as.block`. Also asked about a key that
   * cannot move. Errors never depend on `from`. For an empty `text` only the fix is read: it names a valid
   * position.
   */
  stop(key: string, text: string, from: number, as: { target: string; block: Id }): number | { message: string; fix: string };
}

export interface BlockRuntime<B> {
  /**
   * Build DOM once. Every part is sized to the envelope of all its reachable contents, so geometry never changes
   * later. The page always passes `caption` when the block has one: the declaration's `"quoted string"` (or the default a module's parse gave it, such as a
   * `src=` path); the block draws it, so it is measured with the block.
   */
  mount(el: HTMLElement, body: B, args: Args, reachable: Reachable, caption?: string): void;
  /**
   * Natural width, and height at a given width, in CSS px. Flexible blocks also lay their rows out across `width` (theme rules 1, 13).
   * `width`: the width the block takes when it is narrower than it was given (wrapped text hugs its longest
   * line, `hugWidth`); the layout then gives it that, with no dead space inside its box.
   */
  measure(el: HTMLElement, width: number): { natural: number; height: number; width?: number };
  /** Cache anchors (edges, markers, group brackets) after layout. Called once per scene. */
  geometry?(el: HTMLElement): void;
  /** Apply evaluated state. Pure and idempotent; reads no layout. */
  render(el: HTMLElement, s: BlockState): void;
  /** Block-specific geometric checks beyond the generic ones (§3.3). */
  lint?(el: HTMLElement): BlockLintIssue[];
  /**
   * What the author can change in this block, in script syntax, when it is wider than its column. Undefined: the
   * layout's own advice (a layout move) stands alone. Rows too tall together are always split.
   */
  roomFix?(el: HTMLElement): string | undefined;
  /**
   * For a block whose content the author draws (custom): what the generic checks tell the author when they
   * find a problem inside it. Without it, such a problem is the engine's, and the fix says "report this".
   */
  authored?: AuthoredAdvice;
}

/** Fixes addressed to the author, for problems in content the author placed. */
export interface AuthoredAdvice {
  /** L402: the content is drawn outside the block's own box. */
  outside: string;
  /** L403: two labels in the block overlap each other. */
  overlap: string;
  /** L406: text is drawn below `min` px. */
  tiny(min: number): string;
}

/** Eased channel values, each 0..1. Levels: now > held > rest > receded (theme rule 7). */
export interface Channels {
  /** 0 hidden … 1 shown. Hidden parts keep their space. */
  vis: number;
  /** Highlight active: the `--hl-fill-*` lift. */
  hl: number;
  /** 1 = its block's amber target (`--hl-now-*`), the block's latest hl/set/move. With hl but not now: held (`--hl-held-*`). A fresh `set` is now. */
  now: number;
  /** 1 = receded (`dim`, or `focus` on another block). */
  recede: number;
  /** Progressive reveal of edges and bars (`grow`). */
  grow: number;
}

/** Content mid-change. At most one transition per part at a time (overlap is a compile error), so two values suffice. */
export interface Content {
  cur: Inline;
  prev?: Inline;
  /** 0 = prev fully shown, 1 = cur fully shown. */
  p: number;
}

export interface ItemState extends Channels {
  content?: Content;
  /** Evaluated number for charts. */
  value?: number;
  /** Where `move` has put it, in the block's units (`Movers`); absent means where it was declared. */
  at?: number;
  /** Item ↔ item position exchange in progress. */
  swap?: { with: string; p: number };
}

export interface MarkerState {
  /** Fractional 1-based item index. */
  at: number;
  /** 0 until the first move (markers start hidden). */
  vis: number;
  now: number;
}

export interface BlockState {
  self: Channels & { content?: Content };
  items: Record<string, ItemState>;
  markers: Record<string, MarkerState>;
  /** `from`/`to`: 1-based item indices, inclusive. */
  groups: { id: Id; from: number; to: number; label: string; vis: number }[];
  /** Block ↔ block exchange in one slot; p 0 = this block, 1 = the other. */
  swap?: { with: Id; p: number };
}

export interface Rect { x: number; y: number; w: number; h: number }

/** A check failure inside one block. The page adds scene, block and time (`LintIssue` in render/types). */
export interface BlockLintIssue {
  code: string;
  message: string;
  fix: string;
  item?: string;
  /** Stage CSS px. */
  rect?: Rect;
}
