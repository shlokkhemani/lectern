/**
 * The edit matrix: a stale cache hit silently ships a wrong video, so every input a rebuild can change is edited
 * here, and the rebuild on the cache the original build filled must be IDENTICAL (bench/fingerprint.ts) to a
 * build of the same edited script on an empty render and prepare cache. Voice comes from the fixtures throughout.
 * The script `scripts/edits/edits.md` shows code from `ast.go`, a picture from `shape.svg`, and re-places a block
 * in a later scene; `said.md` is the same script with another `say:` (its changed take is a fixture too). Each case also says which scenes the rebuild may take from the cache, so a rebuild that
 * re-rendered everything would not pass for a correct one.
 */
import { beforeAll, expect, test } from 'bun:test';
import { cpSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { cacheHome, lectern, fingerprint, limited, record, ROOT, SCRIPTS, sh, tmp, type Run } from './e2e.ts';

const EDITS = path.join(SCRIPTS, 'edits');

interface Edit {
  name: string;
  /** Changes the copy of `scripts/edits/` in `dir`; for the engine itself, returns a copy of its CLI. */
  apply(dir: string): string | void;
  /** Per scene of the edited script: taken from the cache (true), re-rendered (false), or either (null). */
  cached: (boolean | null)[];
}

const change = (file: string, from: string, to: string) => {
  const text = readFileSync(file, 'utf8');
  if (!text.includes(from)) throw new Error(`${path.basename(file)} has no "${from}"`);
  writeFileSync(file, text.replace(from, to));
};

const INSERTED = '## Inserted\n::: text ins\nan inserted scene\n:::\n[show ins] The arguments always come second.\n\n';

const EDIT_CASES: Edit[] = [
  {
    // The engine's theme: a copy of the engine with one token changed. The page head is in every key.
    name: 'a theme token', cached: [false, false, false, false],
    apply(dir) {
      const engine = path.join(dir, 'engine');
      for (const d of ['src', 'theme']) cpSync(path.join(ROOT, d), path.join(engine, d), { recursive: true });
      for (const f of ['package.json', 'tsconfig.json']) cpSync(path.join(ROOT, f), path.join(engine, f));
      symlinkSync(path.join(ROOT, 'node_modules'), path.join(engine, 'node_modules'));
      change(path.join(engine, 'theme', 'v2', 'tokens.css'), '--ink-2: #a1a1a1;', '--ink-2: #c4c4c4;');
      return path.join(engine, 'src', 'cli.ts');
    },
  },
  {
    // How a word is said changes scene 0's take (a fixture of its own), so its timing.
    name: 'the say: front matter', cached: [false, true, true, true],
    apply(dir) { cpSync(path.join(EDITS, 'said.md'), path.join(dir, 'edits.md')); },
  },
  {
    name: 'a code src= file on disk', cached: [false, null, true, true],
    apply(dir) { change(path.join(dir, 'ast.go'), '\tArguments []Expression', '\tArgs      []Expression'); },
  },
  {
    name: 'a custom src= SVG on disk', cached: [true, true, false, null],
    apply(dir) { change(path.join(dir, 'shape.svg'), '<rect data-id="args" x="370" y="60" width="140" height="140" fill="var(--surface-2)"', '<rect data-id="args" x="370" y="60" width="140" height="140" fill="var(--surface-3)"'); },
  },
  {
    // `pts` is declared in scene 0 and re-placed in scene 3: scene 3 carries the new body in.
    name: 'a body of a block a later scene reuses', cached: [false, null, true, false],
    apply(dir) { change(path.join(dir, 'edits.md'), 'then the arguments\n', 'then its arguments\n'); },
  },
  {
    // The inserted scene says what "Again" says, so it shares that take.
    name: 'a scene inserted', cached: [true, true, false, false, false],
    apply(dir) { change(path.join(dir, 'edits.md'), '## A picture\n', `${INSERTED}## A picture\n`); },
  },
  {
    // "Commas": the scenes after it move up one, and their keys change with their index.
    name: 'a scene deleted', cached: [true, false, false],
    apply(dir) {
      const file = path.join(dir, 'edits.md');
      const text = readFileSync(file, 'utf8');
      writeFileSync(file, text.slice(0, text.indexOf('## Commas')) + text.slice(text.indexOf('## A picture')));
    },
  },
];

interface Result { cached: Run; fresh: Run; cachedOut: string; freshOut: string; same: string }
const results = new Map<string, Result>();

beforeAll(async () => {
  // The original build fills a cache; each edit then gets its own copy of that cache and of the script's directory.
  // The builds without the cache need neither, so they start at once.
  const base = tmp('edits-base');
  cpSync(EDITS, base, { recursive: true });
  const warm = await cacheHome(true);
  const first = lectern(['build', path.join(base, 'edits.md'), '--out', path.join(base, 'out')], { xdg: warm }).then(r => {
    if (r.code) throw new Error(`the original build failed:\n${r.out}${r.err}`);
  });
  const fresh: (() => Promise<void>)[] = [];
  const cached: (() => Promise<void>)[] = [];
  for (const e of EDIT_CASES) {
    const dir = tmp('edit');
    cpSync(EDITS, dir, { recursive: true });
    const cli = e.apply(dir) ?? undefined;
    const script = path.join(dir, 'edits.md');
    const r = { cachedOut: path.join(dir, 'cached'), freshOut: path.join(dir, 'fresh') } as Result;
    results.set(e.name, r);
    fresh.push(async () => { r.fresh = await lectern(['build', script, '--jobs', '2', '--out', r.freshOut], { xdg: await cacheHome(true), cli }); });
    cached.push(async () => {
      await first;
      const xdg = tmp('xdg-warm');
      await sh(['cp', '-cR', `${warm}/`, xdg]);   // clones on APFS; the voice symlink stays a symlink
      r.cached = await lectern(['build', script, '--jobs', '2', '--out', r.cachedOut], { xdg, cli });
    });
  }
  await Promise.all([first, limited(6, [...fresh, ...cached])]);
  await Promise.all([...results.values()].map(async r => { r.same = await fingerprint(r.freshOut, r.cachedOut).catch(e => String(e)); }));
}, 180_000);

for (const e of EDIT_CASES) {
  test(`${e.name} changed: the cached rebuild is identical to a build without the cache`, async () => {
    const r = results.get(e.name)!;
    expect(r.cached.err + r.fresh.err).toBe('');
    expect([r.cached.code, r.fresh.code]).toEqual([0, 0]);
    expect(r.same).toMatch(/^IDENTICAL/);
    const cached = record(path.join(r.cachedOut, 'build.json')).scenes.map(s => s.cached);
    expect(cached.map((c, k) => (e.cached[k] === null ? null : c))).toEqual(e.cached);
    expect(record(path.join(r.freshOut, 'build.json')).scenes.every(s => s.cached === false)).toBe(true);
  }, 60_000);
}
