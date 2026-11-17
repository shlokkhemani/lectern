/**
 * Span compilation (§4.4): a scene's timed cues → the channel spans the page evaluates. This is the one
 * place that turns verb meanings (`src/verbs.ts`) and motion tokens into motion: durations, curves,
 * stagger, `hl` exclusivity, the "now" pointer and `set`'s settle, and T602.
 *
 * Span vocabulary (what the page's `stateAt` reads):
 * - `item` is an item key for vis/hl/now/recede/grow/content/value/swap, a marker name for `marker` and
 *   for a marker's `vis`/`now`, an item key for a mover's `marker` (its position, `Movers`), and a group id
 *   for `group`. Absent = the block itself.
 * - A `scene` span (block '') runs the crossfade for every scene after the first.
 * - `from` is the channel's value at t0 under the scene's base state and earlier spans, so nothing jumps.
 *   It is omitted only where the value lives in the page's entry state (SceneEntry) and nowhere in the IR:
 *   a part's declared content, and a reused block's content and chart values. A reused block's marker and
 *   mover positions are known: they are its previous placement's final positions, replayed from the IR cues
 *   (`enteringMarkers`), exactly as the page's SceneEntry carries them; a mover not yet moved is at `home`.
 * - Scene-change resets of reused blocks (hl/now/recede → 0) are written by the page, which alone knows
 *   the outgoing values; they are not emitted here. The base for those channels is therefore 0.
 * - The page evaluates a part's channel with the latest-starting span (later in the array on ties).
 *   Spans are emitted so that this rule and the compiler's own bookkeeping agree.
 */
import type { BlockDecl, Cue, Id, Inline, Loc, Scene, Target } from '../ir.ts';
import type { Bezier, Channel, EaseToken, MotionTokens } from '../verbs.ts';
import { SCENE_CHANGE, VERBS } from '../verbs.ts';
import type { Span, TimingError } from './types.ts';
import { ease } from './ease.ts';
import { verbDuration } from './motion.ts';
import { BLOCKS } from '../blocks/registry.ts';

/** Cues that fire at one instant, in source order, and the beat they belong to. */
export interface TimedInstant { t: number; beat: number; cues: Cue[] }

export interface Compiled {
  spans: Span[];
  /** Per beat: the latest t1 of the spans its cues produced, or undefined if it has no cues. */
  beatEnd: (number | undefined)[];
}

type Val = number | Inline;
interface Part { block: Id; item?: string }

const keyOf = (block: Id, item: string | undefined, ch: Channel) => `${block}\u0000${item ?? ''}\u0000${ch}`;
const same = (a: Part, b: Part) => a.block === b.block && a.item === b.item;

/** Marker names in order, the first being the one `move <id> n` moves: the block module's own list. */
export const markerNames = (decl: BlockDecl): string[] => BLOCKS[decl.type]?.markers?.(decl.body, decl.args) ?? [];

const homes = new WeakMap<BlockDecl, Readonly<Record<string, number>>>();
/** Where each item the block slides stands as declared (`Movers.home`), by item key. */
function moverHome(decl: BlockDecl): Readonly<Record<string, number>> {
  let h = homes.get(decl);
  if (!h) homes.set(decl, (h = BLOCKS[decl.type]?.movers?.(decl.body, decl.args).home ?? {}));
  return h;
}

/** Stagger offset of the i-th sibling (0-based). */
const staggerAt = (m: MotionTokens, i: number) => Math.min(i, m.staggerMax) * m.stagger;

/**
 * How long a cue's motion lasts from its firing time, from cue structure and tokens alone: the stagger of
 * its parts plus its phases. `span(p)` in the splice map (§4.2) is the longest of a beat's start cues.
 */
export function cueLength(cue: Cue, blocks: Record<Id, BlockDecl>, m: MotionTokens): number {
  const meaning = VERBS[cue.verb];
  // Phases per target block: a `--dur-<verb>-<type>` override lengthens the cue on that block.
  const phases = (block: Id) => meaning.phases.reduce((s, _, i) => s + verbDuration(m, cue.verb, blocks[block]?.type, i), 0);
  let longest = cue.targets.length ? 0 : phases('');
  for (const t of cue.targets) {
    let parts = 1;
    if (meaning.staggered) {
      if (t.sel.kind === 'items') parts = t.sel.keys.length;
      else if (t.sel.kind === 'block' && cue.verb === 'grow') parts = blocks[t.block]?.items.length ?? 1;
    }
    longest = Math.max(longest, staggerAt(m, Math.max(1, parts) - 1) + phases(t.block));
  }
  return longest;
}

/**
 * Compile one scene's instants (ascending t, source order on ties) into spans, or report T602.
 * `entering` holds the marker positions its reused blocks carry in (`enteringMarkers`).
 */
export function compileSpans(scene: Scene, blocks: Record<Id, BlockDecl>, instants: TimedInstant[], m: MotionTokens,
  entering: Map<string, number> = new Map()): Compiled | TimingError[] {
  return new SceneCompiler(scene, blocks, m, entering).run(instants);
}

/** A scene's cues in firing order, one instant each, far enough apart that no motion overlaps. */
function untimed(scene: Scene): TimedInstant[] {
  const out: TimedInstant[] = [];
  scene.beats.forEach((b, beat) => {
    if (b.startCues.length) out.push({ t: out.length * 1e4, beat, cues: b.startCues });
    for (const w of b.words) if (w.cues.length) out.push({ t: out.length * 1e4, beat, cues: w.cues });
  });
  return out;
}

/**
 * The marker positions scene k's reused blocks enter with, keyed like the compiler's channels: each block's
 * final positions in the last earlier scene that placed it. Final positions are timing-independent, so they
 * come from replaying each earlier scene's cues in order through the same compiler (with its own carry-in).
 */
export function enteringMarkers(scenes: Scene[], k: number, blocks: Record<Id, BlockDecl>, m: MotionTokens): Map<string, number> {
  const finals: Map<string, number>[] = [];
  const carryInto = (j: number): Map<string, number> => {
    const into = new Map<string, number>();
    for (const p of scenes[j]!.placements) {
      if (!p.reused) continue;
      for (let i = j - 1; i >= 0; i--) {
        if (!scenes[i]!.placements.some(q => q.block === p.block)) continue;
        for (const [key, v] of finals[i]!) if (key.startsWith(`${p.block}\u0000`)) into.set(key, v);
        break;
      }
    }
    return into;
  };
  for (let j = 0; j < k; j++) {
    const c = new SceneCompiler(scenes[j]!, blocks, m, carryInto(j));
    c.run(untimed(scenes[j]!));
    finals[j] = c.finalMarkers();
  }
  return carryInto(k);
}

class SceneCompiler {
  private spans: Span[] = [];
  private byKey = new Map<string, Span[]>();
  /** The value each channel is heading to (the settled state), for decisions such as exclusivity. */
  private settled = new Map<string, Val>();
  private reused: Set<Id>;
  /** Parts whose `now` may be above 0. */
  private holders: Part[] = [];
  /** `set` targets due to release their `now`. */
  private releases: { part: Part; at: number; beat: number }[] = [];
  /** Per content key: when its running transition ends, and the cue that started it (T602). */
  private contentRuns = new Map<string, { t1: number; loc: Loc }>();
  private errors: TimingError[] = [];
  private beatEnd: (number | undefined)[];
  private beat = 0;

  constructor(private scene: Scene, private blocks: Record<Id, BlockDecl>, private m: MotionTokens,
    private entering: Map<string, number>) {
    this.reused = new Set(scene.placements.filter(p => p.reused).map(p => p.block));
    this.beatEnd = scene.beats.map(() => undefined);
  }

  run(instants: TimedInstant[]): Compiled | TimingError[] {
    if (this.scene.index > 0) {
      const d = this.m.durations[SCENE_CHANGE.duration];
      this.spans.push({ block: '', channel: 'scene', t0: 0, t1: d, from: 0, to: 1, ease: this.m.eases[SCENE_CHANGE.ease] });
    }
    for (const ins of instants) {
      this.flushReleases(ins.t);
      this.beat = ins.beat;
      this.beatEnd[ins.beat] ??= ins.t;
      for (const cue of ins.cues) this.apply(cue, ins.t);
      this.takeNow(ins.cues, ins.t);
    }
    this.flushReleases(Infinity);
    return this.errors.length ? this.errors : { spans: this.spans, beatEnd: this.beatEnd };
  }

  /** Every placed block's settled marker positions and visibility, and its movers' positions, after the last cue. */
  finalMarkers(): Map<string, number> {
    const out = new Map<string, number>();
    for (const p of this.scene.placements) {
      const decl = this.blocks[p.block];
      if (!decl) continue;
      for (const name of markerNames(decl)) {
        for (const ch of ['marker', 'vis'] as const) {
          const v = this.settledOf({ block: p.block, item: name }, ch);
          if (typeof v === 'number') out.set(keyOf(p.block, name, ch), v);
        }
      }
      for (const key of Object.keys(moverHome(decl))) {
        const v = this.settledOf({ block: p.block, item: key }, 'marker');
        if (typeof v === 'number') out.set(keyOf(p.block, key, 'marker'), v);
      }
    }
    return out;
  }

  // ---- values -------------------------------------------------------------------------------

  /** The channel's value before any span: the page's base state, where the IR determines it. */
  private base(p: Part, ch: Channel): Val | undefined {
    const vis = this.scene.initialVis[p.block];
    const decl = this.blocks[p.block];
    const isMarker = p.item !== undefined && decl !== undefined && markerNames(decl).includes(p.item);
    switch (ch) {
      case 'vis': case 'grow':
        if (isMarker) return this.reused.has(p.block) ? this.entering.get(keyOf(p.block, p.item, ch)) : 0;
        if (p.item === undefined) return vis ? (vis.self ? 1 : 0) : 1;
        return (vis?.items[p.item] ?? true) ? 1 : 0;
      case 'hl': case 'now': case 'recede': case 'group': case 'swap':
        return 0;
      case 'marker': {
        // A mover starts where it was declared, or where its previous placement left it.
        const home = !isMarker && p.item !== undefined && decl ? moverHome(decl)[p.item] : undefined;
        if (this.reused.has(p.block)) return this.entering.get(keyOf(p.block, p.item, ch)) ?? home;
        if (home !== undefined) return home;
        if (!decl) return undefined;
        const i = p.item === undefined ? 0 : markerNames(decl).indexOf(p.item);
        return i < 0 ? undefined : i + 1;
      }
      default:
        return undefined;   // content and value live in the page's entry state
    }
  }

  private active(key: string, t: number): Span | undefined {
    let found: Span | undefined;
    for (const s of this.byKey.get(key) ?? []) if (s.t0 <= t && (!found || s.t0 >= found.t0)) found = s;
    return found;
  }

  /** What the page evaluates for this channel at t; undefined where only the page knows. */
  private valueAt(p: Part, ch: Channel, t: number): Val | undefined {
    const s = this.active(keyOf(p.block, p.item, ch), t);
    if (!s) return this.base(p, ch);
    if (typeof s.to !== 'number' || t >= s.t1) return s.to;   // a finished span holds its `to`, whatever its `from`
    const from = s.from === undefined ? this.base(p, ch) : s.from;
    if (typeof from !== 'number') return undefined;
    const x = t >= s.t1 || s.t1 <= s.t0 ? 1 : ease(s.ease, (t - s.t0) / (s.t1 - s.t0));
    return from + (s.to - from) * x;
  }

  private settledOf(p: Part, ch: Channel): Val | undefined {
    return this.settled.get(keyOf(p.block, p.item, ch)) ?? this.base(p, ch);
  }

  /**
   * Move a channel to `to` over [t0, t0 + dur]. Skips a change that would not change any frame.
   * `unseen` gives the value to start from when the part cannot be seen yet (its block is still hidden).
   * `always` emits even a change that keeps the value: the page reads it as an event (a marker's first move).
   */
  private emit(p: Part, ch: Channel, t0: number, dur: number, to: Val, curve: Bezier, unseen?: number, always = false): Span | undefined {
    const key = keyOf(p.block, p.item, ch);
    this.settled.set(key, to);
    const from = unseen ?? this.valueAt(p, ch, t0);
    if (typeof to === 'number' && !always) {
      const run = this.active(key, t0);
      const running = run !== undefined && run.t1 > t0;
      if (running && run.to === to) return undefined;
      if (!running && from === to) return undefined;
    }
    const span = { block: p.block, ...(p.item !== undefined ? { item: p.item } : {}), channel: ch, t0, t1: t0 + dur,
      ...(from !== undefined ? { from } : {}), to, ease: curve } as Span;   // `from` absent: see the vocabulary above
    this.spans.push(span);
    const list = this.byKey.get(key);
    if (list) list.push(span); else this.byKey.set(key, [span]);
    this.beatEnd[this.beat] = Math.max(this.beatEnd[this.beat] ?? 0, span.t1);
    return span;
  }

  /** Drop the channel's spans that start after t: a command at t overrides what earlier ones scheduled later. */
  private cancelAfter(p: Part, ch: Channel, t: number): void {
    const key = keyOf(p.block, p.item, ch);
    const late = (this.byKey.get(key) ?? []).filter(s => s.t0 > t);
    if (!late.length) return;
    this.byKey.set(key, this.byKey.get(key)!.filter(s => s.t0 <= t));
    this.spans = this.spans.filter(s => !late.includes(s));
  }

  /** A `swap` span that names the other side of the exchange. */
  private emitSwap(p: Part, partner: string, t0: number, dur: number, to: number, curve: Bezier): void {
    const span = this.emit(p, 'swap', t0, dur, to, curve);
    if (span) span.partner = partner;
  }

  /** A verb's phase duration for spans on `block`: its type's theme override, else the verb's own. */
  private dur(verb: Cue['verb'], block: Id, phase = 0): number { return verbDuration(this.m, verb, this.blocks[block]?.type, phase); }
  private curve(token: EaseToken): Bezier { return this.m.eases[token]; }
  private verbCurve(verb: Cue['verb'], phase = 0): Bezier { return this.curve(VERBS[verb].phases[phase]!.ease); }

  // ---- targets -------------------------------------------------------------------------------

  /** Items of a target in reading order. */
  private itemKeys(t: Target): string[] {
    if (t.sel.kind !== 'items') return [];
    const order = new Map(this.blocks[t.block]?.items.map(it => [it.key, it.index]) ?? []);
    return [...t.sel.keys].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
  }

  /** Every item of a block, trees by depth then left to right (§4.4). */
  private growOrder(block: Id): string[] {
    const items = [...(this.blocks[block]?.items ?? [])];
    return items.sort((a, b) => (a.depth ?? 0) - (b.depth ?? 0) || a.index - b.index).map(it => it.key);
  }

  private allParts(block: Id): Part[] {
    return [{ block }, ...(this.blocks[block]?.items ?? []).map(it => ({ block, item: it.key }))];
  }

  // ---- verbs ---------------------------------------------------------------------------------

  private apply(cue: Cue, T: number): void {
    const { verb } = cue;
    // Every span lasts the verb's duration on its own block's type (`--dur-<verb>-<type>` may override it).
    const d = (block: Id) => this.dur(verb, block), c = this.verbCurve(verb);
    const on = (p: Part, t0: number, unseen?: number) => {
      this.emit(p, 'vis', t0, d(p.block), 1, c, unseen);
      this.emit(p, 'recede', t0, d(p.block), 0, c);
      this.emit(p, 'grow', t0, d(p.block), 1, c, unseen);
    };
    switch (verb) {
      case 'show': case 'grow':
        for (const t of cue.targets) {
          const self = { block: t.block };
          if (t.sel.kind === 'block') {
            // Growing a hidden block reveals its items one by one: while the block is unseen they start from 0.
            const unseen = this.settledOf(self, 'vis') === 1 ? undefined : 0;
            on(self, T);
            // A block-level cue is the first cue for all its items (L1), so it reveals them too: `grow`
            // one by one, trees by depth; `show` all at once, with the block.
            if (verb === 'grow') this.growOrder(t.block).forEach((item, i) => on({ block: t.block, item }, T + staggerAt(this.m, i), unseen));
            else this.growOrder(t.block).forEach(item => on({ block: t.block, item }, T, unseen));
          } else if (t.sel.kind === 'items') {
            if (this.settledOf(self, 'vis') !== 1) on(self, T);
            this.itemKeys(t).forEach((item, i) => on({ block: t.block, item }, T + staggerAt(this.m, i)));
          } else if (t.sel.kind === 'marker') {
            this.emit({ block: t.block, item: t.sel.name }, 'vis', T, d(t.block), 1, c);
          }
        }
        return;
      case 'hide':
        // A later command wins: a reveal still waiting on a stagger (`[grow c; hide c:3]`) is cancelled.
        for (const t of cue.targets) for (const p of this.selected(t)) { this.cancelAfter(p, 'vis', T); this.emit(p, 'vis', T, d(p.block), 0, c); }
        return;
      case 'dim':
        for (const t of cue.targets) for (const p of this.selected(t)) if (t.sel.kind !== 'marker') this.emit(p, 'recede', T, d(p.block), 1, c);
        return;
      case 'hl': {
        const byBlock = new Map<Id, Part[]>();
        for (const t of cue.targets) {
          const list = byBlock.get(t.block) ?? [];
          if (t.sel.kind === 'block' || t.sel.kind === 'items') list.push(...this.selected(t));
          byBlock.set(t.block, list);
        }
        for (const [block, lit] of byBlock) {
          for (const p of this.allParts(block)) {
            const want = lit.some(x => same(x, p)) ? 1 : 0;
            if (want || this.settledOf(p, 'hl') !== 0) this.emit(p, 'hl', T, d(block), want, c);
          }
        }
        return;
      }
      case 'focus':
        for (const t of cue.targets)
          for (const pl of this.scene.placements)
            this.emit({ block: pl.block }, 'recede', T, d(pl.block), t.sel.kind === 'none' || pl.block === t.block ? 0 : 1, c);
        return;
      case 'set': {
        const t = cue.targets[0];
        const n = numeric(cue.value);
        for (const p of this.selected(t)) {
          const key = keyOf(p.block, p.item, 'content');
          const run = this.contentRuns.get(key);
          if (run && T < run.t1) this.errors.push(overlap(cue.loc, run.loc, p));
          // T602 measures the run as emitted, so a type's longer `set` is a longer exclusive window.
          this.contentRuns.set(key, { t1: T + d(p.block), loc: cue.loc });
          this.emit(p, 'content', T, d(p.block), cue.value, c);
          if (n !== undefined) this.emit(p, 'value', T, d(p.block), n, c);
        }
        return;
      }
      case 'move': {
        const t = cue.targets[0];
        if (t.sel.kind === 'marker') { this.moveMarker({ block: t.block, item: t.sel.name }, T, d(t.block), cue.to, c); return; }
        // A mover (one item): its position eases from where it stands, mid-flight included, to the stop.
        if (t.sel.kind === 'items') { this.emit({ block: t.block, item: t.sel.keys[0] }, 'marker', T, d(t.block), cue.to, c); return; }
        const names = markerNames(this.blocks[t.block]!);
        if (!names.length) { this.emit({ block: t.block }, 'marker', T, d(t.block), cue.to, c); return; }
        const lead = this.settledOf({ block: t.block, item: names[0] }, 'marker');
        names.forEach((name, i) => {
          const at = this.settledOf({ block: t.block, item: name }, 'marker');
          const offset = typeof at === 'number' && typeof lead === 'number' ? at - lead : i;
          this.moveMarker({ block: t.block, item: name }, T, d(t.block), cue.to + offset, c);
        });
        return;
      }
      case 'group':
        this.emit({ block: cue.targets[0].block, item: cue.groupId }, 'group', T, d(cue.targets[0].block), 1, c);
        return;
      case 'swap': {
        const [out, inn] = cue.targets;
        if (out.sel.kind === 'block' && inn.sel.kind === 'block') {
          // Both sides of the exchange move together: the longer of the two blocks' durations.
          const both = Math.max(d(out.block), d(inn.block));
          this.emit({ block: out.block }, 'vis', T, both, 0, c);
          this.emit({ block: inn.block }, 'vis', T, both, 1, c);
          this.emit({ block: inn.block }, 'recede', T, both, 0, c);
          this.emitSwap({ block: out.block }, inn.block, T, both, 1, c);
          this.emitSwap({ block: inn.block }, out.block, T, both, 0, c);
        } else if (out.sel.kind === 'items' && inn.sel.kind === 'items') {
          const [x, y] = [out.sel.keys[0]!, inn.sel.keys[0]!];
          this.emitSwap({ block: out.block, item: x }, y, T, d(out.block), 1, c);
          this.emitSwap({ block: out.block, item: y }, x, T, d(out.block), 1, c);
        }
        return;
      }
    }
  }

  /**
   * Move one marker. A hidden marker appears on its first move (the page places it there and fades it in),
   * so that move is emitted even when it goes to the position the marker already has, e.g. `move arr:lo 1`.
   * Unknown visibility (a reused block's marker that never showed) counts as hidden.
   */
  private moveMarker(p: Part, T: number, d: number, to: number, c: Bezier): void {
    const hidden = this.settledOf(p, 'vis') !== 1;
    this.emit(p, 'marker', T, d, to, c, undefined, hidden);
    this.settled.set(keyOf(p.block, p.item, 'vis'), 1);
  }

  /** The parts a target names: the block itself, its items, or one marker. */
  private selected(t: Target): Part[] {
    switch (t.sel.kind) {
      case 'block': return [{ block: t.block }];
      case 'items': return this.itemKeys(t).map(item => ({ block: t.block, item }));
      case 'marker': return [{ block: t.block, item: t.sel.name }];
      case 'none': return [];
    }
  }

  // ---- the now pointer (§1.5, theme rule 7) --------------------------------------------------

  /**
   * "Now" is per block (round 5 ruling): in each block, the last hl/set/move target of the instant on that block
   * (the block visible) becomes now, and that block's other holders drop over --dur-highlight; blocks the instant
   * does not touch keep theirs. `[hl none]` clears now. A `set` target is now only until its settle ends.
   */
  private takeNow(cues: Cue[], T: number): void {
    const latest = new Map<Id, { cue: Cue; target: Target }>();
    for (const cue of cues) {
      if (!VERBS[cue.verb].takesNow) continue;
      for (const target of cue.targets)
        if (target.sel.kind === 'none' || this.settledOf({ block: target.block }, 'vis') !== 0) latest.set(target.block, { cue, target });
    }
    const d = this.m.durations['--dur-highlight'], c = this.curve('--ease-highlight');
    for (const [block, { cue, target }] of latest) {
      const next = target.sel.kind === 'none' ? [] : this.nowParts(cue, target);
      for (const p of this.holders) if (p.block === block && !next.some(x => same(x, p))) this.emitNow(p, T, d, 0, c);
      for (const p of next) this.emitNow(p, T, d, 1, c);
      this.holders = [...this.holders.filter(p => p.block !== block), ...next];
      this.releases = this.releases.filter(r => r.part.block !== block);
      if (cue.verb === 'set') {
        const at = T + this.m.durations['--dur-settle'];
        this.releases.push(...next.map(part => ({ part, at, beat: this.beat })));
      }
    }
  }

  private nowParts(cue: Cue, target: Target): Part[] {
    if (target.sel.kind === 'block' && cue.verb === 'move') {
      const lead = markerNames(this.blocks[target.block]!)[0];
      return [lead === undefined ? { block: target.block } : { block: target.block, item: lead }];
    }
    return this.selected(target);
  }

  private emitNow(p: Part, t0: number, d: number, to: number, c: Bezier): void { this.emit(p, 'now', t0, d, to, c); }

  /** Release every `set` now whose settle ended at or before t. */
  private flushReleases(t: number): void {
    const due = this.releases.filter(r => r.at <= t);
    if (!due.length) return;
    const keep = this.beat;
    for (const r of due) {
      this.beat = r.beat;
      this.emitNow(r.part, r.at, this.m.durations['--dur-highlight'], 0, this.curve('--ease-highlight'));
      this.holders = this.holders.filter(h => !same(h, r.part));
    }
    this.beat = keep;
    this.releases = this.releases.filter(r => r.at > t);
  }
}

function overlap(loc: Loc, prev: Loc, p: Part): TimingError {
  const what = p.item === undefined ? `"${p.block}"` : `"${p.block}:${p.item}"`;
  return {
    code: 'T602', loc,
    message: `\`set\` at ${loc.line}:${loc.col} on ${what} starts while the \`set\` at ${prev.line}:${prev.col} is still changing it`,
    fix: 'move the cue later or merge the values',
  };
}

/** A `set` value that is a plain number also drives a chart's animated value. */
function numeric(v: Inline): number | undefined {
  if (v.length !== 1 || typeof v[0] !== 'string') return undefined;
  const s = v[0].trim();
  const n = Number(s);
  return s !== '' && Number.isFinite(n) ? n : undefined;
}
