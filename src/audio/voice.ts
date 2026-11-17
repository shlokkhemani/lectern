// The audio seam's implementation (spec §5): `voiceScene` and `estimateVoice`.
//
// Production. A scene's narration is voiced as HEDGE takes in flight (one: a second take bought ~0.4 s
// a scene for twice the spend); each is processed and verified on its own; the first that passes is
// published to the cache and the rest are aborted. A failed take is replaced at once while fewer than
// MAX_TAKES have started. If every take fails, the closest one (lowest WER) is kept for diagnosis.
//
// Sharing. Production is keyed by the cache key and coalesced: concurrent scenes with the same
// spoken text share one production, and each caller then judges the shared take against its own
// words (its own cue anchors). A caller whose anchors the shared take cannot time gets a
// production of its own. Production is aborted only when every caller waiting on it has aborted.
//
// Across processes, a shared production first claims its key in the cache: if another process (a
// voicer started by `check`, or another build) is producing it, this one waits for that take
// instead of paying twice, and produces only if the other ends without publishing one.

import fs from 'node:fs/promises';
import path from 'node:path';
import type { Scene, Script, Word } from '../ir.ts';
import { cacheKey, claim, producing, readTake, writeTake } from './cache.ts';
import { HttpError } from './http.ts';
import { durationOf, tailSilence, wavBytes, type Pcm } from './pcm.ts';
import { hasFfmpeg, processVoice } from './process.ts';
import { transcribe } from './stt.ts';
import { tokenise } from './tokenise.ts';
import { synthesize, TTS_PROVIDER } from './tts.ts';
import type { EstimateVoice, VoicedScene, VoiceOptions, VoiceScene, WordTiming } from './types.ts';
import { judge, verifyTake, type Evidence, type Hear, type Verdict } from './verify.ts';

const HEDGE = 1;
let runs = 0;
const MAX_TAKES = 4;

/** The network behind voicing; `ready` throws on a setup error. */
interface Providers {
  speak: (text: string, model: string, voice: string, signal: AbortSignal) => Promise<Pcm>;
  hear: Hear;
  ready?: () => void;
}

const LIVE: Providers = {
  speak: synthesize,
  hear: transcribe,
  ready: () => {
    for (const name of ['GEMINI_API_KEY', 'OPENROUTER_API_KEY']) if (!process.env[name]) throw new Error(`${name} is not set; put it in .env`);
  },
};

/** The exact text sent to TTS for a scene: its beats' spoken words, paragraphs joined by a blank line. */
export function narrationText(scene: Scene): string {
  return scene.beats.map(b => b.words.flatMap(w => w.spoken).join(' ')).filter(Boolean).join('\n\n');
}

/** Builds `voiceScene` over `providers`. Each instance coalesces its own in-flight productions. */
function createVoiceScene(providers: Providers): VoiceScene {
  const inflight = new Map<string, Shared>();

  async function voice(...[scene, ir, opts]: Parameters<VoiceScene>): Promise<VoicedScene> {
    const words = scene.beats.flatMap(b => b.words);
    if (words.length === 0) return silentScene(scene.index);
    if (!hasFfmpeg()) throw new Error('ffmpeg is not on PATH; install it (brew install ffmpeg)');
    const text = narrationText(scene);
    const key = keyOf(ir, text);

    if (!opts.revoice) {
      const hit = await readTake(key);
      if (hit) {
        const verdict = judge(words, hit.evidence);
        if (verdict.pass) return voiced(scene.index, hit.wav, hit.evidence.duration, verdict, 1);
      }
    }
    providers.ready?.();
    const job: Job = { scene: scene.index, words, text, key, model: ir.meta.ttsModel, voice: ir.meta.voice, opts, providers,
      speechTokens: tokenise(text.split(/\s+/)).length, run: ++runs };
    const { production: shared, owner } = await join(inflight, job, opts.signal);
    const mine = judgeFor(words, shared.take);
    // The shared production was verified against its owner's words. A joiner whose own judgement
    // fails, whether or not the owner's passed, gets a production of its own (with its own 4 takes).
    if (!owner && !mine.pass) return finish(job, await produce({ ...job, run: ++runs }, opts.signal ?? new AbortController().signal), words);
    return voiced(scene.index, shared.wav, shared.take.evidence?.duration ?? 0, mine, shared.attempts);
  }

  return async (scene, ir, opts) => located(scene, await voice(scene, ir, opts));
}

/** Each issue placed on the script: the beat and line of its word; a scene-level issue, the first paragraph's line. */
function located(scene: Scene, v: VoicedScene): VoicedScene {
  const beatOf: number[] = scene.beats.flatMap((b, i) => b.words.map(() => i));
  const words = scene.beats.flatMap(b => b.words);
  const issues = v.diff.issues.map(i => {
    if (i.word === undefined) return { ...i, loc: scene.beats[0]?.loc ?? scene.loc };
    const beat = beatOf[i.word] ?? 0;
    return { ...i, beat, loc: words[i.word]?.loc ?? scene.beats[beat]?.loc ?? scene.loc };
  });
  return { ...v, diff: { ...v.diff, issues } };
}

export const voiceScene: VoiceScene = createVoiceScene(LIVE);

const keyOf = (ir: Script, text: string) => cacheKey({ provider: TTS_PROVIDER, model: ir.meta.ttsModel, voice: ir.meta.voice, text });

/** The scenes among `ks` with narration whose take is neither cached nor being produced by any process. */
export async function unvoiced(ir: Script, ks: readonly number[]): Promise<number[]> {
  const todo = await Promise.all(ks.map(async k => {
    const scene = ir.scenes[k]!;
    if (!scene.beats.some(b => b.words.length)) return false;
    const key = keyOf(ir, narrationText(scene));
    return !producing(key) && !(await readTake(key));
  }));
  return ks.filter((_, i) => todo[i]);
}

/**
 * Speech rate of processed narration (after the atempo speed-up), in IR words per second, with
 * PAUSE after each comma or full stop. Fitted on 80 voiced scenes (part 8 and nine trial videos,
 * 7,672 words, 2,540 s): 3.54. Each video's estimate lands within −3%…+7% of its voiced length;
 * single scenes within ±9% (p10–p90). The spec's 2.7 read 21–33% long.
 */
const WORDS_PER_SECOND = 3.5;
const PAUSE = 0.3;

/** Estimate mode: WORDS_PER_SECOND plus PAUSE after each comma or full stop (spec §4.5). Pure. */
export const estimateVoice: EstimateVoice = scene => {
  const words = estimateTimings(scene.beats.flatMap(b => b.words));
  return { scene: scene.index, wav: '', duration: words.at(-1)?.end ?? 0, words,
    diff: { pass: true, wer: 0, issues: [] }, attempts: 0, stt: 'estimate' };
};

function estimateTimings(words: readonly Word[]): WordTiming[] {
  let t = 0;
  return words.map(w => {
    const start = t;
    t += 1 / WORDS_PER_SECOND;
    const end = t;
    if (/[,.;:!?]["')\]]*$/.test(w.display)) t += PAUSE;
    return { start, end, source: 'approx' };
  });
}

// ---------------------------------------------------------------------------------------------

interface Job {
  scene: number; words: Word[]; text: string; key: string; model: string; voice: string;
  opts: VoiceOptions; providers: Providers;
  /** Spoken token count of the narration: the speech rate depends on the text alone, like the cache key. */
  speechTokens: number;
  /** Distinguishes productions in work-directory file names. */
  run: number;
}

interface Take {
  n: number;
  /** The verdict against the producing job's words. */
  verdict: Verdict;
  /** What the verdict was derived from; null when the take failed before verification. */
  evidence: Evidence | null;
  /** Processed 48 kHz WAV, when TTS produced audio. */
  wav: Uint8Array | null;
  /** Resolves to the take's WAV path in the work directory once written ('' without audio). */
  kept?: Promise<string>;
}

/** The outcome of one production: the published take, or the closest failed one. */
interface Production { passed: boolean; take: Take; wav: string; attempts: number }

interface Shared { promise: Promise<Production>; waiters: number; controller: AbortController }

/**
 * Joins (or starts, and then owns) the production for `job.key`. A caller's abort removes it
 * exactly once; the production is aborted only when no caller is left waiting on it.
 */
function join(inflight: Map<string, Shared>, job: Job, signal?: AbortSignal): Promise<{ production: Production; owner: boolean }> {
  if (signal?.aborted) return Promise.reject(signal.reason);
  let shared = inflight.get(job.key);
  const owner = !shared;
  if (!shared) {
    const controller = new AbortController();
    const s: Shared = { promise: produceClaimed(job, controller.signal), waiters: 0, controller };
    s.promise.catch(() => {}).finally(() => { if (inflight.get(job.key) === s) inflight.delete(job.key); });
    inflight.set(job.key, s);
    shared = s;
  }
  const s = shared;
  s.waiters++;
  return new Promise((resolve, reject) => {
    let waiting = true;
    /** Removes this caller from the production, once; true the first time. */
    const leave = () => {
      if (!waiting) return false;
      waiting = false;
      signal?.removeEventListener('abort', onAbort);
      s.waiters--;
      return true;
    };
    const onAbort = () => {
      if (!leave()) return;
      if (s.waiters === 0) { s.controller.abort(signal!.reason); if (inflight.get(job.key) === s) inflight.delete(job.key); }
      reject(signal!.reason);
    };
    if (signal?.aborted) return onAbort();
    signal?.addEventListener('abort', onAbort, { once: true });
    s.promise.then(
      production => { if (leave()) resolve({ production, owner }); },
      e => { if (leave()) reject(e); });
  });
}

/** A take judged against a caller's words. */
function judgeFor(words: readonly Word[], take: Take): Verdict {
  if (take.evidence) return judge(words, take.evidence);
  return { ...take.verdict, words: estimateTimings(words) };
}

function finish(job: Job, p: Production, words: readonly Word[]): VoicedScene {
  return voiced(job.scene, p.wav, p.take.evidence?.duration ?? 0, judgeFor(words, p.take), p.attempts);
}

/**
 * `produce`, unless another process is producing the key: then its take, if it publishes one that
 * passes for `job`'s words (a cache hit, attempts 1). `--revoice` neither waits nor reads the cache.
 */
async function produceClaimed(job: Job, signal: AbortSignal): Promise<Production> {
  if (job.opts.revoice) return produce(job, signal);
  const c = await claim(job.key, signal);
  if ('release' in c) {
    try { return await produce(job, signal); } finally { c.release(); }
  }
  const verdict = judge(job.words, c.evidence);
  if (!verdict.pass) return produce(job, signal);
  return { passed: true, take: { n: 0, verdict, evidence: c.evidence, wav: null }, wav: c.wav, attempts: 1 };
}

function produce(job: Job, signal: AbortSignal): Promise<Production> {
  return new Promise((resolve, reject) => {
    const running = new Map<number, AbortController>();
    const failed: Take[] = [];
    let started = 0;
    let settled = false;
    const settle = (f: () => void) => { if (settled) return; settled = true; for (const c of running.values()) c.abort(); signal.removeEventListener('abort', onAbort); f(); };
    const onAbort = () => settle(() => reject(signal.reason));
    if (signal.aborted) return onAbort();
    signal.addEventListener('abort', onAbort, { once: true });

    const start = () => {
      const n = ++started;
      const controller = new AbortController();
      running.set(n, controller);
      take(job, n, controller.signal).then(async t => {
        running.delete(n);
        if (settled) return;
        if (t.verdict.pass) {
          settle(() => {});
          try { resolve({ passed: true, take: t, wav: await writeTake(job.key, t.wav!, t.evidence!), attempts: started }); } catch (e) { reject(e); }
          return;
        }
        failed.push(t);
        t.kept = keepForDiagnosis(job, t);
        if (started < MAX_TAKES) start();
        else if (running.size === 0) {
          settle(() => {});
          try { resolve(await giveUp(failed, started)); } catch (e) { reject(e); }
        }
      }, e => { running.delete(n); if (!controller.signal.aborted) settle(() => reject(e)); });
    };
    for (let i = 0; i < HEDGE; i++) start();
  });
}

/** One take: TTS → process → verification. Any failure short of an abort is a failed take. */
async function take(job: Job, n: number, signal: AbortSignal): Promise<Take> {
  try {
    const raw = await job.providers.speak(job.text, job.model, job.voice, signal);
    signal.throwIfAborted();
    await fs.mkdir(workDir(job), { recursive: true });
    const processed = await processVoice(raw, job.speechTokens, `${takeBase(job, n)}.flac`, signal);
    if (!processed) return failedTake(n, `TTS take ${n} returned silence`, 'retried automatically');
    const wav = wavBytes(processed.audio);
    const take = { stt: { flac: processed.flac, wav: async () => wav }, duration: durationOf(processed.audio), rawTailSilence: tailSilence(raw) };
    const { verdict, evidence } = await verifyTake(job.words, take, job.providers.hear, signal);
    return { n, verdict, evidence, wav };
  } catch (e) {
    if (signal.aborted) throw e;
    const auth = e instanceof HttpError && (e.status === 401 || e.status === 403);
    return failedTake(n, `take ${n} failed: ${e instanceof Error ? e.message : String(e)}`,
      auth ? 'check GEMINI_API_KEY' : 'retried automatically; if every take fails, check the network and API quota, then rebuild');
  }
}

function failedTake(n: number, message: string, fix: string): Take {
  return { n, wav: null, evidence: null,
    verdict: { pass: false, wer: 1, stt: 'scribe-v2', words: [], issues: [{ code: 'A504', severity: 'error', message, fix }] } };
}

/** Every take failed: the closest one (audio first, then lowest WER), as kept in the work directory. */
async function giveUp(takes: Take[], attempts: number): Promise<Production> {
  const withAudio = takes.filter(t => t.wav);
  const best = (withAudio.length ? withAudio : takes).reduce((a, b) => (b.verdict.wer < a.verdict.wer ? b : a));
  return { passed: false, take: best, wav: await best.kept!, attempts };
}

/** Writes a failed take's audio and verdict to `<workDir>/voice/` and returns the WAV path. */
async function keepForDiagnosis(job: Job, t: Take): Promise<string> {
  const base = takeBase(job, t.n);
  await fs.mkdir(workDir(job), { recursive: true });
  await fs.writeFile(`${base}.json`, JSON.stringify({ verdict: t.verdict, evidence: t.evidence, text: job.text }, null, 1));
  if (!t.wav) return '';
  await fs.writeFile(`${base}.wav`, t.wav);
  return path.resolve(`${base}.wav`);
}

const workDir = (job: Job) => path.join(job.opts.workDir, 'voice');
const takeBase = (job: Job, n: number) => path.join(workDir(job), `scene-${job.scene}-run-${job.run}-take-${n}`);

function voiced(scene: number, wav: string, duration: number, v: Verdict, attempts: number): VoicedScene {
  return { scene, wav, duration, words: v.words, diff: { pass: v.pass, wer: v.wer, issues: v.issues }, attempts, stt: v.stt };
}

function silentScene(scene: number): VoicedScene {
  return { scene, wav: '', duration: 0, words: [], diff: { pass: true, wer: 0, issues: [] }, attempts: 0, stt: 'estimate' };
}
