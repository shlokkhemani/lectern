// Transcript verification and timing provenance (spec §5.7–5.8).
//
// `checkTranscript` aligns what the script says against what the STT heard, judges the
// alignment (fail reasons, W510/W511/W512 warnings) and projects heard word times onto
// every script word with a provenance. It is pure; thresholds live here and nowhere else
// (tuned on the measured part 8 takes).

import { tokenise, units, type Unit } from './tokenise.ts';
import type { WordTiming } from './types.ts';

/** A word as returned by an STT provider, times in seconds on the audio's own clock. */
export interface HeardWord { text: string; start: number; end: number; conf?: number }

/**
 * A script word as the voice says it. A bare string is said as written. A respelled word (a `say`
 * entry) also gives its `display` form: recognisers write the real name ("Erdős"), not the
 * respelling the voice read ("air dish"), so either one counts as heard.
 */
export type ScriptWord = string | { spoken: string; display: string };


export type WarningCode = 'W510' | 'W511' | 'W512';
/**
 * A reviewable mismatch. `word` indexes the script word list; `heard`/`expected` are spoken tokens.
 * `token` is the index of the first affected script token (for an insertion, the token it precedes).
 * An insertion (W512) sits after `word`, or before it when `atStart` (nothing precedes it).
 */
export interface TranscriptWarning { code: WarningCode; word: number; token: number; expected: string; heard: string; message: string; atStart?: true }

export type FailCode = 'A501' | 'A502' | 'A503';
export interface TranscriptFailure { code: FailCode; word: number; message: string }

export interface TranscriptCheck {
  pass: boolean;
  failures: TranscriptFailure[];
  warnings: TranscriptWarning[];
  wer: number;                 // errors / script tokens
  maxRun: number;              // longest run of consecutive insertions/deletions, in tokens
  tailMisses: number;          // how many of the last TAIL_TOKENS script tokens went unmatched
  words: WordTiming[];         // one per script word
}

/** Fail if any insertion/deletion run reaches this many tokens. */
export const MAX_RUN = 2;
/** Fail if WER exceeds this and at least MIN_WER_ERRORS errors were counted. */
export const MAX_WER = 0.05;
/** One or two substitutions in a short scene are W510 warnings (often recogniser homophones), not a failure. */
export const MIN_WER_ERRORS = 3;
/** Fail if this many trailing script tokens are all unmatched (truncated tail). */
export const TAIL_TOKENS = 3;

/**
 * Compares the spoken form of each script word against the heard words of one audio file.
 * `duration` (s) bounds interpolation of words that could not be heard.
 */
export function checkTranscript(script: readonly ScriptWord[], heard: readonly HeardWord[], duration: number): TranscriptCheck {
  const spoken = script.map(w => (typeof w === 'string' ? w : w.spoken));
  const s = units(spoken);
  const h = units(heard.map(w => w.text));
  const ops = align(s, h, alternatives(script, s));
  const judged = judge(ops, s, h, script.length);
  return { ...judged, words: project(ops, s, h, spoken, heard, duration) };
}

/** Script units [s0, s1) of one respelled word, which may also be heard as `keys` (its display form). */
interface Alternative { s0: number; s1: number; keys: string[] }

function alternatives(script: readonly ScriptWord[], s: readonly Unit[]): Alternative[] {
  const out: Alternative[] = [];
  script.forEach((w, i) => {
    if (typeof w === 'string') return;
    const s0 = s.findIndex(u => u.src === i);
    if (s0 < 0) return;
    let s1 = s0;
    while (s1 < s.length && s[s1]!.src === i && s[s1]!.last === i) s1++;
    if (s1 < s.length && s[s1]!.src <= i) return;   // a number shared with a neighbour: no clean span
    const keys = units([w.display]).map(u => u.key);
    if (keys.length && keys.join(' ') !== s.slice(s0, s1).map(u => u.key).join(' ')) out.push({ s0, s1, keys });
  });
  return out;
}

/** How far (s) a fallback timing may overlap its neighbours: the recognisers' word edges differ by about this much. */
export const FALLBACK_TOLERANCE = 0.1;

/**
 * Takes timings from `fallback` for the words in `needed` whose primary timing is approx and
 * whose fallback timing is not, provided the result stays in narration order: a borrowed timing
 * must start and end strictly after the previous word's start and end, and strictly before the
 * next word's, and may overlap either neighbour by at most FALLBACK_TOLERANCE. Returns the merged timings and the needed words still unresolved
 * (no fallback timing, or one that conflicts with its neighbours).
 */
export function resolveWithFallback(primary: readonly WordTiming[], fallback: readonly WordTiming[], needed: readonly number[]):
  { words: WordTiming[]; unresolved: number[] } {
  const words = primary.slice();
  const unresolved: number[] = [];
  for (const i of [...needed].sort((a, b) => a - b)) {
    if (words[i]?.source !== 'approx') continue;
    const f = fallback[i];
    const prev = words[i - 1], next = words[i + 1];
    // Strictly after the previous word and before the next (starts and ends both in order),
    // overlapping either by at most FALLBACK_TOLERANCE.
    const fits = f !== undefined && f.source !== 'approx'
      && (!prev || (f.start > prev.start && f.end > prev.end && f.start >= prev.end - FALLBACK_TOLERANCE))
      && (!next || (f.start < next.start && f.end < next.end && f.end <= next.start + FALLBACK_TOLERANCE));
    if (fits) words[i] = f; else unresolved.push(i);
  }
  return { words, unresolved };
}

// ---------------------------------------------------------------------------------------------
// Alignment

type OpKind = 'match' | 'sub' | 'del' | 'ins' | 'join';
/** Script tokens [s0, s1) aligned with heard tokens [h0, h1). `cost` = errors it counts (0 or 1). */
interface Op { kind: OpKind; s0: number; s1: number; h0: number; h1: number; cost: number }

const MAX_JOIN = 3;
const JOIN_TIE = 1e-3;

function align(sUnits: readonly Unit[], hUnits: readonly Unit[], alts: readonly Alternative[]): Op[] {
  const s = sUnits.map(u => u.key), h = hUnits.map(u => u.key);
  const n = s.length, m = h.length, W = m + 1;
  const altsEndingAt = new Map<number, Alternative[]>();
  for (const a of alts) altsEndingAt.set(a.s1, [...(altsEndingAt.get(a.s1) ?? []), a]);
  const cost = new Float64Array((n + 1) * W).fill(Infinity);
  const back: (Op | undefined)[] = new Array((n + 1) * W);
  cost[0] = 0;
  // Candidates are relaxed in preference order; strict `<` keeps the first on ties.
  // A join also pays JOIN_TIE, so "commas so"/"commas" stays a match plus a deletion.
  const relax = (i: number, j: number, kind: OpKind, s0: number, h0: number, c: number) => {
    const total = cost[s0 * W + h0]! + c + (kind === 'join' ? JOIN_TIE : 0);
    if (total < cost[i * W + j]!) { cost[i * W + j] = total; back[i * W + j] = { kind, s0, s1: i, h0, h1: j, cost: c }; }
  };
  const sLen = sUnits.map(u => letters(u).length), hLen = hUnits.map(u => letters(u).length);
  const span = (lens: number[], a: number, b: number) => { let n = 0; for (let x = a; x < b; x++) n += lens[x]!; return n; };
  const tryJoin = (i: number, j: number, s0: number, h0: number) => {
    if (cost[s0 * W + h0]! + JOIN_TIE >= cost[i * W + j]!) return;   // could not win even if exact
    if (Math.abs(span(sLen, s0, i) - span(hLen, h0, j)) > 3) return;  // no join or contraction is that far apart
    const c = joinCost(sUnits.slice(s0, i), hUnits.slice(h0, j));
    if (c !== null) relax(i, j, 'join', s0, h0, c);
  };
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= m; j++) {
      if (i > 0 && j > 0) relax(i, j, s[i - 1] === h[j - 1] ? 'match' : 'sub', i - 1, j - 1, s[i - 1] === h[j - 1] ? 0 : 1);
      if (i > 0) relax(i, j, 'del', i - 1, j, 1);
      if (j > 0) relax(i, j, 'ins', i, j - 1, 1);
      for (let k = 2; k <= MAX_JOIN; k++) {   // last: JOIN_TIE already makes joins lose ties
        if (i >= 1 && j >= k) tryJoin(i, j, i - 1, j - k);
        if (i >= k && j >= 1) tryJoin(i, j, i - k, j - 1);
      }
      for (const a of altsEndingAt.get(i) ?? []) {   // a respelled word heard as its display form
        const h0 = j - a.keys.length;
        if (h0 >= 0 && a.keys.every((k, x) => h[h0 + x] === k)) relax(i, j, 'match', a.s0, h0, 0);
      }
    }
  }
  const ops: Op[] = [];
  for (let i = n, j = m; i > 0 || j > 0;) {
    const op = back[i * W + j]!;
    ops.push(op);
    i = op.s0; j = op.h0;
  }
  return ops.reverse();
}

/**
 * Cost of aligning several units on one side with one unit on the other:
 * 0 if they spell the same thing (spacing or a contraction), 1 if close, null if not a join.
 */
function joinCost(script: readonly Unit[], heard: readonly Unit[]): number | null {
  const [oneUnit, manyUnits] = script.length === 1 ? [script[0]!, heard] : [heard[0]!, script];
  if (sameExpansion(oneUnit.text, manyUnits.map(u => u.text))) return 0;
  const one = letters(oneUnit), many = manyUnits.map(letters);
  const allowed = one.length >= 5 ? 2 : one.length === 4 ? 1 : 0;
  if (Math.abs(one.length - many.reduce((n, t) => n + t.length, 0)) > allowed) return null;   // cheap reject
  const { distance, used } = charAlign(one, many);
  if (distance > allowed) return null;
  // Every joined token must contribute a matching letter; otherwise it is a lost word
  // ("commas so" for "commas"), not a split ("in fixed" for "infix").
  if (!used.every(Boolean)) return null;
  return distance === 0 ? 0 : 1;
}

/** What a join compares: a word's spelling-free key, or a number's spoken words ("every one" ~ "everyone"). */
const letters = (u: Unit) => (/^\d/.test(u.key) ? u.text.replace(/ /g, '') : u.key);

/** Levenshtein distance between `a` and the concatenation of `parts`, and which parts had a letter matched. */
function charAlign(a: string, parts: readonly string[]): { distance: number; used: boolean[] } {
  const b = parts.join('');
  const owner: number[] = parts.flatMap((p, k) => Array<number>(p.length).fill(k));
  const W = b.length + 1;
  const d = new Uint16Array((a.length + 1) * W);
  for (let j = 0; j <= b.length; j++) d[j] = j;
  for (let i = 1; i <= a.length; i++) {
    d[i * W] = i;
    for (let j = 1; j <= b.length; j++) {
      d[i * W + j] = Math.min(d[(i - 1) * W + j]! + 1, d[i * W + j - 1]! + 1, d[(i - 1) * W + j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  const used = parts.map(() => false);
  for (let i = a.length, j = b.length; i > 0 && j > 0;) {
    const here = d[i * W + j]!;
    if (a[i - 1] === b[j - 1] && here === d[(i - 1) * W + j - 1]) { used[owner[j - 1]!] = true; i--; j--; }
    else if (here === d[(i - 1) * W + j - 1]! + 1) { i--; j--; }
    else if (here === d[i * W + j - 1]! + 1) j--;
    else i--;
  }
  return { distance: d[a.length * W + b.length]!, used };
}

const CONTRACTIONS: Record<string, string[][]> = {
  "n't": [['not']], "'re": [['are']], "'ve": [['have']], "'ll": [['will']], "'m": [['am']],
  "'d": [['would'], ['had']], "'s": [['is'], ['has']],
};
const IRREGULAR_NOT: Record<string, string> = { "can't": 'can', "won't": 'will', "shan't": 'shall', "ain't": 'is' };

/** "they're" ~ [they, are]; "can't" ~ [can, not] / [cannot]. */
function sameExpansion(contracted: string, words: readonly string[]): boolean {
  if (words.length !== 2) return contracted === "can't" && words.join(' ') === 'cannot';
  const [a, b] = words as [string, string];
  const irregular = IRREGULAR_NOT[contracted];
  if (irregular) return a === irregular && b === 'not';
  for (const [suffix, expansions] of Object.entries(CONTRACTIONS)) {
    if (!contracted.endsWith(suffix)) continue;
    const stem = contracted.slice(0, -suffix.length);
    if (stem === a && expansions.some(e => e[0] === b)) return true;
  }
  return false;
}


// ---------------------------------------------------------------------------------------------
// Judgement

function judge(ops: readonly Op[], s: readonly Unit[], h: readonly Unit[], wordCount: number):
  Omit<TranscriptCheck, 'words'> {
  const failures: TranscriptFailure[] = [];
  const warnings: TranscriptWarning[] = [];
  const text = (us: readonly Unit[], a: number, b: number) => us.slice(a, b).map(u => u.text).join(' ');
  // An op that covers script tokens belongs to the first one's word. An insertion covers none:
  // it belongs to the preceding token's word, or, at the very start, before the first word.
  const wordAt = (op: Op) => (op.kind !== 'ins' ? s[op.s0]!.src : op.s0 > 0 ? s[op.s0 - 1]!.src : 0);
  const atStart = (op: Op) => op.kind === 'ins' && op.s0 === 0;

  let errors = 0;
  let maxRun = 0;
  for (let k = 0; k < ops.length;) {
    const op = ops[k]!;
    if (op.kind === 'ins' || op.kind === 'del') {
      let end = k;
      while (end < ops.length && (ops[end]!.kind === 'ins' || ops[end]!.kind === 'del')) end++;
      const run = ops.slice(k, end);
      errors += run.length;
      maxRun = Math.max(maxRun, run.length);
      const dels = run.filter(o => o.kind === 'del');
      const inss = run.filter(o => o.kind === 'ins');
      const missing = dels.map(o => s[o.s0]!.text).join(' ');
      const extra = inss.map(o => h[o.h0]!.text).join(' ');
      const at = dels[0] ?? op;   // a run with a deletion belongs to the first missing word
      if (run.length >= MAX_RUN) {
        const parts = [missing && `missing "${missing}"`, extra && `heard extra "${extra}"`].filter(Boolean).join(', ');
        failures.push({ code: 'A501', word: wordAt(at), message: `${parts} (${run.length} tokens in a row)` });
      } else if (op.kind === 'del') {
        warnings.push({ code: 'W511', word: wordAt(op), token: op.s0, expected: missing, heard: '', message: `"${missing}" was not heard` });
      } else {
        warnings.push({ code: 'W512', word: wordAt(op), token: op.s0, expected: '', heard: extra, message: `heard extra "${extra}"`, ...(atStart(op) && { atStart: true as const }) });
      }
      k = end;
      continue;
    }
    if (op.cost > 0) {
      errors += op.cost;
      const expected = text(s, op.s0, op.s1), got = text(h, op.h0, op.h1);
      warnings.push({ code: 'W510', word: wordAt(op), token: op.s0, expected, heard: got, message: `heard "${got}" for "${expected}"` });
    }
    k++;
  }

  const wer = s.length ? errors / s.length : (h.length ? 1 : 0);
  if (wer > MAX_WER && errors >= MIN_WER_ERRORS) failures.push({ code: 'A502', word: 0, message: `word error rate ${(wer * 100).toFixed(1)}% > ${MAX_WER * 100}%` });

  const tailStart = Math.max(0, s.length - TAIL_TOKENS);
  let tailMisses = 0;
  for (const op of ops) {
    if ((op.kind === 'del' || op.kind === 'sub') && op.s0 >= tailStart) tailMisses += op.s1 - op.s0;
  }
  if (s.length > 0 && tailMisses >= Math.min(TAIL_TOKENS, s.length)) {
    failures.push({ code: 'A503', word: Math.max(0, wordCount - 1), message: `the last ${TAIL_TOKENS} words were not heard (truncated tail)` });
  }
  return { pass: failures.length === 0, failures, warnings, wer, maxRun, tailMisses };
}

// ---------------------------------------------------------------------------------------------
// Provenance projection

function project(ops: readonly Op[], s: readonly Unit[], h: readonly Unit[], script: readonly string[], heard: readonly HeardWord[],
  duration: number): WordTiming[] {
  const wordCount = script.length;
  // Per script word: the heard words its tokens landed on, whether any token was lost, whether a join was used.
  const hw: Set<number>[] = Array.from({ length: wordCount }, () => new Set());
  const lost = new Array<boolean>(wordCount).fill(false);
  const joined = new Array<boolean>(wordCount).fill(false);
  const tokenCount = new Array<number>(wordCount).fill(0);
  const weight = new Array<number>(wordCount).fill(0);
  // A word weighs the letters it is spoken with ("1975" as "one thousand nine…"); a unit covers every word it was read from.
  for (const t of tokenise(script)) weight[t.src]! += t.text.length;
  for (const u of s) for (let w = u.src; w <= u.last; w++) tokenCount[w]!++;
  const gap = (op: Op | undefined) => op?.kind === 'del' || op?.kind === 'ins';
  ops.forEach((op, k) => {
    // A substitution next to an insertion or deletion is an ambiguous alignment
    // ("the test" heard as "that"): its time cannot be trusted.
    const ambiguous = op.kind === 'sub' && (gap(ops[k - 1]) || gap(ops[k + 1]));
    for (let i = op.s0; i < op.s1; i++) {
      for (let w = s[i]!.src; w <= s[i]!.last; w++) {
        if (op.kind === 'del' || ambiguous) { lost[w] = true; continue; }
        for (let j = op.h0; j < op.h1; j++) for (let x = h[j]!.src; x <= h[j]!.last; x++) hw[w]!.add(x);
        if (op.kind === 'join') joined[w] = true;
      }
    }
  });

  const out: (WordTiming | null)[] = new Array(wordCount).fill(null);
  const timed = (w: number) => tokenCount[w]! > 0 && !lost[w] && hw[w]!.size > 0;
  for (let w = 0; w < wordCount;) {
    if (!timed(w)) { w++; continue; }
    // A cluster is a run of script words that share heard words; it is split proportionally.
    let end = w + 1;
    const span = new Set(hw[w]);
    while (end < wordCount && timed(end) && [...hw[end]!].some(x => span.has(x))) { for (const x of hw[end]!) span.add(x); end++; }
    const hs = [...span].sort((a, b) => a - b).map(i => heard[i]!);
    const t0 = Math.min(...hs.map(x => x.start)), t1 = Math.max(...hs.map(x => x.end));
    const confs = hs.map(x => x.conf).filter((c): c is number => c !== undefined);
    const conf = confs.length ? Math.min(...confs) : undefined;
    if (end - w === 1) {
      out[w] = { start: t0, end: t1, source: joined[w] ? 'split' : 'heard', ...(conf !== undefined && { conf }) };
    } else {
      const total = sum(weight.slice(w, end));
      let acc = 0;
      for (let k = w; k < end; k++) {
        const a = t0 + (t1 - t0) * acc / total;
        acc += weight[k]!;
        out[k] = { start: a, end: t0 + (t1 - t0) * acc / total, source: 'split', ...(conf !== undefined && { conf }) };
      }
    }
    w = end;
  }

  // Interpolate every run of untimed words inside the gap its timed neighbours leave.
  for (let w = 0; w < wordCount;) {
    if (out[w]) { w++; continue; }
    let end = w;
    while (end < wordCount && !out[end]) end++;
    const lo = w > 0 ? out[w - 1]!.end : 0;
    const hi = Math.max(lo, end < wordCount ? out[end]!.start : duration);
    const weights = weight.slice(w, end).map(x => Math.max(1, x));
    const total = sum(weights);
    let acc = 0;
    for (let k = w; k < end; k++) {
      const a = lo + (hi - lo) * acc / total;
      acc += weights[k - w]!;
      out[k] = { start: a, end: lo + (hi - lo) * acc / total, source: 'approx' };
    }
    w = end;
  }
  return out as WordTiming[];
}

const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);
