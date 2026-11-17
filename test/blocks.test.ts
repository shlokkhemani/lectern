/**
 * Every block type, both kinds of motion and three regressions the founder saw in videos, built from
 * test/scripts/tour.md (one scene each) with estimated timing (`--no-audio`), and read back from the MP4 and the
 * step-through page: each scene draws something and changes on its cues; a mover is elsewhere mid-flight than at
 * either rest; an empty frame never shows; each block keeps its own amber; a tiny log value never reads 0.
 * A second build, on a cold cache and shooting every frame, is identical (bench/fingerprint.ts).
 */
import { beforeAll, expect, test } from 'bun:test';
import path from 'node:path';
import {
  SCRIPTS, cacheHome, lectern, fingerprint, frames, grab, inked, near, openPlayer, probe, record, sceneStarts, sh, srt, stageText,
  tmp, type BuildRecord, type Run,
} from './e2e.ts';

const TOUR = path.join(SCRIPTS, 'tour.md');
const SCENES = ['title', 'text', 'bullets', 'checklist', 'compare', 'table', 'code', 'tree', 'graph', 'math', 'tokens', 'stack',
  'trace', 'terminal', 'sequence', 'custom', 'orbit', 'ball', 'late chart', 'amber', 'log'] as const;
const scene = (name: typeof SCENES[number]) => SCENES.indexOf(name);

const BG: [number, number, number] = [10, 10, 10];          // --bg
const AMBER: [number, number, number] = [245, 177, 61];     // --accent, "now"
const GREEN: [number, number, number] = [76, 195, 138];     // --ok, the planet's fill
/** The body of the frame: below the headline, above the burned-in subtitles. */
const BODY: [number, number, number, number] = [0.02, 0.12, 0.98, 0.82];

let out: string, run: Run, built: BuildRecord, starts: number[], again: string, againRun: Run;
const mp4 = () => path.join(out, 'block-tour.mp4');

beforeAll(async () => {
  out = tmp('tour');
  again = tmp('tour-every');
  [run, againRun] = await Promise.all([
    lectern(['build', TOUR, '--no-audio', '--out', out], { xdg: await cacheHome() }),
    lectern(['build', TOUR, '--no-audio', '--out', again], { xdg: await cacheHome(), env: { LECTERN_SHOOT_EVERY_RUN: '1' } }),
  ]);
  built = record(path.join(out, 'build.json'));
  starts = sceneStarts(built);
}, 120_000);

test('every block type builds lint clean, one scene each', () => {
  expect(run.err).toBe('');
  expect(run.out).toContain('gates: G1 schema pass · G2 layout pass · G3 audio pass · timing pass');
  expect(run.code).toBe(0);
  expect(built.scenes).toHaveLength(SCENES.length);
  expect(built.sheets.length).toBe(2);   // 21 beats, 12 tiles a sheet
});

test('each scene draws its block, and its cues change the picture', async () => {
  for (let k = 0; k < SCENES.length; k++) {
    const early = await grab(mp4(), starts[k]! + 0.45);
    const settled = await grab(mp4(), starts[k + 1]! - 0.1);
    expect([SCENES[k], inked(settled, BG, BODY) > 0.003]).toEqual([SCENES[k], true]);
    // Something on screen differs between the first instant and the settled end (a reveal, a highlight, a set).
    let changed = 0;
    for (let i = 0; i < early.px.length; i++) if (Math.abs(early.px[i]! - settled.px[i]!) > 40) changed++;
    expect([SCENES[k], changed > 30]).toEqual([SCENES[k], true]);
  }
}, 60_000);

test('a planet moving round its orbit is elsewhere mid-flight than at either rest, always going forward', async () => {
  const k = scene('orbit');
  const track = (await frames(mp4(), starts[k]! + 0.4, starts[k + 1]!, 30)).map(f => near(f, GREEN, 60, BODY)).filter(p => p.n >= 5);
  const [first, last] = [track[0]!, track.at(-1)!];
  expect(first.x).toBeGreaterThan(0.55);            // starts right of the sun
  expect(last.x).toBeLessThan(0.45);                // rests on the far side
  expect(Math.abs(last.y - first.y)).toBeLessThan(0.02);
  const mid = track.filter(p => p.x < first.x - 0.05 && p.x > last.x + 0.05);
  expect(mid.length).toBeGreaterThanOrEqual(3);
  // Clockwise from the right, round the bottom (screen y grows downward): every mid-flight point is below the rests.
  for (const p of mid) expect(p.y).toBeGreaterThan(first.y + 0.01);
  for (let i = 1; i < track.length; i++) expect(track[i]!.x).toBeLessThanOrEqual(track[i - 1]!.x + 0.005);
}, 60_000);

test('a chart point rolls along its series to the right, monotonically, lit as it moves', async () => {
  const k = scene('ball');
  const lit = (await frames(mp4(), starts[k]! + 0.4, starts[k + 1]!, 10)).map(f => near(f, AMBER, 60, BODY)).filter(p => p.n >= 3);
  const [first, last] = [lit[0]!, lit.at(-1)!];
  expect(last.x - first.x).toBeGreaterThan(0.3);
  expect(lit.filter(p => p.x > first.x + 0.03 && p.x < last.x - 0.03).length).toBeGreaterThanOrEqual(3);
  for (let i = 1; i < lit.length; i++) expect(lit[i]!.x).toBeGreaterThanOrEqual(lit[i - 1]!.x - 0.005);
  // Rolling down the curve: it ends lower than it started.
  expect(last.y).toBeGreaterThan(first.y);
}, 60_000);

test('a chart whose bars arrive later shows no empty frame first: no axes, no caption, nothing', async () => {
  const k = scene('late chart');
  expect(inked(await grab(mp4(), starts[k]! + 0.6), BG, BODY)).toBe(0);
  expect(inked(await grab(mp4(), starts[k + 1]! - 0.1), BG, BODY)).toBeGreaterThan(0.01);
});

test('each block keeps its own amber: lighting the right block leaves the left one\'s target "now"', async () => {
  const k = scene('amber');
  const end = await grab(mp4(), starts[k + 1]! - 0.1, 1920, 1080);   // full size: the lit mark is a bullet's dash
  expect(near(end, AMBER, 60, [0, 0.12, 0.5, 0.82]).n).toBeGreaterThan(40);
  expect(near(end, AMBER, 60, [0.5, 0.12, 1, 0.82]).n).toBeGreaterThan(40);
});

test('a tiny value on a log chart reads by its magnitude, never 0 (r6-newton), in the step-through page', async () => {
  const { page, close } = await openPlayer(path.join(out, 'block-tour.html'));
  try {
    await page.keyboard.press('End');
    await page.evaluate(() => {
      const r = document.querySelector<HTMLInputElement>('.p-bar input')!;
      r.value = '999';
      r.dispatchEvent(new Event('input'));
    });
    const text = await stageText(page);
    for (const v of ['0.086', '0.0025', '2.1e-6', '1.6e-12', '1e-12', '0.001', '1']) expect(text).toContain(v);
    expect(text).not.toContain('0');
  } finally {
    await close();
  }
}, 60_000);

test('--no-audio: a silent soundtrack the length of the video, and subtitles from estimated timing', async () => {
  const { streams } = await probe(mp4());
  expect(streams.map(s => s.codec_type)).toEqual(['video', 'audio']);
  expect(Number(streams[1]!.duration_ts)).toBe(built.frames.total * 1600);
  const vol = await sh(['sh', '-c', `ffmpeg -v info -i '${mp4()}' -map 0:a -af volumedetect -f null - 2>&1 | grep max_volume`]);
  expect(Number(/max_volume: (-?[\d.]+) dB/.exec(vol)![1])).toBeLessThan(-80);
  const cues = srt(path.join(out, 'block-tour.srt'));
  expect(cues.length).toBeGreaterThanOrEqual(SCENES.length);
  expect(cues.at(-1)!.end).toBeLessThanOrEqual(built.frames.total / 30 + 1e-3);
});

test('motion is deterministic: a cold build shooting every frame equals the build that skipped unchanged ones', async () => {
  expect(againRun.code).toBe(0);
  expect(await fingerprint(out, again)).toMatch(/^IDENTICAL/);
}, 60_000);
