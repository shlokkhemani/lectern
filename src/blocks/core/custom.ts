/**
 * `custom`: inert HTML or SVG for the rare picture no other block draws. The body is sanitised at compile
 * time against an allowlist (spec §3.4) and stored as a tree, so the page builds it with createElement and
 * never parses markup. Anything outside the allowlist is E150; malformed markup is E151. `src=path` reads the
 * markup from a file instead (relative to the script, as `code src=`; no body and no closing fence); from
 * there on it is the same block.
 *
 * Elements with `data-id="name"` are the items, keyed and named by that id, in document order. They take
 * S H L D, and `set` replaces their text. An SVG item with `data-along="ID start"` slides along the shape with that
 * id (`move`, `movers`): it is drawn where the author drew it, translated by the shape's displacement from `start`. Markup the author left unstyled (nothing set on the element or a
 * group around it) gets theme defaults: text is currentColor (`--ink-1`) in Geist, shapes rest on
 * `--surface-2`, lines are `--line-strong`, marker shapes take their line's stroke; so plain SVG looks native.
 * Highlight: anything painted in currentColor, fill or stroke, follows its item (amber now, `--hl-held-ink`
 * held); `--surface-2` fills lift to `--hl-fill-cell` and `--line-strong` strokes brighten like tree edges;
 * every other authored colour and stroke width stays as written. `var()` may name only the public theme
 * tokens (PUBLIC_TOKENS), and the classes `ok` `bad` `alt` colour text and strokes like the inline marks.
 *
 * Sizing: every top-level `<svg>` is drawn at 1 user unit = 1 CSS px, so its font sizes mean what they say,
 * and the layout scales the whole block with its region like any other block. Its box is its viewBox (or
 * `0 0 width height` without one), grown to take in anything drawn outside it; its own width and height
 * are otherwise ignored (W153). So the block's measured size is everything it paints: nothing draws past it.
 * Ids are scoped to the mounted block (`id="m"` and `url(#m)` / `href="#m"` inside it), so two SVGs on one
 * page never resolve each other's markers.
 */
import type { Inline, ItemDecl, Loc } from '../../ir.ts';
import type { BlockModule, Channels, Content, Movers, ParseCtx } from '../contract.ts';
import { channels, envelope, h, inherit, inline, maxContent, num, plain, showContent, style, SVG_NS, token, type Envelope } from '../kit.ts';

/** A sanitised node: text, or an element with its (allowed) attributes and children. */
type Node = string | { t: string; svg: boolean; a: [string, string][]; c: Node[]; line: number };
/**
 * `along`: the items that slide along a path (`data-along="ID start"`), by item key: the shape's id, where the
 * item is drawn on it (0..1 of its length), and whether the shape is closed (only forward round it). Absent when
 * no item has one, so a drawing without motion keeps its body as before.
 */
interface CustomBody { nodes: Node[]; along?: Record<string, Along> }
interface Along { path: string; start: number; closed: boolean }

const HTML_TAGS = new Set(['div', 'span', 'p', 'b', 'i', 'code', 'pre', 'ul', 'ol', 'li', 'table', 'tr', 'td', 'th', 'img']);
const SVG_TAGS = new Set(['svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'text', 'tspan', 'defs', 'marker', 'use']);
/** Rejected outright, with a reason the author can act on. */
const FORBIDDEN: Record<string, string> = {
  script: 'scripts never run in a video', iframe: 'embedded pages are not allowed', object: 'embedded objects are not allowed',
  embed: 'embedded objects are not allowed', video: 'video is not allowed', audio: 'audio is not allowed',
  foreignobject: 'foreignObject is not allowed', set: 'SVG animation (SMIL) is not allowed: animate with cues',
  style: 'stylesheets are not allowed: use a style="" attribute',
};
const SVG_ATTRS = new Set([
  'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'width', 'height', 'd', 'points', 'transform', 'viewbox',
  'preserveaspectratio', 'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linecap',
  'stroke-linejoin', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-miterlimit', 'opacity', 'font-size', 'font-family',
  'font-weight', 'font-style', 'text-anchor', 'dominant-baseline', 'alignment-baseline', 'letter-spacing', 'dx', 'dy',
  'marker-start', 'marker-mid', 'marker-end', 'markerwidth', 'markerheight', 'markerunits', 'refx', 'refy', 'orient',
  'href', 'xlink:href', 'xmlns', 'xmlns:xlink', 'id', 'vector-effect', 'paint-order', 'visibility', 'display', 'color',
]);
const HTML_ATTRS = new Set(['colspan', 'rowspan', 'id']);
const IMG_ATTRS = new Set(['src', 'width', 'height', 'alt']);
const VOID = new Set(['img']);
const ID = /^[a-z][a-z0-9-]*$/;
/**
 * Theme tokens custom markup may name with `var()`: the neutral ramp, the outcome and contrast hues, type
 * sizes, fonts, weights and strokes. Amber (`--accent`, `--hl-*`) is not here: it means "now", which cues
 * drive. Anything else in tokens.css is the engine's own and may change.
 */
const PUBLIC_TOKENS = [
  '--bg', '--surface-1', '--surface-2', '--surface-3', '--line', '--line-strong',
  '--ink-1', '--ink-2', '--ink-3', '--ink-4', '--ok', '--error', '--peek', '--mark-alt',
  '--text-meta', '--text-label', '--text-body', '--font-sans', '--font-mono',
  '--weight-regular', '--weight-medium', '--weight-strong', '--stroke-hair', '--stroke-edge', '--stroke-mark',
] as const;
const PUBLIC = new Set<string>(PUBLIC_TOKENS);

export const custom: BlockModule<CustomBody> = {
  type: 'custom',
  pack: 'core',
  args: { src: 'string' },
  flexible: false,
  contentOutsideItems: true,   // its drawing is shown from the start, even when every item starts hidden
  parse(body, args, ctx) {
    // From a file (`src=`), the markup is read and then checked exactly as a body is; a problem in it is reported
    // at the declaration, naming the file and its line there.
    const src = typeof args.src === 'string' ? args.src : undefined;
    const c = src ? inFile(src, ctx) : ctx;
    const text = src ? ctx.source(src, NOWHERE).join('\n') : body.map(b => b.raw).join('\n');
    const nodes = sanitise(text, src ? 1 : body[0]?.loc.line ?? 0, c);
    const items: ItemDecl[] = [];
    const walk = (n: Node) => {
      if (typeof n === 'string') return;
      const id = n.a.find(([k]) => k === 'data-id')?.[1];
      if (id !== undefined) {
        const loc = { line: n.line, col: 1 };
        if (!ID.test(id)) c.error(loc, 'E150', `data-id "${id}" is not a valid id`, 'use lowercase letters, digits and "-", starting with a letter');
        if (items.some(i => i.key === id)) c.error(loc, 'E150', `data-id "${id}" is used twice`, 'give every data-id element a distinct id');
        if (n.a.some(([k, v]) => k === 'opacity' || (k === 'style' && /(^|;)\s*opacity\s*:/i.test(v))))
          c.error(loc, 'E150', `data-id "${id}" sets its own opacity, which show, hide and dim drive`, 'put the opacity on an element inside it, or use a lighter colour');
        items.push({ key: id, index: items.length + 1, name: id, kind: 'element', loc: src ? NOWHERE : loc });
      }
      n.c.forEach(walk);
    };
    nodes.forEach(walk);
    if (!nodes.some(n => typeof n !== 'string' || n.trim()))
      ctx.error(body[0]?.loc ?? NOWHERE, 'E130', src ? `${src} is empty` : 'custom block is empty', src ? 'draw the SVG in that file' : 'write HTML or SVG between the fences');
    const along = alongOf(nodes, c);
    return { body: { nodes, ...(Object.keys(along).length ? { along } : {}) }, items };
  },
  verbs: { show: ['block', 'items'], hide: ['block', 'items'], hl: ['block', 'items', 'none'], dim: ['block', 'items'], set: ['items'], move: ['items'] },
  movers: body => pathMovers(body.along ?? {}),
  runtime: {
    // The author placed every part, so problems inside the block are theirs to fix, in their markup.
    authored: {
      outside: 'your custom content is drawn outside its own box: keep it inside the SVG viewBox (or the HTML box), or make it smaller',
      overlap: 'move one of them in the custom markup (custom content is drawn exactly where you put it), or make the text smaller',
      tiny: min => `draw it at its real size, font-size="${min}" or more, in a viewBox no wider than the room (${token('--stage-w') - 2 * token('--margin-x')} for a full row, about half that beside a block @left): an SVG is drawn at one user unit per CSS pixel`,
    },
    mount(el, body, _args, reachable, caption) {
      style('custom', CSS);
      el.classList.add('cu-custom', 'xp');
      if (caption) { const cap = h('div', 'x-caption cu-cap cu-rest', el); cap.textContent = caption; cap.dataset.leaf = ''; }
      const items = new Map<string, Item>();
      const box = h('div', 'cu-box', el);
      for (const n of body.nodes) build(n, box, false, reachable.items, items);
      const tops = [...box.querySelectorAll<SVGSVGElement>('svg:not(svg svg)')];
      // Each moving item and its shape, found by the id as written (before ids are scoped).
      const movers = Object.entries(body.along ?? {}).map(([key, a]): Mover => {
        const it = items.get(key)!.el as SVGGraphicsElement;
        const path = [...tops.find(t => t.contains(it))!.querySelectorAll<SVGGeometryElement>('[id]')].find(e => e.getAttribute('id') === a.path)!;
        const orig = it.getAttribute('transform') ?? '';
        // The attribute is there from mount on: added later, its place among the element's attributes (and so the
        // markup the cache keys on) would depend on what the page drew before.
        if (!orig) it.setAttribute('transform', 'translate(0 0)');
        return { key, el: it, path, home: a.start, closed: a.closed, orig, pts: [], root: [] };
      });
      scopeIds(box, `cu${++mounts}-`);
      const svgs = tops.map(svgBase);
      const parents = new Map<string, string>();
      for (const [key, it] of items) {
        const outer = it.el.parentElement?.closest<HTMLElement | SVGElement>('.cu-item');
        const okey = outer && [...items].find(([, o]) => o.el === outer)?.[0];
        if (okey) parents.set(key, okey);
      }
      markRest(box, new Set([...items.values()].map(i => i.el)));
      doms.set(el, { items, parents, paints: [], k: token('--recede-opacity'), svgs, movers });
    },
    measure(el, width) {
      // Sized on first measure, when the page is laid out and the fonts are in (text boxes depend on them).
      const d = doms.get(el)!;
      for (const s of d.svgs.splice(0)) fitSvg(s, d.movers.filter(m => s.el.contains(m.el)));
      // The caption and the content are both max-content, so the natural width counts whichever is wider.
      const natural = Math.ceil(maxContent(el));
      el.style.width = `${Math.min(natural, width)}px`;
      return { natural, height: el.offsetHeight };
    },
    geometry(el) {
      // Cache each item's resting paints, so render can mix the highlight into them without reading style.
      const d = doms.get(el)!;
      for (const p of d.paints) p.el.style.setProperty(p.prop, p.orig, p.priority);
      const probe = document.createElementNS(SVG_NS, 'rect');
      probe.style.fill = 'var(--surface-2)';
      probe.style.stroke = 'var(--line-strong)';
      el.appendChild(probe);
      const pcs = getComputedStyle(probe);
      const rest = pcs.fill, edge = pcs.stroke;
      probe.remove();
      d.paints = [];
      for (const [key, it] of d.items) {
        const paint = (p: HTMLElement | SVGElement, prop: string, kind: Paint['kind']) =>
          d.paints.push({ key, el: p, prop, base: getComputedStyle(p).getPropertyValue(prop), kind, orig: p.style.getPropertyValue(prop), priority: p.style.getPropertyPriority(prop) });
        // The item's colour: everything inside it painted in currentColor (text, by default) follows it.
        paint(it.el, 'color', 'ink');
        if (it.el instanceof HTMLElement) paint(it.el, 'background-color', 'lift');
        // The theme's resting paints highlight as in the theme's own blocks; any other colour stays as written.
        for (const p of [it.el, ...it.el.querySelectorAll('*')]) {
          if (!(p instanceof SVGGeometryElement)) continue;
          const cs = getComputedStyle(p);
          if (inkLines.has(p)) paint(p, 'stroke', 'ink');
          else if (cs.stroke === edge) paint(p, 'stroke', 'edge');
          if (cs.fill === rest) paint(p, 'fill', 'lift');
        }
      }
    },
    render(el, s) {
      const d = doms.get(el)!;
      // Recession is applied once per rendered part (review item 5): the root owns visibility only; content
      // outside any item recedes with the block through --cu-recede; each item recedes through inherit(), so a
      // highlighted item in a dimmed block stays at full strength.
      channels(el, { vis: s.self.vis });
      el.style.setProperty('--cu-recede', num(s.self.recede));
      const chans = new Map<string, Channels>();
      for (const [key, it] of d.items) {
        const ch = inherit(s.self, s.items[key]);
        chans.set(key, ch);
        if (it.env) showContent(it.env, s.items[key]?.content);
        if (it.svgAlts) showSvg(it.svgAlts, s.items[key]?.content);
      }
      for (const [key, it] of d.items) {
        const ch = chans.get(key)!;
        const outer = d.parents.get(key);
        // An item inside another item already shows its outer item's opacity: apply only the remainder.
        channels(it.el, { ...ch, recede: outer === undefined ? ch.recede : remainder(ch.recede, chans.get(outer)!.recede, d.k) });
      }
      // A moving item is drawn where the author drew it, shifted by its shape's displacement from its home.
      for (const m of d.movers) {
        const at = s.items[m.key]?.at;
        const p = at === undefined ? undefined : pointAt(m.pts, m.closed, at), o = pointAt(m.pts, m.closed, m.home);
        const dx = p ? num(p.x - o.x) : '0', dy = p ? num(p.y - o.y) : '0';
        m.el.setAttribute('transform', dx === '0' && dy === '0' && m.orig ? m.orig : `translate(${dx} ${dy})${m.orig ? ` ${m.orig}` : ''}`);
      }
      for (const p of d.paints) {
        const ch = chans.get(p.key)!;
        const pct = (v: number) => `${num(v * 100)}%`;
        let v = '';
        if (p.kind === 'ink' && (ch.now > 0 || ch.hl > 0))
          v = `color-mix(in srgb, var(--hl-now-ink) ${pct(ch.now)}, color-mix(in srgb, var(--hl-held-ink) ${pct(ch.hl)}, ${p.base}))`;
        else if (p.kind === 'edge' && (ch.now > 0 || ch.hl > 0))
          v = `color-mix(in srgb, var(--hl-now-bar) ${pct(ch.now)}, color-mix(in srgb, var(--hl-held-edge) ${pct(ch.hl)}, ${p.base}))`;
        else if (p.kind === 'lift' && ch.hl > 0) v = `color-mix(in srgb, var(--hl-fill-cell) ${pct(ch.hl)}, ${p.base})`;
        // At rest the authored declaration comes back as written, with its priority (review item 11).
        if (v) p.el.style.setProperty(p.prop, v);
        else p.el.style.setProperty(p.prop, p.orig, p.priority);
      }
    },
  },
};

/** No line of the script: the parser reports such a location at the block's declaration. */
const NOWHERE: Loc = { line: 0, col: 0 };

/** Reports for markup read from `path`: at the declaration, each message naming the file and its line. */
function inFile(path: string, ctx: ParseCtx): Pick<ParseCtx, 'error' | 'warn'> {
  const where = (loc: Loc) => ` (${path}, line ${loc.line})`;
  return {
    error: (loc, code, message, fix) => ctx.error(NOWHERE, code, message + where(loc), fix),
    warn: (loc, code, message, fix) => ctx.warn(NOWHERE, code, message + where(loc), fix),
  };
}

/**
 * The recede to give a nested part so that, under an outer part already at `outer`, it shows `inner` overall.
 * Opacity at recede r is 1 - r(1 - k); the nested part needs the ratio of the two. A nested part cannot be
 * brighter than its container, so a smaller `inner` than `outer` gives 0.
 */
export function remainder(inner: number, outer: number, k: number): number {
  const f = (r: number) => 1 - r * (1 - k);
  return Math.max(0, Math.min(1, (1 - f(inner) / f(outer)) / (1 - k)));
}

/**
 * Mark the content outside every item as `.cu-rest`, which recedes with the block: each maximal subtree
 * without items, and loose text beside items (wrapped so it can take opacity). A container that holds items
 * keeps its own paint at full strength, since dimming it would dim the items inside.
 */
function markRest(parent: Element, itemEls: Set<Element>): void {
  for (const c of [...parent.childNodes]) {
    if (c.nodeType === 3) {
      if (!c.textContent?.trim()) continue;
      const svgParent = parent instanceof SVGElement;
      if (svgParent && !(parent instanceof SVGTextContentElement)) continue;
      const wrap = svgParent ? document.createElementNS(SVG_NS, 'tspan') : document.createElement('span');
      wrap.setAttribute('class', 'cu-rest');
      parent.replaceChild(wrap, c);
      wrap.appendChild(c);
      continue;
    }
    if (!(c instanceof Element) || itemEls.has(c)) continue;
    if ([...itemEls].some(i => c.contains(i))) { markRest(c, itemEls); continue; }
    // The recession rule replaces an authored opacity, so carry the authored one into it.
    const e = c as HTMLElement | SVGElement;
    const own = e.style.opacity || e.getAttribute('opacity');
    if (own) { e.style.removeProperty('opacity'); e.removeAttribute('opacity'); e.style.setProperty('--cu-own', own); }
    e.classList.add('cu-rest');
  }
}

interface Item { el: HTMLElement | SVGElement; env?: Envelope; svgAlts?: Map<string, SVGElement> }
/**
 * A colour render mixes into: `base` is the computed colour at rest, `orig`/`priority` the authored inline
 * declaration. `ink`: amber while now, `--hl-held-ink` while held. `edge`: a `--line-strong` stroke, as a tree
 * edge (amber now, `--hl-held-edge` held). `lift`: a `--surface-2` fill, lifted to `--hl-fill-cell`.
 */
interface Paint { key: string; el: HTMLElement | SVGElement; prop: string; base: string; kind: 'ink' | 'edge' | 'lift'; orig: string; priority: string }
/** Lines with a marker whose currentColor stroke `fitSvg` resolved in place: they follow their item's colour. */
const inkLines = new WeakSet<Element>();
/** `parents`: item key → the item it sits inside. `k`: --recede-opacity. `svgs`: top-level SVGs still to size. */
const doms = new WeakMap<HTMLElement, { items: Map<string, Item>; parents: Map<string, string>; paints: Paint[]; k: number; svgs: SvgBox[]; movers: Mover[] }>();
/**
 * An item that slides along `path`. `pts`: the shape sampled every 2 px of its length, in the item's parent's user
 * units (where its `transform` applies), and `root` the same points in the top-level SVG's units; both filled when
 * the block is first measured. `orig`: the item's authored transform ('' for none), put back whenever it stands at home;
 * an item with none carries `translate(0 0)` there.
 */
interface Mover { key: string; el: SVGGraphicsElement; path: SVGGeometryElement; home: number; closed: boolean; orig: string; pts: Pt[]; root: Pt[] }
interface Pt { x: number; y: number }

/** The point at position `at` (a fraction of the length; a closed shape wraps) on a sampled shape, between samples. */
function pointAt(pts: Pt[], closed: boolean, at: number): Pt {
  const f = closed ? at - Math.floor(at) : Math.max(0, Math.min(1, at));
  const u = f * (pts.length - 1), i = Math.min(pts.length - 2, Math.floor(u)), r = u - i;
  const a = pts[i]!, b = pts[i + 1]!;
  return { x: a.x + (b.x - a.x) * r, y: a.y + (b.y - a.y) * r };
}

/**
 * Sample a mover's shape every 2 px. The item moves in its parent's units, so a shape under its own transforms
 * (or a different group) still carries the item as it is seen: inverse(parent CTM) × shape CTM. The two CTMs
 * share the outer layout's scale, so it cancels.
 */
function sample(m: Mover, toRoot: DOMMatrix): void {
  const len = m.path.getTotalLength();
  const n = Math.max(1, Math.ceil(len / 2));
  const parent = m.el.parentNode as SVGGraphicsElement;
  const shape = m.path.getScreenCTM() ?? new DOMMatrix();
  const inParent = (parent.getScreenCTM() ?? new DOMMatrix()).inverse().multiply(shape), inRoot = toRoot.multiply(shape);
  const at = Array.from({ length: n + 1 }, (_, i) => m.path.getPointAtLength(len * i / n));
  m.pts = at.map(p => { const q = p.matrixTransform(inParent); return { x: q.x, y: q.y }; });
  m.root = at.map(p => { const q = p.matrixTransform(inRoot); return { x: q.x, y: q.y }; });
}

/* ---------- runtime: sizing and id scope ---------- */

interface Box { x: number; y: number; w: number; h: number }
/** A top-level SVG and its authored box: the viewBox, else `0 0 width height`, else none. */
interface SvgBox { el: SVGSVGElement; base?: Box }

/** Mount counter: every mounted custom block gets its own id prefix, so ids never clash across a page. */
let mounts = 0;

/**
 * Read a top-level SVG's authored box and drop its width and height (the box decides the size). Until it is
 * fitted it is drawn at that box (or 1px), so it renders and its content can be measured.
 */
function svgBase(el: SVGSVGElement): SvgBox {
  const nums = (el.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/).map(Number);
  const px = (a: string) => { const m = /^\s*([\d.]+)\s*(px)?\s*$/.exec(el.getAttribute(a) ?? ''); return m ? Number(m[1]) : undefined; };
  const w = px('width'), h = px('height');
  const base = nums.length === 4 && nums.every(Number.isFinite) && nums[2]! > 0 && nums[3]! > 0
    ? { x: nums[0]!, y: nums[1]!, w: nums[2]!, h: nums[3]! }
    : w && h ? { x: 0, y: 0, w, h } : undefined;
  el.removeAttribute('width');
  el.removeAttribute('height');
  if (base) el.setAttribute('viewBox', `${base.x} ${base.y} ${base.w} ${base.h}`);
  el.style.width = `${base?.w ?? 1}px`;
  el.style.height = `${base?.h ?? 1}px`;
  return { el, ...(base ? { base } : {}) };
}

/**
 * Size a top-level SVG at 1 user unit = 1 CSS px: its box is the authored box grown to take in everything it
 * paints (hidden parts and every `set` alternative included), rounded out to whole px. Without an authored
 * box, it is what is painted.
 */
function fitSvg({ el, base }: SvgBox, movers: Mover[]): void {
  let drawn = painted(el);
  // A moving item adds its box everywhere along its shape, so it never leaves the block, at rest or in flight.
  const toRoot = el.getScreenCTM()?.inverse();
  for (const m of movers) {
    if (!toRoot) break;
    sample(m, toRoot);
    const own = painted(el, m.el);
    if (!own) continue;
    const o = pointAt(m.root, m.closed, m.home);
    for (const p of m.root) drawn = union(drawn ?? own, { ...own, x: own.x + p.x - o.x, y: own.y + p.y - o.y });
  }
  const u = base && drawn ? union(base, drawn) : base ?? drawn ?? { x: 0, y: 0, w: 0, h: 0 };
  const x = Math.floor(u.x), y = Math.floor(u.y);
  const w = Math.ceil(u.x + u.w) - x, h = Math.ceil(u.y + u.h) - y;
  el.setAttribute('viewBox', `${x} ${y} ${w} ${h}`);
  el.style.width = `${w}px`;
  el.style.height = `${h}px`;
  // An arrowhead fills with its line's stroke (context-stroke), but a currentColor stroke would resolve inside
  // the marker, not on the line: give each line that carries a marker its resolved stroke.
  for (const s of el.querySelectorAll<SVGElement>('[marker-start], [marker-mid], [marker-end], [style*="marker"]')) {
    if (s.style.stroke) continue;
    // A stroke that turns amber with its colour is currentColor (authors cannot name amber).
    const own = s.style.getPropertyValue('color'), priority = s.style.getPropertyPriority('color');
    s.style.setProperty('color', 'var(--hl-now-ink)', 'important');
    const cs = getComputedStyle(s);
    if (cs.stroke === cs.color) inkLines.add(s);
    s.style.setProperty('color', own, priority);
    s.style.stroke = getComputedStyle(s).stroke;
  }
}

const PAINTS = 'path, line, polyline, polygon, rect, circle, ellipse, text, image, use, foreignObject';
/** Content drawn only where something references it (a `use` or a marker), never in place. */
const UNDRAWN = 'defs, marker, symbol, clipPath, mask, pattern, linearGradient, radialGradient, filter';

/**
 * Everything a top-level SVG paints (or, given `within`, the part of it inside that element), in its own user
 * units: each part's geometry grown by its stroke and its markers in the part's own coordinates, then mapped
 * through every transform between it and the root, so a stroke inside `scale(4)` counts four times as wide.
 * Undefined when it paints nothing.
 */
function painted(root: SVGSVGElement, within?: Element): Box | undefined {
  const ctm = root.getScreenCTM();
  if (!ctm) return undefined;
  const toRoot = ctm.inverse();
  let box: Box | undefined, usePad = 0;
  const parts = [...root.querySelectorAll<SVGGraphicsElement>(PAINTS)].filter(s => !s.closest(UNDRAWN) && (!within || within.contains(s)));
  for (const s of parts) if (!(s instanceof SVGUseElement)) usePad = Math.max(usePad, strokeReach(s));
  for (const s of parts) {
    let bb: DOMRect;
    try { bb = s.getBBox(); } catch { continue; }
    if (!bb.width && !bb.height && !(s instanceof SVGGeometryElement && markersOf(s).length)) continue;
    // A `use` draws content defined elsewhere, whose strokes are not its own: pad it by the widest stroke here.
    const pad = s instanceof SVGUseElement ? usePad : strokeReach(s);
    const local: Box[] = [{ x: bb.x - pad, y: bb.y - pad, w: bb.width + 2 * pad, h: bb.height + 2 * pad }];
    if (s instanceof SVGGeometryElement) local.push(...markerBoxes(s, bb));
    const m = toRoot.multiply(s.getScreenCTM() ?? new DOMMatrix());
    for (const b of local) {
      const pts = [[b.x, b.y], [b.x + b.w, b.y], [b.x, b.y + b.h], [b.x + b.w, b.y + b.h]].map(([x, y]) => new DOMPoint(x, y).matrixTransform(m));
      const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
      const r = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
      box = box ? union(box, r) : r;
    }
  }
  return box;
}

/**
 * How far a part's stroke reaches past its geometry, in its own units: half the stroke width, times the
 * miter limit where a mitred corner can stick out further, times √2 where square caps reach out diagonally.
 */
function strokeReach(s: SVGGraphicsElement): number {
  const cs = getComputedStyle(s);
  if (cs.stroke === 'none') return 0;
  const half = (parseFloat(cs.strokeWidth) || 0) / 2;
  const cornered = !(s instanceof SVGLineElement || s instanceof SVGCircleElement || s instanceof SVGEllipseElement);
  const mitred = cornered && /miter|arcs/.test(cs.strokeLinejoin);
  const limit = s instanceof SVGRectElement ? Math.SQRT2 : parseFloat(cs.strokeMiterlimit) || 4;
  return half * Math.max(cs.strokeLinecap === 'square' ? Math.SQRT2 : 1, mitred ? limit : 1);
}

type MarkerSite = 'start' | 'mid' | 'end';
/** The markers a shape draws, with where they sit. */
function markersOf(s: SVGGeometryElement): { site: MarkerSite; m: SVGMarkerElement }[] {
  if (!(s instanceof SVGPathElement || s instanceof SVGLineElement || s instanceof SVGPolylineElement || s instanceof SVGPolygonElement)) return [];
  const cs = getComputedStyle(s);
  const out: { site: MarkerSite; m: SVGMarkerElement }[] = [];
  for (const [site, v] of [['start', cs.markerStart], ['mid', cs.markerMid], ['end', cs.markerEnd]] as const) {
    const id = /url\(\s*["']?#([^"')]+)["']?\s*\)/.exec(v)?.[1];
    const m = id ? document.getElementById(id) : null;
    if (m instanceof SVGMarkerElement) out.push({ site, m });
  }
  return out;
}

/**
 * The boxes a shape's markers paint, in the shape's units. A start or end marker is its painted area turned to
 * the path's direction there (`orient="auto"`; `auto-start-reverse` flips the start; a fixed angle is that
 * angle), with its ref point on the vertex. A mid marker can sit at any vertex at any angle: the path's box
 * grown by the furthest the marker reaches from its ref point.
 */
function markerBoxes(s: SVGGeometryElement, bb: DOMRect): Box[] {
  const out: Box[] = [];
  const total = s.getTotalLength(), eps = Math.min(0.5, total / 2);
  const w = parseFloat(getComputedStyle(s).strokeWidth) || 0;
  for (const { site, m } of markersOf(s)) {
    const { area, ref } = markerArea(m, w);
    const corners = [[area.x, area.y], [area.x + area.w, area.y], [area.x, area.y + area.h], [area.x + area.w, area.y + area.h]]
      .map(([x, y]) => [x! - ref.x, y! - ref.y] as const);
    if (site === 'mid') {
      const r = Math.max(...corners.map(([x, y]) => Math.hypot(x, y)));
      out.push({ x: bb.x - r, y: bb.y - r, w: bb.width + 2 * r, h: bb.height + 2 * r });
      continue;
    }
    const at = s.getPointAtLength(site === 'start' ? 0 : total);
    const a = s.getPointAtLength(site === 'start' ? 0 : total - eps), b = s.getPointAtLength(site === 'start' ? eps : total);
    const orient = m.getAttribute('orient') ?? '0';
    let angle = /^auto/.test(orient) ? Math.atan2(b.y - a.y, b.x - a.x) : (parseFloat(orient) || 0) * Math.PI / 180;
    if (orient === 'auto-start-reverse' && site === 'start') angle += Math.PI;
    const cos = Math.cos(angle), sin = Math.sin(angle);
    const pts = corners.map(([x, y]) => [at.x + x * cos - y * sin, at.y + x * sin + y * cos] as const);
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    out.push({ x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) });
  }
  return out;
}

/**
 * What a marker paints and its ref point, in the units of the shape that carries it (stroke width `w`): the
 * marker viewport when it clips (the default), else its viewport and its content.
 */
function markerArea(m: SVGMarkerElement, w: number): { area: Box; ref: { x: number; y: number } } {
  const k = m.markerUnits.baseVal === SVGMarkerElement.SVG_MARKERUNITS_USERSPACEONUSE ? 1 : w;
  const vw = m.markerWidth.baseVal.value * k, vh = m.markerHeight.baseVal.value * k;
  // Marker content units → viewport units: scale (sx, sy), then offset (ox, oy).
  let sx = k, sy = k, ox = 0, oy = 0;
  const vb = m.viewBox.baseVal;
  if (vb && vb.width > 0 && vb.height > 0) {
    sx = vw / vb.width; sy = vh / vb.height;
    const par = m.preserveAspectRatio.baseVal;
    const none = par.align === SVGPreserveAspectRatio.SVG_PRESERVEASPECTRATIO_NONE;
    if (!none) sx = sy = par.meetOrSlice === SVGPreserveAspectRatio.SVG_MEETORSLICE_SLICE ? Math.max(sx, sy) : Math.min(sx, sy);
    // xMin / xMid / xMax (and the same for y) place the scaled viewBox at the start, middle or end.
    const ax = none ? 0 : [0, 0.5, 1][(par.align - 2) % 3]!;
    const ay = none ? 0 : [0, 0.5, 1][Math.floor((par.align - 2) / 3)]!;
    ox = (vw - vb.width * sx) * ax - vb.x * sx;
    oy = (vh - vb.height * sy) * ay - vb.y * sy;
  }
  const ref = { x: m.refX.baseVal.value * sx + ox, y: m.refY.baseVal.value * sy + oy };
  let area: Box = { x: 0, y: 0, w: vw, h: vh };
  if (getComputedStyle(m).overflow === 'visible') {
    for (const c of m.querySelectorAll<SVGGraphicsElement>(PAINTS)) {
      let b: DOMRect;
      try { b = c.getBBox(); } catch { continue; }
      const pad = strokeReach(c);
      area = union(area, { x: (b.x - pad) * sx + ox, y: (b.y - pad) * sy + oy, w: (b.width + 2 * pad) * sx, h: (b.height + 2 * pad) * sy });
    }
  }
  return { area, ref };
}

function union(a: Box, b: Box): Box {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

/**
 * Prefix every id in a mounted block, and every reference to one of them inside it (`href="#m"`, `url(#m)`
 * in any attribute or style). A reference to an id the block does not declare is left as written.
 */
function scopeIds(box: Element, prefix: string): void {
  const els = [...box.querySelectorAll('*')];
  const ids = new Set(els.map(e => e.getAttribute('id')).filter((v): v is string => !!v));
  if (!ids.size) return;
  const ref = (id: string) => (ids.has(id) ? prefix + id : id);
  for (const e of els) for (const a of [...e.attributes]) {
    let v = a.value;
    if (a.name === 'id') v = prefix + v;
    else if (a.name === 'href' && v.startsWith('#')) v = `#${ref(v.slice(1))}`;
    else v = v.replace(/url\(\s*(['"]?)#([\w-]+)\1\s*\)/gi, (_m, q: string, id: string) => `url(${q}#${ref(id)}${q})`);
    if (v !== a.value) e.setAttribute(a.name, v);
  }
}

/* ---------- runtime: build the sanitised tree ---------- */

function build(n: Node, parent: Element, inSvg: boolean, reachable: Record<string, Inline[]>, items: Map<string, Item>): void {
  if (typeof n === 'string') {
    if (n.trim() || !inSvg) parent.appendChild(document.createTextNode(n));
    return;
  }
  const svgEl = inSvg || n.t === 'svg';
  const e = svgEl ? document.createElementNS(SVG_NS, n.t) : document.createElement(n.t);
  for (const [k, v] of n.a) {
    if (k === 'xmlns' || k === 'xmlns:xlink') continue;
    if (k === 'xlink:href') e.setAttribute('href', v); else e.setAttribute(k, v);
  }
  parent.appendChild(e);
  const id = n.a.find(([k]) => k === 'data-id')?.[1];
  const sets = id ? reachable[id] ?? [] : [];
  if (id && sets.length && !svgEl) {
    // HTML item with set values: its children are the declared alternative of an envelope.
    const env = envelope(e, [textOf(n)], sets, 'cu-env', (alt, c) => {
      if (plain(c) === textOf(n) && c.length === 1 && typeof c[0] === 'string') n.c.forEach(k => build(k, alt, false, reachable, items));
      else inline(alt, c);
    });
    if (textOf(n).trim()) env.el.dataset.declared = '';
    items.set(id, { el: e, env });
  } else if (id && sets.length && n.t === 'text') {
    // SVG text with set values: one sibling <text> per alternative, crossfaded by opacity.
    const alts = new Map<string, SVGElement>([[JSON.stringify([textOf(n)]), e as SVGElement]]);
    n.c.forEach(k => build(k, e, true, reachable, items));
    e.dataset.leaf = '';
    for (const c of sets) {
      const k = JSON.stringify(c);
      if (alts.has(k)) continue;
      const alt = e.cloneNode(false) as SVGElement;
      alt.removeAttribute('data-id');
      alt.textContent = plain(c);
      alt.dataset.leaf = '';
      parent.appendChild(alt);
      alts.set(k, alt);
    }
    const g = document.createElementNS(SVG_NS, 'g');
    parent.insertBefore(g, e);
    for (const a of alts.values()) g.appendChild(a);
    items.set(id, { el: g, svgAlts: alts });
  } else {
    n.c.forEach(k => build(k, e, svgEl, reachable, items));
    if (id) items.set(id, { el: e });
  }
  const it = id ? items.get(id) : undefined;
  if (it) it.el.classList.add('xp', 'cu-item');
  if (n.t === 'text' || (!svgEl && n.c.some(k => typeof k === 'string' && k.trim()))) {
    (e as HTMLElement).dataset.leaf = '';
    if (textOf(n).trim()) (e as HTMLElement).dataset.declared = '';
  }
}

function showSvg(alts: Map<string, SVGElement>, content: Content | undefined): void {
  const first = alts.keys().next().value!;
  const cur = content ? JSON.stringify(content.cur) : first;
  const from = content && content.p < 1 ? (content.prev ? JSON.stringify(content.prev) : first) : undefined;
  // Setting a value to itself is no change: it stays fully shown (review item 10).
  const prev = from === cur ? undefined : from;
  for (const [k, a] of alts) {
    const o = k === cur ? (prev === undefined ? 1 : content!.p) : k === prev ? 1 - content!.p : 0;
    a.style.opacity = num(o);
    a.style.visibility = o > 0 ? 'visible' : 'hidden';
  }
}

function textOf(n: Node): string {
  return typeof n === 'string' ? n : n.c.map(textOf).join('');
}

/* ---------- compile time: items that move along a path ---------- */

const SHAPES = new Set(['path', 'line', 'polyline', 'polygon', 'rect', 'circle', 'ellipse']);
const CLOSED = new Set(['polygon', 'rect', 'circle', 'ellipse']);
const NUM = /^[-+]?(\d+(\.\d*)?|\.\d+)$/;

/** Every `data-along` in the markup, checked: on an item, naming one stroke of a shape in the same `<svg>`, outside the item. */
function alongOf(nodes: Node[], c: Pick<ParseCtx, 'error'>): Record<string, Along> {
  const out: Record<string, Along> = {};
  const attr = (n: Exclude<Node, string>, k: string) => n.a.find(([a]) => a === k)?.[1];
  const elements = (n: Node): Exclude<Node, string>[] => (typeof n === 'string' ? [] : [n, ...n.c.flatMap(elements)]);
  const visit = (n: Node, svg: Exclude<Node, string> | undefined) => {
    if (typeof n === 'string') return;
    const top = svg ?? (n.t.toLowerCase() === 'svg' ? n : undefined);
    const value = attr(n, 'data-along');
    if (value !== undefined) {
      const loc = { line: n.line, col: 1 };
      const key = attr(n, 'data-id');
      if (key === undefined) c.error(loc, 'E150', 'data-along needs a data-id on the same element: cues name the item to move', 'add data-id="name" to it');
      const [id = '', start, ...extra] = value.trim().split(/\s+/);
      if (extra.length || (start !== undefined && (!NUM.test(start) || Number(start) < 0 || Number(start) > 1)))
        c.error(loc, 'E150', `data-along="${value}": the second word is where the item is drawn on the path, 0 to 1`, `write data-along="${id} 0.5", or drop the number for an item drawn at the path's start`);
      const shape = top && elements(top).find(e => attr(e, 'id') === id && SHAPES.has(e.t.toLowerCase()));
      if (!shape) c.error(loc, 'E150', `data-along="${id}" names no shape in this SVG`, `give the path it moves along id="${id}" (a path, line, polyline, polygon, rect, circle or ellipse in the same <svg>)`);
      if (elements(n).includes(shape!)) c.error(loc, 'E150', `"${key}" would carry its own path "${id}" with it`, 'move the path out of the element');
      const tag = shape!.t.toLowerCase(), d = attr(shape!, 'd') ?? '';
      if (tag === 'path' && (d.match(/[Mm]/g)?.length ?? 0) > 1)
        c.error({ line: shape!.line, col: 1 }, 'E150', `path "${id}" has more than one M: an item moves along one stroke`, 'keep one M in its d and draw the other strokes as separate paths');
      out[key!] = { path: id, start: start === undefined ? 0 : Number(start), closed: CLOSED.has(tag) || (tag === 'path' && /[Zz]\s*$/.test(d)) };
    }
    n.c.forEach(k => visit(k, top));
  };
  nodes.forEach(n => visit(n, undefined));
  return out;
}

/**
 * Items with `data-along` slide along their shape: a position is a fraction of its length, 0 its start and 1 its
 * end. Round a closed shape an item only goes forward, so a position past one turn counts the turns (0.75 then
 * 0.25 is 1.25; 1 from 0 is one whole turn): a backward orbit cannot be written by accident.
 */
function pathMovers(along: Record<string, Along>): Movers {
  return {
    home: Object.fromEntries(Object.entries(along).map(([k, a]) => [k, a.start])),
    stop(key, text, from, { target }) {
      const a = along[key];
      if (!a) return { message: `move on "${target}" needs a path to move along`, fix: `give the element with data-id="${key}" data-along="ID", the id of a line or path in the same SVG that runs from where it is to where it goes` };
      if (!text) return { message: '', fix: `write [move ${target} 1]` };
      const t = Number(text);
      if (!NUM.test(text) || t < 0 || t > 1) return { message: `move ${target} ${text}: a position on a path is a number from 0 (its start) to 1 (its end)`, fix: `write [move ${target} 0.5]` };
      if (!a.closed) return t;
      const turns = Math.floor(from + 1e-9), now = from - turns;
      return Math.abs(t - now) < 1e-9 ? from : t > now ? turns + t : turns + 1 + t;
    },
  };
}

/* ---------- compile time: the sanitiser ---------- */

const ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'", nbsp: ' ', times: '×', minus: '−', larr: '←', rarr: '→', middot: '·', hellip: '…' };

function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Parse and check markup. Every rejection names the offending construct and what to write instead. */
export function sanitise(src: string, firstLine: number, ctx: Pick<ParseCtx, 'error' | 'warn'>): Node[] {
  const root: Node[] = [];
  const stack: { n: Exclude<Node, string>; svg: boolean }[] = [];
  const kids = () => (stack.length ? stack[stack.length - 1]!.n.c : root);
  let pos = 0;
  const locAt = (i: number): Loc => {
    const before = src.slice(0, i);
    const nl = before.lastIndexOf('\n');
    return { line: firstLine + (before.match(/\n/g)?.length ?? 0), col: i - nl };
  };
  const reject = (i: number, msg: string, fix: string, code = 'E150'): never => ctx.error(locAt(i), code, msg, fix);
  while (pos < src.length) {
    const lt = src.indexOf('<', pos);
    const textEnd = lt < 0 ? src.length : lt;
    if (textEnd > pos) {
      const t = decode(src.slice(pos, textEnd));
      if (/javascript:/i.test(t) && stack.length && stack[stack.length - 1]!.svg) reject(pos, 'javascript: in SVG text', 'remove it');
      kids().push(t);
      pos = textEnd;
      continue;
    }
    if (src.startsWith('<!--', pos)) {
      const end = src.indexOf('-->', pos + 4);
      if (end < 0) ctx.error(locAt(pos), 'E151', 'HTML comment is not closed', 'close it with -->');
      pos = end + 3;
      continue;
    }
    if (src[pos + 1] === '/') {
      const m = /^<\/([A-Za-z][\w:-]*)\s*>/.exec(src.slice(pos));
      if (!m) ctx.error(locAt(pos), 'E151', 'malformed closing tag', 'write it as </tag>');
      const tag = m![1]!.toLowerCase();
      const top = stack.pop();
      if (!top || top.n.t.toLowerCase() !== tag) ctx.error(locAt(pos), 'E151', `</${tag}> does not close ${top ? `<${top.n.t}> (line ${top.n.line})` : 'any open element'}`, top ? `close <${top.n.t}> first` : `remove </${tag}>`);
      pos += m![0].length;
      continue;
    }
    const m = /^<([A-Za-z][\w:-]*)((?:\s+[^\s=/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*(\/?)>/.exec(src.slice(pos));
    if (!m) {
      if (/^<[!?]/.test(src.slice(pos))) reject(pos, 'doctype, CDATA and processing instructions are not allowed', 'start with the element itself, e.g. <svg …>');
      ctx.error(locAt(pos), 'E151', 'malformed tag', 'write tags as <tag attr="value"> … </tag>, or escape a literal < as &lt;');
    }
    const raw = m![1]!;
    const tag = raw.toLowerCase();
    const inSvg = stack.length > 0 && stack[stack.length - 1]!.svg;
    if (FORBIDDEN[tag] || tag.startsWith('animate')) reject(pos, `<${raw}> is not allowed: ${FORBIDDEN[tag] ?? 'SVG animation (SMIL) is not allowed: animate with cues'}`, 'remove it');
    const svgEl = inSvg || tag === 'svg';
    const allowed = svgEl ? SVG_TAGS.has(tag) : HTML_TAGS.has(tag);
    if (!allowed) reject(pos, `<${raw}> is not allowed in custom${svgEl ? ' SVG' : ' HTML'}`,
      `use only ${[...(svgEl ? SVG_TAGS : HTML_TAGS)].join(' ')}`);
    const attrs = readAttrs(m![2]!, tag, svgEl, (msg, fix, code) => reject(pos, msg, fix, code));
    if (tag === 'svg' && !inSvg) ignoredSize(attrs, (msg, fix) => ctx.warn(locAt(pos), 'W153', msg, fix));
    const node: Exclude<Node, string> = { t: svgEl ? raw : tag, svg: svgEl, a: attrs, c: [], line: locAt(pos).line };
    kids().push(node);
    pos += m![0].length;
    if (!m![3] && !VOID.has(tag)) stack.push({ n: node, svg: svgEl });
  }
  if (stack.length) ctx.error(locAt(src.length), 'E151', `<${stack[stack.length - 1]!.n.t}> (line ${stack[stack.length - 1]!.n.line}) is not closed`, `add </${stack[stack.length - 1]!.n.t}>`);
  return root;
}

function readAttrs(src: string, tag: string, svgEl: boolean, reject: (msg: string, fix: string, code?: string) => never): [string, string][] {
  const out: [string, string][] = [];
  for (const m of src.matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) {
    const name = m[1]!;
    const key = name.toLowerCase();
    const value = decode(m[2] ?? m[3] ?? m[4] ?? '');
    if (key.startsWith('on')) reject(`event handler ${name}="…" is not allowed`, 'remove it: a video has no events');
    if (/^\s*(javascript|vbscript):/i.test(value) || /javascript:/i.test(value)) reject(`${name} contains javascript:`, 'remove it');
    if (key === 'class' || key === 'data-id') { out.push([key, value]); continue; }
    if (key === 'data-along') {
      if (!svgEl) reject('data-along works on SVG elements', 'draw the item and its path inside one <svg>');
      out.push([key, value]);
      continue;
    }
    if (key === 'style') { out.push([key, cleanStyle(value, reject)]); continue; }
    if (key === 'href' || key === 'xlink:href') {
      if (tag !== 'use') reject(`${name} is allowed only on <use>`, 'remove it');
      if (!value.startsWith('#')) reject(`${name}="${value}" points outside the block`, 'reference an element in this block: href="#id"');
    }
    if (tag === 'img') {
      if (!IMG_ATTRS.has(key)) reject(`<img> does not take ${name}`, 'use src (a data:image URL), width, height and alt');
      if (key === 'src') {
        const m = /^data:image\/(png|jpeg|gif|webp);base64,([a-z0-9+/=\s]+)$/i.exec(value);
        if (!m) reject('<img> with an external or non-image src is not allowed', 'inline the image as src="data:image/png;base64,…", or draw it in SVG');
        const frames = frameCount(m![1]!.toLowerCase(), m![2]!.replace(/\s+/g, ''));
        if (frames === undefined) reject(`<img> data is not a readable ${m![1]} image`, 'inline a real PNG, JPEG, GIF or WebP file, base64-encoded');
        if (frames! > 1) reject(`<img> is an animated ${m![1]!.toUpperCase()} (${frames} frames); it would play on its own clock, not the video's`, 'export one still frame (PNG), or draw the motion as steps with show/set cues', 'E152');
      }
      out.push([key, value]);
      continue;
    }
    checkUrls(value, `${name}="${value}"`, reject);
    checkVars(value, `${name}="${value}"`, reject);
    const ok = svgEl ? SVG_ATTRS.has(key) : HTML_ATTRS.has(key);
    if (!ok) reject(`${name} is not allowed on <${tag}>`, svgEl ? 'use SVG geometry and presentation attributes, class, style and data-id' : 'use class, style and data-id (and colspan/rowspan on cells)');
    out.push([name, value]);
  }
  if (tag === 'img' && !out.some(([k]) => k === 'src')) reject('<img> has no src', 'inline the image as src="data:image/png;base64,…"');
  return out;
}

/**
 * W153: a top-level `<svg>`'s width or height that would change its size. It is drawn at its viewBox, 1 unit
 * = 1px, so a size that matches the viewBox is harmless and anything else (a scale, `100%`) is ignored.
 */
function ignoredSize(attrs: [string, string][], warn: (msg: string, fix: string) => void): void {
  const get = (k: string) => attrs.find(([a]) => a.toLowerCase() === k)?.[1];
  const vb = (get('viewbox') ?? '').trim().split(/[\s,]+/).map(Number);
  const box = vb.length === 4 && vb.every(Number.isFinite) && vb[2]! > 0 && vb[3]! > 0 ? { width: vb[2]!, height: vb[3]! } : undefined;
  const px = (v: string) => { const m = /^\s*([\d.]+)\s*(px)?\s*$/.exec(v); return m ? Number(m[1]) : undefined; };
  const odd = (['width', 'height'] as const).filter(k => {
    const v = get(k);
    if (v === undefined) return false;
    return box ? px(v) !== box[k] : px(v) === undefined;
  });
  if (!odd.length) return;
  const said = odd.map(k => `${k}="${get(k)}"`).join(' ');
  if (box) warn(`${said} on <svg> is ignored: custom SVG is drawn at its viewBox size, one unit to a pixel (${box.width} × ${box.height} here)`,
    'remove it; the drawing is its viewBox size in pixels (the layout may enlarge it, never shrink it), so write coordinates and font sizes in pixels (font-size="16" is 16 pixels)');
  else warn(`${said} on <svg> is ignored: without a viewBox the picture is sized to what it draws`,
    'give the <svg> a viewBox="0 0 w h" in px, or a width and height in px');
}

/** Every `var()` names a public theme token (PUBLIC_TOKENS); a typo or an engine-private token is rejected. */
function checkVars(value: string, what: string, reject: (msg: string, fix: string) => never): void {
  for (const m of value.matchAll(/var\(\s*([^\s,)]*)/gi))
    if (!PUBLIC.has(m[1]!)) reject(`${what} uses var(${m[1]}), which is not a public theme token`, `use one of: ${PUBLIC_TOKENS.join(' ')}`);
}

/**
 * Frames in a base64 image, or undefined if it does not parse as that format. Animated images play on the
 * browser's clock, so the same instant could show different frames (E152): GIF counts image descriptors,
 * PNG reads APNG's acTL frame count, WebP counts ANMF chunks. JPEG has one frame.
 */
export function frameCount(kind: string, b64: string): number | undefined {
  let b: Uint8Array;
  try { b = Uint8Array.from(atob(b64), c => c.charCodeAt(0)); } catch { return undefined; }
  const ascii = (i: number, n: number) => String.fromCharCode(...b.subarray(i, i + n));
  const u32 = (i: number) => ((b[i]! << 24) | (b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!) >>> 0;
  if (kind === 'jpeg') return b[0] === 0xff && b[1] === 0xd8 ? 1 : undefined;
  if (kind === 'png') {
    if (ascii(1, 3) !== 'PNG') return undefined;
    for (let i = 8; i + 8 <= b.length; i += 12 + u32(i)) {
      const type = ascii(i + 4, 4);
      if (type === 'acTL') return u32(i + 8);
      if (type === 'IDAT' || type === 'IEND') return 1;
    }
    return undefined;
  }
  if (kind === 'webp') {
    if (ascii(0, 4) !== 'RIFF' || ascii(8, 4) !== 'WEBP') return undefined;
    let frames = 0;
    for (let i = 12; i + 8 <= b.length; ) {
      const size = (b[i + 4]! | (b[i + 5]! << 8) | (b[i + 6]! << 16) | (b[i + 7]! << 24)) >>> 0;
      if (ascii(i, 4) === 'ANMF') frames++;
      i += 8 + size + (size & 1);
    }
    return Math.max(frames, 1);
  }
  // GIF: header, logical screen descriptor, optional global colour table, then blocks until the trailer.
  if (ascii(0, 3) !== 'GIF') return undefined;
  let i = 13 + (b[10]! & 0x80 ? 3 << ((b[10]! & 7) + 1) : 0);
  let frames = 0;
  const skipSubBlocks = () => { while (i < b.length && b[i]) i += b[i]! + 1; i++; };
  while (i < b.length) {
    const tag = b[i]!;
    if (tag === 0x3b) return frames;
    if (tag === 0x21) { i += 2; skipSubBlocks(); continue; }
    if (tag !== 0x2c) return undefined;
    frames++;
    const flags = b[i + 9]!;
    i += 10 + (flags & 0x80 ? 3 << ((flags & 7) + 1) : 0) + 1;
    skipSubBlocks();
  }
  return frames || undefined;
}

/**
 * Every resource reference in a CSS value must be a local `url(#id)`, each checked on its own: one local
 * reference does not vouch for another. CSS escapes and the functions that take a bare string as an image
 * URL (`image-set("a.png")`) are rejected outright, since they could spell an external reference.
 */
function checkUrls(value: string, what: string, reject: (msg: string, fix: string) => never): void {
  if (value.includes('\\')) reject(`${what} contains a CSS escape`, 'write the value without backslashes');
  if (/(^|[^\w-])(-webkit-)?(image-set|image|cross-fade|element|src)\s*\(/i.test(value)) reject(`${what} can load an image from outside the block`, 'draw it in SVG, or inline it as <img src="data:image/png;base64,…">');
  for (const m of value.matchAll(/url\s*\(/gi)) {
    if (!/^url\s*\(\s*(['"]?)#[\w-]+\1\s*\)/i.test(value.slice(m.index))) reject(`${what} loads something from outside the block`, 'reference only local ids: url(#id)');
  }
}

/**
 * A style attribute without animation or transition properties; any external resource is rejected. Written
 * back as `prop: value; …`, the form the theme defaults look for (`unset`).
 */
function cleanStyle(value: string, reject: (msg: string, fix: string) => never): string {
  const decls = value.split(';').map(d => d.trim()).filter(Boolean)
    .map(d => (d.includes(':') ? `${d.slice(0, d.indexOf(':')).trim().toLowerCase()}: ${d.slice(d.indexOf(':') + 1).trim()}` : d));
  for (const d of decls) {
    const prop = d.split(':')[0]!.trim().toLowerCase();
    if (prop.startsWith('animation') || prop.startsWith('transition')) reject(`style property ${prop} is not allowed`, 'remove it: motion comes from cues');
    checkUrls(d, `style "${d}"`, reject);
    checkVars(d, `style "${d}"`, reject);
    if (/expression\(|@import|behavior\s*:/i.test(d)) reject(`style "${d}" is not allowed`, 'remove it');
  }
  return decls.join('; ');
}

/**
 * Theme defaults apply only where the author set nothing: not on the element, nor on a group around it, as an
 * attribute or in style="" (cleanStyle writes declarations as `prop: value`). Otherwise `<g stroke-width="20">`
 * would lose to the default on every line inside it.
 */
const unset = (...props: string[]): string =>
  `:not(${props.flatMap(p => [`[${p}]`, `[${p}] *`, `[style*="${p}:"]`, `[style*="${p}:"] *`]).join(', ')})`;

const CSS = `
.cu-custom { position: relative; width: max-content; color: var(--ink-1);
  font: var(--weight-regular) var(--text-body) / var(--leading-prose) var(--font-sans); }
.cu-cap { margin-bottom: var(--label-gap); width: max-content; }
.cu-custom { --cu-recede: 0; }
.cu-rest { opacity: calc(var(--cu-own, 1) * (1 - var(--cu-recede) * (1 - var(--recede-opacity)))); }
.cu-box svg { display: block; overflow: visible; }
.cu-box code, .cu-box pre { font-family: var(--font-mono); white-space: pre; }
.cu-box b { font-weight: var(--weight-strong); }
.cu-box :where(text, tspan)${unset('fill')} { fill: currentColor; }
.cu-box :where(text)${unset('font-family')} { font-family: var(--font-sans); }
.cu-box :where(text)${unset('font-size')} { font-size: var(--text-label); }
.cu-box :where(rect, circle, ellipse, polygon)${unset('fill')} { fill: var(--surface-2); }
.cu-box :where(path, polyline, line)${unset('fill')} { fill: none; }
/* A line takes the theme's edge; a path or polyline that fills (authored, or from its group) is a shape and gains no stroke. */
.cu-box :where(line)${unset('stroke')},
.cu-box :where(path, polyline)${unset('stroke')}:where([fill="none"], ${unset('fill')}) { stroke: var(--line-strong); }
.cu-box :where(path, polyline, line)${unset('stroke-width')} { stroke-width: var(--stroke-edge); }
/* Outcome and contrast hues, as the inline marks {ok} {bad} {alt}: text and strokes; fills stay as written. */
.cu-box :where(.ok) { color: var(--ok); }
.cu-box :where(.bad) { color: var(--error); }
.cu-box :where(.alt) { color: var(--mark-alt); }
.cu-box :where(.ok, .bad, .alt) :where(path, polyline, line)${unset('stroke')},
.cu-box :where(path, polyline, line):where(.ok, .bad, .alt)${unset('stroke')} { stroke: currentColor; }
/* An arrowhead takes its line's stroke, so it follows the line's colour and highlight. */
.cu-box :where(marker) :where(path, polyline, polygon, rect, circle, ellipse):not([fill]) { fill: context-stroke; }
.cu-box :where(marker) :where(path, polyline, polygon, rect, circle, ellipse):not([stroke]) { stroke: none; }
.cu-box :where(td, th) { padding: var(--space-1) var(--space-3); text-align: left; }
.cu-box :where(th) { color: var(--ink-2); font-weight: var(--weight-medium); }
.cu-box :where(div.cu-item, span.cu-item, p.cu-item, li.cu-item, td.cu-item, th.cu-item) { border-radius: var(--radius-cell); padding: 0 var(--space-2); }
`;
