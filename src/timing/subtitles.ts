/**
 * Subtitle cues (§6): sentences in display form, at most 2 lines of 42 characters and 6 s per cue, timed by a
 * scene plan's word times. One pure function serves the page, which burns the current cue into every frame,
 * and the .srt sidecar, which shifts the same cues onto the global clock: the two never disagree.
 */
import type { Scene } from '../ir.ts';
import type { ScenePlan } from './types.ts';
import { frameTime } from './clock.ts';

const LINE = 42, LINES = 2, MAX_S = 6, LINGER = 0.4;
/** A chunk of fewer words that ends a sentence begun in the cue before is an orphan. */
const ORPHAN = 3;

/** One subtitle: S seconds in its scene, and its (at most two) lines. */
export interface Cue { start: number; end: number; lines: string[] }

/**
 * Wrap into lines of at most `LINE` chars (every word is at most `LINE` long: see `fragments`). Greedy decides how
 * many lines; two lines are then balanced (the split that keeps the longer line shortest), so a cue never leaves one
 * word alone on its second line.
 */
function wrap(words: string[]): string[] {
  const lines: string[] = [];
  for (const w of words) {
    const last = lines[lines.length - 1];
    if (last !== undefined && last.length + 1 + w.length <= LINE) lines[lines.length - 1] = `${last} ${w}`;
    else lines.push(w);
  }
  if (lines.length !== 2) return lines;
  let best = lines;
  for (let k = 1; k < words.length; k++) {
    const pair = [words.slice(0, k).join(' '), words.slice(k).join(' ')];
    if (Math.max(...pair.map(l => l.length)) < Math.max(...best.map(l => l.length))) best = pair;
  }
  return best;
}

/**
 * A word longer than a line (a long identifier) as line-sized pieces, cut after punctuation where it can,
 * each timed by its share of the word's characters, so the pieces keep the word's span.
 */
export function fragments(text: string, start: number, end: number): { text: string; start: number; end: number }[] {
  if (text.length <= LINE) return [{ text, start, end }];
  const out: { text: string; start: number; end: number }[] = [];
  const at = (i: number) => start + ((end - start) * i) / text.length;
  let i = 0;
  while (i < text.length) {
    let j = Math.min(text.length, i + LINE);
    if (j < text.length) {
      const cut = Math.max(...['.', '_', '-', '/', '(', ',', ':'].map(c => text.lastIndexOf(c, j - 1)));
      if (cut + 1 > i + LINE / 2) j = cut + 1;
    }
    out.push({ text: text.slice(i, j), start: at(i), end: at(j) });
    i = j;
  }
  return out;
}

/**
 * Scene `scene`'s cues under `plan`, in S seconds. A cue ends at a sentence end, a beat end, two full lines or
 * 6 s; a sentence that runs on never ends on one or two words alone, when the cue before can spare some. A cue
 * lingers 0.4 s after its last word, never into the next cue or past the scene's last frame.
 */
export function subtitles(scene: Scene, plan: Pick<ScenePlan, 'words' | 'frameCount'>): Cue[] {
  const cues: Cue[] = [];
  let n = 0;
  const words = scene.beats.flatMap(b => b.words.flatMap((w, i) => {
    const t = plan.words[n++]!;
    const parts = fragments(w.display, t.start, t.end);
    return parts.map((f, j) => ({ ...f, last: i === b.words.length - 1 && j === parts.length - 1, whole: j === parts.length - 1 }));
  }));
  type Word = (typeof words)[number];
  const fits = (ws: Word[]) => wrap(ws.map(c => c.text)).length <= LINES && ws[ws.length - 1]!.end - ws[0]!.start <= MAX_S;
  // `cut`: the chunk ended because the next word would not fit, mid-sentence.
  const chunks: { ws: Word[]; cut: boolean }[] = [];
  let chunk: Word[] = [];
  const flush = (cut: boolean) => {
    if (chunk.length) chunks.push({ ws: chunk, cut });
    chunk = [];
  };
  for (const w of words) {
    if (chunk.length && !fits([...chunk, w])) flush(true);
    chunk.push(w);
    if (w.last || (w.whole && /[.!?]["')\]]*$/.test(w.text))) flush(false);
  }
  // A sentence's tail of one or two words would stand alone on screen: it takes words from the end of the
  // chunk before until it has ORPHAN, while it still fits.
  chunks.forEach((c, i) => {
    const tail = chunks[i + 1];
    if (!c.cut || !tail) return;
    while (tail.ws.length < ORPHAN && c.ws.length > 1 && fits([c.ws[c.ws.length - 1]!, ...tail.ws])) tail.ws = [c.ws.pop()!, ...tail.ws];
  });
  for (const { ws } of chunks) cues.push({ start: ws[0]!.start, end: ws[ws.length - 1]!.end, lines: wrap(ws.map(c => c.text)) });
  const end = frameTime(plan.frameCount);
  cues.forEach((c, i) => { c.end = Math.min(c.end + LINGER, cues[i + 1]?.start ?? end, c.start + MAX_S, end); });
  return cues;
}

/** The cue showing at S seconds `t`, if any. */
export function cueAt(cues: readonly Cue[], t: number): Cue | undefined {
  return cues.find(c => c.start <= t && t < c.end);
}
