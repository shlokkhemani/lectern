import type { Id, Inline, Loc, Placement, Reachable, Scene, Selector } from '../ir.ts';
import { VERBS } from '../verbs.ts';
import type { Diagnostics } from './diagnostics.ts';
import type { BlockInfo, CueAt } from './model.ts';

/** What a block keeps from one placement to the next (§1.5): item visibility, `set` values, shown markers, and where its markers and movers stand. */
export interface Carry {
  items: Record<string, boolean>;
  self?: Inline;
  content: Record<string, Inline>;
  markers: string[];
  /** Every marker's position (1-based item index), shown or not, and every mover's (`Movers` units). */
  at: Record<string, number>;
}

export interface SceneFacts {
  initialVis: Scene['initialVis'];
  reachable: Record<Id, Reachable>;
  swapSlots: [Id, Id][];
}

interface Touch { block: Id; self: boolean; items: string[]; reveal: boolean }
/** The cue that revealed a part in this scene (for W310). `whole`: a block-level cue, which reveals every item. */
interface ShownBy { verb: string; text: string; loc: Loc; whole: boolean }
/**
 * Symbolic state of one placed block. Receded parts (dim, or focus elsewhere) are visible but not at rest.
 * `shownBy` is keyed by item key, and '' for the block itself.
 */
interface Vis { self: boolean; items: Map<string, boolean>; markers: Set<string>; at: Map<string, number>; recededSelf: boolean; receded: Set<string>; shownBy: Map<string, ShownBy> }

/**
 * A scene's meaning, from its resolved cues in source order (`instants` groups cues that fire together).
 * - Visibility inference (§1.1): a thing starts hidden iff its first cue in the scene is show, grow or a
 *   swap-in. A block-level cue counts as a first cue for every item too, except move, focus and swap, which
 *   do not act on items (a block swap changes only block visibility). The block itself follows its first
 *   block-level cue: an item-level show hides only those items, and the block's other parts (a title's
 *   heading, a table's header) are visible with it. Without a block-level cue, a block whose items all start
 *   hidden starts hidden too, unless its other parts are content (`contentOutsideItems`): its frame (a panel,
 *   axes, a caption) appears with its first item. Reused blocks inherit item visibility (`carry`).
 * - The symbolic pass (§2): E301 hl/set/move on a hidden thing, E304 swap state, W310 show on a thing
 *   already visible and at rest (a show after dim or focus is a restore), W330 one hl replacing another on
 *   one block at the same instant.
 * - `reachable` contents, groups and marker positions, and the swap slots.
 * Updates `carry` to the scene's settled end state.
 */
export function analyseScene(
  placements: readonly Placement[],
  instants: readonly CueAt[][],
  blocks: ReadonlyMap<Id, BlockInfo>,
  carry: Map<Id, Carry>,
  diags: Diagnostics,
): SceneFacts {
  const cues = instants.flat();
  const placed = placements.map(p => p.block);
  const allKeys = (b: Id) => blocks.get(b)!.decl.items.map(it => it.key);

  // Inference.
  const firstSelf = new Map<Id, boolean>();
  const firstItem = new Map<Id, Map<string, boolean>>();
  for (const at of cues)
    for (const t of touches(at, allKeys)) {
      if (t.self && !firstSelf.has(t.block)) firstSelf.set(t.block, t.reveal);
      const m = firstItem.get(t.block) ?? new Map<string, boolean>();
      firstItem.set(t.block, m);
      for (const k of t.items) if (!m.has(k)) m.set(k, t.reveal);
    }

  const initialVis: Scene['initialVis'] = {};
  const state = new Map<Id, Vis>();
  for (const p of placements) {
    const inherited = p.reused ? carry.get(p.block) : undefined;
    const items: Record<string, boolean> = {};
    for (const k of allKeys(p.block)) items[k] = inherited ? (inherited.items[k] ?? true) : firstItem.get(p.block)?.get(k) !== true;
    // A frame with every item hidden would show empty: it appears with its first item instead.
    const info = blocks.get(p.block)!;
    const empty = !firstSelf.has(p.block) && !info.module.contentOutsideItems && info.decl.items.length > 0 && Object.values(items).every(v => !v);
    const self = firstSelf.get(p.block) !== true && !empty;
    initialVis[p.block] = { self, items };
    // A marker rests on item 1 until it moves (the runtime's base position), hidden until its first move. A
    // mover stands where it was declared.
    const at = new Map([
      ...info.markers.map(m => [m, inherited?.at[m] ?? 1] as const),
      ...Object.entries(info.movers?.home ?? {}).map(([k, h]) => [k, inherited?.at[k] ?? h] as const),
    ]);
    state.set(p.block, { self, items: new Map(Object.entries(items)), markers: new Set(inherited?.markers ?? []), at, recededSelf: false, receded: new Set(), shownBy: new Map() });
  }

  // Reachable starts from what reused blocks carry in.
  const reachable: Record<Id, Reachable> = {};
  for (const b of placed) {
    const c = carry.get(b);
    const r: Reachable = { self: [], items: {}, groups: [] };
    const isReused = placements.find(p => p.block === b)!.reused;
    if (c && isReused) {
      if (c.self) r.self.push(c.self);
      for (const [k, v] of Object.entries(c.content)) r.items[k] = [v];
    }
    reachable[b] = r;
  }
  const content = new Map<Id, { self?: Inline; items: Record<string, Inline> }>();
  for (const p of placements) {
    const c = p.reused ? carry.get(p.block) : undefined;
    content.set(p.block, { ...(c?.self ? { self: c.self } : {}), items: { ...(c?.content ?? {}) } });
  }

  // Marker positions: the shown markers at the start, then after every instant that changes them; movers too.
  const moverKeys = (b: Id) => Object.keys(blocks.get(b)!.movers?.home ?? {});
  const where = (b: Id) => {
    const s = state.get(b)!;
    return Object.fromEntries([...[...s.markers].map(m => [m, s.at.get(m)!] as const), ...moverKeys(b).map(k => [k, s.at.get(k)!] as const)]);
  };
  for (const b of placed) if (blocks.get(b)!.markers.length || moverKeys(b).length) reachable[b]!.markers = [where(b)];
  const lastOfInstant = new Set<number>();
  instants.reduce((end, inst) => { end += inst.length; if (inst.length) lastOfInstant.add(end - 1); return end; }, 0);

  const swapSlots: [Id, Id][] = [];
  const name = (at: CueAt, i: number) => at.texts[i] ?? at.cue.targets[i]?.block ?? '?';

  /** Loc of the next cue after position `from` that reveals this thing, if any. */
  const nextReveal = (from: number, block: Id, item?: string): Loc | undefined => {
    for (let j = from + 1; j < cues.length; j++)
      for (const t of touches(cues[j]!, allKeys))
        if (t.block === block && t.reveal && (item === undefined ? t.self : t.items.includes(item))) return cues[j]!.cue.loc;
    return undefined;
  };

  cues.forEach((at, pos) => {
    const { cue } = at;
    cue.targets.forEach((target, ti) => {
      const s = state.get(target.block);
      if (!s) return;
      const sel = target.sel;
      const keys = selKeys(sel, allKeys(target.block));
      const text = name(at, ti);

      const requireVisible = () => {
        const hiddenItem = sel.kind === 'items' ? keys.find(k => !s.items.get(k)) : undefined;
        const hiddenMarker = sel.kind === 'marker' && cue.verb !== 'move' && !s.markers.has(sel.name);
        if (s.self && hiddenItem === undefined && !hiddenMarker) return;
        if (hiddenMarker) {
          diags.report('E301', target.loc, `${cue.verb} on marker "${text}" before it is shown`, `markers appear on their first move: put [move ${target.block} n] before this cue`);
          return;
        }
        const later = nextReveal(pos, target.block, s.self ? hiddenItem : undefined);
        const shown = later ? `; it is first shown at ${later.line}:${later.col}` : '; nothing shows it in this scene';
        const fixCue = cue.verb === 'hl' ? `[show hl ${text}]` : cue.verb === 'set' ? `[show ${text}; set ${text} …]`
          : `[show ${sel.kind === 'items' ? text : target.block}; move ${text} ${at.position ?? '…'}]`;
        diags.report('E301', target.loc, `${cue.verb} on "${text}" while it is hidden${shown}`,
          later ? `move this cue after that show, or show it here instead of there: ${fixCue}` : `show it first: ${fixCue}`);
      };
      const reveal = () => {
        const atRest = s.self && !s.recededSelf && keys.every(k => s.items.get(k) && !s.receded.has(k));
        if (atRest && sel.kind !== 'marker') {
          const by = s.shownBy.get(sel.kind === 'items' ? keys[0]! : '');
          const shown = by ? `[${by.verb} ${by.text}] at ${by.loc.line}:${by.loc.col} already showed it` : 'it is visible from the scene\'s start';
          diags.report('W310', target.loc, `${cue.verb} on "${text}", which is already visible: ${shown}`, by?.whole && sel.kind === 'items'
            ? `a block-level ${by.verb} reveals all its items. To light it: [hl ${text}]. To reveal it here, hide it in the cue that shows the block: [${by.verb} ${by.text}; hide ${text}]`
            : `remove it, or use [hl ${text}] to point at it`);
        }
        const by: ShownBy = { verb: cue.verb, text, loc: target.loc, whole: sel.kind === 'block' };
        s.self = true;
        if (sel.kind === 'block') s.shownBy.set('', by);
        for (const k of keys) {
          s.items.set(k, true);
          s.receded.delete(k);
          s.shownBy.set(k, by);
        }
        if (sel.kind === 'block') s.recededSelf = false;
      };

      switch (cue.verb) {
        case 'show':
        case 'grow':
          reveal();
          break;
        case 'hide':
          if (sel.kind === 'marker') s.markers.delete(sel.name);
          else if (sel.kind === 'block') s.self = false;
          else for (const k of keys) s.items.set(k, false);
          break;
        case 'hl':
          if (sel.kind !== 'none') requireVisible();
          break;
        case 'set': {
          requireVisible();
          const r = reachable[target.block]!;
          const c = content.get(target.block)!;
          if (sel.kind === 'block') {
            addUnique(r.self, cue.value);
            c.self = cue.value;
          } else
            for (const k of keys) {
              addUnique((r.items[k] ??= []), cue.value);
              c.items[k] = cue.value;
            }
          break;
        }
        case 'move': {
          requireVisible(); // the block must be visible; the move itself reveals the marker
          if (sel.kind === 'items') {
            // A mover: the position as written, from where it stands now, is the absolute stop the IR carries.
            const key = keys[0]!;
            const to = blocks.get(target.block)!.movers?.stop(key, at.position ?? '', s.at.get(key) ?? 0, { target: text, block: target.block });
            if (typeof to === 'number') { cue.to = to; s.at.set(key, to); }
            break;
          }
          const names = blocks.get(target.block)!.markers;
          // A marker goes to the item; a block-level move shifts every marker by the first one's step.
          if (sel.kind === 'marker') s.at.set(sel.name, cue.to);
          else if (names.length) {
            const d = cue.to - s.at.get(names[0]!)!;
            const n = blocks.get(target.block)!.byKey.size;
            const off = names.find(m => s.at.get(m)! + d < 1 || s.at.get(m)! + d > n);
            if (off) {
              const lands = s.at.get(off)! + d;
              diags.report('E303', target.loc, `[move ${text} ${cue.to}] puts marker "${off}" on item ${lands}; "${target.block}" has items 1-${n}`,
                lands > n ? `give it an end item to rest on (e.g. an EOF token), or move "${names[0]}" alone: [move ${target.block}:${names[0]} ${cue.to}]`
                  : `move "${names[0]}" alone: [move ${target.block}:${names[0]} ${cue.to}]`);
              break;
            }
            for (const m of names) s.at.set(m, s.at.get(m)! + d);
          }
          for (const m of sel.kind === 'marker' ? [sel.name] : names) s.markers.add(m);
          break;
        }
        case 'group': {
          const info = blocks.get(target.block)!;
          const idx = keys.map(k => info.byKey.get(k)!.index);
          reachable[target.block]!.groups.push({ id: cue.groupId, from: Math.min(...idx), to: Math.max(...idx), label: cue.label });
          break;
        }
        case 'swap':
          if (ti === 1 && sel.kind === 'block') {
            const [a, b] = cue.targets;
            const sa = state.get(a.block)!;
            if (!sa.self) diags.report('E304', a.loc, `swap takes "${a.block}" out, but it is not on screen here`, `swap a visible block out: the first target goes out, the second comes in`);
            if (s.self) diags.report('E304', target.loc, `swap brings "${b.block}" in, but it is already visible`, `the incoming block must be hidden; did you mean [swap ${b.block} ${a.block}]?`);
            sa.self = false;
            s.self = true;
            s.shownBy.set('', { verb: 'swap', text: `${a.block} ${b.block}`, loc: cue.loc, whole: false });
            if (!swapSlots.some(([x, y]) => (x === a.block && y === b.block) || (x === b.block && y === a.block))) swapSlots.push([a.block, b.block]);
          }
          break;
        case 'dim':
          if (sel.kind === 'block') s.recededSelf = true;
          else for (const k of keys) s.receded.add(k);
          break;
        case 'focus':
          // Every other placed block recedes; `none` (one target per block) clears all recession by focus.
          for (const [b, other] of state) {
            if (sel.kind === 'none') other.recededSelf = false;
            else other.recededSelf = b !== target.block;
          }
          break;
      }
    });
    if (lastOfInstant.has(pos))
      for (const b of placed) {
        const list = reachable[b]!.markers;
        if (!list) continue;
        const now = where(b);
        if (JSON.stringify(now) !== JSON.stringify(list.at(-1))) list.push(now);
      }
  });

  for (const instant of instants) warnSameChannel(instant, diags);

  for (const b of placed) {
    const s = state.get(b)!;
    const c = content.get(b)!;
    carry.set(b, { items: Object.fromEntries(s.items), ...(c.self ? { self: c.self } : {}), content: c.items, markers: [...s.markers], at: Object.fromEntries(s.at) });
  }
  return { initialVis, reachable, swapSlots };
}

/** The things a cue's targets touch, for inference. `none` touches nothing. */
function touches(at: CueAt, allKeys: (b: Id) => string[]): Touch[] {
  const { cue } = at;
  const out: Touch[] = [];
  cue.targets.forEach((t, i) => {
    if (t.sel.kind === 'none') return;
    const reachesItems = t.sel.kind === 'block' && cue.verb !== 'move' && cue.verb !== 'focus' && cue.verb !== 'swap';
    const reveal = cue.verb === 'show' || cue.verb === 'grow' || (cue.verb === 'swap' && i === 1 && t.sel.kind === 'block');
    const items = t.sel.kind === 'items' ? t.sel.keys : reachesItems ? allKeys(t.block) : [];
    out.push({ block: t.block, self: t.sel.kind === 'block', items, reveal });
  });
  return out;
}

function selKeys(sel: Selector, all: string[]): string[] {
  return sel.kind === 'items' ? sel.keys : sel.kind === 'block' ? all : [];
}

/** W330: two hl cues on one block at one instant: hl is exclusive per block, so the second replaces the first. */
function warnSameChannel(instant: readonly CueAt[], diags: Diagnostics): void {
  const lit = instant.flatMap(at =>
    VERBS[at.cue.verb].writes.includes('hl') ? at.cue.targets.filter(t => t.sel.kind !== 'none').map((t, i) => ({ at, t, text: at.texts[i] ?? t.block })) : []);
  for (let j = 1; j < lit.length; j++)
    for (let i = 0; i < j; i++) {
      const a = lit[i]!;
      const b = lit[j]!;
      if (a.t.block !== b.t.block || a.at === b.at) continue;
      diags.report('W330', b.t.loc, `hl "${b.text}" replaces hl "${a.text}" at the same instant (hl is exclusive per block)`, `highlight both in one target, e.g. [hl ${mergeHint(a.text, b.text)}], or move one cue to another word`);
      return;
    }
}

function mergeHint(a: string, b: string): string {
  const [ba, sa] = a.split(':');
  const [bb, sb] = b.split(':');
  return ba === bb && sa && sb ? `${ba}:${sa},${sb}` : `${a} ${b}`;
}

function addUnique(list: Inline[], v: Inline): void {
  const k = JSON.stringify(v);
  if (!list.some(x => JSON.stringify(x) === k)) list.push(v);
}
