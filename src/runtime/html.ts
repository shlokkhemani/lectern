/**
 * Build the self-contained page for a script (Bun side): runtime + blocks bundle, theme tokens, fonts
 * (inlined) and the IR with every block body prepared. The renderer loads it into each pool page; the
 * step-through export adds the player. Nothing in the page reaches the network.
 */
import type { Script } from '../ir.ts';
import { prepareBlocks } from '../blocks/registry.ts';
import { STAGE_CSS } from './page.ts';
import { themeDirs, themeFile, type ThemeName } from '../themes.ts';
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

const MIME: Record<string, string> = { woff2: 'font/woff2', png: 'image/png' };

/** A theme stylesheet with each file it names (`url(file)`, relative to its directory) inlined as a data URL. */
async function inlineUrls(css: string, dir: URL): Promise<string> {
  const parts = await Promise.all(css.split(/(url\([^)]+\))/).map(async part => {
    const m = part.match(/^url\(([^)"']+)\)$/);
    if (!m || m[1]!.startsWith('data:')) return part;
    const mime = MIME[m[1]!.split('.').pop()!];
    if (!mime) throw new Error(`lectern: theme file ${m[1]} has no known type`);
    return `url(data:${mime};base64,${Buffer.from(await Bun.file(new URL(m[1]!, dir)).arrayBuffer()).toString('base64')})`;
  }));
  return parts.join('');
}

/**
 * Theme stylesheets: for the default theme and then the script's (`src/themes.ts`), fonts and tokens, then the
 * block restyles (`blocks.css`) in a second sheet that the page places after the blocks' own. Files they name
 * (fonts, images) are inlined.
 */
export async function themeCss(theme: ThemeName): Promise<{ css: string; blocks: string }> {
  let css = '', blocks = '';
  for (const dir of themeDirs(theme)) {
    css += (await inlineUrls(await themeFile(dir, 'fonts.css'), dir)) + (await themeFile(dir, 'tokens.css'));
    blocks += await inlineUrls(await themeFile(dir, 'blocks.css'), dir);
  }
  return { css, blocks };
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
  const [js, { css, blocks }] = await Promise.all([bundle('entry'), themeCss(ir.meta.theme)]);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(ir.meta.title)}</title>
<style>${css}</style><style>${STAGE_CSS}</style>${blocks ? `<style>${blocks}</style>` : ''}</head>
<body><div id="stage"></div>
<script type="application/json" id="lectern-ir">${embedJson(prepared)}</script>
<script>${js.replace(/<\/script/gi, '<\\/script')}</script>
${opts.after ?? ''}
</body></html>`;
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
