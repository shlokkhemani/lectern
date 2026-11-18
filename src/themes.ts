/**
 * The themes a script can name (`theme:` in its front matter), and their files. Every theme is drawn over the
 * default one: its stylesheets come after `dark`'s, so a theme states only what it changes and never lacks a token.
 * A theme directory holds `tokens.css` and, optionally, `fonts.css` (fonts it vendors) and `blocks.css` (rules that
 * restyle blocks; selectors start at `#stage`, so they win over each block's own rules).
 */
export const THEMES = { dark: 'v2', paper: 'paper' } as const;
export type ThemeName = keyof typeof THEMES;
export const DEFAULT_THEME: ThemeName = 'dark';

export const isTheme = (name: string): name is ThemeName => Object.hasOwn(THEMES, name);

/** The theme directories a page draws with, base first. */
export function themeDirs(name: ThemeName): URL[] {
  const dir = (n: ThemeName) => new URL(`../theme/${THEMES[n]}/`, import.meta.url);
  return name === DEFAULT_THEME ? [dir(DEFAULT_THEME)] : [dir(DEFAULT_THEME), dir(name)];
}

/** A theme file's text, or '' when that directory has none (only `tokens.css` is required). */
export async function themeFile(dir: URL, file: 'tokens.css' | 'fonts.css' | 'blocks.css'): Promise<string> {
  const f = Bun.file(new URL(file, dir));
  if (await f.exists()) return f.text();
  if (file === 'tokens.css') throw new Error(`lectern: theme ${dir.pathname} has no tokens.css`);
  return '';
}
