/**
 * `graph`: a directed graph. Body lines are `key: label` nodes and `a -> b` or `a -> b: label` edges, in any
 * order (labels take inline marks); `dir=LR` (default), `dir=TB` or `dir=cycle`. Items, in body order, are
 * node keys and edges keyed `a>b`. Flexible: the rank gap grows to fill the region's width (LR), or the gap
 * between siblings does (TB); a ring keeps its size.
 *
 * Layout (`place` is the only placement policy). LR and TB: dagre assigns ranks and order on measured node
 * sizes; a node's children keep their declaration order (left to right in TB, top to bottom in LR). Edges are
 * drawn orthogonally from dagre's waypoints: they run straight through each rank at the waypoint's height and
 * turn only in the clear gap between ranks (in their own lane when several turn in one gap), so they cannot
 * cross a node. Edges leaving or entering one side of a node are spread `--edge-spread` apart (rule 13). Edge
 * labels sit beside their edge in the space dagre reserves for them. `dir=cycle` puts the nodes round a ring
 * instead (see `ring`).
 *
 * State: nodes are cells (rest `--surface-2`, highlighted `--hl-fill-cell`, label in the body face, amber while now). An edge
 * draws before the node it enters appears (show and grow), hides with either endpoint, recedes with either
 * endpoint (to `--ink-4`), and turns amber while it or the node it enters is now.
 */
import dagre from '@dagrejs/dagre';
import type { Inline, ItemDecl, Loc } from '../../ir.ts';
import type { BlockModule, Channels } from '../contract.ts';
import { maxContent, channels, envelope, h, inherit, num, scaleOf, showContent, style, svg, token, type Envelope } from '../kit.ts';

interface GNode { key: string; label: Inline }
interface GEdge { key: string; from: string; to: string; label?: Inline }
interface GraphBody { dir: 'LR' | 'TB' | 'cycle'; nodes: GNode[]; edges: GEdge[] }

interface NodeDom { part: HTMLElement; env: Envelope; w: number; h: number; x: number; y: number }
interface EdgeDom { path: SVGPathElement; head: SVGPathElement; label?: { el: HTMLElement; env: Envelope; w: number; h: number }; len: number }
/** `crowded`: a ring whose labels no radius up to the cap could keep clear (`ring`). */
interface Dom { body: GraphBody; box: HTMLElement; svg: SVGSVGElement; cap?: HTMLElement; nodes: Map<string, NodeDom>; edges: Map<string, EdgeDom>; crowded: boolean }

const doms = new WeakMap<HTMLElement, Dom>();
const KEY = '[A-Za-z0-9_][\\w-]*';
const EDGE = new RegExp(`^\\s*(${KEY})\\s*->\\s*(${KEY})\\s*(?::\\s*(.*))?$`);
const NODE = new RegExp(`^\\s*(${KEY})\\s*:\\s*(.+)$`);

export const graph: BlockModule<GraphBody> = {
  type: 'graph',
  pack: 'core',
  args: { dir: ['LR', 'TB', 'cycle'] },
  flexible: true,
  parse(body, args, ctx) {
    const nodes: GNode[] = [];
    const edges: (GEdge & { loc: Loc })[] = [];
    const items: ItemDecl[] = [];
    const where = new Map<string, Loc>();
    const at = (l: { loc: Loc; text: string }, s: string): Loc => ({ line: l.loc.line, col: Math.max(1, l.text.indexOf(s) + 1) });
    for (const l of body) {
      if (!l.text.trim()) continue;
      const e = l.text.match(EDGE);
      const n = e ? null : l.text.match(NODE);
      let key: string;
      if (e) {
        const [, from, to, label] = e as unknown as [string, string, string, string | undefined];
        if (from === to) ctx.error(l.loc, 'E133', `edge ${from} -> ${to} points at itself`, 'a graph edge joins two different nodes; describe a loop in narration or a label');
        key = `${from}>${to}`;
        edges.push({ key, from, to, ...(label?.trim() ? { label: ctx.inline(label.trim(), at(l, label.trim())) } : {}), loc: l.loc });
      } else if (n) {
        key = n[1]!;
        nodes.push({ key, label: ctx.inline(n[2]!.trim(), at(l, n[2]!.trim())) });
      } else {
        ctx.error(l.loc, 'E133', `graph line "${l.text.trim()}" is neither a node nor an edge`, 'write a node as "key: label" or an edge as "a -> b" (optionally "a -> b: label")');
      }
      const prev = where.get(key!);
      if (prev) ctx.error(l.loc, 'E133', `${e ? 'edge' : 'node'} "${e ? `${e[1]} -> ${e[2]}` : key!}" is already declared at line ${prev.line}`, 'declare each node and edge once; to change a label later, `set` it');
      where.set(key!, l.loc);
      items.push({ key: key!, index: items.length + 1, kind: e ? 'edge' : 'node', loc: l.loc, ...(l.name ? { name: l.name } : {}) });
    }
    const keys = new Set(nodes.map(n => n.key));
    for (const e of edges) for (const end of [e.from, e.to]) if (!keys.has(end))
      ctx.error(e.loc, 'E133', `edge ${e.from} -> ${e.to} uses node "${end}", which is not declared`, `declare it on its own line: "${end}: label"`);
    if (!nodes.length) ctx.error(body[0]?.loc ?? { line: 0, col: 0 }, 'E130', 'graph has no nodes', 'write nodes as "key: label" and edges as "a -> b"');
    const dir = args.dir === 'TB' || args.dir === 'cycle' ? args.dir : 'LR';
    return { body: { dir, nodes, edges: edges.map(({ loc: _loc, ...e }) => e) }, items };
  },
  verbs: { show: ['block', 'items'], hide: ['block', 'items'], hl: ['block', 'items', 'none'], dim: ['block', 'items'], set: ['items'], grow: ['block', 'items'] },
  runtime: {
    mount(el, body, _args, reachable, caption) {
      style('graph', CSS);
      el.classList.add('gr-graph', 'xp');
      const cap = caption ? h('div', 'x-caption gr-cap xp', el) : undefined;
      if (cap) { cap.textContent = caption!; cap.dataset.leaf = ''; }
      const box = h('div', 'gr-box', el);
      const lines = svg('svg', box);
      lines.setAttribute('class', 'gr-edges');
      const edges = new Map<string, EdgeDom>();
      for (const e of body.edges) {
        const path = svg('path', lines);
        path.setAttribute('class', 'gr-edge');
        path.dataset.edge = '';
        const head = svg('path', lines);
        head.setAttribute('class', 'gr-head');
        let label: EdgeDom['label'];
        const alts = reachable.items[e.key] ?? [];
        if (e.label || alts.length) {
          const lel = h('div', 'gr-elabel xp', box);
          const env = envelope(lel, e.label ?? [], alts, 'gr-etext');
          label = { el: lel, env, w: 0, h: 0 };
        }
        edges.set(e.key, { path, head, ...(label ? { label } : {}), len: 0 });
      }
      const nodes = new Map<string, NodeDom>();
      for (const n of body.nodes) {
        const part = h('div', 'gr-node x-cell xp', box);
        part.dataset.leaf = '';
        const env = envelope(part, n.label, reachable.items[n.key], 'gr-label');
        env.el.dataset.essential = '';   // L406: a viewer must read it (never below --text-label)
        env.el.dataset.declared = '';
        nodes.set(n.key, { part, env, w: 0, h: 0, x: 0, y: 0 });
      }
      doms.set(el, { body, box, svg: lines, ...(cap ? { cap } : {}), nodes, edges, crowded: false });
    },
    lint(el) {
      if (!doms.get(el)!.crowded) return [];
      return [{ code: 'L404', message: `the ring "${el.dataset.block}" has too many labelled chords to keep their labels clear`,
        fix: 'remove a chord\'s label (say it in the narration instead)' }];
    },
    roomFix(el) {
      // Ranks run along `dir`: turning a wide graph trades width for height. A tall one is split, not turned back
      // (turning back is the width overflow again: round 4 looped on the two hints).
      if (doms.get(el)!.body.dir === 'LR') return `draw "${el.dataset.block}" top to bottom: add dir=TB to its ::: line`;
      return undefined;
    },
    measure(el, width) {
      const d = doms.get(el)!;
      const s = scaleOf(el);
      for (const n of d.nodes.values()) {
        // Intrinsic size: clear what the previous measure wrote, else it feeds back (and ceil ratchets it).
        Object.assign(n.part.style, { width: 'max-content', height: '' });
        const r = n.part.getBoundingClientRect();
        n.w = Math.ceil(Math.max(token('--node-w'), r.width / s) - 0.01);
        n.h = Math.ceil(Math.max(token('--node-h'), r.height / s) - 0.01);
      }
      for (const e of d.edges.values()) if (e.label) {
        const r = e.label.el.getBoundingClientRect();
        e.label.w = Math.ceil(r.width / s - 0.01);
        e.label.h = Math.ceil(r.height / s - 0.01);
      }
      const used = place(d, width);
      const capW = d.cap ? Math.ceil(maxContent(d.cap)) : 0;   // its text width, not the block's current width
      el.style.width = `${Math.max(used.w, capW)}px`;
      return { natural: Math.max(used.w, capW), height: el.offsetHeight };
    },
    geometry(el) {
      const d = doms.get(el)!;
      for (const e of d.edges.values()) {
        e.len = e.path.getTotalLength();
        e.path.style.strokeDasharray = num(e.len);
      }
    },
    render(el, s) {
      const d = doms.get(el)!;
      channels(el, { vis: s.self.vis });
      if (d.cap) channels(d.cap, { recede: s.self.recede });
      const into = new Set(d.body.edges.map(e => e.to));
      const ch = new Map<string, Channels>();
      for (const n of d.body.nodes) ch.set(n.key, inherit(s.self, s.items[n.key]));
      // A node with incoming edges appears over the second half of its reveal; its edges draw over the first.
      const appear = (k: string) => { const c = ch.get(k)!; return into.has(k) ? clamp((c.vis - 0.5) * 2) : c.vis; };
      for (const n of d.body.nodes) {
        const dom = d.nodes.get(n.key)!;
        channels(dom.part, { ...ch.get(n.key)!, vis: appear(n.key) });
        showContent(dom.env, s.items[n.key]?.content);
      }
      for (const e of d.body.edges) {
        const dom = d.edges.get(e.key)!;
        const own = inherit(s.self, s.items[e.key]);
        const src = ch.get(e.from)!, tgt = ch.get(e.to)!;
        const drawn = Math.min(own.vis, own.grow, appear(e.from), clamp(tgt.vis * 2));
        dom.path.style.strokeDashoffset = num(dom.len * (1 - drawn));
        const shown = drawn > 0.001 ? '1' : '0';
        dom.path.style.opacity = shown;
        dom.head.style.opacity = drawn >= 1 ? '1' : num(clamp((drawn - 0.85) / 0.15));
        const look = { hl: own.hl, now: Math.max(own.now, tgt.now), recede: Math.max(own.recede, src.recede, tgt.recede) };
        channels(dom.path, look);
        channels(dom.head, look);
        if (dom.label) {
          channels(dom.label.el, { vis: clamp((drawn - 0.5) * 2), hl: own.hl, now: own.now, recede: look.recede });
          showContent(dom.label.env, s.items[e.key]?.content);
        }
      }
    },
  },
};

const clamp = (v: number) => Math.max(0, Math.min(1, v));

/* ---------- layout ---------- */

type Pt = { x: number; y: number };
interface Laid { w: number; h: number; nodes: Map<string, Pt>; points: Map<string, Pt[]>; labels: Map<string, Pt> }

/** Lay the graph out across `width` (CSS px) and position every part. Returns the size used. */
function place(d: Dom, width: number): { w: number; h: number } {
  const laid = d.body.dir === 'cycle' ? ring(d) : ranked(d, width);
  for (const [k, p] of laid.nodes) {
    const n = d.nodes.get(k)!;
    n.x = p.x - n.w / 2;
    n.y = p.y - n.h / 2;
    Object.assign(n.part.style, { left: `${num(n.x)}px`, top: `${num(n.y)}px`, width: `${n.w}px`, height: `${n.h}px` });
  }
  Object.assign(d.box.style, { width: `${Math.ceil(laid.w)}px`, height: `${Math.ceil(laid.h)}px` });
  d.svg.setAttribute('width', String(Math.ceil(laid.w)));
  d.svg.setAttribute('height', String(Math.ceil(laid.h)));
  return { w: Math.ceil(laid.w), h: Math.ceil(laid.h) };
}

/** LR and TB: dagre's ranks, flexed to `width`, and orthogonal edges. */
function ranked(d: Dom, width: number): Laid {
  const lr = d.body.dir === 'LR';
  let laid: Laid;
  if (lr) {
    // The rank gap flexes to fill the width; the gap between nodes of one rank stays at the minimum.
    const gmin = token('--graph-rank-gap-min'), gmax = token('--graph-rank-gap-max'), sep = token('--graph-node-gap-min');
    laid = run(d, gmin, sep);
    if (laid.w < width) {
      let lo = gmin, hi = gmax;
      if (run(d, gmax, sep).w <= width) lo = gmax;
      else for (let i = 0; i < 12; i++) { const mid = (lo + hi) / 2; if (run(d, mid, sep).w <= width) lo = mid; else hi = mid; }
      laid = run(d, lo, sep);
    }
  } else {
    // Ranks sit the minimum rank gap apart (vertical room is scarce); the gap within a rank flexes to fit.
    const rank = token('--graph-rank-gap-min');
    const gmin = token('--graph-node-gap-min'), gmax = token('--graph-node-gap-max');
    laid = run(d, rank, gmax);
    if (laid.w > width) {
      let lo = gmin, hi = gmax;
      for (let i = 0; i < 12; i++) { const mid = (lo + hi) / 2; if (run(d, rank, mid).w <= width) lo = mid; else hi = mid; }
      laid = run(d, rank, lo);
    }
  }
  route(d, laid, lr);
  return laid;
}

/** One dagre run. Edge labels reserve room on one side of the edge, so the edge never runs through its label. */
function run(d: Dom, ranksep: number, nodesep: number): Laid {
  const g = new dagre.graphlib.Graph({ multigraph: false });
  const lr = d.body.dir === 'LR';
  const gap = token('--space-2');
  g.setGraph({ rankdir: d.body.dir, ranksep, nodesep, edgesep: token('--edge-spread'), marginx: 0, marginy: 0 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of d.body.nodes) { const dom = d.nodes.get(n.key)!; g.setNode(n.key, { width: dom.w, height: dom.h }); }
  // Every edge reserves the widest label's room along the ranks, so the gaps between ranks come out equal
  // (dagre reserves room only for a label with both a width and a height, hence a hairline for unlabelled edges).
  const labs = d.body.edges.map(e => d.edges.get(e.key)!.label);
  const along = Math.max(0, ...labs.map(l => (l ? (lr ? l.w : l.h) : 0)));
  for (const e of d.body.edges) {
    const l = d.edges.get(e.key)!.label;
    const size = !along ? {} : lr
      ? { width: along + 2 * gap, height: l ? 2 * (l.h + gap) : token('--stroke-hair') }
      : { width: l ? 2 * (l.w + gap) : token('--stroke-hair'), height: along + 2 * gap };
    g.setEdge(e.from, e.to, { ...size, labelpos: 'c' });
  }
  // Siblings (the nodes one node points at) keep the order their nodes are declared in; left alone, dagre's
  // tie-breaking reverses them (r3 DNS). Crossing reduction still runs around these constraints.
  const order = new Map(d.body.nodes.map((n, i) => [n.key, i]));
  const constraints = d.body.nodes.flatMap(n => {
    const kids = d.body.edges.filter(e => e.from === n.key).map(e => e.to).sort((a, b) => order.get(a)! - order.get(b)!);
    return kids.slice(1).map((right, i) => ({ left: kids[i]!, right }));
  });
  dagre.layout(g, { constraints });
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const grow = (x: number, y: number, hw = 0, hh = 0) => { x0 = Math.min(x0, x - hw); x1 = Math.max(x1, x + hw); y0 = Math.min(y0, y - hh); y1 = Math.max(y1, y + hh); };
  for (const k of g.nodes()) { const n = g.node(k); grow(n.x!, n.y!, n.width / 2, n.height / 2); }
  const labels = new Map<string, { x: number; y: number }>();
  const points = new Map<string, { x: number; y: number }[]>();
  for (const e of d.body.edges) {
    const ge = g.edge(e.from, e.to) as { points?: { x: number; y: number }[]; x?: number; y?: number; width?: number; height?: number };
    points.set(e.key, ge.points ?? []);
    if (ge.x !== undefined && ge.y !== undefined && ge.width) { labels.set(e.key, { x: ge.x, y: ge.y }); grow(ge.x, ge.y, (ge.width ?? 0) / 2, (ge.height ?? 0) / 2); }
  }
  const shift = (p: { x: number; y: number }) => ({ x: p.x - x0, y: p.y - y0 });
  return {
    w: x1 - x0, h: y1 - y0,
    nodes: new Map(g.nodes().map(k => [k, shift(g.node(k) as { x: number; y: number })])),
    points: new Map([...points].map(([k, ps]) => [k, ps.map(shift)])),
    labels: new Map([...labels].map(([k, p]) => [k, shift(p)])),
  };
}

/**
 * Orthogonal routes through dagre's waypoints. Work in (u, v): u runs along the ranks (x for LR, y for TB),
 * v across them. An edge leaves its source's facing side, holds its v through each rank, and turns only in
 * the gap between two ranks.
 */
function route(d: Dom, laid: Laid, lr: boolean): void {
  const U = (p: { x: number; y: number }) => (lr ? p.x : p.y), V = (p: { x: number; y: number }) => (lr ? p.y : p.x);
  const XY = (u: number, v: number) => (lr ? { x: u, y: v } : { x: v, y: u });
  const half = (k: string) => { const n = d.nodes.get(k)!; return { u: (lr ? n.w : n.h) / 2, v: (lr ? n.h : n.w) / 2 }; };
  const centre = (k: string) => { const p = laid.nodes.get(k)!; return { u: U(p), v: V(p) }; };

  // Ranks: every node centre and waypoint shares its rank's u; a rank's thickness is its widest member.
  const ranks: { u: number; t: number }[] = [];
  const addRank = (u: number, t: number) => {
    const r = ranks.find(x => Math.abs(x.u - u) < 0.5);
    if (r) r.t = Math.max(r.t, t); else ranks.push({ u, t });
  };
  for (const k of laid.nodes.keys()) addRank(centre(k).u, half(k).u * 2);
  // Ranks with no node hold only edge waypoints and labels; with labels they are one label-room thick.
  const room = Math.max(0, ...d.body.edges.map(e => { const l = d.edges.get(e.key)!.label; return l ? (lr ? l.w : l.h) + 2 * token('--space-2') : 0; }));
  for (const e of d.body.edges) for (const p of laid.points.get(e.key)!.slice(1, -1)) addRank(U(p), room);
  ranks.sort((a, b) => a.u - b.u);
  const rankOf = (u: number) => ranks.findIndex(r => Math.abs(r.u - u) < 0.5);
  const gapMid = (a: number, b: number) => {
    const [lo, hi] = a < b ? [a, b] : [b, a];
    return ((ranks[lo]!.u + ranks[lo]!.t / 2) + (ranks[hi]!.u - ranks[hi]!.t / 2)) / 2;
  };

  // Stations: source, waypoints, target, each with the rank it sits in and the v it holds there.
  const R = token('--radius-edge'), spread = token('--edge-spread');
  type Plan = { key: string; from: string; to: string; sgn: number; stations: { rank: number; v: number }[] };
  const plans: Plan[] = d.body.edges.map(e => {
    const a = centre(e.from), b = centre(e.to);
    const sgn = Math.sign(b.u - a.u) || 1;
    const mids = laid.points.get(e.key)!.slice(1, -1).map(p => ({ rank: rankOf(U(p)), v: V(p) }));
    return { key: e.key, from: e.from, to: e.to, sgn, stations: [{ rank: rankOf(a.u), v: a.v }, ...mids, { rank: rankOf(b.u), v: b.v }] };
  });

  // Spread edges sharing one side of a node, ordered by where they head next, so they never cross there.
  type Port = { plan: Plan; end: 0 | 1; toward: number };
  const ports = new Map<string, Port[]>();
  const port = (side: string, x: Port) => { const l = ports.get(side); if (l) l.push(x); else ports.set(side, [x]); };
  for (const p of plans) {
    const s = p.stations;
    port(`${p.from}|${p.sgn}`, { plan: p, end: 0, toward: s[1]!.v });
    port(`${p.to}|${-p.sgn}`, { plan: p, end: 1, toward: s[s.length - 2]!.v });
  }
  for (const [id, list] of ports) {
    const node = id.split('|')[0]!;
    const room = Math.max(0, half(node).v - R - token('--space-2'));
    list.sort((a, b) => a.toward - b.toward);
    list.forEach((port, i) => {
      const off = Math.max(-room, Math.min(room, (i - (list.length - 1) / 2) * spread));
      const st = port.plan.stations;
      const idx = port.end === 0 ? 0 : st.length - 1;
      st[idx] = { rank: st[idx]!.rank, v: centre(node).v + off };
    });
  }

  // Turns: one per change of v between adjacent stations, in the gap between their ranks; turns in one gap
  // whose spans overlap take separate lanes.
  type Turn = { plan: Plan; i: number; lo: number; hi: number; gap: number; lane: number };
  const turns: Turn[] = [];
  for (const p of plans) for (let i = 0; i + 1 < p.stations.length; i++) {
    const a = p.stations[i]!, b = p.stations[i + 1]!;
    if (Math.abs(a.v - b.v) < 0.5) continue;
    turns.push({ plan: p, i, lo: Math.min(a.v, b.v), hi: Math.max(a.v, b.v), gap: Math.min(a.rank, b.rank), lane: 0 });
  }
  const laneCount = new Map<number, number>();
  for (const gap of new Set(turns.map(t => t.gap))) {
    const inGap = turns.filter(t => t.gap === gap).sort((a, b) => a.lo - b.lo);
    const ends: number[] = [];
    for (const t of inGap) {
      let lane = ends.findIndex(e => e < t.lo - spread / 2);
      if (lane < 0) { lane = ends.length; ends.push(t.hi); } else ends[lane] = t.hi;
      t.lane = lane;
    }
    laneCount.set(gap, ends.length);
  }

  for (const p of plans) {
    const st = p.stations;
    const a = centre(p.from), b = centre(p.to);
    const pts: { u: number; v: number }[] = [{ u: a.u + p.sgn * half(p.from).u, v: st[0]!.v }];
    for (let i = 0; i + 1 < st.length; i++) {
      const t = turns.find(x => x.plan === p && x.i === i);
      if (!t) continue;
      const n = laneCount.get(t.gap) ?? 1;
      const u = gapMid(st[i]!.rank, st[i + 1]!.rank) + (t.lane - (n - 1) / 2) * (spread / 2);
      pts.push({ u, v: st[i]!.v }, { u, v: st[i + 1]!.v });
    }
    const headLen = token('--space-2');
    const tip = { u: b.u - p.sgn * half(p.to).u, v: st[st.length - 1]!.v };
    pts.push({ u: tip.u - p.sgn * headLen, v: tip.v });
    const dom = d.edges.get(p.key)!;
    dom.path.setAttribute('d', rounded(pts.map(q => XY(q.u, q.v)), R));
    const hw = token('--space-1');
    const l = XY(tip.u - p.sgn * headLen, tip.v - hw), r = XY(tip.u - p.sgn * headLen, tip.v + hw), t = XY(tip.u, tip.v);
    dom.head.setAttribute('d', `M${num(l.x)} ${num(l.y)} L${num(t.x)} ${num(t.y)} L${num(r.x)} ${num(r.y)} Z`);
    const lab = dom.label;
    const lp = laid.labels.get(p.key);
    if (lab && lp) {
      // Beside the edge: above it in LR, to its right in TB, in the half of the reserved box the edge leaves free.
      const gap = token('--space-2');
      const ev = (() => { const at = U(lp); const seg = st.find(s => Math.abs(ranks[s.rank]!.u - at) < 0.5); return seg ? seg.v : V(lp); })();
      const x = lr ? U(lp) - lab.w / 2 : ev + gap;
      const y = lr ? ev - gap - lab.h : U(lp) - lab.h / 2;
      Object.assign(lab.el.style, { left: `${num(x)}px`, top: `${num(y)}px` });
    }
  }
}

/** An arrowhead with its tip at `tip`; `back` is the unit vector from the tip back along the edge. */
function arrow(tip: Pt, back: Pt): string {
  const len = token('--space-2'), hw = token('--space-1');
  const bx = tip.x + back.x * len, by = tip.y + back.y * len;
  const l = { x: bx - back.y * hw, y: by + back.x * hw }, r = { x: bx + back.y * hw, y: by - back.x * hw };
  return `M${num(l.x)} ${num(l.y)} L${num(tip.x)} ${num(tip.y)} L${num(r.x)} ${num(r.y)} Z`;
}

/* ---------- dir=cycle ---------- */

/**
 * The ring. Nodes go round a circle in declaration order, clockwise from the top. An edge between neighbours
 * follows the circle; a pair of neighbours joined both ways takes two arcs `--edge-spread` apart. Any other
 * edge is a straight chord, and a chord drawn both ways takes two lanes `--edge-spread` apart. A label sits outside the ring at its arc's middle (an inner arc's inside; a
 * chord's beside it a third of the way from its source, so two chords crossing mid-ring keep their labels apart). The radius is the smallest that leaves
 * `--graph-rank-gap-min` of arc between neighbours with no box overlapping a box or an edge, up to twice that;
 * past it the ring keeps the smallest radius and `lint` tells the author to drop a chord label. The ring does not
 * flex with the width: a wider ring is also a taller one, and a sparse frame scales the block up anyway.
 */
function ring(d: Dom): Laid {
  const { nodes, edges } = d.body;
  const N = nodes.length;
  const at = new Map(nodes.map((n, i) => [n.key, i]));
  const step = (2 * Math.PI) / N;
  const theta = (k: string) => -Math.PI / 2 + at.get(k)! * step;
  const gmin = token('--graph-rank-gap-min'), sep = token('--graph-node-gap-min'), gap = token('--space-2');
  const spread = token('--edge-spread'), headLen = token('--space-2'), fine = token('--space-1');
  const keys = new Set(edges.map(e => e.key));
  // Each edge: clockwise (cw 1) or not (-1) round the ring, `off` from its radius; or a chord (cw 0).
  const ways = edges.map(e => {
    const i = at.get(e.from)!, j = at.get(e.to)!, both = keys.has(`${e.to}>${e.from}`);
    if (j === (i + 1) % N) return { e, cw: 1, off: N > 2 && both ? spread / 2 : 0 };
    if (j === (i + N - 1) % N) return { e, cw: -1, off: both ? -spread / 2 : 0 };
    // A chord drawn both ways: each runs `spread / 2` to its own right, so the two are apart.
    return { e, cw: 0, off: both ? spread / 2 : 0 };
  });
  type Box = { x: number; y: number; w: number; h: number };
  const hits = (a: Box, b: Box, m: number) => a.x < b.x + b.w + m && b.x < a.x + a.w + m && a.y < b.y + b.h + m && b.y < a.y + a.h + m;
  const holds = (b: Box, p: Pt, m: number) => p.x > b.x - m && p.x < b.x + b.w + m && p.y > b.y - m && p.y < b.y + b.h + m;

  /** Everything at radius R, centred on the origin. */
  const lay = (R: number) => {
    const c = (k: string): Pt => ({ x: R * Math.cos(theta(k)), y: R * Math.sin(theta(k)) });
    const box = (k: string): Box => { const n = d.nodes.get(k)!, p = c(k); return { x: p.x - n.w / 2, y: p.y - n.h / 2, w: n.w, h: n.h }; };
    /** How far round (radians) a circle of radius r runs from node k's centre, in direction s, before it leaves the node. */
    const leave = (k: string, r: number, s: number) => {
      const b = box(k), t = theta(k);
      let lo = 0, hi = Math.PI;
      for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (holds(b, { x: r * Math.cos(t + s * m), y: r * Math.sin(t + s * m) }, 0)) lo = m; else hi = m; }
      return hi;
    };
    // The free arc between each pair of neighbours.
    const free = N < 2 ? Infinity : Math.min(...nodes.map((n, i) => { const m = nodes[(i + 1) % N]!.key; return R * (step - leave(n.key, R, 1) - leave(m, R, -1)); }));
    const drawn = ways.map(({ e, cw, off }) => {
      const lab = d.edges.get(e.key)!.label;
      let path: string, head: string, samples: Pt[], mid: Pt, out: Pt;
      if (cw) {
        const r = R + off, f0 = theta(e.from) + cw * leave(e.from, r, cw);
        const f1 = theta(e.from) + cw * (step - leave(e.to, r, -cw));
        const fe = f1 - (cw * headLen) / r;
        const p = (f: number): Pt => ({ x: r * Math.cos(f), y: r * Math.sin(f) });
        const a = p(f0), z = p(fe), tip = p(f1);
        path = `M${num(a.x)} ${num(a.y)} A${num(r)} ${num(r)} 0 ${Math.abs(fe - f0) > Math.PI ? 1 : 0} ${cw > 0 ? 1 : 0} ${num(z.x)} ${num(z.y)}`;
        head = arrow(tip, { x: cw * Math.sin(f1), y: -cw * Math.cos(f1) });
        const n = Math.max(2, Math.ceil((r * Math.abs(f1 - f0)) / fine));
        samples = Array.from({ length: n + 1 }, (_, i) => p(f0 + ((f1 - f0) * i) / n));
        const fm = (f0 + f1) / 2;
        mid = { x: Math.cos(fm) * r, y: Math.sin(fm) * r };
        out = { x: Math.cos(fm) * (off < 0 ? -1 : 1), y: Math.sin(fm) * (off < 0 ? -1 : 1) };
      } else {
        const a0 = c(e.from), b0 = c(e.to), len = Math.hypot(b0.x - a0.x, b0.y - a0.y);
        const u = { x: (b0.x - a0.x) / len, y: (b0.y - a0.y) / len };
        const a = { x: a0.x - u.y * off, y: a0.y + u.x * off }, b = { x: b0.x - u.y * off, y: b0.y + u.x * off };
        const toEdge = (k: string) => { const n = d.nodes.get(k)!; return Math.min(n.w / 2 / Math.abs(u.x || 1e-9), n.h / 2 / Math.abs(u.y || 1e-9)); };
        const s = { x: a.x + u.x * toEdge(e.from), y: a.y + u.y * toEdge(e.from) };
        const tip = { x: b.x - u.x * toEdge(e.to), y: b.y - u.y * toEdge(e.to) };
        const z = { x: tip.x - u.x * headLen, y: tip.y - u.y * headLen };
        path = `M${num(s.x)} ${num(s.y)} L${num(z.x)} ${num(z.y)}`;
        head = arrow(tip, { x: -u.x, y: -u.y });
        const span = Math.hypot(tip.x - s.x, tip.y - s.y), n = Math.max(2, Math.ceil(span / fine));
        samples = Array.from({ length: n + 1 }, (_, i) => ({ x: s.x + ((tip.x - s.x) * i) / n, y: s.y + ((tip.y - s.y) * i) / n }));
        mid = { x: s.x + (tip.x - s.x) / 3, y: s.y + (tip.y - s.y) / 3 };
        const nrm = { x: -u.y, y: u.x }, away = nrm.x * mid.x + nrm.y * mid.y >= 0 ? 1 : -1;
        out = { x: nrm.x * away, y: nrm.y * away };
      }
      let lbox: Box | undefined;
      if (lab) {
        const ext = (Math.abs(out.x) * lab.w) / 2 + (Math.abs(out.y) * lab.h) / 2;
        const cx = mid.x + out.x * (gap + ext), cy = mid.y + out.y * (gap + ext);
        lbox = { x: cx - lab.w / 2, y: cy - lab.h / 2, w: lab.w, h: lab.h };
      }
      return { e, path, head, samples, lbox };
    });
    const boxes = nodes.map(n => ({ k: n.key, b: box(n.key) }));
    const clash = () => {
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) if (hits(boxes[i]!.b, boxes[j]!.b, sep)) return true;
      const labs = drawn.flatMap(x => (x.lbox ? [x.lbox] : []));
      for (let i = 0; i < labs.length; i++) {
        if (boxes.some(n => hits(n.b, labs[i]!, gap))) return true;
        for (let j = i + 1; j < labs.length; j++) if (hits(labs[i]!, labs[j]!, gap)) return true;
      }
      for (const x of drawn) {
        if (boxes.some(n => n.k !== x.e.from && n.k !== x.e.to && x.samples.some(p => holds(n.b, p, fine)))) return true;
        if (labs.some(l => x.samples.some(p => holds(l, p, fine)))) return true;
      }
      return false;
    };
    return { c, box, free, drawn, clash };
  };

  // The smallest radius with the neighbour gap, then grown until nothing touches.
  let lo = 0, hi = Math.max(1, ...nodes.map(n => d.nodes.get(n.key)!.w + d.nodes.get(n.key)!.h));
  if (N > 1) {
    while (lay(hi).free < gmin) hi *= 2;
    for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2; if (lay(m).free < gmin) lo = m; else hi = m; }
  } else hi = 0;
  // Growing stops at twice that radius: a clash left there is not one size can fix. The ring then keeps its base
  // size (doubling it only made a large frame of the same clash) and `lint` reports it as the author's.
  const base = hi;
  let L = lay(hi);
  while (N > 1 && L.clash() && hi < 2 * base) L = lay(hi += fine);
  d.crowded = N > 1 && L.clash();
  if (d.crowded) L = lay(base);

  // Bounds: boxes, labels, and the edges (with their arrowheads' width).
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const grow = (b: Box) => { x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); };
  for (const n of nodes) grow(L.box(n.key));
  for (const x of L.drawn) {
    if (x.lbox) grow(x.lbox);
    for (const p of x.samples) grow({ x: p.x - fine, y: p.y - fine, w: 2 * fine, h: 2 * fine });
  }
  for (const x of L.drawn) {
    const dom = d.edges.get(x.e.key)!;
    const g = `translate(${num(-x0)} ${num(-y0)})`;
    dom.path.setAttribute('d', x.path);
    dom.path.setAttribute('transform', g);
    dom.head.setAttribute('d', x.head);
    dom.head.setAttribute('transform', g);
    if (dom.label && x.lbox) Object.assign(dom.label.el.style, { left: `${num(x.lbox.x - x0)}px`, top: `${num(x.lbox.y - y0)}px` });
  }
  const shifted = new Map(nodes.map(n => { const p = L.c(n.key); return [n.key, { x: p.x - x0, y: p.y - y0 }]; }));
  return { w: x1 - x0, h: y1 - y0, nodes: shifted, points: new Map(), labels: new Map() };
}

/** A polyline with its corners rounded by up to `R`, never more than half of either adjoining segment. */
function rounded(pts: { x: number; y: number }[], R: number): string {
  const clean = pts.filter((p, i) => i === 0 || Math.hypot(p.x - pts[i - 1]!.x, p.y - pts[i - 1]!.y) > 0.01);
  if (clean.length < 2) return '';
  let d = `M${num(clean[0]!.x)} ${num(clean[0]!.y)}`;
  for (let i = 1; i < clean.length - 1; i++) {
    const a = clean[i - 1]!, b = clean[i]!, c = clean[i + 1]!;
    const l1 = Math.hypot(b.x - a.x, b.y - a.y), l2 = Math.hypot(c.x - b.x, c.y - b.y);
    const r = Math.min(R, l1 / 2, l2 / 2);
    const p1 = { x: b.x - ((b.x - a.x) / l1) * r, y: b.y - ((b.y - a.y) / l1) * r };
    const p2 = { x: b.x + ((c.x - b.x) / l2) * r, y: b.y + ((c.y - b.y) / l2) * r };
    d += ` L${num(p1.x)} ${num(p1.y)} Q${num(b.x)} ${num(b.y)} ${num(p2.x)} ${num(p2.y)}`;
  }
  const z = clean[clean.length - 1]!;
  return `${d} L${num(z.x)} ${num(z.y)}`;
}

const CSS = `
.gr-graph { position: relative; }
.gr-cap { margin-bottom: var(--label-gap); text-align: center; }
.gr-box { position: relative; margin: 0 auto; }
.gr-edges { position: absolute; left: 0; top: 0; overflow: visible; }
.gr-edge, .gr-head { --hl: 0; --now: 0; --recede: 0;
  --edge-ink: color-mix(in srgb, var(--ink-4) calc(var(--recede) * 100%),
              color-mix(in srgb, var(--hl-now-bar) calc(var(--now) * 100%),
              color-mix(in srgb, var(--hl-held-edge) calc(var(--hl) * 100%), var(--line-strong)))); }
.gr-edge { fill: none; stroke: var(--edge-ink); stroke-width: var(--stroke-edge); stroke-linecap: round; stroke-linejoin: round; }
.gr-head { fill: var(--edge-ink); stroke: none; }
.gr-node { position: absolute; display: flex; align-items: center; justify-content: center; padding: var(--space-1) var(--space-4); }
/* Labels are words, in the body face; backticks mark code, as in prose (round 5: mono read as code in science videos). */
.gr-label { font: var(--weight-medium) var(--text-node) / var(--leading-tight) var(--font-sans); white-space: pre;
  color: color-mix(in srgb, var(--hl-now-ink) calc(var(--now) * 100%), var(--ink-1)); }
.gr-label .x-em, .gr-label .x-code { font-weight: inherit; }
.gr-elabel { position: absolute; white-space: nowrap; }
.gr-etext { font: var(--weight-regular) var(--text-label) / var(--leading-tight) var(--font-sans);
  color: color-mix(in srgb, var(--hl-held-ink) calc(max(var(--hl), var(--now)) * 100%), var(--ink-2)); }
`;
