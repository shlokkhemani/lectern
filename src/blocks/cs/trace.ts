/**
 * `trace`: a watch panel of `name = value` rows on a field, names and `=` aligned in columns. Names are
 * verbatim; values take inline marks. Items are rows keyed by name (unique), so `[set tr:x 5]` reads like
 * the program; a name with spaces is selected like a chart series, by its index (`tr:2`) or a `#name`. The value is the row's glyph: it flashes amber while now. During a `set` crossfade the
 * outgoing value is struck through (the kit marks it `x-struck`), so the change reads as a correction.
 */
import type { Inline, ItemDecl, Loc } from '../../ir.ts';
import type { BlockModule } from '../contract.ts';
import { root, channels, envelope, h, inherit, lineBar, maxContent, showContent, style, type Envelope } from '../kit.ts';

interface Row { name: string; value: Inline }
interface TraceBody { rows: Row[] }
interface Dom { cap?: HTMLElement; rows: Map<string, { part: HTMLElement; env: Envelope }> }

const doms = new WeakMap<HTMLElement, Dom>();

export const trace: BlockModule<TraceBody> = {
  type: 'trace',
  pack: 'cs',
  args: {},
  flexible: false,
  parse(body, _args, ctx) {
    const rows: Row[] = [];
    const items: ItemDecl[] = [];
    const seen = new Map<string, Loc>();
    for (const l of body) {
      if (!l.text.trim()) continue;
      const m = l.text.match(/^(\s*)(\S(?:.*?\S)?)\s*=(?!=)\s?(.*)$/);
      if (!m) ctx.error(l.loc, 'E136', `trace row "${l.text.trim()}" has no "="`, `write it as "name = value", e.g. "${l.text.trim()} = 0"`);
      const name = m![2]!, raw = m![3]!.trim();
      const prev = seen.get(name);
      if (prev) ctx.error(l.loc, 'E136', `trace row "${name}" is already declared at line ${prev.line}`, 'give each row a distinct name; to change a value over time, `set` it');
      seen.set(name, l.loc);
      const col = l.text.indexOf(raw, m![1]!.length + name.length) + 1;
      rows.push({ name, value: raw ? ctx.inline(raw, { line: l.loc.line, col: col || l.loc.col }) : [] });
      items.push({ key: name, index: items.length + 1, kind: 'row', loc: l.loc, ...(l.name ? { name: l.name } : {}) });
    }
    if (!rows.length) ctx.error(body[0]?.loc ?? { line: 0, col: 0 }, 'E130', 'trace block is empty', 'write one "name = value" row per line');
    return { body: { rows }, items };
  },
  verbs: { show: ['block', 'items'], hide: ['block', 'items'], hl: ['block', 'items', 'none'], dim: ['block', 'items'], set: ['items'] },
  runtime: {
    mount(el, body, _args, reachable, caption) {
      style('trace', CSS);
      el.classList.add('tr-trace', 'xp');
      const cap = caption ? h('div', 'x-caption tr-cap xp', el) : undefined;
      if (cap) { cap.textContent = caption!; cap.dataset.leaf = ''; }
      const field = h('div', 'tr-field', el);
      const rows = new Map<string, { part: HTMLElement; env: Envelope }>();
      for (const row of body.rows) {
        const part = h('div', 'tr-row xp x-band', field);
        lineBar(part);
        const name = h('span', 'tr-name', part);
        name.textContent = row.name;
        name.dataset.leaf = '';
        h('span', 'tr-eq', part).textContent = '=';
        const env = envelope(part, row.value, reachable.items[row.name], 'tr-val');
        if (row.value.length) env.el.dataset.declared = '';
        rows.set(row.name, { part, env });
      }
      doms.set(el, { ...(cap ? { cap } : {}), rows });
    },
    measure(el, width) {
      const natural = Math.ceil(maxContent(el));
      el.style.width = `${Math.min(natural, width)}px`;
      return { natural, height: el.offsetHeight };
    },
    render(el, s) {
      const d = doms.get(el)!;
      root(el, s.self);
      if (d.cap) channels(d.cap, { recede: s.self.recede });
      for (const [key, { part, env }] of d.rows) {
        channels(part, inherit(s.self, s.items[key]));
        showContent(env, s.items[key]?.content);
      }
    },
  },
};

const CSS = `
.tr-trace { position: relative; width: max-content; }
.tr-cap { margin-bottom: var(--label-gap); }
.tr-field { display: grid; grid-template-columns: max-content max-content max-content; background: var(--surface-1);
  border-radius: var(--radius-field); padding: var(--space-3) 0; }
.tr-row { position: relative; display: grid; grid-template-columns: subgrid; grid-column: 1 / -1; align-items: center;
  height: var(--leading-code); font: var(--weight-regular) var(--text-code) / var(--leading-code) var(--font-mono);
  font-variant-numeric: var(--numeric); }
.tr-name { padding-left: var(--space-5); white-space: pre;
  color: color-mix(in srgb, var(--hl-held-ink) calc(var(--hl) * 100%), var(--ink-2)); }
.tr-eq { padding: 0 var(--space-3); color: var(--syn-punct); }
.tr-val { padding-right: var(--space-6); white-space: pre; font-weight: var(--weight-medium);
  color: color-mix(in srgb, var(--hl-now-ink) calc(var(--now) * 100%), var(--ink-1)); }
.tr-val .x-code { font-weight: inherit; }
.tr-val .x-struck, .tr-val .x-struck * { color: var(--ink-3); }
`;
