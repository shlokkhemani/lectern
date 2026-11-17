/**
 * `text`: inline text lines, centred. A line that is one code span is display code. Items are lines;
 * `set` on the block replaces every line with one value (a running readout such as a trace note).
 */
import type { Inline } from '../../ir.ts';
import type { BlockModule } from '../contract.ts';
import { channels, root, envelope, h, inherit, lineBar, maxContent, showContent, style, token, unbreakable, type Envelope, hugWidth, caption } from '../kit.ts';

interface Line { content: Inline; display: boolean }
interface TextBody { lines: Line[] }
interface Dom { lines: Map<string, { part: HTMLElement; env: Envelope }>; whole: Envelope }

const doms = new WeakMap<HTMLElement, Dom>();

/** One code span and nothing else: display code. */
export const isDisplay = (c: Inline): boolean => c.length === 1 && typeof c[0] !== 'string' && c[0]!.role === 'code';

export const text: BlockModule<TextBody> = {
  type: 'text',
  pack: 'core',
  args: {},
  flexible: false,
  parse(body, _args, ctx) {
    const lines: Line[] = [];
    const items = body.filter(l => l.text.trim()).map((l, i) => {
      const content = ctx.inline(l.text.trim(), l.loc);
      lines.push({ content, display: isDisplay(content) });
      return { key: String(i + 1), index: i + 1, kind: 'line', loc: l.loc, ...(l.name ? { name: l.name } : {}) };
    });
    if (!lines.length) ctx.error(body[0]?.loc ?? { line: 0, col: 0 }, 'E130', 'text block is empty', 'write at least one line, or use `—` as a placeholder you `set` later');
    return { body: { lines }, items };
  },
  verbs: { show: ['block', 'items'], hide: ['block', 'items'], hl: ['block', 'items', 'none'], dim: ['block', 'items'], set: ['block', 'items'] },
  runtime: {
    mount(el, body, _args, reachable, text) {
      style('text', CSS);
      el.classList.add('t-text', 'xp');
      caption(el, text);
      const lines = new Map<string, { part: HTMLElement; env: Envelope }>();
      const whole = envelope(el, [], reachable.self, 't-whole xp', (alt, c) => {
        if (c.length) { drawLine(alt, c, isDisplay(c)); return; }
        body.lines.forEach((line, i) => {
          const key = String(i + 1);
          const part = h('div', 't-part xp x-band', alt);
          lineBar(part);
          const env = envelope(part, line.content, reachable.items[key], line.display ? 't-line t-display' : 't-line');
          env.el.dataset.declared = '';
          lines.set(key, { part, env });
        });
      });
      delete whole.el.dataset.leaf;
      doms.set(el, { lines, whole });
    },
    measure(el, width) {
      el.style.width = `${token('--measure-max')}px`;
      const natural = Math.ceil(Math.min(maxContent(el), Math.max(token('--measure-max'), widestDisplay(el), unbreakable(el))));
      el.style.width = `${Math.min(natural, width)}px`;
      return { natural, height: el.offsetHeight, width: hugWidth(el) };
    },
    render(el, s) {
      const d = doms.get(el)!;
      root(el, s.self);
      // A block-level `set` replaces every line with one value, drawn outside the line parts: it is a part of its own.
      channels(d.whole.el, s.self.content ? { now: s.self.now, recede: s.self.recede } : { now: 0, recede: 0 });
      showContent(d.whole, s.self.content);
      for (const [key, { part, env }] of d.lines) {
        channels(part, inherit(s.self, s.items[key], true));
        showContent(env, s.items[key]?.content);
      }
    },
  },
};

function drawLine(el: HTMLElement, c: Inline, display: boolean): void {
  const env = envelope(el, c, [], display ? 't-line t-display' : 't-line');
  env.el.dataset.declared = '';
}

function widestDisplay(el: HTMLElement): number {
  let w = 0;
  // Measured on the line's part, so its band padding counts: display code never wraps.
  el.querySelectorAll<HTMLElement>('.t-display').forEach(d => { w = Math.max(w, maxContent(d.closest<HTMLElement>('.t-part') ?? d)); });
  return w;
}

const CSS = `
.t-text { text-align: center; color: var(--ink-1); }   /* on the root, so a set value's slot (.x-set) can turn it amber */
.t-whole { display: grid; width: 100%; }
.t-whole > .x-alt-slot { display: flex; flex-direction: column; gap: var(--space-3); }
.t-part { position: relative; padding: 0 var(--space-4); border-radius: var(--radius-cell); }
.t-line { font: var(--weight-regular) var(--text-body) / var(--leading-prose) var(--font-sans); }
.t-display { font: var(--weight-medium) var(--text-token) / var(--leading-tight) var(--font-mono); white-space: pre; }
.t-display .x-code { font-weight: inherit; }
`;
