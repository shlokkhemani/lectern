/**
 * `bullets`: a flat list (`- item`), left-aligned, capped at `--measure-max`. Each item has a short dash
 * marker; `hl` turns the dash into the highlight bar (held grey, now amber) over a faint band.
 */
import type { Inline, ItemDecl } from '../../ir.ts';
import type { BlockModule } from '../contract.ts';
import { anchorOf, channels, root, swapPlace, type Anchor, envelope, h, inherit, maxContent, showContent, style, token, unbreakable, type Envelope, hugWidth, caption } from '../kit.ts';

interface BulletsBody { items: Inline[] }
const doms = new WeakMap<HTMLElement, { part: HTMLElement; env: Envelope }[]>();
const anchors = new WeakMap<HTMLElement, Map<string, Anchor>>();

export const bullets: BlockModule<BulletsBody> = {
  type: 'bullets',
  pack: 'core',
  args: {},
  flexible: false,
  parse(body, _args, ctx) {
    const out: Inline[] = [];
    const items: ItemDecl[] = [];
    for (const l of body) {
      if (!l.text.trim()) continue;
      const m = l.text.match(/^\s*- (.*)$/);
      if (!m) ctx.error(l.loc, 'E135', 'bullets lines start with "- "', 'write each item as "- text"');
      out.push(ctx.inline(m![1]!.trim(), l.loc));
      items.push({ key: String(out.length), index: out.length, kind: 'item', loc: l.loc, ...(l.name ? { name: l.name } : {}) });
    }
    if (!out.length) ctx.error(body[0]?.loc ?? { line: 0, col: 0 }, 'E130', 'bullets is empty', 'write at least one "- item"');
    return { body: { items: out }, items };
  },
  verbs: { show: ['block', 'items'], hide: ['block', 'items'], hl: ['block', 'items', 'none'], dim: ['block', 'items'], set: ['items'], swap: ['items'] },
  runtime: {
    mount(el, body, _args, reachable, text) {
      style('bullets', CSS);
      el.classList.add('u-bullets', 'xp');
      caption(el, text);
      doms.set(el, body.items.map((c, i) => {
        const part = h('div', 'u-item xp x-band', el);
        h('span', 'u-dash', part);
        const env = envelope(part, c, reachable.items[String(i + 1)], 'u-text');
        env.el.dataset.declared = '';
        return { part, env };
      }));
    },
    measure(el, width) {
      el.style.width = `${token('--measure-max')}px`;
      const natural = Math.ceil(Math.min(maxContent(el), Math.max(token('--measure-max'), unbreakable(el))));
      el.style.width = `${Math.min(natural, width)}px`;
      return { natural, height: el.offsetHeight, width: hugWidth(el) };
    },
    geometry(el) {
      anchors.set(el, new Map(doms.get(el)!.map(({ part }, i) => [String(i + 1), anchorOf(part, el)])));
    },
    render(el, s) {
      root(el, s.self);
      const at = anchors.get(el) ?? new Map<string, Anchor>();
      doms.get(el)!.forEach(({ part, env }, i) => {
        const key = String(i + 1);
        channels(part, inherit(s.self, s.items[key], true));
        swapPlace(part, at, key, s.items[key]?.swap, 'y');
        showContent(env, s.items[String(i + 1)]?.content);
      });
    },
  },
};

const CSS = `
/* Item pitch opens with --pitch (layout fill rule): one line's pitch times the pitch. */
.u-bullets { display: flex; flex-direction: column;
  gap: calc(var(--space-5) + (var(--pitch, 1) - 1) * (var(--text-body) * var(--leading-prose) + var(--space-5))); }
.u-item { position: relative; padding: 0 var(--space-2) 0 var(--space-6); border-radius: var(--radius-cell); }
.u-text { font: var(--weight-regular) var(--text-body) / var(--leading-prose) var(--font-sans); color: var(--ink-1); display: inline-grid; }
.u-dash { position: absolute; left: var(--space-2); top: calc(var(--text-body) * var(--leading-prose) / 2); width: var(--space-3);
  height: var(--stroke-mark); translate: 0 -50%;
  background: color-mix(in srgb, var(--hl-now-bar) calc(var(--now) * var(--hl) * 100%),
              color-mix(in srgb, var(--hl-held-bar) calc(var(--hl) * 100%), var(--ink-3))); }
`;
