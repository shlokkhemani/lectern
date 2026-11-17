/**
 * `planScene` (§4.2–4.5): one scene's A-clock voice → its S-clock plan. The splice map, beat and cue
 * times, spans, settle points, the scene length, capture instructions and narration sample copies.
 */
import type { Script } from '../ir.ts';
import type { VoicedScene } from '../audio/types.ts';
import type { MotionTokens } from '../verbs.ts';
import type { ScenePlan, TimingError } from './types.ts';
import {
  BEAT_OFFSET, END_EXTRA, FADE, FPS, GAP_MAX, GAP_MIN, HOLD, LEAD_MIN, PAD, PREROLL, SILENT_SCENE, SPF, TAIL,
  frameAtOrAfter, frameAtOrBefore, frameTime, sample,
} from './clock.ts';
import { compileSpans, cueLength, enteringMarkers, type TimedInstant } from './spans.ts';
import { subtitles } from './subtitles.ts';

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/**
 * Plan scene k of `ir` from its voice. Pure: the same script, voice and motion give the same plan.
 * Errors: T602 (overlapping content transitions), T603 (the voice does not match the scene's words).
 *
 * It takes the whole script, not just the scene: whether k is the final scene (END_EXTRA) and each block's
 * items (stagger order, tree depth) live outside `Scene`.
 */
export function planScene(ir: Script, k: number, voiced: VoicedScene, motion: MotionTokens): ScenePlan | TimingError[] {
  const scene = ir.scenes[k]!;
  const beats = scene.beats;
  const nWords = beats.reduce((n, b) => n + b.words.length, 0);
  if (voiced.words.length !== nWords || beats.some(b => b.words.length === 0))
    return [{ code: 'T603', loc: scene.loc, message: `scene ${k} has ${nWords} words but its voice has ${voiced.words.length} timings`,
      fix: `re-voice the scene with --revoice ${k}; the cached voice belongs to different narration` }];

  // ---- splice map: A → S, per paragraph (§4.2) ----
  const first: number[] = [];
  let w = 0;
  for (const b of beats) { first.push(w); w += b.words.length; }
  const aOn = beats.map((_, p) => voiced.words[first[p]!]!.start);
  const aOff = beats.map((b, p) => voiced.words[first[p]! + b.words.length - 1]!.end);
  const span = beats.map(b => Math.max(0, ...b.startCues.map(c => cueLength(c, ir.blocks, motion))));
  const delta: number[] = [], endS: number[] = [], onset: number[] = [];
  beats.forEach((_, p) => {
    onset[p] = p === 0 ? clamp(span[0]!, LEAD_MIN, GAP_MAX) : endS[p - 1]! + clamp(span[p]!, GAP_MIN, GAP_MAX);
    delta[p] = onset[p]! - aOn[p]!;
    endS[p] = aOff[p]! + delta[p]!;
  });
  const beatStart = beats.map((_, p) => (p === 0 ? 0 : endS[p - 1]! + BEAT_OFFSET));

  // ---- words and cue instants in S (§4.3) ----
  const words: ScenePlan['words'] = [];
  const instants: TimedInstant[] = [];
  beats.forEach((b, p) => {
    if (b.startCues.length) instants.push({ t: beatStart[p]!, beat: p, cues: b.startCues });
    b.words.forEach((word, i) => {
      const a = voiced.words[first[p]! + i]!;
      words.push({ start: a.start + delta[p]!, end: a.end + delta[p]! });
      if (word.cues.length) instants.push({ t: Math.max(beatStart[p]!, a.start + delta[p]! - PREROLL), beat: p, cues: word.cues });
    });
  });
  instants.sort((a, b) => a.t - b.t);   // stable: equal times keep source order

  const compiled = compileSpans(scene, ir.blocks, instants, motion, enteringMarkers(ir.scenes, k, ir.blocks, motion));
  if (Array.isArray(compiled)) return compiled;
  const { spans, beatEnd } = compiled;

  // ---- scene length, quantised once, last (§4.4) ----
  const lastSpan = Math.max(0, ...spans.map(s => s.t1));
  let raw = beats.length ? Math.max(endS[beats.length - 1]! + TAIL, lastSpan + HOLD) : Math.max(SILENT_SCENE, lastSpan + HOLD);
  if (k === ir.scenes.length - 1) raw += END_EXTRA;
  const frameCount = frameAtOrAfter(raw);
  const sceneEnd = frameTime(frameCount);

  // ---- beats with frame-aligned settle points ----
  // Beat 0 also waits for the scene crossfade: a settle point mid-fade would show two scenes at once.
  const fadeEnd = spans.find(s => s.channel === 'scene')?.t1 ?? 0;
  const planBeats = beats.map((_, p) => {
    const x = Math.max(beatEnd[p] ?? endS[p]! + HOLD, p === 0 ? fadeEnd : 0);
    const next = p + 1 < beats.length ? beatStart[p + 1]! : sceneEnd;
    // The first frame where the beat's motion is complete, but never past the next beat's start (a span
    // at its t0 still shows its `from`, so the frame at or before `next` is safe).
    const settle = frameTime(Math.min(frameCount - 1, frameAtOrAfter(x), frameAtOrBefore(next)));
    return { start: beatStart[p]!, onset: onset[p]!, end: endS[p]!, settle };
  });

  return {
    scene: k,
    frameCount,
    frameRate: { num: FPS, den: 1 },
    // The page burns the subtitle in: each cue's first and last frame are changes like any span's.
    capture: captureRuns(spans, frameCount, subtitles(scene, { words, frameCount }).flatMap(c => [c.start, c.end])),
    audio: { totalSamples: frameCount * SPF, copies: voiced.wav ? copies(aOn, aOff, delta, voiced.duration) : [] },
    words,
    beats: planBeats,
    spans,
  };
}

/**
 * The capture set: frame 0, and every frame from a span's start through the first frame strictly after
 * its end (so the settled value is captured exactly, whatever the float rounding), and the frames at and
 * after each instant in `cuts` (a subtitle appearing or clearing). Runs of other frames repeat the last
 * captured image.
 */
function captureRuns(spans: { t0: number; t1: number }[], frameCount: number, cuts: number[]): ScenePlan['capture'] {
  const unique = new Uint8Array(frameCount);
  unique[0] = 1;
  for (const t of cuts) for (const f of [frameAtOrAfter(t), frameAtOrAfter(t) + 1]) if (f < frameCount) unique[f] = 1;
  for (const s of spans) {
    const hi = Math.min(frameCount - 1, frameAtOrBefore(s.t1) + 1);
    for (let f = Math.max(0, frameAtOrAfter(s.t0)); f <= hi; f++) unique[f] = 1;
  }
  const runs: ScenePlan['capture'] = [];
  for (let f = 0; f < frameCount; f++) {
    if (unique[f]) runs.push({ t: frameTime(f), repeat: 1 });
    else runs[runs.length - 1]!.repeat++;
  }
  return runs;
}

/**
 * Narration as sample copies: each paragraph's clip, padded by PAD and cut no further than the middle of
 * the A-gap on either side, lands at its S position. Copies are disjoint because every S-gap ≥ GAP_MIN > 2·PAD.
 */
function copies(aOn: number[], aOff: number[], delta: number[], duration: number): ScenePlan['audio']['copies'] {
  return aOn.map((on, p) => {
    const lo = Math.max(0, on - PAD, p > 0 ? (aOff[p - 1]! + on) / 2 : 0);
    const hi = Math.min(duration, aOff[p]! + PAD, p + 1 < aOn.length ? (aOff[p]! + aOn[p + 1]!) / 2 : Infinity);
    const srcSample = sample(lo);
    const length = Math.max(0, sample(hi) - srcSample);
    return { srcSample, dstSample: sample(lo + delta[p]!), length, fadeSamples: Math.min(sample(FADE), Math.floor(length / 2)) };
  });
}
