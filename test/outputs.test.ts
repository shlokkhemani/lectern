/**
 * What a build leaves in its output directory, and the CLI's own contract: one build at a time per directory (a
 * second is refused, R700, and touches nothing), no lock file left behind, a `--scenes` build writing beside the full
 * build's outputs, a failed gate never leaving an earlier MP4 to pass for this one, and the flags and usage errors.
 * All on test/scripts/small.md with estimated timing (`--no-audio`).
 */
import { beforeAll, expect, test } from 'bun:test';
import { cpSync, existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { SCRIPTS, cacheHome, lectern, issues, record, sh, tmp } from './e2e.ts';

const SMALL = path.join(SCRIPTS, 'small.md');
let xdg: string;
beforeAll(async () => { xdg = await cacheHome(); });

/** A copy of small.md (edited by `edit`) in a fresh directory, and its output directory. */
function copy(edit: (t: string) => string = t => t): { file: string; out: string } {
  const dir = tmp('out');
  const file = path.join(dir, 'small.md');
  writeFileSync(file, edit(readFileSync(SMALL, 'utf8')));
  return { file, out: path.join(dir, 'out') };
}
const outputs = (out: string) => ['mp4', 'html', 'srt'].map(ext => path.join(out, `small.${ext}`));
const pngSize = async (f: string) => (await sh(['ffprobe', '-v', 'error', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', f])).trim();

test('one build at a time per directory: a second is refused with R700 and changes nothing; no lock is left', async () => {
  const { file, out } = copy();
  const first = lectern(['build', file, '--no-audio', '--out', out], { xdg });
  const lock = path.join(out, '.lectern.lock');
  for (let i = 0; i < 400 && !existsSync(lock); i++) await Bun.sleep(10);
  expect(existsSync(lock)).toBe(true);
  const second = await lectern(['build', file, '--no-audio', '--out', out], { xdg });
  expect(second.code).toBe(2);
  expect(second.err).toContain('R700: another build');
  expect(second.err).toContain('wait for it, or build into another --out');
  const done = await first;
  expect(done.code).toBe(0);
  expect(record(path.join(out, 'build.json')).ok).toBe(true);
  // Outputs only: the scratch directory is emptied and no lock file remains.
  expect(readdirSync(out).sort()).toEqual(['.work', 'build.json', 'sheets', 'small.html', 'small.mp4', 'small.srt']);
  expect(readdirSync(path.join(out, '.work'))).toEqual([]);
}, 120_000);

test('a --scenes build writes its own record, sheets and video beside the full build\'s, which it leaves alone', async () => {
  const { file, out } = copy();
  expect((await lectern(['build', file, '--no-audio', '--out', out], { xdg })).code).toBe(0);
  const before = Object.fromEntries(['build.json', 'sheets/sheet-01.png', 'small.mp4'].map(f => [f, readFileSync(path.join(out, f))]));
  const subset = await lectern(['build', file, '--no-audio', '--scenes', '1', '--out', out], { xdg });
  expect(subset.code).toBe(0);
  for (const [f, bytes] of Object.entries(before)) expect(readFileSync(path.join(out, f)).equals(bytes)).toBe(true);
  expect(readdirSync(path.join(out, 'sheets'))).toEqual(['sheet-01.png']);
  for (const f of ['build.s1-1.json', 'sheets.s1-1/sheet-01.png', 'small.s1-1.mp4', 'small.s1-1.html', 'small.s1-1.srt'])
    expect([f, existsSync(path.join(out, f))]).toEqual([f, true]);
  expect(subset.out).toContain(`build: ${path.join(out, 'build.s1-1.json')}`);
  expect(record(path.join(out, 'build.s1-1.json')).scenes.map(s => s.scene)).toEqual([1]);
  // The subset's sheet holds its one tile: one row tall, not a full page.
  expect(await pngSize(path.join(out, 'sheets.s1-1', 'sheet-01.png'))).toBe('1920,383');
}, 120_000);

test('a timing error (T602) withholds every output, removes the earlier build\'s, and still writes build.json', async () => {
  const { file, out } = copy();
  expect((await lectern(['build', file, '--no-audio', '--out', out], { xdg })).code).toBe(0);
  for (const f of outputs(out)) expect(existsSync(f)).toBe(true);
  writeFileSync(file, readFileSync(file, 'utf8').replace('[hl pts:2] The arguments come second, and', '[hl pts:2] The arguments come second, [set pts:1 one; set pts:1 two] and'));
  const r = await lectern(['build', file, '--no-audio', '--force', '--out', out], { xdg });
  expect(r.code).toBe(1);
  const t602 = issues(r.out).find(i => i.code === 'T602')!;
  expect(t602.where).toMatch(/small\.md:\d+(:\d+)? S2$/);
  expect(r.out).toContain('timing FAIL');
  for (const f of outputs(out)) expect([f, existsSync(f)]).toEqual([f, false]);
  const b = record(path.join(out, 'build.json'));
  expect([b.ok, b.gates.timing]).toEqual([false, false]);
}, 120_000);

test('a failed layout gate withholds the MP4 (the earlier one is removed) but writes the page, subtitles and sheets', async () => {
  const { file, out } = copy();
  expect((await lectern(['build', file, '--no-audio', '--out', out], { xdg })).code).toBe(0);
  // A token strip far too long for the frame: L410.
  writeFileSync(file, readFileSync(file, 'utf8').replace('## Again\n', '## Again\n::: tokens long\nalpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma\n:::\n'));
  const r = await lectern(['build', file, '--no-audio', '--out', out], { xdg });
  expect(r.code).toBe(1);
  expect(issues(r.out).map(i => i.code)).toEqual(['L410']);
  expect(existsSync(path.join(out, 'small.mp4'))).toBe(false);
  for (const f of ['small.html', 'small.srt', 'build.json', 'sheets/sheet-01.png']) expect([f, existsSync(path.join(out, f))]).toEqual([f, true]);
  const b = record(path.join(out, 'build.json'));
  expect([b.ok, b.forced, b.gates.G2]).toEqual([false, false, false]);
  expect(b.outputs.mp4).toBeUndefined();
}, 120_000);

test('check and shots: --out, --scenes, --no-audio; estimated length per scene and in total; scratch cleaned', async () => {
  const { file, out } = copy();
  const shots = await lectern(['shots', file, '--scenes', '0', '--no-audio', '--out', out], { xdg });
  expect(shots.code).toBe(0);
  expect(shots.out).toContain(`contact sheets (Read every sheet before finishing):\n  ${path.join(out, 'sheets.s0-0', 'sheet-01.png')}`);
  expect(readdirSync(path.join(out, '.work'))).toEqual([]);
  const check = await lectern(['check', file, '--no-audio', '--out', out], { xdg });
  expect(check.code).toBe(0);
  const lines = check.out.split('\n');
  expect(lines.filter(l => /^S\d+  \d+:\d\d  \d+ words$/.test(l))).toHaveLength(3);
  expect(lines.some(l => /^total  \d+:\d\d  \d+ words \(estimated\)$/.test(l))).toBe(true);
  expect(check.out).toContain('gates: G1 schema pass · G2 layout pass · G3 audio pass · timing pass');
  const json = JSON.parse((await lectern(['check', file, '--no-audio', '--json', '--out', out], { xdg })).out) as
    { ok: boolean; length: { scenes: { scene: number; seconds: number; words: number }[]; seconds: number; words: number } };
  const { scenes, seconds, words } = json.length;
  expect(json.ok).toBe(true);
  expect(scenes.map(s => s.scene)).toEqual([0, 1, 2]);
  expect(scenes.every(s => s.seconds > 0 && s.words > 0)).toBe(true);
  expect(seconds).toBeCloseTo(scenes.reduce((n, s) => n + s.seconds, 0), 6);
  expect(words).toBe(scenes.reduce((n, s) => n + s.words, 0));
}, 120_000);

test('usage errors exit 2 with the usage text; nothing is built', async () => {
  const { file, out } = copy();
  const cases: [string[], string][] = [
    [['check', file, '--force'], 'check takes only --out, --scenes, --jobs, --no-audio and --json'],
    [['build', file, '--frobnicate'], 'unknown flag --frobnicate'],
    [['render', file], 'unknown command "render"'],
    [['build'], 'no script given'],
    [['build', file, file], 'one script only'],
    [['build', file, '--scenes', '5-3'], '--scenes: range 5-3 runs backwards'],
    [['build', file, '--scenes', 'two'], '--scenes needs a list like 3-5,8'],
    [['build', file, '--jobs', '0'], '--jobs needs a positive integer'],
  ];
  for (const [args, says] of cases) {
    const r = await lectern([...args, '--out', out], { xdg });
    expect([args.join(' '), r.code]).toEqual([args.join(' '), 2]);
    expect(r.err).toContain(says);
    expect(r.err).toContain('usage:');
  }
  // A scene that does not exist names the valid range.
  const r = await lectern(['build', file, '--no-audio', '--scenes', '7', '--out', out], { xdg });
  expect(r.code).toBe(2);
  expect(r.err).toContain('--scenes 7: the script has scenes 0-2');
  expect(existsSync(path.join(out, 'small.mp4'))).toBe(false);
}, 60_000);

test('a script\'s src= files are read relative to the script, from any working directory', async () => {
  // examples/part8.md shows real parser code with src=; checked from the filesystem root it still resolves.
  const dir = tmp('src');
  cpSync(path.join(SCRIPTS, '..', '..', 'examples'), dir, { recursive: true });
  const r = await lectern(['check', path.join(dir, 'part8.md'), '--no-audio', '--scenes', '5-7', '--out', path.join(dir, 'out')], { xdg, cwd: '/' });
  expect(r.out).toContain('gates: G1 schema pass');
  expect(issues(r.out).filter(i => i.code === 'E213')).toEqual([]);
}, 60_000);
