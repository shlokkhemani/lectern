import type { Loc } from '../ir.ts';
import type { Diagnostics } from './diagnostics.ts';
import type { CueSrc } from './model.ts';
import { topLevel } from './inline.ts';
import type { SourceText } from './source.ts';

export interface WordSrc { display: string; spoken: string[]; loc: Loc; cues: CueSrc[] }
export interface ParagraphSrc { loc: Loc; startCues: CueSrc[]; words: WordSrc[] }

/** Characters prose may not contain (§1.5, E412): TTS reads them unpredictably. */
const UNSPEAKABLE = /[()[\]{}<>=*/+|]/;
/** What backtick content in narration may contain (E411). */
const SPEAKABLE_CODE = /^[\p{L}\p{N}._]+$/u;

const SYMBOL_WORDS: Record<string, string> = {
  '(': 'the open bracket', ')': 'the closing bracket', '[': 'the open square bracket', ']': 'the closing square bracket',
  '{': 'the open brace', '}': 'the closing brace', ',': 'the comma', ';': 'the semicolon', ':': 'the colon',
  '=': 'equals', '==': 'equals equals', '!=': 'not equals', ':=': 'colon equals', '+': 'plus', '-': 'minus',
  '*': 'times', '/': 'divided by', '<': 'less than', '>': 'greater than', '<=': 'less than or equal',
  '>=': 'greater than or equal', '!': 'not', '|': 'pipe', '&&': 'and', '||': 'or', '->': 'arrow', '=>': 'arrow',
};

interface Segment { code: boolean; value: string; offset: number }

/**
 * One narration paragraph → words, cues and spoken form (§1.5).
 * - A cue anchors to the next word; cues before the first word fire at beat start. A cue with no word after
 *   it is E402.
 * - Display form drops backticks. Spoken form applies `say` by whole-word match (to prose words and their 's
 *   possessives, to whole backtick contents, and to the parts of split identifiers); other backtick content is
 *   split on camelCase, `_` and `.`, and lowercased.
 * - Speakability: E411 (backtick content) and E412 (symbols in prose).
 */
export function readParagraph(src: SourceText, say: Readonly<Record<string, string>>, diags: Diagnostics): ParagraphSrc {
  const s = src.text;
  const sayer = new Sayer(say);
  const words: WordSrc[] = [];
  /** Indices of words whose prose holds an unspeakable symbol. */
  const unspeakable: number[] = [];
  let startCues: CueSrc[] = [];
  let pending: CueSrc[] = [];
  let segs: Segment[] = [];
  let wordStart = -1;

  const flush = () => {
    if (wordStart < 0) return;
    const display = segs.map(g => g.value).join('');
    const word: WordSrc = { display, spoken: sayer.speak(segs), loc: src.loc(wordStart), cues: [] };
    if (words.length === 0) startCues = pending;
    else word.cues = pending;
    pending = [];
    if (segs.some(g => !g.code && UNSPEAKABLE.test(g.value))) unspeakable.push(words.length);
    words.push(word);
    segs = [];
    wordStart = -1;
  };
  const addText = (c: string, offset: number) => {
    if (wordStart < 0) wordStart = offset;
    const last = segs[segs.length - 1];
    if (last && !last.code) last.value += c;
    else segs.push({ code: false, value: c, offset });
  };

  let i = 0;
  while (i < s.length) {
    const c = s[i]!;
    if (/\s/.test(c)) {
      flush();
      i++;
    } else if (c === '[') {
      flush();
      const end = topLevel(s, i + 1, ']').next().value ?? -1;
      if (end < 0) {
        diags.report('E110', src.loc(i), 'cue is not closed', 'add "]" where the cue ends; a "]" inside backticks or braces does not count');
        break;
      }
      pending.push({ inner: src.slice(i + 1, end), loc: src.loc(i) });
      i = end + 1;
    } else if (c === '`') {
      const end = s.indexOf('`', i + 1);
      if (end < 0) {
        diags.report('E112', src.loc(i), 'backtick is not closed', 'add the closing backtick');
        addText(s.slice(i + 1), i + 1);
        break;
      }
      if (wordStart < 0) wordStart = i;
      const value = s.slice(i + 1, end);
      segs.push({ code: true, value, offset: i });
      if (!SPEAKABLE_CODE.test(value)) {
        diags.report('E411', src.loc(i), `"\`${value}\`" in narration cannot be spoken reliably`,
          `write ${asWords(value)} instead; backticks in narration hold only letters, digits, "." and "_"`);
      }
      i = end + 1;
    } else {
      addText(c, i);
      i++;
    }
  }
  flush();

  for (const cue of pending)
    diags.report('E402', cue.loc, 'cue has no word after it in this paragraph', 'put it before a word, or on its own line directly above the next paragraph');

  // One E412 per expression: offending words at most one word apart, and a bare operator takes its
  // neighbours as operands, so "add(2, 3)" and "a + b = c" are each one problem.
  const bare = (i: number) => !/[\p{L}\p{N}]/u.test(words[i]!.display);
  for (let k = 0; k < unspeakable.length; ) {
    let j = k;
    while (j + 1 < unspeakable.length && unspeakable[j + 1]! - unspeakable[j]! <= 2) j++;
    let from = unspeakable[k]!;
    let to = unspeakable[j]!;
    if (bare(from) && from > 0) from--;
    if (bare(to) && to < words.length - 1) to++;
    const run = words.slice(from, to + 1).map(w => w.display).join(' ');
    diags.report('E412', words[from]!.loc, `"${run}" cannot be spoken reliably`, `write it as natural speech, e.g. ${asWords(run)}`);
    k = j + 1;
  }

  return { loc: src.loc(0), startCues, words };
}

/**
 * A spoken suggestion for code-ish text, quoted. Calls become "add of 2 and 3" (the audio lane measured that
 * "add, 2, 3" makes the voice say "comma"); symbols become words.
 */
function asWords(text: string): string {
  const whole = SYMBOL_WORDS[text.trim()];
  if (whole) return `"${whole}"`;
  const call = /^([\p{L}_][\p{L}\p{N}_.]*)\((.*)\)([.,;:!?]*)$/u.exec(text.trim());
  let out = text;
  if (call) {
    const args = call[2]!.split(/\s*,\s*/).filter(Boolean);
    const list = args.length > 1 ? `${args.slice(0, -1).join(', ')} and ${args.at(-1)}` : (args[0] ?? '');
    out = list ? `${call[1]} of ${list}` : `${call[1]}, called with nothing`;
  }
  out = out
    .replace(/==|!=|<=|>=|:=|&&|\|\||->|=>|[=+*/<>|!]/g, op => ` ${SYMBOL_WORDS[op] ?? op} `)
    .replace(/[()[\]{}]/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  return `"${out}"`;
}

/** Spoken form of one word. Lookups read only the author's own `say` entries (a Map, never a prototype). */
class Sayer {
  private readonly exact: Map<string, string>;
  private readonly lower = new Map<string, string>();

  constructor(say: Readonly<Record<string, string>>) {
    this.exact = new Map(Object.entries(say));
    for (const [k, v] of this.exact) if (k === k.toLowerCase()) this.lower.set(k, v);
  }

  speak(segs: readonly Segment[]): string[] {
    const text = segs.map(g => (g.code ? this.code(g.value) : this.prose(g.value))).join('');
    const spoken = text.split(/\s+/).filter(Boolean);
    return spoken.length ? spoken : [segs.map(g => g.value).join('')];
  }

  /** Each word of prose, found by word boundaries, is replaced if `say` has it, or its stem if it has 's; punctuation stays. */
  private prose(text: string): string {
    return text.replace(/([\p{L}\p{N}_]+)('\p{L}+)?/gu, (w, stem: string, tail?: string) => {
      const stemSaid = tail?.toLowerCase() === "'s" ? this.lookup(stem) : undefined;
      return this.lookup(w) ?? (stemSaid ? stemSaid + tail : w);
    });
  }

  /** `parseCallExpression` → "parse call expression"; `LOWEST` → "lowest"; `say` wins. */
  private code(content: string): string {
    const whole = this.lookup(content);
    if (whole) return whole;
    return content
      .split(/[_.]+/)
      .filter(Boolean)
      .flatMap(splitCase)
      .map(part => this.lookup(part) ?? part.toLowerCase())
      .join(' ');
  }

  /** Whole-word match: exact, or case-insensitive for an all-lowercase key. */
  private lookup(word: string): string | undefined {
    if (!word) return undefined;
    return this.exact.get(word) ?? this.lower.get(word.toLowerCase());
  }
}

/** Splits at camelCase and ALLCAPS→Word boundaries: `HTTPServer` → HTTP, Server. */
function splitCase(s: string): string[] {
  const parts: string[] = [];
  const up = (c: string | undefined) => !!c && c !== c.toLowerCase();
  const low = (c: string | undefined) => !!c && c !== c.toUpperCase();
  let start = 0;
  for (let i = 1; i < s.length; i++) {
    if ((low(s[i - 1]) && up(s[i])) || (up(s[i - 1]) && up(s[i]) && low(s[i + 1]))) {
      parts.push(s.slice(start, i));
      start = i;
    }
  }
  parts.push(s.slice(start));
  return parts;
}
