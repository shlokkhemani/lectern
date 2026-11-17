import type { BlockModule, BlockRuntime } from '../blocks/contract.ts';
import type { Beat, BlockDecl, Cue, Id, IdRef, Loc, Parse, Placement, Region, Scene, Word } from '../ir.ts';
import { declareBlock, type DeclaredBlock } from './blocks.ts';
import { isReserved, readCue, resolveCommand, type Scope } from './cues.ts';
import { Diagnostics } from './diagnostics.ts';
import { readFrontMatter } from './frontmatter.ts';
import { closest } from './hints.ts';
import { parseInline } from './inline.ts';
import type { BlockInfo, Command, CueAt } from './model.ts';
import { readParagraph, type WordSrc } from './narration.ts';
import { analyseScene, type Carry } from './scene.ts';
import { readStructure, type DeclSrc, type SceneSrc } from './structure.ts';

const ID = /^[a-z][a-z0-9-]*$/;
const MAX_SCENE_WORDS = 400;

interface BeatSrc { loc: Loc; start: Command[]; words: { src: WordSrc; commands: Command[] }[] }

/** `parse` over a given set of block modules. */
export function createParse(modules: readonly BlockModule[]): Parse {
  const registry = new Map(modules.map(m => [m.type, m]));

  return (text, file, read) => {
    const diags = new Diagnostics(file);
    const lines = text.replace(/^﻿/, '').split(/\r?\n/);
    const { meta, body } = readFrontMatter(lines, diags);
    const sources = readStructure(lines, body, w => registry.has(w), diags);

    const ids = new Map<Id, IdRef>();
    const idLocs = new Map<Id, Loc>();
    const blocks = new Map<Id, BlockInfo>();
    /**
     * Item names (`#name`, custom `data-id`) are scoped to their block: the same name may name an item in
     * several blocks. A name in exactly one block also resolves bare; the others resolve only qualified
     * (`block:name`), and a bare use is E206. Block and group ids stay unique, and distinct from item names.
     */
    const itemNames = new Map<string, { block: Id; item: string; loc: Loc }[]>();
    /** Ids whose declaration was rejected, reserved (E114) or clashing (E202): reported once, their uses not again. */
    const rejected = new Set<string>();
    const wellFormed = (id: string, loc: Loc, blockId: boolean): boolean => {
      if (!ID.test(id)) {
        const fixed = id.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^[^a-z]+/, '');
        diags.report('E113', loc, `"${id}" is not a valid id`, `ids are lowercase letters, digits and "-", starting with a letter${fixed ? `: write "${fixed}"` : ''}`);
        return false;
      }
      if (isReserved(id, modules, blockId)) {
        rejected.add(id);
        diags.report('E114', loc, `"${id}" is a reserved word and cannot be an id`, `pick another id, e.g. "${id}-1"`);
        return false;
      }
      return true;
    };
    /** Registers a block or group id; false (after reporting) if it is malformed, reserved or taken. */
    const claim = (id: string, loc: Loc, ref: IdRef): boolean => {
      if (!wellFormed(id, loc, ref.kind === 'block')) return false;
      const prev = idLocs.get(id);
      if (prev) {
        const blockTwice = ref.kind === 'block' && ids.get(id)?.kind === 'block';
        rejected.add(id);
        diags.report('E202', loc, `id "${id}" is already declared at line ${prev.line}`,
          blockTwice ? `rename one; to show the same block again in a later scene, write "::: ${id}" with no body` : 'rename one');
        return false;
      }
      const item = itemNames.get(id)?.[0];
      if (item) {
        rejected.add(id);
        diags.report('E202', loc, `id "${id}" is already an item name in "${item.block}" (line ${item.loc.line})`,
          'rename one: item names may repeat across blocks, but never as a block or group id');
        return false;
      }
      ids.set(id, ref);
      idLocs.set(id, loc);
      return true;
    };
    /** Registers an item name in its block. */
    const claimItem = (name: string, loc: Loc, block: Id, item: string): void => {
      if (!wellFormed(name, loc, false)) return;
      const prev = idLocs.get(name);
      if (prev) {
        rejected.add(name);
        diags.report('E202', loc, `item name "${name}" is already the id of a block at line ${prev.line}`,
          'rename the item: item names may repeat across blocks, but never as a block or group id');
        return;
      }
      const all = itemNames.get(name) ?? [];
      const same = all.find(n => n.block === block);
      if (same) {
        diags.report('E202', loc, `item name "${name}" is used twice in "${block}" (line ${same.loc.line})`, 'rename one');
        return;
      }
      itemNames.set(name, [...all, { block, item, loc }]);
      // Kept in declaration order with the other ids; a second block's use makes the bare name ambiguous.
      if (all.length) ids.delete(name);
      else ids.set(name, { kind: 'item', block, item });
    };

    // Declarations, file-wide first, so a reuse can tell "declared later" from "unknown".
    let anonBlocks = 0;
    const declIds = new Map<SceneSrc['blocks'][number], Id>();
    const declRegion = new Map<Id, Region>();
    sources.forEach((sc, k) => {
      for (const src of sc.blocks) {
        if (src.kind !== 'decl') continue;
        const module = registry.get(src.type) ?? unknownType(src, registry, diags);
        const d = module === UNKNOWN ? placeholder(src) : declareBlock(src, module, { lang: meta.lang }, read, diags);
        const named = d.id && claim(d.id.text, d.id.loc, { kind: 'block', block: d.id.text });
        const id = named && d.id ? d.id.text : `_b${++anonBlocks}`;
        if (!named) ids.set(id, { kind: 'block', block: id });
        const decl: BlockDecl = { id, type: src.type, loc: src.loc, scene: k, args: d.args, ...(d.caption !== undefined ? { caption: d.caption } : {}), body: d.body, items: d.items };
        const byKey = new Map(d.items.map(it => [it.key, it]));
        blocks.set(id, {
          decl,
          module,
          markers: d.broken ? [] : (module.markers?.(d.body, d.args) ?? []),
          ...(!d.broken && module.movers ? { movers: module.movers(d.body, d.args) } : {}),
          broken: d.broken,
          byKey,
          intKeys: d.items.some(it => /^\d+$/.test(it.key)),
        });
        declIds.set(src, id);
        declRegion.set(id, d.region);
        for (const it of d.items) if (it.name) claimItem(it.name, it.loc, id, it.key);
      }
    });
    const ambiguous = new Map([...itemNames].filter(([, all]) => all.length > 1));

    // Placements.
    const lastRegion = new Map<Id, Region>();
    const placementsOf = sources.map((sc, k) => {
      const placements: Placement[] = [];
      for (const src of sc.blocks) {
        let block: Id;
        let region: Region;
        if (src.kind === 'decl') {
          block = declIds.get(src)!;
          region = declRegion.get(block)!;
        } else {
          const ref = ids.get(src.id);
          const info = ref?.kind === 'block' ? blocks.get(ref.block) : undefined;
          if (!info) {
            if (rejected.has(src.id)) continue;   // its declaration was reported (E114)
            const guess = closest(src.id, [...registry.keys(), ...[...blocks.keys()].filter(b => !b.startsWith('_'))]);
            diags.report('E107', src.loc, `unknown block type or id "${src.id}"`,
              guess ? `did you mean "${guess}"?` : `block types are: ${[...registry.keys()].join(', ')}; to show a block again, declare it in an earlier scene`);
            continue;
          }
          block = info.decl.id;
          if (info.decl.scene > k) {
            diags.report('E203', src.loc, `"${src.id}" is reused here but declared later, at line ${info.decl.loc.line}`, 'move the declaration (with its body) here, and reuse it later with a bare "::: id" line');
            continue;
          }
          region = lastRegion.get(block) ?? declRegion.get(block)!;
          for (const tok of src.tokens) {
            const r = tok.text.slice(1);
            if (tok.text.startsWith('@') && (r === 'top' || r === 'left' || r === 'main')) region = r;
            else diags.report('E108', tok.loc, `a reuse line takes only @region; got "${tok.text}"`, `write "::: ${src.id}" or "::: ${src.id} @left"; args and body belong to the declaration`);
          }
        }
        const prev = placements.find(p => p.block === block);
        if (prev) {
          diags.report('E204', src.loc, `"${block}" is already on screen in this scene (line ${prev.loc.line})`, 'a block is placed at most once per scene; remove this line');
          continue;
        }
        lastRegion.set(block, region);
        placements.push({ block, region, reused: src.kind === 'reuse', loc: src.loc });
      }
      return placements;
    });

    // Narration and cue syntax, file-wide (anonymous group ids number in source order).
    let anonGroups = 0;
    const anonGroupId = new Map<Command, Id>();
    const beatsOf: BeatSrc[][] = sources.map(sc =>
      sc.paragraphs.map(p => {
        const para = readParagraph(p, meta.say, diags);
        const commands = (cues: typeof para.startCues) => cues.flatMap(c => readCue(c, diags, rejected));
        const beat: BeatSrc = { loc: para.loc, start: commands(para.startCues), words: para.words.map(w => ({ src: w, commands: commands(w.cues) })) };
        for (const cmd of [...beat.start, ...beat.words.flatMap(w => w.commands)])
          if (cmd.verb === 'group' && !cmd.groupId) anonGroupId.set(cmd, `_g${++anonGroups}`);
        return beat;
      }),
    );

    // Scenes, in order: each scene's groups register before its cues resolve.
    const carry = new Map<Id, Carry>();
    const regions = new Map<Id, Region>();
    const scenes: Scene[] = sources.map((sc, k) => {
      const placements = placementsOf[k]!;
      for (const p of placements) regions.set(p.block, p.region);
      const scope: Scope = { ids, ambiguous, blocks, placed: placements.map(p => p.block), regions, modules, rejected };
      const beatsSrc = beatsOf[k]!;
      const all = beatsSrc.flatMap(b => [...b.start, ...b.words.flatMap(w => w.commands)]);

      // Groups resolve first, once, so their ids can be targeted from anywhere in the scene.
      const groups = new Map<Command, CueAt | undefined>();
      for (const cmd of all) {
        if (cmd.verb !== 'group') continue;
        const id = cmd.groupId?.id ?? anonGroupId.get(cmd)!;
        const at = resolveCommand(cmd, scope, id, diags);
        groups.set(cmd, at);
        const target = at?.cue.targets[0];
        if (target?.sel.kind !== 'items') continue;
        const ref: IdRef = { kind: 'group', block: target.block, items: target.sel.keys };
        if (cmd.groupId) claim(id, cmd.groupId.loc, ref);
        else ids.set(id, ref);
      }

      const instants: CueAt[][] = [];
      const resolve = (cmds: Command[]): Cue[] => {
        const at = cmds.flatMap(c => (groups.has(c) ? groups.get(c) : resolveCommand(c, scope, undefined, diags)) ?? []);
        if (at.length) instants.push(at);
        return at.map(a => a.cue);
      };
      const beats: Beat[] = beatsSrc
        .filter(b => b.words.length)
        .map(b => {
          const startCues = resolve(b.start);
          const words: Word[] = b.words.map((w, i) => ({
            display: w.src.display,
            spoken: w.src.spoken,
            loc: w.src.loc,
            cues: resolve(w.commands),
            edge: i === 0 || i === b.words.length - 1,
          }));
          return { loc: b.loc, words, startCues };
        });

      const facts = analyseScene(placements, instants, blocks, carry, diags);

      if (!sc.paragraphs.length && !placements.length)
        diags.report('E401', sc.loc, 'scene has no narration and no block', 'add narration or a block, or remove the "##" line');
      const spoken = beats.reduce((n, b) => n + b.words.reduce((m, w) => m + w.spoken.length, 0), 0);
      if (spoken > MAX_SCENE_WORDS)
        diags.report('E420', sc.loc, `scene has ${spoken} spoken words, over the limit of ${MAX_SCENE_WORDS}`, 'split the scene: add a "##" line where the topic turns');

      return {
        index: k,
        loc: sc.loc,
        ...(sc.chapter ? { chapter: sc.chapter } : {}),
        ...(sc.headline ? { headline: parseInline(sc.headline, diags) } : {}),
        placements,
        swapSlots: facts.swapSlots,
        beats,
        initialVis: facts.initialVis,
        reachable: facts.reachable,
      };
    });

    const errors = diags.list();
    if (diags.failed) return { ir: null, errors };
    return {
      ir: {
        file,
        meta,
        blocks: Object.fromEntries([...blocks].map(([id, b]) => [id, b.decl])),
        ids: Object.fromEntries(ids),
        scenes,
      },
      errors,
    };
  };
}

const notMounted = (): never => { throw new Error('a block of unknown type is never mounted'); };

/**
 * Stands in for the module of a declaration whose type is unknown (`::: txt a` + body), so the typo is one
 * E107: its body is skipped, its id still resolves, and the block is broken (nothing that targets it is checked).
 */
const UNKNOWN: BlockModule = {
  type: '(unknown)', pack: 'core', args: {}, flexible: false, verbs: {},
  parse: () => ({ body: null, items: [] }),
  runtime: { mount: notMounted, measure: notMounted, render: notMounted } satisfies BlockRuntime<unknown>,
};

function unknownType(src: DeclSrc, registry: ReadonlyMap<string, BlockModule>, diags: Diagnostics): BlockModule {
  const guess = closest(src.type, [...registry.keys()]);
  diags.report('E107', src.loc, `unknown block type "${src.type}"`, guess ? `did you mean "${guess}"?` : `block types are: ${[...registry.keys()].join(', ')}`);
  return UNKNOWN;
}

/** A broken declaration of unknown type: keeps a well-formed first word as its id. */
function placeholder(src: DeclSrc): DeclaredBlock {
  const first = src.tokens[0];
  const id = first && ID.test(first.text) ? { text: first.text, loc: first.loc } : undefined;
  return { ...(id ? { id } : {}), args: {}, region: 'main', body: null, items: [], broken: true };
}
