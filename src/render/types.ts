/**
 * The page and renderer seam (§6). Two halves:
 * - `LecternPage` (`window.lectern`, built by `src/runtime/page.ts`) hides layout, lint, SceneEntry and
 *   state evaluation inside the browser.
 * - `Stage` hides Chrome, the page pool, the capture format and ffmpeg from the orchestrator.
 *
 * Seam 5 (§11.1). Alternative considered: one global `render(t)` driven sequentially. It lost because it
 * allows no parallelism, and scene-entry state would live implicitly in render history (Sol #5).
 */
import type { Id, Loc, Script } from '../ir.ts';
import type { BlockLintIssue, Rect } from '../blocks/contract.ts';
import type { ScenePlan } from '../timing/types.ts';
import type { AudioIssue, VoicedScene } from '../audio/types.ts';

/** A layout finding (L4xx), placed on the script and on the stage. */
export interface LintIssue extends BlockLintIssue {
  scene: number;
  /** The beat (0-based, the contact sheet's B label) whose settled state first shows it; 0 for load-time checks. */
  beat: number;
  /** The script line to edit: the cue that drew the state, else the block's placement line, else the beat's paragraph. */
  loc: Loc;
  block?: Id;
  severity: 'error' | 'warning';
}

/** Frozen per-scene geometry, computed once at page load. Stage CSS px (1280×720). */
export interface SceneLayout {
  /** Largest per-region text scale applied to a sparse frame (§3.3 step 4); 1 = none. Regions scale independently. */
  scale: number;
  blocks: Record<Id, Rect>;
}
export type Layouts = SceneLayout[];

/**
 * `window.lectern` in the page. Scenes are indexed as in the IR; times are S seconds.
 * Deterministic: what `render(k, t)` draws depends only on IR, layouts, SceneEntry, the scene's plan and t.
 */
export interface LecternPage {
  /** Resolves after fonts, every scene's layout, and SceneEntry are ready. */
  ready: Promise<void>;
  layouts(): Layouts;
  /** Give scene k its plan. Required before `render(k, …)`. */
  plan(k: number, p: ScenePlan): void;
  /** Draw scene k at scene time t. Idempotent and independent of any earlier call. */
  render(k: number, t: number): void;
  /** Draw scene k's settled state after its first `cueCount` cues; timing-independent. */
  settle(k: number, cueCount: number): void;
  /** Layout findings and geometric lint at the initial state and every cue instant's settled state. */
  lint(k: number): LintIssue[];
}

declare global {
  interface Window { lectern: LecternPage }
}

/** One encoded scene. Its frame count was verified against `plan.frames` (else R701 rejects). */
export interface Segment {
  scene: number;
  /** Absolute path of the scene's video-only MP4. */
  path: string;
  frames: number;
  uniqueFrames: number;
  captureMs: number;
  encodeMs: number;
  /** Reused from an earlier build (render cache). */
  cached?: boolean;
}

export interface StageOptions {
  /** Parallel pages; the default is the calibrated pool size. */
  jobs?: number;
  /** Scratch directory for frames, segments and sheets work (`.work/`). */
  workDir: string;
}

/** Notes drawn on contact-sheet tiles besides lint: audio warnings per scene. */
export interface SheetNotes { lint: LintIssue[]; audio: Record<number, AudioIssue[]> }

/**
 * What the final outputs need. `segments` is absent when the video is withheld; while they are still
 * rendering, the narration, HTML and .srt are made meanwhile.
 */
export interface ExportInput {
  plans: ScenePlan[];
  voiced: VoicedScene[];
  segments?: Segment[] | Promise<Segment[]>;
  outDir: string;
}

/** Paths written. `mp4` is absent when no segments were given. */
export interface Exported { mp4?: string; html: string; srt: string }

/** The renderer: a loaded page pool for one script. Safe to call for different scenes concurrently. */
export interface Stage {
  readonly layouts: Layouts;
  /** Gate G2 for scene k: lint checks settled states only, so it needs no plan. */
  lint(k: number): Promise<LintIssue[]>;
  /** Capture `plan.capture` and encode scene k. */
  renderScene(k: number, plan: ScenePlan): Promise<Segment>;
  /** Write contact sheets (§7) into `dir`, replacing the sheets there; returns their paths in order. */
  sheets(plans: ScenePlan[], notes: SheetNotes, dir: string): Promise<string[]>;
  /** Narration, mux, .srt and the step-through HTML. */
  export(input: ExportInput): Promise<Exported>;
  /** End the browsers (killed: nothing they hold is kept). */
  close(): Promise<void>;
}

/** Bundle the page (runtime, blocks, theme, IR), open the pool, and wait for `ready`. */
export type OpenStage = (ir: Script, opts: StageOptions) => Promise<Stage>;
