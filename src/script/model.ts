/** Internal types shared by the parser's modules. Nothing here is exported from `src/script`. */
import type { BlockModule, Movers } from '../blocks/contract.ts';
import type { BlockDecl, Cue, Inline, ItemDecl, Loc, Region } from '../ir.ts';
import type { SourceText } from './source.ts';

/** A declared block and what resolution needs to know about it. */
export interface BlockInfo {
  decl: BlockDecl;
  module: BlockModule;
  markers: string[];
  /** The items `move` slides, if its module has any (`BlockModule.movers`). */
  movers?: Movers;
  /** Its body failed to parse: targets on it are not checked further, to avoid cascades. */
  broken: boolean;
  byKey: Map<string, ItemDecl>;
  /** Integer selectors match item keys when some key is an integer (code with `from=`, table rows, frames), else indices. */
  intKeys: boolean;
}

/** The text between `[` and `]`, and where `[` is. */
export interface CueSrc { inner: SourceText; loc: Loc }

export interface TargetSrc { text: string; loc: Loc }

export type SimpleVerb = 'show' | 'hide' | 'hl' | 'dim' | 'grow' | 'focus';

/** One verb of a cue command, syntactically parsed but not resolved. `[show hl x]` gives two. */
export type Command =
  | { verb: SimpleVerb; targets: TargetSrc[]; loc: Loc }
  | { verb: 'set'; target: TargetSrc; value: Inline; loc: Loc }
  | { verb: 'move'; target: TargetSrc; /** The words after the target; one is a position. */ to: TargetSrc[]; loc: Loc }
  | { verb: 'group'; target: TargetSrc; label: string; groupId?: { id: string; loc: Loc }; loc: Loc }
  | { verb: 'swap'; targets: [TargetSrc, TargetSrc]; loc: Loc };

/**
 * A resolved cue, with the target texts as written (for messages). `position`: a move's position as written,
 * which the scene pass resolves against where an item stands (`Movers.stop`).
 */
export interface CueAt { cue: Cue; texts: string[]; position?: string }

export interface PlacementSrc { block: string; region: Region; reused: boolean; loc: Loc }
