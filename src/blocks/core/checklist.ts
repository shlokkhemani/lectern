/**
 * `checklist`: `- [ ] item` / `- [x] item` lines (inline marks allowed), drawn as prose rows with a quiet
 * square and an `--ok` tick. Items are rows keyed `1…n`. `[set c:2 done]` / `[set c:2 todo]` draws or
 * erases the tick over the set's crossfade; any other value replaces the row's text (and the row keeps
 * its declared tick). Rows wrap at `--measure-max` like other prose.
 */
import type { Inline, ItemDecl } from '../../ir.ts';
import type { BlockModule, Content } from '../contract.ts';
import { channels, root, envelope, h, inherit, lineBar, maxContent, num, plain, showContent, style, svg, token, type Envelope, hugWidth, caption } from '../kit.ts';

interface Entry { text: Inline; done: boolean }
interface ChecklistBody { entries: Entry[] }
interface Row { part: HTMLElement; env: Envelope; tick: SVGPathElement; done: boolean }
interface Dom { rows: Map<string, Row> }

const doms = new WeakMap<HTMLElement, Dom>();
const LINE = /^\s*[-*] \[([ xX])\]\s+(.*)$/;

/** `done` → 1, `todo` → 0, anything else is replacement text. */
function stateOf(c: Inline): number | undefined {
  const t = plain(c).trim();
  return t === 'done' ? 1 : t === 'todo' ? 0 : undefined;
}

export const checklist: BlockModule<ChecklistBody> = {
  type: 'checklist',
  pack: 'core',
  args: {},
  flexible: false,
  parse(body, _args, ctx) {
    const entries: Entry[] = [];
    const items: ItemDecl[] = [];
    for (const l of body) {
      if (!l.text.trim()) continue;
      const m = l.text.match(LINE);
      if (!m) ctx.error(l.loc, 'E130', `checklist lines start with "- [ ] " or "- [x] "`, `write "- [ ] ${l.text.trim().replace(/^[-*]\s*(\[[^\]]*\]\s*)?/, '')}"`);
      const text = m![2]!.trim();
      if (!text) ctx.error(l.loc, 'E130', 'checklist item has no text', 'write the item after the box: "- [ ] write the parser"');
      entries.push({ text: ctx.inline(text, { line: l.loc.line, col: l.text.indexOf(text) + 1 }), done: m![1] !== ' ' });
      items.push({ key: String(items.length + 1), index: items.length + 1, kind: 'item', loc: l.loc, ...(l.name ? { name: l.name } : {}) });
    }
    if (!entries.length) ctx.error(body[0]?.loc ?? { line: 0, col: 0 }, 'E130', 'checklist is empty', 'write one "- [ ] item" per line');
    return { body: { entries }, items };
  },
  verbs: { show: ['block', 'items'], hide: ['block', 'items'], hl: ['block', 'items', 'none'], dim: ['block', 'items'], set: ['items'] },
  runtime: {
    mount(el, body, _args, reachable, text) {
      style('checklist', CSS);
      el.classList.add('ck-list', 'xp');
      caption(el, text);
      const rows = new Map<string, Row>();
      body.entries.forEach((e, i) => {
        const key = String(i + 1);
        const part = h('div', 'ck-item xp x-band', el);
        lineBar(part);
        const box = svg('svg', part);
        box.setAttribute('class', 'ck-box');
        const sq = svg('rect', box);
        sq.setAttribute('class', 'ck-sq');
        const tick = svg('path', box);
        tick.setAttribute('class', 'ck-tick');
        tick.setAttribute('pathLength', '1');
        const texts = (reachable.items[key] ?? []).filter(c => stateOf(c) === undefined);
        const env = envelope(part, e.text, texts, 'ck-text');
        env.el.dataset.declared = '';
        rows.set(key, { part, env, tick, done: e.done });
      });
      doms.set(el, { rows });
    },
    measure(el, width) {
      const natural = Math.ceil(Math.min(maxContent(el), token('--measure-max')));
      el.style.width = `${Math.min(natural, width)}px`;
      return { natural, height: el.offsetHeight, width: hugWidth(el) };
    },
    geometry(el) {
      // Draw the square and tick in px user units so strokes and the corner radius are theme tokens.
      const r = token('--radius-cell') / 2;
      for (const box of el.querySelectorAll<SVGSVGElement>('.ck-box')) {
        const n = box.clientWidth;
        if (!n) continue;
        box.setAttribute('viewBox', `0 0 ${num(n)} ${num(n)}`);
        const sq = box.querySelector('.ck-sq')!;
        for (const [k, v] of [['width', n], ['height', n], ['rx', r], ['ry', r]] as const) sq.setAttribute(k, num(v));
        const at = (x: number, y: number) => `${num(x * n)} ${num(y * n)}`;
        box.querySelector('.ck-tick')!.setAttribute('d', `M${at(0.27, 0.53)} L${at(0.44, 0.69)} L${at(0.74, 0.33)}`);
      }
    },
    render(el, s) {
      const d = doms.get(el)!;
      root(el, s.self);
      for (const [key, row] of d.rows) {
        const it = s.items[key];
        channels(row.part, inherit(s.self, it));
        const c = it?.content;
        showContent(row.env, c && stateOf(c.cur) === undefined ? c : undefined);
        const done = doneAt(c, row.done);
        row.tick.style.strokeDashoffset = num(1 - done);
        row.tick.style.opacity = done > 0 ? '1' : '0';
      }
    },
  },
};

/**
 * How much of the tick is drawn: the declared state, or a `done`/`todo` set crossfading from the previous
 * state. A part's first set carries no `prev` (its declared content lives only in the page), so the
 * crossfade starts from the declared state.
 */
function doneAt(c: Content | undefined, declared: boolean): number {
  const base = declared ? 1 : 0;
  const cur = c ? stateOf(c.cur) : undefined;
  if (cur === undefined) return base;
  if (c!.p >= 1) return cur;
  const prev = c!.prev ? stateOf(c!.prev) ?? base : base;
  return prev + (cur - prev) * c!.p;
}

const CSS = `
.ck-list { display: flex; flex-direction: column; width: max-content;
  gap: calc(var(--space-3) + (var(--pitch, 1) - 1) * (var(--text-body) * var(--leading-prose) + var(--space-3))); }
.ck-item { position: relative; display: grid; grid-template-columns: auto 1fr; column-gap: var(--space-4); align-items: start;
  padding: var(--space-1) var(--space-4); border-radius: var(--radius-cell);
  --flash: calc(var(--now) * (1 - var(--hl)) * 100%); }
.ck-box { width: calc(var(--space-4) + var(--space-1)); height: calc(var(--space-4) + var(--space-1));
  margin-top: calc((var(--text-body) * var(--leading-prose) - var(--space-4) - var(--space-1)) / 2); overflow: visible; }
.ck-sq { fill: var(--surface-3); }
.ck-tick { fill: none; stroke: var(--ok); stroke-width: var(--stroke-mark);
  stroke-linecap: round; stroke-linejoin: round; stroke-dasharray: 1; }
.ck-text { font: var(--weight-regular) var(--text-body) / var(--leading-prose) var(--font-sans);
  color: color-mix(in srgb, var(--hl-now-ink) var(--flash), var(--ink-1)); }
`;
