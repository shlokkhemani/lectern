/**
 * Opt-in, with the network: LECTERN_LIVE=1 bun test test/live.test.ts (keys from the engine's .env).
 * The agent's real loop on a fresh voice cache: `check` starts voicing in the background, `build` joins or reuses
 * those takes, every scene passes the transcript check, and a rebuild needs no voice at all.
 */
import { expect, test } from 'bun:test';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { CLI, cacheHome, record, tmp } from './e2e.ts';

const SCRIPT = `---
title: Live voice
---

## Calls
::: text t
\`add(2, 3)\`
:::
[hl t] So the bracket is registered as an infix, with \`parseCallExpression\` as its function.

Like every infix function, it receives the expression on its left.
`;

/** `lectern …` with the real keys and the background voicer allowed (bun test sets NODE_ENV=test, which stops it). */
async function live(args: string[], xdg: string) {
  const env: Record<string, string | undefined> = { ...process.env, XDG_CACHE_HOME: xdg };
  delete env.NODE_ENV;
  delete env.GEMINI_API_KEY;
  delete env.OPENROUTER_API_KEY;
  const p = Bun.spawn(['bun', CLI, ...args], { stdout: 'pipe', stderr: 'pipe', env });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { out, err, code };
}

test.skipIf(process.env.LECTERN_LIVE !== '1')('check voices ahead; build uses those takes; a rebuild is voiced from the cache', async () => {
  const dir = tmp('live');
  const file = path.join(dir, 'live.md');
  writeFileSync(file, SCRIPT);
  const xdg = await cacheHome();
  const check = await live(['check', file, '--out', path.join(dir, 'out')], xdg);
  expect(check.code).toBe(0);
  const build = await live(['build', file, '--out', path.join(dir, 'out')], xdg);
  expect(build.err).toBe('');
  expect(build.out).toContain('gates: G1 schema pass · G2 layout pass · G3 audio pass · timing pass');
  const b = record(path.join(dir, 'out', 'build.json'));
  expect(b.ok).toBe(true);
  expect(b.scenes.every(s => s.audioPass)).toBe(true);
  // Offline now (blank keys): the take is in the cache, so the rebuild still passes.
  const p = Bun.spawn(['bun', CLI, 'build', file, '--out', path.join(dir, 'again')], { stdout: 'pipe', stderr: 'pipe',
    env: { ...process.env, XDG_CACHE_HOME: xdg, GEMINI_API_KEY: '', OPENROUTER_API_KEY: '' } });
  expect(await p.exited).toBe(0);
}, 300_000);
