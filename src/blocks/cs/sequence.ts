/**
 * `sequence`: a message diagram. Time flows down; each message is a horizontal arrow from sender to receiver,
 * its label above it. Messages happen one after another (reading order is time order), so a slant would show
 * nothing a row does not.
 *
 *   Client | Server                       participants, left to right (optional: else in order of first mention)
 *   Server: LISTEN                        a note: a state on that participant's lifeline, at the current time
 *   Client -> Server: SYN · seq 1000      a message; `-->` dashed (old, delayed, async), `-x` lost on the way
 *   Client: SYN-SENT                        (ends in a cross), `--x` dashed and lost. `->>` and `-->>` also work.
 *
 * Items: messages keyed 1, 2, 3 in order (`hs:2`, `hs:1-3`), notes `<participant>.<n>` (`hs:client.2`, the
 * client's second note), participants by name in lowercase with dashes (`hs:web-server`); any line may end
 * in `#name`. `show` on a message draws it from sender to receiver over the show transition (the packet
 * travels; a lost one stops short and its cross appears); `grow` the same, staggered in order. `hl` lights a
 * message and its label; `set` changes a label, a note or a name.
 *
 * Layout: lifelines spread to the region's width, between what the widest label needs and `--seq-span-max`
 * (beyond that the diagram scales up instead, so its text grows). A message sits one step below the latest
 * event before it (reading order is time order). A note sits at its participant's latest event (beside a
 * departure or an arrival).
 * Then everything is placed in reading order at the first height where nothing it draws meets anything
 * already placed: labels clear labels, notes, lifelines and other messages, by construction, so they never
 * collide. Steps open with the flexible pitch. Notes of the outer participants sit outside their lifeline;
 * an inner participant's notes sit to its right.
 */
import type { Inline, ItemDecl } from '../../ir.ts';
import type { BlockModule, BlockLintIssue, Channels } from '../contract.ts';
import { channels, envelope, h, inherit, maxContent, num, pitchOf, plain, scaleOf, showContent, style, svg, token, type Envelope } from '../kit.ts';

interface Participant { key: string; name: Inline }
interface Message { key: string; from: number; to: number; dashed: boolean; lost: boolean; label?: Inline }
interface Note { key: string; on: number; text: Inline }
type Event = { kind: 'msg'; i: number } | { kind: 'note'; i: number };
interface SeqBody { participants: Participant[]; messages: Message[]; notes: Note[]; events: Event[] }

const ARROW = /^(.+?)\s*(-->>|->>|-->|->|--x|-x)\s*(.+?)\s*(?::\s*(.*))?$/;
const SPACED = /^(.+?)\s+(-->>|->>|-->|->|--x|-x)\s+(.+?)\s*(?::\s*(.*))?$/;

export const sequence: BlockModule<SeqBody> = {
  type: 'sequence',
  pack: 'cs',
  args: {},
  flexible: true,
  parse(body, _args, ctx) {
    const lines = body.filter(l => l.text.trim());
    if (!lines.length) ctx.error(body[0]?.loc ?? { line: 0, col: 0 }, 'E130', 'sequence is empty', 'write the participants ("Client | Server"), then one "Client -> Server: SYN" line per message');
    const form = 'write "Client -> Server: label" for a message or "Client: state" for a note';
    const participants: Participant[] = [];
    const slug = (s: string) => { const k = s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'p'; return /^\d/.test(k) ? `p${k}` : k; };
    const items: ItemDecl[] = [];
    // A line's #name names its message or note, never a participant the line happens to introduce.
    const add = (key: string, kind: string, l: (typeof lines)[number], named = true) => {
      items.push({ key, index: items.length + 1, kind, loc: l.loc, ...(named && l.name ? { name: l.name } : {}) });
    };
    const first = lines[0]!;
    const fixed = first.text.includes('|') && !first.text.includes(':') && !ARROW.test(first.text);
    if (fixed) {
      lines.shift();
      for (const raw of first.text.split('|').map(s => s.trim())) {
        if (!raw) ctx.error(first.loc, 'E143', 'a participant name is empty', 'write the names between bars: "Client | Server"');
        const key = slug(raw);
        if (participants.some(p => p.key === key)) ctx.error(first.loc, 'E143', `participant "${raw}" is named twice`, 'give each participant its own name');
        participants.push({ key, name: ctx.inline(raw, first.loc) });
      }
      if (participants.length < 2) ctx.error(first.loc, 'E143', 'a sequence needs at least two participants', 'write "Client | Server"');
      if (first.name) ctx.error(first.loc, 'E143', 'the participants line cannot take a #name', 'name a participant by its key instead, e.g. hs:client');
      participants.forEach(p => items.push({ key: p.key, index: items.length + 1, kind: 'participant', loc: first.loc }));
    }
    const who = (raw: string, l: (typeof lines)[number]): number => {
      const key = slug(raw);
      const i = participants.findIndex(p => p.key === key);
      if (i >= 0) return i;
      if (fixed) ctx.error(l.loc, 'E143', `"${raw}" is not a participant`, `use one of: ${participants.map(p => plain(p.name)).join(', ')}; or add it to the first line`);
      participants.push({ key, name: ctx.inline(raw.trim(), l.loc) });
      add(key, 'participant', l, false);
      return participants.length - 1;
    };
    const messages: Message[] = [], notes: Note[] = [], events: Event[] = [];
    const count = new Map<number, number>();
    for (const l of lines) {
      const text = l.text.trim();
      const m = SPACED.exec(text) ?? ARROW.exec(text);
      if (m) {
        const from = who(m[1]!, l), to = who(m[3]!, l);
        if (from === to) ctx.error(l.loc, 'E143', 'a message goes between two participants', `for a step on one lifeline write a note: "${m[1]!.trim()}: ${m[4]?.trim() || 'text'}"`);
        const arrow = m[2]!;
        const key = String(messages.length + 1);
        messages.push({ key, from, to, dashed: arrow.startsWith('--'), lost: arrow.endsWith('x'), ...(m[4]?.trim() ? { label: ctx.inline(m[4].trim(), l.loc) } : {}) });
        events.push({ kind: 'msg', i: messages.length - 1 });
        add(key, 'message', l);
        continue;
      }
      const colon = text.indexOf(':');
      if (colon <= 0 || !text.slice(colon + 1).trim()) ctx.error(l.loc, 'E143', `sequence line "${text}" is neither a message nor a note`, form);
      const on = who(text.slice(0, colon), l);
      const n = (count.get(on) ?? 0) + 1;
      count.set(on, n);
      const key = `${participants[on]!.key}.${n}`;
      notes.push({ key, on, text: ctx.inline(text.slice(colon + 1).trim(), l.loc) });
      events.push({ kind: 'note', i: notes.length - 1 });
      add(key, 'note', l);
    }
    if (participants.length < 2) ctx.error(first.loc, 'E143', 'a sequence needs at least two participants', form);
    if (!messages.length) ctx.error(first.loc, 'E130', 'sequence has no messages', 'add a line "Client -> Server: SYN"');
    return { body: { participants, messages, notes, events }, items };
  },
  verbs: { show: ['block', 'items'], hide: ['block', 'items'], hl: ['block', 'items', 'none'], dim: ['block', 'items'], set: ['items'], grow: ['block', 'items'] },
  runtime: {
    mount(el, body, _args, reachable, caption) {
      style('sequence', CSS);
      el.classList.add('sq-seq', 'xp');
      const cap = caption ? h('div', 'x-caption sq-cap', el) : undefined;
      if (cap) { cap.textContent = caption!; cap.dataset.leaf = ''; }
      const box = h('div', 'sq-box', el);
      const root = svg('svg', box);
      root.setAttribute('class', 'sq-svg');
      const label = (cls: string, content: Inline, key: string) => {
        const part = h('div', `${cls} sq-part`, box);
        part.dataset.essential = '';
        const env = envelope(part, content, reachable.items[key]);
        env.el.dataset.declared = '';
        return { part, env };
      };
      const parts = body.participants.map(p => {
        const life = svg('line', root);
        life.setAttribute('class', 'sq-life sq-ink');
        const { part, env } = label('sq-head x-cell', p.name, p.key);
        return { part, env, life, w: 0, x: 0 };
      });
      const messages = body.messages.map(m => {
        const g = svg('g', root);
        g.setAttribute('class', 'sq-msg sq-ink');
        const line = svg('line', g);
        line.setAttribute('class', m.dashed ? 'sq-line sq-dashed' : 'sq-line');
        const head = svg('path', g);
        head.setAttribute('class', m.lost ? 'sq-cross' : 'sq-head-arrow');
        // A set can label a message declared without one: mount the label whenever some content can reach it.
        const reach = reachable.items[m.key] ?? [];
        const lab = m.label || reach.length ? label('sq-label', m.label ?? [], m.key) : undefined;
        return { m, g, line, head, ...(lab ? { label: lab } : {}), geo: undefined as unknown as MsgGeo };
      });
      const notes = body.notes.map(n => {
        const { part, env } = label('sq-note', n.text, n.key);
        part.classList.add(n.on === 0 ? 'sq-left' : 'sq-right');
        return { n, part, env, x: 0, y: 0, w: 0 };
      });
      doms.set(el, { body, ...(cap ? { cap } : {}), box, svg: root, parts, messages, notes, sizes: undefined, top: 0, bottom: 0 });
    },
    measure(el, width) {
      const d = doms.get(el)!;
      const z = d.sizes ??= sizesOf(el, d);
      const L = place(d, z, width, pitchOf(el));
      apply(d, L);
      const cap = d.cap ? maxContent(d.cap) : 0;
      const natural = Math.ceil(Math.max(L.width, cap));
      el.style.width = `${natural}px`;
      return { natural, height: el.offsetHeight };
    },
    render(el, s) {
      const d = doms.get(el)!;
      channels(el, { vis: s.self.vis });
      if (d.cap) d.cap.style.setProperty('--recede', num(s.self.recede));
      d.parts.forEach((p, i) => {
        const it = s.items[d.body.participants[i]!.key];
        const ch = inherit(s.self, it);
        const grown = Math.min(ch.vis, ch.grow);
        look(p.part, ch);
        look(p.life, { ...ch, vis: grown > 0 ? 1 : 0 });
        p.life.setAttribute('y2', num(d.top + (d.bottom - d.top) * grown));
        showContent(p.env, it?.content);
      });
      for (const m of d.messages) {
        const it = s.items[m.m.key];
        const ch = inherit(s.self, it);
        // The packet travels: the line runs from the sender to where it is now; the head rides its tip.
        const p = Math.min(ch.vis, ch.grow);
        const g = m.geo;
        const tip = g.x1 + (g.x2 - g.x1) * p;
        m.line.setAttribute('x2', num(tip));
        m.head.setAttribute('d', m.m.lost ? cross(g, token('--space-2')) : arrowHead(g, tip, token('--space-2'), token('--space-1')));
        m.head.style.opacity = num(m.m.lost ? reveal(p, token('--reveal-end')) : p > 0 ? 1 : 0);
        look(m.g, { ...ch, vis: p > 0 ? 1 : 0 });
        if (m.label) {
          look(m.label.part, ch);
          m.label.part.style.setProperty('--reveal', num(reveal(p, token('--reveal-along'))));
          showContent(m.label.env, it?.content);
        }
      }
      for (const n of d.notes) {
        const it = s.items[n.n.key];
        look(n.part, inherit(s.self, it));
        showContent(n.env, it?.content);
      }
    },
    lint(el) {
      // Labels are placed clear of every line by construction; message lines are not [data-edge], so check
      // them here rather than leave it to the generic checks.
      const d = doms.get(el)!;
      const out: BlockLintIssue[] = [];
      const shown = (e: Element) => parseFloat(getComputedStyle(e).opacity) > 0.02;
      const lines = d.messages.filter(m => shown(m.g)).map(m => ({ key: m.m.key, a: { x: m.geo.x1, y: m.geo.y }, b: { x: m.geo.x2, y: m.geo.y } }));
      const lifelines = d.parts.map((p, i) => ({ key: d.body.participants[i]!.key, a: { x: p.x, y: d.top }, b: { x: p.x, y: d.bottom } }));
      for (const m of d.messages) {
        if (!m.label || !shown(m.label.part)) continue;
        for (const l of [...lines.filter(l => l.key !== m.m.key), ...lifelines])
          if (segHitsBox(l.a, l.b, m.geo.box))
            out.push({ code: 'L404', message: `message ${m.m.key}'s label "${plain(d.body.messages[Number(m.m.key) - 1]!.label ?? []).slice(0, 30)}" meets a line`, fix: 'report this: the sequence layout let a label touch a line', item: m.m.key });
      }
      return out;
    },
  },
};

// ---------------------------------------------------------------- layout

interface Pt { x: number; y: number }
interface Box { x: number; y: number; w: number; h: number }
/** A message as drawn at height y: from x1 to x2 (the receiver, or where a lost one stops), and its label's box. */
interface MsgGeo { x1: number; x2: number; y: number; box: Box }
interface Sizes { headW: number[]; headH: number; labelW: number[]; labelH: number; noteW: number[]; noteH: number }
interface Dom {
  body: SeqBody; cap?: HTMLElement; box: HTMLElement; svg: SVGSVGElement;
  parts: { part: HTMLElement; env: Envelope; life: SVGLineElement; w: number; x: number }[];
  messages: { m: Message; g: SVGGElement; line: SVGLineElement; head: SVGPathElement; label?: { part: HTMLElement; env: Envelope }; geo: MsgGeo }[];
  notes: { n: Note; part: HTMLElement; env: Envelope; x: number; y: number; w: number }[];
  sizes: Sizes | undefined;
  /** Lifeline top and bottom (px, box-local), set in measure. */
  top: number; bottom: number;
}
const doms = new WeakMap<HTMLElement, Dom>();

/** Text sizes, unscaled px: every part is sized to the widest content it can show (its envelope). Fonts are ready by the first measure. */
function sizesOf(el: HTMLElement, d: Dom): Sizes {
  const s = scaleOf(el);
  const w = (e: HTMLElement) => Math.ceil(maxContent(e));
  const hOf = (e: HTMLElement) => e.getBoundingClientRect().height / s;
  return {
    headW: d.parts.map(p => w(p.part)),
    headH: Math.max(token('--node-h'), ...d.parts.map(p => hOf(p.part))),
    labelW: d.messages.map(m => (m.label ? w(m.label.env.el) : 0)),
    labelH: Math.max(0, ...d.messages.map(m => (m.label ? hOf(m.label.env.el) : 0))),
    noteW: d.notes.map(n => w(n.part)),
    noteH: Math.max(0, ...d.notes.map(n => hOf(n.part))),
  };
}

interface Layout { width: number; height: number; xs: number[]; top: number; bottom: number; msgs: MsgGeo[]; notes: Box[] }

/**
 * Lay the diagram out across `width` (unscaled px). Horizontal: lifelines evenly spaced, each gap wide enough for
 * the widest label that sits in it and for an inner participant's notes, capped at `--seq-span-max`. Vertical:
 * events in reading order, each at the first height that meets its timing rules and clears everything placed.
 */
function place(d: Dom, z: Sizes, width: number, pitch: number): Layout {
  const { participants, messages, notes, events } = d.body;
  const n = participants.length;
  const gap = token('--space-3'), tight = token('--space-1'), head = token('--space-2');
  const step = token('--seq-step') * pitch, lost = token('--seq-lost');
  // Air above a label, clear of the line before it: a step, and the whole row opens with the flexible pitch.
  const rowAir = step + (pitch - 1) * (z.labelH + tight);
  const noteMax = (p: number) => Math.max(0, ...notes.map((o, i) => (o.on === p ? z.noteW[i]! : 0)));
  const left = Math.ceil(Math.max(z.headW[0]! / 2, noteMax(0) + gap));
  const right = Math.ceil(Math.max(z.headW[n - 1]! / 2, n > 1 ? noteMax(n - 1) + gap : 0));
  // A gap must hold the headers beside it, an inner participant's notes, and every label drawn across it (a
  // message's label sits in its first hop, so it never straddles a lifeline).
  let need = 0;
  for (let i = 0; i + 1 < n; i++) need = Math.max(need, (z.headW[i]! + z.headW[i + 1]!) / 2 + gap);
  for (let p = 1; p < n - 1; p++) need = Math.max(need, noteMax(p) + 2 * gap);
  const labelled = d.messages.map(x => !!x.label);
  messages.forEach((m, i) => { if (labelled[i]) need = Math.max(need, (z.labelW[i]! + 2 * gap + 2 * head) / Math.min(1, m.lost ? lost * Math.abs(m.to - m.from) : 1)); });
  const span = Math.max(need, Math.min(token('--seq-span-max'), (width - left - right) / Math.max(1, n - 1)));
  const xs = participants.map((_, i) => left + i * span);
  const width_ = left + right + span * (n - 1);

  const top = z.headH;
  const y0 = top + gap * pitch;
  const placed: Box[] = participants.map((_, i) => ({ x: xs[i]! - z.headW[i]! / 2, y: 0, w: z.headW[i]!, h: z.headH }));
  const lines: [Pt, Pt][] = [];
  const lifelines: [Pt, Pt][] = xs.map(x => [{ x, y: top }, { x, y: 1e6 }]);
  const clock: (number | undefined)[] = participants.map(() => undefined);
  const noteAt: number[][] = participants.map(() => []);
  let cursor = y0, busy = false, lastMsg = -Infinity;
  const msgs: MsgGeo[] = new Array(messages.length);
  const noteBoxes: Box[] = new Array(notes.length);
  const hitsBox = (b: Box) => placed.some(o => overlaps(o, b, tight));
  const hitsLine = (b: Box) => lines.some(([a, c]) => segHitsBox(a, c, b));

  for (const e of events) {
    if (e.kind === 'msg') {
      const m = messages[e.i]!;
      const a = clock[m.from];
      // One message per row: a full row (its label and the air above it) below the last message.
      let y = Math.max(busy ? cursor + step : cursor, a !== undefined ? a + step : y0, lastMsg + z.labelH + tight + rowAir);
      for (let k = 0; k < 4000; k++, y += 1) {
        const g = geometry(m, xs, y, span, lost, z.labelW[e.i]!, z.labelH, tight);
        const own: [Pt, Pt] = [{ x: g.x1, y }, { x: g.x2, y }];
        const pad = { x: g.box.x - tight, y: g.box.y - rowAir, w: g.box.w + 2 * tight, h: g.box.h + rowAir + tight };
        const labelClear = !labelled[e.i] || (!hitsBox(g.box) && ![...lines, ...lifelines].some(([p, q]) => segHitsBox(p, q, pad)));
        const lineClear = !placed.slice(n).some(b => segHitsBox(own[0], own[1], inset(b, -tight)));
        if (labelClear && lineClear) { msgs[e.i] = g; break; }
      }
      const g = msgs[e.i] ??= geometry(m, xs, y, span, lost, z.labelW[e.i]!, z.labelH, tight);
      lines.push([{ x: g.x1, y: g.y }, { x: g.x2, y: g.y }]);
      // A lost message's cross is an obstacle too.
      if (m.lost) placed.push({ x: g.x2 - head, y: g.y - head, w: 2 * head, h: 2 * head });
      if (labelled[e.i]) placed.push(g.box);
      cursor = lastMsg = g.y;
      busy = true;
      clock[m.from] = g.y;
      if (!m.lost) clock[m.to] = Math.max(clock[m.to] ?? -Infinity, g.y);
    } else {
      const o = notes[e.i]!;
      const w = z.noteW[e.i]!, hh = z.noteH;
      let y = Math.max(cursor, clock[o.on] ?? y0);
      if (noteAt[o.on]!.some(v => Math.abs(v - y) < hh)) y = Math.max(...noteAt[o.on]!) + hh + tight;
      const x = o.on === 0 ? xs[0]! - gap - w : xs[o.on]! + gap;
      let box = { x, y: y - hh / 2, w, h: hh };
      for (let k = 0; k < 4000 && (hitsBox(box) || hitsLine(box)); k++) box = { ...box, y: box.y + 1 };
      noteBoxes[e.i] = box;
      placed.push(box);
      const cy = box.y + hh / 2;
      noteAt[o.on]!.push(cy);
      cursor = Math.max(cursor, cy);
      busy = true;
      clock[o.on] = cy;
    }
  }
  const bottom = Math.ceil(Math.max(y0, ...placed.map(b => b.y + b.h), ...msgs.map(g => g.y)) + step);
  return { width: width_, height: bottom, xs, top, bottom, msgs, notes: noteBoxes };
}

/** A message at height y; its label sits just above it, centred on its first hop (so it never straddles a lifeline). */
function geometry(m: Message, xs: number[], y: number, span: number, lost: number, w: number, hh: number, pad: number): MsgGeo {
  const x1 = xs[m.from]!, xt = xs[m.to]!;
  const x2 = x1 + (xt - x1) * (m.lost ? lost : 1);
  const dir = Math.sign(xt - x1);
  const hopEnd = Math.abs(x2 - x1) > span + 1 ? x1 + dir * span : x2;
  const mx = (x1 + hopEnd) / 2;
  return { x1, x2, y, box: { x: mx - w / 2, y: y - pad - hh, w, h: hh } };
}

/** Write a layout into the DOM (static geometry only; render draws state). */
function apply(d: Dom, L: Layout): void {
  const z = d.sizes!;
  d.top = L.top;
  d.bottom = L.bottom;
  Object.assign(d.box.style, { width: `${L.width}px`, height: `${L.height}px` });
  d.svg.setAttribute('width', num(L.width));
  d.svg.setAttribute('height', num(L.height));
  d.parts.forEach((p, i) => {
    p.x = L.xs[i]!;
    Object.assign(p.part.style, { left: `${num(L.xs[i]! - z.headW[i]! / 2)}px`, top: '0', width: `${z.headW[i]}px`, height: `${num(z.headH)}px` });
    for (const [k, v] of [['x1', L.xs[i]!], ['x2', L.xs[i]!], ['y1', L.top], ['y2', L.bottom]] as const) p.life.setAttribute(k, num(v));
  });
  d.messages.forEach((m, i) => {
    const g = m.geo = L.msgs[i]!;
    for (const [k, v] of [['x1', g.x1], ['y1', g.y], ['x2', g.x2], ['y2', g.y]] as const) m.line.setAttribute(k, num(v));
    if (m.label) Object.assign(m.label.part.style, { left: `${num(g.box.x)}px`, top: `${num(g.box.y)}px`, width: `${g.box.w}px`, height: `${num(g.box.h)}px` });
  });
  d.notes.forEach((o, i) => {
    const b = L.notes[i]!;
    Object.assign(o.part.style, { left: `${num(b.x)}px`, top: `${num(b.y)}px` });
  });
}

function arrowHead(g: MsgGeo, tip: number, len: number, half: number): string {
  const back = tip - Math.sign(g.x2 - g.x1) * len;
  return `M${num(back)} ${num(g.y - half)} L${num(tip)} ${num(g.y)} L${num(back)} ${num(g.y + half)} Z`;
}

/** The cross where a lost message stops. */
function cross(g: MsgGeo, arm: number): string {
  const a = arm * Math.SQRT1_2;
  return `M${num(g.x2 - a)} ${num(g.y - a)} L${num(g.x2 + a)} ${num(g.y + a)} M${num(g.x2 - a)} ${num(g.y + a)} L${num(g.x2 + a)} ${num(g.y - a)}`;
}

function look(e: HTMLElement | SVGElement, ch: Channels): void {
  channels(e, { vis: ch.vis, hl: ch.hl, now: ch.now, recede: ch.recede });
}

const overlaps = (a: Box, b: Box, pad: number) => a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;
const inset = (b: Box, by: number): Box => ({ x: b.x + by, y: b.y + by, w: b.w - 2 * by, h: b.h - 2 * by });
const clamp = (v: number) => Math.max(0, Math.min(1, v));
/** Fade-in of something drawn along a growth `p` (0..1): 0 until `from`, then linearly to 1 at p = 1. */
const reveal = (p: number, from: number) => clamp((p - from) / (1 - from));

function segHitsBox(p: Pt, q: Pt, b: Box): boolean {
  let t0 = 0, t1 = 1;
  const dx = q.x - p.x, dy = q.y - p.y;
  for (const [pp, qq] of [[-dx, p.x - b.x], [dx, b.x + b.w - p.x], [-dy, p.y - b.y], [dy, b.y + b.h - p.y]] as const) {
    if (pp === 0) { if (qq < 0) return false; continue; }
    const t = qq / pp;
    if (pp < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
    else { if (t < t0) return false; if (t < t1) t1 = t; }
  }
  return t0 <= t1;
}


const CSS = `
.sq-seq { position: relative; width: max-content; }
.sq-cap { margin-bottom: var(--label-gap); --recede: 0;
  opacity: calc(1 - var(--recede) * (1 - var(--recede-opacity))); }
.sq-box { position: relative; }
.sq-svg { position: absolute; left: 0; top: 0; overflow: visible; }
.sq-part, .sq-ink { --vis: 1; --hl: 0; --now: 0; --recede: 0; --reveal: 1;
  --ink: color-mix(in srgb, var(--ink-4) calc(var(--recede) * 100%),
         color-mix(in srgb, var(--hl-now-bar) calc(var(--now) * 100%),
         color-mix(in srgb, var(--hl-held-ink) calc(var(--hl) * 100%), var(--sq-rest)))); }
.sq-part { position: absolute; opacity: calc(var(--vis) * var(--reveal) * (1 - var(--recede) * (1 - var(--recede-opacity))));
  color: var(--ink); white-space: nowrap; }
.sq-ink { opacity: calc(var(--vis) * (1 - var(--recede) * (1 - var(--recede-opacity)))); }
.sq-head { --sq-rest: var(--ink-1); display: flex; align-items: center; justify-content: center; padding: var(--space-1) var(--space-4);
  font: var(--weight-medium) var(--text-node) / var(--leading-tight) var(--font-sans); }
.sq-life { --sq-rest: var(--line-strong); stroke: color-mix(in srgb, var(--ink) calc(max(var(--hl), var(--now)) * 100%), var(--line-strong));
  stroke-width: var(--stroke-edge); }
.sq-msg { --sq-rest: var(--ink-2); }
.sq-line { stroke: var(--ink); stroke-width: var(--stroke-mark); stroke-linecap: round; }
.sq-dashed { stroke-dasharray: var(--space-2) var(--space-2); stroke-linecap: butt; }
.sq-head-arrow { fill: var(--ink); stroke: var(--ink); stroke-width: var(--stroke-hair); stroke-linejoin: round; }
.sq-cross { fill: none; stroke: var(--ink); stroke-width: var(--stroke-mark); stroke-linecap: round; }
.sq-label { --sq-rest: var(--ink-1); display: flex; align-items: center; justify-content: center;
  font: var(--weight-medium) var(--text-code) / var(--leading-tight) var(--font-sans); }
.sq-note { --sq-rest: var(--ink-2); font: var(--weight-regular) var(--text-label) / var(--leading-tight) var(--font-sans); }
.sq-note.sq-left { text-align: right; }
.sq-label .x-code, .sq-note .x-code { font-weight: inherit; }
`;
