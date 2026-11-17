#!/usr/bin/env bun
/**
 * The README demo: Lectern's build of `lectern.md`, with Lectern's own build of `water.md` played inside a screen
 * after the "You get a video" scene. Every pixel is Lectern output; ffmpeg only places the second video in a frame.
 *
 * Usage: bun examples/lectern/compose.ts <lectern out dir> <water out dir> <out.mp4>
 *   (build both first: `lectern build examples/lectern.md --out A`, `lectern build examples/lectern/water.md --out B`)
 */
import path from 'node:path';
import fs from 'node:fs';

const [mainDir, waterDir, out] = process.argv.slice(2);
if (!mainDir || !waterDir || !out) throw new Error('usage: compose.ts <lectern out dir> <water out dir> <out.mp4>');

const FPS = 30;
const SPLIT_AFTER = 'You get a video';          // the scene the screen follows
const FADE = 0.25;                              // seconds, each side of a cut, through the background
const BG = '0x0a0a0a', BEZEL = '0x1a1a1a';      // theme --bg, --surface-2
const W = 1440, H = 810, X = 240, Y = 208, PAD = 12, HEAD = 170;   // the screen, below the headline strip

const mp4 = (dir: string) => path.join(dir, fs.readdirSync(dir).find(f => f.endsWith('.mp4'))!);
const build = JSON.parse(fs.readFileSync(path.join(mainDir, 'build.json'), 'utf8')) as { scenes: { frames: number }[]; frames: { total: number } };
const script = fs.readFileSync(path.join(import.meta.dir, '..', 'lectern.md'), 'utf8');
const k = script.split('\n').filter(l => /^##( |$)/.test(l)).findIndex(l => l === `## ${SPLIT_AFTER}`);
if (k < 0) throw new Error(`no scene "## ${SPLIT_AFTER}" in lectern.md`);

// Every cut is bounded by build.json's own length: Lectern's MP4 holds frames (variable frame rate), and ffmpeg's fps
// filter would otherwise stretch the last frame by the hold before it.
// A ends where scene k+1 starts; C starts once Lectern's crossfade into it (--dur-scene, 360 ms) is over.
const cut = build.scenes.slice(0, k + 1).reduce((s, x) => s + x.frames, 0);
const resume = cut + Math.ceil(0.36 * FPS);
const water = mp4(waterDir), main = mp4(mainDir);
const dur = Number(Bun.spawnSync(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', water]).stdout.toString());

const run = (args: string[]) => {
  const r = Bun.spawnSync(['ffmpeg', '-v', 'error', '-y', ...args], { stderr: 'pipe' });
  if (r.exitCode) throw new Error(r.stderr.toString());
};
const still = `${out}.bg.png`;
run(['-ss', String((cut - 5) / FPS), '-i', main, '-frames:v', '1', still]);   // the settled "You get a video" frame

const fadeBoth = (d: number) => `fade=in:st=0:d=${FADE}:color=${BG},fade=out:st=${(d - FADE).toFixed(3)}:d=${FADE}:color=${BG}`;
const audio = 'aresample=48000,aformat=sample_rates=48000:channel_layouts=mono';
const enc = ['-c:v', 'libx264', '-crf', '18', '-preset', 'slow', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-c:a', 'aac', '-b:a', '160k'];
const part = (n: string) => `${out}.${n}.mp4`;
// A: the demo up to the screen; B: the screen with water.md's video and voice; C: the rest of the demo.
run(['-i', main, '-filter_complex',
  `[0:v]fps=${FPS},trim=end=${cut / FPS},setpts=PTS-STARTPTS,fade=out:st=${(cut / FPS - FADE).toFixed(3)}:d=${FADE}:color=${BG}[v];` +
  `[0:a]atrim=end=${cut / FPS},asetpts=PTS-STARTPTS,${audio}[a]`, '-map', '[v]', '-map', '[a]', ...enc, part('a')]);
run(['-loop', '1', '-framerate', String(FPS), '-t', String(dur), '-i', still, '-i', water, '-filter_complex',
  `[0:v]drawbox=x=0:y=${HEAD}:w=iw:h=ih-${HEAD}:color=${BG}:t=fill,` +
  `drawbox=x=${X - PAD}:y=${Y - PAD}:w=${W + 2 * PAD}:h=${H + 2 * PAD}:color=${BEZEL}:t=fill,setsar=1[bg];` +
  `[1:v]fps=${FPS},scale=${W}:${H}:flags=lanczos[w];[bg][w]overlay=${X}:${Y}:shortest=1,${fadeBoth(dur)}[v];[1:a]${audio}[a]`,
  '-map', '[v]', '-map', '[a]', ...enc, part('b')]);
run(['-i', main, '-filter_complex',
  `[0:v]fps=${FPS},trim=start=${resume / FPS}:end=${build.frames.total / FPS},setpts=PTS-STARTPTS,fade=in:st=0:d=${FADE}:color=${BG}[v];` +
  `[0:a]atrim=start=${resume / FPS}:end=${build.frames.total / FPS},asetpts=PTS-STARTPTS,${audio}[a]`, '-map', '[v]', '-map', '[a]', ...enc, part('c')]);
run(['-i', part('a'), '-i', part('b'), '-i', part('c'), '-filter_complex', '[0:v][0:a][1:v][1:a][2:v][2:a]concat=n=3:v=1:a=1[v][a]',
  '-map', '[v]', '-map', '[a]', ...enc, '-movflags', '+faststart', out]);
for (const n of ['a', 'b', 'c']) fs.rmSync(part(n));
fs.rmSync(still);
console.log(`${out}: screen from ${(cut / FPS).toFixed(2)} s for ${dur.toFixed(2)} s`);
