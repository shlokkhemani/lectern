/**
 * Every block module by catalogue type (§3.4). The parser resolves `::: type` here; the page mounts
 * through it; the build prepares bodies through it.
 */
import type { BlockDecl, Inline, Script } from '../ir.ts';
import type { BlockModule } from './contract.ts';
import { text } from './core/text.ts';
import { code } from './core/code.ts';
import { title } from './core/title.ts';
import { callout } from './core/callout.ts';
import { bullets } from './core/bullets.ts';
import { table } from './core/table.ts';
import { compare } from './core/compare.ts';
import { tree } from './core/tree.ts';
import { stack } from './cs/stack.ts';
import { tokens } from './cs/tokens.ts';
import { terminal } from './cs/terminal.ts';
import { trace } from './cs/trace.ts';
import { sequence } from './cs/sequence.ts';
import { checklist } from './core/checklist.ts';
import { math } from './core/math.ts';
import { custom } from './core/custom.ts';
import { graph } from './core/graph.ts';
import { chart } from './core/chart.ts';

const MODULES: BlockModule<any>[] = [title, text, callout, bullets, table, compare, code, tree, stack, tokens, terminal, trace, checklist, math, custom, graph, chart, sequence];

export const BLOCKS: Readonly<Record<string, BlockModule<unknown>>> = Object.fromEntries(MODULES.map(m => [m.type, m]));

/**
 * A copy of `ir` with every block body passed through its module's async `prepare` (shiki, KaTeX).
 * `prepare` is pure, so its results are kept on disk and reused by every later command (shiki's first
 * highlight in a process costs ~1.25 s; a hit is a file read). The page gets the body as JSON either way, so a
 * hit and a miss embed the same bytes.
 */
export async function prepareBlocks(ir: Script): Promise<Script> {
  const sets = setValues(ir);
  const blocks = Object.fromEntries(await Promise.all(Object.entries(ir.blocks).map(async ([id, d]) => {
    const mod = BLOCKS[d.type];
    return [id, mod?.prepare ? { ...d, body: await cached(mod.prepare, d, sets.get(id) ?? []) } : d] as const;
  })));
  return { ...ir, blocks };
}

/*
 * The cache runs in Bun only; this module is also bundled into the page, so it uses Bun's globals and a
 * dynamic import rather than static node imports (and the page's bundle, minified names included, is unchanged).
 */

/**
 * `prepare(d.body, d.args, sets)`, from `$XDG_CACHE_HOME/lectern/prepare` (else `~/.cache/lectern/prepare`)
 * when this engine prepared the same type, body, args and set values before. A failed write costs only a later miss.
 */
async function cached(prepare: NonNullable<BlockModule<unknown>['prepare']>, d: BlockDecl, sets: Inline[]): Promise<unknown> {
  const dir = `${process.env.XDG_CACHE_HOME || `${process.env.HOME}/.cache`}/lectern/prepare`;
  const key = new Bun.CryptoHasher('sha256').update(JSON.stringify([await engine(), d.type, d.body, d.args, sets])).digest('hex');
  const file = `${dir}/${key}.json`;
  const hit: unknown = await Bun.file(file).json().catch(() => undefined);
  if (hit !== undefined) return hit;
  const body = await prepare(d.body, d.args, sets);
  const { mkdir, rename, rm } = await import('node:fs/promises');
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;   // whole or not at all
  await mkdir(dir, { recursive: true }).then(() => Bun.write(tmp, JSON.stringify(body))).then(() => rename(tmp, file))
    .catch(() => rm(tmp, { force: true }).catch(() => {}));
  return body;
}

let engineHash: Promise<string> | undefined;
/** What `prepare` runs: the block modules' source, and shiki's and KaTeX's package manifests. Once per process. */
function engine(): Promise<string> {
  return engineHash ??= (async () => {
    const h = new Bun.CryptoHasher('sha256');
    const files = (await Array.fromAsync(new Bun.Glob('**/*.ts').scan(import.meta.dir))).sort();
    for (const f of files) h.update(f).update(await Bun.file(`${import.meta.dir}/${f}`).bytes());
    for (const pkg of ['shiki', 'katex']) h.update(await Bun.file(Bun.resolveSync(`${pkg}/package.json`, import.meta.dir)).bytes());
    return h.digest('hex');
  })();
}

/** Per block: every value a `set` cue writes to it or its items, in source order, without duplicates. */
function setValues(ir: Script): Map<string, Inline[]> {
  const out = new Map<string, Map<string, Inline>>();
  for (const scene of ir.scenes)
    for (const beat of scene.beats)
      for (const cue of [...beat.startCues, ...beat.words.flatMap(w => w.cues)]) {
        if (cue.verb !== 'set') continue;
        for (const t of cue.targets) {
          const m = out.get(t.block) ?? new Map<string, Inline>();
          m.set(JSON.stringify(cue.value), cue.value);
          out.set(t.block, m);
        }
      }
  return new Map([...out].map(([id, m]) => [id, [...m.values()]]));
}
