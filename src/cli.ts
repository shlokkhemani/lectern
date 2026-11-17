#!/usr/bin/env bun
/**
 * `lectern check | shots | build <script.md> [flags]` (§8).
 * Exit: 0 ok · 1 gate failed · 2 usage or internal error.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { build, check, shots, voice, type Options, type Outcome } from './build.ts';

/**
 * Bun loads `.env` only from the working directory, but scripts live anywhere. Fill any key still unset from
 * the engine's own `.env`, so `lectern` works from every directory. Values are never printed.
 */
function loadEngineEnv(): void {
  const file = join(import.meta.dir, '..', '.env');
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || process.env[m[1]!] !== undefined) continue;
    process.env[m[1]!] = m[2]!.replace(/^(['"])(.*)\1$/, '$2');
  }
}

const USAGE = `usage:
  lectern check  <script.md> [--out <dir>]   schema + layout gates, estimate timing
  lectern shots  <script.md> [--scenes 3-5] [--out <dir>]
                                             check + contact sheets
    (both start voicing for the build; --no-audio starts nothing)
  lectern build  <script.md> [flags]
    --out <dir>    default ./out/<slug>/ (check and shots too)
    --scenes 3-5   subset (outputs suffixed .s3-5)
    --force        MP4 despite failing gates
    --no-video     audio + srt + html + sheets
    --no-audio     estimate timing, silent video
    --revoice 4,7  bypass voice cache for these scenes
    --jobs N  --keep  --json`;

class UsageError extends Error {}

/** `voice` is not in USAGE: it is the voicer `check` and `shots` start, not a command for the agent. */
const COMMANDS = { check, shots, build, voice } as const;
type Command = keyof typeof COMMANDS;

/** `3-5,8` → [3, 4, 5, 8]. */
function indexList(flag: string, v: string | undefined): number[] {
  if (!v || !/^\d+(-\d+)?(,\d+(-\d+)?)*$/.test(v)) throw new UsageError(`${flag} needs a list like 3-5,8`);
  return v.split(',').flatMap(part => {
    const [a, b = a] = part.split('-').map(Number) as [number, number?];
    if (b < a) throw new UsageError(`${flag}: range ${part} runs backwards`);
    return Array.from({ length: b - a + 1 }, (_, i) => a + i);
  });
}

function parseArgs(argv: string[]): { command: Command; opts: Options; json: boolean } {
  const [command, ...rest] = argv;
  if (!command || !(command in COMMANDS)) throw new UsageError(command ? `unknown command "${command}"` : 'no command');
  const opts: Partial<Options> = {};
  let json = false;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    const value = () => rest[++i];
    switch (a) {
      case '--out': opts.out = value() ?? (() => { throw new UsageError('--out needs a directory'); })(); break;
      case '--scenes': opts.scenes = indexList(a, value()); break;
      case '--revoice': opts.revoice = indexList(a, value()); break;
      case '--jobs': {
        const n = Number(value());
        if (!Number.isInteger(n) || n < 1) throw new UsageError('--jobs needs a positive integer');
        opts.jobs = n; break;
      }
      case '--force': opts.force = true; break;
      case '--no-video': opts.noVideo = true; break;
      case '--no-audio': opts.noAudio = true; break;
      case '--keep': opts.keep = true; break;
      case '--json': json = true; break;
      default:
        if (a.startsWith('-')) throw new UsageError(`unknown flag ${a}`);
        if (opts.file) throw new UsageError(`one script only; got ${opts.file} and ${a}`);
        opts.file = a;
    }
  }
  if (!opts.file) throw new UsageError('no script given');
  if (command !== 'build' && (opts.force || opts.noVideo || opts.revoice || opts.keep))
    throw new UsageError(`${command} takes only --out, --scenes, --jobs, --no-audio and --json`);
  return { command: command as Command, opts: opts as Options, json };
}

/** One issue as printed: where in the script, and what to do. */
interface Printed { line: number; col?: number; label?: string; block?: string; severity: string; code: string; message: string; fix: string }

/**
 * Compiler style, one issue per line plus its fix (§1.7): `script.md:LINE S3·B2 "block": severity CODE: message`.
 * Every issue points at the script line to edit; issues found in a scene carry its contact-sheet label.
 */
function report(o: Outcome, file: string): string {
  const issues: Printed[] = [
    ...o.diagnostics.map(d => ({ ...d })),
    ...o.timing.map(({ scene, error: e }) => ({ ...e, line: e.loc.line, col: e.loc.col, label: `S${scene}`, severity: 'error' })),
    ...o.lint.map(l => ({ ...l, line: l.loc.line, label: `S${l.scene}·B${l.beat}` })),
    ...o.audio.flatMap(({ scene, issues }) => issues.map(i => ({ ...i, line: i.loc?.line ?? 0, label: i.beat === undefined ? `S${scene}` : `S${scene}·B${i.beat}` }))),
  ];
  const lines: string[] = [];
  for (const i of issues)
    lines.push(`${file}:${i.line}${i.col ? `:${i.col}` : ''}${i.label ? ` ${i.label}` : ''}${i.block ? ` "${i.block}"` : ''}: ${i.severity} ${i.code}: ${i.message}`, `  fix: ${i.fix}`);
  if (o.length) {
    const clock = (s: number) => { const t = Math.round(s); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
    for (const s of o.length.scenes) lines.push(`S${s.scene}  ${clock(s.seconds)}  ${s.words} words`);
    lines.push(`total  ${clock(o.length.seconds)}  ${o.length.words} words (estimated)`);
  }
  const g = o.gates;
  const mark = (pass: boolean) => (pass ? 'pass' : 'FAIL');
  lines.push(`gates: G1 schema ${mark(g.G1)} · G2 layout ${mark(g.G2)} · G3 audio ${mark(g.G3)} · timing ${mark(g.timing)}${o.forced ? ' · forced' : ''}`);
  if (o.stages.total !== undefined) lines.push(`time: ${Object.entries(o.stages).map(([k, ms]) => `${k} ${(ms / 1000).toFixed(1)}s`).join(' · ')}`);
  for (const [name, path] of Object.entries(o.outputs)) lines.push(`${name}: ${path}`);
  if (o.sheets.length) lines.push('contact sheets (Read every sheet before finishing):', ...o.sheets.map(s => `  ${s}`));
  return lines.join('\n');
}

async function main(argv: string[]): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    console.error(`lectern: ${e.message}\n\n${USAGE}`);
    return 2;
  }
  const { command, opts, json } = parsed;
  try {
    const outcome = await COMMANDS[command](opts);
    console.log(json ? JSON.stringify(outcome, null, 2) : report(outcome, opts.file));
    return outcome.ok ? 0 : 1;
  } catch (e) {
    console.error(`lectern: ${e instanceof Error ? e.message : String(e)}`);
    return 2;
  }
}

if (import.meta.main) {
  loadEngineEnv();
  process.exit(await main(Bun.argv.slice(2)));
}
