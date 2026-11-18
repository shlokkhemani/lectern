#!/usr/bin/env bun
/**
 * The real path, minus the network: examples/part8.md → parse (L1) → estimate voice → planScene → the
 * real page (L2) → lint, capture + encode, narration + mux + .srt + HTML, contact sheets. Prints per-stage
 * wall time and CPU-seconds; this is a warm build's visual half (a warm build reads voices from cache instead).
 *
 * Stage CPU = this process + reaped children (ffmpeg, via getrusage) + the live Chrome process trees (ps),
 * sampled at each stage boundary.
 *
 * Usage: bun bench/render-e2e.ts [script=examples/part8.md] [jobs]
 */
import path from 'node:path';
import fs from 'node:fs/promises';
import { parse } from '../src/script/index.ts';
import { estimateVoice } from '../src/audio/voice.ts';
import { planScene, loadMotion } from '../src/timing/index.ts';
import { openStage } from '../src/render/stage.ts';
import { dlopen, FFIType, ptr } from 'bun:ffi';

const libc = dlopen('/usr/lib/libSystem.B.dylib', { getrusage: { args: [FFIType.i32, FFIType.ptr], returns: FFIType.i32 } });
/** CPU seconds (user + sys) of a getrusage target: 0 = self, -1 = reaped children. */
function rusage(who: number): number {
  const buf = new BigInt64Array(18);
  libc.symbols.getrusage(who, ptr(buf));
  const v = new DataView(buf.buffer);
  const tv = (o: number) => Number(v.getBigInt64(o, true)) + v.getInt32(o + 8, true) / 1e6;
  return tv(0) + tv(16);
}
/** Cumulative CPU seconds of every live descendant of this process. */
function liveDescendants(): number {
  const rows = Bun.spawnSync(['ps', '-Ao', 'pid=,ppid=,time=']).stdout.toString().trim().split('\n').map(l => l.trim().split(/\s+/));
  const kids = new Map<number, number[]>();
  const time = new Map<number, number>();
  for (const [pid, ppid, t] of rows) {
    kids.set(+ppid!, [...(kids.get(+ppid!) ?? []), +pid!]);
    const parts = t!.split(':').map(Number);
    time.set(+pid!, parts.reduce((s, x) => s * 60 + x, 0));
  }
  let sum = 0;
  const walk = (p: number) => { for (const c of kids.get(p) ?? []) { if (c !== process.pid) { sum += time.get(c) ?? 0; walk(c); } } };
  walk(process.pid);
  return sum;
}
const cpuNow = () => rusage(0) + rusage(-1) + liveDescendants();

const ROOT = path.resolve(import.meta.dir, '..');
const file = path.resolve(ROOT, Bun.argv[2] ?? 'examples/part8.md');
const jobs = Bun.argv[3] ? Number(Bun.argv[3]) : undefined;
const out = path.join(ROOT, 'bench/out/render-e2e');
await fs.rm(out, { recursive: true, force: true });

const t: Record<string, { wallS: number; cpuS: number }> = {};
let last = performance.now(), lastCpu = cpuNow();
const lap = (name: string) => {
  const now = performance.now(), cpu = cpuNow();
  t[name] = { wallS: +((now - last) / 1000).toFixed(2), cpuS: +(cpu - lastCpu).toFixed(1) };
  last = now; lastCpu = cpu;
};
const start = last, startCpu = lastCpu;

const { ir, errors } = parse(await Bun.file(file).text(), file, p => { try { return require('node:fs').readFileSync(path.resolve(path.dirname(file), p), 'utf8'); } catch { return null; } });
if (!ir) throw new Error(errors.map(e => `${e.line}:${e.col} ${e.code} ${e.message}`).join('\n'));
lap('parse');
const motion = await loadMotion(ir.meta.theme);
const voiced = ir.scenes.map(s => estimateVoice(s));
const plans = ir.scenes.map((s, k) => {
  const p = planScene(ir, k, voiced[k]!, motion);
  if (Array.isArray(p)) throw new Error(p.map(e => `${e.code} ${e.message}`).join('\n'));
  return p;
});
lap('plan');
const stage = await openStage(ir, { workDir: path.join(out, '.work'), ...(jobs ? { jobs } : {}) });
lap('openStage');
try {
  const lint = (await Promise.all(plans.map((_, k) => stage.lint(k)))).flat();
  lap('lint');
  const segments = await Promise.all(plans.map((p, k) => stage.renderScene(k, p)));
  lap('capture+encode');
  if (process.env.SEGS) console.log(segments.map(s => `s${s.scene} f=${s.frames} u=${s.uniqueFrames} cap=${(s.captureMs/1000).toFixed(2)} enc=${(s.encodeMs/1000).toFixed(2)}`).join('\n'));
  const exported = await stage.export({ plans, voiced, segments, outDir: out });
  lap('narration+mux+srt+html');
  const sheets = await stage.sheets(plans, { lint, audio: {} }, path.join(out, 'sheets'));
  lap('sheets');
  const frames = plans.reduce((n, p) => n + p.frameCount, 0), unique = plans.reduce((n, p) => n + p.capture.length, 0);
  const captureMs = segments.reduce((n, s) => n + s.captureMs, 0);
  console.log(JSON.stringify({
    scenes: plans.length, frames, seconds: +(frames / 30).toFixed(1), unique, uniqueRatio: +(unique / frames).toFixed(3),
    captureMsPerUniqueFrame: +(captureMs / unique).toFixed(1), lintIssues: lint.length, sheets: sheets.length,
    stages: t, totalS: +((performance.now() - start) / 1000).toFixed(2), totalCpuS: +(cpuNow() - startCpu).toFixed(1),
    load: (await Bun.$`sysctl -n vm.loadavg`.text()).trim(), outputs: exported,
  }, null, 2));
} finally {
  await stage.close();
}
