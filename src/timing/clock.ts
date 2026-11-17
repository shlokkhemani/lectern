/**
 * Every rate, splice constant and rounding rule of the timing model (§4.1–4.2). Nothing outside
 * `src/timing/` imports this file: callers get frames, samples and S-seconds already computed.
 */

export const FPS = 30;
export const RATE = 48_000;
/** Samples per frame. RATE is a multiple of FPS, so frames and samples never drift. */
export const SPF = RATE / FPS;

/** Splice constants, seconds (§4.2). */
export const LEAD_MIN = 0.4;
export const GAP_MIN = 0.8;
export const GAP_MAX = 1.6;
/**
 * Room kept around speech at every cut point. 0.12 s, not the spec's 0.05: the audio lane measured that
 * 0.05 s clips the start of 38% of paragraphs (Scribe onsets run late by 38 ms median, 87 ms p90).
 */
export const PAD = 0.12;
export const PREROLL = 0.12;
export const BEAT_OFFSET = 0.1;
export const TAIL = 0.9;
export const HOLD = 0.5;
export const END_EXTRA = 1.5;
export const SILENT_SCENE = 2.5;
/** Linear fade at each end of a narration copy: the cut lands in PAD silence, so this only removes clicks. */
export const FADE = 0.008;

/** Float slack for comparisons against frame boundaries. */
const EPS = 1e-6;

/** The first frame whose time is at or after `s`. */
export const frameAtOrAfter = (s: number): number => Math.ceil(s * FPS - EPS);
/** The last frame whose time is at or before `s`. */
export const frameAtOrBefore = (s: number): number => Math.floor(s * FPS + EPS);
/** Frame f's page time, S seconds. */
export const frameTime = (f: number): number => f / FPS;
/** Seconds → a sample index, rounded to the nearest sample. */
export const sample = (s: number): number => Math.round(s * RATE);

if (GAP_MIN <= 2 * PAD) throw new Error('timing: GAP_MIN must exceed 2·PAD so narration copies never overlap');
