// Mono 16-bit PCM in memory, and the WAV container. Knows nothing about providers.

/** Mono signed 16-bit samples at `rate` Hz. */
export interface Pcm { rate: number; samples: Int16Array }

/** −45 dBFS as a 16-bit amplitude: the silence threshold (spec §5.4). */
export const SILENCE_AMP = 32768 * 10 ** (-45 / 20);

export const durationOf = (p: Pcm) => p.samples.length / p.rate;

/**
 * Seconds of silence at the end: time after the last 10 ms window (aligned to the end) whose RMS
 * exceeds −45 dBFS. RMS rather than single samples, so a stray noise sample does not count as sound.
 */
export function tailSilence(p: Pcm): number {
  const win = Math.max(1, Math.round(0.01 * p.rate)), x = p.samples;
  for (let end = x.length; end >= win; end -= win) {
    let e = 0;
    for (let i = end - win; i < end; i++) e += x[i]! * x[i]!;
    if (Math.sqrt(e / win) > SILENCE_AMP) return (x.length - end) / p.rate;
  }
  return x.length / p.rate;
}

/** Drops leading and trailing silence (≤ −45 dBFS), keeping `margin` seconds of it on each side. */
export function trimSilence(p: Pcm, margin = 0.01): Pcm {
  const x = p.samples;
  let a = 0, b = x.length - 1;
  while (a < x.length && Math.abs(x[a]!) <= SILENCE_AMP) a++;
  while (b > a && Math.abs(x[b]!) <= SILENCE_AMP) b--;
  if (a >= x.length) return { rate: p.rate, samples: new Int16Array(0) };
  const m = Math.round(margin * p.rate);
  return { rate: p.rate, samples: x.slice(Math.max(0, a - m), Math.min(x.length, b + 1 + m)) };
}

/** Parses a PCM16 mono WAV. Returns null for any other layout (callers decode those with ffmpeg). */
export function parseWav(bytes: Uint8Array): Pcm | null {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (o: number) => String.fromCharCode(bytes[o]!, bytes[o + 1]!, bytes[o + 2]!, bytes[o + 3]!);
  if (bytes.length < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null;
  let rate = 0, format = 0, channels = 0, bits = 0;
  for (let o = 12; o + 8 <= bytes.length;) {
    const id = tag(o), size = v.getUint32(o + 4, true);
    if (id === 'fmt ') { format = v.getUint16(o + 8, true); channels = v.getUint16(o + 10, true); rate = v.getUint32(o + 12, true); bits = v.getUint16(o + 22, true); }
    if (id === 'data') {
      if (format !== 1 || channels !== 1 || bits !== 16 || !rate) return null;
      const end = Math.min(bytes.length, o + 8 + size);   // streamed WAVs may carry a bogus size
      const n = Math.floor((end - o - 8) / 2);
      const samples = new Int16Array(n);
      for (let i = 0; i < n; i++) samples[i] = v.getInt16(o + 8 + 2 * i, true);
      return { rate, samples };
    }
    o += 8 + size + (size & 1);
  }
  return null;
}

/** Encodes as a PCM16 mono WAV. */
export function wavBytes(p: Pcm): Uint8Array<ArrayBuffer> {
  const n = p.samples.length * 2;
  const out = new Uint8Array(44 + n);
  const v = new DataView(out.buffer);
  const tag = (o: number, s: string) => { for (let i = 0; i < 4; i++) out[o + i] = s.charCodeAt(i); };
  tag(0, 'RIFF'); v.setUint32(4, 36 + n, true); tag(8, 'WAVE'); tag(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, p.rate, true);
  v.setUint32(28, p.rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); tag(36, 'data'); v.setUint32(40, n, true);
  for (let i = 0; i < p.samples.length; i++) v.setInt16(44 + 2 * i, p.samples[i]!, true);
  return out;
}

/** The raw little-endian bytes of the samples. */
export const pcmBytes = (p: Pcm) => new Uint8Array(p.samples.buffer, p.samples.byteOffset, p.samples.byteLength);
