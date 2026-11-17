// HTTP with retries and a concurrency cap (spec §5.10). Knows nothing about providers.

/** A non-retryable HTTP failure, or a retryable one after the last retry. */
export class HttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); this.name = 'HttpError'; }
}

/** Caps how many calls of one kind are in flight at once. */
export class Limiter {
  private active = 0;
  private readonly waiting: (() => void)[] = [];
  constructor(private readonly max: number) {}

  async run<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    while (this.active >= this.max) {
      await new Promise<void>((resolve, reject) => {
        const wake = () => { signal?.removeEventListener('abort', onAbort); resolve(); };
        const onAbort = () => { const i = this.waiting.indexOf(wake); if (i >= 0) this.waiting.splice(i, 1); reject(signal!.reason); };
        this.waiting.push(wake);
        signal?.addEventListener('abort', onAbort, { once: true });
      });
    }
    signal?.throwIfAborted();
    this.active++;
    try { return await fn(); } finally { this.active--; this.waiting.shift()?.(); }
  }
}

const BACKOFF_S = [1, 2, 4, 8, 16];
const TIMEOUT_MS = 60_000;

/**
 * One provider call: POST, wait for an ok response, and `read` its body, with a 60 s timeout
 * covering the whole exchange. 429/5xx, timeouts and network errors (also while reading the
 * body) are retried with backoff 1, 2, 4, 8, 16 s, or after the server's Retry-After however
 * long. The limiter slot is held until the body is read. `init` is called per try so request
 * bodies are fresh. An HttpError thrown by `read` is final. Aborting `signal` stops at once,
 * including during a wait.
 */
export async function fetchRetrying<T>(url: string, init: () => RequestInit, read: (res: Response) => Promise<T>,
  opts: { signal?: AbortSignal; limiter?: Limiter } = {}): Promise<T> {
  const { signal, limiter } = opts;
  type Outcome = { ok: true; value: T } | { ok: false; status: number; body: string; retryAfter: string | null };
  for (let attempt = 0; ; attempt++) {
    signal?.throwIfAborted();
    let wait: number;
    try {
      const call = async (): Promise<Outcome> => {
        const r = await fetch(url, { ...init(), signal: anySignal(signal, AbortSignal.timeout(TIMEOUT_MS)) });
        if (r.ok) return { ok: true, value: await read(r) };
        return { ok: false, status: r.status, body: await r.text().catch(() => ''), retryAfter: r.headers.get('retry-after') };
      };
      const out = limiter ? await limiter.run(call, signal) : await call();
      if (out.ok) return out.value;
      const failure = `HTTP ${out.status}: ${out.body.slice(0, 300)}`;
      if (out.status !== 429 && out.status < 500) throw new HttpError(out.status, failure);
      if (attempt >= BACKOFF_S.length) throw new HttpError(out.status, failure);
      wait = retryAfter(out.retryAfter) ?? BACKOFF_S[attempt]!;
    } catch (e) {
      if (e instanceof HttpError) throw e;
      if (signal?.aborted) throw signal.reason;
      if (attempt >= BACKOFF_S.length) throw new HttpError(0, e instanceof Error ? `${e.name}: ${e.message}` : String(e));
      wait = BACKOFF_S[attempt]!;
    }
    await sleep(wait * 1000, signal);
  }
}

/** Seconds the server asked us to wait (delta-seconds or an HTTP date), or null. Never clamped. */
function retryAfter(header: string | null): number | null {
  if (!header) return null;
  const secs = /^\d+(\.\d+)?$/.test(header.trim()) ? Number(header) : (Date.parse(header) - Date.now()) / 1000;
  return Number.isFinite(secs) ? Math.max(0, secs) : null;
}

function anySignal(a: AbortSignal | undefined, b: AbortSignal): AbortSignal {
  return a ? AbortSignal.any([a, b]) : b;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
    const onAbort = () => { clearTimeout(t); reject(signal!.reason); };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
