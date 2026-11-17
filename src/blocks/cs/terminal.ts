/**
 * `terminal`: a shell session on a field, verbatim (rulings 3: no inline marks) and never wrapped.
 * A line starting `$ ` is a command: the prompt steps back and the command reads at full contrast; every
 * other line is output, one step quieter. Blank lines inside the body keep their space but are not items.
 * Items are the non-blank lines, keyed `1…n` in reading order. A line takes a global name only after two
 * or more spaces (`$ go test  #run`). `set` replaces a line; a value starting `$ ` is drawn as a command.
 */
import type { Inline, ItemDecl } from '../../ir.ts';
import type { BlockModule } from '../contract.ts';
import { root, channels, envelope, h, inherit, lineBar, maxContent, plain, showContent, style, type Envelope } from '../kit.ts';

interface TermLine { text: string; key?: string }
interface TermBody { lines: TermLine[] }
interface Dom { cap?: HTMLElement; lines: Map<string, { part: HTMLElement; env: Envelope }> }

const NAME_TAIL = /\s{2,}#([a-z][a-z0-9-]*)$/;
const doms = new WeakMap<HTMLElement, Dom>();

export const terminal: BlockModule<TermBody> = {
  type: 'terminal',
  pack: 'cs',
  args: {},
  flexible: false,
  parse(body, _args, ctx) {
    const raws = body.map(b => {
      const m = b.raw.match(NAME_TAIL);
      return { raw: (m ? b.raw.slice(0, m.index) : b.raw).trimEnd(), name: m?.[1], loc: b.loc };
    });
    // Blank lines at either end are layout noise; inside the session they are part of it.
    while (raws.length && !raws[0]!.raw.trim()) raws.shift();
    while (raws.length && !raws.at(-1)!.raw.trim()) raws.pop();
    const lines: TermLine[] = [];
    const items: ItemDecl[] = [];
    for (const r of raws) {
      if (!r.raw.trim()) { lines.push({ text: '' }); continue; }
      const key = String(items.length + 1);
      lines.push({ text: r.raw, key });
      items.push({ key, index: items.length + 1, kind: 'line', loc: r.loc, ...(r.name ? { name: r.name } : {}) });
    }
    if (!items.length) ctx.error(body[0]?.loc ?? { line: 0, col: 0 }, 'E130', 'terminal block is empty', 'write the session between the fences: `$ command` lines and their output');
    return { body: { lines }, items };
  },
  verbs: { show: ['block', 'items'], hide: ['block', 'items'], hl: ['block', 'items', 'none'], dim: ['block', 'items'], set: ['items'] },
  runtime: {
    mount(el, body, _args, reachable, caption) {
      style('terminal', CSS);
      el.classList.add('tm-term', 'xp');
      const cap = caption ? h('div', 'x-caption tm-cap xp', el) : undefined;
      if (cap) { cap.textContent = caption!; cap.dataset.leaf = ''; }
      const field = h('div', 'tm-field', el);
      const lines = new Map<string, { part: HTMLElement; env: Envelope }>();
      for (const line of body.lines) {
        if (!line.key) { h('div', 'tm-ln tm-blank', field); continue; }
        const part = h('div', 'tm-ln xp x-band', field);
        lineBar(part);
        const env = envelope(part, [line.text], reachable.items[line.key], 'tm-tx', drawLine);
        env.el.dataset.declared = '';
        lines.set(line.key, { part, env });
      }
      doms.set(el, { ...(cap ? { cap } : {}), lines });
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
      for (const [key, { part, env }] of d.lines) {
        channels(part, inherit(s.self, s.items[key]));
        showContent(env, s.items[key]?.content);
      }
    },
  },
};

/** One terminal line from verbatim text (a `set` value's marks are dropped: terminal text is literal). */
function drawLine(el: HTMLElement, c: Inline): void {
  const text = plain(c);
  if (text.startsWith('$ ')) {
    h('span', 'tm-ps', el).textContent = '$';
    h('span', 'tm-cmd', el).textContent = text.slice(1);
  } else h('span', 'tm-out', el).textContent = text;
}

const CSS = `
.tm-term { position: relative; width: max-content; }
.tm-cap { margin-bottom: var(--label-gap); }
.tm-field { display: grid; background: var(--surface-1); border-radius: var(--radius-field); padding: var(--space-3) 0; }
.tm-ln { position: relative; height: var(--leading-code); padding: 0 var(--space-6) 0 var(--space-5);
  font: var(--weight-regular) var(--text-code) / var(--leading-code) var(--font-mono); tab-size: var(--tab-size); }
.tm-tx { white-space: pre; }
/* The prompt is the line's glyph: amber whenever the line is now (like a code line number). The text flashes
   amber only when the line is now without a highlight (a fresh set); a highlighted line already has
   its amber bar and keeps its text at full contrast. */
.tm-ln { --flash: calc(var(--now) * (1 - var(--hl)) * 100%); }
.tm-ps { color: color-mix(in srgb, var(--hl-now-ink) calc(var(--now) * 100%), var(--ink-3)); }
.tm-cmd { color: color-mix(in srgb, var(--hl-now-ink) var(--flash), var(--ink-1)); }
.tm-out { color: color-mix(in srgb, var(--hl-now-ink) var(--flash),
  color-mix(in srgb, var(--hl-held-ink) calc(var(--hl) * 100%), var(--ink-2))); }
`;
