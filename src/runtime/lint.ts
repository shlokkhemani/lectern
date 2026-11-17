/**
 * Layout lint (§3.3, gate G2), run in the page per scene: geometric checks L401–L406 and block-specific checks
 * at the initial state and at every cue instant's settled state. Each issue is placed on the script: the beat
 * it was found in, and the line that caused it (the cue that drew the state, else the block's placement line,
 * else the beat's paragraph). Generic: it reads `[data-leaf]` elements and SVG strokes, never block types.
 */
import type { Cue, Id, Loc, Scene } from '../ir.ts';
import type { LintIssue } from '../render/types.ts';
import type { AuthoredAdvice, BlockLintIssue, Rect } from '../blocks/contract.ts';
import type { Mounted } from './layout.ts';
import { sceneCues } from './settle.ts';
import { bodyFloor, tok } from './theme.ts';

export interface LintInput {
  scene: Scene;
  sceneEl: HTMLElement;
  blocks: Map<Id, Mounted>;
  /** Draw the settled state after the first n cues. */
  draw(n: number): void;
}

const VISIBLE = 0.02;

/** A finding before it is placed on the script. */
export type Finding = BlockLintIssue & { block?: Id };

export function lintScene(inp: LintInput): LintIssue[] {
  const issues: LintIssue[] = [];
  const seen = new Set<string>();
  const { cues, instants } = sceneCues(inp.scene);
  const checkpoints = [{ beat: 0, cues: [] as Cue[], n: 0 }, ...instants.map(x => ({ beat: x.beat, cues: cues.slice(x.from, x.to), n: x.to }))];
  for (const cp of checkpoints) {
    inp.draw(cp.n);
    for (const f of geometric(inp)) {
      // The first state that shows a problem is where it is reported.
      const key = `${f.code}|${f.block ?? ''}|${f.message}`;
      if (seen.has(key)) continue;
      seen.add(key);
      issues.push(placed(inp.scene, f, cp.beat, cp.cues));
    }
  }
  inp.draw(cues.length);
  return issues;
}

/**
 * A finding placed on the script: scene, beat (0-based, as the contact sheet labels it) and the line to edit:
 * the cue among `cues` that acts on the finding's block (else the first of them), else the block's placement
 * line in this scene, else the beat's paragraph. Every layout finding is an error.
 */
export function placed(scene: Scene, f: Finding, beat = 0, cues: readonly Cue[] = []): LintIssue {
  const cue = cues.find(c => c.targets.some(t => t.block === f.block)) ?? cues[0];
  const loc: Loc = cue?.loc ?? scene.placements.find(p => p.block === f.block)?.loc ?? scene.beats[beat]?.loc ?? scene.loc;
  return { ...f, scene: scene.index, beat, loc, severity: 'error' };
}

/** Effective opacity of an element: the product of its and its ancestors' opacity, 0 if not rendered. */
function opacityOf(el: Element, stop: Element): number {
  let o = 1;
  for (let e: Element | null = el; e && e !== stop.parentElement; e = e.parentElement) {
    const cs = getComputedStyle(e);
    if (cs.display === 'none' || cs.visibility === 'hidden') return 0;
    o *= parseFloat(cs.opacity);
  }
  return o;
}

const rectOf = (r: DOMRect): Rect => ({ x: r.x, y: r.y, w: r.width, h: r.height });

function geometric(inp: LintInput): Finding[] {
  const out: Finding[] = [];
  const blockOf = (e: Element): Id | undefined => (e.closest('[data-block]') as HTMLElement | null)?.dataset.block;
  const X0 = tok('--margin-x'), X1 = tok('--stage-w') - X0, Y0 = tok('--margin-y'), Y1 = bodyFloor();
  const leaves = [...inp.sceneEl.querySelectorAll<HTMLElement>('[data-leaf]')]
    .map(el => ({ el, r: el.getBoundingClientRect(), o: opacityOf(el, inp.sceneEl) }))
    .filter(l => l.o > VISIBLE && l.r.width > 0 && l.r.height > 0);

  // A highlight band (a part's fill) never reaches outside its block either.
  for (const el of inp.sceneEl.querySelectorAll<HTMLElement>('.x-band')) {
    const host = el.closest('[data-block]') as HTMLElement | null;
    if (!host || opacityOf(host, inp.sceneEl) <= VISIBLE) continue;
    const r = el.getBoundingClientRect(), own = host.getBoundingClientRect();
    if (r.width > 0 && (r.left < own.left - 1.5 || r.right > own.right + 1.5))   // sub-pixel rounding in scaled rows
      out.push({ code: 'L402', message: `a highlight band runs out of its block "${host.dataset.block}"`, fix: 'report this: a block was laid out narrower than content it cannot wrap', rect: rectOf(r), block: host.dataset.block! });
  }

  for (const { el, r } of leaves) {
    const block = blockOf(el);
    const at = { rect: rectOf(r), ...(block ? { block } : {}) };
    const label = `"${(el.textContent ?? '').trim().slice(0, 40)}"`;
    if (r.left < X0 - 0.5 || r.right > X1 + 0.5 || r.top < Y0 - 0.5 || r.bottom > Y1 + 0.5)
      out.push({ code: 'L401', message: `${label} is outside the content box`, fix: 'split the scene: start a new "##" scene at a later paragraph, or put one block beside another with @left', ...at });
    if (el.scrollWidth > el.clientWidth + 1 || clipped(el, r, inp.sceneEl))
      out.push({ code: 'L402', message: `${label} overflows its box`, fix: 'shorten the text or give the block more room', ...at });
    const own = (el.closest('[data-block]') as HTMLElement | null)?.getBoundingClientRect();
    // Horizontal only: an inline run's box may rise above a tight line box without anything showing outside.
    if (own && (r.left < own.left - 0.5 || r.right > own.right + 0.5))
      out.push({ code: 'L402', message: `${label} runs out of its block "${block}"`, ...at,
        fix: authored(inp, block)?.outside ?? 'report this: a block was laid out narrower than content it cannot wrap' });
    // What the leaf shows: for an envelope, each visible alternative on its own (hidden ones are not drawn,
    // and joining them would hide a visible "undefined" inside "aundefined").
    const slots = [...el.querySelectorAll<HTMLElement>(':scope > .x-alt-slot')];
    const shown = slots.length ? slots.filter(a => a.style.visibility !== 'hidden' && parseFloat(a.style.opacity || '1') > 0).map(a => (a.textContent ?? '').trim()) : [(el.textContent ?? '').trim()];
    const text = shown.join(' ').trim();
    if (el.dataset.missing !== undefined)
      out.push({ code: 'L405', message: `${label} shows content the block was not sized for`, fix: 'report this: the block was not mounted with every reachable content', ...at });
    if (shown.some(t => /^(undefined|NaN|null)$/.test(t) || t.includes('[object ')))
      out.push({ code: 'L405', message: `rendered text is ${label}`, fix: 'report this: a block drew a value that is not content', ...at });
    if (el.dataset.declared !== undefined && !text)
      out.push({ code: 'L405', message: 'declared content renders empty', fix: 'report this: the block lost its content', ...at });
  }
  out.push(...tinyText(inp));

  for (let i = 0; i < leaves.length; i++) for (let j = i + 1; j < leaves.length; j++) {
    const a = leaves[i]!, b = leaves[j]!;
    if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
    const w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
    const hgt = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
    if (w > 1 && hgt > 1) {
      const block = blockOf(a.el);
      const ta = `"${(a.el.textContent ?? '').trim().slice(0, 30)}"`, tb = `"${(b.el.textContent ?? '').trim().slice(0, 30)}"`;
      // Inside one block whose content the author draws, the author placed both: their drawing collides, not the layout.
      const own = block !== undefined && block === blockOf(b.el) ? authored(inp, block) : undefined;
      const type = own ? `${inp.blocks.get(block!)!.el.dataset.type ?? ''} ` : '';
      out.push({
        code: 'L403', rect: { x: Math.max(a.r.left, b.r.left), y: Math.max(a.r.top, b.r.top), w, h: hgt }, ...(block ? { block } : {}),
        message: own ? `your ${type}content overlaps itself: ${ta} overlaps ${tb}` : `${ta} overlaps ${tb}`,
        fix: own?.overlap ?? 'report this: layout let two labels collide',
      });
    }
  }

  for (const edge of inp.sceneEl.querySelectorAll<SVGGeometryElement>('[data-edge]')) {
    if (opacityOf(edge, inp.sceneEl) <= VISIBLE) continue;
    const pts = samples(edge);
    if (pts.length < 2) continue;
    const ends = leaves.filter(l => [pts[0]!, pts.at(-1)!].some(p => near(l.r, p, 3)));
    for (const l of leaves) {
      if (ends.includes(l)) continue;
      const inner = { left: l.r.left + 1, right: l.r.right - 1, top: l.r.top + 1, bottom: l.r.bottom - 1 };
      if (pts.some(p => p.x > inner.left && p.x < inner.right && p.y > inner.top && p.y < inner.bottom)) {
        const block = blockOf(edge);
        out.push({ code: 'L404', message: `an edge crosses "${(l.el.textContent ?? '').trim().slice(0, 30)}"`, fix: 'report this: an edge was routed through a label', rect: rectOf(l.r), ...(block ? { block } : {}) });
      }
    }
  }

  // A block's own finding names the author's fix; the collisions it causes inside the block are its side effects.
  const own: Finding[] = [];
  for (const [id, m] of inp.blocks) {
    if (opacityOf(m.el, inp.sceneEl) <= VISIBLE) continue;
    for (const i of m.rt.lint?.(m.el) ?? []) own.push({ ...i, block: id });
  }
  const explained = new Set(own.map(f => f.block));
  return [...out.filter(f => !(explained.has(f.block) && (f.code === 'L403' || f.code === 'L404'))), ...own];
}

/**
 * L406, no silent tiny text (R2a item 4): every visible run of text in a block, HTML or SVG, at the size it is
 * drawn (font size times every scale above it: the region's CSS scale, an SVG viewBox), against the theme:
 * nothing below `--text-meta`, and text a block marks essential (`data-essential`: table cells, node labels,
 * chart values and axes) nothing below `--text-label`.
 */
function tinyText(inp: LintInput): Finding[] {
  const out: Finding[] = [];
  const meta = tok('--text-meta'), label = tok('--text-label');
  const seen = new Set<Element>();
  for (const blk of inp.sceneEl.querySelectorAll<HTMLElement>('[data-block]')) {
    if (opacityOf(blk, inp.sceneEl) <= VISIBLE) continue;
    const walker = document.createTreeWalker(blk, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement ?? (n.parentNode as Element | null);
      // Only runs that draw glyphs (layout struts are zero-width spaces).
      if (!el || seen.has(el) || !/[^\s\u200b-\u200d\u2060\ufeff]/.test(n.textContent ?? '')) continue;
      seen.add(el);
      if (opacityOf(el, inp.sceneEl) <= VISIBLE) continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const size = drawnSize(el);
      const essential = el.closest('[data-essential]') !== null;
      const min = essential ? label : meta;
      if (size >= min - 0.05) continue;
      const text = `"${(n.textContent ?? '').trim().slice(0, 40)}"`;
      const px = Math.round(size * 10) / 10;
      out.push({
        code: 'L406', block: blk.dataset.block!, rect: rectOf(r),
        message: `${text} is drawn at ${px}px, below the ${min}px floor${essential ? ' for text a viewer must read' : ''}`,
        fix: authored(inp, blk.dataset.block)?.tiny(min) ?? `report this: block "${blk.dataset.block}" drew text below the theme floor`,
      });
    }
  }
  return out;
}

/** The author-facing advice of a block whose content the author draws, if it is one. */
function authored(inp: LintInput, block: Id | undefined): AuthoredAdvice | undefined {
  return block === undefined ? undefined : inp.blocks.get(block)?.rt.authored;
}

/**
 * The size a text element is drawn at, in stage px: its font size times the smallest scale of every transform
 * above it (the least singular value of their product), so text squeezed in one direction counts at its
 * squeezed size, not at an area-average.
 */
function drawnSize(el: Element): number {
  const fs = parseFloat(getComputedStyle(el).fontSize);
  if (el instanceof SVGGraphicsElement) {
    // The screen CTM holds the viewBox and every CSS scale above; divide out the stage's own fit to the window.
    const m = el.getScreenCTM();
    const stage = el.closest<HTMLElement>('#stage');
    const fit = stage?.offsetWidth ? stage.getBoundingClientRect().width / stage.offsetWidth : 1;
    return m ? (fs * leastScale(m)) / fit : fs;
  }
  // Every CSS scale and transform above it (offsetWidth rounds to whole pixels, so ratios of boxes are not exact).
  let m = new DOMMatrix();
  for (let e: Element | null = el; e && e.id !== 'stage'; e = e.parentElement) {
    const cs = getComputedStyle(e);
    let own = new DOMMatrix();
    if (cs.scale && cs.scale !== 'none') {
      const [sx = 1, sy = sx] = cs.scale.split(/\s+/).map(Number);
      own = own.scale(sx, sy);
    }
    if (cs.transform && cs.transform !== 'none') own = own.multiply(new DOMMatrix(cs.transform));
    m = own.multiply(m);
  }
  return fs * leastScale(m);
}

/** The least singular value of a transform's linear part: the most it shrinks any direction. */
export function leastScale(m: { a: number; b: number; c: number; d: number }): number {
  const s = m.a * m.a + m.b * m.b + m.c * m.c + m.d * m.d, det = m.a * m.d - m.b * m.c;
  return Math.sqrt(Math.max(0, (s - Math.sqrt(Math.max(0, s * s - 4 * det * det))) / 2));
}

function near(r: DOMRect, p: { x: number; y: number }, d: number): boolean {
  return p.x >= r.left - d && p.x <= r.right + d && p.y >= r.top - d && p.y <= r.bottom + d;
}

function clipped(el: HTMLElement, r: DOMRect, stop: HTMLElement): boolean {
  for (let e = el.parentElement; e && e !== stop; e = e.parentElement) {
    const cs = getComputedStyle(e);
    if (cs.overflow === 'visible' && cs.overflowX === 'visible') continue;
    const c = e.getBoundingClientRect();
    if (r.left < c.left - 0.5 || r.right > c.right + 0.5 || r.top < c.top - 0.5 || r.bottom > c.bottom + 0.5) return true;
  }
  return false;
}

/** Points along a drawn stroke, in stage px, every ~3px of its drawn length. */
function samples(g: SVGGeometryElement): { x: number; y: number }[] {
  const len = g.getTotalLength();
  const m = g.getScreenCTM();
  if (!m || !len) return [];
  const dash = parseFloat(getComputedStyle(g).strokeDashoffset) || 0;
  const drawn = Math.max(0, len - Math.abs(dash));
  const out: { x: number; y: number }[] = [];
  const stage = g.closest('#stage')!.getBoundingClientRect();
  for (let d = 0; d <= drawn; d += 3) {
    const p = g.getPointAtLength(d);
    out.push({ x: m.a * p.x + m.c * p.y + m.e - stage.left, y: m.b * p.x + m.d * p.y + m.f - stage.top });
  }
  return out;
}
