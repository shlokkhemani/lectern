/**
 * `tree`: indented two spaces per level; a line is `label` or `caption | label` (the caption is a label line
 * inside the node, above the label, so it can never meet an edge; narration reads it, so it is never meta). Items are nodes in DFS
 * order. Layout: d3-flextree on measured node sizes (rulings 12: nodes size to their label, min
 * `--node-w`); sibling gaps flex within `--tree-gap-min..max` to fill the region (rule 2); every level
 * shares one top, so orthogonal connectors run in the clear band between levels and cannot cross a node
 * (rule 13). Edges into a node draw first, then the node appears (`grow`).
 */
import type { Inline, ItemDecl } from '../../ir.ts';
import type { BlockModule, BlockState } from '../contract.ts';
import { flextree } from 'd3-flextree';
import { pitchOf, maxContent, scaleOf, root, channels, envelope, h, inherit, num, optical, plain, showContent, style, svg, token, type Envelope } from '../kit.ts';

interface Node { label: Inline; caption?: string; depth: number; parent: number }
interface TreeBody { nodes: Node[] }
interface NodeDom { part: HTMLElement; env: Envelope; edge?: SVGPathElement; w: number; h: number; x: number; y: number }
interface Dom { svg: SVGSVGElement; box: HTMLElement; nodes: NodeDom[]; cap?: HTMLElement }
const doms = new WeakMap<HTMLElement, Dom>();

export const tree: BlockModule<TreeBody> = {
  type: 'tree',
  pack: 'core',
  args: {},
  flexible: true,
  parse(body, _args, ctx) {
    const nodes: Node[] = [];
    const items: ItemDecl[] = [];
    const stack: number[] = [];
    for (const l of body) {
      if (!l.text.trim()) continue;
      const indent = l.text.match(/^ */)![0].length;
      if (indent % 2) ctx.error(l.loc, 'E133', 'tree lines indent by two spaces per level', 'indent each child exactly two spaces more than its parent');
      const depth = indent / 2;
      if (depth > stack.length || (depth === 0 && nodes.length))
        ctx.error(l.loc, 'E134', depth === 0 ? 'a tree has one root' : 'this line is indented more than one level below its parent', depth === 0 ? 'indent this line under the root, or use a second tree' : 'indent it exactly one level (two spaces) deeper than the line above');
      stack.length = depth;
      const raw = l.text.trim();
      const bar = raw.indexOf(' | ');
      const caption = bar >= 0 ? raw.slice(0, bar).trim() : undefined;
      const label = ctx.inline(bar >= 0 ? raw.slice(bar + 3).trim() : raw, l.loc);
      nodes.push({ label, ...(caption ? { caption } : {}), depth, parent: depth ? stack[depth - 1]! : -1 });
      stack.push(nodes.length - 1);
      items.push({ key: String(nodes.length), index: nodes.length, kind: 'node', depth, loc: l.loc, ...(l.name ? { name: l.name } : {}) });
    }
    if (!nodes.length) ctx.error(body[0]?.loc ?? { line: 0, col: 0 }, 'E130', 'tree is empty', 'write the root on the first line and indent children two spaces');
    return { body: { nodes }, items };
  },
  verbs: { show: ['block', 'items'], hide: ['block', 'items'], hl: ['block', 'items', 'none'], dim: ['block', 'items'], set: ['items'], grow: ['block', 'items'] },
  runtime: {
    mount(el, body, _args, reachable, caption) {
      style('tree', CSS);
      el.classList.add('r-tree', 'xp');
      const cap = caption ? h('div', 'x-caption r-cap', el) : undefined;
      if (cap) { cap.textContent = caption!; cap.dataset.leaf = ''; }
      const box = h('div', 'r-box', el);
      const lines = svg('svg', box);
      lines.setAttribute('class', 'r-edges');
      const nodes = body.nodes.map((n, i) => {
        const key = String(i + 1);
        const part = h('div', `r-node x-cell xp${n.caption ? ' r-captioned' : ''}`, box);
        if (n.caption) { const c = h('span', 'r-ncap', part); c.textContent = n.caption; c.dataset.leaf = ''; c.dataset.essential = ''; }
        const env = envelope(part, n.label, reachable.items[key], `r-label ${optical(plain(n.label))}`.trim());
        env.el.dataset.essential = '';   // L406: a viewer must read it (never below --text-label)
        env.el.dataset.declared = '';
        let edge: SVGPathElement | undefined;
        if (n.parent >= 0) {
          edge = svg('path', lines);
          edge.setAttribute('class', 'r-edge');
          edge.dataset.edge = '';
        }
        return { part, env, ...(edge ? { edge } : {}), w: 0, h: 0, x: 0, y: 0 };
      });
      doms.set(el, { svg: lines, box, nodes, ...(cap ? { cap } : {}) });
      treeBodies.set(el, body);
    },
    measure(el, width) {
      const d = doms.get(el)!, body = treeBodies.get(el)!;
      const minW = token('--node-w'), minH = token('--node-h');
      for (const n of d.nodes) {
        // Intrinsic size: clear the size the previous measure wrote, else it feeds back (and ceil ratchets it).
        Object.assign(n.part.style, { width: 'max-content', height: '' });
        const r = n.part.getBoundingClientRect(), s = scaleOf(el);
        n.w = Math.ceil(Math.max(minW, r.width / s) - 0.01);
        n.h = Math.ceil(Math.max(minH, r.height / s) - 0.01);
      }
      // Level pitch opens with --pitch (layout fill rule).
      const vgap = token('--tree-level') * pitchOf(el) - minH;
      const depth = Math.max(...body.nodes.map(n => n.depth));
      const levelH = Array.from({ length: depth + 1 }, (_, k) => Math.max(...d.nodes.filter((_, i) => body.nodes[i]!.depth === k).map(n => n.h)));
      const place = (gap: number) => {
        const layout = flextree<{ i: number; children: unknown[] }>({
          nodeSize: hn => [d.nodes[(hn.data as { i: number }).i]!.w, levelH[body.nodes[(hn.data as { i: number }).i]!.depth]! + vgap],
          spacing: gap,
        });
        const kids = (i: number): { i: number; children: unknown[] } => ({ i, children: body.nodes.map((n, j) => (n.parent === i ? j : -1)).filter(j => j >= 0).map(kids) });
        const root = layout.hierarchy(kids(0));
        layout(root);
        let left = Infinity, right = -Infinity;
        root.each(hn => { const n = d.nodes[(hn.data as { i: number }).i]!; n.x = hn.x - n.w / 2; n.y = hn.y; left = Math.min(left, n.x); right = Math.max(right, n.x + n.w); });
        for (const n of d.nodes) n.x -= left;
        return right - left;
      };
      const gmin = token('--tree-gap-min'), gmax = token('--tree-gap-max');
      let gap = gmax, used = place(gmax);
      if (used > width) {
        let lo = gmin, hi = gmax;
        for (let i = 0; i < 12; i++) { const mid = (lo + hi) / 2; if (place(mid) <= width) lo = mid; else hi = mid; }
        gap = lo;
        used = place(gap);
      }
      void gap;
      const height = levelH.reduce((a, b) => a + b, 0) + depth * vgap;
      for (const n of d.nodes) Object.assign(n.part.style, { left: `${n.x}px`, top: `${n.y}px`, width: `${n.w}px`, height: `${levelH[body.nodes[d.nodes.indexOf(n)]!.depth]}px` });
      Object.assign(d.box.style, { width: `${used}px`, height: `${height}px` });
      d.svg.setAttribute('width', String(used));
      d.svg.setAttribute('height', String(height));
      // The caption's own text width (a block-level caption's scrollWidth is just the block's current width).
      const cap = d.cap ? maxContent(d.cap) : 0;
      el.style.width = `${Math.max(used, cap)}px`;
      return { natural: Math.ceil(Math.max(used, cap)), height: el.offsetHeight };
    },
    geometry(el) {
      const d = doms.get(el)!, body = treeBodies.get(el)!;
      const R = token('--radius-edge'), spread = token('--edge-spread');
      body.nodes.forEach((n, i) => {
        const edge = d.nodes[i]!.edge;
        if (!edge) return;
        const p = d.nodes[n.parent]!, c = d.nodes[i]!;
        const sibs = body.nodes.map((m, j) => (m.parent === n.parent ? j : -1)).filter(j => j >= 0);
        const k = sibs.indexOf(i);
        const inset = R + token('--space-2');
        const room = Math.max(0, p.w / 2 - inset);
        const x2 = c.x + c.w / 2, y2 = c.y;
        // A child centred under its parent gets a straight drop (no jog); the others leave the parent's
        // bottom spread apart, so no two edges share a stub.
        const under = Math.abs(x2 - (p.x + p.w / 2)) <= room;
        const off = Math.max(-room, Math.min(room, (k - (sibs.length - 1) / 2) * spread));
        const x1 = under ? x2 : p.x + p.w / 2 + off, y1 = p.y + parseFloat(p.part.style.height);
        const my = (y1 + y2) / 2;
        const dx = x2 - x1, s = Math.sign(Math.round(dx));
        const r = Math.min(R, Math.abs(dx) / 2, (y2 - y1) / 2);
        edge.setAttribute('d', s === 0
          ? `M${num(x1)} ${num(y1)} V${num(y2)}`
          : `M${num(x1)} ${num(y1)} V${num(my - r)} Q${num(x1)} ${num(my)} ${num(x1 + s * r)} ${num(my)} H${num(x2 - s * r)} Q${num(x2)} ${num(my)} ${num(x2)} ${num(my + r)} V${num(y2)}`);
        const len = edge.getTotalLength();
        edge.style.strokeDasharray = num(len);
        edge.dataset.len = num(len);
      });
    },
    render(el, s) {
      const d = doms.get(el)!;
      root(el, s.self);
      if (d.cap) channels(d.cap, { recede: s.self.recede });
      d.nodes.forEach((n, i) => {
        const it = s.items[String(i + 1)];
        const ch = inherit(s.self, it);
        // Grow choreography: the incoming edge draws over the first half, the node appears over the second.
        const appear = n.edge ? Math.max(0, Math.min(1, (ch.vis - 0.5) * 2)) : ch.vis;
        channels(n.part, { ...ch, vis: appear });
        showContent(n.env, it?.content);
        if (n.edge) edgeState(n.edge, ch, it, s);
      });
    },
  },
};

const treeBodies = new WeakMap<HTMLElement, TreeBody>();

/** An edge takes its child's state: drawn by grow, amber when the child is now, ink-4 (not faded) when receded. */
function edgeState(edge: SVGPathElement, ch: { vis: number; hl: number; now: number; recede: number; grow: number }, _it: BlockState['items'][string] | undefined, _s: BlockState): void {
  const len = Number(edge.dataset.len ?? 0);
  const drawn = Math.min(1, Math.min(ch.grow, ch.vis) * 2);
  edge.style.strokeDashoffset = num(len * (1 - drawn));
  edge.style.opacity = drawn > 0 ? '1' : '0';
  channels(edge, { hl: ch.hl, now: ch.now, recede: ch.recede });
}


const CSS = `
.r-tree { position: relative; }
.r-cap { margin-bottom: var(--label-gap); text-align: center; }
.r-box { position: relative; margin: 0 auto; }
.r-edges { position: absolute; left: 0; top: 0; overflow: visible; }
.r-edge { --hl: 0; --now: 0; --recede: 0; fill: none; stroke-width: var(--stroke-edge); stroke-linecap: round; stroke-linejoin: round;
  stroke: color-mix(in srgb, var(--ink-4) calc(var(--recede) * 100%),
          color-mix(in srgb, var(--hl-now-bar) calc(var(--now) * 100%),
          color-mix(in srgb, var(--hl-held-edge) calc(var(--hl) * 100%), var(--line-strong)))); }
.r-node { position: absolute; display: flex; flex-direction: column; align-items: center; justify-content: center;
  padding: var(--space-1) var(--space-3); }
.r-label { font: var(--weight-medium) var(--text-node) / var(--leading-tight) var(--font-mono); white-space: pre;
  color: color-mix(in srgb, var(--hl-now-ink) calc(var(--now) * 100%), var(--ink-1)); }
.r-label .x-em, .r-label .x-code { font-weight: inherit; }
.r-ncap { font: var(--weight-regular) var(--text-label) / var(--leading-tight) var(--font-sans); color: var(--ink-3); white-space: nowrap; }
`;
