/**
 * Build the self-contained page for a script (Bun side): runtime + blocks bundle, theme tokens, fonts
 * (inlined) and the IR with every block body prepared. The renderer loads it into each pool page; the
 * step-through export adds the player. Nothing in the page reaches the network.
 */
import type { Script } from '../ir.ts';
import { prepareBlocks } from '../blocks/registry.ts';
import { STAGE_CSS } from './page.ts';

const THEME = new URL('../../theme/v2/', import.meta.url);
const bundles = new Map<string, Promise<string>>();
/** Compile-time dependencies of block `prepare` hooks; imported dynamically, never shipped to the page. */
const COMPILE_ONLY = ['shiki', 'katex'];

/** Bundle a runtime entry for the browser, once per process. Throws with Bun's build log on failure. */
export function bundle(entry: 'entry' | 'player'): Promise<string> {
  let b = bundles.get(entry);
  if (!b) {
    b = (async () => {
      const out = await Bun.build({ entrypoints: [new URL(`./${entry}.ts`, import.meta.url).pathname], target: 'browser', minify: true, external: COMPILE_ONLY });
      if (!out.success) throw new Error(`lectern: page bundle failed\n${out.logs.join('\n')}`);
      return out.outputs[0]!.text();
    })();
    bundles.set(entry, b);
  }
  return b;
}

/** Theme stylesheet: fonts as data URLs, then tokens. */
export async function themeCss(): Promise<string> {
  const fonts = await Bun.file(new URL('fonts.css', THEME)).text();
  const inlined = await Promise.all(fonts.split(/(url\([^)]+\))/).map(async part => {
    const m = part.match(/^url\(([^)]+)\)$/);
    if (!m) return part;
    const data = Buffer.from(await Bun.file(new URL(m[1]!, THEME)).arrayBuffer()).toString('base64');
    return `url(data:font/woff2;base64,${data})`;
  }));
  return inlined.join('') + (await Bun.file(new URL('tokens.css', THEME)).text());
}

/** JSON safe to embed in a <script> element. */
export const embedJson = (v: unknown): string => JSON.stringify(v).replace(/</g, '\\u003c');

export interface PageOptions {
  /** Extra markup and script after the stage (the step-through player). */
  after?: string;
}

/** The page for `ir`: `window.lectern` is ready once its `ready` promise resolves. */
export async function pageHtml(ir: Script, opts: PageOptions = {}): Promise<string> {
  const prepared = await prepareBlocks(ir);
  const [js, css] = await Promise.all([bundle('entry'), themeCss()]);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(ir.meta.title)}</title>
<style>${css}</style><style>${STAGE_CSS}</style></head>
<body><div id="stage"></div>
<script type="application/json" id="lectern-ir">${embedJson(prepared)}</script>
<script>${js.replace(/<\/script/gi, '<\\/script')}</script>
${opts.after ?? ''}
</body></html>`;
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
