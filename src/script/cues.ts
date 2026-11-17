import type { BlockModule } from '../blocks/contract.ts';
import type { Cue, IdRef, ItemDecl, Loc, Region, Selector, Target, Verb } from '../ir.ts';
import type { Diagnostics } from './diagnostics.ts';
import { parseInline, topLevel } from './inline.ts';
import type { BlockInfo, Command, CueAt, CueSrc, SimpleVerb, TargetSrc } from './model.ts';
import { closest, counted, describeItems } from './hints.ts';

const SIMPLE: readonly SimpleVerb[] = ['show', 'hide', 'hl', 'dim', 'grow', 'focus'];
export const VERB_NAMES: readonly Verb[] = ['show', 'hide', 'hl', 'dim', 'set', 'move', 'grow', 'group', 'swap', 'focus'];
/**
 * Words that cannot be ids (E114): verbs and `none` (the cue grammar is `verb+ target+`), and block type names
 * as block ids (`::: code` would read as a declaration). Item and group names may be type names.
 */
export const isReserved = (word: string, modules: readonly BlockModule[], blockId = true): boolean =>
  (VERB_NAMES as readonly string[]).includes(word) || word === 'none' || (blockId && modules.some(m => m.type === word));
const ID = /^[a-z][a-z0-9-]*$/;

/**
 * The cue grammar (§1.5): `[cmd; cmd]`, where cmd is `verb+ target+`, `set target value`,
 * `move target n`, `group target label #id?` or `swap a b`. `;` inside backticks or braces does not split.
 */
export function readCue(cue: CueSrc, diags: Diagnostics, rejected: ReadonlySet<string> = new Set()): Command[] {
  const out: Command[] = [];
  for (const [start, end] of splitCommands(cue.inner.text)) {
    const cmd = cue.inner.slice(start, end).trimmed();
    const loc = cmd.loc(0);
    if (!cmd.text) {
      diags.report('E111', cue.loc, 'empty cue command', 'write a verb and a target, e.g. [show x], or remove the extra ";"');
      continue;
    }
    const toks = [...cmd.text.matchAll(/\S+/g)].map(m => ({ text: m[0], loc: cmd.loc(m.index), end: m.index + m[0].length }));
    const head = toks[0]!.text;
    const target = toks[1] ? { text: toks[1].text, loc: toks[1].loc } : undefined;
    const missingTarget = () =>
      diags.report('E111', loc, `"${head}" has no target`, `name what it acts on, e.g. [${head} x${head === 'set' ? ' new value' : head === 'move' ? ' 3' : head === 'group' ? ':2-4 label' : head === 'swap' ? ' y' : ''}]`);

    switch (head) {
      case 'set': {
        if (!target) { missingTarget(); break; }
        const value = cmd.slice(toks[1]!.end).trimmed();
        if (!value.text) {
          diags.report('E302', loc, `set "${target.text}" has no value`, `write the new content after the target: [set ${target.text} new value]`);
          break;
        }
        out.push({ verb: 'set', target, value: parseInline(value, diags), loc });
        break;
      }
      case 'move': {
        if (!target) { missingTarget(); break; }
        // What a position means depends on the block, so it is checked once the target resolves.
        out.push({ verb: 'move', target, to: toks.slice(2).map(t => ({ text: t.text, loc: t.loc })), loc });
        break;
      }
      case 'group': {
        if (!target) { missingTarget(); break; }
        let rest = cmd.slice(toks[1]!.end).trimmed();
        let groupId: { id: string; loc: Loc } | undefined;
        const named = /(^|\s)#(\S+)$/.exec(rest.text);
        if (named) {
          const id = named[2]!;
          const idLoc = rest.loc(named.index + named[1]!.length);
          if (ID.test(id)) groupId = { id, loc: idLoc };
          else diags.report('E113', idLoc, `group id "#${id}" is not a valid id`, `ids are lowercase letters, digits and "-", starting with a letter: #${slugId(id)}`);
          rest = rest.slice(0, named.index).trimmed();
        }
        if (!rest.text) {
          diags.report('E306', loc, `group "${target.text}" has no label`, `write the label after the target: [group ${target.text} arg 0]`);
          break;
        }
        out.push({ verb: 'group', target, label: rest.text, ...(groupId ? { groupId } : {}), loc });
        break;
      }
      case 'swap': {
        if (toks.length !== 3) {
          diags.report('E304', loc, `swap needs exactly two targets, got ${toks.length - 1}`, 'write [swap out in] for two blocks, or [swap x:1 x:3] for two items of one block');
          break;
        }
        out.push({ verb: 'swap', targets: [target!, { text: toks[2]!.text, loc: toks[2]!.loc }], loc });
        break;
      }
      default: {
        const verbs: SimpleVerb[] = [];
        let k = 0;
        for (; k < toks.length && (SIMPLE as readonly string[]).includes(toks[k]!.text); k++) {
          const v = toks[k]!.text as SimpleVerb;
          if (!verbs.includes(v)) verbs.push(v);
        }
        if (!verbs.length) {
          const guess = closest(head, VERB_NAMES) ?? (head.startsWith('high') ? 'hl' : undefined);
          diags.report('E111', loc, `unknown verb "${head}"`, `${guess ? `did you mean "${guess}"? ` : ''}verbs are: ${VERB_NAMES.join(' ')}`);
          break;
        }
        const targets = toks.slice(k);
        const at = targets.findIndex(t => (VERB_NAMES as readonly string[]).includes(t.text));
        const special = targets[at];
        if (special) {
          const rest = targets.slice(at + 1).map(t => t.text);
          // The first command keeps the targets written before the second verb ([show a set b two]); with none,
          // it acts on the second's target ([show set a two]).
          const before = at > 0 ? targets.slice(0, at).map(t => t.text) : rest.slice(0, 1);
          // A verb with targets after it is a second command; a verb alone in target position was meant as an
          // id, which a block cannot have (its declaration already got E114 if it tried).
          if (rest.length)
            diags.report('E111', special.loc, `"${special.text}" cannot be combined with other verbs`, `split the command: [${verbs.join(' ')} ${before.join(' ')}; ${special.text} ${rest.join(' ')}]`);
          else if (!rejected.has(special.text))
            diags.report('E111', special.loc, `"${special.text}" is a verb, so it cannot be an id`, `write the id of the block to ${verbs.join(' ')} here; a block named "${special.text}" must be renamed, e.g. "${special.text}-1"`);
          break;
        }
        if (!targets.length) { missingTarget(); break; }
        for (const verb of verbs) out.push({ verb, targets: targets.map(t => ({ text: t.text, loc: t.loc })), loc });
      }
    }
  }
  return out;
}

/** [start, end) ranges of `;`-separated commands (the shared scanner skips `;` in backticks, braces, escapes). */
function splitCommands(s: string): [number, number][] {
  const out: [number, number][] = [];
  let start = 0;
  for (const i of topLevel(s, 0, ';')) {
    out.push([start, i]);
    start = i + 1;
  }
  out.push([start, s.length]);
  return out;
}

function slugId(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^[^a-z]+/, '') || 'x';
}

/** What target resolution can see: global ids, blocks, and the blocks placed in the current scene. */
export interface Scope {
  ids: ReadonlyMap<string, IdRef>;
  /** Item names declared in more than one block: they resolve only qualified, as `block:name`. */
  ambiguous: ReadonlyMap<string, readonly { block: string; loc: Loc }[]>;
  blocks: ReadonlyMap<string, BlockInfo>;
  /** Blocks on screen in the current scene, in reading order. */
  placed: readonly string[];
  regions: ReadonlyMap<string, Region>;
  modules: readonly BlockModule[];
  /** Ids whose declaration was rejected (already reported E114 or E202): their uses are not checked again. */
  rejected: ReadonlySet<string>;
}

/**
 * `id`, `id:selector` or a global item/group name → a Target on a placed block.
 * Selector parts: `n`, `n-m`, an item key, or a marker name (alone). Returns undefined after reporting.
 * `none` is the caller's business.
 */
export function resolveTarget(src: TargetSrc, scope: Scope, diags: Diagnostics): Target | undefined {
  const colon = src.text.indexOf(':');
  const name = colon < 0 ? src.text : src.text.slice(0, colon);
  const selText = colon < 0 ? undefined : src.text.slice(colon + 1);
  const ref = scope.ids.get(name);
  const shared = scope.ambiguous.get(name);
  if (!ref && shared) {
    // Suggest the block on screen when exactly one of them is.
    const here = shared.filter(s => scope.placed.includes(s.block));
    const pick = (here.length === 1 ? here : shared)[0]!.block;
    diags.report('E206', src.loc, `"${name}" names an item in ${shared.length} blocks: ${shared.map(s => `"${s.block}" (line ${s.loc.line})`).join(', ')}`,
      `qualify it with its block: write "${pick}:${name}"`);
    return undefined;
  }
  // A name whose declaration was rejected (reserved, or clashing: E114, E202) was reported once there.
  if (scope.rejected.has(name)) return undefined;
  if (!ref) {
    const guess = closest(name, [...scope.placed, ...[...scope.ids.keys()].filter(k => !k.startsWith('_'))]);
    // Naming the scene's blocks shows that the part before ":" is a block id (round 5: "ch:" read as a chart prefix).
    const here = guess || !scope.placed.length ? '' : `; this scene's blocks are ${scope.placed.map(b => `${b} (${scope.blocks.get(b)!.decl.type})`).join(', ')}`;
    const first = scope.placed[0]!;
    diags.report('E201', src.loc, `unknown target "${src.text}"${here}`, guess ? `did you mean "${guess}"?`
      : isReserved(name, scope.modules) ? `"${name}" is a reserved word and cannot be an id: declare the block as e.g. "${name}-1" and use that`
      : here && selText !== undefined ? `write the block's id before the ":", e.g. ${first}:${selText}, or declare "${name}" first, e.g. "::: text ${name}"`
      : here ? `use one of them, e.g. ${first}, or declare "${name}" first, e.g. "::: text ${name}"`
      : `declare it first, e.g. "::: text ${name}", or check the spelling`);
    return undefined;
  }
  const info = scope.blocks.get(ref.block)!;
  if (!scope.placed.includes(ref.block)) {
    const what = ref.kind === 'block' ? `"${name}"` : `"${name}" (in "${ref.block}")`;
    diags.report('E205', src.loc, `${what} is not on screen in this scene; "${ref.block}" is declared at line ${info.decl.loc.line}`,
      `re-place it in this scene with a line "::: ${ref.block}"`);
    return undefined;
  }
  // A block whose body failed has already been reported; nothing that depends on it is checked.
  if (info.broken) return undefined;
  if (ref.kind !== 'block') {
    if (selText !== undefined) {
      diags.report('E201', src.loc, `"${name}" is ${ref.kind === 'item' ? 'an item' : 'a group'}; selectors apply to blocks`, `write just "${name}", or "${ref.block}:${selText}"`);
      return undefined;
    }
    return { block: ref.block, sel: { kind: 'items', keys: ref.kind === 'item' ? [ref.item] : ref.items }, loc: src.loc };
  }
  if (selText === undefined) return { block: ref.block, sel: { kind: 'block' }, loc: src.loc };
  const sel = resolveSelector(info, name, selText, src, diags);
  return sel && { block: ref.block, sel, loc: src.loc };
}

function resolveSelector(info: BlockInfo, name: string, text: string, src: TargetSrc, diags: Diagnostics): Selector | undefined {
  const parts = text.split(',');
  if (parts.some(p => !p)) {
    diags.report('E111', src.loc, `selector "${src.text}" has an empty part`, `write items like ${name}:2 or ${name}:2-4,6`);
    return undefined;
  }
  const marker = parts.find(p => info.markers.includes(p));
  if (marker) {
    if (parts.length > 1) {
      diags.report('E111', src.loc, `marker "${marker}" cannot be combined with items in "${src.text}"`, `write ${name}:${marker} on its own`);
      return undefined;
    }
    return { kind: 'marker', name: marker };
  }
  const items = info.decl.items;
  const keys = new Set<string>();
  const unknown = (part: string) => {
    const desc = describeItems(info);
    diags.report('E201', src.loc, `unknown target "${name}:${part}"; ${info.decl.type} "${name}" (line ${info.decl.loc.line}) ${desc.has}`, desc.fix(name));
  };
  for (const part of parts) {
    const range = /^(\d+)-(\d+)$/.exec(part);
    if (range) {
      const a = Number(range[1]);
      const b = Number(range[2]);
      if (b < a) {
        diags.report('E111', src.loc, `range "${part}" runs backwards`, `write ${name}:${b}-${a}`);
        return undefined;
      }
      for (const end of [a, b]) if (!byNumber(info, end)) { unknown(String(end)); return undefined; }
      for (const it of items) if (numberOf(info, it) !== undefined && numberOf(info, it)! >= a && numberOf(info, it)! <= b) keys.add(it.key);
      continue;
    }
    // An item's name works as its selector too (`t:total` for a row named #total).
    const it = /^\d+$/.test(part) ? byNumber(info, Number(part)) : info.byKey.get(part) ?? items.find(i => i.name === part);
    if (!it) {
      unknown(part);
      return undefined;
    }
    keys.add(it.key);
  }
  return { kind: 'items', keys: items.filter(it => keys.has(it.key)).map(it => it.key) };
}

/** The selector number of an item: its integer key on int-keyed blocks, else its place among the counted items. */
function numberOf(info: BlockInfo, it: ItemDecl): number | undefined {
  if (!info.intKeys) { const i = counted(info).indexOf(it); return i < 0 ? undefined : i + 1; }
  return /^\d+$/.test(it.key) ? Number(it.key) : undefined;
}

function byNumber(info: BlockInfo, n: number): ItemDecl | undefined {
  return info.intKeys ? info.byKey.get(String(n)) : counted(info)[n - 1];
}

/** Whether a key set is one run of neighbouring items of one kind (a table's cells sit between its rows). */
function contiguous(info: BlockInfo, keys: readonly string[]): boolean {
  const idx = keys.map(k => info.byKey.get(k)!.index).sort((a, b) => a - b);
  const kind = info.byKey.get(keys[0]!)!.kind;
  const span = info.decl.items.filter(it => it.index >= idx[0]! && it.index <= idx[idx.length - 1]! && it.kind === kind);
  return span.length === idx.length;
}

/**
 * `move` on one item that slides (`Movers`): E305 when the item cannot move, E303 when the position is not one
 * the block takes. The position is checked against where the item was declared; the scene pass resolves it again
 * against where the item then stands (a closed path only goes forward), so the IR's `to` is absolute.
 */
function moveItem(loc: Loc, t: Target, written: string, pos: TargetSrc | undefined, info: BlockInfo, texts: string[],
  noPosition: (fix: string) => undefined, diags: Diagnostics): CueAt | undefined {
  const keys = t.sel.kind === 'items' ? t.sel.keys : [];
  const as = { target: written, block: t.block };
  if (keys.length !== 1) {
    const each = keys.map(k => `move ${t.block}:${k} ${pos?.text ?? '…'}`).join('; ');
    return void diags.report('E305', t.loc, `move "${written}" names ${keys.length} items; move slides one`, `write one command per item: [${each}]`);
  }
  const key = keys[0]!;
  const movers = info.movers;
  const home = movers?.home[key];
  if (!movers || home === undefined) {
    const why = movers?.stop(key, pos?.text ?? '', 0, as);
    return void diags.report('E305', t.loc, typeof why === 'object' ? why.message : `move on "${written}": this item does not move`,
      typeof why === 'object' ? why.fix : `move works on a chart's points and on custom items with data-along`);
  }
  if (!pos) {
    const r = movers.stop(key, '', home, as);
    return noPosition(typeof r === 'object' ? r.fix : `write [move ${written} ${home}]`);
  }
  const to = movers.stop(key, pos.text, home, as);
  if (typeof to === 'object') return void diags.report('E303', pos.loc, to.message, to.fix);
  return { cue: { verb: 'move', targets: [t], to, loc }, texts, position: pos.text };
}

/** Does the block's module accept this verb on this selector kind? Engine-level verbs are always allowed. */
function supports(module: BlockModule, verb: Verb, kind: Selector['kind']): boolean {
  if (kind === 'none') return verb === 'hl' || verb === 'focus';
  if (verb === 'focus') return kind === 'block';
  if (verb === 'swap' && kind === 'block') return true;
  return module.verbs[verb]?.includes(kind) ?? false;
}

const KIND_EXAMPLE: Record<Selector['kind'], (b: string, marker?: string) => string> = {
  block: b => `the whole block (${b})`,
  items: b => `items (${b}:2)`,
  marker: (b, m) => (m ? `a marker (${b}:${m})` : 'a marker'),
  none: () => 'none',
};

/**
 * A parsed command → a resolved cue on this scene's blocks, checked against each block's verb table (E305),
 * with `none` expanded to every placed block. `groupId` is the id a group command creates (named or `_g<n>`).
 * Returns undefined when nothing valid is left.
 */
export function resolveCommand(cmd: Command, scope: Scope, groupId: string | undefined, diags: Diagnostics): CueAt | undefined {
  const verb = cmd.verb;
  const checked = (src: TargetSrc): Target | undefined => {
    const t = resolveTarget(src, scope, diags);
    if (!t) return undefined;
    const info = scope.blocks.get(t.block)!;
    if (supports(info.module, verb, t.sel.kind)) return t;
    const name = `${info.decl.type} "${t.block}"`;
    // `none` is not a selector of this block ([hl none] clears every block), so it is never offered here.
    const accepted = ((verb === 'focus' ? ['block'] : (info.module.verbs[verb] ?? [])) as Selector['kind'][]).filter(k => k !== 'none');
    if (accepted.length) {
      diags.report('E305', src.loc, `${verb} on ${KIND_EXAMPLE[t.sel.kind](src.text).replace(/ \(.*\)$/, '')} is not supported by ${name}`,
        `${verb} on ${info.decl.type} takes ${accepted.map(k => KIND_EXAMPLE[k](t.block, info.markers[0])).join(' or ')}`);
    } else {
      const types = scope.modules.filter(m => m.verbs[verb]).map(m => m.type);
      const own = Object.keys(info.module.verbs).join(' ');
      diags.report('E305', src.loc, `verb "${verb}" is not supported by ${name}`,
        `${verb} works on ${types.join(', ') || 'no block type'}; ${info.decl.type} supports ${own}`);
    }
    return undefined;
  };
  const texts: string[] = [];
  const keep = (src: TargetSrc, t: Target | undefined): t is Target => {
    if (t) texts.push(src.text);
    return !!t;
  };

  switch (cmd.verb) {
    case 'set': {
      const t = checked(cmd.target);
      return keep(cmd.target, t) ? { cue: { verb: 'set', targets: [t], value: cmd.value, loc: cmd.loc }, texts } : undefined;
    }
    case 'move': {
      const t = checked(cmd.target);
      if (!keep(cmd.target, t)) return undefined;
      const info = scope.blocks.get(t.block)!;
      const written = cmd.target.text;
      const pos = cmd.to.length === 1 ? cmd.to[0]! : undefined;
      const noPosition = (fix: string) =>
        void diags.report('E303', cmd.to[1]?.loc ?? cmd.to[0]?.loc ?? cmd.loc, `move "${written}" needs one position to move to`, fix);
      if (t.sel.kind === 'items') return moveItem(cmd.loc, t, written, pos, info, texts, noPosition, diags);
      if (!info.markers.length) {
        diags.report('E305', cmd.target.loc, `${info.decl.type} "${t.block}" has no markers to move`, `declare them: ::: ${info.decl.type} ${t.block} markers=cur,peek`);
        return undefined;
      }
      const d = describeItems(info);
      if (!pos) return noPosition(`write [move ${written} ${d.span?.[1] ?? 1}]`);
      const item = /^\d+$/.test(pos.text) ? byNumber(info, Number(pos.text)) : undefined;
      if (!item) {
        const why = /^\d+$/.test(pos.text) ? '' : 'a marker moves to an item number; ';
        diags.report('E303', pos.loc, `move ${written} ${pos.text}: ${why}${info.decl.type} "${t.block}" ${d.has}`,
          d.span ? `use ${d.span[0] === d.span[1] ? `[move ${written} ${d.span[0]}]` : `[move ${written} ${d.span[0]}] … [move ${written} ${d.span[1]}]`}` : d.fix(t.block));
        return undefined;
      }
      return { cue: { verb: 'move', targets: [t], to: item.index, loc: cmd.loc }, texts, position: pos.text };
    }
    case 'group': {
      const t = checked(cmd.target);
      if (!keep(cmd.target, t) || t.sel.kind !== 'items' || !groupId) return undefined;
      if (!contiguous(scope.blocks.get(t.block)!, t.sel.keys)) {
        diags.report('E306', cmd.target.loc, `group "${cmd.target.text}" is not one contiguous range`, 'group one run of neighbouring items, e.g. 3-5; make two groups for two runs');
        return undefined;
      }
      return { cue: { verb: 'group', targets: [t], label: cmd.label, groupId, loc: cmd.loc }, texts };
    }
    case 'swap': {
      const [sa, sb] = cmd.targets;
      const a = resolveTarget(sa, scope, diags);
      const b = resolveTarget(sb, scope, diags);
      if (!a || !b) return undefined;
      const blocks = a.sel.kind === 'block' && b.sel.kind === 'block';
      const items = a.sel.kind === 'items' && b.sel.kind === 'items' && a.block === b.block && a.sel.keys.length === 1 && b.sel.keys.length === 1;
      if (blocks) {
        if (a.block === b.block) return void diags.report('E304', sb.loc, `swap "${sa.text}" with itself`, 'swap two different blocks');
        const ra = scope.regions.get(a.block);
        const rb = scope.regions.get(b.block);
        if (ra !== rb)
          return void diags.report('E304', sb.loc, `swap pairs share one slot, but "${a.block}" is @${ra} and "${b.block}" is @${rb}`, `place both in one region, e.g. "@${ra}" on "${b.block}"`);
      } else if (items) {
        if (!checked(sa)) return undefined;
      } else {
        return void diags.report('E304', cmd.loc, `swap "${sa.text}" "${sb.text}": swap two blocks, or two single items of one block`, 'write [swap out in] or [swap x:1 x:3]');
      }
      texts.push(sa.text, sb.text);
      return { cue: { verb: 'swap', targets: [a, b], loc: cmd.loc }, texts };
    }
    default: {
      const targets: Target[] = [];
      for (const src of cmd.targets) {
        if (src.text === 'none') {
          if (verb !== 'hl' && verb !== 'focus') {
            diags.report('E307', src.loc, `"${verb} none" does not exist`, '"none" clears: [hl none] clears highlights, [focus none] clears focus');
            continue;
          }
          for (const block of scope.placed) {
            targets.push({ block, sel: { kind: 'none' }, loc: src.loc });
            texts.push('none');
          }
          continue;
        }
        const t = checked(src);
        if (keep(src, t)) targets.push(t);
      }
      return targets.length ? { cue: { verb: cmd.verb, targets, loc: cmd.loc } as Cue, texts } : undefined;
    }
  }
}
