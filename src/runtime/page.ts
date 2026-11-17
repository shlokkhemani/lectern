/**
 * The page (§6): builds `window.lectern` from the IR embedded in the document. It mounts every scene's
 * blocks once, lays each scene out, computes SceneEntry, and then draws any (scene, time) on demand.
 * It knows nothing about block types: blocks come from the registry through the BlockModule contract.
 *
 * Drawing scene k at t: state = stateAt(plan spans, entry base, t). During the scene crossfade the
 * previous scene's final settled frame sits underneath, and scene k (on an opaque --bg layer) fades in
 * over it, so carried-over blocks that did not change look perfectly still.
 *
 * Subtitles are burned in: `render(k, t)` draws scene k's cue at t (timing's `subtitles`, the .srt's cues)
 * in the band every scene reserves under its body. One line element on the stage, outside the scenes, so the
 * crossfade never fades it; it changes only when the cue does. Settled frames (lint, dev) show none.
 */
import type { Id, Inline, Script } from '../ir.ts';
import type { Rect } from '../blocks/contract.ts';
import type { LecternPage, Layouts, LintIssue, SceneLayout } from '../render/types.ts';
import type { ScenePlan, Span } from '../timing/types.ts';
import { BLOCKS } from '../blocks/registry.ts';
import { h, inline, plain as plainText } from '../blocks/kit.ts';
import { indexSpans, stateAt, type SceneState, type SpanIndex } from './state.ts';
import { Settler } from './settle.ts';
import { layoutScene, type Mounted } from './layout.ts';
import { sceneEntries, type SceneEntry } from './boundary.ts';
import { lintScene, placed } from './lint.ts';
import { tok } from './theme.ts';
import { cueAt, subtitles, type Cue } from '../timing/subtitles.ts';

const EMPTY = { self: [], items: {}, groups: [] };

interface SceneDom { el: HTMLElement; blocks: Map<Id, Mounted>; bodyTop: number; issues: LintIssue[]; layout: SceneLayout }

export function createPage(ir: Script, stage: HTMLElement): LecternPage & { entry(k: number): SceneEntry; drawState(k: number, s: SceneState): void } {
  const markerNames = (id: Id) => {
    const d = ir.blocks[id]!;
    return BLOCKS[d.type]?.markers?.(d.body, d.args) ?? [];
  };
  const settler = new Settler(ir, markerNames);
  const scenes: SceneDom[] = ir.scenes.map(scene => mountScene(ir, scene.index, stage));
  const plans = new Map<number, { plan: ScenePlan; index: SpanIndex; cues: Cue[] }>();
  const sub = h('div', 'x-sub', stage);
  let entries: SceneEntry[] = [];

  const ready = (async () => {
    await Promise.all(['Geist', 'Geist Mono'].flatMap(f => [400, 500, 600].map(w => document.fonts.load(`${w} ${tok("--text-meta")}px "${f}"`))));
    await document.fonts.ready;
    scenes.forEach((s, k) => {
      s.el.style.display = 'block';
      const { layout, issues } = layoutScene(ir.scenes[k]!, s.blocks, s.el, s.bodyTop);
      s.layout = layout;
      s.issues = issues.map(i => placed(ir.scenes[k]!, i));
      for (const m of s.blocks.values()) m.rt.geometry?.(m.el);
      s.el.style.display = 'none';
    });
    entries = sceneEntries(ir, settler);
  })();

  /** Draw a full state of scene k (and, mid-crossfade, the previous scene's final frame underneath). */
  function drawState(k: number, st: SceneState): void {
    sub.textContent = '';
    scenes.forEach((s, j) => { s.el.style.display = j === k || (j === k - 1 && st.scene < 1) ? 'block' : 'none'; });
    if (k > 0 && st.scene < 1) {
      const prev = scenes[k - 1]!;
      prev.el.style.opacity = '1';
      paint(prev, entries[k]!.outgoing!);
    }
    scenes[k]!.el.style.opacity = String(Math.round(st.scene * 10000) / 10000);
    paint(scenes[k]!, st);
  }

  function paint(s: SceneDom, st: SceneState): void {
    for (const [id, m] of s.blocks) {
      const b = st.blocks[id];
      if (b) m.rt.render(m.el, b);
    }
  }

  function planned(k: number) {
    const p = plans.get(k);
    if (!p) throw new Error(`lectern: scene ${k} has no plan; call plan(${k}, p) first`);
    return p;
  }

  return {
    ready,
    layouts: (): Layouts => scenes.map(s => s.layout),
    plan(k, p) { plans.set(k, { plan: p, index: indexSpans(withResets(ir, k, p.spans, settler)), cues: subtitles(ir.scenes[k]!, p) }); },
    render(k, t) {
      const { index, cues } = planned(k);
      const base = renderBase(entries[k]!.entry, ir, k, index);
      drawState(k, stateAt(index, base, t));
      sub.textContent = cueAt(cues, t)?.lines.join('\n') ?? '';
    },
    settle(k, n) { drawState(k, settler.settle(k, n)); },
    lint(k) {
      const s = scenes[k]!;
      const all = [...s.issues, ...lintScene({ scene: ir.scenes[k]!, sceneEl: s.el, blocks: s.blocks, draw: n => drawState(k, settler.settle(k, n)) })];
      // An overfull scene (L410) reports only its overflow: everything else found in it may be a side effect (a
      // collision, text pushed off the box or squeezed), and the L410 says what to fix.
      return all.some(i => i.code === 'L410') ? all.filter(i => i.code === 'L410') : all;
    },
    entry: k => entries[k]!,
    drawState,
  };
}

/** S = 0 state for `render`: the entry base with the scene's own crossfade still to run. */
function renderBase(entry: SceneState, ir: Script, k: number, index: SpanIndex): SceneState {
  const base = structuredClone(entry);
  base.scene = k > 0 && index.scene.length ? 0 : 1;
  for (const p of ir.scenes[k]!.placements) {
    if (!p.reused) continue;
    const b = base.blocks[p.block]!;
    b.self.hl = b.self.now = b.self.recede = 0;
    for (const it of Object.values(b.items)) it.hl = it.now = it.recede = 0;
    for (const m of Object.values(b.markers)) m.now = 0;
  }
  return base;
}

/**
 * Scene-change resets for reused blocks (§1.5): hl/now/recede fall from their outgoing values to 0 with
 * the crossfade's timing. Only the page knows outgoing values, so it writes these spans itself and drops
 * any reset spans in the plan that would start from a guess.
 */
function withResets(ir: Script, k: number, spans: Span[], settler: Settler): Span[] {
  const scene = ir.scenes[k]!;
  const fade = spans.find(s => s.channel === 'scene');
  const reused = new Set(scene.placements.filter(p => p.reused).map(p => p.block));
  if (!fade || !reused.size) return spans;
  const isReset = (s: Span) => reused.has(s.block) && s.t0 === fade.t0 && s.to === 0 && (s.channel === 'hl' || s.channel === 'now' || s.channel === 'recede');
  const resets: Span[] = [];
  const base = settler.base(k);
  for (const id of reused) {
    const b = base.blocks[id]!;
    const add = (item: string | undefined, channel: 'hl' | 'now' | 'recede', from: number) => {
      if (from) resets.push({ block: id, ...(item !== undefined ? { item } : {}), channel, t0: fade.t0, t1: fade.t1, from, to: 0, ease: fade.ease });
    };
    for (const ch of ['hl', 'now', 'recede'] as const) add(undefined, ch, b.self[ch]);
    for (const [key, it] of Object.entries(b.items)) for (const ch of ['hl', 'now', 'recede'] as const) add(key, ch, it[ch]);
    for (const [name, m] of Object.entries(b.markers)) add(name, 'now', m.now);
  }
  return [...resets, ...spans.filter(s => !isReset(s))];
}

function mountScene(ir: Script, k: number, stage: HTMLElement): SceneDom {
  const scene = ir.scenes[k]!;
  const el = h('div', 'x-scene', stage);
  el.dataset.scene = String(k);
  el.style.display = 'block';
  let bodyTop = tok('--margin-y');
  const title = scene.headline ?? (scene.chapter ? [scene.chapter.text] as Inline : undefined);
  if (title) {
    const head = h('div', 'x-head', el);
    head.dataset.leaf = '';
    if (scene.chapter) h('span', 'x-head-n', head).textContent = String(scene.chapter.n).padStart(2, '0');
    inline(h('span', 'x-head-t', head), title);
    const chrome = [ir.meta.series, scene.headline && scene.chapter && plainText(scene.headline) !== scene.chapter.text ? scene.chapter.text : undefined].filter(Boolean).join(' · ');
    if (chrome) {
      const c = h('div', 'x-chrome', el);
      c.textContent = chrome;
      c.dataset.leaf = '';
    }
    bodyTop = head.offsetTop + head.offsetHeight;
  }
  const blocks = new Map<Id, Mounted>();
  for (const p of scene.placements) {
    const decl = ir.blocks[p.block]!;
    const mod = BLOCKS[decl.type];
    if (!mod) throw new Error(`lectern: no block module for type "${decl.type}"`);
    const wrap = h('div', 'x-blk', el);
    wrap.dataset.block = p.block;
    wrap.dataset.type = decl.type;
    mod.runtime.mount(wrap, decl.body, decl.args, scene.reachable[p.block] ?? EMPTY, decl.caption);
    blocks.set(p.block, { id: p.block, el: wrap, rt: mod.runtime as Mounted['rt'], flexible: mod.flexible });
  }
  el.style.display = 'none';
  return { el, blocks, bodyTop, issues: [], layout: { scale: 1, blocks: {} as Record<Id, Rect> } };
}

/** Stage stylesheet: the stage, scenes, headline and chrome. Animations and transitions are disabled. */
export const STAGE_CSS = `
*, *::before, *::after { box-sizing: border-box; animation: none !important; transition: none !important; }
html, body { margin: 0; background: var(--bg); }
#stage { position: relative; width: var(--stage-w); height: var(--stage-h); overflow: hidden; background: var(--bg);
  color: var(--ink-1); font-family: var(--font-sans); font-variant-numeric: var(--numeric);
  -webkit-font-smoothing: antialiased; text-rendering: geometricPrecision; }
.x-scene { position: absolute; inset: 0; background: var(--bg); }
.x-head { position: absolute; left: var(--margin-x); top: var(--margin-y); display: flex; gap: var(--space-4);
  font-size: var(--text-headline); line-height: var(--leading-tight); font-weight: var(--weight-strong);
  letter-spacing: var(--headline-tracking); white-space: nowrap; }
.x-head-n { color: var(--ink-3); font-weight: var(--weight-medium); }
.x-chrome { position: absolute; right: var(--margin-x); top: var(--margin-y); font-size: var(--text-meta);
  line-height: calc(var(--text-headline) * var(--leading-tight)); color: var(--ink-3); white-space: nowrap; }
.x-row { position: absolute; }
/* The burned-in subtitle: bottom centre in the band under the body, quiet and legible, no box. */
.x-sub { position: absolute; left: var(--margin-x); right: var(--margin-x); bottom: calc(var(--margin-y) / 2);
  text-align: center; white-space: pre-line; color: var(--ink-1);
  font: var(--weight-regular) var(--text-body) / var(--leading-tight) var(--font-sans); }
/* The runtime places and scales blocks (each region its own scale); block CSS never overrides it. */
.x-row > .x-blk { position: absolute; transform-origin: 0 0; }
`;
