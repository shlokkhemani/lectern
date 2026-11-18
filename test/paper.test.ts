/**
 * The paper theme (`theme: paper`), on the block tour (test/scripts/tour.md) with estimated timing: every block
 * passes the layout gate with its cards tilted, taped and padded; frames are a warm desk, not the dark canvas;
 * and a scene changes by the camera sliding along the desk, never by a crossfade.
 */
import { beforeAll, expect, test } from 'bun:test';
import path from 'node:path';
import { SCRIPTS, cacheHome, grab, lectern, near, record, sceneStarts, tmp, type Picture, type Run } from './e2e.ts';

const DESK: [number, number, number] = [230, 226, 218];   // --desk under its grain
const BG: [number, number, number] = [10, 10, 10];        // the dark theme's --bg

let out: string, run: Run, starts: number[];
const mp4 = () => path.join(out, 'block-tour.mp4');

beforeAll(async () => {
  out = tmp('paper');
  const tour = (await Bun.file(path.join(SCRIPTS, 'tour.md')).text()).replace(/^title: .*$/m, '$&\ntheme: paper');
  const file = path.join(out, 'tour.md');
  await Bun.write(file, tour);
  run = await lectern(['build', file, '--no-audio', '--out', out], { xdg: await cacheHome() });
  starts = sceneStarts(record(path.join(out, 'build.json')));
}, 120_000);

test('in the paper theme every block type builds lint clean: tilted, taped and padded cards never trip the layout gate', () => {
  expect(run.err).toBe('');
  expect(run.out).toContain('gates: G1 schema pass · G2 layout pass · G3 audio pass · timing pass');
  expect(run.code).toBe(0);
});

test('a paper frame is a desk: warm paper around the cards, where the dark theme is near-black', async () => {
  const f = await grab(mp4(), starts[3]! - 0.1);   // bullets, settled
  const margin: [number, number, number, number] = [0, 0.3, 0.04, 0.7];
  expect(near(f, DESK, 45, margin).n / (0.04 * 480 * 0.4 * 270)).toBeGreaterThan(0.9);
  expect(near(f, BG, 60).n).toBe(0);
});

test('a scene changes by the camera sliding along the desk: mid-change, the outgoing scene is its last frame moved left', async () => {
  // Scene 2 (bullets) follows scene 1 (text and callout). Above the subtitle band, which stays put on the stage,
  // the frame mid-change matches scene 1's last frame shifted left by some dx; a crossfade matches at no shift.
  const last = await grab(mp4(), starts[2]! - 0.1), mid = await grab(mp4(), starts[2]! + 0.4);
  const a = inkColumns(mid, 0.8), b = inkColumns(last, 0.8);
  const fit = (dx: number) => shiftMismatch(a, b, dx);
  let best = { dx: 0, d: fit(0) };
  for (let dx = 1; dx < 440; dx++) { const d = fit(dx); if (d < best.d) best = { dx, d }; }
  expect(best.dx).toBeGreaterThan(24);
  expect(best.d).toBeLessThan(0.15);
  expect(fit(0)).toBeGreaterThan(3 * best.d);
}, 30_000);

/** Each column's ink (darkness against the desk) above `bottom` (a fraction of the height). */
function inkColumns(p: Picture, bottom: number): number[] {
  const cols = new Array<number>(p.w).fill(0);
  for (let y = 0; y < Math.floor(bottom * p.h); y++) for (let x = 0; x < p.w; x++) {
    const i = (y * p.w + x) * 3;
    cols[x]! += Math.max(0, DESK[0] + DESK[1] + DESK[2] - p.px[i]! - p.px[i + 1]! - p.px[i + 2]! - 30);
  }
  return cols;
}

/** How far `a` is from `b` slid left by dx, over the columns `b` still has on screen: 0 = exactly that. */
function shiftMismatch(a: number[], b: number[], dx: number): number {
  let d = 0, n = 0;
  for (let x = dx; x < b.length; x++) { d += Math.abs(a[x - dx]! - b[x]!); n += b[x]!; }
  return n ? d / n : 1;
}
