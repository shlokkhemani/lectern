/** Phrasing shared by diagnostics: nearest-name suggestions and descriptions of a block's items. */
import type { ItemDecl } from '../ir.ts';
import type { BlockInfo } from './model.ts';

const a = (noun: string) => `${/^[aeiou]/.test(noun) ? 'an' : 'a'} ${noun}`;

/** The candidate within edit distance 2 (or 1 for short words) of `word`, if any. */
export function closest(word: string, candidates: readonly string[]): string | undefined {
  let best: string | undefined;
  let bestD = word.length <= 3 ? 1 : 2;
  for (const c of candidates) {
    if (c === word) continue;
    const d = distance(word, c);
    if (d <= bestD && (best === undefined || d < distance(word, best))) {
      best = c;
      bestD = d;
    }
  }
  return best;
}

function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
  }
  return row[b.length]!;
}

/**
 * The items number selectors count on a block without integer keys: those of its first kind, so a grouped
 * chart's `ch:4` past its last row is unknown, never one of its bars.
 */
export function counted(info: BlockInfo): ItemDecl[] {
  const kind = info.decl.items[0]?.kind;
  return info.decl.items.filter(it => it.kind === kind);
}

/**
 * "has rows 1-4", its fix line ("use ex:1 … ex:4, or add a row to the table", naming how an item of another
 * kind is selected) and the numbers it spans.
 */
export function describeItems(info: BlockInfo): { has: string; fix: (name: string) => string; span?: [number, number] } {
  const type = info.decl.type;
  const numbered = info.intKeys
    ? info.decl.items.filter(it => /^\d+$/.test(it.key)).map(it => ({ n: Number(it.key), kind: it.kind }))
    : counted(info).map((it, i) => ({ n: i + 1, kind: it.kind }));
  if (!numbered.length) return { has: 'has no items', fix: name => `${type} has no items: target the whole block, ${name}` };
  const kind = numbered[0]!.kind;
  const lo = Math.min(...numbered.map(x => x.n));
  const hi = Math.max(...numbered.map(x => x.n));
  const has = lo === hi ? `has one ${kind}, ${lo}` : `has ${kind}s ${lo}-${hi}`;
  // Items of another kind are not numbered: name the first one by its key (a grouped chart's bar).
  const keyed = info.intKeys ? undefined : info.decl.items.find(it => it.kind !== kind);
  return {
    has,
    span: [lo, hi],
    fix: name =>
      `use ${lo === hi ? `${name}:${lo}` : `${name}:${lo} … ${name}:${hi}`}, or add ${a(kind)} to the ${type}${keyed ? `; ${a(keyed.kind)} is selected by its key, e.g. ${name}:${keyed.key}` : ''}`,
  };
}
