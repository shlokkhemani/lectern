import { dirname, join } from 'node:path';
import type { Args, BlockModule, ParseCtx } from '../blocks/contract.ts';
import type { ItemDecl, Loc, ReadSource, Region } from '../ir.ts';
import type { Diagnostics } from './diagnostics.ts';
import { parseInline } from './inline.ts';
import { SourceText } from './source.ts';
import type { DeclSrc, HeaderToken } from './structure.ts';

const REGIONS: readonly Region[] = ['top', 'left', 'main'];

export interface DeclaredBlock {
  id?: { text: string; loc: Loc };
  args: Args;
  caption?: string;
  region: Region;
  body: unknown;
  items: ItemDecl[];
  /** The module rejected the body; it has no items. */
  broken: boolean;
}

/** Thrown by `ctx.error` to abort one block's body parse. */
class BlockAbort extends Error {}

/**
 * `::: type id args… @region "caption"` plus its body → a declared block (§1.3). Bare words name a flag or
 * a value of a literal-list arg; otherwise the first word is the id. The body goes to the block module.
 */
export function declareBlock(src: DeclSrc, module: BlockModule, meta: { lang: string }, read: ReadSource, diags: Diagnostics): DeclaredBlock {
  const out: DeclaredBlock = { args: {}, region: module.defaultRegion ?? 'main', body: null, items: [], broken: false };
  const argHelp = describeArgs(module);
  src.tokens.forEach((tok, k) => readHeaderToken(tok, k, src.tokens[k - 1], module, argHelp, out, diags));

  // A block with no body lines (src=) has no line of its own to point at; use its declaration.
  const at = (loc: Loc): Loc => (loc.line >= 1 ? loc : src.loc);
  const ctx: ParseCtx = {
    meta,
    source: (path, loc) => {
      const text = read(path);
      if (text === null) {
        // Named where it was looked for: beside the script (as the caller named the script).
        diags.report('E213', at(loc), `src file "${join(dirname(diags.file), path)}" not found`, 'give the path relative to the script\'s directory');
        throw new BlockAbort(path);
      }
      return text.replace(/\r?\n$/, '').split(/\r?\n/);
    },
    inline: (text, loc) => parseInline(SourceText.at(text, loc), diags),
    error: (loc, code, message, fix) => {
      diags.add(code, 'error', at(loc), message, fix);
      throw new BlockAbort(message);
    },
    warn: (loc, code, message, fix) => diags.add(code, 'warning', at(loc), message, fix),
  };
  try {
    const parsed = module.parse(src.body, out.args, ctx);
    out.body = parsed.body;
    out.items = parsed.items.map(it => (it.loc.line >= 1 ? it : { ...it, loc: src.loc }));
  } catch (e) {
    if (!(e instanceof BlockAbort)) throw e;
    out.broken = true;
  }
  return out;
}

function readHeaderToken(tok: HeaderToken, k: number, prev: HeaderToken | undefined, module: BlockModule, argHelp: string, out: DeclaredBlock, diags: Diagnostics): void {
  const t = tok.text;
  const type = module.type;
  if (t.startsWith('"')) {
    if (out.caption !== undefined) diags.report('E108', tok.loc, `${type} has a second caption ${t}`, 'a block takes at most one "quoted caption"; merge them');
    else out.caption = unquote(t);
    return;
  }
  if (t.startsWith('@')) {
    const r = t.slice(1);
    if ((REGIONS as readonly string[]).includes(r)) out.region = r as Region;
    else diags.report('E108', tok.loc, `unknown region "${t}"`, 'use @top, @left or @main (the default)');
    return;
  }
  const eq = t.indexOf('=');
  const key = eq < 0 ? t : t.slice(0, eq);
  const kind = module.args[key];
  if (eq >= 0) {
    const value = unquote(t.slice(eq + 1));
    if (!kind) return void diags.report('E108', tok.loc, `${type} has no arg "${key}"`, argHelp);
    if (key in out.args) return void diags.report('E108', tok.loc, `arg "${key}" is given twice`, 'keep one');
    if (kind === 'flag') return void diags.report('E108', tok.loc, `"${key}" is a flag and takes no value`, `write just "${key}"`);
    if (kind === 'int' && !/^-?\d+$/.test(value)) return void diags.report('E108', tok.loc, `"${key}" needs a whole number, got "${value}"`, `write ${key}=12`);
    if (Array.isArray(kind) && !kind.includes(value)) return void diags.report('E108', tok.loc, `"${key}" must be one of ${kind.join(', ')}; got "${value}"`, `write ${key}=${kind[0]}`);
    if (!value) return void diags.report('E108', tok.loc, `"${key}" has no value`, `write ${key}=…`);
    out.args[key] = value;
    return;
  }
  if (kind === 'flag') {
    out.args[key] = true;
    return;
  }
  const listed = Object.entries(module.args).find(([, v]) => Array.isArray(v) && v.includes(t));
  if (listed) {
    out.args[listed[0]] = t;
    return;
  }
  if (kind) return void diags.report('E108', tok.loc, `"${key}" needs a value`, `write ${key}=${Array.isArray(kind) ? kind[0] : kind === 'int' ? '12' : '…'}`);
  if (k === 0) {
    out.id = { text: t, loc: tok.loc };
    return;
  }
  // A word right after an unquoted `key=value` is most likely the rest of that value (`format=#.0 kWh`).
  const split = prev && /^([^=\s"]+)=([^"].*)$/.exec(prev.text);
  const fix = split && module.args[split[1]!] === 'string'
    ? `if it belongs to ${split[1]}=, quote the value: ${split[1]}="${split[2]} ${t}"`
    : `${argHelp}; the id goes right after the type`;
  diags.report('E108', tok.loc, `${type} has no arg "${t}"`, fix);
}

function describeArgs(module: BlockModule): string {
  const parts = Object.entries(module.args).map(([k, v]) =>
    v === 'flag' ? k : v === 'int' ? `${k}=N` : v === 'string' ? `${k}=…` : `${v.join(' | ')}`);
  return parts.length ? `args for ${module.type}: ${parts.join(', ')}` : `${module.type} takes no args, only an id, @region and a "caption"`;
}

function unquote(t: string): string {
  return t.startsWith('"') && t.endsWith('"') && t.length >= 2 ? t.slice(1, -1).replace(/\\(.)/g, '$1') : t;
}
