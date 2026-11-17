/**
 * The acceptance script, examples/part8.md, built as an agent builds it: offline, from the voice cache. One cold
 * build is inspected the way a viewer would (the MP4, the .srt, the contact sheets, the step-through page); further
 * builds hold the speed invariants (cold, warm and LECTERN_SHOOT_EVERY_RUN give identical outputs; an edit re-renders
 * only its scene; changed words are voiced again, a moved cue is not).
 *
 * The builds pass --force so the outputs can be inspected even while a gate fails; the gates are asserted on their
 * own, in the first test.
 */
import { beforeAll, expect, test } from 'bun:test';
import { cpSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  PART8, cacheHome, difference, lectern, fingerprint, frames, issues, openPlayer, picture, probe, record, sceneStarts, sh, srt,
  stageText, tmp, type BuildRecord, type Run,
} from './e2e.ts';

const SLUG = 'call-expressions-and-a-finished-parser';
let xdg: string, full: string, fullRun: Run, built: BuildRecord;
let cold: string, coldRun: Run;

beforeAll(async () => {
  xdg = await cacheHome(true);
  const otherXdg = await cacheHome(true);
  full = tmp('part8');
  cold = tmp('part8-cold');
  // The full build on one cold cache; beside it, scenes 0-4 on another cold cache, shooting every frame.
  [fullRun, coldRun] = await Promise.all([
    lectern(['build', PART8, '--force', '--out', full], { xdg }),
    lectern(['build', PART8, '--scenes', '0-4', '--out', cold], { xdg: otherXdg, env: { LECTERN_SHOOT_EVERY_RUN: '1' } }),
  ]);
  built = record(path.join(full, 'build.json'));
}, 180_000);

const mp4 = () => path.join(full, `${SLUG}.mp4`);

test('part 8 passes every gate, with no error in the report', () => {
  expect(issues(fullRun.out).filter(i => i.severity === 'error').map(i => `${i.where}: ${i.code}`)).toEqual([]);
  expect(built.gates).toEqual({ G1: true, G2: true, G3: true, timing: true });
  expect([fullRun.code, built.ok, built.forced]).toEqual([0, true, false]);
  // A passing build leaves its outputs only: an emptied scratch directory, no lock.
  expect(readdirSync(full).sort()).toEqual(['.work', 'build.json', `${SLUG}.html`, `${SLUG}.mp4`, `${SLUG}.srt`, 'sheets']);
  expect(readdirSync(path.join(full, '.work'))).toEqual([]);
});

test('part 8 builds offline from the voice cache and reports where every output is', () => {
  expect(fullRun.err).toBe('');
  // Every scene's take came from the cache and passed the transcript check on the first attempt.
  expect(built.scenes).toHaveLength(17);
  expect(built.scenes.every(s => s.audioPass === true && s.attempts === 1)).toBe(true);
  expect(built.gates.G3).toBe(true);
  for (const name of ['mp4', 'html', 'srt', 'build']) expect(fullRun.out).toContain(`${name}: ${path.join(full, name === 'build' ? 'build.json' : `${SLUG}.${name}`)}`);
  expect(fullRun.out).toContain('contact sheets (Read every sheet before finishing):');
  for (const s of built.sheets) expect(fullRun.out).toContain(`  ${s}`);
  // Audio warnings print the script line and the contact-sheet tile, scene·beat, then the fix.
  const audio = issues(fullRun.out).filter(i => i.code.startsWith('W51'));
  expect(audio.length).toBeGreaterThan(0);
  for (const a of audio) {
    expect(a.where).toMatch(new RegExp(`^${PART8.replace(/[.]/g, '\\.')}:\\d+ S\\d+·B\\d+$`));
    expect(a.fix.length).toBeGreaterThan(0);
  }
  expect(readdirSync(full)).not.toContain('.lectern.lock');
});

test('the MP4 is standard H.264/AAC, no other track, exactly as long as build.json says, with the narration in it', async () => {
  const { format, streams } = await probe(mp4());
  expect(format.format_name).toContain('mp4');
  expect(streams).toHaveLength(2);
  const [v, a] = streams;
  expect([v!.codec_name, v!.profile, v!.pix_fmt, v!.width, v!.height]).toEqual(['h264', 'High', 'yuv420p', 1920, 1080]);
  expect([v!.color_primaries, v!.color_transfer, v!.color_space]).toEqual(['bt709', 'bt709', 'bt709']);
  expect([a!.codec_name, a!.sample_rate, a!.channels]).toEqual(['aac', '48000', 1]);
  const seconds = built.frames.total / 30;
  expect(built.frames.total).toBe(built.scenes.reduce((n, s) => n + s.frames!, 0));
  expect(Number(v!.duration)).toBeCloseTo(seconds, 3);
  expect([Number(a!.start_pts), Number(a!.duration_ts)]).toEqual([0, built.frames.total * 1600]);
  expect(seconds).toBeGreaterThan(6 * 60);   // the hand-built part 8 runs 7:22
  // Speech, not silence: the loudest second is well above the noise floor.
  const vol = await sh(['sh', '-c', `ffmpeg -v info -i '${mp4()}' -map 0:a -af volumedetect -f null - 2>&1 | grep max_volume`]);
  expect(Number(/max_volume: (-?[\d.]+) dB/.exec(vol)![1])).toBeGreaterThan(-12);
});

test('the .srt: cues in order inside the video, at most two lines of 42 characters, no sentence tail under 3 words, no lone word on a second line', () => {
  const cues = srt(path.join(full, `${SLUG}.srt`));
  const seconds = built.frames.total / 30;
  expect(cues.length).toBeGreaterThan(100);
  cues.forEach((c, i) => {
    expect(c.end).toBeGreaterThan(c.start);
    if (i) expect(c.start).toBeGreaterThanOrEqual(cues[i - 1]!.end - 1e-3);
    expect(c.lines.length).toBeLessThanOrEqual(2);
    for (const l of c.lines) expect(l.length).toBeLessThanOrEqual(42);
  });
  expect(cues.at(-1)!.end).toBeLessThanOrEqual(seconds + 1e-3);
  // r6-seasons: a sentence that overran two lines left its last word or two alone on screen.
  const tails = cues.filter((c, i) => i && !/[.!?]["')\]]*$/.test(cues[i - 1]!.lines.join(' ')) && c.lines.join(' ').split(' ').length < 3);
  expect(tails.map(c => c.lines.join(' '))).toEqual([]);
  // The README video: a two-line cue left one word alone on its second line ("…with two / chips.").
  expect(cues.filter(c => c.lines.length === 2 && !c.lines[1]!.includes(' ')).map(c => c.lines.join(' / '))).toEqual([]);
  // Every scene has subtitles: a cue starts inside each scene's span of the video.
  const starts = sceneStarts(built);
  for (let k = 0; k < 17; k++) expect(cues.some(c => c.start >= starts[k]! - 1e-3 && c.start < starts[k + 1]!)).toBe(true);
});

/** The tiles of a contact sheet: 3 across, 640×360 each above a 22.5px label. */
const tileBoxes = (rows: number) => Array.from({ length: rows * 3 }, (_, i) => [(i % 3) * 640, Math.round(Math.floor(i / 3) * 382.5)] as const);

test('every contact-sheet tile is a picture the video holds, in the video\'s order', async () => {
  expect(built.sheets.length).toBeGreaterThanOrEqual(3);
  // The video sampled 4 times a second (mid-hold grabs), and every tile, both at 160×90 inside a 2% inset (the
  // tiles' dividers). A matching grab scores ~1.4-2.4 (scaling and H.264); the nearest different picture 3.5 or more.
  const video = await frames(mp4(), 0, built.frames.total / 30, 4, 160, 90, [0.02, 0.02, 0.96, 0.96]);
  let last = -1;
  const best: number[] = [];
  for (const sheet of built.sheets) {
    const [w, h] = (await sh(['ffprobe', '-v', 'error', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', sheet])).trim().split(',').map(Number);
    expect(w).toBe(1920);
    for (const [x, y] of tileBoxes(Math.round(h! / 382.5))) {
      const tile = await picture(sheet, 160, 90, [x + 13, y + 7, 614, 346]);
      if (tile.px.every(v => v < 16)) continue;   // past the last tile: the sheet's own background
      const scores = video.map(f => difference(tile, f));
      const at = scores.indexOf(Math.min(...scores));
      best.push(scores[at]!);
      expect(at).toBeGreaterThanOrEqual(last);
      last = at;
    }
  }
  expect(best.length).toBeGreaterThan(17);
  // Only a tile carrying a boxed finding or an audio banner may differ from every grab.
  const marked = built.issues.layout.length + (built.issues.audio as { issues: unknown[] }[]).reduce((n, a) => n + a.issues.length, 0);
  expect(best.filter(s => s > 2.6).length).toBeLessThanOrEqual(marked);
}, 60_000);

test('the step-through page plays the narration from 0:00 and steps beat by beat, showing the subtitle the .srt has', async () => {
  const { page, close } = await openPlayer(path.join(full, `${SLUG}.html`));
  try {
    const cues = srt(path.join(full, `${SLUG}.srt`));
    const lines = new Set(cues.map(c => c.lines.join('\n')));
    await page.waitForFunction(() => (document.getElementById('lectern-narration') as HTMLAudioElement).readyState >= 1);
    const audio = () => page.evaluate(() => { const a = document.getElementById('lectern-narration') as HTMLAudioElement; return { t: a.currentTime, d: a.duration, paused: a.paused }; });
    expect((await audio()).d).toBeCloseTo(built.frames.total / 30, 0);
    const [play] = await page.$$('.p-bar button');
    await play!.click();
    // Wait for playback to advance rather than a fixed sleep: a loaded machine starts audio late.
    await page.waitForFunction(() => (document.getElementById('lectern-narration') as HTMLAudioElement).currentTime > 0.1, { timeout: 5000 });
    const playing = await audio();
    expect(playing.paused).toBe(false);
    expect(playing.t).toBeLessThan(1.5);
    await play!.click();
    // → steps to the next beat's settled picture: the stage changes, and shows the .srt's subtitles.
    const seen: string[][] = [];
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('ArrowRight');
      seen.push(await stageText(page));
    }
    for (let i = 1; i < seen.length; i++) expect(seen[i]).not.toEqual(seen[i - 1]);
    expect(seen.filter(texts => texts.some(t => lines.has(t))).length).toBeGreaterThanOrEqual(3);
    // Dragging the scrubber into a cue shows that cue's subtitle on the stage.
    const total = built.frames.total / 30;
    const long = cues.filter(c => c.end - c.start > 2.5);
    for (const c of [0.1, 0.3, 0.5, 0.7, 0.9].map(f => long[Math.floor(f * long.length)]!)) {
      await page.evaluate(v => {
        const r = document.querySelector<HTMLInputElement>('.p-bar input')!;
        r.value = String(v);
        r.dispatchEvent(new Event('input'));
      }, Math.round(((c.start + c.end) / 2 / total) * 1000));
      expect(await stageText(page)).toContain(c.lines.join('\n'));
    }
  } finally {
    await close();
  }
}, 60_000);

test('cold cache, warm cache and LECTERN_SHOOT_EVERY_RUN give identical outputs (bench/fingerprint.ts)', async () => {
  expect(coldRun.code).toBe(0);
  const warm = tmp('part8-warm');
  // Scenes 0-4 again, on the cache the full build filled, skipping unchanged screenshots as usual.
  const run = await lectern(['build', PART8, '--scenes', '0-4', '--out', warm], { xdg });
  expect(run.code).toBe(0);
  expect(record(path.join(warm, 'build.s0-4.json')).scenes.map(s => s.cached)).toEqual([true, true, true, true, true]);
  expect(record(path.join(cold, 'build.s0-4.json')).scenes.map(s => s.cached)).toEqual([false, false, false, false, false]);
  expect(await fingerprint(cold, warm)).toMatch(/^IDENTICAL/);
}, 120_000);

test('an edit re-renders only its scene; a moved cue reuses the cached take; changed words are voiced again', async () => {
  const dir = tmp('part8-edit');
  cpSync(path.dirname(PART8), dir, { recursive: true });
  const script = path.join(dir, 'part8.md');
  const text = readFileSync(script, 'utf8');
  // Scene 2: a line of its compare changes, nothing else. Scene 5: a cue moves two words later, its words unchanged.
  const edited = text.replace('Only names allowed.', 'Only names.')
    .replace('[show hl in] In add of 2 and 3,', 'In add [show hl in] of 2 and 3,');
  expect(edited).not.toBe(text);
  writeFileSync(script, edited);
  const out = path.join(dir, 'out');
  const run = await lectern(['build', script, '--force', '--out', out], { xdg });
  expect(run.err).toBe('');
  const b = record(path.join(out, 'build.json'));
  expect(b.scenes.every(s => s.attempts === 1 && s.audioPass)).toBe(true);   // no new take: the cached ones fit
  const cached = b.scenes.map(s => s.cached);
  // Re-rendered: the two edited scenes, and the scene after each only if its crossfade from them changed.
  expect([cached[2], cached[5]]).toEqual([false, false]);
  expect(cached.filter((_, k) => ![2, 3, 5, 6].includes(k))).toEqual(Array(13).fill(true));
  expect(await sh(['md5', '-q', path.join(out, `${SLUG}.mp4`)])).not.toBe(await sh(['md5', '-q', mp4()]));

  // Scene 4's narration changes by one word: its take is gone from the cache, so the build must voice it.
  writeFileSync(script, text.replace('Here is the puzzle.', 'Here is the riddle.'));
  const revoice = await lectern(['build', script, '--scenes', '4', '--no-video', '--out', path.join(dir, 'out4')], { xdg });
  expect(revoice.code).toBe(2);
  expect(revoice.err).toContain('GEMINI_API_KEY is not set');
}, 120_000);
