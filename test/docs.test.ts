/**
 * The docs agents copy from must work: every script snippet in skill/SKILL.md and skill/reference.md passes
 * `lectern check` with no finding, and the reference's block and verb tables list exactly what the CLI tells an
 * agent when it gets one wrong (E107's block types, E111's verbs, E108's args for each type).
 */
import { expect, test } from 'bun:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT, cacheHome, lectern, issues, limited, tmp } from './e2e.ts';

const docs = ['skill/SKILL.md', 'skill/reference.md'].map(f => [f, readFileSync(path.join(ROOT, f), 'utf8')] as const);
const ref = docs[1]![1];

/** Fenced blocks that hold a script (front matter) or blocks (`:::` lines, wrapped in a minimal script); not cue listings. */
function snippets(): { where: string; script: string }[] {
  const out: { where: string; script: string }[] = [];
  for (const [file, text] of docs)
    for (const m of text.matchAll(/^(`{3,})[^\n]*\n([\s\S]*?)\n\1$/gm)) {
      const body = m[2]!;
      const line = text.slice(0, m.index).split('\n').length;
      if (body.startsWith('---\n')) out.push({ where: `${file}:${line}`, script: body + '\n' });
      else if (/^::: /m.test(body)) out.push({ where: `${file}:${line}`, script: `---\ntitle: Snippet\n---\n##\n${body}\n` });
    }
  return out;
}

let n = 0;
async function check(text: string, xdg: string) {
  const dir = path.join(tmp('docs'), String(n++));
  mkdirSync(dir);
  writeFileSync(path.join(dir, 't.md'), text);
  return lectern(['check', 't.md', '--no-audio', '--out', 'out'], { xdg, cwd: dir });
}

test('every script snippet in the skill passes check with no finding', async () => {
  const found = snippets();
  expect(found.length).toBeGreaterThanOrEqual(2);   // the reference's Example and its orbit
  const xdg = await cacheHome();
  const runs = await limited(4, found.map(s => () => check(s.script, xdg)));
  runs.forEach((r, i) => {
    expect([found[i]!.where, issues(r.out).map(x => `${x.code} ${x.message}`)]).toEqual([found[i]!.where, []]);
    expect([found[i]!.where, r.code]).toEqual([found[i]!.where, 0]);
  });
}, 60_000);

/** The first backticked word of each row of the reference table whose header starts `| head |`. */
const rows = (head: string) => ref.split(`\n| ${head} |`)[1]!.split('\n\n')[0]!.split('\n').slice(2);
const sorted = (xs: Iterable<string>) => [...new Set(xs)].sort();

test('the reference lists exactly the block types and verbs the CLI names', async () => {
  const xdg = await cacheHome();
  const types = (await check('---\ntitle: T\n---\n##\n::: zzzz a\nx\n:::\nHi.', xdg)).out;
  const listed = /block types are: (.*)$/m.exec(issues(types)[0]!.fix)![1]!.split(', ');
  expect(sorted(rows('type').map(r => /^\| `([a-z]+)/.exec(r)![1]!))).toEqual(sorted(listed));
  const verbs = (await check('---\ntitle: T\n---\n##\n::: text a\nx\n:::\n[highlight a] Hi.', xdg)).out;
  const named = /verbs are: (.*)$/.exec(issues(verbs)[0]!.fix)![1]!.split(' ');
  expect(sorted(rows('verb').map(r => /^\| `([a-z]+)/.exec(r)![1]!))).toEqual(sorted(named));
}, 60_000);

test('the type column lists exactly the args the CLI accepts for each block', async () => {
  // From the table: `code` `lang=` `from=N` `diff` → code: lang, from, diff; `graph` `dir=LR\|TB\|cycle` → graph: LR, TB, cycle.
  const table = new Map<string, Set<string>>();
  for (const row of rows('type')) {
    const [type, ...args] = [...row.split(' | ')[0]!.matchAll(/`([^`]+)`/g)].flatMap(m => m[1]!.split(' '));
    const keys = table.get(type!) ?? new Set<string>();
    for (const a of args) for (const k of /^dir=/.test(a) ? a.slice(4).replace(/\\/g, '').split('|') : [a.split('=')[0]!]) keys.add(k);
    table.set(type!, keys);
  }
  const xdg = await cacheHome();
  const said = await limited(8, [...table.keys()].map(type => () => check(`---\ntitle: T\n---\n##\n::: ${type} a zz=1\nx\n:::\nHi.`, xdg)));
  [...table.entries()].forEach(([type, keys], i) => {
    const e108 = issues(said[i]!.out).find(x => x.code === 'E108')!;
    // "args for code: lang=…, from=N, diff, src=…, name=…", "args for graph: LR | TB | cycle", or "text takes no args".
    const m = /^args for [a-z]+: (.*)$/.exec(e108.fix);
    const cli = m ? m[1]!.split(/, | \| /).map(a => a.split('=')[0]!) : [];
    expect([type, sorted(cli)]).toEqual([type, sorted(keys)]);
  });
}, 60_000);
