// Usage: bun bench/fingerprint.ts <outDir> [more outDirs...]
// Prints a fingerprint of a build's outputs: decoded video frames (framemd5), decoded audio samples,
// the SRT, the HTML, each contact sheet (bytes and decoded pixels), and build.json's gates and issues.
// With two or more dirs, reports which fields differ from the first.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const md5 = (b: string | Uint8Array) => createHash('md5').update(b).digest('hex');
async function sh(args: string[]): Promise<string> {
  const p = Bun.spawn(args, { stdout: 'pipe', stderr: 'pipe' });
  const [o, e, c] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  if (c) throw new Error(`${args.join(' ')}: ${e}`);
  return o;
}
async function fingerprint(dir: string): Promise<Record<string, string>> {
  const f: Record<string, string> = {};
  const files = readdirSync(dir);
  const mp4 = files.find(x => x.endsWith('.mp4'));
  const srt = files.find(x => x.endsWith('.srt'));
  const html = files.find(x => x.endsWith('.html'));
  if (mp4) {
    const p = join(dir, mp4);
    const vf = await sh(['ffmpeg', '-v', 'error', '-i', p, '-map', '0:v', '-f', 'framemd5', '-']);
    f['video.framemd5'] = md5(vf.split('\n').filter(l => !l.startsWith('#')).join('\n'));
    f['video.frames'] = String(vf.split('\n').filter(l => l && !l.startsWith('#')).length);
    const af = await sh(['ffmpeg', '-v', 'error', '-i', p, '-map', '0:a', '-f', 's16le', '-ac', '1', '-c:a', 'pcm_s16le', '-f', 'md5', '-']);
    f['audio.samples'] = af.trim();
    f['mp4.bytes'] = md5(readFileSync(p));
  }
  if (srt) f.srt = md5(readFileSync(join(dir, srt)));
  if (html) f.html = md5(readFileSync(join(dir, html)));
  // A subset build (`--scenes`) writes sheets.sN-M/ and build.sN-M.json beside its .sN-M outputs.
  const sd = join(dir, files.find(x => /^sheets(\.s\d+-\d+)?$/.test(x)) ?? 'sheets');
  if (existsSync(sd)) for (const s of readdirSync(sd).sort()) {
    f[`sheet.${s}.bytes`] = md5(readFileSync(join(sd, s)));
    f[`sheet.${s}.pixels`] = (await sh(['ffmpeg', '-v', 'error', '-i', join(sd, s), '-f', 'md5', '-'])).trim();
  }
  const bj = join(dir, files.find(x => /^build(\.s\d+-\d+)?\.json$/.test(x)) ?? 'build.json');
  if (existsSync(bj)) {
    const b = JSON.parse(readFileSync(bj, 'utf8'));
    f.gates = JSON.stringify([b.ok, b.forced, b.gates]);
    f.issues = md5(JSON.stringify(b.issues));
    f.frames = JSON.stringify(b.frames);
  }
  return f;
}
const dirs = Bun.argv.slice(2);
const fps = await Promise.all(dirs.map(fingerprint));
if (dirs.length === 1) console.log(JSON.stringify(fps[0], null, 1));
else {
  const keys = new Set(fps.flatMap(f => Object.keys(f)));
  let same = true;
  for (let i = 1; i < fps.length; i++) for (const k of keys) {
    if (fps[0]![k] !== fps[i]![k]) { same = false; console.log(`DIFF ${dirs[i]} ${k}: ${fps[0]![k]} vs ${fps[i]![k]}`); }
  }
  console.log(same ? `IDENTICAL (${keys.size} fields)` : 'DIFFERENT');
}
