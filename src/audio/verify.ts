// Gate G3 for one take (spec §5.7–5.8): what the recognisers heard against the script, a timing
// per IR word, and every issue with its fix. This module owns the verification policy: which
// recognisers run, what their absence means, and the trailing-silence check.
//
// Both recognisers verify. Scribe v2 is primary (best word onsets); nova-3 runs in parallel on
// the same audio and can veto, because Scribe's language model quietly restores dropped words
// and smooths repeated phrases that nova-3 still reports.
// nova-3's evidence is therefore required: if it cannot be reached the take fails A505. Only
// when Scribe is unreachable does nova-3 verify alone (the spec's fallback).

import type { Word } from '../ir.ts';
import { checkTranscript, resolveWithFallback, type HeardWord, type ScriptWord, type TranscriptCheck, type TranscriptWarning } from './diff.ts';
import type { SttAudio, SttModel } from './stt.ts';
import type { AudioIssue, WordTiming } from './types.ts';

/** Everything a verdict is derived from; stored with a cached take so it can be re-judged against an edited script. */
export interface Evidence {
  /** Processed audio length, s. */
  duration: number;
  /** Trailing silence of the raw TTS output before trimming, s. */
  rawTailSilence: number;
  /** What each recogniser heard; null if it was unreachable or not asked. */
  scribe: HeardWord[] | null;
  nova: HeardWord[] | null;
}

export interface Verdict {
  pass: boolean;
  wer: number;
  issues: AudioIssue[];
  words: WordTiming[];
  stt: 'scribe-v2' | 'nova-3';
}

/** Transcribes audio with one recogniser; rejects when it cannot. */
export type Hear = (audio: SttAudio, model: SttModel, signal: AbortSignal) => Promise<HeardWord[]>;

/** The audio of one take, as verification needs it. */
export interface TakeAudio { stt: SttAudio; duration: number; rawTailSilence: number }

/** Raw TTS audio must end with at least this much silence; less means it was cut off. */
const MIN_TAIL_SILENCE = 0.1;

/**
 * Verifies a fresh take of `words` (a scene's IR words, beats flattened): gathers the evidence
 * (skipping transcription for a cut-off take) and judges it. Rejects only when `signal` aborts.
 */
export async function verifyTake(words: readonly Word[], take: TakeAudio, hear: Hear, signal: AbortSignal):
  Promise<{ verdict: Verdict; evidence: Evidence }> {
  const evidence: Evidence = { duration: take.duration, rawTailSilence: take.rawTailSilence, scribe: null, nova: null };
  signal.throwIfAborted();
  if (take.rawTailSilence >= MIN_TAIL_SILENCE) {
    const ask = (model: SttModel) => hear(take.stt, model, signal).catch((e): null => { if (signal.aborted) throw e; return null; });
    [evidence.scribe, evidence.nova] = await Promise.all([ask('scribe-v2'), ask('nova-3')]);
  }
  return { verdict: judge(words, evidence), evidence };
}

/** Judges stored evidence against `words`, e.g. a cached take against an edited script. Pure. */
export function judge(words: readonly Word[], ev: Evidence): Verdict {
  const script = words.map((w): ScriptWord => ({ spoken: w.spoken.join(' '), display: w.display }));
  const display = (i: number) => words[i]?.display ?? '';
  const where = (i: number) => context(words, i);
  const unheard = (code: string, message: string, fix: string): Verdict => ({
    pass: false, wer: 1, stt: ev.scribe ? 'scribe-v2' : 'nova-3', words: checkTranscript(script, [], ev.duration).words,
    issues: [{ code, severity: 'error', message, fix }],
  });
  if (ev.rawTailSilence < MIN_TAIL_SILENCE) {
    return unheard('A503', `the voice stops abruptly (${Math.round(ev.rawTailSilence * 1000)} ms of trailing silence): the take was cut off`, FIX.retake);
  }
  if (!ev.scribe && !ev.nova) return unheard('A505', 'neither recogniser could transcribe the audio, so it cannot be verified', FIX.stt);

  const primaryModel: SttModel = ev.scribe ? 'scribe-v2' : 'nova-3';
  const primary = checkTranscript(script, (ev.scribe ?? ev.nova)!, ev.duration);
  const second = ev.scribe && ev.nova ? checkTranscript(script, ev.nova, ev.duration) : null;
  const issues: AudioIssue[] = [];

  if (ev.scribe && !ev.nova) {
    issues.push({ code: 'A505', severity: 'error', message: 'nova-3 could not be reached, so the take lacks its second, acoustic check', fix: FIX.stt });
  }
  for (const f of primary.failures) issues.push(failure(f, where));
  for (const f of second?.failures ?? []) {
    if (!primary.failures.some(p => p.code === f.code)) issues.push(failure(f, where, 'nova-3: '));
  }
  issues.push(...agreedWarnings(second ? [primary.warnings, second.warnings] : [primary.warnings], display, where));

  // Cue anchors and paragraph edges need a heard time in narration order, and neither recogniser may say they were missing.
  const needed = words.flatMap((w, i) => (w.cues.length > 0 || w.edge ? [i] : []));
  const { words: timings, unresolved } = resolveWithFallback(primary.words, second?.words ?? [], needed);
  const missing = new Set([...unresolved, ...needed.filter(i => second?.words[i]?.source === 'approx')]);
  for (const i of [...missing].sort((a, b) => a - b)) {
    const cued = words[i]!.cues.length > 0;
    issues.push({ code: 'T601', severity: 'error', word: i,
      message: `"${display(i)}" (${cued ? 'a cue fires on it' : 'it starts or ends a paragraph'}) has no verified time: it was not clearly heard`,
      fix: cued ? 'move the cue to a neighbouring word that is a plain word, not a number or name'
        : 'rephrase so the paragraph starts and ends on a plain word, not a number or name' });
  }
  return { pass: !issues.some(x => x.severity === 'error'), wer: primary.wer, issues, words: timings, stt: primaryModel };
}

const FIX = {
  retake: 'retried automatically; if it persists, shorten or rephrase the sentence',
  stt: 'check OPENROUTER_API_KEY and the network, then rebuild',
};

function failure(f: TranscriptCheck['failures'][number], where: (i: number) => string, prefix = ''): AudioIssue {
  const fix = f.code === 'A502' ? 'if most warnings below are one word, paste the say: line from its fix; otherwise retried automatically' : FIX.retake;
  // A502 is the scene's error rate: it belongs to no one word.
  if (f.code === 'A502') return { code: f.code, severity: 'error', message: `${prefix}${f.message}`, fix };
  return { code: f.code, severity: 'error', word: f.word, message: `${prefix}${f.message} in "${where(f.word)}"`, fix };
}

/** Up to CONTEXT words either side of word `i`, within its sentence, so an author can find it ("…puzzle in 1975."). */
function context(words: readonly Word[], i: number): string {
  const ends = (k: number) => /[.!?]["'”’)\]]*$/.test(words[k]?.display ?? '');
  let a = i, b = i;
  while (a > 0 && i - a < CONTEXT && !ends(a - 1)) a--;
  while (b < words.length - 1 && b - i < CONTEXT && !ends(b)) b++;
  const text = words.slice(a, b + 1).map(w => w.display).join(' ');
  return `${a > 0 && !ends(a - 1) ? '…' : ''}${text}${b < words.length - 1 && !ends(b) ? '…' : ''}`;
}
const CONTEXT = 4;

/**
 * One warning per fault that every recogniser reported; a fault only one of them reports is that
 * recogniser's own error, not the voice's (36 of 49 round-4 warnings). A fault is identified by its code,
 * script-token position and expected tokens; for an insertion also by what was heard, since that is
 * the fault. A substitution heard differently by each recogniser is one fault, showing each hearing.
 */
function agreedWarnings(sources: TranscriptWarning[][], display: (i: number) => string, where: (i: number) => string): AudioIssue[] {
  const key = (w: TranscriptWarning) => [w.code, w.token, w.expected, w.code === 'W512' ? w.heard : ''].join('\u0000');
  const [first = [], ...rest] = sources;
  return first.flatMap(w => {
    const same = rest.map(ws => ws.find(x => key(x) === key(w)));
    if (same.some(x => !x)) return [];
    const heard = [w.heard, ...same.map(x => x!.heard)];
    return [warning(w, display, heard.every(h => h === w.heard) ? null : heard, where)];
  });
}

const bare = (display: string) => display.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '');

/** `heardEach` lists each recogniser's hearing when they differ, else null. */
function warning(w: TranscriptWarning, display: (i: number) => string, heardEach: string[] | null, where: (i: number) => string): AudioIssue {
  const word = display(w.word);
  const at = ` in "${where(w.word)}"`;
  switch (w.code) {
    case 'W510': {
      const heard = heardEach ? heardEach.map(h => `"${h}"`).join(' or ') : `"${w.heard}"`;
      const line = heardEach ? null : sayLine(word, w.expected, w.heard);
      return { code: 'W510', severity: 'warning', word: w.word, heard: w.heard, message: `heard ${heard} for "${word}"${at}`,
        fix: /\p{N}/u.test(word) ? 'a number cannot take a say line: rephrase it (numbers side by side run together: "about one 8" is heard "about 1.8", "about one magnitude 8" is not)'
          : line ? `if "${line.heard}" sounds the same as "${line.word}", paste ${line.text} into the front matter; otherwise the voice said another word: rephrase if that changes the meaning, else ignore`
          : 'if it is a name or term the voice may say wrongly, add a say respelling of how it sounds; otherwise rephrase if the meaning changes, else ignore' };
    }
    case 'W511': return { code: 'W511', severity: 'warning', word: w.word,
      message: `${w.expected === bare(word) ? `"${w.expected}"` : `"${w.expected}" in "${word}"`} was not heard${at}`,
      fix: 'the voice skipped or slurred it: build with --revoice and this scene\'s number for a new take; if it is missed again, rephrase the sentence' };
    case 'W512': return { code: 'W512', severity: 'warning', word: w.word, heard: w.heard,
      message: `the voice said an extra "${w.heard}" ${w.atStart ? 'before' : 'after'} "${word}"${at}`,
      fix: 'rephrase so the voice has nothing to read aloud there (number lists like "add, 2, 3" make it say "comma")' };
  }
}

/**
 * The `say:` line that makes the voice say, and the check expect, what both recognisers heard, e.g.
 * `say: { Ana: Anna }`. Only for a word of letters said as one token; a possessive maps its stem.
 */
function sayLine(display: string, expected: string, heard: string): { word: string; heard: string; text: string } | null {
  const word = display.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');   // punctuation only: "6s" keeps its digit, so gets no line
  if (!/^\p{L}+(?:'\p{L}+)?$/u.test(word) || expected !== bare(word) || !/^[\p{L}' ]+$/u.test(heard)) return null;
  const possessive = /'s$/i.test(word) && /'s$/i.test(heard);
  const key = possessive ? word.slice(0, -2) : word;
  const stem = possessive ? heard.slice(0, -2) : heard;
  const said = key[0] !== key[0]!.toLowerCase() ? stem[0]!.toUpperCase() + stem.slice(1) : stem;
  if (/'/.test(key + said)) return null;
  return { word: key, heard: stem, text: `say: { ${key}: ${said} }` };
}
