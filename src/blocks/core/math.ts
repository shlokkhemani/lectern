/**
 * `math`: one TeX equation per line, typeset by KaTeX at compile time and centred. Items are lines keyed
 * `1…n`; `set` replaces a line with another equation.
 *
 * Styling is offline and deterministic: `prepare` renders KaTeX's HTML output and carries, in the body,
 * KaTeX's stylesheet (without its font URLs) and only the font faces those equations use, as woff2 data
 * URLs. The page injects them with the kit's `style()` and loads the faces at mount, so layout measures
 * real glyphs. MathML output was rejected: it renders with whatever math font the machine has.
 *
 * TeX errors are parse errors (E140): `parse` checks each line with KaTeX synchronously (a lazy require,
 * never reached in the page). `prepare` loads KaTeX with a dynamic import so it never ships in the bundle.
 * The build passes `prepare` every value a `set` writes to the block, so a `set` swaps in typeset TeX; a
 * value that does not typeset is drawn as raw TeX and flagged for lint (L405).
 */
import type { Inline, ItemDecl } from '../../ir.ts';
import type { Args, BlockModule } from '../contract.ts';
import { channels, envelope, h, inherit, lineBar, maxContent, plain, showContent, style, token, type Envelope } from '../kit.ts';

interface Face { family: string; weight: string; style: string; data: string }
interface MathBody {
  lines: string[];
  /** TeX → KaTeX HTML, for every line and every prepared `set` value. */
  html?: Record<string, string>;
  /** KaTeX's stylesheet without @font-face rules. */
  css?: string;
  faces?: Face[];
}
interface Dom { lines: Map<string, { part: HTMLElement; env: Envelope }> }

const doms = new WeakMap<HTMLElement, Dom>();
const OPTIONS = { displayMode: true, output: 'html', throwOnError: true, strict: 'ignore', trust: false } as const;

export const math: BlockModule<MathBody> = {
  type: 'math',
  pack: 'core',
  args: {},
  flexible: false,
  parse(body, _args, ctx) {
    const lines: string[] = [];
    const items: ItemDecl[] = [];
    const katex = compileKatex();
    for (const l of body) {
      const tex = l.text.trim();
      if (!tex) continue;
      try { katex.renderToString(tex, OPTIONS); } catch (e) {
        const msg = e instanceof Error ? e.message.replace(/^KaTeX parse error: /, '') : String(e);
        ctx.error(l.loc, 'E140', `TeX does not typeset: ${msg}`, 'fix the TeX on this line; one equation per line, without $ or \\[ delimiters');
      }
      lines.push(tex);
      items.push({ key: String(items.length + 1), index: items.length + 1, kind: 'line', loc: l.loc, ...(l.name ? { name: l.name } : {}) });
    }
    if (!lines.length) ctx.error(body[0]?.loc ?? { line: 0, col: 0 }, 'E130', 'math block is empty', 'write one TeX equation per line, e.g. "E = mc^2"');
    return { body: { lines }, items };
  },
  async prepare(body: MathBody, _args: Args, sets: Inline[] = []): Promise<MathBody> {
    const katex = (await import('katex')).default;
    const html: Record<string, string> = { ...body.html };
    for (const tex of [...body.lines, ...sets.map(c => plain(c).trim())]) {
      if (!tex || html[tex] !== undefined) continue;
      try { html[tex] = katex.renderToString(tex, OPTIONS); } catch { /* a bad set value stays raw TeX and fails lint */ }
    }
    const { css, faces } = await stylesFor(Object.values(html).join(''));
    return { ...body, html, css, faces };
  },
  verbs: { show: ['block', 'items'], hide: ['block', 'items'], hl: ['block', 'items', 'none'], dim: ['block', 'items'], set: ['items'] },
  runtime: {
    mount(el, body, _args, reachable, caption) {
      style('math', CSS);
      if (body.css) style('katex', body.css);
      for (const f of body.faces ?? []) {
        style(`katex-${f.family}-${f.weight}-${f.style}`, `@font-face { font-family: "${f.family}"; font-weight: ${f.weight}; font-style: ${f.style}; font-display: block; src: url(data:font/woff2;base64,${f.data}) format("woff2"); }`);
        void document.fonts.load(`${f.style} ${f.weight} ${token('--text-body')}px "${f.family}"`);
      }
      el.classList.add('mt-math', 'xp');
      if (caption) { const cap = h('div', 'x-caption mt-cap xp', el); cap.textContent = caption; cap.dataset.leaf = ''; }
      const lines = new Map<string, { part: HTMLElement; env: Envelope }>();
      body.lines.forEach((tex, i) => {
        const key = String(i + 1);
        const part = h('div', 'mt-line xp x-band', el);
        lineBar(part);
        const env = envelope(part, [tex], reachable.items[key], 'mt-eq', (alt, c) => drawTex(alt, plain(c).trim(), body.html));
        env.el.dataset.declared = '';
        lines.set(key, { part, env });
      });
      doms.set(el, { lines });
    },
    measure(el, width) {
      const natural = Math.ceil(maxContent(el));
      el.style.width = `${Math.min(natural, width)}px`;
      return { natural, height: el.offsetHeight };
    },
    render(el, s) {
      const d = doms.get(el)!;
      // Recession once per part (review item 5): the root owns visibility; the caption and each line recede.
      channels(el, { vis: s.self.vis });
      const cap = el.querySelector<HTMLElement>(':scope > .mt-cap');
      if (cap) channels(cap, { recede: s.self.recede });
      for (const [key, { part, env }] of d.lines) {
        channels(part, inherit(s.self, s.items[key]));
        showContent(env, s.items[key]?.content);
      }
    },
  },
};

/** Typeset TeX from the prepared map; TeX that was never prepared shows as source and is flagged for lint. */
function drawTex(el: HTMLElement, tex: string, html: Record<string, string> | undefined): void {
  const typeset = html?.[tex];
  if (typeset !== undefined) { el.innerHTML = typeset; return; }
  el.textContent = tex;
  el.classList.add('mt-raw');
  el.dataset.leaf = '';
  el.dataset.missing = '';
}

/** KaTeX for parse-time checks only. A lazy require: the page never calls `parse`, so it never loads. */
function compileKatex(): typeof import('katex').default {
  return require('katex') as typeof import('katex').default;
}

/** KaTeX's stylesheet without its font URLs, and the faces of every family the given HTML uses. */
async function stylesFor(html: string): Promise<{ css: string; faces: Face[] }> {
  const cssPath = require.resolve('katex/dist/katex.css');
  const dir = cssPath.slice(0, cssPath.lastIndexOf('/') + 1);
  const raw = await Bun.file(cssPath).text();
  const css = raw.replace(/@font-face\s*{[^}]*}/g, '');
  const classes = new Set([...html.matchAll(/class="([^"]*)"/g)].flatMap(m => m[1]!.split(/\s+/)));
  // A face is used if some rule naming its family applies to classes in the HTML. `.katex` itself sets Main.
  const face = (family: string, decl: string) =>
    `${family}|${/font-weight:\s*bold/.test(decl) ? 'bold' : 'normal'}|${/font-style:\s*italic/.test(decl) ? 'italic' : 'normal'}`;
  const used = new Set([face('KaTeX_Main', '')]);
  for (const rule of css.matchAll(/([^{}]+){([^}]*)}/g)) {
    const fam = rule[2]!.match(/font-family:\s*"?(KaTeX_\w+)/)?.[1];
    if (!fam) continue;
    const hit = rule[1]!.split(',').some(sel => {
      const last = sel.trim().split(/\s+/).pop() ?? '';
      const need = [...last.matchAll(/\.([\w-]+)/g)].map(m => m[1]!);
      return need.length > 0 && need.every(c => classes.has(c));
    });
    if (hit) used.add(face(fam, rule[2]!));
  }
  const faces: Face[] = [];
  for (const block of raw.matchAll(/@font-face\s*{([^}]*)}/g)) {
    const decl = block[1]!;
    const family = decl.match(/font-family:\s*"?(\w+)"?/)?.[1];
    const file = decl.match(/url\(([^)]+\.woff2)\)/)?.[1];
    if (!family || !file || !used.has(face(family, decl))) continue;
    const data = base64(await Bun.file(dir + file).bytes());
    faces.push({ family, weight: /font-weight:\s*bold/.test(decl) ? 'bold' : 'normal', style: /font-style:\s*italic/.test(decl) ? 'italic' : 'normal', data });
  }
  return { css, faces };
}

function base64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

const CSS = `
.mt-math { display: flex; flex-direction: column; gap: var(--space-3); width: max-content; }
.mt-cap { margin-bottom: var(--label-gap); text-align: center; }
.mt-line { position: relative; display: flex; justify-content: center; padding: var(--space-2) var(--space-6);
  border-radius: var(--radius-cell); --flash: calc(var(--now) * (1 - var(--hl)) * 100%); }
.mt-eq { font-size: var(--text-body); color: color-mix(in srgb, var(--hl-now-ink) var(--flash), var(--ink-1)); }
.mt-eq .katex-display { margin: 0; }
/* KaTeX gives a script's box (.vlist-t2) a negative right margin, so a formula ending in a subscript ran out of its block. */
.mt-eq .katex .vlist-t2 { margin-right: 0; }
/* KaTeX draws a second-level script (a subscript in an exponent) at half its base. Its own base, a little over
   --text-body, put that under the floor (--text-meta); twice --text-meta puts it exactly on the floor. */
.mt-eq .katex { text-rendering: geometricPrecision; font-size: calc(2 * var(--text-meta)); }
.mt-raw { font: var(--weight-regular) var(--text-code) / var(--leading-code) var(--font-mono); color: var(--ink-3); white-space: pre; }
`;
