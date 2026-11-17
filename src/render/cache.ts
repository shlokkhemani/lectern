/**
 * The render cache: segments and narrations from earlier builds, so a rebuild redoes only what changed.
 * An entry is a file named by a digest of everything that made it: the caller's parts (what the page drew,
 * the plan's timeline, the narration's samples) and this engine (the render modules' source and the ffmpeg
 * build). A hit hands back a copy of bytes produced from identical inputs.
 *
 * In `$XDG_CACHE_HOME/lectern/render` (else `~/.cache/lectern/render`). Entries are published by rename, so a
 * reader sees a whole file or none. The least recently used go once the cache passes `LIMIT_BYTES`. Caching
 * is best effort: a failed write or a pruned entry costs only a later miss.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { run } from './ffmpeg.ts';

/** A 4-minute video's segments and narration take ~7 MB: this keeps ~140 full builds. */
const LIMIT_BYTES = 1024 ** 3;

const dir = () => path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'lectern', 'render');

let engineDigest: Promise<string> | undefined;
/** What turns a page and a plan into bytes: this directory's modules and the ffmpeg build. Once per process. */
function engine(): Promise<string> {
  return engineDigest ??= (async () => {
    const h = new Bun.CryptoHasher('sha256');
    const files = (await Array.fromAsync(new Bun.Glob('*.ts').scan(import.meta.dir))).sort();
    for (const f of files) h.update(f).update(await Bun.file(path.join(import.meta.dir, f)).bytes());
    h.update(await run('ffmpeg', ['-version']));
    return h.digest('hex');
  })();
}

/** The cache key for `parts` (each given whole, in order) made by this engine. */
export async function cacheKey(...parts: (string | Uint8Array)[]): Promise<string> {
  const h = new Bun.CryptoHasher('sha256').update(await engine());
  for (const p of parts) h.update(String(p.length)).update(':').update(p);
  return h.digest('hex');
}

/**
 * Write the entry for `key` to `out` when the cache has it (true); else `make` writes `out`, and `out` is
 * then cached (false). `make` must leave in `out` only what it has checked.
 */
export async function reuse(key: string, out: string, make: () => Promise<void>): Promise<boolean> {
  const entry = path.join(dir(), key + path.extname(out));
  try {
    await fs.copyFile(entry, out, fs.constants.COPYFILE_FICLONE);
    const now = new Date();
    await fs.utimes(entry, now, now).catch(() => {});   // recently used
    return true;
  } catch {}
  await make();
  const tmp = `${entry}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.mkdir(dir(), { recursive: true });
    await fs.copyFile(out, tmp, fs.constants.COPYFILE_FICLONE);
    await fs.rename(tmp, entry);
    await prune();
  } catch {
    await fs.rm(tmp, { force: true }).catch(() => {});
  }
  return false;
}

let pruning: Promise<void> | undefined;
/** Remove the least recently used entries until the cache is within `LIMIT_BYTES`. One prune at a time. */
function prune(): Promise<void> {
  return pruning ??= (async () => {
    try {
      const names = (await fs.readdir(dir())).filter(n => !n.endsWith('.tmp'));
      const entries = (await Promise.all(names.map(async n => {
        const f = path.join(dir(), n);
        const s = await fs.stat(f).catch(() => undefined);
        return s && { f, size: s.size, used: s.mtimeMs };
      }))).filter(e => !!e).sort((a, b) => a.used - b.used);
      let total = entries.reduce((n, e) => n + e.size, 0);
      for (const e of entries) {
        if (total <= LIMIT_BYTES) break;
        await fs.rm(e.f, { force: true });
        total -= e.size;
      }
    } finally {
      pruning = undefined;
    }
  })();
}
