// The voice cache (spec §5.9): verified, processed, unspliced audio plus the evidence it was
// verified on. Projection onto the script's words is never cached; it is re-run on every hit,
// so cue edits stay correct.
//
// An entry is immutable and published atomically. The WAV is content-addressed
// (`<sha256 of the bytes>.wav`, never rewritten once present); the entry `<key>.json` names it
// and is written last by rename. A reader therefore always sees audio and evidence of the same
// take, and a WAV path once returned never changes content, even if the key is republished.
//
// Production of a key, in any process, is announced by a `flock(2)` on `<key>.lock` (see `claim`).
// The kernel drops it when the producer exits or dies, so a waiter can never wedge.

import { createHash } from 'node:crypto';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EWOULDBLOCK, tryLock } from '../render/custody.ts';
import type { Evidence } from './verify.ts';

/** Bump when processing, tokenising or verification changes what a cached take means. */
export const PIPELINE_V = 2;

export interface CachedTake { wav: string; evidence: Evidence }

export interface CacheKeyParts { provider: string; model: string; voice: string; text: string }

/** `$XDG_CACHE_HOME/lectern/voice`, else `~/.cache/lectern/voice`. */
export function voiceCacheDir(): string {
  return path.join(process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'), 'lectern', 'voice');
}

export function cacheKey(p: CacheKeyParts): string {
  return createHash('sha256').update(JSON.stringify({ ...p, PIPELINE_V })).digest('hex');
}

interface Entry { wav: string; evidence: Evidence }

export async function readTake(key: string): Promise<CachedTake | null> {
  const dir = voiceCacheDir();
  try {
    const entry = JSON.parse(await fs.readFile(path.join(dir, `${key}.json`), 'utf8')) as Entry;
    const wav = path.join(dir, path.basename(entry.wav));
    await fs.access(wav);
    return { wav, evidence: entry.evidence };
  } catch {
    return null;
  }
}

/** Publishes a verified take under `key` and returns its immutable WAV path. */
export async function writeTake(key: string, wav: Uint8Array, evidence: Evidence): Promise<string> {
  const dir = voiceCacheDir();
  await fs.mkdir(dir, { recursive: true });
  const name = `${createHash('sha256').update(wav).digest('hex')}.wav`;
  const wavPath = path.join(dir, name);
  const tmp = () => path.join(dir, `.tmp-${process.pid}-${crypto.randomUUID()}`);
  if (!(await fs.access(wavPath).then(() => true, () => false))) {
    const t = tmp();
    await fs.writeFile(t, wav);
    await fs.rename(t, wavPath);   // same bytes under the same name, so a racing writer is harmless
  }
  const t = tmp();
  await fs.writeFile(t, JSON.stringify({ wav: name, evidence } satisfies Entry));
  await fs.rename(t, path.join(dir, `${key}.json`));
  return wavPath;
}

/** This process may produce the key; `release` (idempotent) announces it is done, published or not. */
export interface Claim { release: () => void }

const POLL_MS = 100;
const lockPath = (key: string) => path.join(voiceCacheDir(), `${key}.lock`);

/**
 * Waits while another producer holds `key`, then returns its entry if it has one, else a claim on the key.
 * An entry that exists already is returned at once, whoever holds the key. Rejects with `signal`'s reason.
 */
export async function claim(key: string, signal: AbortSignal): Promise<CachedTake | Claim> {
  await fs.mkdir(voiceCacheDir(), { recursive: true });
  const fd = fsSync.openSync(lockPath(key), fsSync.constants.O_RDWR | fsSync.constants.O_CREAT, 0o644);
  let held = false;
  try {
    for (;;) {
      signal.throwIfAborted();
      const errno = tryLock(fd);
      if (errno !== 0 && errno !== EWOULDBLOCK) throw new Error(`voice cache: flock on ${lockPath(key)} failed (errno ${errno})`);
      // Checked after taking the lock too: the last producer may have published just before releasing it.
      const take = await readTake(key);
      if (take) return take;
      if (errno === 0) {
        held = true;
        return { release: () => { if (held) { held = false; fsSync.closeSync(fd); } } };
      }
      await Bun.sleep(POLL_MS);
    }
  } finally {
    if (!held) fsSync.closeSync(fd);
  }
}

/** True while some process (this one included) holds a claim on `key`. */
export function producing(key: string): boolean {
  let fd: number;
  try { fd = fsSync.openSync(lockPath(key), fsSync.constants.O_RDWR); } catch { return false; }
  try { return tryLock(fd) === EWOULDBLOCK; } finally { fsSync.closeSync(fd); }
}
