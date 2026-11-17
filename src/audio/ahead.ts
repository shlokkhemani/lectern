// Voice ahead: `check` and `shots` start voicing in a detached process, so the build that follows
// finds its takes cached, or joins the ones still in production (`claim` in cache.ts), instead of
// paying for them itself.
//
// The voicer is the hidden `lectern voice` command. It takes no custody of the output directory
// (a build there would fail R700) and keeps its scratch under the voice cache.

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Script } from '../ir.ts';
import { voiceCacheDir } from './cache.ts';
import type { VoicedScene } from './types.ts';
import { unvoiced, voiceScene } from './voice.ts';

const CLI = path.join(import.meta.dir, '..', 'cli.ts');

/**
 * Starts the voicer for `scenes` of the script at `file`; returns at once. Under `bun test` (NODE_ENV=test,
 * inherited by the CLI it spawns) it starts nothing: tests never pay for TTS.
 */
function startVoicer(file: string, scenes: number[]): void {
  if (process.env.NODE_ENV === 'test') return;
  const child = spawn(process.execPath, [CLI, 'voice', path.resolve(file), '--scenes', scenes.join(',')], { detached: true, stdio: 'ignore' });
  child.on('error', () => {});   // a voicer that cannot start costs the build its head start, nothing else
  child.unref();
}

/**
 * Starts voicing the scenes among `ks` whose take is neither cached nor in production by any process,
 * in a detached process that outlives this one. Starts nothing when there are none.
 */
export async function voiceAhead(file: string, ir: Script, ks: readonly number[]): Promise<void> {
  const todo = await unvoiced(ir, ks);
  if (todo.length) startVoicer(file, todo);
}

/** The voicer's work: voices `ks` into the cache, its scratch under the voice cache and removed after. */
export async function voiceIntoCache(ir: Script, ks: readonly number[]): Promise<VoicedScene[]> {
  const workDir = path.join(voiceCacheDir(), '.work', `voicer-${process.pid}-${randomBytes(4).toString('hex')}`);
  try {
    const results = await Promise.allSettled(ks.map(k => voiceScene(ir.scenes[k]!, ir, { workDir })));
    const failed = results.find(r => r.status === 'rejected');
    if (failed) throw failed.reason;
    return results.map(r => (r as PromiseFulfilledResult<VoicedScene>).value);
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
}
