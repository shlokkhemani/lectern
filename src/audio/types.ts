/**
 * The audio seam (§5). `voiceScene` turns one scene's narration into verified, processed audio with a
 * timing per IR Word, on clock A only (seconds from the start of the unspliced scene audio).
 * It hides providers, wire formats, hedging, retries, tokenising, diffing, provenance and the cache.
 *
 * Seam 3 (§11.1). Alternative considered: exported `tts()`, `stt()` and `diff()` steps. It lost because
 * retry, hedging and fallback need all three together, and the cache key and provenance would leak to callers.
 */
import type { Loc, Scene, Script } from '../ir.ts';

export interface VoicedScene {
  scene: number;
  /** Absolute path of the processed audio: 48 kHz mono, trimmed, loudness-normalised, unspliced. */
  wav: string;
  /** Seconds. */
  duration: number;
  /** One per IR Word of the scene, in order (beats flattened). Clock A seconds; start ≤ end. */
  words: WordTiming[];
  diff: DiffReport;
  /** TTS attempts spent, including the cache hit (1) or the estimate (0). */
  attempts: number;
  /** Which recogniser produced the timings; `estimate` = synthetic, no audio (`wav` is ''). */
  stt: 'scribe-v2' | 'nova-3' | 'estimate';
}

/**
 * `heard`: matched directly. `split`: matched as joined heard tokens (first onset, last end).
 * `approx`: interpolated. Invariant on a passing scene: cue anchors and edge words are never `approx`.
 */
export interface WordTiming { start: number; end: number; source: 'heard' | 'split' | 'approx'; conf?: number }

/** Gate G3 for one scene. `pass` false means the scene fails G3; `issues` say why. */
export interface DiffReport {
  pass: boolean;
  /** Word error rate over spoken tokens, 0..1. */
  wer: number;
  /** A5xx/T6xx failures and W510/W511 warnings, each tied to a word where possible. */
  issues: AudioIssue[];
}

export interface AudioIssue {
  code: string;
  severity: 'error' | 'warning';
  /** Index into the scene's flattened IR words, when the issue is about one word. */
  word?: number;
  /** What the recogniser heard there, for W510 ("in fixed" for "infix"). */
  heard?: string;
  message: string;
  fix: string;
  /** Set by `voiceScene`: the beat (0-based) of `word` (none for a scene-level issue), and the script line: the word's, else the first paragraph's. */
  beat?: number;
  loc?: Loc;
}

export interface VoiceOptions {
  /** Bypass the cache for this scene (`--revoice`). */
  revoice?: boolean;
  /** Where failed attempts are kept for diagnosis (`.work/`). */
  workDir: string;
  signal?: AbortSignal;
}

/**
 * Voice one scene. All scenes may be called at once; concurrency caps are internal.
 * Resolves for every audio outcome, including a G3 failure (then `diff.pass` is false and the lowest-WER
 * attempt is returned). Rejects only on setup errors: a missing API key or a missing ffmpeg.
 */
export type VoiceScene = (scene: Scene, ir: Script, opts: VoiceOptions) => Promise<VoicedScene>;

/**
 * Estimate mode (`check`, `shots`, `--no-audio`): a synthetic VoicedScene from the words alone, so every
 * later step runs unchanged. Pure; no network. `diff.pass` is true and `stt` is `estimate`.
 */
export type EstimateVoice = (scene: Scene) => VoicedScene;
