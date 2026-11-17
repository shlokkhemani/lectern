// Speech-to-text with word timestamps. The only module that knows the STT wire format
// (OpenRouter /audio/transcriptions, verbose_json, word granularity).

import type { HeardWord } from './diff.ts';
import { fetchRetrying, HttpError, Limiter } from './http.ts';

export type SttModel = 'scribe-v2' | 'nova-3';

const PROVIDER_MODEL: Record<SttModel, string> = { 'scribe-v2': 'elevenlabs/scribe-v2', 'nova-3': 'deepgram/nova-3' };
const URL = 'https://openrouter.ai/api/v1/audio/transcriptions';
/** At most 16 calls in flight per recogniser (spec §5.3). */
const limiters: Record<SttModel, Limiter> = { 'scribe-v2': new Limiter(16), 'nova-3': new Limiter(16) };

/** An upload: 16 kHz mono FLAC, with a WAV used only if the provider rejects the FLAC. */
export type Bytes = Uint8Array<ArrayBuffer>;
export interface SttAudio { flac: Bytes; wav: () => Promise<Bytes> }

/**
 * Transcribes `audio` with `model`. Words come back in order, times in seconds on the
 * audio's own clock, confidence when the provider gives one. Throws HttpError when retries
 * are exhausted or the request is rejected.
 */
export async function transcribe(audio: SttAudio, model: SttModel, signal?: AbortSignal): Promise<HeardWord[]> {
  try {
    return await request(audio.flac, 'flac', model, signal);
  } catch (e) {
    if (!(e instanceof HttpError) || e.status < 400 || e.status >= 500 || e.status === 429 || e.status === 401 || e.status === 402) throw e;
    return await request(await audio.wav(), 'wav', model, signal);
  }
}

async function request(bytes: Bytes, format: 'flac' | 'wav', model: SttModel, signal?: AbortSignal): Promise<HeardWord[]> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new HttpError(401, 'OPENROUTER_API_KEY is not set (put it in .env)');
  return fetchRetrying(URL, () => {
    const fd = new FormData();
    fd.append('model', PROVIDER_MODEL[model]);
    fd.append('file', new Blob([bytes], { type: `audio/${format}` }), `audio.${format}`);
    fd.append('response_format', 'verbose_json');
    fd.append('timestamp_granularities[]', 'word');
    return { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: fd };
  }, async res => parseWords(model, await res.json()), { limiter: limiters[model], ...(signal && { signal }) });
}

function parseWords(model: SttModel, body: unknown): HeardWord[] {
  const words = (body as { words?: unknown } | null)?.words;
  if (!Array.isArray(words)) throw new HttpError(502, `${model}: response has no word timestamps`);
  return words.flatMap((w: unknown): HeardWord[] => {
    const { word, start, end, confidence } = (w ?? {}) as { word?: unknown; start?: unknown; end?: unknown; confidence?: unknown };
    if (typeof word !== 'string' || typeof start !== 'number' || typeof end !== 'number') return [];
    const text = word.trim();
    if (!text || /^[([].*[)\]]$/.test(text)) return [];   // empty or an audio-event tag like "(laughs)"
    return [{ text, start, end, ...(typeof confidence === 'number' && { conf: confidence }) }];
  });
}
