/**
 * `stateAt`: evaluate a scene's compiled channel spans at scene time t (§3.2), over the scene's base state
 * (its state at S = 0 before any span). Generic: it knows channels, items, markers and groups, never block
 * types. Pure: the result depends only on (spans, base, t).
 */
import type { Id, Inline } from '../ir.ts';
import type { BlockState, Channels, Content } from '../blocks/contract.ts';
import type { Span } from '../timing/types.ts';
import type { Bezier } from '../verbs.ts';

/** Every placed block's state, plus the scene crossfade (0 = previous scene, 1 = this one). */
export interface SceneState { blocks: Record<Id, BlockState>; scene: number }

/** Spans grouped by the part and channel they write, each list in t0 order (source order on ties). */
export interface SpanIndex { parts: Map<string, Span[]>; scene: Span[] }

const partKey = (block: Id, item: string | undefined, channel: string) => `${block}\u0000${item ?? ''}\u0000${channel}`;

export function indexSpans(spans: Span[]): SpanIndex {
  const parts = new Map<string, Span[]>();
  const scene: Span[] = [];
  spans.forEach(s => {
    if (s.channel === 'scene') { scene.push(s); return; }
    const k = partKey(s.block, s.item, s.channel);
    const list = parts.get(k);
    if (list) list.push(s); else parts.set(k, [s]);
  });
  const byT0 = (a: Span, b: Span) => a.t0 - b.t0;
  for (const list of parts.values()) list.sort(byT0);   // Array.sort is stable: ties keep source order
  scene.sort(byT0);
  return { parts, scene };
}

/** Cubic-bezier easing y(x), solved by bisection: exact enough and deterministic. */
function ease(b: Bezier, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const [x1, y1, x2, y2] = b;
  const at = (a1: number, a2: number, u: number) => 3 * a1 * u * (1 - u) ** 2 + 3 * a2 * u * u * (1 - u) + u ** 3;
  let lo = 0, hi = 1, u = x;
  for (let i = 0; i < 40; i++) {
    u = (lo + hi) / 2;
    if (at(x1, x2, u) < x) lo = u; else hi = u;
  }
  return at(y1, y2, u);
}

/** Progress of a span at t: 0 at or before t0, 1 from t1 on. */
function progress(s: Span, t: number): number {
  if (t <= s.t0) return 0;
  if (t >= s.t1 || s.t1 <= s.t0) return 1;
  return ease(s.ease, (t - s.t0) / (s.t1 - s.t0));
}

/**
 * The span in force at t: the latest one that has started. Its `from` already continues earlier spans; a span
 * without `from` starts from the part's entry value (the base), which only the page knows.
 */
function active(list: Span[] | undefined, t: number): Span | undefined {
  if (!list) return undefined;
  let found: Span | undefined;
  for (const s of list) { if (s.t0 <= t) found = s; else break; }
  return found;
}

function numberAt(list: Span[] | undefined, t: number, base: number): number {
  const s = active(list, t);
  if (!s) return base;
  const from = typeof s.from === 'number' ? s.from : base;
  const to = typeof s.to === 'number' ? s.to : base;
  return from + (to - from) * progress(s, t);
}

function contentAt(list: Span[] | undefined, t: number, base: Content | undefined): Content | undefined {
  const s = active(list, t);
  if (!s) return base;
  const to = s.to as Inline, from = (s.from as Inline | undefined) ?? base?.cur;
  const p = progress(s, t);
  return p >= 1 || !from ? { cur: to, p: Math.min(1, p) } : { cur: to, prev: from, p };
}

const CHANNELS: (keyof Channels)[] = ['vis', 'hl', 'now', 'recede', 'grow'];

/** Scene state at t. `base` is not modified. */
export function stateAt(index: SpanIndex, base: SceneState, t: number): SceneState {
  const blocks: Record<Id, BlockState> = {};
  const get = (b: Id, item: string | undefined, ch: string) => index.parts.get(partKey(b, item, ch));
  for (const [id, b] of Object.entries(base.blocks)) {
    const self = { ...b.self };
    for (const ch of CHANNELS) self[ch] = numberAt(get(id, undefined, ch), t, b.self[ch]);
    self.content = contentAt(get(id, undefined, 'content'), t, b.self.content);

    const items: BlockState['items'] = {};
    for (const [key, it] of Object.entries(b.items)) {
      const n = { ...it };
      for (const ch of CHANNELS) n[ch] = numberAt(get(id, key, ch), t, it[ch]);
      n.content = contentAt(get(id, key, 'content'), t, it.content);
      const vs = get(id, key, 'value');
      if (vs || it.value !== undefined) n.value = numberAt(vs, t, it.value ?? 0);
      // A mover's position: every span carries its `from`, so before the first one the item stands as it entered.
      const at = get(id, key, 'marker');
      if (active(at, t)) n.at = numberAt(at, t, it.at ?? 0);
      const sw = active(get(id, key, 'swap'), t);
      if (sw) n.swap = { with: sw.partner ?? it.swap?.with ?? '', p: numberAt(get(id, key, 'swap'), t, it.swap?.p ?? 0) };
      items[key] = n;
    }

    const markers: BlockState['markers'] = {};
    for (const [name, m] of Object.entries(b.markers)) {
      const moves = get(id, name, 'marker');
      const visSpans = get(id, name, 'vis');
      let at = numberAt(moves, t, m.at);
      let vis = numberAt(visSpans, t, m.vis);
      // A hidden marker's first move places it and fades it in, rather than sliding from nowhere.
      const first = moves?.[0];
      if (m.vis === 0 && !visSpans && first && first.t0 <= t) {
        if (active(moves, t) === first) at = first.to as number;
        vis = progress(first, t);
      }
      markers[name] = { at, vis, now: numberAt(get(id, name, 'now'), t, m.now) };
    }

    const groups = b.groups.map(g => ({ ...g, vis: numberAt(get(id, g.id, 'group'), t, g.vis) }));
    const out: BlockState = { self, items, markers, groups };
    const bsw = active(get(id, undefined, 'swap'), t);
    if (b.swap || bsw) out.swap = { with: bsw?.partner ?? b.swap?.with ?? '', p: numberAt(get(id, undefined, 'swap'), t, b.swap?.p ?? 0) };
    blocks[id] = out;
  }
  const sc = active(index.scene, t);
  return { blocks, scene: sc ? numberAt(index.scene, t, 0) : base.scene };
}
