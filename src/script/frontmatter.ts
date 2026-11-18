import type { Script } from '../ir.ts';
import type { Diagnostics } from './diagnostics.ts';
import { DEFAULT_THEME, THEMES, isTheme } from '../themes.ts';

type Meta = Script['meta'];

const KEYS = ['title', 'series', 'lang', 'voice', 'theme', 'say'] as const;
/** Rulings §9: one TTS model, not author-settable. */
const TTS_MODEL = 'gemini-3.8-flash-tts';

/**
 * The front matter (§1.2): a YAML subset of `key: value` lines between `---` fences. `say` is a map, written
 * as a flow map `{ a: b, c: d }` or as indented `key: value` lines. Returns the meta and the first body line
 * (0-based).
 */
export function readFrontMatter(lines: readonly string[], diags: Diagnostics): { meta: Meta; body: number } {
  const meta: Meta = { title: '', slug: '', lang: 'text', voice: 'Charon', ttsModel: TTS_MODEL, theme: DEFAULT_THEME, say: {} };
  const noTitle = () =>
    diags.report('E103', { line: 1, col: 1 }, 'the script has no title', 'start the file with front matter: a "---" line, "title: <video title>", and a closing "---"');

  if (lines[0]?.trim() !== '---') {
    noTitle();
    return { meta, body: 0 };
  }
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
  if (end < 0) {
    diags.report('E101', { line: 1, col: 1 }, 'front matter is not closed', 'add a line "---" after the last front matter key');
    return { meta, body: lines.length };
  }

  for (let i = 1; i < end; i++) {
    const line = lines[i]!;
    const loc = { line: i + 1, col: 1 };
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const m = /^([A-Za-z_][\w-]*)\s*:(.*)$/.exec(line);
    if (!m) {
      diags.report('E102', loc, `front matter line not understood: "${line.trim()}"`, 'write "key: value", one per line, starting at column 1');
      continue;
    }
    const key = m[1]!;
    const rest = m[2]!.trim();
    if (key === 'say') {
      if (rest) readFlowMap(rest, loc, meta.say, diags);
      else
        while (i + 1 < end && /^\s+\S/.test(lines[i + 1]!)) {
          i++;
          readEntry(lines[i]!.trim(), { line: i + 1, col: lines[i]!.search(/\S/) + 1 }, meta.say, diags);
        }
      continue;
    }
    if (!(KEYS as readonly string[]).includes(key)) {
      diags.report('E102', loc, `unknown front matter key "${key}"`, `use one of: ${KEYS.join(', ')}`);
      continue;
    }
    const value = scalar(rest);
    if (!value) {
      diags.report('E102', loc, `"${key}" has no value`, `write "${key}: <value>"`);
      continue;
    }
    if (key === 'theme') {
      if (isTheme(value)) meta.theme = value;
      else diags.report('E102', loc, `unknown theme "${value}"`, `write "theme: ${Object.keys(THEMES).join('" or "theme: ')}"`);
      continue;
    }
    if (key === 'title' || key === 'series' || key === 'lang' || key === 'voice') meta[key] = value;
  }

  if (!meta.title) noTitle();
  meta.slug = slugify(meta.title);
  return { meta, body: end + 1 };
}

function readFlowMap(text: string, loc: { line: number; col: number }, into: Record<string, string>, diags: Diagnostics): void {
  if (!text.startsWith('{') || !text.endsWith('}')) {
    diags.report('E102', loc, `"say" must be a map, got "${text}"`, 'write say: { word: how it is said }, or put "key: value" lines indented below "say:"');
    return;
  }
  for (const entry of splitOutsideQuotes(text.slice(1, -1), ',')) if (entry.trim()) readEntry(entry.trim(), loc, into, diags);
}

function readEntry(entry: string, loc: { line: number; col: number }, into: Record<string, string>, diags: Diagnostics): void {
  const at = splitOutsideQuotes(entry, ':');
  const key = scalar(at[0] ?? '');
  const value = scalar(at.slice(1).join(':'));
  if (at.length < 2 || !key || !value) {
    diags.report('E102', loc, `"say" entry not understood: "${entry}"`, 'write "word: how it is said", e.g. infix: in-fix');
    return;
  }
  // defineProperty, so a key like __proto__ is an ordinary entry
  Object.defineProperty(into, key, { value, enumerable: true, writable: true, configurable: true });
}

function splitOutsideQuotes(s: string, sep: string): string[] {
  const out: string[] = [];
  let quote = '';
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (quote) {
      if (c === quote) quote = '';
    } else if (c === '"' || c === "'") quote = c;
    else if (c === sep) {
      out.push(s.slice(start, i));
      start = i + 1;
    }
  }
  out.push(s.slice(start));
  return out;
}

function scalar(raw: string): string {
  const t = raw.trim();
  if (t.length >= 2 && (t[0] === '"' || t[0] === "'") && t.at(-1) === t[0]) return t.slice(1, -1);
  return t;
}

/** Lowercase ASCII words joined by `-`. */
function slugify(title: string): string {
  const slug = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'video';
}
