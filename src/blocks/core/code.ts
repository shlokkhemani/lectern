/**
 * `code`: verbatim source on a field, highlighted at compile time (shiki tokens, classified to the theme's
 * six syntax roles, rule 10). Never wraps (rulings 9). Items are code lines, keyed by displayed number
 * when numbered, else by code-line index. Marker `ptr` points at a line. Groups bracket line ranges.
 *
 * Body forms: inline (`... text` gap row, `... @159` renumbers, `from=N`, `diff` with `+ `/`- ` prefixes)
 * or sourced (`src=path:1-5,12-20`: file line numbers, automatic gap rows between ranges).
 */
import type { Inline, ItemDecl, Loc } from '../../ir.ts';
import type { Args, BlockModule, BodyLine, ParseCtx } from '../contract.ts';
import { anchorOf, root, swapPlace, type Anchor, channels, envelope, h, inherit, inline, lineBar, maxContent, num, showContent, style, svg, token, type Envelope } from '../kit.ts';

/** Syntax role: plain, keyword, literal, definition, punctuation, package qualifier, comment. */
type Role = '' | 'k' | 'l' | 'd' | 'p' | 'q' | 'cm';
interface Tok { t: string; r: Role }
interface CodeLine {
  kind: 'code' | 'gap';
  text: string;
  /** Item key (code lines only). */
  key?: string;
  /** Displayed number, when the block is numbered. */
  no?: number;
  diff?: '+' | '-';
  toks?: Tok[];
}
interface CodeBody { lang: string; caption?: string; numbered: boolean; lines: CodeLine[] }

const NAME_TAIL = /\s{2,}#[a-z][a-z0-9-]*$/;

export const code: BlockModule<CodeBody> = {
  type: 'code',
  pack: 'core',
  args: { lang: 'string', from: 'int', diff: 'flag', src: 'string', name: 'string' },
  flexible: false,
  parse(body, args, ctx) {
    const lang = typeof args.lang === 'string' ? args.lang : ctx.meta.lang;
    const src = typeof args.src === 'string' ? args.src : undefined;
    const r = src ? sourced(src, args, ctx, body[0]?.loc ?? { line: 0, col: 0 }) : written(body, args, ctx);
    return { body: { lang, numbered: r.numbered, lines: r.lines, ...(src ? { caption: src.split(':')[0] } : {}) }, items: r.items };
  },
  async prepare(body) {
    if (body.lines.every(l => l.kind === 'gap' || l.toks)) return body;
    const toks = await highlight(body.lines.filter(l => l.kind === 'code').map(l => l.text), body.lang);
    let i = 0;
    return { ...body, lines: body.lines.map(l => (l.kind === 'code' ? { ...l, toks: toks[i++]! } : l)) };
  },
  verbs: {
    show: ['block', 'items'], hide: ['block', 'items'], hl: ['block', 'items', 'none'], dim: ['block', 'items'],
    set: ['items'], move: ['block', 'marker'], group: ['items'], swap: ['block', 'items'],
  },
  markers: () => ['ptr'],
  runtime: {
    mount(el, body, _args, reachable, caption) {
      style('code', CSS);
      el.classList.add('c-code', 'xp');
      const text = caption ?? body.caption;
      const cap = text ? h('div', 'x-caption c-cap xp', el) : undefined;
      if (cap) { cap.textContent = text!; cap.dataset.leaf = ''; }
      const field = h('div', `c-field${body.numbered ? ' c-numbered' : ''}${body.lines.some(l => l.diff) ? ' c-diff' : ''}`, el);
      const lines = new Map<string, { part: HTMLElement; env: Envelope }>();
      const order: string[] = [];
      for (const line of body.lines) {
        const part = h('div', line.kind === 'gap' ? 'c-ln c-gap xp' : `c-ln xp x-band${line.diff ? ` c-${line.diff === '+' ? 'add' : 'del'}` : ''}`, field);
        if (line.kind === 'gap') {
          h('span', 'c-no', part);
          const t = h('span', 'c-tx', part);
          t.textContent = `⋯ ${line.text}`.trimEnd();
          t.dataset.leaf = '';
          continue;
        }
        lineBar(part);
        const no = h('span', 'c-no', part);
        if (line.diff) no.textContent = line.diff === '+' ? '+' : '−';
        else if (line.no !== undefined) no.textContent = String(line.no);
        if (no.textContent) no.dataset.leaf = '';
        const env = envelope(part, [], reachable.items[line.key!], 'c-tx', (alt, c) => (c.length ? inline(alt, c) : drawToks(alt, line)));
        lines.set(line.key!, { part, env });
        order.push(line.key!);
      }
      const ptr = svg('svg', field);
      ptr.setAttribute('class', 'c-ptr xp');
      const tri = svg('path', ptr);
      tri.setAttribute('d', 'M0 0 L1 0.5 L0 1 Z');
      tri.setAttribute('transform', 'scale(1)');
      const groups = reachable.groups.map(g => {
        const gEl = h('div', 'c-group xp', el);
        h('span', 'c-bracket', gEl);
        const label = h('span', 'c-glabel', gEl);
        label.textContent = g.label;
        label.dataset.leaf = '';
        return { g, el: gEl };
      });
      if (groups.length) el.classList.add('c-has-groups');
      doms.set(el, { cap, field, lines, order, ptr, groups, lineTops: [], lineH: 0, anchors: new Map() });
    },
    measure(el, width) {
      const natural = Math.ceil(maxContent(el));
      el.style.width = `${Math.min(natural, width)}px`;
      return { natural, height: el.offsetHeight };
    },
    geometry(el) {
      const d = doms.get(el)!;
      // Line tops relative to the field (the pointer lives in it); groups live in the block, below the caption.
      d.lineTops = d.order.map(k => d.lines.get(k)!.part.offsetTop);
      const top = d.field.offsetTop;
      d.lineH = d.lines.get(d.order[0]!)?.part.offsetHeight ?? 0;
      d.anchors = new Map(d.order.map(k => [k, anchorOf(d.lines.get(k)!.part, el)]));
      const size = token('--space-3');
      d.ptr.setAttribute('width', String(size));
      d.ptr.setAttribute('height', String(size));
      d.ptr.setAttribute('viewBox', '0 0 1 1');
      for (const { g, el: gEl } of d.groups) {
        const a = top + (d.lineTops[g.from - 1] ?? 0), b = top + (d.lineTops[g.to - 1] ?? 0) + d.lineH;
        Object.assign(gEl.style, { top: `${a}px`, height: `${b - a}px` });
      }
    },
    render(el, s) {
      const d = doms.get(el)!;
      root(el, s.self);
      if (d.cap) channels(d.cap, { recede: s.self.recede });
      for (const [key, { part, env }] of d.lines) {
        channels(part, inherit(s.self, s.items[key]));
        swapPlace(part, d.anchors, key, s.items[key]?.swap, 'y');
        showContent(env, s.items[key]?.content);
      }
      const m = s.markers.ptr;
      if (m && d.lineTops.length) {
        const i = Math.max(0, Math.min(d.lineTops.length - 1, m.at - 1));
        const lo = Math.floor(i), f = i - lo;
        const y = d.lineTops[lo]! + f * ((d.lineTops[Math.min(lo + 1, d.lineTops.length - 1)] ?? 0) - d.lineTops[lo]!);
        d.ptr.style.top = `${num(y)}px`;
        d.ptr.style.setProperty('--line-h', `${d.lineH}px`);
        channels(d.ptr, { vis: m.vis, now: m.now });
      } else channels(d.ptr, { vis: 0 });
      for (const { g, el: gEl } of d.groups) channels(gEl, { vis: s.groups.find(x => x.id === g.id)?.vis ?? 0 });
    },
  },
};

interface Dom {
  cap?: HTMLElement; field: HTMLElement; lines: Map<string, { part: HTMLElement; env: Envelope }>; order: string[];
  anchors: Map<string, Anchor>; ptr: SVGSVGElement; groups: { g: { id: string; from: number; to: number; label: string }; el: HTMLElement }[];
  lineTops: number[]; lineH: number;
}
const doms = new WeakMap<HTMLElement, Dom>();

function drawToks(el: HTMLElement, line: CodeLine): void {
  for (const t of line.toks ?? [{ t: line.text, r: '' as Role }]) {
    if (!t.r) { el.appendChild(document.createTextNode(t.t)); continue; }
    h('span', `s-${t.r}`, el).textContent = t.t;
  }
}

/* ---------- parse ---------- */

interface Parsed { lines: CodeLine[]; items: ItemDecl[]; numbered: boolean }

function written(body: BodyLine[], args: Args, ctx: ParseCtx): Parsed {
  const diff = args.diff === true;
  let no = typeof args.from === 'string' ? Number(args.from) : 1;
  let numbered = typeof args.from === 'string';
  const lines: CodeLine[] = [];
  const items: ItemDecl[] = [];
  for (const b of body) {
    // Verbatim: a name counts only after two or more spaces, so `x := 1 #foo` stays code (contract).
    const named = b.raw.match(NAME_TAIL);
    let raw = named ? b.raw.slice(0, named.index) : b.raw;
    const name = named ? named[0].trim().slice(1) : undefined;
    const gap = raw.match(/^\.\.\.(?:\s+(.*))?$/);
    if (gap) {
      const renumber = gap[1]?.match(/^@(\d+)$/);
      if (renumber) { no = Number(renumber[1]); numbered = true; lines.push({ kind: 'gap', text: '' }); }
      else lines.push({ kind: 'gap', text: gap[1] ?? '' });
      continue;
    }
    let d: CodeLine['diff'];
    if (diff && (raw.startsWith('+ ') || raw.startsWith('- '))) { d = raw[0] as '+' | '-'; raw = raw.slice(2); }
    else if (diff && raw.startsWith('  ')) raw = raw.slice(2);
    lines.push({ kind: 'code', text: raw, no, ...(d ? { diff: d } : {}) });
    items.push({ key: '', index: items.length + 1, kind: 'line', loc: b.loc, ...(name ? { name } : {}) });
    no++;
  }
  if (!items.length) ctx.error(body[0]?.loc ?? { line: 0, col: 0 }, 'E130', 'code block has no code lines', 'write the code between the fences, or use src=path:from-to');
  return keyed(lines, items, numbered);
}

function sourced(src: string, args: Args, ctx: ParseCtx, loc: Loc): Parsed {
  const m = src.match(/^([^:]+)(?::(\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*))?$/);
  if (!m) ctx.error(loc, 'E214', `src "${src}" is not path or path:from-to`, 'write src=path/file.go:12-20 (ranges may be listed: 1-5,12-20)');
  const path = m![1]!;
  const file = ctx.source(path, loc);
  const ranges = (m![2] ?? `1-${file.length}`).split(',').map(r => {
    const [a, b = a] = r.split('-').map(Number) as [number, number?];
    if (a < 1 || b > file.length || b < a)
      ctx.error(loc, 'E214', `lines ${a}-${b} outside ${path.split('/').pop()} (${file.length} lines)`, `use a range within 1-${file.length}`);
    return [a, b];
  }).reduce<number[][]>((out, r) => {
    // A gap row would hide a single line: show the line instead.
    const last = out.at(-1);
    if (last && r[0]! - last[1]! === 2) last[1] = r[1]!; else out.push(r);
    return out;
  }, []);
  const names = new Map<number, string>();
  if (typeof args.name === 'string') for (const pair of args.name.split(',')) {
    const [n, id] = pair.split(':');
    if (!n || !id || !/^\d+$/.test(n) || !/^[a-z][a-z0-9-]*$/.test(id)) ctx.error(loc, 'E215', `name=${args.name}: "${pair}" is not line:name`, 'write name=12:fn,15:loop');
    names.set(Number(n), id!);
  }
  const lines: CodeLine[] = [];
  const items: ItemDecl[] = [];
  ranges.forEach(([a, b], ri) => {
    if (ri > 0) {
      const skipped = a! - ranges[ri - 1]![1]! - 1;
      if (skipped > 0) lines.push({ kind: 'gap', text: `${skipped} lines` });
    }
    for (let n = a!; n <= b!; n++) {
      lines.push({ kind: 'code', text: file[n - 1]!, no: n });
      const name = names.get(n);
      items.push({ key: '', index: items.length + 1, kind: 'line', loc, ...(name ? { name } : {}) });
    }
  });
  for (const n of names.keys()) if (!lines.some(l => l.no === n))
    ctx.error(loc, 'E215', `name=${args.name}: line ${n} is not shown`, 'name a line inside the src range');
  return keyed(lines, items, true);
}

/** Item keys: the displayed number when numbered, else the code-line index. */
function keyed(lines: CodeLine[], items: ItemDecl[], numbered: boolean): Parsed {
  let i = 0;
  for (const l of lines) {
    if (l.kind !== 'code') continue;
    const key = numbered ? String(l.no) : String(i + 1);
    l.key = key;
    items[i]!.key = key;
    if (!numbered) delete l.no;
    i++;
  }
  return { lines, items, numbered };
}

/* ---------- highlight (compile time) ---------- */

const DEF_KEYWORDS = new Set(['func', 'type', 'def', 'class', 'fn', 'function', 'struct', 'interface', 'enum', 'trait']);

/** Tokenise with shiki and classify each token to a theme syntax role. One array of tokens per line. */
async function highlight(lines: string[], lang: string): Promise<Tok[][]> {
  const plain = () => lines.map(t => [{ t, r: '' as Role }]);
  if (lang === 'text' || !lines.length) return plain();
  const hl = await highlighter(lang);
  if (!hl) return plain();
  let res;
  try {
    // No time limit: shiki tokenises each line twice (scopes, then colours), and a cold grammar's first pass could
    // stop at the limit, so the two disagreed and the explanation threw (JavaScript, every run; Go once). A limit
    // also made highlighting depend on machine speed. Scope names are all `classify` reads.
    res = hl.codeToTokens(lines.join('\n'), { lang, theme: 'github-dark', includeExplanation: 'scopeName', tokenizeTimeLimit: 0 });
  } catch (e) {
    // Never let highlighting fail a build.
    process.stderr.write(`lectern: ${lang} highlighting fell back to plain text (${e instanceof Error ? e.message : e})\n`);
    return plain();
  }
  const lineToks = res.tokens.map(line => line.flatMap(t => (t.explanation ?? [{ content: t.content, scopes: [] }]).map(e => ({
    t: e.content, scopes: e.scopes.map(s => s.scopeName),
  }))));
  // Names the snippet declares (assignments, parameters, receivers) are locals, never package qualifiers.
  const locals = new Set(lineToks.flat().filter(x => /variable\.(other\.assignment|parameter)/.test(x.scopes.join(' '))).map(x => x.t.trim()));
  return lineToks.map(l => classify(l, locals));
}

type Highlighter = Awaited<ReturnType<typeof import('shiki/core').createHighlighterCore>>;
const highlighters = new Map<string, Promise<Highlighter | undefined>>();

function highlighter(lang: string): Promise<Highlighter | undefined> {
  let p = highlighters.get(lang);
  if (!p) {
    p = (async () => {
      const [{ createHighlighterCore }, { createJavaScriptRegexEngine }] = await Promise.all([import('shiki/core'), import('shiki/engine/javascript')]);
      let grammar;
      try { grammar = await import(`shiki/langs/${lang}.mjs`); } catch { return undefined; }
      return createHighlighterCore({ engine: createJavaScriptRegexEngine(), langs: [grammar], themes: [import('shiki/themes/github-dark.mjs')] });
    })();
    highlighters.set(lang, p);
  }
  return p;
}

function classify(raw: { t: string; scopes: string[] }[], locals: Set<string>): Tok[] {
  // Split leading/trailing whitespace off tokens so roles never colour spaces.
  const toks: { t: string; scopes: string[] }[] = [];
  for (const x of raw) for (const part of x.t.split(/(\s+)/)) if (part) toks.push({ t: part, scopes: /^\s+$/.test(part) ? [] : x.scopes });
  const out: Tok[] = [];
  let pendingDef = false, depth = 0;
  const next = (i: number) => { for (let j = i + 1; j < toks.length; j++) if (toks[j]!.t.trim()) return j; return -1; };
  toks.forEach((tk, i) => {
    const s = tk.scopes.join(' ');
    const word = /^[A-Za-z_][A-Za-z0-9_]*$/.test(tk.t);
    let r: Role = '';
    if (!tk.t.trim()) r = '';
    else if (s.includes('comment')) r = 'cm';
    else if (/\bstring\b|constant\.numeric|constant\.language|constant\.character/.test(s)) r = 'l';
    else if (/\bkeyword\b(?!\.operator)/.test(s) || (s.includes('storage.type') && DEF_KEYWORDS.has(tk.t))) r = 'k';
    else if (/punctuation|keyword\.operator/.test(s) || /^[()[\]{},;:.=!&*+\-/<>|%^]+$/.test(tk.t)) r = 'p';
    else if (word && /^[A-Z][A-Z0-9_]+$/.test(tk.t)) r = 'l';
    else if (word && /^[a-z]/.test(tk.t)) {
      const j = next(i);
      const k = j >= 0 ? next(j) : -1;
      if (j === i + 1 && toks[j]!.t === '.' && k === j + 1 && /^[A-Z]/.test(toks[k]!.t) && tk.t.length > 1 && !locals.has(tk.t)) r = 'q';
    }
    if (pendingDef && tk.t.trim()) {
      if (tk.t === '(' ) depth++;
      else if (tk.t === ')') depth--;
      else if (depth === 0 && word && r !== 'k') { r = 'd'; pendingDef = false; }
      else if (depth === 0 && !word) pendingDef = false;
    }
    if (r === 'k' && DEF_KEYWORDS.has(tk.t) && (tk.t === 'func' || tk.t === 'type' || tk.t === 'def' || tk.t === 'class' || tk.t === 'fn' || tk.t === 'function')) { pendingDef = true; depth = 0; }
    out.push({ t: tk.t, r });
  });
  // A qualifier's dot steps back with it.
  for (let i = 0; i + 1 < out.length; i++) if (out[i]!.r === 'q' && out[i + 1]!.t === '.') out[i + 1]!.r = 'q';
  // Merge adjacent same-role tokens: smaller DOM, identical look.
  return out.reduce<Tok[]>((acc, t) => {
    const last = acc[acc.length - 1];
    if (last && last.r === t.r) last.t += t.t; else acc.push({ ...t });
    return acc;
  }, []);
}

const CSS = `
.c-code { position: relative; width: max-content; }
.c-cap { margin-bottom: var(--label-gap); }
/* The panel is never narrower than its longest line plus padding: code does not wrap, so a column too narrow
   for it is an overfull frame (L410), never a line running out of its panel. Bands span the panel's content box. */
.c-field { position: relative; display: grid; grid-template-columns: max-content max-content; background: var(--surface-1);
  width: max-content; min-width: 100%; box-sizing: border-box;
  border-radius: var(--radius-field); padding: var(--space-2) var(--space-5) var(--space-2) 0; }
.c-ln { position: relative; display: grid; grid-template-columns: subgrid; grid-column: 1 / -1; height: var(--leading-code);
  align-items: center; font: var(--weight-regular) var(--text-code) / var(--leading-code) var(--font-mono);
  tab-size: var(--tab-size); color: var(--syn-plain); }
.c-no { justify-self: end; padding: 0 var(--space-5) 0 var(--space-5); font-size: var(--text-meta);
  color: color-mix(in srgb, var(--hl-now-ink) calc(var(--now) * var(--hl) * 100%),
         color-mix(in srgb, var(--hl-held-ink) calc(var(--hl) * 100%), var(--ink-3))); }
.c-field:not(.c-numbered):not(.c-diff) .c-no { padding: 0 0 0 var(--space-5); }
.c-tx { white-space: pre; }
.c-gap .c-tx { font: var(--weight-regular) var(--text-meta) / var(--leading-code) var(--font-sans); color: var(--ink-3); }
/* Diffs (rule 9): the sign and number in --diff-add/del, a faint band behind the line; a highlight lifts over it. */
.c-add .c-no { color: var(--diff-add); }
.c-del .c-no { color: var(--diff-del); }
.c-add { background: color-mix(in srgb, var(--hl-fill-line) calc(var(--hl) * 100%), var(--diff-add-fill)); }
.c-del { background: color-mix(in srgb, var(--hl-fill-line) calc(var(--hl) * 100%), var(--diff-del-fill)); }
.c-del .c-tx { color: var(--ink-3); text-decoration: line-through; text-decoration-color: var(--ink-4); }
.c-del .c-tx span { color: inherit; }
.s-k { color: var(--syn-keyword); } .s-l { color: var(--syn-literal); } .s-d { font-weight: var(--syn-def-weight); }
.s-p { color: var(--syn-punct); } .s-q { color: var(--syn-pkg); }
.s-cm { color: var(--syn-comment); font-style: var(--syn-comment-style); }
.c-ptr { position: absolute; left: calc(-1 * var(--space-4)); width: var(--space-3); height: var(--space-3); margin-top: calc((var(--line-h, 0) - var(--space-3)) / 2);
  fill: color-mix(in srgb, var(--hl-now-bar) calc(var(--now) * 100%), var(--hl-held-bar)); overflow: visible; }
.c-has-groups { padding-right: var(--space-8); }
.c-group { position: absolute; right: 0; width: var(--space-7); }
.c-bracket { position: absolute; left: 0; top: 0; bottom: 0; width: var(--space-2); border: var(--stroke-hair) solid var(--ink-3);
  border-left: 0; border-radius: 0 var(--radius-cell) var(--radius-cell) 0; }
.c-glabel { position: absolute; left: var(--space-4); top: 50%; translate: 0 -50%; white-space: nowrap;
  font: var(--weight-medium) var(--text-label) / var(--leading-tight) var(--font-sans); color: var(--ink-2); }
`;
