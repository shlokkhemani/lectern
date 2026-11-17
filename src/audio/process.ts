// Turning raw TTS audio into the scene's processed audio (spec §5.4), and generic decoding.
// One ffmpeg call per attempt: tempo, resample, loudness measurement and the STT upload
// are produced together; trimming and the final linear gain are exact sample operations.

import { durationOf, pcmBytes, parseWav, trimSilence, type Pcm } from './pcm.ts';

export const OUT_RATE = 48_000;
const STT_RATE = 16_000;
// Spec said −16 LUFS; Gemini speech peaks ~18 dB above its loudness, so linear gain capped at
// −1.5 dBTP landed scenes anywhere in −19.8…−16.8 LUFS (audible jumps between scenes). −20 fits
// the peak budget for all 16 measured scenes (part 8 takes), so every scene
// lands on the same loudness with no limiter.
const TARGET_LUFS = -20;
const MAX_TRUE_PEAK = -1.5;
const TARGET_WPM = 160;
const MAX_TEMPO = 1.25;

export interface Processed {
  /** 48 kHz mono PCM16, trimmed, tempo-adjusted, at −20 LUFS with true peak ≤ −1.5 dBTP. */
  audio: Pcm;
  /** The same audio as 16 kHz mono FLAC, for STT. Same timeline as `audio`. */
  flac: Uint8Array<ArrayBuffer>;
  tempo: number;
}

/**
 * Processes raw TTS audio for a scene of `wordCount` words. Null if it holds no sound.
 * `scratch` is a file path ffmpeg may write the FLAC to; it is left in place.
 */
export async function processVoice(raw: Pcm, wordCount: number, scratch: string, signal?: AbortSignal): Promise<Processed | null> {
  const trimmed = trimSilence(raw);
  const seconds = durationOf(trimmed);
  if (seconds < 0.2) return null;
  const wpm = wordCount / (seconds / 60);
  const tempo = Math.min(MAX_TEMPO, Math.max(1, TARGET_WPM / wpm));
  const filter = `[0:a]atempo=${tempo.toFixed(4)},aresample=${OUT_RATE},asplit=2[a][b];`
    + `[a]ebur128=peak=true:framelog=quiet[out];[b]aresample=${STT_RATE}[stt]`;
  const { stdout, stderr } = await ffmpeg(
    ['-f', 's16le', '-ar', String(trimmed.rate), '-ac', '1', '-i', 'pipe:0', '-filter_complex', filter,
      '-map', '[out]', '-f', 'f32le', '-c:a', 'pcm_f32le', 'pipe:1',
      '-map', '[stt]', '-c:a', 'flac', '-sample_fmt', 's16', '-f', 'flac', '-y', scratch],
    pcmBytes(trimmed), signal);
  const flac = new Uint8Array(await Bun.file(scratch).arrayBuffer());
  const integrated = lastNumber(stderr, /I:\s+(-?[\d.]+|-inf) LUFS/g);
  const truePeak = lastNumber(stderr, /Peak:\s+(-?[\d.]+|-inf) dBFS/g);
  const f32 = new Float32Array(stdout.buffer, stdout.byteOffset, Math.floor(stdout.byteLength / 4));
  const gainDb = integrated === null || truePeak === null ? 0 : Math.min(TARGET_LUFS - integrated, MAX_TRUE_PEAK - truePeak);
  const g = 10 ** (gainDb / 20);
  const samples = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i++) samples[i] = Math.max(-32768, Math.min(32767, Math.round(f32[i]! * g * 32768)));
  return { audio: { rate: OUT_RATE, samples }, flac, tempo };
}

/** Decodes whatever container the TTS returned into mono PCM16. */
export async function decodeAudio(bytes: Uint8Array, mime: string, signal?: AbortSignal): Promise<Pcm> {
  const rate = /rate=(\d+)/i.exec(mime)?.[1];
  if (rate && /l16|pcm/i.test(mime)) {
    const copy = bytes.slice(0, bytes.length - (bytes.length % 2));
    return { rate: Number(rate), samples: new Int16Array(copy.buffer) };
  }
  const wav = parseWav(bytes);
  if (wav) return wav;
  const { stdout } = await ffmpeg(['-i', 'pipe:0', '-ac', '1', '-ar', '24000', '-f', 's16le', '-c:a', 'pcm_s16le', 'pipe:1'], bytes, signal);
  return { rate: 24_000, samples: new Int16Array(stdout.buffer, stdout.byteOffset, Math.floor(stdout.byteLength / 2)) };
}

/** True when ffmpeg is on PATH (a setup requirement). */
export const hasFfmpeg = () => Bun.which('ffmpeg') !== null;

function lastNumber(text: string, re: RegExp): number | null {
  let v: string | undefined;
  for (const m of text.matchAll(re)) v = m[1];
  return v === undefined || v === '-inf' ? null : Number(v);
}

/**
 * Runs ffmpeg with `input` on stdin; collects stdout and stderr. A process that dies early (it failed, or an
 * abort killed it) closes its stdin, so writing to it fails (ENOTCONN, EPIPE): that error is held, never left
 * to surface on its own, and the call fails as the abort it was or as the process's own failure.
 */
async function ffmpeg(args: string[], input: Uint8Array, signal?: AbortSignal): Promise<{ stdout: Uint8Array<ArrayBuffer>; stderr: string }> {
  const proc = Bun.spawn(['ffmpeg', '-hide_banner', '-nostats', '-v', 'info', ...args], {
    stdin: 'pipe', stdout: 'pipe', stderr: 'pipe', ...(signal && { signal }),
  });
  const reads = Promise.all([new Response(proc.stdout).arrayBuffer(), new Response(proc.stderr).text()]);
  const wrote = (async () => { await proc.stdin.write(input); await proc.stdin.end(); })().then(() => undefined, (e: unknown) => e);
  const [out, err] = await reads;
  const code = await proc.exited;
  const writeError = await wrote;
  signal?.throwIfAborted();
  if (code !== 0) throw new Error(`ffmpeg failed (${code}): ${err.split('\n').filter(Boolean).slice(-3).join(' | ')}`);
  if (writeError) throw writeError;
  return { stdout: new Uint8Array(out), stderr: err };
}
