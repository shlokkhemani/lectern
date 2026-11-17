/**
 * `compare`: two or three columns side by side, split by `---`. A column's first line is its label
 * (` #name` names the column); the rest are lines, a one-code-span line being display code. Each column is
 * a field of equal width; `hl` lifts the field and puts the highlight bar on its edge.
 */
import type { Inline, ItemDecl } from '../../ir.ts';
import type { BlockModule } from '../contract.ts';
import { channels, root, envelope, h, inherit, lineBar, maxContent, style, token, unbreakable } from '../kit.ts';
import { isDisplay } from './text.ts';

interface Column { label: Inline; lines: Inline[] }
interface CompareBody { columns: Column[] }
const doms = new WeakMap<HTMLElement, HTMLElement[]>();

export const compare: BlockModule<CompareBody> = {
  type: 'compare',
  pack: 'core',
  args: {},
  flexible: false,
  parse(body, _args, ctx) {
    const columns: Column[] = [];
    const items: ItemDecl[] = [];
    let cur: Column | undefined;
    for (const l of body) {
      if (!l.text.trim()) continue;
      if (l.text.trim() === '---') { cur = undefined; continue; }
      if (!cur) {
        cur = { label: ctx.inline(l.text.trim(), l.loc), lines: [] };
        columns.push(cur);
        items.push({ key: String(columns.length), index: columns.length, kind: 'column', loc: l.loc, ...(l.name ? { name: l.name } : {}) });
      } else cur.lines.push(ctx.inline(l.text.trim(), l.loc));
    }
    if (columns.length < 2 || columns.length > 3)
      ctx.error(body[0]?.loc ?? { line: 0, col: 0 }, 'E139', `compare needs 2 or 3 columns, got ${columns.length}`, 'separate the columns with a line that is exactly ---');
    return { body: { columns }, items };
  },
  verbs: { show: ['block', 'items'], hide: ['block', 'items'], hl: ['block', 'items', 'none'], dim: ['block', 'items'] },
  runtime: {
    mount(el, body) {
      style('compare', CSS);
      el.classList.add('m-compare', 'xp');
      doms.set(el, body.columns.map(col => {
        const part = h('div', 'm-col xp', el);
        lineBar(part);
        envelope(h('div', 'm-label', part), col.label, []).el.dataset.declared = '';
        for (const line of col.lines) envelope(h('div', isDisplay(line) ? 'm-line m-display' : 'm-line', part), line, []).el.dataset.declared = '';
        return part;
      }));
    },
    measure(el, width) {
      const cols = doms.get(el)!;
      const gap = token('--region-gutter');
      const prose = token('--measure-max') + 2 * token('--space-5');
      for (const c of cols) c.style.width = `${prose}px`;
      // Whole px up: a column floored below its max-content wraps its last word ("In bed for about a / week").
      const widest = Math.ceil(Math.min(prose, Math.max(...cols.map(c => maxContent(c)))));
      // A code run never wraps, and a column's prose, like any fixed block's, never wraps narrower than
      // min(its natural width, --measure-min): narrower, the block overflows and the row is overfull (L410).
      // The prose floor gives way to an equal share of a full row, so columns that fit a row by wrapping always do.
      const row = token('--stage-w') - 2 * token('--margin-x');
      const share = Math.floor((row - gap * (cols.length - 1)) / cols.length);
      const least = Math.max(...cols.map(c => unbreakable(c)), Math.min(widest, token('--measure-min'), share));
      const each = Math.max(widest, least);
      const fit = Math.max(least, Math.min(each, (width - gap * (cols.length - 1)) / cols.length));
      for (const c of cols) c.style.width = `${Math.floor(fit)}px`;   // floor: the columns never add up past `width`
      const natural = Math.ceil(each * cols.length + gap * (cols.length - 1));
      el.style.width = `${Math.min(natural, width)}px`;
      return { natural, height: el.offsetHeight };
    },
    render(el, s) {
      root(el, s.self);
      doms.get(el)!.forEach((c, i) => channels(c, inherit(s.self, s.items[String(i + 1)], true)));
    },
  },
};

const CSS = `
.m-compare { display: flex; gap: var(--region-gutter); align-items: stretch; }
.m-col { flex: none; position: relative; display: flex; flex-direction: column; gap: var(--space-4); padding: var(--space-5) var(--space-5);
  border-radius: var(--radius-field); overflow: hidden;
  background: color-mix(in srgb, var(--hl-fill-cell) calc(var(--hl) * 100%), var(--surface-1)); }
/* A compound part (column, card, frame) shows "now" as its bar and its label in amber; its body stays ink (rule 8). */
.m-label { font: var(--weight-medium) var(--text-label) / var(--leading-tight) var(--font-sans);
  color: color-mix(in srgb, var(--hl-now-ink) calc(var(--now) * 100%), var(--ink-3)); }
.m-line { --now: 0; font: var(--weight-regular) var(--text-body) / var(--leading-prose) var(--font-sans); color: var(--ink-1); }
.m-display { font: var(--weight-medium) var(--text-code) / var(--leading-code) var(--font-mono); white-space: pre; }
.m-display .x-code { font-weight: inherit; }
`;
