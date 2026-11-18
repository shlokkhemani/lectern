/**
 * Orchestration: `check`, `shots` and `build` (§8), composed from the five seams.
 * Gate policy lives here and nowhere else:
 * - G1 (schema) failing stops everything.
 * - G2 (layout), G3 (audio) or a timing error withholds the MP4 unless `force`; with `force` the MP4 is
 *   written and build.json records `forced: true`.
 * - G4: contact sheets are always written by `shots` and `build`, and their paths are printed last.
 * Build order (§8): parse → voicing for every scene starts at once, alongside page load, layout and G2 →
 * each scene is planned and captured as soon as its own audio is back. Once every scene is planned, narration,
 * html, srt and sheets run beside the captures; the mux waits for the last segment.
 */
import { existsSync, readFileSync } from 'node:fs';
import { rename, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { Diagnostic, ReadSource, Script } from './ir.ts';
import type { MotionTokens } from './verbs.ts';
import type { VoicedScene } from './audio/types.ts';
import type { ScenePlan, TimingError } from './timing/types.ts';
import type { Exported, LintIssue, Segment, Stage } from './render/types.ts';
import { parse } from './script/index.ts';
import { estimateVoice, voiceScene } from './audio/voice.ts';
import { voiceAhead, voiceIntoCache } from './audio/ahead.ts';
import { loadMotion, planScene, toGlobal } from './timing/index.ts';
import { LINT_POOL_SIZE, openStage, reportPaths, withdrawOutputs } from './render/stage.ts';
import { Custody } from './render/custody.ts';
import { settled } from './render/settled.ts';

export interface Options {
  file: string;
  /** Scene indices to process; all when absent. */
  scenes?: number[];
  out?: string;
  force?: boolean;
  noVideo?: boolean;
  noAudio?: boolean;
  /** Scenes whose voice cache is bypassed. */
  revoice?: number[];
  jobs?: number;
  keep?: boolean;
}

/** Per-scene facts for build.json. Times in ms. */
export interface SceneReport {
  scene: number;
  voiceMs?: number;
  attempts?: number;
  stt?: VoicedScene['stt'];
  audioPass?: boolean;
  wer?: number;
  frames?: number;
  uniqueFrames?: number;
  captureMs?: number;
  encodeMs?: number;
  /** The segment was reused from an earlier build. */
  cached?: boolean;
}

/** Everything a command reports. `ok` is false iff a gate failed (exit 1). */
export interface Outcome {
  ok: boolean;
  forced: boolean;
  gates: { G1: boolean; G2: boolean; G3: boolean; timing: boolean };
  diagnostics: Diagnostic[];
  timing: { scene: number; error: TimingError }[];
  lint: LintIssue[];
  audio: { scene: number; issues: VoicedScene['diff']['issues'] }[];
  scenes: SceneReport[];
  /** Wall time per stage, ms. Stages that overlap are timed from their own start to their own end. */
  stages: Record<string, number>;
  sheets: string[];
  outputs: Record<string, string>;
  /** The exception that ended the build, if one did (build.json is written anyway). */
  error?: string;
  /** `check`/`shots`: estimated length per planned scene (seconds on screen, narration words) and in total. */
  length?: { scenes: { scene: number; seconds: number; words: number }[]; seconds: number; words: number };
}

const failing = (issues: { severity: 'error' | 'warning' }[]) => issues.some(i => i.severity === 'error');

/** Wall-clock stopwatch for build.json; the render path itself never reads a clock. */
function stopwatch() {
  const origin = performance.now();
  const stages: Record<string, number> = {};
  return {
    stages,
    async time<T>(name: string, job: () => Promise<T> | T): Promise<T> {
      const t0 = performance.now();
      try { return await job(); } finally { stages[name] = Math.round(performance.now() - t0); }
    },
    total() { stages.total = Math.round(performance.now() - origin); },
  };
}

function newOutcome(diagnostics: Diagnostic[]): Outcome {
  return {
    ok: false, forced: false, gates: { G1: !failing(diagnostics), G2: true, G3: true, timing: true },
    diagnostics, timing: [], lint: [], audio: [], scenes: [], stages: {}, sheets: [], outputs: {},
  };
}

function load(opts: Options): { ir: Script | null; diagnostics: Diagnostic[] } {
  const text = readFileSync(opts.file, 'utf8');
  const dir = dirname(resolve(opts.file));
  const read: ReadSource = path => {
    const full = resolve(dir, path);
    return existsSync(full) ? readFileSync(full, 'utf8') : null;
  };
  const { ir, errors } = parse(text, opts.file, read);
  return { ir, diagnostics: errors };
}

/** The scenes to process, or a usage error naming the valid range. */
function selected(ir: Script, opts: Options): number[] {
  const all = ir.scenes.map(s => s.index);
  if (!opts.scenes) return all;
  const bad = opts.scenes.filter(k => !all.includes(k));
  if (bad.length) throw new Error(`--scenes ${bad.join(',')}: the script has scenes 0-${all.length - 1}`);
  return opts.scenes;
}

/** Plan scene k; a timing error is recorded on `outcome` and leaves the scene unplanned. */
function plan(ir: Script, k: number, voiced: VoicedScene, motion: MotionTokens, outcome: Outcome): ScenePlan | undefined {
  const r = planScene(ir, k, voiced, motion);
  if (!Array.isArray(r)) return r;
  outcome.timing.push(...r.map(error => ({ scene: k, error })));
  outcome.gates.timing = false;
  return undefined;
}

/** Estimate plans for `ks`, indexed by scene. */
function estimatePlans(ir: Script, ks: number[], motion: MotionTokens, outcome: Outcome): ScenePlan[] {
  const plans: ScenePlan[] = [];
  for (const k of ks) {
    const p = plan(ir, k, estimateVoice(ir.scenes[k]!), motion, outcome);
    if (p) plans[k] = p;
  }
  return plans;
}

/** G2 over every planned scene, in parallel across the pool. */
async function lintAll(stage: Stage, ks: number[], plans: ScenePlan[]): Promise<LintIssue[]> {
  const per = await settled(ks.filter(k => plans[k]).map(k => stage.lint(k)));
  return per.flat();
}

const outDirOf = (ir: Script, opts: Options) => resolve(opts.out ?? join('out', ir.meta.slug));

/** G1 + G2 in estimate mode. Starts the voicer for the build to come, unless `noAudio`. */
export function check(opts: Options): Promise<Outcome> {
  return estimateRun(opts, false);
}

/** G1 + G2 + contact sheets in estimate mode. Starts the voicer for the build to come, unless `noAudio`. */
export function shots(opts: Options): Promise<Outcome> {
  return estimateRun(opts, true);
}

async function estimateRun(opts: Options, sheets: boolean): Promise<Outcome> {
  const sw = stopwatch();
  const { ir, diagnostics } = await sw.time('parse', () => load(opts));
  const outcome = newOutcome(diagnostics);
  outcome.stages = sw.stages;
  if (!ir || !outcome.gates.G1) return finishTimer(outcome, sw);
  const ks = selected(ir, opts);
  // The narration is final once G1 passes (layout cannot change it): voice it now, for the build to find.
  if (!opts.noAudio) await voiceAhead(opts.file, ir, ks);
  const outDir = outDirOf(ir, opts);
  // The page and sheets scratch and the sheets are in the output directory: hold it like a build does.
  const custody = Custody.acquire(outDir);
  try {
    const sweep = custody.sweep();
    const motion = await sw.time('motion', () => loadMotion(ir.meta.theme));
    const plans = estimatePlans(ir, ks, motion, outcome);
    outcome.length = estimatedLength(ir, ks, plans);
    const jobs = opts.jobs ?? (sheets ? undefined : LINT_POOL_SIZE);
    const stage = await sw.time('stage', () => openStage(ir, { jobs, workDir: custody.scratch }));
    try {
      outcome.lint = await sw.time('lint', () => lintAll(stage, ks, plans));
      outcome.gates.G2 = !failing(outcome.lint);
      if (sheets) outcome.sheets = await sw.time('sheets', () =>
        stage.sheets(ks.flatMap(k => plans[k] ?? []), { lint: outcome.lint, audio: {} }, reportPaths(ir, ks, outDir).sheets));
    } finally {
      await stage.close();
    }
    await sweep;
    await custody.clean();   // the sheets are in outDir; this invocation's scratch has nothing left to show
  } finally {
    custody.release();
  }
  outcome.ok = outcome.gates.G2 && outcome.gates.timing;
  return finishTimer(outcome, sw);
}

/**
 * The hidden `voice` command: the detached voicer `check` and `shots` start. It voices the scenes into the
 * voice cache and nothing else, so it takes no custody of the output directory.
 */
export async function voice(opts: Options): Promise<Outcome> {
  const { ir, diagnostics } = load(opts);
  const outcome = newOutcome(diagnostics);
  if (!ir || !outcome.gates.G1) return outcome;
  const voiced = await voiceIntoCache(ir, selected(ir, opts));
  outcome.audio = voiced.map(v => ({ scene: v.scene, issues: v.diff.issues })).filter(a => a.issues.length);
  outcome.ok = outcome.gates.G3 = voiced.every(v => v.diff.pass);
  return outcome;
}

/** Each planned scene's estimated length (from its estimate plan, on the global clock) and word count. */
function estimatedLength(ir: Script, ks: number[], plans: ScenePlan[]): Outcome['length'] {
  const planned = ks.filter(k => plans[k]);
  const video = planned.map(k => plans[k]!);
  const scenes = planned.map((k, i) => ({
    scene: k,
    seconds: toGlobal(video, i + 1, 0) - toGlobal(video, i, 0),
    words: ir.scenes[k]!.beats.reduce((n, b) => n + b.words.length, 0),
  }));
  return { scenes, seconds: toGlobal(video, video.length, 0), words: scenes.reduce((n, s) => n + s.words, 0) };
}

function finishTimer(outcome: Outcome, sw: ReturnType<typeof stopwatch>): Outcome {
  sw.total();
  outcome.stages = sw.stages;
  return outcome;
}

/**
 * Full build (§8). Writes build.json next to the outputs, whatever the gates say, and on an exception too.
 *
 * Custody (`Custody`) of the output directory is taken before anything is written there and held until the
 * last write: withdrawal of earlier outputs, voicing scratch, capture, publication, scratch cleanup, rollback
 * and build.json. A directory held by another build is left untouched (R700).
 */
export async function build(opts: Options): Promise<Outcome> {
  const sw = stopwatch();
  const { ir, diagnostics } = await sw.time('parse', () => load(opts));
  const outcome = newOutcome(diagnostics);
  if (!ir || !outcome.gates.G1) return finishTimer(outcome, sw);
  const ks = selected(ir, opts);
  const outDir = outDirOf(ir, opts);
  const { record } = reportPaths(ir, ks, outDir);
  const custody = Custody.acquire(outDir);
  try {
    // The owner's first act: an earlier build's MP4, HTML or .srt must never pass for this build's.
    await withdrawOutputs(custody, ir, ks, outDir);
    // Scratch left by builds that died (and any writer they orphaned) goes; this build never shares it.
    const sweep = custody.sweep();
    try {
      await runBuild(ir, ks, outDir, opts, outcome, sw, custody);
      await sweep;
      // The success record is part of success: if it cannot be written, the build rolls back like any failure.
      await writeRecord(outcome, sw, record);
    } catch (e) {
      await sweep.catch(() => {});
      // Still the owner: whatever this build published goes too, and build.json records the failure.
      await withdrawOutputs(custody, ir, ks, outDir);
      outcome.ok = false;
      outcome.error = e instanceof Error ? e.message : String(e);
      // Best effort: the original failure is the one to report. If even the failure record cannot be written,
      // no older record may remain to describe this directory.
      await writeRecord(outcome, sw, record).catch(() => rm(record, { force: true }).catch(() => {}));
      throw e;
    }
    return outcome;
  } finally {
    custody.release();
  }
}

/** build.json at `buildJson`, replaced atomically (written beside it, then renamed): a reader never sees half a record. */
async function writeRecord(outcome: Outcome, sw: ReturnType<typeof stopwatch>, buildJson: string): Promise<void> {
  finishTimer(outcome, sw);
  const tmp = `${buildJson}.${process.pid}.tmp`;
  try {
    await Bun.write(tmp, JSON.stringify(buildRecord(outcome), null, 2) + '\n');
    await rename(tmp, buildJson);
  } catch (e) {
    await rm(tmp, { force: true });
    throw e;
  }
  outcome.outputs.build = buildJson;
}

/** The build proper, under custody. Every task it starts has settled when it returns or throws. */
async function runBuild(ir: Script, ks: number[], outDir: string, opts: Options, outcome: Outcome, sw: ReturnType<typeof stopwatch>, custody: Custody): Promise<void> {
  const workDir = custody.scratch;
  outcome.scenes = ks.map(scene => ({ scene }));
  const report = (k: number) => outcome.scenes.find(s => s.scene === k)!;

  // Voicing starts first: it is the long pole, and it runs even if layout fails so the cache warms.
  const voiceStart = performance.now();
  const voicing = ks.map(async k => {
    const scene = ir.scenes[k]!;
    const t0 = performance.now();
    const v = opts.noAudio ? estimateVoice(scene) : await voiceScene(scene, ir, { revoice: opts.revoice?.includes(k), workDir: join(workDir, 'voice') });
    Object.assign(report(k), { voiceMs: Math.round(performance.now() - t0), attempts: v.attempts, stt: v.stt, audioPass: v.diff.pass, wer: v.diff.wer });
    return v;
  });
  const voicedAll = settled(voicing).then(vs => { sw.stages.voice = Math.round(performance.now() - voiceStart); return vs; });
  voicedAll.catch(() => {});   // observed below; a setup error must not surface as an unhandled rejection first
  try {
    await renderAll();
  } finally {
    await Promise.allSettled(voicing);   // no voicing writer outlives the build
  }

  async function renderAll(): Promise<void> {
    const motion = await sw.time('motion', () => loadMotion(ir.meta.theme));
    const stage = await sw.time('stage', () => openStage(ir, { jobs: opts.jobs, workDir }));
    let exported: Exported | undefined;
    try {
      outcome.lint = await sw.time('lint', () => lintAll(stage, ks, estimatePlans(ir, ks, motion, outcome)));
      outcome.gates.G2 = !failing(outcome.lint);
      outcome.timing = [];          // estimate-time errors recur with real timing; report the final ones
      outcome.gates.timing = true;
      const captureAllowed = !opts.noVideo && (outcome.gates.G2 || !!opts.force);

      const plans: ScenePlan[] = [];
      const voiced: VoicedScene[] = [];
      const segments: Segment[] = [];
      const renderStart = performance.now();
      const planning = ks.map(async (k, i) => {
        const v = await voicing[i]!;
        voiced[k] = v;
        const p = plan(ir, k, v, motion, outcome);
        if (p) plans[k] = p;
        return p;
      });
      const rendered = ks.map(async (k, i) => {
        const p = await planning[i];
        if (!p || !captureAllowed || !(voiced[k]!.diff.pass || opts.force)) return;
        const seg = await stage.renderScene(k, p);
        segments[k] = seg;
        Object.assign(report(k), { frames: seg.frames, uniqueFrames: seg.uniqueFrames, captureMs: Math.round(seg.captureMs), encodeMs: Math.round(seg.encodeMs), cached: seg.cached });
      });
      const rendering = settled(rendered).then(() => { sw.stages.voiceAndRender = Math.round(performance.now() - renderStart); });
      rendering.catch(() => {});   // observed below
      try {
        // Export and sheets need only the plans, lint and audio: they start once every scene is planned and
        // run beside capture; the MP4 alone waits for the segments.
        await settled(planning);
        await voicedAll;
        outcome.audio = ks.map(k => ({ scene: k, issues: voiced[k]!.diff.issues })).filter(a => a.issues.length);
        outcome.gates.G3 = ks.every(k => voiced[k]!.diff.pass);
        outcome.ok = outcome.gates.G2 && outcome.gates.G3 && outcome.gates.timing;

        let exporting: Promise<Exported | undefined> = Promise.resolve(undefined);
        if (ks.every(k => plans[k])) {
          // Then the gates passed (or are forced), so every scene is being captured; a failed capture fails the build.
          const videoReady = !opts.noVideo && (outcome.ok || !!opts.force);
          outcome.forced = videoReady && !outcome.ok;
          exporting = sw.time('export', () => stage.export({
            plans: ks.map(k => plans[k]!),
            voiced: ks.map(k => voiced[k]!),
            segments: videoReady ? rendering.then(() => ks.map(k => segments[k]!)) : undefined,
            outDir,
          }));
        }
        const sheeting = sw.time('sheets', () => stage.sheets(ks.flatMap(k => plans[k] ?? []), {
          lint: outcome.lint,
          audio: Object.fromEntries(ks.map(k => [k, voiced[k]!.diff.issues])),
        }, reportPaths(ir, ks, outDir).sheets));
        await settled<unknown>([rendering, exporting, sheeting]);
        exported = await exporting;
        outcome.sheets = await sheeting;
        if (exported) outcome.outputs = { ...exported };
      } finally {
        await Promise.allSettled(rendered);   // no capture or encode outlives the stage
      }
    } finally {
      await stage.close();
    }
    if (outcome.ok && exported && !opts.keep) await custody.clean();
  }
}

/** build.json (§8): gates and issues, per-stage wall times, frames, per-scene attempts and STT provider. */
function buildRecord(o: Outcome) {
  const frames = o.scenes.reduce((n, s) => n + (s.frames ?? 0), 0);
  const unique = o.scenes.reduce((n, s) => n + (s.uniqueFrames ?? 0), 0);
  return {
    ok: o.ok, forced: o.forced, gates: o.gates, stages: o.stages,
    frames: { total: frames, unique, uniqueRatio: frames ? +(unique / frames).toFixed(4) : 0 },
    scenes: o.scenes, outputs: o.outputs, sheets: o.sheets, ...(o.error ? { error: o.error } : {}),
    issues: { schema: o.diagnostics, layout: o.lint, timing: o.timing, audio: o.audio },
  };
}
