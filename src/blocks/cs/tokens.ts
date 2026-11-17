/**
 * `tokens` (CS pack): a full-width token strip (rule 1). Line 1 = lexemes (`""` empty, quotes for spaces),
 * optional line 2 = token types (drawn as small lowercase meta in the cell). `markers=cur,peek` adds markers
 * BELOW the cells; group brackets and labels sit ABOVE the span (rule 12), so the two can never collide.
 * The first marker lifts the cell it rests on and carries the now/held colours; later markers are lookahead
 * (`--peek`) and never highlight.
 */
import type { ItemDecl } from '../../ir.ts';
import type { BlockModule } from '../contract.ts';
import { scaleOf, anchorOf, channels, root, swapPlace, type Anchor, envelope, h, num, optical, showContent, style, token, type Envelope, caption } from '../kit.ts';

interface TokensBody { lexemes: string[]; types?: string[]; markers: string[] }
interface Cell { part: HTMLElement; env: Envelope; type?: HTMLElement }
interface Dom {
  strip: HTMLElement; cells: Cell[]; markers: { name: string; el: HTMLElement }[];
  groups: { id: string; from: number; to: number; el: HTMLElement; label: HTMLElement }[];
  /** Cell pitch and first cell's left edge, cached by measure (`geometry` reads them). */
  pitch: number; x0: number; w: number;
  /** Cell boxes for swaps, cached by geometry. */
  anchors: Map<string, Anchor>;
  /** Each marker label's width, cached by geometry (render places labels without reading layout). */
  labelW: number[];
  /** The narrowest a cell may be (its widest content plus padding), cached by measure for roomFix. */
  need: number;
  /** Each marker's rank in the scene's left-to-right order of labels (see markerOrder). */
  rank: number[];
}
const doms = new WeakMap<HTMLElement, Dom>();

/** Split a lexeme line: whitespace-separated, `"…"` quotes a lexeme with spaces, `""` is empty. */
export function lexemes(line: string): string[] {
  return [...line.matchAll(/"((?:[^"\\]|\\.)*)"|(\S+)/g)].map(m => (m[1] !== undefined ? m[1].replace(/\\(.)/g, '$1') : m[2]!));
}

export const tokens: BlockModule<TokensBody> = {
  type: 'tokens',
  pack: 'cs',
  args: { markers: 'string' },
  defaultRegion: 'top',
  flexible: true,
  parse(body, args, ctx) {
    const lines = body.filter(l => l.raw.trim());
    if (!lines.length || lines.length > 2)
      ctx.error(body[0]?.loc ?? { line: 0, col: 0 }, 'E131', `tokens takes 1 or 2 lines, got ${lines.length}`, 'write the lexemes on line 1 and, optionally, their types on line 2');
    const lex = lexemes(lines[0]!.raw);
    const types = lines[1] ? lexemes(lines[1].raw) : undefined;
    if (types && types.length !== lex.length)
      ctx.error(lines[1]!.loc, 'E132', `${lex.length} lexemes but ${types.length} types`, 'give one type per lexeme, in the same order');
    const markers = typeof args.markers === 'string' ? args.markers.split(',').map(s => s.trim()).filter(Boolean) : [];
    const items: ItemDecl[] = lex.map((_, i) => ({ key: String(i + 1), index: i + 1, kind: 'token', loc: lines[0]!.loc }));
    return { body: { lexemes: lex, ...(types ? { types } : {}), markers }, items };
  },
  verbs: {
    show: ['block', 'items'], hide: ['block', 'items'], hl: ['block', 'items', 'none'], dim: ['block', 'items'],
    set: ['items'], move: ['block', 'marker'], group: ['items'], swap: ['items'],
  },
  markers: body => body.markers,
  runtime: {
    mount(el, body, _args, reachable, text) {
      style('tokens', CSS);
      el.classList.add('k-tokens', 'xp');
      caption(el, text);
      if (reachable.groups.length) el.classList.add('k-has-groups');
      if (body.markers.length) el.classList.add('k-has-markers');
      const rank = markerOrder(body.markers, reachable.markers);
      const strip = h('div', 'k-strip', el);
      const cells = body.lexemes.map((lex, i) => {
        const key = String(i + 1);
        const part = h('div', 'k-cell x-cell xp', strip);
        const env = envelope(part, [lex], reachable.items[key], `k-lit ${optical(lex)}`.trim());
        env.el.dataset.essential = '';   // L406: a viewer must read it (never below --text-label)
        const type = body.types ? h('span', 'k-type', part) : undefined;
        if (type) { type.textContent = body.types![i]!.toLowerCase(); type.dataset.leaf = ''; }
        if (lex) env.el.dataset.declared = '';
        return { part, env, ...(type ? { type } : {}) };
      });
      const markers = body.markers.map((name, i) => {
        const m = h('div', `k-marker xp${i === 0 ? ' k-first' : ''}`, el);
        h('span', 'k-mbar', m);
        const label = h('span', 'k-mlabel', m);
        label.textContent = name;
        label.dataset.leaf = '';
        return { name, el: m };
      });
      const groups = reachable.groups.map(g => {
        const gEl = h('div', 'k-group xp', el);
        h('span', 'k-bracket', gEl);
        const label = h('span', 'k-glabel', gEl);
        label.textContent = g.label;
        label.dataset.leaf = '';
        return { id: g.id, from: g.from, to: g.to, el: gEl, label };
      });
      doms.set(el, { strip, cells, markers, groups, pitch: 0, x0: 0, w: 0, anchors: new Map(), labelW: [], need: 0, rank });
    },
    measure(el, width) {
      const d = doms.get(el)!;
      const n = d.cells.length, gap = token('--cell-gap');
      // Cells share the row, up to --cell-max. The narrowest a cell may be is its widest content plus padding,
      // not --cell-min: short entries (two-digit numbers) take narrower cells when the row needs it, so 16 to 20
      // of them fit a full-width strip. A strip with room never goes below --cell-min (share ≥ it).
      let need = 0;
      for (const c of d.cells) {
        c.part.style.width = 'max-content';
        need = Math.max(need, c.part.getBoundingClientRect().width / scaleOf(el) + 2 * token('--space-1'));
      }
      const share = (width - (n - 1) * gap) / n;
      const w = Math.min(token('--cell-max'), Math.max(need, share));
      const used = n * w + (n - 1) * gap;
      const x0 = Math.max(0, (width - used) / 2);
      d.cells.forEach((c, i) => Object.assign(c.part.style, { left: `${x0 + i * (w + gap)}px`, width: `${w}px` }));
      Object.assign(d, { pitch: w + gap, x0, w });
      d.need = need;
      el.style.width = `${Math.max(width, used)}px`;
      return { natural: used > width ? used : width, height: el.offsetHeight };
    },
    geometry(el) {
      const d = doms.get(el)!;
      d.anchors = new Map(d.cells.map((c, i) => [String(i + 1), anchorOf(c.part, el)]));
      for (const m of d.markers) m.el.style.width = `${d.w}px`;
      d.labelW = d.markers.map(m => (m.el.querySelector<HTMLElement>('.k-mlabel')?.offsetWidth ?? 0));
      for (const g of d.groups) {
        const left = d.x0 + (g.from - 1) * d.pitch;
        Object.assign(g.el.style, { left: `${left}px`, width: `${(g.to - g.from) * d.pitch + d.w}px` });
      }
    },
    roomFix(el) {
      // The limit, in tokens: how many cells of this strip's width fit the whole content row.
      const d = doms.get(el)!;
      const gap = token('--cell-gap'), row = token('--stage-w') - 2 * token('--margin-x');
      const fit = Math.max(1, Math.floor((row + gap) / (d.need + gap)));
      return `at most ${fit} tokens this wide fit a row: use two tokens blocks, one @top, or fewer or shorter tokens (every cell is as wide as the widest)`;
    },
    render(el, s) {
      const d = doms.get(el)!;
      root(el, s.self);
      const first = d.markers[0] ? s.markers[d.markers[0].name] : undefined;
      d.cells.forEach((c, i) => {
        const it = s.items[String(i + 1)];
        // The first marker lifts the cell it rests on: full at an integer position, shared while moving.
        const under = first ? first.vis * Math.max(0, 1 - Math.abs(first.at - (i + 1))) : 0;
        const hl = Math.max(it?.hl ?? 0, s.self.hl, under);
        channels(c.part, {
          vis: it?.vis ?? 1, hl,
          now: Math.max(it?.now ?? 0, s.self.now, under * (first?.now ?? 0)),
          recede: Math.max(it?.recede ?? 0, s.self.recede) * (1 - hl),
        });
        swapPlace(c.part, d.anchors, String(i + 1), it?.swap, 'x');
        showContent(c.env, it?.content);
      });
      const placed: Label[] = [];
      d.markers.forEach((m, i) => {
        const st = s.markers[m.name];
        if (st) {
          m.el.style.left = `${num(d.x0 + (st.at - 1) * d.pitch)}px`;
          channels(m.el, { vis: st.vis, now: st.now, recede: s.self.recede });
        }
        placed.push({ centre: d.x0 + ((st?.at ?? 1) - 1) * d.pitch + d.w / 2, w: d.labelW[i] ?? 0, vis: st?.vis ?? 0, rank: d.rank[i]! });
      });
      // Labels of markers on one cell (lo = mid = hi) sit side by side in the scene's order; a marker passing
      // another dips its label below for the moment they swap places (see placeLabels).
      const at = placeLabels(placed, token('--space-3'), token('--text-label'), d.pitch, 0, d.x0 * 2 + d.cells.length * d.pitch - token('--cell-gap'));
      d.markers.forEach((m, i) => {
        const label = m.el.querySelector<HTMLElement>('.k-mlabel')!;
        const { dx, dy } = at[i]!;
        label.style.translate = dx || dy ? `${num(dx)}px ${num(dy)}px` : '';
      });
      for (const g of d.groups) channels(g.el, { vis: s.groups.find(x => x.id === g.id)?.vis ?? 0, recede: s.self.recede });
    },
  },
};

/**
 * The left-to-right order of marker labels in a scene, from where the markers stand (`Reachable.markers`): a
 * marker that is somewhere left of another and never right of it comes first; markers that are always together,
 * or that cross (left of each other at different points), fall back to declaration order. Without positions,
 * declaration order. Returns each marker's rank.
 */
function markerOrder(names: string[], configs: Record<string, number>[] | undefined): number[] {
  const n = names.length;
  // before[a][b]: a stands left of b somewhere in the scene.
  const before = names.map(a => names.map(b => !!configs && configs.some(c => a in c && b in c && c[a]! < c[b]!)));
  const first = (a: number, b: number) => before[a]![b]! && !before[b]![a]!;
  // Never-crossing pairs form a partial order (a <= b <= c at every point gives a <= c); sort it topologically,
  // earliest declared first among the free.
  const rank = new Array<number>(n).fill(-1);
  for (let r = 0; r < n; r++) {
    const next = names.findIndex((_, i) => rank[i] === -1 && names.every((__, j) => j === i || rank[j] !== -1 || !first(j, i)));
    rank[next] = r;
  }
  return rank;
}

/** A marker label to place: where it wants to be centred, its width, visibility and rank in the scene's order. */
interface Label { centre: number; w: number; vis: number; rank: number }

/**
 * Where each marker label sits, as offsets from centred under its marker. Labels are ordered by their centre
 * nudged by rank (half a cell `cell` across all ranks), so markers on one cell order by rank and two markers
 * swap order only halfway between cells, never at rest. Overlapping labels pack side by side in that order (the
 * least-squares placement, kept inside [lo, hi]). Near a swap, the later-ranked label dips by `drop` and steps
 * out of the packing, so the swap never moves a label: first it dips at full width, then, below, it narrows to
 * nothing in the packing and slides to its own centre. Every offset is continuous in the markers' positions; at
 * rest no label dips, so nothing is reserved below the strip: the dip, mid-move, falls into the row gap below.
 */
function placeLabels(labels: Label[], gap: number, drop: number, cell: number, lo: number, hi: number): { dx: number; dy: number }[] {
  const n = labels.length, beta = cell / 2, eps = cell / (4 * Math.max(1, n));
  const key = labels.map(l => l.centre + (beta * l.rank) / Math.max(1, n));
  // f: how far into a swap each label is (1 at the swap point, 0 a quarter of the rank step away; at rest keys
  // are at least twice that apart).
  const f = labels.map((l, j) => Math.max(0, ...labels.map((m, i) => (m.rank < l.rank ? Math.min(1, m.vis) * Math.max(0, 1 - Math.abs(key[i]! - key[j]!) / eps) : 0))));
  const dip = f.map(v => Math.min(1, 2 * v)), out = f.map(v => Math.max(0, 2 * v - 1));
  const u = labels.map((l, i) => Math.min(1, l.vis) * (1 - out[i]!));
  const ids = labels.map((_, i) => i).sort((a, b) => key[a]! - key[b]! || labels[a]!.rank - labels[b]!.rank);
  const half = ids.map(i => (u[i]! * (labels[i]!.w + gap)) / 2);
  const D = [0];
  for (let k = 1; k < ids.length; k++) D.push(D[k - 1]! + half[k - 1]! + half[k]!);
  const ext = (k: number) => (u[ids[k]!]! * labels[ids[k]!]!.w) / 2;
  const A = lo + (ids.length ? ext(0) : 0), B = Math.max(A, hi - (ids.length ? ext(ids.length - 1) : 0) - (D.at(-1) ?? 0));
  // Pool adjacent violators on t_k = centre_k - D_k (kept in [A, B]), weighted by presence: x_k = pool mean + D_k.
  const pools: { sum: number; wt: number; n: number }[] = [];
  ids.forEach((i, k) => {
    const wt = Math.max(1e-6, u[i]!);
    pools.push({ sum: wt * Math.min(B, Math.max(A, labels[i]!.centre - D[k]!)), wt, n: 1 });
    while (pools.length > 1 && pools.at(-2)!.sum / pools.at(-2)!.wt > pools.at(-1)!.sum / pools.at(-1)!.wt) {
      const b = pools.pop()!, a = pools.pop()!;
      pools.push({ sum: a.sum + b.sum, wt: a.wt + b.wt, n: a.n + b.n });
    }
  });
  const x = new Array<number>(n).fill(0);
  let k = 0;
  for (const p of pools) for (let j = 0; j < p.n; j++, k++) x[ids[k]!] = p.sum / p.wt + D[k]!;
  return labels.map((l, i) => {
    const own = Math.min(Math.max(l.centre, lo + l.w / 2), Math.max(lo + l.w / 2, hi - l.w / 2));
    return { dx: x[i]! + out[i]! * (own - x[i]!) - l.centre, dy: dip[i]! * drop };
  });
}

const CSS = `
.k-tokens { position: relative; }
.k-tokens > .x-cap { text-align: center; }   /* the cells are centred in the strip */
.k-strip { position: relative; height: var(--cell-h); }
.k-has-groups { padding-top: calc(var(--text-label) + var(--space-2) + var(--space-2) + var(--space-1)); }
.k-has-markers { padding-bottom: calc(var(--space-2) + var(--stroke-mark) + var(--space-2) + var(--text-label)); }
.k-cell { position: absolute; top: 0; height: var(--cell-h); display: flex; flex-direction: column; align-items: center;
  justify-content: center; gap: var(--space-1); }
.k-lit { font: var(--weight-medium) var(--text-token) / var(--leading-tight) var(--font-mono); white-space: pre;
  color: color-mix(in srgb, var(--hl-now-ink) calc(var(--now) * 100%), var(--ink-1)); }
.k-type { font: var(--weight-regular) var(--text-meta) / var(--leading-tight) var(--font-sans); color: var(--ink-3); white-space: nowrap; }
.k-marker { position: absolute; top: calc(100% - var(--space-2) - var(--stroke-mark) - var(--space-2) - var(--text-label)); display: flex;
  flex-direction: column; align-items: center; gap: var(--space-2); translate: none; }
.k-mbar { display: block; width: 100%; height: var(--stroke-mark); background: var(--peek); }
.k-mlabel { font: var(--weight-medium) var(--text-label) / 1 var(--font-sans); color: var(--peek); white-space: nowrap; }
.k-first .k-mbar { background: color-mix(in srgb, var(--hl-now-bar) calc(var(--now) * 100%), var(--hl-held-bar)); }
.k-first .k-mlabel { color: color-mix(in srgb, var(--hl-now-ink) calc(var(--now) * 100%), var(--hl-held-ink)); }
.k-group { position: absolute; top: 0; height: calc(var(--text-label) + var(--space-2) + var(--space-2)); }
.k-glabel { position: absolute; left: 0; top: 0; font: var(--weight-medium) var(--text-label) / 1 var(--font-sans);
  color: var(--ink-2); white-space: nowrap; }
.k-bracket { position: absolute; left: 0; right: 0; bottom: 0; height: var(--space-2); border: var(--stroke-hair) solid var(--ink-3);
  border-bottom: 0; border-radius: var(--stroke-mark) var(--stroke-mark) 0 0; }
`;
