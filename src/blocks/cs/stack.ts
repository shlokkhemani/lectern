/**
 * `stack` (CS pack): memory frames. An unindented `Title tag` line is a frame (the tag, an address or kind,
 * is optional: rulings 11); indented `key: value` lines are its rows. Items: frames (`f:1`), then rows
 * keyed `frame.key` or named with ` #name`. `show` pushes a frame, `hide` pops it; `set` replaces a value
 * (the old one is struck through while it crossfades).
 */
import type { Inline, ItemDecl } from '../../ir.ts';
import type { BlockModule } from '../contract.ts';
import { channels, envelope, h, inherit, lineBar, maxContent, root, showContent, style, type Envelope, caption } from '../kit.ts';

interface Row { key: string; value: Inline }
interface Frame { title: string; tag?: string; rows: Row[] }
interface StackBody { frames: Frame[] }
interface Dom { frames: { part: HTMLElement; head: HTMLElement; title: Envelope; rows: { key: string; part: HTMLElement; env: Envelope }[] }[] }
const doms = new WeakMap<HTMLElement, Dom>();

export const stack: BlockModule<StackBody> = {
  type: 'stack',
  pack: 'cs',
  args: {},
  flexible: false,
  parse(body, _args, ctx) {
    const frames: Frame[] = [];
    const frameItems: ItemDecl[] = [];
    const rowItems: ItemDecl[] = [];
    for (const l of body) {
      if (!l.text.trim()) continue;
      if (!/^\s/.test(l.text)) {
        const [title, ...tag] = l.text.trim().split(/\s+/);
        frames.push({ title: title!, ...(tag.length ? { tag: tag.join(' ') } : {}), rows: [] });
        frameItems.push({ key: String(frames.length), index: 0, kind: 'frame', depth: 0, loc: l.loc, ...(l.name ? { name: l.name } : {}) });
        continue;
      }
      const f = frames.at(-1);
      if (!f) ctx.error(l.loc, 'E140', 'a stack row comes before any frame', 'start with an unindented frame line, e.g. "main 0xc000"');
      const m = l.text.trim().match(/^([^:]+):\s*(.*)$/);
      if (!m) ctx.error(l.loc, 'E141', 'stack rows are "key: value"', 'write the row as key: value');
      const key = m![1]!.trim();
      if (f!.rows.some(r => r.key === key)) ctx.error(l.loc, 'E142', `frame "${f!.title}" already has a row "${key}"`, 'give each row in a frame a different key');
      f!.rows.push({ key, value: ctx.inline(m![2]!.trim(), l.loc) });
      rowItems.push({ key: `${frames.length}.${key}`, index: 0, kind: 'row', depth: 1, loc: l.loc, ...(l.name ? { name: l.name } : {}) });
    }
    if (!frames.length) ctx.error(body[0]?.loc ?? { line: 0, col: 0 }, 'E130', 'stack has no frames', 'write a frame line, then indented key: value rows');
    const items = [...frameItems, ...rowItems].map((it, i) => ({ ...it, index: i + 1 }));
    return { body: { frames }, items };
  },
  verbs: { show: ['block', 'items'], hide: ['block', 'items'], hl: ['block', 'items', 'none'], dim: ['block', 'items'], set: ['items'] },
  runtime: {
    mount(el, body, _args, reachable, text) {
      style('stack', CSS);
      el.classList.add('f-stack', 'xp');
      caption(el, text);
      const frames = body.frames.map((f, i) => {
        const part = h('div', 'f-frame xp', el);
        lineBar(part);
        const head = h('div', 'f-head xp', part);
        // `set s:1 …` retitles the frame (the frame's own content is its title).
        const title = envelope(h('span', 'f-title', head), [f.title], reachable.items[String(i + 1)], 'f-tenv');
        title.el.dataset.declared = '';
        if (f.tag) { const g = h('span', 'f-tag', head); g.textContent = f.tag; g.dataset.leaf = ''; }
        const rows = f.rows.map(r => {
          const key = `${i + 1}.${r.key}`;
          const rp = h('div', 'f-row xp x-band', part);
          lineBar(rp);
          const k = h('span', 'f-key', rp);
          k.textContent = r.key;
          k.dataset.leaf = '';
          return { key, part: rp, env: envelope(rp, r.value, reachable.items[key], 'f-val') };
        });
        return { part, head, title, rows };
      });
      doms.set(el, { frames });
    },
    measure(el, width) {
      const natural = Math.ceil(maxContent(el));
      el.style.width = `${Math.min(natural, width)}px`;
      return { natural, height: el.offsetHeight };
    },
    render(el, s) {
      root(el, s.self);
      doms.get(el)!.frames.forEach((f, i) => {
        const it = s.items[String(i + 1)];
        const fs = inherit(s.self, it);
        // The frame draws its fill (lifted by its own hl); its title and rows draw text and take its recession.
        channels(f.part, { vis: fs.vis, hl: it?.hl ?? 0, now: it?.now ?? 0, recede: 0 });
        channels(f.head, { now: fs.now, recede: fs.recede });
        showContent(f.title, it?.content);
        for (const r of f.rows) {
          channels(r.part, inherit({ ...fs, hl: 0, now: 0 }, s.items[r.key]));
          showContent(r.env, s.items[r.key]?.content);
        }
      });
    },
  },
};

const CSS = `
.f-stack { display: flex; flex-direction: column; gap: var(--space-4); width: max-content; }
.f-frame { position: relative; display: grid; grid-template-columns: max-content max-content; column-gap: var(--space-5);
  padding: var(--space-3) 0 var(--space-3); border-radius: var(--radius-field);
  background: color-mix(in srgb, var(--hl-fill-cell) calc(var(--hl) * 100%), var(--surface-1)); }
.f-head { grid-column: 1 / -1; display: flex; justify-content: space-between; align-items: baseline; gap: var(--space-6); padding: 0 var(--space-5) var(--space-2); }
.f-title { font: var(--weight-medium) var(--text-label) / var(--leading-tight) var(--font-sans);
  color: color-mix(in srgb, var(--hl-now-ink) calc(var(--now) * 100%), var(--ink-1)); }
.f-tag { font: var(--weight-regular) var(--text-meta) / var(--leading-tight) var(--font-mono); color: var(--ink-3); }
.f-row { position: relative; display: grid; grid-template-columns: subgrid; grid-column: 1 / -1;
  align-items: baseline; padding: 0 var(--space-5); }
.f-key { font: var(--weight-regular) var(--text-label) / var(--leading-code) var(--font-mono); color: var(--ink-3); }
.f-val { font: var(--weight-medium) var(--text-code) / var(--leading-code) var(--font-mono);
  color: color-mix(in srgb, var(--hl-now-ink) calc(var(--now) * 100%), var(--ink-1)); }
`;
