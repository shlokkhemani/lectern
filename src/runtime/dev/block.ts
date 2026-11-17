#!/usr/bin/env bun
/**
 * Block dev harness: `bun run dev:block <fixture.md> [--out dir] [--scenes 0,2] [--small]`.
 * Renders every scene of a fixture at each cue instant's settled state (plus the initial state) to PNG,
 * at 1920×1080, and each scene's final state at 40% scale (768×432). Prints lint issues per scene, and
 * writes the page as `page.html` so other lanes can load the real page (a stub for the renderer).
 *
 * Uses L1's `parse` when `src/script/index.ts` exists, else a stand-in parser for fixtures.
 */
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import puppeteer from 'puppeteer-core';
import type { Script } from '../../ir.ts';
import type { LintIssue } from '../../render/types.ts';
import { pageHtml } from '../html.ts';
import { sceneCues } from '../settle.ts';
import { parse } from '../../script/index.ts';

/** Chrome for dev work: $LECTERN_CHROME, else a cached headless shell, else the system Chrome. */
function chromePath(): string {
  if (process.env.LECTERN_CHROME) return process.env.LECTERN_CHROME;
  const home = process.env.HOME ?? '';
  const cands = [
    `${home}/Library/Caches/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell`,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ];
  for (const c of cands) if (existsSync(c)) return c;
  const glob = new Bun.Glob('*/chrome-headless-shell*/chrome-headless-shell');
  for (const root of [`${home}/Library/Caches/ms-playwright`, `${home}/.cache/lectern/chrome`]) {
    if (!existsSync(root)) continue;
    for (const f of glob.scanSync({ cwd: root })) return join(root, f);
  }
  throw new Error('no Chrome found: set LECTERN_CHROME');
}

const CHROME_ARGS = ['--force-color-profile=srgb', '--font-render-hinting=none', '--disable-lcd-text', '--hide-scrollbars', '--disable-gpu'];

/** Parse a script with L1's parser, reading `src=` files relative to it; diagnostics go to stderr. */
export async function parseScript(file: string): Promise<Script> {
  const text = readFileSync(file, 'utf8');
  const read = (p: string) => { const f = resolve(dirname(file), p); return existsSync(f) ? readFileSync(f, 'utf8') : null; };
  const { ir, errors } = parse(text, file, read);
  for (const e of errors) console.error(`${file}:${e.line}:${e.col}: ${e.severity} ${e.code}: ${e.message}\n  fix: ${e.fix}`);
  if (!ir) throw new Error(`${file} does not parse`);
  return ir;
}

async function main(argv: string[]): Promise<number> {
  const file = argv.find(a => !a.startsWith('--'));
  if (!file) { console.error('usage: bun run dev:block <fixture.md> [--out dir] [--scenes 0,2]'); return 2; }
  const flag = (n: string) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  const out = resolve(flag('--out') ?? join('out', 'dev', basename(file, '.md')));
  await rm(out, { recursive: true, force: true });   // no stale frames from an earlier version of the fixture
  await mkdir(out, { recursive: true });
  const ir = await parseScript(file);
  const html = await pageHtml(ir);
  await writeFile(join(out, 'page.html'), html);
  const only = flag('--scenes')?.split(',').map(Number);

  const browser = await puppeteer.launch({ executablePath: chromePath(), headless: true, args: CHROME_ARGS });
  try {
    const page = await browser.newPage();
    page.on('console', m => { if (m.type() === 'error') console.error(`page: ${m.text()}`); });
    page.on('pageerror', e => console.error(`page error: ${e}`));
    await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1.5 });
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate(() => window.lectern.ready);
    const shots: string[] = [];
    const finals: [number, number][] = [];
    let errors = 0;
    for (const scene of ir.scenes) {
      const k = scene.index;
      if (only && !only.includes(k)) continue;
      const { instants, cues } = sceneCues(scene);
      const ns = [0, ...instants.map(x => x.to)];
      for (const n of ns) {
        await page.evaluate((k, n) => window.lectern.settle(k, n), k, n);
        const path = join(out, `s${k}-c${String(n).padStart(2, '0')}.png`);
        await page.screenshot({ path: path as `${string}.png`, clip: { x: 0, y: 0, width: 1280, height: 720 } });
        shots.push(path);
      }
      finals.push([k, cues.length]);
      const issues = await page.evaluate(k => window.lectern.lint(k), k) as LintIssue[];
      for (const i of issues) {
        if (i.severity === 'error') errors++;
        console.log(`${file}:${i.loc.line} S${k}·B${i.beat}${i.block ? ` "${i.block}"` : ''}: ${i.severity} ${i.code}: ${i.message}\n  fix: ${i.fix}`);
      }
    }
    await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 0.6 });
    for (const [k, n] of finals) {
      await page.evaluate((k, n) => window.lectern.settle(k, n), k, n);
      const path = join(out, `s${k}-final-40pct.png`);
      await page.screenshot({ path: path as `${string}.png`, clip: { x: 0, y: 0, width: 1280, height: 720 } });
      shots.push(path);
    }
    console.log(`${shots.length} images in ${out}${errors ? `; ${errors} lint errors` : '; lint clean'}`);
    return errors ? 1 : 0;
  } finally {
    await browser.close();
  }
}

if (import.meta.main) process.exit(await main(Bun.argv.slice(2)));
