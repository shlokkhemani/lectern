/**
 * `table`: GFM-style rows; a `|---|` line makes the row above it a header. Items are body rows (`t:2`),
 * then cells keyed `r.c`. No rules or borders (rule 6): columns align on a grid, rows use the line look
 * (band + bar) when highlighted. Cells never wrap; a table too wide for its column is overfull (L410).
 */
import type { Inline, ItemDecl } from '../../ir.ts';
import type { BlockModule } from '../contract.ts';
import { anchorOf, channels, envelope, h, inherit, lineBar, maxContent, root, showContent, style, swapPlace, type Anchor, type Envelope, caption } from '../kit.ts';

interface TableBody { header?: Inline[]; rows: Inline[][]; cols: number }
interface Row { part: HTMLElement; whole: Envelope; cells: { part: HTMLElement; env: Envelope }[] }
interface Dom { header?: HTMLElement; rows: Row[]; anchors: Map<string, Anchor> }
const doms = new WeakMap<HTMLElement, Dom>();

/** Split `| a | b |` into cell texts; pipes inside backticks or braces do not split. */
export function cells(line: string): string[] {
  const s = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  const out: string[] = [];
  let cur = '', tick = false, depth = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (c === '\\' && s[i + 1] === '|') { cur += '|'; i++; continue; }
    if (c === '`') tick = !tick;
    else if (c === '{') depth++;
    else if (c === '}') depth--;
    if (c === '|' && !tick && depth <= 0) { out.push(cur.trim()); cur = ''; } else cur += c;
  }
  out.push(cur.trim());
  return out;
}

export const table: BlockModule<TableBody> = {
  type: 'table',
  pack: 'core',
  args: {},
  flexible: false,
  contentOutsideItems: true,   // its header is shown from the start, even when every item starts hidden
  parse(body, _args, ctx) {
    const lines = body.filter(l => l.text.trim());
    let header: Inline[] | undefined;
    const rows: { cells: Inline[]; loc: typeof body[number]['loc']; name?: string }[] = [];
    for (const l of lines) {
      if (!l.text.trim().startsWith('|')) ctx.error(l.loc, 'E137', 'table rows start with "|"', 'write each row as | cell | cell |');
      if (/^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(l.text.trim())) {
        const last = rows.pop();
        if (!last || header) ctx.error(l.loc, 'E138', 'a |---| line must follow the one header row', 'put |---| directly under the first row, once');
        header = last!.cells;
        continue;
      }
      rows.push({ cells: cells(l.text).map(c => ctx.inline(c, l.loc)), loc: l.loc, ...(l.name ? { name: l.name } : {}) });
    }
    const cols = Math.max(header?.length ?? 0, ...rows.map(r => r.cells.length));
    if (!rows.length) ctx.error(body[0]?.loc ?? { line: 0, col: 0 }, 'E130', 'table has no body rows', 'write at least one | cell | row');
    const items: ItemDecl[] = rows.map((r, i) => ({ key: String(i + 1), index: i + 1, kind: 'row', loc: r.loc, ...(r.name ? { name: r.name } : {}) }));
    rows.forEach((r, i) => r.cells.forEach((_, c) => items.push({ key: `${i + 1}.${c + 1}`, index: items.length + 1, kind: 'cell', loc: r.loc })));
    return { body: { ...(header ? { header } : {}), rows: rows.map(r => r.cells), cols }, items };
  },
  verbs: { show: ['block', 'items'], hide: ['block', 'items'], hl: ['block', 'items', 'none'], dim: ['block', 'items'], set: ['items'], swap: ['items'] },
  runtime: {
    mount(el, body, _args, reachable, text) {
      style('table', CSS);
      el.classList.add('a-table', 'xp');
      caption(el, text);
      el.style.setProperty('--cols', String(body.cols));
      const grid = h('div', 'a-grid', el);
      let header: HTMLElement | undefined;
      if (body.header) {
        header = h('div', 'a-row a-header xp', grid);
        body.header.forEach(c => envelope(h('div', 'a-cell', header), c, [], 'a-tx'));
      }
      const rows = body.rows.map((r, i) => {
        const part = h('div', 'a-row xp x-band', grid);
        lineBar(part);
        const cs = Array.from({ length: body.cols }, (_, c) => {
          const key = `${i + 1}.${c + 1}`;
          const cell = h('div', 'a-cell xp', part);
          cell.style.gridColumn = String(c + 1);
          const env = envelope(cell, r[c] ?? [], reachable.items[key], 'a-tx');
          if (r[c]?.length) env.el.dataset.declared = '';
          env.el.dataset.essential = '';   // L406: table cells are read (never below --text-label)
          return { part: cell, env };
        });
        // `set t:2 …` replaces the whole row with one value, drawn across all its columns over the cells.
        const whole = envelope(h('div', 'a-whole', part), [], reachable.items[String(i + 1)], 'a-tx xp');
        return { part, whole, cells: cs };
      });
      doms.set(el, { ...(header ? { header } : {}), rows, anchors: new Map() });
    },
    measure(el, width) {
      const natural = Math.ceil(maxContent(el));
      el.style.width = `${Math.min(natural, width)}px`;
      return { natural, height: el.offsetHeight };
    },
    geometry(el) {
      const d = doms.get(el)!;
      d.anchors.clear();
      d.rows.forEach((r, i) => {
        d.anchors.set(String(i + 1), anchorOf(r.part, el));
        r.cells.forEach((c, j) => d.anchors.set(`${i + 1}.${j + 1}`, anchorOf(c.part, el)));
      });
    },
    render(el, s) {
      const d = doms.get(el)!;
      root(el, s.self);
      if (d.header) channels(d.header, { recede: s.self.recede });
      d.rows.forEach((r, i) => {
        const key = String(i + 1), it = s.items[key];
        const row = inherit(s.self, it);
        // The row draws the band and bar; its cells draw the text and take the row's recession (rule 8).
        channels(r.part, { ...row, recede: 0 });
        swapPlace(r.part, d.anchors, key, it?.swap, 'y');
        const c = it?.content;
        showContent(r.whole, c);
        r.part.style.setProperty('--away', c ? (c.prev ? '1' : String(c.p)) : '0');
        channels(r.whole.el, { now: row.now, recede: row.recede });
        r.cells.forEach((cell, j) => {
          const ck = `${key}.${j + 1}`, ci = s.items[ck];
          // A cell lifts only for its own hl; the row's highlight is the band and bar.
          channels(cell.part, inherit({ ...row, hl: 0, now: 0 }, ci));
          swapPlace(cell.part, d.anchors, ck, ci?.swap, 'x');
          showContent(cell.env, ci?.content);
        });
      });
    },
  },
};

const CSS = `
.a-table { width: max-content; }
/* Row pitch opens with --pitch (layout fill rule): the space between rows grows by (pitch - 1) row heights, so
   the table's outer edges stay tight and the extra air sits between the rows, never above the first. */
.a-grid { display: grid; grid-template-columns: repeat(var(--cols), max-content); column-gap: var(--space-7);
  row-gap: calc((var(--pitch, 1) - 1) * (var(--leading-code) + 2 * var(--space-2))); }
.a-row { position: relative; display: grid; grid-template-columns: subgrid; grid-column: 1 / -1; align-items: center;
  padding: var(--space-2) var(--space-5); border-radius: var(--radius-cell); }
.a-header { padding-bottom: var(--space-3); }
.a-header .a-tx { font: var(--weight-regular) var(--text-label) / var(--leading-tight) var(--font-sans); color: var(--ink-2); }
.a-cell { border-radius: var(--radius-cell);
  background: color-mix(in srgb, var(--hl-fill-cell) calc(var(--hl) * 100%), transparent); }
.a-row > .a-cell { --hl: 0; grid-row: 1; }
.a-row > .a-cell.xp { opacity: calc(var(--vis) * (1 - var(--recede) * (1 - var(--recede-opacity))) * (1 - var(--away, 0))); }
.a-whole { grid-column: 1 / -1; grid-row: 1; align-self: center; }
.a-tx { font: var(--weight-regular) var(--text-code) / var(--leading-code) var(--font-sans); color: var(--ink-2); white-space: pre; }
/* A cell's own hl, as rows and trace values show theirs (rule 8): amber glyph while now, full-contrast ink while
   held, on the neutral lift. At rest the first column reads as the row's name. */
.a-row:not(.a-header) > .a-cell { --rest-ink: var(--ink-2); }
.a-row:not(.a-header) > .a-cell:first-of-type { --rest-ink: var(--ink-1); }
.a-row:not(.a-header) > .a-cell > .a-tx { color: color-mix(in srgb, var(--hl-now-ink) calc(var(--now) * 100%),
  color-mix(in srgb, var(--hl-held-ink) calc(var(--hl) * 100%), var(--rest-ink))); }
`;
