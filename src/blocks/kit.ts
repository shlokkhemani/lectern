/**
 * Shared runtime helpers for block modules: DOM creation, inline marks, content envelopes, channel
 * variables and the two highlight looks (theme README rules 6–9). Everything visual is a theme token;
 * blocks set numbers (`--vis`, `--hl`, `--now`, `--recede`, `--grow`) and the CSS here turns them into
 * colour and opacity, so no block computes a colour or a duration.
 *
 * Conventions every block follows:
 * - A "part" (`.xp`) is anything with its own channels: the block root, an item, a marker. Its opacity is
 *   `vis` × the recede level and it rises `--appear-rise` while appearing. Nested parts multiply `vis` only:
 *   recession is applied once, on the part that draws (rule 8: now > held > rest > receded). The block root
 *   owns visibility and never recedes itself (`root`); each drawn part takes its block's recession through
 *   `inherit`. A part that holds other drawn parts (a table row, a stack frame) does not recede either: its
 *   inner parts take `inherit(outer, inner)`, so a highlighted part is never under a receded one.
 * - Swapped items move by `swapPlace` from anchors cached in `geometry`; it is a pure function of state.
 * - Leaves the lint must check carry `data-leaf`; leaves that must show declared text carry `data-declared`.
 * - Bars and fills are real elements, never pseudo-elements, so lint can see them.
 */
import type { Inline } from '../ir.ts';
import type { Channels, Content } from './contract.ts';

export const SVG_NS = 'http://www.w3.org/2000/svg';

/** Create an element with classes, optionally appended to `parent`. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, parent?: Element | null): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (parent) parent.appendChild(e);
  return e;
}

/** A block's `"quoted caption"` above its content, for blocks whose own layout has no caption slot. */
export function caption(el: HTMLElement, text: string | undefined): void {
  if (!text) return;
  const cap = h('div', 'x-caption x-cap', el);
  cap.textContent = text;
  cap.dataset.leaf = '';
}

export function svg<K extends keyof SVGElementTagNameMap>(tag: K, parent?: Element | null): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVG_NS, tag);
  if (parent) parent.appendChild(e);
  return e;
}

/** Inject a block type's stylesheet once per document. */
export function style(id: string, css: string): void {
  if (document.querySelector(`style[data-css="${id}"]`)) return;
  if (id !== 'kit') style('kit', KIT_CSS);   // first, so block rules win over kit rules of equal specificity
  const s = document.createElement('style');
  s.dataset.css = id;
  s.textContent = css;
  document.head.appendChild(s);
}

const tokens = new Map<string, number>();

/** Read a numeric theme token in CSS px (or unitless) from the document root. The page's one token reader. */
export function token(name: string): number {
  const hit = tokens.get(name);
  if (hit !== undefined) return hit;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const n = parseFloat(v);
  if (!Number.isFinite(n)) throw new Error(`theme token ${name} is missing or not a number ("${v}")`);
  tokens.set(name, n);
  return n;
}

const ROLE_CLASS = { code: 'x-code', em: 'x-em', alt: 'x-alt', ok: 'x-ok', bad: 'x-bad', box: 'x-box' } as const;

/**
 * Inline marks → DOM. Strings become text nodes (so nothing is ever parsed as HTML and no value is
 * stringified); roles become spans with a mark class. `optical` lowers or raises lone low/high glyphs.
 */
export function inline(parent: Element, content: Inline): void {
  for (const run of content) {
    if (typeof run === 'string') parent.appendChild(document.createTextNode(run));
    else {
      const s = h('span', ROLE_CLASS[run.role], parent);
      inline(s, run.children);
    }
  }
}

/** Plain text of an inline, marks removed. */
export function plain(content: Inline): string {
  return content.map(r => (typeof r === 'string' ? r : plain(r.children))).join('');
}

/** Stable identity of an inline, for envelope lookup. */
export const inlineKey = (c: Inline): string => JSON.stringify(c);

/** Glyph class for optical centring (rule 14): lone low glyphs rise, `*` drops. */
export function optical(text: string): '' | 'x-low' | 'x-high' {
  const t = text.trim();
  if (/^[,;._]+$/.test(t)) return 'x-low';
  if (t === '*') return 'x-high';
  return '';
}

/**
 * An envelope holds every content a part can show, stacked in one grid cell, so the part is sized once
 * to the largest of them and never changes geometry (§3.3 step 1). `show` crossfades prev → cur.
 */
export interface Envelope { el: HTMLElement; alts: Map<string, HTMLElement>; base: string }

/** Build an envelope inside `parent` for `base` (the declared content) plus every `reachable` content. */
export function envelope(parent: Element, base: Inline, reachable: Inline[] = [], cls = '', draw: (el: HTMLElement, c: Inline) => void = inline): Envelope {
  const el = h('span', `x-env ${cls}`.trim(), parent);
  el.dataset.leaf = '';
  const alts = new Map<string, HTMLElement>();
  for (const c of [base, ...reachable]) {
    const k = inlineKey(c);
    if (alts.has(k)) continue;
    // A replacement (anything but the declared content) is what a `set` brings: it flashes amber while now.
    const a = h('span', alts.size ? 'x-alt-slot x-set' : 'x-alt-slot', el);
    draw(a, c);
    alts.set(k, a);
  }
  const env = { el, alts, base: inlineKey(base) };
  showContent(env, undefined);
  return env;
}

/**
 * Show `content` in an envelope (undefined = the declared base). Mid-change, the old value fades out struck
 * through while the new one fades in; with no earlier value the change is from the declared content (a part's
 * first `set`); setting the value it already shows changes nothing. Content outside the envelope is flagged for L405.
 */
export function showContent(env: Envelope, content: Content | undefined): void {
  const { cur, prev, p } = contentKeys(env.base, content);
  let found = false;
  for (const [k, a] of env.alts) {
    const o = k === cur ? (prev === undefined ? 1 : p) : k === prev ? 1 - p : 0;
    if (k === cur) found = true;
    a.style.opacity = num(o);
    a.style.visibility = o > 0 ? 'visible' : 'hidden';
    a.classList.toggle('x-struck', k === prev);
  }
  if (found) delete env.el.dataset.missing; else env.el.dataset.missing = '';
}

/** Which alternative is current and which (if any) is fading out, as envelope keys. Shared with SVG envelopes. */
export function contentKeys(base: string, content: Content | undefined): { cur: string; prev?: string; p: number } {
  if (!content) return { cur: base, p: 1 };
  const cur = inlineKey(content.cur);
  const prev = content.p < 1 ? (content.prev ? inlineKey(content.prev) : base) : undefined;
  return prev === undefined || prev === cur ? { cur, p: 1 } : { cur, prev, p: content.p };
}

/** Numbers for inline styles: fixed precision so equal states produce identical DOM. */
export const num = (v: number): string => String(Math.round(v * 10000) / 10000);

/** Write channel values as CSS variables on a part. */
export function channels(el: HTMLElement | SVGElement, ch: Partial<Channels>): void {
  const s = el.style;
  if (ch.vis !== undefined) s.setProperty('--vis', num(ch.vis));
  if (ch.hl !== undefined) s.setProperty('--hl', num(ch.hl));
  if (ch.now !== undefined) s.setProperty('--now', num(ch.now));
  if (ch.recede !== undefined) s.setProperty('--recede', num(ch.recede));
  if (ch.grow !== undefined) s.setProperty('--grow', num(ch.grow));
}

/**
 * A drawn part's channels combined with its block's: a block-level hl or recede reaches every part, and a
 * highlighted part never recedes. A block-level now reaches parts only in prose (`prose`), where it lights
 * the emphasised runs; in cells, nodes and lines one amber part per block is the rule (theme rule 8).
 */
export function inherit(self: Channels, item: Channels | undefined, prose = false): Channels {
  const it = item ?? { vis: 1, hl: 0, now: 0, recede: 0, grow: self.grow };
  const hl = Math.max(it.hl, self.hl);
  return { vis: it.vis, hl, now: prose ? Math.max(it.now, self.now) : it.now, recede: Math.max(it.recede, self.recede) * (1 - hl), grow: it.grow };
}

/** The block root: visibility only. Its recession, highlight and now go to the parts it draws (`inherit`). */
export function root(el: HTMLElement | SVGElement, self: Channels): void {
  channels(el, { vis: self.vis, hl: 0, now: 0, recede: 0, grow: self.grow });
}

/**
 * The block's flexible pitch (layout fill rule 4a): the layout sets `--pitch` (1 to --flex-pitch-max) on a
 * sparse frame's blocks; blocks with rows or levels open their row pitch by it (CSS reads `var(--pitch, 1)`).
 */
export function pitchOf(el: HTMLElement): number {
  return parseFloat(getComputedStyle(el).getPropertyValue('--pitch')) || 1;
}

/** An item's box relative to its block, cached in `geometry` for swaps. */
export interface Anchor { x: number; y: number; w: number; h: number }

export function anchorOf(part: HTMLElement, block: HTMLElement): Anchor {
  const s = scaleOf(block), b = block.getBoundingClientRect(), r = part.getBoundingClientRect();
  return { x: (r.left - b.left) / s, y: (r.top - b.top) / s, w: r.width / s, h: r.height / s };
}

/**
 * Swap placement (`swap a:1 a:2`): the item travels to where its partner sits, aligned on the partner's far
 * edge when it comes from before it, so items of unequal size end up exactly exchanged along `axis`. A pure
 * function of state: no swap (or p = 0) puts the item home, so seeking backwards undoes it.
 */
export function swapPlace(part: HTMLElement, anchors: ReadonlyMap<string, Anchor>, key: string, swap: { with: string; p: number } | undefined, axis: 'x' | 'y'): void {
  const a = anchors.get(key), b = swap ? anchors.get(swap.with) : undefined;
  if (!a || !b || !swap || swap.p <= 0) { part.style.transform = ''; return; }
  const size = axis === 'x' ? 'w' : 'h';
  const target = a[axis] < b[axis] ? b[axis] + b[size] - a[size] : b[axis];
  const d = (target - a[axis]) * swap.p;
  part.style.transform = axis === 'x' ? `translateX(${num(d)}px)` : `translateY(${num(d)}px)`;
}

export const REST: Channels = { vis: 1, hl: 0, now: 0, recede: 0, grow: 1 };

/** The line look (code lines, table rows, text lines): a full-width band and a 2px bar at the field edge. */
export function lineBar(line: HTMLElement): HTMLElement {
  return h('span', 'x-bar', line);
}

/** Natural content width of an element, in CSS px, unaffected by its current width. */
export function maxContent(el: HTMLElement): number {
  const w = el.style.width;
  el.style.width = 'max-content';
  const r = el.getBoundingClientRect().width / scaleOf(el);
  el.style.width = w;
  return r;
}

/**
 * The narrowest width `el` can take without anything overflowing it (code runs never wrap, so they set it): found
 * by trying widths, so padding, markers, indents and centring all count exactly as the browser lays them out.
 */
export function unbreakable(el: HTMLElement): number {
  const saved = el.style.width;
  const fits = (w: number) => { el.style.width = `${w}px`; return el.scrollWidth <= w + 0.5; };
  let lo = 0, hi = Math.ceil(maxContent(el));
  if (!fits(hi)) { el.style.width = saved; return hi; }
  for (let i = 0; i < 10 && hi - lo > 1; i++) { const mid = (lo + hi) / 2; if (fits(mid)) hi = mid; else lo = mid; }
  el.style.width = saved;
  return Math.ceil(hi);
}

/**
 * The width `el` needs at its current width without the dead space wrapped text leaves (hug content): its width
 * less the room that every line leaves free, read from the browser's own line boxes (text, and inline boxes such
 * as code chips and envelopes, hidden alternatives included). A centred line leaves room on both sides. The
 * narrower width keeps every line break: if it would change the height, the current width is kept.
 */
export function hugWidth(el: HTMLElement): number {
  const s = scaleOf(el);
  const box = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  const left = box.left + (parseFloat(cs.paddingLeft) + parseFloat(cs.borderLeftWidth)) * s;
  const right = box.right - (parseFloat(cs.paddingRight) + parseFloat(cs.borderRightWidth)) * s;
  // Every painted fragment, with the block it is laid out in (the lines of one block are aligned together).
  const frags: { r: DOMRect; block: Element }[] = [];
  const blockOf = (e: Element) => { let b = e; while (b !== el && getComputedStyle(b).display.startsWith('inline') && b.parentElement) b = b.parentElement; return b; };
  // The boxes of a node's content; for text, of its glyphs only (a trailing space may hang past the line).
  const lines = (n: Node) => {
    const range = document.createRange();
    const t = n.nodeType === Node.TEXT_NODE ? n.textContent ?? '' : '';
    if (t) { range.setStart(n, t.length - t.trimStart().length); range.setEnd(n, t.trimEnd().length); } else range.selectNodeContents(n);
    return [...range.getClientRects()].filter(r => r.width || r.height);
  };
  const texts: Text[] = [];
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode())
    if (n.textContent?.trim() && n.parentElement) { texts.push(n as Text); for (const r of lines(n)) frags.push({ r, block: blockOf(n.parentElement) }); }
  // Inline boxes count with their padding (a code chip), but an atomic one (inline-block, inline-grid: an
  // envelope) whose text wraps fills the line it sits on, so only its text counts.
  for (const e of el.querySelectorAll<HTMLElement>('*')) {
    const display = getComputedStyle(e).display;
    if (!display.startsWith('inline')) continue;
    if (display !== 'inline' && new Set(lines(e).map(r => Math.round(r.top))).size > 1) continue;
    for (const r of e.getClientRects()) if (r.width || r.height) frags.push({ r, block: blockOf(e.parentElement ?? e) });
  }
  // Fragments of one block whose vertical centres fall inside each other's span make one line.
  const rows: { block: Element; top: number; bottom: number; l: number; r: number }[] = [];
  for (const { r, block } of frags.sort((a, b) => a.r.top - b.r.top)) {
    const c = (r.top + r.bottom) / 2;
    const row = rows.find(x => x.block === block && c >= x.top && c <= x.bottom);
    if (row) { row.l = Math.min(row.l, r.left); row.r = Math.max(row.r, r.right); row.top = Math.min(row.top, r.top); row.bottom = Math.max(row.bottom, r.bottom); }
    else rows.push({ block, top: r.top, bottom: r.bottom, l: r.left, r: r.right });
  }
  // Each line's room is measured inside the block it is laid out in (its own padding is not room).
  let free = Infinity;
  for (const row of rows) {
    const bs = getComputedStyle(row.block), br = row.block.getBoundingClientRect();
    const bl = row.block === el ? left : br.left + (parseFloat(bs.paddingLeft) + parseFloat(bs.borderLeftWidth)) * s;
    const brr = row.block === el ? right : br.right - (parseFloat(bs.paddingRight) + parseFloat(bs.borderRightWidth)) * s;
    free = Math.min(free, bs.textAlign === 'center' ? 2 * Math.min(brr - row.r, row.l - bl) : brr - row.r);
  }
  const width = box.width / s;
  if (!Number.isFinite(free) || free < 1) return width;
  // The narrower width must keep every break: the same height and the same lines in every run of text.
  const before = texts.map(t => lines(t).length).join(), height = box.height;
  const saved = el.style.width;
  const hugged = Math.ceil(width - free / s);
  el.style.width = `${hugged}px`;
  const same = Math.abs(el.getBoundingClientRect().height - height) <= 0.5 && el.scrollWidth <= hugged + 0.5 && texts.map(t => lines(t).length).join() === before;
  if (!same) { el.style.width = saved; return width; }
  return hugged;
}

/**
 * The accumulated CSS scale of an element (the layout scales sparse rows). Against the unrounded used width:
 * `offsetWidth` rounds, and a max-content width read through a rounded scale can come out under the text it holds.
 */
export function scaleOf(el: HTMLElement): number {
  const cs = getComputedStyle(el);
  const pad = cs.boxSizing === 'border-box' ? 0 : ['paddingLeft', 'paddingRight', 'borderLeftWidth', 'borderRightWidth'].reduce((a, k) => a + parseFloat(cs[k as 'paddingLeft']), 0);
  const w = parseFloat(cs.width) + pad;
  return el.offsetWidth && w > 0 ? el.getBoundingClientRect().width / w : 1;
}

const KIT_CSS = `
.xp {
  --vis: 1; --hl: 0; --now: 0; --recede: 0; --grow: 1;
  opacity: calc(var(--vis) * (1 - var(--recede) * (1 - var(--recede-opacity))));
  translate: 0 calc((1 - var(--vis)) * var(--appear-rise));
}
.x-env { display: inline-grid; vertical-align: top; }
.x-alt-slot { grid-area: 1 / 1; white-space: inherit; }
.x-struck { text-decoration: line-through; text-decoration-color: var(--ink-3); }
/* A replacement value is amber while it is the newest change (set flashes for --dur-settle), then its own ink. */
.x-set { color: color-mix(in srgb, var(--hl-now-ink) calc(var(--now) * 100%), currentColor); }
/* A code run never breaks across lines: prose wraps around it. */
.x-code { font-family: var(--font-mono); font-weight: var(--weight-medium); white-space: nowrap;
  color: color-mix(in srgb, var(--hl-now-ink) calc(var(--now) * 100%), var(--ink-1)); }
.x-em { font-weight: var(--weight-strong);
  color: color-mix(in srgb, var(--hl-now-ink) calc(var(--now) * 100%), var(--ink-1)); }
.x-alt { color: var(--mark-alt); }   /* the second referent of a contrast (rule 9) */
.x-ok { color: var(--ok); }
.x-bad { color: var(--error); }
.x-box { display: inline-block; padding: 0 var(--space-2); border-radius: var(--radius-cell);
  background: var(--ink-4); line-height: inherit; }
.x-low { transform: translateY(var(--optical-low)); }
.x-high { transform: translateY(var(--optical-high)); }
.x-band { background: color-mix(in srgb, var(--hl-fill-line) calc(var(--hl) * 100%), transparent); }
.x-bar { position: absolute; left: 0; top: 0; bottom: 0; width: var(--stroke-mark);
  background: color-mix(in srgb, var(--hl-now-bar) calc(var(--now) * 100%), var(--hl-held-bar));
  opacity: var(--hl); }
.x-cell { background: color-mix(in srgb, var(--hl-fill-cell) calc(var(--hl) * 100%), var(--surface-2));
  border-radius: var(--radius-cell); }
.x-glyph { color: color-mix(in srgb, var(--hl-now-ink) calc(var(--now) * 100%), var(--ink-1)); }
/* A caption names what a figure shows (sans); where it names a file or a command (code, terminal, trace), it is mono. */
.x-caption { font: var(--weight-regular) var(--text-label) / var(--leading-tight) var(--font-sans); color: var(--ink-3);
  white-space: nowrap; }
.x-cap { margin-bottom: var(--label-gap); }
.c-cap.x-caption, .tm-cap.x-caption, .tr-cap.x-caption { font-family: var(--font-mono); }
`;
