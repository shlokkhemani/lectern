/**
 * The timing seam (§4). This module owns every clock, every conversion, every rounding rule and every
 * constant: frame rate, sample rate, the splice map, beat and cue times, channel spans and highlight levels,
 * scene length, capture instructions and sample-copy instructions. Callers receive ready-to-use
 * instructions and never compute a time, a frame or a sample offset themselves.
 *
 * Clocks: A = seconds into a scene's unspliced audio (from audio); S = seconds from the scene's first
 * frame, post-splice; G = seconds from the video's first frame.
 *
 * Seam 4 (§11.1). Alternative considered: splicing inside audio and cue times inside a separate timeline
 * module. It lost because both would need the splice map (Sol #2 and #6 were exactly that leak).
 */
import type { Id, Inline, Loc, Script } from '../ir.ts';
import type { VoicedScene } from '../audio/types.ts';
import type { Bezier, Channel, MotionTokens } from '../verbs.ts';

/**
 * The resolved curve. Spans carry the numbers, not a token name, so tokens.css is read in one place
 * (`LoadMotion`) and the page evaluates spans without reading theme motion itself.
 */
export type EaseName = Bezier;

/**
 * One channel of one part changing over [t0, t1) in S seconds. At or before t0 the channel holds `from`;
 * from t1 on it holds `to`. `from` is the channel's evaluated value at t0 under earlier spans, so nothing jumps.
 * Numeric channels are 0..1 except `marker` (a marker's fractional 1-based item index, or a mover's position
 * in its block's units); `content` spans carry Inline.
 * Spans cover cues only: the scene-change resets of reused blocks (`hl`, `now`, `recede` → rest over the
 * crossfade) are written by the page from SceneEntry, which knows the entry values.
 */
export interface Span {
  block: Id;
  /** Item key, marker name or group id, by channel; absent = the block itself. */
  item?: string;
  channel: Channel;
  t0: number;
  t1: number;
  /**
   * Absent: the page's entry value for this channel (from SceneEntry), used when the value at t0 depends on
   * an earlier scene that timing does not see. Present: the exact value at t0.
   */
  from?: number | Inline;
  to: number | Inline;
  ease: EaseName;
  /**
   * `swap` spans only: the other side of the exchange, an item key for an item swap (both items get a span,
   * each naming the other) or a block id for a block swap. Lets the page fill `ItemState.swap.with` and
   * `BlockState.swap.with` without re-reading cues.
   */
  partner?: string;
}

export interface ScenePlan {
  scene: number;
  /** F_k. Authoritative: every other length derives from it. */
  frameCount: number;
  /** Opaque to callers; passed through to ffmpeg as-is. */
  frameRate: { num: number; den: number };
  /** In order: render the page at `t` (S), and that image holds `repeat` frames. Σ repeat = frameCount. */
  capture: { t: number; repeat: number }[];
  /**
   * The scene's narration as sample copies from the A-clock wav into a zero buffer of `totalSamples`
   * (= frameCount × samples per frame). Copies never overlap; fades are linear, in samples.
   */
  audio: {
    totalSamples: number;
    copies: { srcSample: number; dstSample: number; length: number; fadeSamples: number }[];
  };
  /** One per IR Word, S seconds (subtitles go through `toGlobal`). */
  words: { start: number; end: number }[];
  /** One per beat, S seconds: beat start, voice onset, last word end, and a frame-aligned settle point. */
  beats: { start: number; onset: number; end: number; settle: number }[];
  /** Every state change in the scene; the page evaluates them (`stateAt`). */
  spans: Span[];
}

/** A scene that cannot be timed, e.g. T602: a `set` starts while another content transition on that item runs. */
export interface TimingError { code: string; loc: Loc; message: string; fix: string }

/**
 * Plan scene k of `ir`. Takes the whole script because a scene's spans depend on its reused blocks' earlier
 * declarations (item order, markers, groups). Pure: the same script, k, voice and motion give the same result.
 * Estimate mode reports the same errors.
 */
export type PlanScene = (ir: Script, k: number, voiced: VoicedScene, motion: MotionTokens) => ScenePlan | TimingError[];

/** S seconds in scene k → G seconds (.srt, sheets). Needs every plan up to k. */
export type ToGlobal = (plans: ScenePlan[], k: number, s: number) => number;

/** G seconds → the scene showing then and S within it (player, scrubber). Clamps to the video's extent. */
export type Locate = (plans: ScenePlan[], g: number) => { scene: number; t: number };

/** Read the theme's duration and stagger tokens. Fails, naming the token, if any is missing. */
export type LoadMotion = (theme: import('../themes.ts').ThemeName) => Promise<MotionTokens>;
