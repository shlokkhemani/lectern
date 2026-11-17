/**
 * `title`: the title card. Line 1 is the title, line 2 the subtitle, then `- ` chips (the items): the
 * video's promises, drawn as a row of equal cells under the title: their fills carry enough weight that
 * the heavy title line never leaves the card top-heavy.
 */
import type { Inline, ItemDecl } from '../../ir.ts';
import type { BlockModule } from '../contract.ts';
import { channels, root, envelope, h, inherit, maxContent, showContent, style, type Envelope } from '../kit.ts';

interface TitleBody { title: Inline; subtitle?: Inline; chips: Inline[] }
const doms = new WeakMap<HTMLElement, { parts: { part: HTMLElement; env: Envelope }[]; lead: HTMLElement }>();

export const title: BlockModule<TitleBody> = {
  type: 'title',
  pack: 'core',
  args: {},
  flexible: false,
  contentOutsideItems: true,   // its heading is shown from the start, even when every item starts hidden
  parse(body, _args, ctx) {
    const lines = body.filter(l => l.text.trim());
    const heads = lines.filter(l => !/^\s*- /.test(l.text));
    if (!heads.length) ctx.error(body[0]?.loc ?? { line: 0, col: 0 }, 'E130', 'title has no title line', 'write the title on the first line');
    if (heads.length > 2) ctx.error(heads[2]!.loc, 'E136', 'title takes a title line and a subtitle line, then "- " chips', 'start the extra line with "- " to make it a chip, or remove it');
    const chips: Inline[] = [];
    const items: ItemDecl[] = [];
    for (const l of lines) {
      const m = l.text.match(/^\s*- (.*)$/);
      if (!m) continue;
      chips.push(ctx.inline(m[1]!.trim(), l.loc));
      items.push({ key: String(chips.length), index: chips.length, kind: 'chip', loc: l.loc, ...(l.name ? { name: l.name } : {}) });
    }
    const t = ctx.inline(heads[0]!.text.trim(), heads[0]!.loc);
    const sub = heads[1] ? ctx.inline(heads[1].text.trim(), heads[1].loc) : undefined;
    return { body: { title: t, ...(sub ? { subtitle: sub } : {}), chips }, items };
  },
  verbs: { show: ['block', 'items'], hide: ['block', 'items'], hl: ['block', 'items', 'none'], dim: ['block', 'items'] },
  runtime: {
    mount(el, body, _args, reachable) {
      style('title', CSS);
      el.classList.add('i-title', 'xp');
      const lead = h('div', 'i-lead xp', el);
      const t = envelope(h('div', 'i-head', lead), body.title, [], 'i-t');
      t.el.dataset.declared = '';
      if (body.subtitle) envelope(h('div', 'i-sub', lead), body.subtitle, [], 'i-s').el.dataset.declared = '';
      const list = body.chips.length ? h('div', 'i-chips', el) : undefined;
      const parts = body.chips.map((c, i) => {
        const part = h('div', 'i-chip xp x-cell', list!);
        return { part, env: envelope(part, c, reachable.items[String(i + 1)], 'i-c') };
      });
      doms.set(el, { parts, lead });
    },
    measure(el, width) {
      const natural = Math.ceil(maxContent(el));
      el.style.width = `${Math.min(natural, width)}px`;
      return { natural, height: el.offsetHeight };
    },
    render(el, s) {
      root(el, s.self);
      channels(doms.get(el)!.lead, { recede: s.self.recede, now: s.self.now });
      doms.get(el)!.parts.forEach(({ part, env }, i) => {
        channels(part, inherit(s.self, s.items[String(i + 1)], true));
        showContent(env, s.items[String(i + 1)]?.content);
      });
    },
  },
};

const CSS = `
.i-title { display: flex; flex-direction: column; align-items: center; text-align: center; }
.i-lead { display: flex; flex-direction: column; align-items: center; }
.i-head { font: var(--weight-strong) var(--text-title) / var(--leading-tight) var(--font-sans); letter-spacing: var(--headline-tracking);
  color: var(--ink-1); text-wrap: balance; }
.i-head .x-env { display: inline; }
.i-sub { margin-top: var(--space-4); font: var(--weight-regular) var(--text-body) / var(--leading-prose) var(--font-sans); color: var(--ink-3); }
.i-chips { margin-top: var(--space-8); display: grid; grid-auto-columns: 1fr; grid-auto-flow: column; gap: var(--space-4); }
.i-chip { display: flex; align-items: center; justify-content: center; padding: var(--space-4) var(--space-5);
  max-width: calc(var(--measure-max) * 0.6); }
.i-c { font: var(--weight-regular) var(--text-body) / var(--leading-prose) var(--font-sans); text-wrap: balance;
  color: color-mix(in srgb, var(--hl-now-ink) calc(var(--now) * 100%), var(--ink-1)); }
`;
