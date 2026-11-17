/**
 * `callout`: one short centred paragraph (capped at `--measure-max`). It has no variants: outcome colour goes in
 * the text, `{ok …}` / `{bad …}`. The block is the item: `hl` lifts it onto a cell, `now` turns its emphasised runs amber, `set` replaces it.
 */
import type { Inline } from '../../ir.ts';
import type { BlockModule } from '../contract.ts';
import { channels, envelope, showContent, style, token, unbreakable, type Envelope, hugWidth, caption } from '../kit.ts';

interface CalloutBody { content: Inline }
const doms = new WeakMap<HTMLElement, Envelope>();

export const callout: BlockModule<CalloutBody> = {
  type: 'callout',
  pack: 'core',
  args: {},
  flexible: false,
  parse(body, _args, ctx) {
    const lines = body.filter(l => l.text.trim());
    if (!lines.length) ctx.error(body[0]?.loc ?? { line: 0, col: 0 }, 'E130', 'callout is empty', 'write one or two sentences between the fences');
    const content = ctx.inline(lines.map(l => l.text.trim()).join(' '), lines[0]!.loc);
    return { body: { content }, items: [] };
  },
  verbs: { show: ['block'], hide: ['block'], hl: ['block', 'none'], dim: ['block'], set: ['block'] },
  runtime: {
    mount(el, body, _args, reachable, text) {
      style('callout', CSS);
      el.classList.add('o-callout', 'xp');
      caption(el, text);
      const env = envelope(el, body.content, reachable.self, 'o-text');
      env.el.dataset.declared = '';
      doms.set(el, env);
    },
    measure(el, width) {
      // The text wraps at the measure (or narrower, in a narrow column), then the callout hugs its longest
      // line, so its box holds no dead space; stacked callouts may differ in width.
      el.style.width = `${token('--measure-max')}px`;
      const natural = Math.max(Math.ceil(token('--measure-max')), unbreakable(el));
      el.style.width = `${Math.min(natural, width)}px`;
      return { natural, height: el.offsetHeight, width: hugWidth(el) };
    },
    render(el, s) {
      channels(el, s.self);
      showContent(doms.get(el)!, s.self.content);
    },
  },
};

const CSS = `
.o-callout { display: flex; flex-direction: column; align-items: center; gap: var(--space-3); text-align: center;
  padding: var(--space-3) var(--space-4); border-radius: var(--radius-cell);
  background: color-mix(in srgb, var(--hl-fill-cell) calc(var(--hl) * 100%), transparent); }
.o-text { font: var(--weight-regular) var(--text-body) / var(--leading-prose) var(--font-sans); color: var(--ink-1); }
`;
