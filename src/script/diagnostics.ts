import type { Diagnostic, Loc } from '../ir.ts';

/**
 * Every code the script language itself reports (§1.7), with a one-line summary for the skill's error table.
 * Block modules report their own codes (E150 …) through `ParseCtx`; layout, audio and timing own L4xx, A5xx
 * and T6xx. Each message is written where the problem is found, so it can name the exact fix.
 */
export const CATALOGUE = {
  E101: { severity: 'error', summary: 'front matter is not closed with ---' },
  E102: { severity: 'error', summary: 'front matter line not understood, or unknown key' },
  E103: { severity: 'error', summary: 'the script has no title' },
  E104: { severity: 'error', summary: 'narration or a block before the first ## scene' },
  E105: { severity: 'error', summary: 'block is not closed with :::' },
  E106: { severity: 'error', summary: 'a ::: line closes no block' },
  E107: { severity: 'error', summary: 'unknown block type, or reuse of an unknown id' },
  E108: { severity: 'error', summary: 'block declaration arg, region or caption not understood' },
  E109: { severity: 'error', summary: 'comment is not closed with -->' },
  E110: { severity: 'error', summary: 'cue is not closed with ]' },
  E111: { severity: 'error', summary: 'cue command not understood' },
  E112: { severity: 'error', summary: 'inline mark not closed, or empty' },
  E113: { severity: 'error', summary: 'malformed id' },
  E114: { severity: 'error', summary: 'reserved word used as an id' },
  E115: { severity: 'error', summary: 'heading not understood' },
  W120: { severity: 'warning', summary: '*x* is literal text, not emphasis' },
  E201: { severity: 'error', summary: 'unknown target' },
  E202: { severity: 'error', summary: 'id declared twice' },
  E203: { severity: 'error', summary: 'reuse of a block declared later' },
  E204: { severity: 'error', summary: 'block placed twice in one scene' },
  E205: { severity: 'error', summary: 'target is not on screen in this scene' },
  E206: { severity: 'error', summary: 'bare item name used by several blocks: qualify it as block:name' },
  E213: { severity: 'error', summary: 'src= file not found' },
  E301: { severity: 'error', summary: 'hl, set or move on something hidden' },
  E302: { severity: 'error', summary: 'set has no value' },
  E303: { severity: 'error', summary: 'move has no valid position' },
  E304: { severity: 'error', summary: 'swap pair not valid' },
  E305: { severity: 'error', summary: 'verb or selector not supported by this block' },
  E306: { severity: 'error', summary: 'group needs a contiguous range and a label' },
  E307: { severity: 'error', summary: 'none works only with hl and focus' },
  W310: { severity: 'warning', summary: 'show or grow on something already visible' },
  W330: { severity: 'warning', summary: 'two hl cues on one block at once: the second replaces the first' },
  E401: { severity: 'error', summary: 'scene has no narration and no block' },
  E402: { severity: 'error', summary: 'cue has no word after it in its paragraph' },
  E411: { severity: 'error', summary: 'backtick text in narration cannot be spoken reliably' },
  E412: { severity: 'error', summary: 'symbols in narration cannot be spoken reliably' },
  E420: { severity: 'error', summary: 'scene is over 400 spoken words' },
} as const satisfies Record<string, { severity: 'error' | 'warning'; summary: string }>;

export type Code = keyof typeof CATALOGUE;

const MAX = 50;

/** Collects diagnostics for one parse. */
export class Diagnostics {
  private readonly found: Diagnostic[] = [];

  /** `file`: the script, as the caller named it. */
  constructor(readonly file: string) {}

  report(code: Code, loc: Loc, message: string, fix: string): void {
    this.add(code, CATALOGUE[code].severity, loc, message, fix);
  }

  /** For codes owned by block modules. */
  add(code: string, severity: 'error' | 'warning', loc: Loc, message: string, fix: string): void {
    this.found.push({ file: this.file, line: loc.line, col: loc.col, code, severity, message, fix });
  }

  get failed(): boolean {
    return this.found.some(d => d.severity === 'error');
  }

  /** Deduplicated, at most 50 (errors kept before warnings), in source order. */
  list(): Diagnostic[] {
    const seen = new Set<string>();
    const unique = this.found.filter(d => {
      const k = `${d.line}:${d.col}:${d.code}:${d.message}`;
      return !seen.has(k) && !!seen.add(k);
    });
    const byPos = (a: Diagnostic, b: Diagnostic) => a.line - b.line || a.col - b.col;
    const errors = unique.filter(d => d.severity === 'error').sort(byPos);
    const warnings = unique.filter(d => d.severity === 'warning').sort(byPos);
    return [...errors, ...warnings].slice(0, MAX).sort(byPos);
  }
}
