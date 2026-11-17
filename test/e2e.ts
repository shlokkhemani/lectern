/**
 * Helpers for the e2e suite. Every test drives the CLI as an agent does (`lectern check | shots | build`, spawned)
 * and looks only at what an agent or viewer sees: the exit status, the printed report, build.json, the MP4, the
 * .srt, the step-through HTML and the contact sheets. Nothing here imports the engine.
 *
 * Offline by construction: every run gets a blank GEMINI_API_KEY and OPENROUTER_API_KEY (the CLI fills only unset
 * keys from .env), so a voice-cache miss fails loudly instead of calling the network. Voiced builds read real takes
 * from `test/fixtures/voice/` (see `bench/voice-fixtures.ts`), decoded into a temporary $XDG_CACHE_HOME.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import puppeteer, { type Browser, type Page } from 'puppeteer-core';

export const ROOT = path.resolve(import.meta.dir, '..');
export const CLI = path.join(ROOT, 'src', 'cli.ts');
export const PART8 = path.join(ROOT, 'examples', 'part8.md');
export const SCRIPTS = path.join(import.meta.dir, 'scripts');
const VOICE_FIXTURES = path.join(import.meta.dir, 'fixtures', 'voice');

const made: string[] = [];
process.on('exit', () => { for (const d of made) rmSync(d, { recursive: true, force: true }); });

/** A fresh temporary directory, removed when the test process exits. */
export function tmp(name: string): string {
  const d = mkdtempSync(path.join(os.tmpdir(), `lectern-e2e-${name}-`));
  made.push(d);
  return d;
}

let voiceDir: string | undefined;
/** The fixture takes decoded once per process into a voice cache directory: `<key>.json` verbatim, WAV beside it. */
async function decodedVoice(): Promise<string> {
  if (voiceDir) return voiceDir;
  const dir = path.join(tmp('voice'), 'voice');
  mkdirSync(dir, { recursive: true });
  const samples = JSON.parse(readFileSync(path.join(VOICE_FIXTURES, 'index.json'), 'utf8')) as Record<string, number>;
  await Promise.all(Object.entries(samples).map(async ([key, n]) => {
    const entry = readFileSync(path.join(VOICE_FIXTURES, `${key}.json`), 'utf8');
    const p = Bun.spawn(['ffmpeg', '-v', 'error', '-i', path.join(VOICE_FIXTURES, `${key}.opus`), '-f', 's16le', '-ac', '1', '-ar', '48000', '-'], { stdout: 'pipe' });
    const decoded = new Uint8Array(await new Response(p.stdout).arrayBuffer());
    if (await p.exited) throw new Error(`ffmpeg could not decode ${key}.opus`);
    const wav = new Uint8Array(44 + n * 2);   // PCM16 mono 48 kHz, exactly the cached take's length
    wav.set(decoded.subarray(0, n * 2), 44);
    const v = new DataView(wav.buffer);
    const tag = (o: number, s: string) => { for (let i = 0; i < 4; i++) wav[o + i] = s.charCodeAt(i); };
    tag(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); tag(8, 'WAVE'); tag(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, 48000, true);
    v.setUint32(28, 96000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); tag(36, 'data'); v.setUint32(40, n * 2, true);
    await Bun.write(path.join(dir, (JSON.parse(entry) as { wav: string }).wav), wav);
    await Bun.write(path.join(dir, `${key}.json`), entry);
  }));
  return (voiceDir = dir);
}

/** A fresh $XDG_CACHE_HOME: empty render and prepare caches; with `voice`, the fixture takes in its voice cache. */
export async function cacheHome(voice = false): Promise<string> {
  const home = tmp('xdg');
  if (voice) {
    mkdirSync(path.join(home, 'lectern'));
    symlinkSync(await decodedVoice(), path.join(home, 'lectern', 'voice'));
  }
  return home;
}

export interface Run { code: number; out: string; err: string }

/** `lectern …` as an agent runs it, offline. `xdg` is required so no test touches the real caches; `cli` runs a copy of the engine. */
export async function lectern(args: string[], o: { xdg: string; cwd?: string; env?: Record<string, string>; cli?: string }): Promise<Run> {
  const p = Bun.spawn(['bun', o.cli ?? CLI, ...args], {
    cwd: o.cwd ?? ROOT, stdout: 'pipe', stderr: 'pipe',
    env: { ...process.env, GEMINI_API_KEY: '', OPENROUTER_API_KEY: '', XDG_CACHE_HOME: o.xdg, ...o.env },
  });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  return { code, out, err };
}

/** Runs `jobs` with at most `n` in flight; results in order. */
export async function limited<T>(n: number, jobs: (() => Promise<T>)[]): Promise<T[]> {
  const out: T[] = [];
  let next = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (next < jobs.length) { const i = next++; out[i] = await jobs[i]!(); }
  }));
  return out;
}

/** The issue lines of a report: `file:LINE[:COL] [S·B] ["block"]: severity CODE: message`, each with its fix. */
export function issues(report: string): { where: string; severity: string; code: string; message: string; fix: string }[] {
  const lines = report.split('\n');
  const found = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^(.+?): (error|warning) ([A-Z]\d{3}): (.*)$/.exec(lines[i]!);
    if (m) found.push({ where: m[1]!, severity: m[2]!, code: m[3]!, message: m[4]!, fix: lines[i + 1]!.replace(/^  fix: /, '') });
  }
  return found;
}

export interface BuildRecord {
  ok: boolean; forced: boolean; gates: Record<string, boolean>; error?: string;
  frames: { total: number; unique: number };
  scenes: { scene: number; frames?: number; cached?: boolean; attempts?: number; audioPass?: boolean }[];
  outputs: Record<string, string>; sheets: string[];
  issues: { schema: unknown[]; layout: { code: string; block?: string; loc: { line: number } }[]; timing: unknown[]; audio: unknown[] };
}
export const record = (file: string): BuildRecord => JSON.parse(readFileSync(file, 'utf8'));

/** Start of each scene on the video clock, in seconds, from build.json's frame counts (30 fps), plus the end. */
export const sceneStarts = (b: BuildRecord): number[] =>
  b.scenes.reduce<number[]>((t, s) => [...t, t.at(-1)! + s.frames! / 30], [0]);

export async function sh(args: string[]): Promise<string> {
  const p = Bun.spawn(args, { stdout: 'pipe', stderr: 'pipe' });
  const [o, e, c] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  if (c) throw new Error(`${args.join(' ')}: ${e}`);
  return o;
}

/** ffprobe's view of a media file. */
export async function probe(file: string): Promise<{ format: { duration: string; format_name: string }; streams: Record<string, string | number>[] }> {
  return JSON.parse(await sh(['ffprobe', '-v', 'error', '-show_format', '-show_streams', '-of', 'json', file]));
}

/** An RGB picture, `w` × `h`. */
export interface Picture { w: number; h: number; px: Uint8Array }

const raw = async (args: string[], w: number, h: number, filter = ''): Promise<Picture> => {
  const p = Bun.spawn(['ffmpeg', '-v', 'error', ...args, '-vf', `${filter}scale=${w}:${h}:flags=area,format=rgb24`, '-f', 'rawvideo', '-'], { stdout: 'pipe' });
  const px = new Uint8Array(await new Response(p.stdout).arrayBuffer());
  if (await p.exited) throw new Error(`ffmpeg ${args.join(' ')} failed`);
  return { w, h, px };
};
/** The video frame on screen at `t` seconds (a grab with `ffmpeg -ss`), scaled to `w` × `h`. */
export const grab = (mp4: string, t: number, w = 480, h = 270) => raw(['-ss', t.toFixed(3), '-i', mp4, '-frames:v', '1'], w, h);
/** Frames sampled `fps` times a second over [from, to), cropped to `crop` (fractions of the frame), scaled to `w` × `h`. */
export async function frames(mp4: string, from: number, to: number, fps: number, w = 480, h = 270, crop?: [number, number, number, number]): Promise<Picture[]> {
  const filter = crop ? `crop=iw*${crop[2]}:ih*${crop[3]}:iw*${crop[0]}:ih*${crop[1]},` : '';
  const all = await raw(['-ss', from.toFixed(3), '-t', (to - from).toFixed(3), '-i', mp4, '-r', String(fps)], w, h, filter);
  const size = w * h * 3;
  return Array.from({ length: Math.floor(all.px.length / size) }, (_, i) => ({ w, h, px: all.px.subarray(i * size, (i + 1) * size) }));
}
/** A PNG (a contact sheet), optionally cropped to `crop` [x, y, w, h] in its own pixels, scaled to `w` × `h`. */
export const picture = (png: string, w: number, h: number, crop?: [number, number, number, number]) =>
  raw(['-i', png], w, h, crop ? `crop=${crop[2]}:${crop[3]}:${crop[0]}:${crop[1]},` : '');

/** Pixels in the box (fractions of the picture) whose colour is within `tol` of `rgb`; their count and centroid. */
export function near(p: Picture, rgb: [number, number, number], tol: number, box: [number, number, number, number] = [0, 0, 1, 1]) {
  let n = 0, sx = 0, sy = 0;
  const [x0, y0, x1, y1] = [Math.floor(box[0] * p.w), Math.floor(box[1] * p.h), Math.ceil(box[2] * p.w), Math.ceil(box[3] * p.h)];
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * p.w + x) * 3;
    if (Math.abs(p.px[i]! - rgb[0]) + Math.abs(p.px[i + 1]! - rgb[1]) + Math.abs(p.px[i + 2]! - rgb[2]) <= tol) { n++; sx += x; sy += y; }
  }
  return { n, x: n ? sx / n / p.w : NaN, y: n ? sy / n / p.h : NaN };
}

/** The share of pixels in the box that differ from `bg` by more than `tol`. */
export function inked(p: Picture, bg: [number, number, number], box: [number, number, number, number] = [0, 0, 1, 1], tol = 40): number {
  const [x0, y0, x1, y1] = [Math.floor(box[0] * p.w), Math.floor(box[1] * p.h), Math.ceil(box[2] * p.w), Math.ceil(box[3] * p.h)];
  let n = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * p.w + x) * 3;
    if (Math.abs(p.px[i]! - bg[0]) + Math.abs(p.px[i + 1]! - bg[1]) + Math.abs(p.px[i + 2]! - bg[2]) > tol) n++;
  }
  return n / ((x1 - x0) * (y1 - y0));
}

/** Mean absolute difference per channel between two pictures of one size (0 = identical). */
export function difference(a: Picture, b: Picture): number {
  let d = 0;
  for (let i = 0; i < a.px.length; i++) d += Math.abs(a.px[i]! - b.px[i]!);
  return d / a.px.length;
}

/** `bun bench/fingerprint.ts a b …`: "IDENTICAL (n fields)" or the fields that differ. */
export async function fingerprint(...dirs: string[]): Promise<string> {
  return (await sh(['bun', path.join(ROOT, 'bench', 'fingerprint.ts'), ...dirs])).trim();
}

/** One .srt cue: times in seconds and its lines. */
export interface Cue { start: number; end: number; lines: string[] }
export function srt(file: string): Cue[] {
  const t = (s: string) => { const [h, m, rest] = s.split(':'); const [sec, ms] = rest!.split(','); return +h! * 3600 + +m! * 60 + +sec! + +ms! / 1000; };
  return readFileSync(file, 'utf8').trim().split(/\n\s*\n/).map(block => {
    const [, times, ...lines] = block.split('\n');
    const [a, b] = times!.split(' --> ');
    return { start: t(a!), end: t(b!), lines };
  });
}

/** The pinned chrome-headless-shell the engine installed into ~/.cache/lectern/chrome (any build will do to view a page). */
function chromePath(): string {
  if (process.env.LECTERN_CHROME) return process.env.LECTERN_CHROME;
  const base = path.join(os.homedir(), '.cache', 'lectern', 'chrome', 'chrome-headless-shell');
  for (const build of existsSync(base) ? readdirSync(base) : [])
    for (const dir of readdirSync(path.join(base, build))) {
      const exe = path.join(base, build, dir, 'chrome-headless-shell');
      if (existsSync(exe)) return exe;
    }
  throw new Error('no chrome-headless-shell under ~/.cache/lectern/chrome: run any lectern build once');
}

/** Opens a step-through HTML page as a viewer would, in a 1600×1000 window. */
export async function openPlayer(html: string): Promise<{ page: Page; close: () => Promise<void> }> {
  const browser: Browser = await puppeteer.launch({ executablePath: chromePath(), headless: true, args: ['--allow-file-access-from-files', '--mute-audio', '--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000 });
  await page.goto(`file://${html}`);
  await page.waitForSelector('.p-bar');
  return { page, close: () => browser.close() };
}

/** The text a viewer can read on the player's stage: visible text nodes, in document order. */
export function stageText(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const stage = document.getElementById('stage')!;
    const seen = (el: Element | null): boolean => {
      for (let e = el; e && e !== stage.parentElement; e = e.parentElement) {
        const cs = getComputedStyle(e);
        if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) < 0.05) return false;
      }
      return true;
    };
    const out: string[] = [];
    const walker = document.createTreeWalker(stage, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const t = n.textContent?.trim();
      if (t && seen(n.parentElement)) out.push(t);
    }
    return out;
  });
}
