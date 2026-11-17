/**
 * What each verb means: the channels it writes and the theme motion tokens that time it (§1.5).
 * Durations and curves themselves live only in `theme/v2/tokens.css`; this module knows their names.
 *
 * Seam 6 (§11.1), the verb half. Alternative considered: durations as TS constants here. It lost because
 * the theme would become a second source of truth, and the theme agent could not tune motion.
 */
import type { Verb } from './ir.ts';

/**
 * An evaluated, eased state channel. All are 0..1 except `marker` (a marker's fractional 1-based item index, or
 * a mover's position in its block's units) and
 * `content`/`value`, which interpolate between two values. `hl` = highlight active; `now` = the frame's single
 * amber target versus "held" (§1.5 highlight model, theme README rule 7).
 */
export type Channel =
  | 'vis' | 'hl' | 'now' | 'recede' | 'grow'
  | 'content' | 'value' | 'marker' | 'group' | 'swap' | 'scene';

export type DurationToken =
  | '--dur-appear' | '--dur-hide' | '--dur-move' | '--dur-grow'
  | '--dur-highlight' | '--dur-recede' | '--dur-scene' | '--dur-settle';

/** Curve tokens. The `--ease-<verb>` aliases resolve to one of the three base curves in tokens.css. */
export type EaseToken =
  | '--ease-out' | '--ease-in-out' | '--ease-in'
  | '--ease-appear' | '--ease-move' | '--ease-grow' | '--ease-highlight' | '--ease-hide';

export interface VerbMeaning {
  /** Channels the verb writes on its targets (or, for `focus`, on every other block). */
  writes: Channel[];
  /** Phases in order; a verb's lifetime is their sum (plus stagger). */
  phases: { duration: DurationToken; ease: EaseToken }[];
  /** Multi-item targets reveal in reading order, `min(i, --stagger-max) × --stagger` apart. */
  staggered: boolean;
  /** As a thing's first cue in a scene, it means that thing starts hidden (§1.1). */
  revealsHidden: boolean;
  /**
   * Its target can become the scene's single "now" (§1.5): the target of the last such command at the most
   * recent cue instant, if visible. The previous now drops to held (if still `hl`-active) or rest. Only hl, set
   * and move: an appearance is not an emphasis. `[hl none]` clears now.
   */
  takesNow: boolean;
}

export const VERBS: Readonly<Record<Verb, VerbMeaning>> = {
  // hidden or receded → rest; edges into a tree/graph node draw before the node.
  show: { writes: ['vis', 'recede', 'grow'], phases: [{ duration: '--dur-appear', ease: '--ease-appear' }], staggered: true, revealsHidden: true, takesNow: false },
  // → hidden; layout space stays reserved.
  hide: { writes: ['vis'], phases: [{ duration: '--dur-hide', ease: '--ease-hide' }], staggered: false, revealsHidden: false, takesNow: false },
  // exclusive per block: clears the block's other highlights. Persists until replaced, `none`, or scene end.
  hl: { writes: ['hl'], phases: [{ duration: '--dur-highlight', ease: '--ease-highlight' }], staggered: false, revealsHidden: false, takesNow: true },
  // → receded; `show` restores.
  dim: { writes: ['recede'], phases: [{ duration: '--dur-recede', ease: '--ease-out' }], staggered: false, revealsHidden: false, takesNow: false },
  // content crossfades prev → cur over the first phase; from t0 the target is now for --dur-settle, then
  // releases over --dur-highlight. A second set on the part while content still runs is T602.
  set: { writes: ['content', 'value'], phases: [{ duration: '--dur-highlight', ease: '--ease-highlight' }, { duration: '--dur-settle', ease: '--ease-out' }], staggered: false, revealsHidden: false, takesNow: true },
  // marker to an item; later markers keep their offset unless one marker is named. An item that slides
  // (chart point, custom item on a path) goes to its position along its series or path.
  move: { writes: ['marker'], phases: [{ duration: '--dur-move', ease: '--ease-move' }], staggered: false, revealsHidden: false, takesNow: true },
  // progressive reveal: trees by depth then left to right, graph edges, chart bars and lines.
  grow: { writes: ['vis', 'grow'], phases: [{ duration: '--dur-grow', ease: '--ease-grow' }], staggered: true, revealsHidden: true, takesNow: false },
  // bracket and label over a contiguous item range.
  group: { writes: ['group'], phases: [{ duration: '--dur-appear', ease: '--ease-appear' }], staggered: false, revealsHidden: false, takesNow: false },
  // block ↔ block in one slot (first out, second in), or item ↔ item position exchange.
  swap: { writes: ['swap', 'vis'], phases: [{ duration: '--dur-move', ease: '--ease-move' }], staggered: false, revealsHidden: true, takesNow: false },
  // recede every other placed block; `none` clears.
  focus: { writes: ['recede'], phases: [{ duration: '--dur-recede', ease: '--ease-out' }], staggered: false, revealsHidden: false, takesNow: false },
};

/** The scene crossfade, which is not a verb but is timed the same way. */
export const SCENE_CHANGE = { duration: '--dur-scene', ease: '--ease-in-out' } as const satisfies { duration: DurationToken; ease: EaseToken };

/** A cubic-bezier curve `(x1, y1, x2, y2)`. */
export type Bezier = readonly [number, number, number, number];

/**
 * Theme motion values, read once from tokens.css by the timing module (the only reader of motion tokens;
 * spans carry resolved curves). Durations in seconds.
 * Every token is required: a missing token fails loudly rather than defaulting (§12 Q1).
 */
export interface MotionTokens {
  durations: Record<DurationToken, number>;
  /** Aliases already resolved to curves. */
  eases: Record<EaseToken, Bezier>;
  /** Seconds between staggered siblings. */
  stagger: number;
  /** After this many siblings, the rest share the last delay. */
  staggerMax: number;
}
