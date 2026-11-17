// Text-to-speech. The only module that knows the Gemini TTS wire format.
// The request carries the narration text and nothing else (rulings §9: never style instructions).
//
// The streaming endpoint takes the same body and ends about a second sooner than the plain one
// (it saves seconds on the critical path). Its reply is server-sent events, each carrying a slice of the
// same raw PCM; processing needs the whole take, so the slices are only joined.

import { fetchRetrying, HttpError, Limiter } from './http.ts';
import { decodeAudio } from './process.ts';
import type { Pcm } from './pcm.ts';

/** At most 32 TTS calls in flight (spec §5.3). */
const limiter = new Limiter(32);

export const TTS_PROVIDER = 'gemini';

type StreamEvent = { candidates?: { finishReason?: string; content?: { parts?: { inlineData?: { mimeType?: string; data?: string } }[] } }[] };

/**
 * Speaks `text` with `model` and `voice`. Throws HttpError after retries, or when the
 * response carries no audio (`status` 0). A stream that ends without a finish reason was cut
 * off, and is retried like a dropped connection.
 */
export async function synthesize(text: string, model: string, voice: string, signal?: AbortSignal): Promise<Pcm> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new HttpError(401, 'GEMINI_API_KEY is not set (put it in .env)');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;
  const body = JSON.stringify({
    contents: [{ parts: [{ text }] }],
    generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } },
  });
  const audio = await fetchRetrying(url, () => ({ method: 'POST', headers: { 'X-goog-api-key': key, 'Content-Type': 'application/json' }, body }),
    async res => {
      const slices: Buffer[] = [];
      let mime = '', finish = '';
      for (const line of (await res.text()).split(/\r?\n/)) {
        if (!line.startsWith('data:')) continue;
        const candidate = (JSON.parse(line.slice(5)) as StreamEvent).candidates?.[0];
        finish = candidate?.finishReason ?? finish;
        for (const p of candidate?.content?.parts ?? []) {
          if (p.inlineData?.data) { slices.push(Buffer.from(p.inlineData.data, 'base64')); mime ||= p.inlineData.mimeType ?? ''; }
        }
      }
      if (!finish) throw new Error('TTS stream ended before its finish reason');
      if (!slices.length) throw new HttpError(0, `TTS returned no audio (finishReason ${finish})`);
      return { bytes: Buffer.concat(slices), mime };
    },
    { limiter, ...(signal && { signal }) });
  return decodeAudio(audio.bytes, audio.mime, signal);
}
