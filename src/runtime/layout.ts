/**
 * Scene layout (§3.3, theme README composition rules 1–4). Holds no numbers of its own: every threshold is
 * a theme token. Runs once per scene at load, in the browser, on mounted blocks; the result is frozen (render
 * never reads layout).
 *
 * Script → rows: each `@top` block is its own row, above the body; if any block is `@left` the body is one
 * row of two regions `left | main`; otherwise each `main` block is its own row. Blocks that a `swap`
 * exchanges share one slot.
 *
 * Fill (rule 4): a frame is sparse if its rows fill < `--sparse-fill-min` of the body height or a block fits
 * < `--region-fit-min` of its region. A sparse frame grows, region by region: each region scales up to
 * min(`--scale-max`, what its width allows, its share of the height), with the type ratios kept (prose ≥
 * `--prose-code-ratio-min` × the frame's largest code, labels ≥ `--label-code-ratio-min` × code, never below what
 * the theme has at 1x). Labels annotate the code beside them: in a region that holds code they scale with it, so
 * the label ratio binds only regions of labels without code (a token strip's 14px type labels do not stop a tree
 * in another region growing; part 8 s9). Then any vertical slack left opens the flexible pitch (`--pitch` on each block: table, list and tree
 * rows; up to `--flex-pitch-max`). Scaling comes before pitch: pitch adds air, scaling adds legibility, and
 * a region that cannot scale (a full-width table) still gets the slack through pitch.
 *
 * Vertical balance (rule 3): rows are spaced evenly, an interior gap never exceeds `--row-gap-max`, and the
 * leftover goes equally above and below the centred stack. An even gap under `--row-gap-min` is overfull (L410).
 *
 * Overfull (L410) is reported once per cause, with a fix in script syntax: each block wider than its column, or,
 * when everything fits across, the rows that are too tall together. A block too wide may name its own way to fit
 * (`roomFix`: a graph's `dir=`); otherwise, and for rows too tall, the advice is a layout move.
 */
import type { Id, Region, Scene } from '../ir.ts';
import type { BlockRuntime, Rect } from '../blocks/contract.ts';
import type { SceneLayout } from '../render/types.ts';
import type { Finding } from './lint.ts';
import { bodyFloor, tok } from './theme.ts';

export interface Mounted { id: Id; el: HTMLElement; rt: BlockRuntime<unknown>; flexible: boolean }

type Slot = Mounted[];
type RegionSpec = Slot[];
type RowSpec = RegionSpec[];

/** A block placed in its region, region-local unscaled px. */
interface Placed { mounted: Mounted; x: number; y: number; w: number; h: number }
/** A block wider than its column (unscaled px). */
interface Overflow { block: Id; need: number; width: number }
/** Why a row does not fit across, as the author reads it. */
interface RowOverflow { block: Id; message: string }
/** A region laid out at one width (unscaled px). */
interface RegionBox { w: number; h: number; placed: Placed[]; overflow: Overflow[] }
/** A row laid out at given region scales (stage px). */
interface RowBox { h: number; regions: { x: number; y: number; w: number; s: number; avail: number; box: RegionBox }[]; overflow: RowOverflow[] }

interface Fonts { code: number; prose: number; label: number }

/** Lay out scene k's mounted blocks into rows inside `sceneEl`. `top` is the headline's bottom edge. */
export function layoutScene(scene: Scene, blocks: Map<Id, Mounted>, sceneEl: HTMLElement, top: number): { layout: SceneLayout; issues: Finding[] } {
  const X0 = tok('--margin-x');
  const W = tok('--stage-w') - 2 * X0;
  const bodyH = bodyFloor() - top;
  const gapMin = tok('--row-gap-min'), gapMax = tok('--row-gap-max');
  const rows = rowSpecs(scene, blocks);
  const rowEls = rows.map(() => {
    const r = document.createElement('div');
    r.className = 'x-row';
    sceneEl.appendChild(r);
    return r;
  });
  rows.forEach((row, i) => row.forEach(region => region.forEach(slot => slot.forEach(m => rowEls[i]!.appendChild(m.el)))));
  const regions = rows.flat();
  const all = [...blocks.values()];

  const setPitch = (p: number) => all.forEach(m => m.el.style.setProperty('--pitch', String(p)));
  setPitch(1);
  // Each region's narrowest width at 1x in a two-region row: a fixed block beside a flexible one wraps before it
  // squeezes the flexible one below this (layoutRow).
  const pairMins = rows.map(r => (r.length === 2 ? r.map(reg => minWidth(reg, W - tok('--region-gutter'))) : []));
  const lay = (scales: number[][]) => rows.map((r, i) => layoutRow(r, W, scales[i]!, pairMins[i]!));
  const height = (boxes: RowBox[]) => boxes.reduce((a, b) => a + b.h, 0);
  const fits = (boxes: RowBox[]) => height(boxes) + (rows.length + 1) * gapMin <= bodyH + 0.01 && boxes.every(b => !b.overflow.length);
  const ones = rows.map(r => r.map(() => 1));

  let scales = ones;
  let boxes = lay(scales);

  // ---- fill (rule 4) ----
  const sparse = () => height(boxes) / bodyH < tok('--sparse-fill-min') || fitOf(boxes, bodyH).some(f => f.fit < tok('--region-fit-min'));
  if (rows.length && fits(boxes) && sparse()) {
    const fonts = regions.map(r => fontsOf(r));
    // How wide a region must stay at 1x. Content that wraps (prose, cards) or cannot (code, tables): its narrowest
    // unbroken width. Flexible content (token strips, trees, charts, graphs) widens to fill what it is given, so
    // a lone flexible region counts at the width it takes across the whole row: a strip that already spans the
    // row cannot scale (rule 1), a tree at its widest sibling gap narrower than the row can. Two regions share
    // the row by their unbreakable widths.
    const flexible = (reg: RegionSpec) => reg.some(slot => slot.some(m => m.flexible));
    const mins = rows.map((r, i) => r.map((reg, j) => (r.length === 1
      ? (flexible(reg) ? Math.max(layoutRegion(reg, W).w, minWidth(reg, W)) : minWidth(reg, W))
      : pairMins[i]![j]!)));
    const at = (t: number) => scalesAt(t, mins, W, fonts);
    let lo = 1, hi = tok('--scale-max');
    if (fits(lay(at(hi)))) lo = hi;
    else for (let i = 0; i < 12; i++) { const mid = (lo + hi) / 2; if (fits(lay(at(mid)))) lo = mid; else hi = mid; }
    scales = at(lo);
    boxes = lay(scales);
    // Measures can differ by a fraction of a pixel between trials (wrapping depends on the widths before);
    // step down until the final layout itself fits.
    for (let i = 0; i < 12 && !fits(boxes) && lo > 1; i++) { lo = Math.max(1, lo - 0.02); scales = at(lo); boxes = lay(scales); }
    // Pitch takes the vertical slack that scaling left.
    const pmax = tok('--flex-pitch-max');
    const pitched = (p: number) => { setPitch(p); return lay(scales); };
    const slackFill = (b: RowBox[]) => height(b) / bodyH < tok('--sparse-fill-min');
    if (slackFill(boxes)) {
      let plo = 1, phi = pmax;
      if (fits(pitched(phi))) plo = phi;
      else for (let i = 0; i < 10; i++) { const mid = (plo + phi) / 2; if (fits(pitched(mid))) plo = mid; else phi = mid; }
      boxes = pitched(plo);
    }
  }

  const sum = height(boxes);
  const even = (bodyH - sum) / (rows.length + 1);
  const issues: Finding[] = [];
  for (const b of boxes) for (const o of b.overflow) {
    // Beside another block, a layout move always helps; alone in its row, only the block itself can change.
    const m = blocks.get(o.block)!;
    const own = m.rt.roomFix?.(m.el);
    const fix = b.regions.length === 2 ? `${own ? `${own}; or ` : ''}put one of them @top, or remove @left`
      : own ?? 'it has the whole row already: show a shorter excerpt, or split it into two blocks';
    issues.push({ code: 'L410', block: o.block, message: o.message, fix });
  }
  // Too tall together: only when every block fits across, so one cause is reported once.
  if (!issues.length && even < gapMin - 0.01) {
    const named = rows.map(r => r.flat(2).map(m => `"${m.id}"`).join(' + '));
    const over = Math.ceil(sum + (rows.length + 1) * gapMin - bodyH);
    // A block taller than the body on its own fits in no scene and beside nothing: only the block can change.
    const lone = boxes.flatMap(b => b.regions.flatMap(r => r.box.placed.map(p => ({ id: p.mounted.id, h: p.h * r.s }))))
      .find(p => p.h + 2 * gapMin > bodyH + 0.01);
    issues.push({
      code: 'L410',
      message: `${rows.length > 1 ? 'rows' : 'the row'} ${named.join(', ')} ${rows.length > 1 ? 'are' : 'is'} ${over}px too tall for the frame`,
      // Side by side saves height only when the scene has no @left yet: the body is already one row otherwise.
      fix: lone ? `"${lone.id}" alone is taller than the frame: show fewer rows, lines or nodes, or split it into two blocks`
        : ['split the scene: start a new "##" scene at a later paragraph', ...(rows.some(r => r.length === 2) ? [] : ['put two of these blocks side by side with @left'])].join('; or '),
    });
  }

  // ---- place: interior gaps capped at --row-gap-max, leftover equally above and below ----
  // Blocks first, inside rows at their final x and scale; rows go to their y once their ink is known.
  const rects: Record<Id, Rect> = {};
  let maxScale = 1;
  const local: { id: Id; x: number; y: number; w: number; h: number }[][] = boxes.map(() => []);
  boxes.forEach((b, i) => {
    Object.assign(rowEls[i]!.style, { left: `${X0}px`, top: `${top}px`, width: `${W}px`, height: `${Math.round(b.h)}px` });
    for (const reg of b.regions) {
      maxScale = Math.max(maxScale, reg.s);
      for (const p of reg.box.placed) {
        // Rounding to whole pixels must never push a scaled block past the content box's edges.
        const x = Math.max(0, Math.min(Math.round(reg.x + p.x * reg.s), Math.floor(W - p.w * reg.s))), py = Math.round(reg.y + p.y * reg.s);
        Object.assign(p.mounted.el.style, { left: `${x}px`, top: `${py}px`, scale: String(reg.s) });
        local[i]!.push({ id: p.mounted.id, x, y: py, w: p.w * reg.s, h: p.h * reg.s });
      }
    }
  });
  // The cap is on the gap the eye sees: from the last ink of one row (text, a panel) to the first of the next,
  // not between boxes, whose padding and half-leading would otherwise add to it (part 8 s12: a 72px box gap
  // read as a 96px empty band). The stack is centred on its ink the same way.
  const inks = rowEls.map((el, i) => inkInset(el, boxes[i]!.h));
  const gaps = boxes.slice(1).map((_, i) => Math.max(gapMin, Math.min(even, gapMax - inks[i]!.bottom - inks[i + 1]!.top)));
  const stackH = sum + gaps.reduce((a, g) => a + g, 0);
  const shift = rows.length ? (inks.at(-1)!.bottom - inks[0]!.top) / 2 : 0;
  let y = top + Math.min(Math.max(0, bodyH - stackH), Math.max(0, (bodyH - stackH) / 2 + shift));
  boxes.forEach((b, i) => {
    const ry = Math.round(y);
    rowEls[i]!.style.top = `${ry}px`;
    for (const r of local[i]!) rects[r.id] = { x: X0 + r.x, y: ry + r.y, w: r.w, h: r.h };
    y += b.h + (gaps[i] ?? 0);
  });
  return { layout: { scale: maxScale, blocks: rects }, issues };
}

/**
 * Empty space inside a row above its first ink and below its last: text (leaves) and painted panels, as laid
 * out (row-local px). Rows with no measurable ink count as full.
 */
function inkInset(row: HTMLElement, h: number): { top: number; bottom: number } {
  const r0 = row.getBoundingClientRect();
  let lo = Infinity, hi = -Infinity;
  for (const el of row.querySelectorAll<HTMLElement>('[data-leaf], .x-blk *')) {
    const leaf = el.dataset.leaf !== undefined;
    if (!leaf) {
      const bg = getComputedStyle(el).backgroundColor;
      if (!bg || bg === 'transparent' || bg.endsWith(', 0)')) continue;
    }
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    lo = Math.min(lo, r.top - r0.top);
    hi = Math.max(hi, r.bottom - r0.top);
  }
  if (!Number.isFinite(lo)) return { top: 0, bottom: 0 };
  return { top: Math.max(0, lo), bottom: Math.max(0, h - hi) };
}

function rowSpecs(scene: Scene, blocks: Map<Id, Mounted>): RowSpec[] {
  const slotOf = new Map<Id, Slot>();
  const slotsIn = (region: Region): Slot[] => {
    const out: Slot[] = [];
    for (const p of scene.placements) {
      if (p.region !== region) continue;
      const m = blocks.get(p.block);
      if (!m) continue;
      const pair = scene.swapSlots.find(s => s.includes(p.block));
      const other = pair ? (pair[0] === p.block ? pair[1] : pair[0]) : undefined;
      const shared = other ? slotOf.get(other) : undefined;
      if (shared) { shared.push(m); slotOf.set(p.block, shared); continue; }
      const slot: Slot = [m];
      slotOf.set(p.block, slot);
      out.push(slot);
    }
    return out;
  };
  const rows: RowSpec[] = slotsIn('top').map(s => [[s]]);
  const left = slotsIn('left'), main = slotsIn('main');
  if (left.length) rows.push(main.length ? [left, main] : [left]);
  else rows.push(...main.map(s => [[s]]));
  return rows;
}

/**
 * The narrowest a region can be at 1x without overflowing (code, tables, trees at minimum gap, code runs in prose):
 * found by laying the region out, so every block's own rules decide. Cheap: a few measures per region.
 */
function minWidth(region: RegionSpec, avail: number): number {
  let lo = 0, hi = avail;
  if (layoutRegion(region, hi).overflow.length) return hi;
  for (let i = 0; i < 12; i++) { const mid = (lo + hi) / 2; if (layoutRegion(region, mid).overflow.length) lo = mid; else hi = mid; }
  return hi;
}

/** Natural width of a region at 1x: its widest block's natural width. */
function naturalWidth(region: RegionSpec, W: number): number {
  return Math.max(0, ...region.flatMap(s => s.map(m => m.rt.measure(m.el, W).natural)));
}

/**
 * Region scales for a target growth t (`mins`: each region's unbreakable width at 1x): each region min(t, its
 * width cap); then the type ratios: a region
 * holding prose or labels grows at least as much as the frame's largest code requires (within its cap), and
 * code regions shrink where that cannot be met. Two regions in a row share the row width.
 */
function scalesAt(t: number, mins: number[][], W: number, fonts: Fonts[]): number[][] {
  const gutter = tok('--region-gutter');
  // Width caps: a lone region may grow until its 1x width spans the row; two regions share the row.
  const caps = mins.map(r => r.map(m => (m > 0 ? (r.length === 1 ? W : W - gutter) / m : Infinity)));
  const flat: number[] = [];
  const capFlat = caps.flat();
  // Never below 1x: code never renders under --code-min-render; a frame too full for 1x is overfull (L410).
  mins.forEach((r, i) => r.forEach((_, j) => flat.push(Math.max(1, Math.min(t, caps[i]![j]!)))));
  const proseRatio = tok('--prose-code-ratio-min'), labelRatio = tok('--label-code-ratio-min');
  // The theme's own ratios at 1x are always allowed: a frame whose largest code is a 26px token strip already has
  // 14px meta labels beside it. Growth must not make them worse than that, nor worse than the rule.
  const code1x = Math.max(...fonts.map(f => f.code), tok('--text-code'));
  for (let pass = 0; pass < 3; pass++) {
    const C = Math.max(0, ...flat.map((s, i) => s * fonts[i]!.code));
    if (!C) break;
    // Required scale per region from its smallest prose and label (never stricter than the theme at 1x).
    const need = flat.map((_, i) => {
      const f = fonts[i]!;
      let n = 0;
      if (f.prose) n = Math.max(n, (Math.min(proseRatio, f.prose / code1x) * C) / f.prose);
      if (f.label && !f.code) n = Math.max(n, (Math.min(labelRatio, f.label / code1x) * C) / f.label);
      return n;
    });
    let changed = false;
    flat.forEach((s, i) => {
      const want = Math.max(1, Math.min(capFlat[i]!, Math.max(s, need[i]!)));
      if (want > s + 1e-6 && !fonts[i]!.code) { flat[i] = want; changed = true; }
    });
    // Where a prose or label region cannot reach its need, cap the code regions instead.
    const allowed = Math.min(...flat.map((s, i) => (need[i]! > s + 1e-6 ? (s / need[i]!) * C : Infinity)));
    if (Number.isFinite(allowed)) flat.forEach((s, i) => { if (fonts[i]!.code && s * fonts[i]!.code > allowed) { flat[i] = Math.max(1, allowed / fonts[i]!.code); changed = true; } });
    if (!changed) break;
  }
  let k = 0;
  return mins.map(r => {
    const s = r.map(() => flat[k++]!);
    // Two regions side by side: together their unbreakable widths must fit the row; shrink both alike.
    if (r.length === 2) {
      const used = r[0]! * s[0]! + r[1]! * s[1]!;
      if (used > W - gutter) { const f = (W - gutter) / used; s[0] = Math.max(1, s[0]! * f); s[1] = Math.max(1, s[1]! * f); }
    }
    return s;
  });
}

/** Largest code, smallest prose and smallest label font in a region (unscaled px; 0 = none). */
function fontsOf(region: RegionSpec): Fonts {
  const body = tok('--text-body'), codeMin = tok('--text-code');
  const out: Fonts = { code: 0, prose: 0, label: 0 };
  for (const slot of region) for (const m of slot) {
    for (const leaf of m.el.querySelectorAll<HTMLElement>('[data-leaf]')) {
      if (!leaf.textContent?.trim()) continue;
      const cs = getComputedStyle(leaf);
      const size = parseFloat(cs.fontSize);
      if (/mono/i.test(cs.fontFamily)) { if (size >= codeMin) out.code = Math.max(out.code, size); }
      else if (size >= body) out.prose = out.prose ? Math.min(out.prose, size) : size;
      else out.label = out.label ? Math.min(out.label, size) : size;
    }
  }
  return out;
}

/** How much of its region each region's content fills: max(w / region width, h / its row's share of the usable height). */
function fitOf(boxes: RowBox[], bodyH: number): { id: Id; fit: number; s: number }[] {
  const total = boxes.reduce((a, b) => a + b.h, 0) || 1;
  // The height rows can have: the body less the minimum gaps (a frame that is full to row-gap-min fits 100%).
  const usable = bodyH - (boxes.length + 1) * tok('--row-gap-min');
  const out: { id: Id; fit: number; s: number }[] = [];
  for (const b of boxes) {
    const share = usable * (b.h / total);
    // A region's content as a whole: a short note stacked under a tree fills the region together with it.
    for (const reg of b.regions) if (reg.box.placed.length)
      out.push({ id: reg.box.placed[0]!.mounted.id, s: reg.s, fit: Math.max((reg.box.w * reg.s) / reg.avail, (reg.box.h * reg.s) / share) });
  }
  return out;
}

/** One row across width W (stage px), each region at its own scale; `mins`: each region's narrowest width at 1x. */
function layoutRow(row: RowSpec, W: number, scales: number[], mins: number[]): RowBox {
  const gutter = tok('--region-gutter');
  if (row.length === 1) {
    const s = scales[0]!;
    const box = layoutRegion(row[0]!, W / s);
    const overflow = box.overflow.map(o => ({ block: o.block, message: `"${o.block}" needs ${Math.ceil(o.need)}px; the row is ${Math.floor(o.width)}px` }));
    return { h: box.h * s, overflow, regions: [{ x: (W - box.w * s) / 2, y: 0, w: box.w * s, s, avail: W, box }] };
  }
  const [L, M] = row as [RegionSpec, RegionSpec];
  const [sL, sM] = scales as [number, number];
  const flex = (r: RegionSpec) => r.some(s => s.some(m => m.flexible));
  const avail = W - gutter;
  const nL = naturalWidth(L, W / sL) * sL, nM = naturalWidth(M, W / sM) * sM;
  let wl: number, wm: number;
  if (flex(L) && flex(M)) { wl = wm = avail / 2; }
  else if (flex(M)) {
    // The fixed left block takes its natural width, but not so much that the flexible block is squeezed below
    // its narrowest: it wraps into what that leaves (a checklist beside a ladder), as narrow as it can go.
    wl = Math.min(nL, avail);
    const cap = avail - (mins[1] ?? 0) * sM;
    if (wl > cap) wl = Math.min(wl, Math.max(cap, (mins[0] ?? 0) * sL));
    wm = avail - wl;
  }
  else if (flex(L)) { wm = Math.min(nM, avail); wl = avail - wm; }
  else {
    wl = nL; wm = nM;
    if (wl + wm > avail) {
      // The left region keeps its natural width (code first); prose on the right wraps into what is left.
      const tryM = layoutRegion(M, (avail - wl) / sM);
      if (!tryM.overflow.length) wm = avail - wl;
      else { wm = Math.min(wm, avail); wl = avail - wm; }
    }
  }
  let rl = layoutRegion(L, wl / sL), rm = layoutRegion(M, wm / sM);
  // A fixed region that hugs its content (wrapped text) may use less than it was given: a flexible neighbour
  // takes the rest, so the room goes to content rather than to an empty band between them, as long as the
  // wider neighbour does not make the row taller (a ladder grows with its width; a chart does not).
  const rowH = Math.max(rl.h * sL, rm.h * sM);
  if (flex(M) && !flex(L) && rl.w * sL < wl - 0.5) {
    const wider = layoutRegion(M, (avail - rl.w * sL) / sM);
    if (!wider.overflow.length && wider.h * sM <= rowH + 0.5) { wm = avail - rl.w * sL; rm = wider; }
    else rm = layoutRegion(M, wm / sM);
  } else if (flex(L) && !flex(M) && rm.w * sM < wm - 0.5) {
    const wider = layoutRegion(L, (avail - rm.w * sM) / sL);
    if (!wider.overflow.length && wider.h * sL <= rowH + 0.5) { wl = avail - rm.w * sM; rl = wider; }
    else rl = layoutRegion(L, wl / sL);
  }
  const hl = rl.h * sL, hm = rm.h * sM, h = Math.max(hl, hm);
  const share = Math.max(0, W - rl.w * sL - rm.w * sM - gutter) / 3;
  const xl = share, xm = share + rl.w * sL + gutter + share;
  const name = (r: RegionSpec) => r.flat()[0]?.id ?? '?';
  const beside = (o: Overflow, other: RegionSpec): RowOverflow =>
    ({ block: o.block, message: `"${o.block}" needs ${Math.ceil(o.need)}px but its column beside "${name(other)}" is ${Math.floor(o.width)}px` });
  let overflow = [...rl.overflow.map(o => beside(o, M)), ...rm.overflow.map(o => beside(o, L))];
  // Two fixed-width blocks that do not fit side by side: name both widths, since neither one alone is too wide.
  if (!flex(L) && !flex(M) && nL + nM > avail + 0.5 && overflow.length) {
    overflow = [{ block: overflow[0]!.block, message: `"${name(L)}" (${Math.ceil(nL)}px) and "${name(M)}" (${Math.ceil(nM)}px) need ${Math.ceil(nL + nM + gutter)}px side by side; the row has ${Math.floor(W)}px` }];
  }
  return {
    h, overflow,
    regions: [
      { x: xl, y: (h - hl) / 2, w: rl.w * sL, s: sL, avail: wl, box: rl },
      { x: xm, y: (h - hm) / 2, w: rm.w * sM, s: sM, avail: wm, box: rm },
    ],
  };
}

/**
 * The narrowest a fixed block may be laid out: its content's width at its natural width (a short callout's one
 * line), but never more than `--measure-min`, so prose beside code wraps at a readable measure or overflows
 * (L410) instead of going one word per line. Width-independent, so measured once per block.
 */
function floorOf(m: Mounted): number {
  let f = FLOORS.get(m);
  if (f === undefined) {
    const at = m.rt.measure(m.el, m.rt.measure(m.el, Infinity).natural);
    f = Math.min(at.width ?? at.natural, tok('--measure-min'));
    FLOORS.set(m, f);
  }
  return f;
}
const FLOORS = new WeakMap<Mounted, number>();

/** A region: slots stacked with --stack-gap, each centred horizontally in the region's used width. */
function layoutRegion(region: RegionSpec, width: number): RegionBox {
  const gap = tok('--stack-gap');
  const overflow: Overflow[] = [];
  const slots = region.map(slot => {
    const sized = slot.map(m => {
      const floor = m.flexible ? 0 : floorOf(m);
      const first = m.rt.measure(m.el, width);
      let w = Math.min(first.natural, width);
      let mm = w === width ? first : m.rt.measure(m.el, w);
      m.el.style.width = `${w}px`;
      const need = Math.max(m.flexible ? first.natural : floor, m.el.scrollWidth);
      if (need > width + 0.5) overflow.push({ block: m.id, need, width });
      if (need > w) {
        // Never squeeze a block below what it cannot wrap or its floor, not even by a pixel: it keeps that width and,
        // if that is wider than its column, overflows it (an L410 error above), so nothing runs out of its own panel.
        w = Math.ceil(need);
        mm = m.rt.measure(m.el, w);
        m.el.style.width = `${w}px`;
      }
      // Wrapped text hugs its longest line: the block takes only the width it fills (contract `measure`).
      if (mm.width !== undefined && mm.width < w) { w = mm.width; m.el.style.width = `${w}px`; }
      return { m, w, h: mm.height };
    });
    return { sized, w: Math.max(...sized.map(s => s.w)), h: Math.max(...sized.map(s => s.h)) };
  });
  const w = Math.max(0, ...slots.map(s => s.w));
  const placed: Placed[] = [];
  let y = 0;
  slots.forEach((s, i) => {
    if (i) y += gap;
    for (const b of s.sized) placed.push({ mounted: b.m, x: (w - b.w) / 2, y: y + (s.h - b.h) / 2, w: b.w, h: b.h });
    y += s.h;
  });
  return { w, h: y, placed, overflow };
}
