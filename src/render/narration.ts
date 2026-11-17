/**
 * Narration assembly (§6): per scene, a zero buffer of `totalSamples` with the plan's sample copies applied
 * from the scene's A-clock wav. No seconds here: sample indices from the plan, the rate from `finalMedia`.
 */
import type { ScenePlan } from '../timing/types.ts';
import { finalMedia } from '../timing/media.ts';
import { budget, run } from './ffmpeg.ts';
import { cacheKey, reuse } from './cache.ts';

/** Decode a mono PCM WAV (16-bit integer or 32-bit float) into float samples. */
export function readWav(bytes: Uint8Array): { rate: number; samples: Float32Array } {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (o: number) => String.fromCharCode(bytes[o]!, bytes[o + 1]!, bytes[o + 2]!, bytes[o + 3]!);
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('narration: not a WAV file');
  let fmt: { format: number; channels: number; rate: number; bits: number } | undefined;
  for (let o = 12; o + 8 <= bytes.length;) {
    const id = tag(o), size = v.getUint32(o + 4, true), body = o + 8;
    if (id === 'fmt ') fmt = { format: v.getUint16(body, true), channels: v.getUint16(body + 2, true), rate: v.getUint32(body + 4, true), bits: v.getUint16(body + 14, true) };
    if (id === 'data') {
      if (!fmt) throw new Error('narration: WAV data before fmt');
      if (fmt.channels !== 1) throw new Error(`narration: expected mono, got ${fmt.channels} channels`);
      const len = Math.min(size, bytes.length - body);
      const extensible = fmt.format === 0xfffe;
      if ((fmt.format === 3 || extensible) && fmt.bits === 32) {
        const out = new Float32Array(len / 4);
        for (let i = 0; i < out.length; i++) out[i] = v.getFloat32(body + i * 4, true);
        return { rate: fmt.rate, samples: out };
      }
      if ((fmt.format === 1 || extensible) && fmt.bits === 16) {
        const out = new Float32Array(len / 2);
        for (let i = 0; i < out.length; i++) out[i] = v.getInt16(body + i * 2, true) / 32768;
        return { rate: fmt.rate, samples: out };
      }
      throw new Error(`narration: unsupported WAV format ${fmt.format}/${fmt.bits}-bit`);
    }
    o = body + size + (size & 1);
  }
  throw new Error('narration: WAV has no data chunk');
}

/** One scene's narration: silence with the copies laid in, linear fades at each copy's ends. */
export function sceneNarration(plan: ScenePlan, source: Float32Array | undefined): Float32Array {
  const out = new Float32Array(plan.audio.totalSamples);
  for (const c of plan.audio.copies) {
    if (!source) throw new Error(`narration: scene ${plan.scene} has copies but no audio`);
    if (c.srcSample + c.length > source.length || c.dstSample + c.length > out.length)
      throw new Error(`narration: scene ${plan.scene} copy is out of bounds`);
    for (let i = 0; i < c.length; i++) {
      const fade = c.fadeSamples ? Math.min(1, (i + 0.5) / c.fadeSamples, (c.length - i - 0.5) / c.fadeSamples) : 1;
      out[c.dstSample + i] = source[c.srcSample + i]! * fade;
    }
  }
  return out;
}

/**
 * The AAC encoder: ffmpeg's native coder in its fast mode, 128 kb/s (1.7 s for 7 minutes of speech, against
 * 4.1 s for the default coder). Not AudioToolbox (`aac_at`, 0.96 s): it does not record the end trim, so the
 * narration plays up to 1023 samples longer than the plans and the final check (R702) rejects it.
 */
const AAC = ['-c:a', 'aac', '-aac_coder', 'fast', '-b:a', '128k'];

/**
 * The whole narration: scenes back to back, then AAC, into `<workDir>/narration.m4a`. The PCM holds exactly
 * the plans' samples (asserted; the muxed result is checked again by `verifyFinal`). Sources are read in
 * parallel; PCM goes to ffmpeg by pipe, unless the render cache holds its encode.
 */
export async function writeNarration(plans: ScenePlan[], wavs: string[], workDir: string): Promise<string> {
  const { rate, samples: expected } = finalMedia(plans).audio;
  const parts = await Promise.all(plans.map(async (plan, i) => {
    if (!plan.audio.copies.length) return sceneNarration(plan, undefined);
    const w = readWav(new Uint8Array(await Bun.file(wavs[i]!).arrayBuffer()));
    if (w.rate !== rate) throw new Error(`narration: scene ${plan.scene} audio is ${w.rate} Hz; the plan's grid is ${rate} Hz`);
    return sceneNarration(plan, w.samples);
  }));
  const total = parts.reduce((n, p) => n + p.length, 0);
  if (total !== expected) throw new Error(`narration: ${total} samples assembled, plans need ${expected}`);
  const pcm = new Int16Array(total);
  let o = 0;
  for (const p of parts) for (let i = 0; i < p.length; i++) pcm[o++] = Math.round(Math.max(-1, Math.min(1, p[i]!)) * 32767);
  const m4a = `${workDir}/narration.m4a`;
  const bytes = new Uint8Array(pcm.buffer);
  // The AAC is a function of the samples and the rate, so equal PCM reuses an earlier build's encode.
  await reuse(await cacheKey('narration', String(rate), bytes), m4a, () =>
    run('ffmpeg', ['-y', '-f', 's16le', '-ar', String(rate), '-ac', '1', '-i', 'pipe:0', ...AAC, '-movie_timescale', String(rate), m4a],
      // ~4 ms per second of audio measured; the budget allows 100.
      { stdin: bytes, deadlineMs: budget(total / rate, 100) }).then(() => {}));
  return m4a;
}
