import type { Inline, InlineRole } from '../ir.ts';
import type { Diagnostics } from './diagnostics.ts';
import type { SourceText } from './source.ts';

const ROLE = /^\{(em|alt|ok|bad|box) /;
const ESCAPABLE = new Set(['{', '}', '`', '\\']);
/** Markdown-style `*x*` or `**x**` outside code spans (day-0 ruling 2 made it literal). */
const MD_EMPHASIS = /(?<![\p{L}\p{N}_*\\])(\*\*?)(?=[^\s*])([^*]*?[^\s*\\])\1(?![\p{L}\p{N}_*])/gu;

/**
 * Inline marks (§1.4): `` `code` `` and `{em|alt|ok|bad|box x}`. A role is recognised only with its name
 * directly after `{` and a space, so `{ x + y; }` is literal; braces inside a role must balance. Roles work
 * inside backticks. `\{ \} \` \\` escape; `*` is always literal. Always returns a usable Inline; problems
 * are reported (E112, W120).
 */
export function parseInline(src: SourceText, diags: Diagnostics): Inline {
  const s = src.text;
  let i = 0;

  const seq = (until: 'end' | 'brace' | 'tick', open: number, inCode: boolean): Inline => {
    const out = new Builder();
    let depth = 0;
    while (i < s.length) {
      const c = s[i]!;
      if (c === '\\' && ESCAPABLE.has(s[i + 1] ?? '')) {
        out.text(s[i + 1]!);
        i += 2;
        continue;
      }
      if (c === '`') {
        if (until === 'tick') {
          i++;
          return out.done();
        }
        if (inCode) break; // this backtick closes the enclosing code span, so the role here is unclosed
        const at = i++;
        const kids = seq('tick', at, true);
        if (kids.length) out.role('code', kids);
        else diags.report('E112', src.loc(at), 'empty code span', 'put text between the backticks, or remove them');
        continue;
      }
      if (c === '{') {
        const m = ROLE.exec(s.slice(i));
        if (m) {
          const at = i;
          i += m[0].length;
          const kids = seq('brace', at, inCode);
          if (kids.length) out.role(m[1] as InlineRole, kids);
          else diags.report('E112', src.loc(at), `empty mark "{${m[1]} }"`, `put text inside it: {${m[1]} text}`);
          continue;
        }
        if (until === 'brace') depth++;
      } else if (c === '}' && until === 'brace') {
        if (depth === 0) {
          i++;
          return out.done();
        }
        depth--;
      }
      out.text(c);
      i++;
    }
    if (until === 'tick') diags.report('E112', src.loc(open), 'backtick is not closed', 'add the closing backtick, or escape a literal one as \\`');
    if (until === 'brace') {
      const role = ROLE.exec(s.slice(open))?.[1] ?? 'em';
      diags.report('E112', src.loc(open), `"{${role}" is not closed`, 'add "}" to close it; braces inside a mark must balance, or escape a literal one as \\{');
    }
    return out.done();
  };

  const inline = seq('end', 0, false);
  warnMarkdownEmphasis(src, diags);
  return inline;
}

function warnMarkdownEmphasis(src: SourceText, diags: Diagnostics): void {
  const masked = src.text.replace(/`[^`]*`/g, m => ' '.repeat(m.length));
  for (const m of masked.matchAll(MD_EMPHASIS)) {
    diags.report('W120', src.loc(m.index), `"${m[0]}" shows its asterisks: the script has no Markdown emphasis`, `write {em ${m[2]}}`);
  }
}

/** Builds an Inline that keeps the invariant: adjacent strings merged. */
class Builder {
  private readonly out: Inline = [];
  text(t: string): void {
    const last = this.out[this.out.length - 1];
    if (typeof last === 'string') this.out[this.out.length - 1] = last + t;
    else this.out.push(t);
  }
  role(role: InlineRole, children: Inline): void {
    this.out.push({ role, children });
  }
  done(): Inline {
    return this.out;
  }
}

/**
 * Offsets, from `from` on, of each character in `stops` that sits outside backticks and braces, honouring
 * the same escapes as inline marks. Cue termination (`]`) and command splitting (`;`) both use it, so a
 * `]` or `;` inside `code`, `{role …}` or after a backslash never ends or splits a cue.
 */
export function* topLevel(s: string, from: number, stops: string): Generator<number> {
  let tick = false;
  let depth = 0;
  for (let i = from; i < s.length; i++) {
    const c = s[i]!;
    if (c === '\\' && ESCAPABLE.has(s[i + 1] ?? '')) i++;
    else if (c === '`') tick = !tick;
    else if (tick) continue;
    else if (c === '{') depth++;
    else if (c === '}') depth = Math.max(0, depth - 1);
    else if (depth === 0 && stops.includes(c)) yield i;
  }
}
