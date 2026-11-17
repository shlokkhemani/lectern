/**
 * The renderer behind `Stage` (§6): a pool of pages on one pinned Chrome, scene capture and segment encode,
 * then narration, mux, .srt, the step-through HTML and contact sheets.
 */
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import type { Browser } from 'puppeteer-core';
import type { Script } from '../ir.ts';
import type { ScenePlan } from '../timing/types.ts';
import type { ExportInput, Exported, Layouts, LintIssue, OpenStage, Segment, Stage, StageOptions } from './types.ts';
import { killChrome, launchChrome } from './chrome.ts';
import { Pool, evaluate } from './pool.ts';
import { CAPTURE, captureScene, drawnDigest } from './capture.ts';
import { encodeSegment } from './encode.ts';
import { cacheKey, reuse } from './cache.ts';
import { segmentMedia } from '../timing/media.ts';
import { writeNarration } from './narration.ts';
import { mux } from './mux.ts';
import { srt } from './srt.ts';
import { writeSheets } from './sheets.ts';
import { settled } from './settled.ts';
import type { Custody } from './custody.ts';
import { bundle, embedJson, pageHtml } from '../runtime/html.ts';

/** Pool size and pages per browser process, locked by calibration (docs/render-calibration.md). */
const POOL_SIZE = 6;
const PAGES_PER_BROWSER = 2;
/**
 * The pool for `check`: one browser. Every page lays out every scene at load, and lint is 20-50 ms of work,
 * so more pages only add load time (check 0.61 → 0.41 s on gradient, all S2b changes in).
 */
export const LINT_POOL_SIZE = PAGES_PER_BROWSER;
/**
 * Captures per pool job. Small, so the pool drains evenly at the end of a build, and a scene captured alone (its
 * voice came last, or a one-scene build) spreads over every page: 32 → 8 measured 0.2-0.25 s faster warm.
 */
const CHUNK = 8;
/** Runs per digest job: a run costs ~1 ms to draw and read back, against ~30 ms to screenshot. */
const DIGEST_CHUNK = 64;

/** [from, to) chunks of `size` covering `n`. */
const spans = (n: number, size: number) => Array.from({ length: Math.ceil(n / size) }, (_, i) => [i * size, Math.min(n, (i + 1) * size)] as const);
/**
 * Segment encodes in flight; each encode is itself multi-threaded. With VFR an encode is 0.6-2.6 s even for a
 * 200-image scene, and capture is the critical path: warm part 8 at 2, 3 and 6 encodes measured 13.3, 13.5 and
 * 13.1-13.6 s (noise), so this stays low to leave the cores to Chrome.
 */
const ENCODES = Math.max(1, Math.min(3, Math.floor(os.availableParallelism() / 4)));

class Limit {
  private active = 0;
  private queue: (() => void)[] = [];
  constructor(private n: number) {}
  async run<T>(job: () => Promise<T>): Promise<T> {
    if (this.active >= this.n) await new Promise<void>(r => this.queue.push(r));
    this.active++;
    try { return await job(); } finally { this.active--; this.queue.shift()?.(); }
  }
}

export const openStage: OpenStage = (ir, opts) => launchStage(ir, pageHtml(ir), opts, stepThroughPage(ir));

/**
 * The step-through HTML around the given data: the page plus the player. A player that fails to bundle
 * fails the export; an HTML without it would not play, scrub or step.
 */
function stepThroughPage(ir: Script): (data: string) => Promise<string> {
  return async data => {
    const js = await bundle('player');
    // In its own function scope: both bundles are minified classic scripts, and the player's top-level names
    // (o, D, …) would otherwise overwrite the page's globals of the same name.
    return pageHtml(ir, { after: `${data}<script>(() => {\n${js.replace(/<\/script/gi, '<\\/script')}\n})();</script>` });
  };
}

/** A run over a subset of the scenes names everything it writes with `.s<first>-<last>`; a full run, nothing. */
const subsetSuffix = (ir: Script, scenes: number[]) => (scenes.length < ir.scenes.length ? `.s${scenes[0]}-${scenes[scenes.length - 1]}` : '');

/** The final outputs for `scenes` of `ir` in `outDir`: a subset build gets a `.s<first>-<last>` suffix. */
export function outputPaths(ir: Script, scenes: number[], outDir: string): { mp4: string; html: string; srt: string } {
  const base = path.join(outDir, `${ir.meta.slug}${subsetSuffix(ir, scenes)}`);
  return { mp4: `${base}.mp4`, html: `${base}.html`, srt: `${base}.srt` };
}

/** The build record and the contact sheets' directory for `scenes`: a subset's sit beside the full run's, never over them. */
export function reportPaths(ir: Script, scenes: number[], outDir: string): { record: string; sheets: string } {
  const subset = subsetSuffix(ir, scenes);
  return { record: path.join(outDir, `build${subset}.json`), sheets: path.join(outDir, `sheets${subset}`) };
}

/**
 * Remove a build target's previous outputs. Only the holder of the directory's custody may: call it first
 * thing after acquiring it, so whatever then happens (a gate, a timing error, an exception) no output from
 * an earlier build can pass for this build's.
 */
export async function withdrawOutputs(custody: Custody, ir: Script, scenes: number[], outDir: string): Promise<void> {
  if (!custody.held || path.resolve(custody.dir) !== path.resolve(outDir)) throw new Error(`withdrawOutputs: custody of ${outDir} is not held`);
  await settled(Object.values(outputPaths(ir, scenes, outDir)).map(f => fs.rm(f, { force: true })));
}

/** Kill every browser; the first failure is thrown once all have settled. */
async function killAll(browsers: Browser[]): Promise<void> {
  await settled(browsers.map(killChrome));
}

/**
 * A stage over any page that implements `window.lectern` (tests and benchmarks pass their own).
 * Chrome launches while `html` is still being built. Each browser keeps its profile in `workDir`.
 * `playerPage` builds the step-through HTML around the given player markup.
 */
async function launchStage(ir: Script, html: string | Promise<string>, opts: StageOptions, playerPage?: (after: string) => Promise<string>): Promise<Stage> {
  const page = Promise.resolve(html);
  page.catch(() => {});   // observed below, once the browsers are accounted for
  const workDir = path.resolve(opts.workDir);
  await fs.mkdir(workDir, { recursive: true });
  const jobs = opts.jobs ?? POOL_SIZE;
  const browsers: Browser[] = [];
  const launches = Array.from({ length: Math.ceil(jobs / PAGES_PER_BROWSER) }, (_, i) => launchChrome(path.join(workDir, `chrome-${i}`)));
  const launched = Promise.allSettled(launches.map(l => l.then(b => browsers.push(b))));
  try {
    const file = path.join(workDir, 'page.html');
    await Bun.write(file, await page);
    await settled(launches);
    const pool = await Pool.open(browsers, `file://${file}`, jobs);
    const layouts = await evaluate<Layouts>(pool.pages[0]!, 'lectern.layouts()');
    return new ChromeStage(ir, browsers, pool, layouts, workDir, new Limit(ENCODES), playerPage);
  } catch (e) {
    await launched;
    await killAll(browsers).catch(() => {});   // the launch failure is the error to report
    throw e;
  }
}

class ChromeStage implements Stage {
  constructor(private ir: Script, private browsers: Browser[], private pool: Pool, readonly layouts: Layouts,
    private workDir: string, private encodes: Limit, private playerPage?: (after: string) => Promise<string>) {}

  lint(k: number): Promise<LintIssue[]> {
    return this.pool.use(p => evaluate<LintIssue[]>(p, `lectern.lint(${k})`));
  }

  /**
   * A segment from an earlier build is reused when this build's page draws every run of the scene the same
   * and the plan places the frames the same (`drawnDigest`, `segmentMedia`); else the scene is captured and
   * encoded, and the checked segment is cached.
   */
  async renderScene(k: number, plan: ScenePlan): Promise<Segment> {
    const t0 = performance.now();
    const out = path.join(this.workDir, 'segments', `s${k}.mp4`);
    await fs.mkdir(path.dirname(out), { recursive: true });
    const drawn = await settled(spans(plan.capture.length, DIGEST_CHUNK).map(([a, b]) =>
      this.pool.use(p => drawnDigest(p, k, plan, a, b), { retry: true })));
    const key = drawn.every((d): d is string => d !== null) ? await cacheKey(JSON.stringify(segmentMedia(plan)), ...drawn) : undefined;
    let t1 = performance.now();
    const make = async () => {
      // A long scene is split into chunks on several pages, so one scene never serialises the pool.
      const dir = path.join(this.workDir, 'frames', `s${k}`);
      const images = (await settled(spans(plan.capture.length, CHUNK).map(([a, b]) =>
        this.pool.use(p => captureScene(p, k, plan, dir, CAPTURE, a, b), { retry: true })))).flat();
      t1 = performance.now();
      await this.encodes.run(() => encodeSegment(images, plan, out));
    };
    const cached = key ? await reuse(key, out, make) : (await make(), false);
    return { scene: k, path: out, frames: plan.frameCount, uniqueFrames: plan.capture.length, captureMs: t1 - t0, encodeMs: performance.now() - t1, cached };
  }

  sheets(plans: ScenePlan[], notes: Parameters<Stage['sheets']>[1], dir: string): Promise<string[]> {
    return writeSheets(this.ir, this.browsers, this.pool, plans, notes, dir, this.workDir);
  }

  /**
   * Everything is built and checked in this build's scratch directory, then published by rename (atomic on
   * one file system). A failure publishes nothing; without segments the gates withheld the video, and an MP4
   * from an earlier forced build is removed.
   */
  async export(input: ExportInput): Promise<Exported> {
    const { plans, voiced, segments, outDir } = input;
    await fs.mkdir(outDir, { recursive: true });
    const target = outputPaths(this.ir, plans.map(p => p.scene), outDir);
    if (!segments) await fs.rm(target.mp4, { force: true });
    const scratch = { mp4: path.join(this.workDir, 'final.mp4'), html: path.join(this.workDir, 'final.html'), srt: path.join(this.workDir, 'final.srt') };
    const m4a = await writeNarration(plans, voiced.map(v => v.wav), this.workDir);
    // Every writer settles before a failure propagates: the caller may then release the scratch directory.
    // The page burns the subtitles into every frame; the .srt is a sidecar for uploads.
    await settled<unknown>([
      Bun.write(scratch.srt, srt(this.ir, plans)),
      this.stepThrough(plans, m4a).then(html => Bun.write(scratch.html, html)),
      segments ? Promise.resolve(segments).then(segs => mux(segs.map(s => s.path), plans, m4a, scratch.mp4, this.workDir)) : Promise.resolve(),
    ]);
    await fs.rename(scratch.html, target.html);
    await fs.rename(scratch.srt, target.srt);
    if (!segments) return { html: target.html, srt: target.srt };
    await fs.rename(scratch.mp4, target.mp4);
    return target;
  }

  /** The page plus the player, the plans and the narration, in one file. */
  private async stepThrough(plans: ScenePlan[], m4a: string): Promise<string> {
    const audio = Buffer.from(await Bun.file(m4a).arrayBuffer()).toString('base64');
    const data = `<script type="application/json" id="lectern-plans">${embedJson(plans)}</script>`
      + `<audio id="lectern-narration" preload="auto" src="data:audio/mp4;base64,${audio}"></audio>`;
    if (!this.playerPage) return data;
    return this.playerPage(data);
  }

  async close(): Promise<void> {
    await killAll(this.browsers);
  }
}
