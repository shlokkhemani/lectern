// Single-pass tokeniser shared by both sides of the transcript diff (spec §5.6), and the units
// the diff compares: the same tokens with numbers read back to their value and spelling folded,
// so the diff compares meaning, not how a recogniser chose to write it.
//
// Every source word is scanned once. Numbers, ordinals, `%`, `&`, camelCase/ALLCAPS
// boundaries, `_ . -` separators and contractions are recognised on the raw text (a `.` between
// letters, or before letters at a word's start, is said "dot": recognisers write "example dot com" as
// "example.com" and "dot git" as ".git"; ".092" is said "point zero nine two"),
// before anything is folded, so no information is lost to an earlier normalisation.
// Only then are numbers spelled out and letters lowercased. Each token keeps the index
// of the source word it came from (its provenance).

/** One comparable unit of speech. `src` indexes the word list given to `tokenise`. */
export interface Token { text: string; src: number }

/**
 * What the transcript diff compares: one word, or one whole spoken number. Two units mean the
 * same when their `key`s are equal. `text` is the unit's spoken tokens ("nineteen seventy five"),
 * as messages show it. The unit came from source words `src`..`last` (several when a number is
 * written across words, e.g. "nineteen seventy-five").
 */
export interface Unit { key: string; text: string; src: number; last: number }

/**
 * Tokenises `words`, then folds spelling so the diff compares meaning:
 * - every number becomes its value, however it was written or read: "1975", "nineteen seventy five"
 *   and "one thousand nine hundred seventy five" are all `1975`; "four hundred and eighty" is `480`;
 *   "a thousand" is `1000`; "21st" and "twenty first" are `21`; "2.0" and "two point oh" are `2.0`;
 *   "0.092" and "point zero nine two" are `0.092`.
 *   A number never spans sentence punctuation, so "12, 34" stays two numbers. A plural or possessive
 *   ends a number and stays on its value: "6s", "sixes" and "six's" are `6s`; "1870s" and "eighteen
 *   seventies" are `1870s`.
 * - a word's key drops accents, a possessive or plural "s", and the regular British spellings
 *   (-our, -re, -ise/-yse), so "Erdős"/"erdos", "York's"/"york", "metres"/"meters" and
 *   "recognise"/"recognize" are the same word.
 */
export function units(words: readonly string[]): Unit[] {
  const toks = tokenise(words);
  // Tokens a number may run across: those of one source word, or of adjacent words with no punctuation between.
  const joined = (a: Token, b: Token) => a.src === b.src || (b.src === a.src + 1 && !/[,.;:!?—–]["'”’)\]]*$/.test(words[a.src]!));
  const out: Unit[] = [];
  for (let i = 0; i < toks.length;) {
    // A plural number word ("sixes", "seventies", "twenty's") ends its number, which is then a plural ("6s").
    let end = i + 1;
    while (end < toks.length && !PLURAL.has(toks[end - 1]!.text) && joined(toks[end - 1]!, toks[end]!)) end++;
    const n = readNumber(toks.slice(i, end).map(t => PLURAL.get(t.text) ?? t.text));
    if (n) {
      const text = toks.slice(i, i + n.length).map(t => t.text).join(' ');
      const plural = PLURAL.has(toks[i + n.length - 1]!.text) ? 's' : '';
      out.push({ key: n.value + plural, text, src: toks[i]!.src, last: toks[i + n.length - 1]!.src });
      i += n.length;
    } else {
      out.push({ key: spellingKey(toks[i]!.text), text: toks[i]!.text, src: toks[i]!.src, last: toks[i]!.src });
      i++;
    }
  }
  return out;
}

/** Tokenises `words` in order. A word may yield zero tokens (pure punctuation) or several. */
export function tokenise(words: readonly string[]): Token[] {
  const out: Token[] = [];
  words.forEach((word, src) => {
    for (const text of tokeniseWord(word)) out.push({ text, src });
  });
  return out;
}

// Alternatives in priority order; anything unmatched is a separator.
const PIECE = new RegExp(
  [
    String.raw`(?<grouped>\d{1,3}(?:,\d{3})+(?:\.\d+)?)(?!\d)`, // 1,000 / 12,345.5
    String.raw`(?<decimal>\d*\.\d+)`,                          // 2.5, .092
    String.raw`(?<ordinal>\d+)(?:st|nd|rd|th)(?![\p{L}\d])`,   // 1st, 22nd
    String.raw`(?<plural>\d+)'?s(?![\p{L}\d])`,                 // 6s, 1870s, 20's: said "sixes", "seventies", "twenties"
    String.raw`(?<integer>\d+)`,                               // 7
    String.raw`(?<symbol>[%&])`,                               // % &
    String.raw`(?<currency>[$£€])`,                            // $400 is said "four hundred dollars"
    String.raw`(?<letters>\p{L}+(?:'\p{L}+)*)`,                // don't, parseCallExpression
  ].join('|'),
  'giu',
);

const CURRENCY: Record<string, string> = { $: 'dollars', '£': 'pounds', '€': 'euros' };

function tokeniseWord(raw: string): string[] {
  const word = raw.normalize('NFKC').replace(/[‘’ʼ`]/g, "'");
  const out: string[] = [];
  let currency: string | undefined;   // said after the number it precedes
  let lettersEnd = 0;                  // where the last letter run ended, while it is the last piece (0: word start)
  const number = (words: string[]) => { out.push(...words); if (currency) out.push(currency); currency = undefined; };
  for (const m of word.matchAll(PIECE)) {
    const g = m.groups ?? {};
    if (g.letters && lettersEnd >= 0 && word.slice(lettersEnd, m.index) === '.') out.push('dot');   // example.com, .git
    lettersEnd = g.letters ? m.index + m[0].length : -1;
    if (g.grouped) number(numberWords(g.grouped.replace(/,/g, '')));
    else if (g.decimal) number(numberWords(g.decimal));
    else if (g.ordinal) number(ordinalWords(g.ordinal));
    else if (g.plural) number(pluralWords(g.plural));
    else if (g.integer) number(numberWords(g.integer));
    else if (g.symbol) out.push(g.symbol === '%' ? 'percent' : 'and');
    else if (g.currency) currency = CURRENCY[g.currency];
    else if (g.letters) out.push(...splitCase(g.letters).map(s => s.toLowerCase()));
  }
  if (currency) out.push(currency);
  return out;
}

/** Splits a letter run at camelCase and ALLCAPS→Word boundaries; apostrophes never split. */
function splitCase(s: string): string[] {
  const parts: string[] = [];
  let start = 0;
  const isUp = (c: string | undefined) => c !== undefined && c !== c.toLowerCase() && c === c.toUpperCase();
  const isLow = (c: string | undefined) => c !== undefined && c !== c.toUpperCase() && c === c.toLowerCase();
  for (let i = 1; i < s.length; i++) {
    const prev = s[i - 1], cur = s[i], next = s[i + 1];
    const lowerToUpper = isLow(prev) && isUp(cur);                       // parse|Call
    const capsToWord = isUp(prev) && isUp(cur) && isLow(next)            // HTTP|Server
      && !(next === 's' && i + 2 === s.length);                          // but IDs stays whole
    if (lowerToUpper || capsToWord) { parts.push(s.slice(start, i)); start = i; }
  }
  parts.push(s.slice(start));
  return parts;
}

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const SCALES = ['', 'thousand', 'million', 'billion', 'trillion'];

function digitWords(digits: string): string[] {
  return [...digits].map(d => ONES[Number(d)]!);
}

/** "2.5" → two point five; ".092" → point zero nine two; "007" → zero zero seven; very long numbers are read digit by digit. */
function numberWords(num: string): string[] {
  const [int = '', frac] = num.split('.');
  const intWords = int === '' ? [] : (int.length > 1 && int.startsWith('0')) || int.length > 15 ? digitWords(int) : cardinal(Number(int));
  return frac === undefined ? intWords : [...intWords, 'point', ...digitWords(frac)];
}

function cardinal(n: number): string[] {
  if (n === 0) return ['zero'];
  const out: string[] = [];
  for (let scale = SCALES.length - 1; scale >= 0; scale--) {
    const unit = 1000 ** scale;
    const chunk = Math.floor(n / unit) % 1000;
    if (chunk === 0) continue;
    out.push(...belowThousand(chunk));
    if (scale > 0) out.push(SCALES[scale]!);
  }
  return out;
}

function belowThousand(n: number): string[] {
  const out: string[] = [];
  if (n >= 100) { out.push(ONES[Math.floor(n / 100)]!, 'hundred'); n %= 100; }
  if (n >= 20) { out.push(TENS[Math.floor(n / 10)]!); n %= 10; if (n) out.push(ONES[n]!); }
  else if (n > 0) out.push(ONES[n]!);
  return out;
}

const IRREGULAR_ORDINALS: Record<string, string> = {
  one: 'first', two: 'second', three: 'third', five: 'fifth', eight: 'eighth', nine: 'ninth', twelve: 'twelfth',
};

function ordinalWords(digits: string): string[] {
  const words = numberWords(digits);
  const last = words.pop() ?? '';
  const ord = IRREGULAR_ORDINALS[last] ?? (last.endsWith('y') ? `${last.slice(0, -1)}ieth` : `${last}th`);
  return [...words, ord];
}

/** "6" → sixes; "1870" → one thousand eight hundred seventies: the last word takes the plural. */
function pluralWords(digits: string): string[] {
  const words = numberWords(digits);
  const last = words.pop() ?? '';
  return [...words, last.endsWith('x') ? `${last}es` : last.endsWith('y') ? `${last.slice(0, -1)}ies` : `${last}s`];
}

// ---------------------------------------------------------------------------------------------
// Reading a spoken number back to its value

const VALUE = new Map<string, number>([...ONES.map((w, n) => [w, n] as const), ...TENS.map((w, n) => [w, n * 10] as const).filter(([w]) => w)]);
const ORDINAL = new Map<string, number>([
  ...['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth',
    'thirteenth', 'fourteenth', 'fifteenth', 'sixteenth', 'seventeenth', 'eighteenth', 'nineteenth'].map((w, n) => [w, n + 1] as const),
  ...TENS.slice(2).map((w, n) => [`${w.slice(0, -1)}ieth`, (n + 2) * 10] as const),
]);
const SCALE = new Map([['thousand', 1e3], ['million', 1e6], ['billion', 1e9], ['trillion', 1e12]]);
const isScale = (t: string | undefined) => t === 'hundred' || SCALE.has(t ?? '');
/** A plural or possessive number word and its number word: sixes, twenties, twenty's, hundreds → six, twenty, twenty, hundred. */
const PLURAL = new Map([...VALUE.keys(), 'hundred', ...SCALE.keys()].flatMap(w => [
  [w.endsWith('x') ? `${w}es` : w.endsWith('y') ? `${w.slice(0, -1)}ies` : `${w}s`, w], [`${w}'s`, w],
] as const));

/** A number below 100 at `t[i]`: "seven", "nineteen", "seventy five", "twenty first". */
function belowHundred(t: readonly string[], i: number): { value: number; end: number; ordinal: boolean } | null {
  const a = VALUE.get(t[i] ?? '') ?? ORDINAL.get(t[i] ?? '');
  if (a === undefined) return null;
  if (ORDINAL.has(t[i]!)) return { value: a, end: i + 1, ordinal: true };
  const b = VALUE.get(t[i + 1] ?? '') ?? ORDINAL.get(t[i + 1] ?? '');
  if (a >= 20 && a % 10 === 0 && b !== undefined && b >= 1 && b <= 9) return { value: a + b, end: i + 2, ordinal: ORDINAL.has(t[i + 1]!) };
  return { value: a, end: i + 1, ordinal: false };
}

/**
 * The number at the start of `t`, as its value and the tokens it used, or null. Groups below a
 * thousand are read the three ways people say them: "four hundred and eighty", "a hundred", and as
 * hundreds-pairs ("nineteen seventy five", "twenty twenty four", "seven oh one", "one fifty two");
 * groups combine through scale words ("two thousand and six", "one fifty two million"); then "point".
 */
function readNumber(t: readonly string[]): { value: string; length: number } | null {
  let total = 0, i = 0, cap = Infinity, read = false;
  while (i < t.length) {
    let group: number, ordinal = false;
    if (t[i] === 'a' && isScale(t[i + 1])) { group = 1; i++; }
    else {
      const n = belowHundred(t, i);
      if (!n) break;
      ({ value: group, ordinal } = n);
      i = n.end;
    }
    if (!ordinal && t[i] === 'hundred') {
      group *= 100; i++;
      const and = t[i] === 'and' ? 1 : 0;
      const n = belowHundred(t, i + and);
      if (n) { group += n.value; ordinal = n.ordinal; i = n.end; }
    } else if (!ordinal && group >= 1) {
      const lo = pairLow(t, i);
      if (lo) { group = group * 100 + lo.value; ordinal = lo.ordinal; i = lo.end; }
    }
    read = true;
    const scale = SCALE.get(t[i] ?? '');
    if (ordinal || !scale || scale >= cap) { total += group; break; }
    total += group * scale; cap = scale; i++;
    if (t[i] === 'and' && belowHundred(t, i + 1)) i++;   // "two thousand and six"
  }
  if (!read && !(t[0] === 'point' && DIGIT.has(t[1] ?? ''))) return null;   // "point zero nine two" is 0.092
  let value = String(total);
  if (t[i] === 'point' && DIGIT.has(t[i + 1] ?? '')) {
    value += '.';
    for (i++; DIGIT.has(t[i] ?? ''); i++) value += DIGIT.get(t[i]!);
  }
  return { value, length: i };
}

/** The second half of a hundreds-pair at `t[i]`: 10–99, or "oh"/"zero" and a digit ("seven oh one"). */
function pairLow(t: readonly string[], i: number): ReturnType<typeof belowHundred> {
  if (t[i] === 'oh' || t[i] === 'o' || t[i] === 'zero') {
    const d = belowHundred(t, i + 1);
    return d && d.value >= 1 && d.value <= 9 ? d : null;
  }
  const lo = belowHundred(t, i);
  return lo && lo.value >= 10 ? lo : null;
}

/** Digits after "point"; "oh" is also written "o" (nova-3: "two point o"). */
const DIGIT = new Map([...ONES.slice(0, 10).map((w, n) => [w, String(n)] as const), ['oh', '0'], ['o', '0']]);

// ---------------------------------------------------------------------------------------------
// Spelling

/**
 * A word's spelling-free key: no accents, no possessive or plural "s", American spelling for the
 * three regular British patterns. Each rule needs a stem long enough that short words ("four",
 * "this", "rise", "there") are left alone; both sides are folded the same way, so a rare collision
 * only hides a near-homophone, never a lost word.
 */
function spellingKey(word: string): string {
  return word.normalize('NFKD').replace(/\p{M}/gu, '')
    .replace(/(?:'s|s'|')$/, '')                     // York's, owls'
    .replace(/^(.{3,}[^su])s$/, '$1')                // winters, dollars; not status, process, this
    .replace(/^(.{2,})our(ite|ed|ing)?$/, '$1or$2')  // favour, colour, behaviour; not four, your
    .replace(/^(.{2,}[^aeiou])re$/, '$1er')          // metre, centre, kilometre; not there, more, acre
    .replace(/^(.{3,}[iy])s(e|ed|es|ing|ation)$/, '$1z$2');   // recognise, organisation, analyse; not rise, noise
}
