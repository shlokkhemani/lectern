/**
 * The IR: everything `parse(text, file)` knows about a script, resolved and validated (spec §2).
 *
 * Seam 1 (§11.1). `parse` hides the grammar, inline marks, spoken form, id resolution, `reachable`
 * and validation. Downstream modules read only these types.
 * Alternative considered: a public AST plus separate resolver and validator passes. It lost because
 * callers would have to know the pass order (temporal decomposition) and errors would split across layers.
 */

/** A script-wide name, `[a-z][a-z0-9-]*`, unique across the file. Anonymous blocks get `_b<n>`, anonymous groups `_g<n>`. */
export type Id = string;

export type Region = 'top' | 'left' | 'main';

/** The closed verb set (rulings §15). Meanings live in `src/verbs.ts`. */
export type Verb = 'show' | 'hide' | 'hl' | 'dim' | 'set' | 'move' | 'grow' | 'group' | 'swap' | 'focus';

/** A source position: 1-based line and column (UTF-16 code units) in the script text. */
export interface Loc { line: number; col: number }

/**
 * Display text with marks (§1.4). Plain runs are strings; a role wraps children.
 * Invariant: adjacent strings are merged, and no role has empty children.
 */
export type Inline = (string | { role: InlineRole; children: Inline })[];
export type InlineRole = 'code' | 'em' | 'alt' | 'ok' | 'bad' | 'box';

export interface Script {
  file: string;
  meta: {
    title: string;
    /** Output name derived from `title`: lowercase ascii, words joined by `-`. */
    slug: string;
    series?: string;
    /** Default language for `code` blocks. */
    lang: string;
    voice: string;
    ttsModel: string;
    /** Pronunciation map, applied by whole-word match to backtick content and prose (§1.5). */
    say: Record<string, string>;
  };
  blocks: Record<Id, BlockDecl>;
  /** Every global id: a block, a group (`[group … #id]`), or an item name (`#name`, `data-id`) used by exactly one block. */
  ids: Record<Id, IdRef>;
  scenes: Scene[];
}

/** What a global id names. A group id resolves, as a target, to the items it spans. */
export type IdRef =
  | { kind: 'block'; block: Id }
  | { kind: 'item'; block: Id; item: string }
  | { kind: 'group'; block: Id; items: string[] };

export interface BlockDecl {
  id: Id;
  /** A catalogue type (§3.4); the block module of that type owns `body`. */
  type: string;
  loc: Loc;
  /** Index of the scene that declares it. Later scenes may reuse it. */
  scene: number;
  /** `key=value` args and bare flags, already checked against the module's `args` schema. */
  args: Record<string, string | true>;
  /** The one `"quoted string"`: file name, terminal title, tree or chart title. */
  caption?: string;
  /** Opaque here; typed by the block module that parsed it. */
  body: unknown;
  /** Targetable parts in reading order. */
  items: ItemDecl[];
}

export interface ItemDecl {
  /** Block-local key: what selectors resolve to (`"3"`, `"2.1"`, `"args"`). Unique within the block. */
  key: string;
  /** 1-based reading-order index; the `n` of `id:n` selectors. */
  index: number;
  /** Global id from a trailing ` #name`, if given. */
  name?: Id;
  /** Block-defined item kind (`row`, `node`, `frame`, `line`, …). */
  kind: string;
  /** Nesting depth for trees and stacks; 0 = top level. */
  depth?: number;
  loc: Loc;
}

export interface Scene {
  index: number;
  loc: Loc;
  /** The `#` chapter in force, auto-numbered from 1. */
  chapter?: { n: number; text: string };
  headline?: Inline;
  /** Blocks on screen in this scene, in declaration (reading) order. */
  placements: Placement[];
  /** Pairs of blocks that share one layout slot because a `swap` exchanges them. */
  swapSlots: [Id, Id][];
  /** One per narration paragraph, in order. */
  beats: Beat[];
  /**
   * Visibility at scene start for every placed block. `self` is always inferred from the block's first cue
   * in this scene (hidden iff show, grow or swap-in), reused or not. `items` are inferred for blocks declared
   * here and inherited from the previous placement for reused ones (§1.5: "keeps its item visibility").
   */
  initialVis: Record<Id, { self: boolean; items: Record<string, boolean> }>;
  /** Everything each placed block may display in this scene, so layout can size envelopes once (§3.3). */
  reachable: Record<Id, Reachable>;
}

export interface Placement { block: Id; region: Region; reused: boolean; loc: Loc }

/**
 * Every content a block's parts can hold during a scene, including content inherited from earlier
 * scenes. `self` is block-level `set` content; `groups` lists every group any cue in the scene creates.
 */
export interface Reachable {
  self: Inline[];
  items: Record<string, Inline[]>;
  groups: { id: Id; from: number; to: number; label: string }[];
  /**
   * For a block with markers: where its shown markers stand (marker name → 1-based item index) at the scene's
   * start and after every instant that moves, shows or hides one, in order. A marker absent from an entry is
   * hidden there. Lets a block see which markers ever change their left-to-right order.
   * For a block with movers (`BlockModule.movers`): every mover's stop (item key → its position) the same way,
   * so a block can reserve room for an item's whole sweep.
   */
  markers?: Record<string, number>[];
}

export interface Beat {
  loc: Loc;
  words: Word[];
  /** Cues that fire at beat start, before the voice (§1.5). In source order. */
  startCues: Cue[];
}

/**
 * One narration word. Invariant: a beat's spoken text is its words' `spoken` joined by single spaces,
 * and a scene's TTS text is its beats' spoken texts joined by blank lines. Nothing else is sent (rulings §9).
 */
export interface Word {
  /** As shown in subtitles: marks removed, punctuation kept. */
  display: string;
  /** What TTS says for this word, punctuation attached (`` `parseCallExpression`, `` → `["parse", "call", "expression,"]`). */
  spoken: string[];
  loc: Loc;
  /** Cues anchored to this word, in source order. The word is a cue anchor iff this is non-empty. */
  cues: Cue[];
  /** First or last word of its paragraph. Edge words and cue anchors need verified timings (§5.8). */
  edge: boolean;
}

/**
 * One verb applied to its targets. A multi-verb command (`[show hl x]`) becomes one Cue per verb.
 * Each shape carries exactly the operands its verb needs.
 */
export type Cue =
  | { verb: 'show' | 'hide' | 'hl' | 'dim' | 'grow' | 'focus'; targets: Target[]; loc: Loc }
  | { verb: 'set'; targets: [Target]; value: Inline; loc: Loc }
  | { verb: 'move'; targets: [Target]; /** A marker: the 1-based item index it goes to. A mover: its absolute stop, in the block's units. */ to: number; loc: Loc }
  | { verb: 'group'; targets: [Target]; label: string; groupId: Id; loc: Loc }
  | { verb: 'swap'; /** [outgoing, incoming] for blocks; an exchange for items. */ targets: [Target, Target]; loc: Loc };

/** A resolved target. A bare `none` expands to one `none` target per block placed in the scene. */
export interface Target { block: Id; sel: Selector; loc: Loc }

export type Selector =
  | { kind: 'block' }
  | { kind: 'items'; keys: string[] }
  | { kind: 'marker'; name: string }
  | { kind: 'none' };

/** A compiler-style diagnostic (§1.7). Codes: E1xx syntax, E2xx refs, E3xx verbs, E4xx narration, Wxxx warnings. */
export interface Diagnostic {
  file: string;
  line: number;
  col: number;
  code: string;
  severity: 'error' | 'warning';
  message: string;
  /** One actionable sentence. Never empty. */
  fix: string;
}

/** `ir` is null iff some diagnostic is an error. At most 50 diagnostics, in source order. */
interface ParseResult { ir: Script | null; errors: Diagnostic[] }

/**
 * Reads a source file named by a script (`src=`), as a path relative to the script's directory.
 * Returns the text, or null if it does not exist. Synchronous so `parse` can stay synchronous.
 */
export type ReadSource = (path: string) => string | null;

/**
 * Pure apart from `read`: no other I/O, clock or randomness. The same text, file and file contents give the
 * same result. A declaration with a `src=` arg has no body and no closing fence.
 */
export type Parse = (text: string, file: string, read: ReadSource) => ParseResult;
