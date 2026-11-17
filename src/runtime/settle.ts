/**
 * Settled states, without timing (§3.2). A settled state is what the frame shows once every change from
 * the cues so far has finished: it needs only the IR, never a plan. It gives
 * - each scene's base state at S = 0 (entry state: reused blocks start from their previous placement's
 *   final settled state; hl/now/recede still hold the outgoing values the scene change resets),
 * - the state after the first n cues (`settle(k, n)`: lint, contact sheets, the dev harness).
 *
 * The highlight model is applied symbolically here (theme rule 8): `hl` is exclusive per block; each block's
 * now target is its last takes-now target of the latest instant that acts on it; a `set` target has settled.
 */
import type { Cue, Id, Inline, Scene, Script, Target } from '../ir.ts';
import type { BlockState, Channels, ItemState } from '../blocks/contract.ts';
import { VERBS } from '../verbs.ts';
import type { SceneState } from './state.ts';

/** The marker names of a block (from its module), in order. */
export type MarkerNames = (block: Id) => string[];

/** One cue instant: the cues that fire together (a beat's start cues, or one anchor word's cues). */
export interface Instant { beat: number; from: number; to: number }

/** A scene's cues in firing order, and how they group into instants. */
export interface SceneCues { cues: Cue[]; instants: Instant[] }

export function sceneCues(scene: Scene): SceneCues {
  const cues: Cue[] = [];
  const instants: Instant[] = [];
  const add = (beat: number, cs: Cue[]) => {
    if (!cs.length) return;
    instants.push({ beat, from: cues.length, to: cues.length + cs.length });
    cues.push(...cs);
  };
  scene.beats.forEach((b, i) => {
    add(i, b.startCues);
    b.words.forEach(w => add(i, w.cues));
  });
  return { cues, instants };
}

const clone = (s: SceneState): SceneState => structuredClone(s);
const RESET: (keyof Channels)[] = ['hl', 'now', 'recede'];

export class Settler {
  private finals = new Map<number, SceneState>();
  private bases = new Map<number, SceneState>();

  constructor(private ir: Script, private markerNames: MarkerNames) {}

  /** Scene k at S = 0, before any span: the base `stateAt` evaluates spans over. */
  base(k: number): SceneState {
    const hit = this.bases.get(k);
    if (hit) return hit;
    const scene = this.ir.scenes[k]!;
    const blocks: Record<Id, BlockState> = {};
    for (const p of scene.placements) {
      const decl = this.ir.blocks[p.block]!;
      const vis = scene.initialVis[p.block];
      const prev = p.reused ? this.previous(k, p.block) : undefined;
      const selfVis = vis ? (vis.self ? 1 : 0) : 1;
      const st: BlockState = {
        self: { vis: selfVis, hl: 0, now: 0, recede: 0, grow: selfVis },
        items: {},
        markers: {},
        groups: (scene.reachable[p.block]?.groups ?? []).map(g => ({ ...g, vis: 0 })),
      };
      if (prev) for (const ch of RESET) st.self[ch] = prev.self[ch];
      for (const it of decl.items) {
        const v = vis?.items[it.key] ?? true ? 1 : 0;
        const item: ItemState = { vis: v, hl: 0, now: 0, recede: 0, grow: v };
        const was = prev?.items[it.key];
        if (was) {
          for (const ch of RESET) item[ch] = was[ch];
          if (was.content) item.content = was.content;
          if (was.value !== undefined) item.value = was.value;
          if (was.at !== undefined) item.at = was.at;
        }
        st.items[it.key] = item;
      }
      if (prev?.self.content) st.self.content = prev.self.content;
      this.markerNames(p.block).forEach((name, i) => {
        st.markers[name] = prev?.markers[name] ? { ...prev.markers[name]! } : { at: i + 1, vis: 0, now: 0 };
      });
      const pair = scene.swapSlots.find(s => s.includes(p.block));
      if (pair) st.swap = { with: pair[0] === p.block ? pair[1] : pair[0], p: 0 };
      blocks[p.block] = st;
    }
    const base = { blocks, scene: k === 0 ? 1 : 0 };
    this.bases.set(k, base);
    return base;
  }

  /** Scene k settled after its first `n` cues (all scene-change resets complete). */
  settle(k: number, n: number): SceneState {
    const s = clone(this.base(k));
    s.scene = 1;
    for (const b of Object.values(s.blocks)) {
      for (const ch of RESET) b.self[ch] = 0;
      for (const it of Object.values(b.items)) for (const ch of RESET) it[ch] = 0;
      for (const m of Object.values(b.markers)) m.now = 0;
    }
    const { cues, instants } = sceneCues(this.ir.scenes[k]!);
    for (const ins of instants) {
      if (ins.from >= n) break;
      const upto = Math.min(ins.to, n);
      for (let i = ins.from; i < upto; i++) this.apply(s, cues[i]!);
      this.takeNow(s, cues.slice(ins.from, upto));
    }
    return s;
  }

  /** Scene k's final settled state. */
  final(k: number): SceneState {
    const hit = this.finals.get(k);
    if (hit) return hit;
    const f = this.settle(k, sceneCues(this.ir.scenes[k]!).cues.length);
    this.finals.set(k, f);
    return f;
  }

  private previous(k: number, block: Id): BlockState | undefined {
    for (let j = k - 1; j >= 0; j--)
      if (this.ir.scenes[j]!.placements.some(p => p.block === block)) return this.final(j).blocks[block];
    return undefined;
  }

  private apply(s: SceneState, cue: Cue): void {
    const blk = (t: Target) => s.blocks[t.block];
    const items = (t: Target): ItemState[] => {
      const b = blk(t);
      if (!b || t.sel.kind !== 'items') return [];
      return t.sel.keys.map(k => b.items[k]).filter((x): x is ItemState => !!x);
    };
    for (const t of cue.targets) {
      const b = blk(t);
      if (!b) continue;
      switch (cue.verb) {
        case 'show': case 'grow': {
          const on = (c: Channels) => { c.vis = 1; c.recede = 0; c.grow = 1; };
          on(b.self);
          if (t.sel.kind === 'items') items(t).forEach(on);
          // A block-level show/grow is its items' first cue too (L1's inference), so it reveals them.
          else if (t.sel.kind === 'block') Object.values(b.items).forEach(on);
          else if (t.sel.kind === 'marker') { const m = b.markers[t.sel.name]; if (m) m.vis = 1; }
          break;
        }
        case 'hide':
          if (t.sel.kind === 'block') b.self.vis = 0;
          else if (t.sel.kind === 'marker') { const m = b.markers[t.sel.name]; if (m) m.vis = 0; }
          else items(t).forEach(it => (it.vis = 0));
          break;
        case 'hl':
          b.self.hl = 0;
          Object.values(b.items).forEach(it => (it.hl = 0));
          if (t.sel.kind === 'block') b.self.hl = 1;
          else items(t).forEach(it => (it.hl = 1));
          break;
        case 'dim':
          if (t.sel.kind === 'block') b.self.recede = 1;
          else items(t).forEach(it => (it.recede = 1));
          break;
        case 'focus':
          for (const [id, o] of Object.entries(s.blocks)) o.self.recede = t.sel.kind === 'none' || id === t.block ? 0 : 1;
          break;
        case 'set': {
          const value = cue.value;
          const put = (c: { content?: { cur: Inline; p: number } ; value?: number }) => {
            c.content = { cur: value, p: 1 };
            const n = numeric(value);
            if (n !== undefined) c.value = n;
          };
          if (t.sel.kind === 'block') put(b.self);
          else items(t).forEach(put);
          break;
        }
        case 'move': {
          const names = Object.keys(b.markers);
          if (t.sel.kind === 'items') { items(t).forEach(it => (it.at = cue.to)); break; }
          if (t.sel.kind === 'marker') { const m = b.markers[t.sel.name]; if (m) { m.at = cue.to; m.vis = 1; } }
          else if (names.length) {
            const delta = cue.to - b.markers[names[0]!]!.at;
            for (const n of names) { const m = b.markers[n]!; m.at += delta; m.vis = 1; }
          }
          break;
        }
        case 'group': {
          const g = b.groups.find(x => x.id === cue.groupId);
          if (g) g.vis = 1;
          break;
        }
        case 'swap':
          break;
      }
    }
    if (cue.verb === 'swap') {
      const [out, inn] = cue.targets;
      const a = s.blocks[out.block], b = s.blocks[inn.block];
      if (out.sel.kind === 'block' && a && b) {
        a.self.vis = 0; b.self.vis = 1; b.self.recede = 0;
        if (a.swap) a.swap.p = 1;
        if (b.swap) b.swap.p = 0;
      } else if (a && out.sel.kind === 'items' && inn.sel.kind === 'items') {
        const x = out.sel.keys[0]!, y = inn.sel.keys[0]!;
        const ix = a.items[x], iy = a.items[y];
        if (ix && iy) { ix.swap = { with: y, p: 1 }; iy.swap = { with: x, p: 1 }; }
      }
    }
  }

  /**
   * Rule 8: "now" is per block. In each block the instant's last hl/set/move target (the block visible) becomes
   * now and the block's old now drops; other blocks keep theirs. A set has settled; `[hl none]` clears.
   */
  private takeNow(s: SceneState, cues: Cue[]): void {
    const latest = new Map<Id, { cue: Cue; target: Target }>();
    for (const cue of cues) {
      if (!VERBS[cue.verb].takesNow) continue;
      for (const target of cue.targets) {
        const b = s.blocks[target.block];
        if (b && (target.sel.kind === 'none' || b.self.vis !== 0)) latest.set(target.block, { cue, target });
      }
    }
    for (const [block, { cue, target }] of latest) {
      const b = s.blocks[block]!;
      b.self.now = 0;
      Object.values(b.items).forEach(it => (it.now = 0));
      Object.values(b.markers).forEach(m => (m.now = 0));
      if (cue.verb === 'set' || target.sel.kind === 'none') continue;   // a set settles; hl none clears
      if (target.sel.kind === 'block') {
        const first = Object.values(b.markers)[0];
        if (cue.verb === 'move' && first) first.now = 1; else b.self.now = 1;
      } else if (target.sel.kind === 'marker') {
        const m = b.markers[target.sel.name]; if (m) m.now = 1;
      } else {
        target.sel.keys.forEach(k => { const it = b.items[k]; if (it) it.now = 1; });
      }
    }
  }
}

/** A `set` value that is a plain number drives a chart's animated value. */
function numeric(v: Inline): number | undefined {
  if (v.length !== 1 || typeof v[0] !== 'string') return undefined;
  const n = Number(v[0].trim());
  return v[0].trim() !== '' && Number.isFinite(n) ? n : undefined;
}
