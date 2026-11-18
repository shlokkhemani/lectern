/**
 * Every diagnostic an agent can hit, through `lectern check`: the code printed at the right script line, with the
 * message and fix the agent reads; and a fix written in script syntax, applied literally, makes `check` pass.
 * Schema errors (E1xx–E4xx, W1xx–W3xx) stop at G1, before any browser; layout findings (L4xx) come from
 * test/scripts/lint.md and lint2.md, one scene per case.
 */
import { describe, expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { SCRIPTS, cacheHome, lectern, issues, limited, tmp, type Run } from './e2e.ts';

/** A script with minimal front matter around `body`. */
const script = (body: string) => `---\ntitle: T\n---\n${body}`;

/** A line chart with a point named `ball` on x 0..4, and an orbit with `earth` on it (each 4 lines, then `:::`). */
const ROLL = '::: chart roll\nx: 0 1 2 3 4\nloss: 9 4 1 0 1\npoint loss 0 #ball\n:::\n';
const SKY = '::: custom sky\n<svg viewBox="0 0 760 320"><ellipse id="orbit" cx="380" cy="160" rx="240" ry="110" fill="none"/>\n<circle data-id="earth" data-along="orbit" cx="620" cy="160" r="10"/>\n</svg>\n:::\n';
const long = Array.from({ length: 401 }, () => 'word').join(' ') + '.';

let root: string, xdg: string, n = 0;
/** `lectern check t.md --no-audio` on `text`, in a fresh directory holding `files` beside it. */
async function check(text: string, files: Record<string, string> = {}, args: string[] = []): Promise<Run & { printed: string }> {
  root ??= tmp('diag');
  xdg ??= await cacheHome();
  const dir = path.join(root, String(n++));
  mkdirSync(dir);
  writeFileSync(path.join(dir, 't.md'), text);
  for (const [f, body] of Object.entries(files)) writeFileSync(path.join(dir, f), body);
  const r = await lectern(['check', 't.md', '--no-audio', '--out', 'out', ...args], { xdg, cwd: dir });
  // The issue lines as printed: each finding and its fix, before the length and gate lines.
  const printed = r.out.split('\n').filter(l => /^t\.md:\d/.test(l) || l.startsWith('  fix: ')).join('\n');
  return { ...r, printed };
}
const codes = (r: Run) => issues(r.out).map(i => i.code);
/** Many checks at once: each spawns its own CLI (and, past G1, its own Chrome). */
const all = <T,>(jobs: (() => Promise<T>)[]) => limited(8, jobs);

const FIXTURES: Record<string, { text: string; expect: string; fixed?: [string, string, string?] }> = {
  E101: {
    text: '---\ntitle: T\n##\nHi.',
    expect: "t.md:1:1: error E101: front matter is not closed\n  fix: add a line \"---\" after the last front matter key",
  },
  E102: {
    text: '---\ntitle: T\ncolour: red\n---\n##\nHi.',
    expect: "t.md:3:1: error E102: unknown front matter key \"colour\"\n  fix: use one of: title, series, lang, voice, theme, say",
  },
  'E102 theme': {
    text: '---\ntitle: T\ntheme: sepia\n---\n##\nHi.',
    expect: "t.md:3:1: error E102: unknown theme \"sepia\"\n  fix: write \"theme: dark\" or \"theme: paper\"",
    fixed: ['sepia', 'paper'],
  },
  E103: {
    text: '---\nseries: S\n---\n##\nHi.',
    expect: "t.md:1:1: error E103: the script has no title\n  fix: start the file with front matter: a \"---\" line, \"title: <video title>\", and a closing \"---\"",
  },
  E104: {
    text: script('Hello there.\n##\nHi.'),
    expect: "t.md:4:1: error E104: narration before the first scene\n  fix: add a line \"##\" (or \"## headline\") above it to start a scene",
  },
  E105: {
    text: script('##\n::: text a\nx\nHi.'),
    expect: "t.md:5:1: error E105: block \"text\" is not closed\n  fix: add a line \":::\" after its last body line",
  },
  E106: {
    text: script('##\n:::\nHi.'),
    expect: "t.md:5:1: error E106: \":::\" closes no block\n  fix: remove it, or check the block above for a missing opening \"::: type id\" line",
  },
  'E106 src': {
    text: script('##\n::: custom c src=a.svg\n<svg viewBox="0 0 10 10"><rect width="5" height="5"/></svg>\n:::\nHi.'),
    expect: "t.md:5:14: error E106: custom takes its content from src=a.svg, so it has no body and no closing \":::\"\n  fix: remove \"src=a.svg\" to keep the body, or delete the body and its \":::\"",
    fixed: [' src=a.svg', '', 'remove "src=a.svg"'],
  },
  E107: {
    text: script('##\n::: txt a\nx := (1)\n:::\n[hl a] Hi.'),
    expect: "t.md:5:1: error E107: unknown block type \"txt\"\n  fix: did you mean \"text\"?",
  },
  E108: {
    text: script('##\n::: code c lnag=go\nx\n:::\nHi.'),
    expect: "t.md:5:12: error E108: code has no arg \"lnag\"\n  fix: args for code: lang=…, from=N, diff, src=…, name=…",
    fixed: ['lnag=go', 'lang=go', 'lang=…'],
  },
  'E108 quote': {
    text: script('##\n::: chart c format=#.0 kWh\na: 1\n:::\nHi.'),
    expect: "t.md:5:24: error E108: chart has no arg \"kWh\"\n  fix: if it belongs to format=, quote the value: format=\"#.0 kWh\"",
    fixed: ['format=#.0 kWh', 'format="#.0 kWh"'],
  },
  'E108 no args': {
    text: script('##\n::: callout c ok\nIt works.\n:::\nHi.'),
    expect: "t.md:5:15: error E108: callout has no arg \"ok\"\n  fix: callout takes no args, only an id, @region and a \"caption\"; the id goes right after the type",
  },
  E109: {
    text: script('##\nHi.\n<!-- a note'),
    expect: "t.md:6:1: error E109: comment is not closed\n  fix: add \"-->\" where the comment ends",
  },
  E110: {
    text: script('##\n[show a Hi.'),
    expect: "t.md:5:1: error E110: cue is not closed\n  fix: add \"]\" where the cue ends; a \"]\" inside backticks or braces does not count",
  },
  E111: {
    text: script('##\n::: text a\nx\n:::\n[highlight a] Hi.'),
    expect: "t.md:8:2: error E111: unknown verb \"highlight\"\n  fix: did you mean \"hl\"? verbs are: show hide hl dim set move grow group swap focus",
    fixed: ['[highlight a]', '[hl a]', '"hl"'],
  },
  'E111 two verbs': {
    text: script('##\n::: text a\nx\n:::\n[show set a two] Hi.'),
    expect: "t.md:8:7: error E111: \"set\" cannot be combined with other verbs\n  fix: split the command: [show a; set a two]",
    fixed: ['[show set a two]', '[show a; set a two]'],
  },
  'E111 targets before the second verb': {
    text: script('##\n::: text a\nx\n:::\n::: text b\ny\n:::\n[show a set b two] Hi.'),
    expect: "t.md:11:9: error E111: \"set\" cannot be combined with other verbs\n  fix: split the command: [show a; set b two]",
    fixed: ['[show a set b two]', '[show a; set b two]'],
  },
  'E111 verb as id': {
    text: script('##\n::: text a\nx\n:::\n[show swap] Hi.'),
    expect: "t.md:8:7: error E111: \"swap\" is a verb, so it cannot be an id\n  fix: write the id of the block to show here; a block named \"swap\" must be renamed, e.g. \"swap-1\"",
  },
  E112: {
    text: script('##\n::: text a\n{em x\n:::\nHi.'),
    expect: "t.md:6:1: error E112: \"{em\" is not closed\n  fix: add \"}\" to close it; braces inside a mark must balance, or escape a literal one as \\{",
  },
  E113: {
    text: script('##\n::: text Ab\nx\n:::\nHi.'),
    expect: "t.md:5:10: error E113: \"Ab\" is not a valid id\n  fix: ids are lowercase letters, digits and \"-\", starting with a letter: write \"ab\"",
    fixed: ['text Ab', 'text ab', '"ab"'],
  },
  E114: {
    text: script('##\n::: text show\nx\n:::\nHi.'),
    expect: "t.md:5:10: error E114: \"show\" is a reserved word and cannot be an id\n  fix: pick another id, e.g. \"show-1\"",
    fixed: ['text show', 'text show-1', '"show-1"'],
  },
  E115: {
    text: script('##\n### deeper\nHi.'),
    expect: "t.md:5:1: error E115: \"###\" is not a heading here\n  fix: use \"# chapter\" or \"## scene headline\"; there are no deeper levels",
  },
  W120: {
    text: script('##\n::: text a\n*Parameters* are names\n:::\nHi.'),
    expect: "t.md:6:1: warning W120: \"*Parameters*\" shows its asterisks: the script has no Markdown emphasis\n  fix: write {em Parameters}",
  },
  E201: {
    text: script('##\n::: table ex\n| a | b |\n| c | d |\n| e | f |\n| g | h |\n:::\n[hl ex:5] Hi.'),
    expect: "t.md:11:5: error E201: unknown target \"ex:5\"; table \"ex\" (line 5) has rows 1-4\n  fix: use ex:1 … ex:4, or add a row to the table",
    fixed: ['[hl ex:5]', '[hl ex:4]', 'ex:4'],
  },
  'E201 marker': {
    text: script('##\n::: code lex\nx := 1\ny := 2\n:::\n[hl lex:cur] Hi.'),
    expect: "t.md:9:5: error E201: unknown target \"lex:cur\"; code \"lex\" (line 5) has lines 1-2\n  fix: use lex:1 … lex:2, or add a line to the code",
    fixed: ['[hl lex:cur]', '[hl lex:2]', 'lex:2'],
  },
  'E201 grouped chart': {
    text: script('##\n::: chart sky\nseries: noon sunset\nblue: 80 2\nred: 96 24\ngreen: 50 10\n:::\n[hl sky:4] Hi.'),
    expect: "t.md:11:5: error E201: unknown target \"sky:4\"; chart \"sky\" (line 5) has rows 1-3\n  fix: use sky:1 … sky:3, or add a row to the chart; a bar is selected by its key, e.g. sky:blue.noon",
    fixed: ['[hl sky:4]', '[hl sky:3]', 'sky:3'],
  },
  'E201 grouped bar': {
    text: script('##\n::: chart sky\nseries: noon sunset\nblue: 80 2\nred: 96 24\n:::\n[hl sky:blue.dusk] Hi.'),
    expect: "t.md:10:5: error E201: unknown target \"sky:blue.dusk\"; chart \"sky\" (line 5) has rows 1-2\n  fix: use sky:1 … sky:2, or add a row to the chart; a bar is selected by its key, e.g. sky:blue.noon",
    fixed: ['sky:blue.dusk', 'sky:blue.noon'],
  },
  'E201 block': {
    text: script('##\n::: chart sky\nblue: 80\n:::\n::: text note\nx\n:::\n[hl ch:blue] Hi.'),
    expect: "t.md:11:5: error E201: unknown target \"ch:blue\"; this scene's blocks are sky (chart), note (text)\n  fix: write the block's id before the \":\", e.g. sky:blue, or declare \"ch\" first, e.g. \"::: text ch\"",
    fixed: ['ch:blue', 'sky:blue'],
  },
  'E201 no items': {
    text: script('##\n::: callout c\nx\n:::\n[hl c:1] Hi.'),
    expect: "t.md:8:5: error E201: unknown target \"c:1\"; callout \"c\" (line 5) has no items\n  fix: callout has no items: target the whole block, c",
    fixed: ['[hl c:1]', '[hl c]', 'whole block, c'],
  },
  E202: {
    text: script('##\n::: text a\nx\n:::\n::: callout a\ny\n:::\nHi.'),
    expect: "t.md:8:13: error E202: id \"a\" is already declared at line 5\n  fix: rename one; to show the same block again in a later scene, write \"::: a\" with no body",
  },
  E203: {
    text: script('##\n::: a\nHi.\n\n##\n::: text a\nx\n:::\nHi.'),
    expect: "t.md:5:1: error E203: \"a\" is reused here but declared later, at line 9\n  fix: move the declaration (with its body) here, and reuse it later with a bare \"::: id\" line",
  },
  E204: {
    text: script('##\n::: text a\nx\n:::\n::: a\nHi.'),
    expect: "t.md:8:1: error E204: \"a\" is already on screen in this scene (line 5)\n  fix: a block is placed at most once per scene; remove this line",
  },
  E205: {
    text: script('##\n::: text a\nx\n:::\nHi.\n\n##\n[hl a] Hi.'),
    expect: "t.md:11:5: error E205: \"a\" is not on screen in this scene; \"a\" is declared at line 5\n  fix: re-place it in this scene with a line \"::: a\"",
    fixed: ['\n##\n[hl a]', '\n##\n::: a\n[hl a]', '::: a'],
  },
  E206: {
    text: script('##\n::: bullets a\n- x #n\n:::\n::: bullets b\n- y #n\n:::\n[hl n] Hi.'),
    expect: "t.md:11:5: error E206: \"n\" names an item in 2 blocks: \"a\" (line 6), \"b\" (line 9)\n  fix: qualify it with its block: write \"a:n\"",
    fixed: ['[hl n]', '[hl a:n]', 'a:n'],
  },
  E213: {
    text: script('##\n::: code c src=parser.go:1-3\nHi.'),
    expect: "t.md:5:1: error E213: src file \"parser.go\" not found\n  fix: give the path relative to the script's directory",
  },
  E301: {
    text: script('##\n::: callout fnote\nx\n:::\n[hide fnote] Hi [hl fnote] there [show fnote] now.'),
    expect: "t.md:8:21: error E301: hl on \"fnote\" while it is hidden; it is first shown at 8:35\n  fix: move this cue after that show, or show it here instead of there: [show hl fnote]",
    fixed: ['[hl fnote] there [show fnote]', '[show hl fnote] there', '[show hl fnote]'],
  },
  E302: {
    text: script('##\n::: text a\nx\n:::\n[set a] Hi.'),
    expect: "t.md:8:2: error E302: set \"a\" has no value\n  fix: write the new content after the target: [set a new value]",
    fixed: ['[set a]', '[set a new value]'],
  },
  'E301 move': {
    text: script(`##\n${ROLL}[hide ball] A [move ball 2] b.`),
    expect: "t.md:10:21: error E301: move on \"ball\" while it is hidden; nothing shows it in this scene\n  fix: show it first: [show ball; move ball 2]",
    fixed: ['[move ball 2]', '[show ball; move ball 2]'],
  },
  E303: {
    text: script('##\n::: tokens tk markers=cur,peek\na b c\n:::\n[move tk 5] Hi.'),
    expect: "t.md:8:10: error E303: move tk 5: tokens \"tk\" has tokens 1-3\n  fix: use [move tk 1] … [move tk 3]",
    fixed: ['[move tk 5]', '[move tk 3]'],
  },
  'E303 no position': {
    text: script('##\n::: tokens tk markers=cur\na b c\n:::\n[move tk] Hi.'),
    expect: "t.md:8:2: error E303: move \"tk\" needs one position to move to\n  fix: write [move tk 3]",
    fixed: ['[move tk]', '[move tk 3]'],
  },
  'E303 no position on a chart': {
    text: script(`##\n${ROLL}[move ball] Hi.`),
    expect: "t.md:10:2: error E303: move \"ball\" needs one position to move to\n  fix: write [move ball 4]",
    fixed: ['[move ball]', '[move ball 4]'],
  },
  'E303 no position on a path': {
    text: script(`##\n${SKY}[move earth 0.25 0.5] Hi.`),
    expect: "t.md:10:18: error E303: move \"earth\" needs one position to move to\n  fix: write [move earth 1]",
    fixed: ['[move earth 0.25 0.5]', '[move earth 1]'],
  },
  'E303 marker': {
    text: script('##\n::: tokens tk markers=lo,hi\na b c d\n:::\n[move tk:hi 2.5] Hi.'),
    expect: "t.md:8:13: error E303: move tk:hi 2.5: a marker moves to an item number; tokens \"tk\" has tokens 1-4\n  fix: use [move tk:hi 1] … [move tk:hi 4]",
    fixed: ['[move tk:hi 2.5]', '[move tk:hi 4]'],
  },
  'E303 chart x': {
    text: script(`##\n${ROLL}[move ball 4.5] Hi.`),
    expect: "t.md:10:12: error E303: move ball 4.5: chart \"roll\" has x from 0 to 4\n  fix: use an x label or a number between them, e.g. [move ball 4]; to go further, add x labels",
    fixed: ['[move ball 4.5]', '[move ball 4]'],
  },
  'E303 chart labels': {
    text: script('##\n::: chart sales\nx: Jan Feb Mar\nunits: 3 5 4\npoint units Jan #dot\n:::\n[move dot Apr] Hi.'),
    expect: "t.md:10:11: error E303: move dot Apr: \"Apr\" is not an x label of chart \"sales\"\n  fix: use one of: Jan Feb Mar, e.g. [move dot Mar]",
    fixed: ['[move dot Apr]', '[move dot Mar]'],
  },
  'E303 path': {
    text: script(`##\n${SKY}[move earth halfway] Hi.`),
    expect: "t.md:10:13: error E303: move earth halfway: a position on a path is a number from 0 (its start) to 1 (its end)\n  fix: write [move earth 0.5]",
    fixed: ['[move earth halfway]', '[move earth 0.5]'],
  },
  E304: {
    text: script('##\n::: text a @left\nx\n:::\n::: text b\ny\n:::\n[swap a b] Hi.'),
    expect: "t.md:11:9: error E304: swap pairs share one slot, but \"a\" is @left and \"b\" is @main\n  fix: place both in one region, e.g. \"@left\" on \"b\"",
    fixed: ['::: text b\n', '::: text b @left\n', '"@left"'],
  },
  E305: {
    text: script('##\n::: text tck\n—\n:::\n[move tck 1] Hi.'),
    expect: "t.md:8:7: error E305: verb \"move\" is not supported by text \"tck\"\n  fix: move works on code, tokens, custom, chart; text supports show hide hl dim set",
  },
  'E305 chart series': {
    text: script(`##\n${ROLL}[move roll:loss 2] Hi.`),
    expect: "t.md:10:7: error E305: move on series \"loss\": a chart moves its points\n  fix: move the point: [move roll:point1 2]",
    fixed: ['[move roll:loss 2]', '[move roll:point1 2]'],
  },
  'E305 chart without a point': {
    text: script('##\n::: chart roll\nx: 0 1 2 3 4\nloss: 9 4 1 0 1\n:::\n[move roll:loss 2] Hi.'),
    expect: "t.md:9:7: error E305: move on series \"loss\": a chart moves its points\n  fix: add the line \"point loss 0 #ball\" to the chart, then write [move ball 2]",
    fixed: ['loss: 9 4 1 0 1\n:::\n[move roll:loss 2]', 'loss: 9 4 1 0 1\npoint loss 0 #ball\n:::\n[move ball 2]', 'add the line "point loss 0 #ball" to the chart, then write [move ball 2]'],
  },
  'E305 bar': {
    text: script('##\n::: chart ch\nGo: 40\nRust: 30\n:::\n[move ch:Go 2] Hi.'),
    expect: "t.md:9:7: error E305: move on bar \"Go\": bars do not move\n  fix: change its value instead: [set ch:Go 40]",
    fixed: ['[move ch:Go 2]', '[set ch:Go 40]'],
  },
  'E305 custom without a path': {
    text: script('##\n::: custom pump\n<svg viewBox="0 0 200 100"><line id="stroke" x1="20" y1="50" x2="180" y2="50"/><rect data-id="piston" x="10" y="40" width="20" height="20"/></svg>\n:::\n[move piston 1] Hi.'),
    expect: "t.md:8:7: error E305: move on \"piston\" needs a path to move along\n  fix: give the element with data-id=\"piston\" data-along=\"ID\", the id of a line or path in the same SVG that runs from where it is to where it goes",
    fixed: ['<rect data-id="piston"', '<rect data-id="piston" data-along="stroke"', 'data-along="ID"'],
  },
  'E305 two items': {
    text: script(`##\n${SKY}[move sky:earth,moon 0.5] Hi.`.replace('</svg>', '<circle data-id="moon" data-along="orbit" cx="620" cy="160" r="4"/></svg>')),
    expect: "t.md:10:7: error E305: move \"sky:earth,moon\" names 2 items; move slides one\n  fix: write one command per item: [move sky:earth 0.5; move sky:moon 0.5]",
    fixed: ['[move sky:earth,moon 0.5]', '[move sky:earth 0.5; move sky:moon 0.5]'],
  },
  'E305 selector': {
    text: script('##\n::: code lex\nx := 1\ny := 2\n:::\n[move lex:2 1] Hi.'),
    expect: "t.md:9:7: error E305: move on items is not supported by code \"lex\"\n  fix: move on code takes the whole block (lex) or a marker (lex:ptr)",
    fixed: ['[move lex:2 1]', '[move lex:ptr 1]', 'lex:ptr'],
  },
  'E305 hl on a marker': {
    text: script('##\n::: code lex\nx := 1\ny := 2\n:::\n[hl lex:ptr] Hi.'),
    expect: "t.md:9:5: error E305: hl on a marker is not supported by code \"lex\"\n  fix: hl on code takes the whole block (lex) or items (lex:2)",
    fixed: ['[hl lex:ptr]', '[hl lex:2]', 'items (lex:2)'],
  },
  'E305 no markers': {
    text: script('##\n::: tokens tk\na b\n:::\n[move tk 2] Hi.'),
    expect: "t.md:8:7: error E305: tokens \"tk\" has no markers to move\n  fix: declare them: ::: tokens tk markers=cur,peek",
    fixed: ['::: tokens tk\n', '::: tokens tk markers=cur,peek\n', '::: tokens tk markers=cur,peek'],
  },
  E306: {
    text: script('##\n::: tokens tk\na b c d\n:::\n[group tk:1,3 args] Hi.'),
    expect: "t.md:8:8: error E306: group \"tk:1,3\" is not one contiguous range\n  fix: group one run of neighbouring items, e.g. 3-5; make two groups for two runs",
  },
  E307: {
    text: script('##\n::: text a\nx\n:::\n[show none] Hi.'),
    expect: "t.md:8:7: error E307: \"show none\" does not exist\n  fix: \"none\" clears: [hl none] clears highlights, [focus none] clears focus",
    fixed: ['[show none]', '[hl none]'],
  },
  W310: {
    text: script('##\n::: text a\nx\n:::\n[hl a] Hi [show a] there.'),
    expect: "t.md:8:17: warning W310: show on \"a\", which is already visible: it is visible from the scene's start\n  fix: remove it, or use [hl a] to point at it",
    fixed: ['[show a]', '[hl a]'],
  },
  'W310 block shown': {
    text: script('##\n::: bullets c\n- x #point1\n- y\n:::\n[show c] Hi [show c:point1] there.'),
    expect: "t.md:9:19: warning W310: show on \"c:point1\", which is already visible: [show c] at 9:7 already showed it\n  fix: a block-level show reveals all its items. To light it: [hl c:point1]. To reveal it here, hide it in the cue that shows the block: [show c; hide c:point1]",
    fixed: ['[show c:point1]', '[hl c:point1]'],
  },
  // r6-newton: the reader who meant "reveal it later" gets that reading too.
  'W310 reveal later': {
    text: script('##\n::: bullets c\n- x #point1\n- y\n:::\n[show c] Hi [show c:point1] there.'),
    expect: "t.md:9:19: warning W310: show on \"c:point1\", which is already visible: [show c] at 9:7 already showed it\n  fix: a block-level show reveals all its items. To light it: [hl c:point1]. To reveal it here, hide it in the cue that shows the block: [show c; hide c:point1]",
    fixed: ['[show c]', '[show c; hide c:point1]'],
  },
  W330: {
    text: script('##\n::: bullets b\n- x\n- y\n:::\n[hl b:1; hl b:2] Hi.'),
    expect: "t.md:9:13: warning W330: hl \"b:2\" replaces hl \"b:1\" at the same instant (hl is exclusive per block)\n  fix: highlight both in one target, e.g. [hl b:1,2], or move one cue to another word",
    fixed: ['[hl b:1; hl b:2]', '[hl b:1,2]'],
  },
  E401: {
    text: script('##\n##\nHi.'),
    expect: "t.md:4:1: error E401: scene has no narration and no block\n  fix: add narration or a block, or remove the \"##\" line",
  },
  E402: {
    text: script('##\n::: text a\nx\n:::\nHi. [hl a]'),
    expect: "t.md:8:5: error E402: cue has no word after it in this paragraph\n  fix: put it before a word, or on its own line directly above the next paragraph",
  },
  E411: {
    text: script('##\nThen `(` comes.'),
    expect: "t.md:5:6: error E411: \"`(`\" in narration cannot be spoken reliably\n  fix: write \"the open bracket\" instead; backticks in narration hold only letters, digits, \".\" and \"_\"",
    fixed: ['`(`', 'the open bracket'],
  },
  E412: {
    text: script('##\nWe call add(2, 3) now.'),
    expect: "t.md:5:9: error E412: \"add(2, 3)\" cannot be spoken reliably\n  fix: write it as natural speech, e.g. \"add of 2 and 3\"",
    fixed: ['add(2, 3)', 'add of 2 and 3'],
  },
  E420: {
    text: script(`##\n${long}`),
    expect: "t.md:4:1: error E420: scene has 401 spoken words, over the limit of 400\n  fix: split the scene: add a \"##\" line where the topic turns",
  },
};

const codeOf = (key: string) => key.split(' ')[0]!;

/** The blocks the selector and cue rows below act on. */
const BLOCKS = `##
::: table t
| h1 | h2 |
|---|---|
| a | b |
| c | d | #named
| e | f |
:::
::: tokens tk markers=cur,peek
a ( 1 , 2 )
:::
::: code c from=10
x := 1
... gap
y := 2
z := 3
:::
::: stack frame
Outer #outer
  ret: nil #ret
Inner
  x: 1
:::
::: text other
y
:::
`;
const cue = (c: string) => script(`${BLOCKS}${c} Word.`);
const BL = '::: bullets b\n- one\n- two\n:::\n';
const text = (line: string) => script(`##\n::: text a\n${line}\n:::\n[set a ${line}] Hi.`);
const narrate = (prose: string) => script(`##\n::: text a\nx\n:::\n${prose}`);
const custom = (markup: string) => script(`##\n::: custom c\n${markup}\n:::\nHi.`);
const words = (k: number) => Array.from({ length: k }, () => 'w').join(' ');

/* Minimal images, built byte by byte: only the structure the engine's frame counter reads. */
const b64 = (bytes: number[]) => btoa(String.fromCharCode(...bytes));
const ascii = (s: string) => [...s].map(c => c.charCodeAt(0));
const be32 = (k: number) => [(k >>> 24) & 255, (k >>> 16) & 255, (k >>> 8) & 255, k & 255];
const le32 = (k: number) => [k & 255, (k >>> 8) & 255, (k >>> 16) & 255, (k >>> 24) & 255];
const gifFrame = [0x21, 0xf9, 4, 0, 10, 0, 0, 0, 0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 0x44, 0x01, 0];
const gif = (frames: number) => b64([...ascii('GIF89a'), 1, 0, 1, 0, 0x80, 0, 0, 0, 0, 0, 255, 255, 255, ...Array(frames).fill(gifFrame).flat(), 0x3b]);
const pngChunk = (type: string, data: number[]) => [...be32(data.length), ...ascii(type), ...data, 0, 0, 0, 0];
const png = (frames?: number) => b64([0x89, ...ascii('PNG'), 13, 10, 26, 10, ...pngChunk('IHDR', Array(13).fill(0)),
  ...(frames ? pngChunk('acTL', [...be32(frames), ...be32(0)]) : []), ...pngChunk('IDAT', [0]), ...pngChunk('IEND', [])]);
const riff = (type: string, data: number[]) => [...ascii(type), ...le32(data.length), ...data];
const webp = (frames: number) => {
  const chunks = [...riff('VP8X', Array(10).fill(0)), ...(frames > 1 ? riff('ANIM', Array(6).fill(0)) : []), ...Array(frames).fill(riff(frames > 1 ? 'ANMF' : 'VP8L', Array(16).fill(0))).flat()];
  return b64([...ascii('RIFF'), ...le32(4 + chunks.length), ...ascii('WEBP'), ...chunks]);
};
const img = (kind: string, data: string) => `<img src="data:image/${kind};base64,${data}" width="8" height="8">`;

const PAIR = `<svg viewBox="0 0 300 80">
  <g data-id="a"><rect x="0" y="0" width="120" height="60"/><text x="60" y="38" text-anchor="middle" font-size="20">left</text></g>
  <path data-id="link" d="M120 30 H180"/>
  <g data-id="b"><rect x="180" y="0" width="120" height="60"/><text x="240" y="38" text-anchor="middle" font-size="20">right</text></g>
</svg>`;
const fromFile = (body = '') => script(`##\n::: custom f src=pair.svg\n${body}[show f] Hi.`);

/**
 * Rejections: [what, script, the codes printed, a message or fix the report must contain (optional), files].
 * Each stops at G1, so it is cheap; it pins what the agent is told and where.
 */
type Rejection = [string, string, string[], string?, Record<string, string>?];
const REJECTED: Rejection[] = [
  // Selectors and cues
  ['row past the table', cue('[hl t:4]'), ['E201'], 'unknown target "t:4"; table "t" (line 5) has rows 1-3'],
  ['range from 0', cue('[hl tk:0-2]'), ['E201'], 'unknown target "tk:0"; tokens "tk" (line 12) has tokens 1-6'],
  ['backwards range', cue('[hl t:3-1]'), ['E111'], 'range "3-1" runs backwards'],
  ['empty selector part', cue('[hl t:1,]'), ['E111'], 'selector "t:1," has an empty part'],
  ['marker mixed with items', cue('[hl tk:cur,2]'), ['E111'], 'marker "cur" cannot be combined with items in "tk:cur,2"'],
  ['marker on a table', cue('[hl t:cur]'), ['E201'], 'unknown target "t:cur"; table "t" (line 5) has rows 1-3'],
  ['selector on an item', cue('[hl named:1]'), ['E201'], '"named" is an item; selectors apply to blocks'],
  ['unknown id', cue('[hl tx]'), ['E201'], 'unknown target "tx"'],
  ['move on token items', cue('[move tk:2 3]'), ['E305'], 'move on items is not supported by tokens "tk"'],
  ['move past the strip', cue('[move tk 9]'), ['E303'], 'move tk 9: tokens "tk" has tokens 1-6'],
  ['move on text', cue('[move other 1]'), ['E305'], 'verb "move" is not supported by text "other"'],
  ['group on a marker', cue('[group tk:cur x]'), ['E305'], 'group on a marker is not supported by tokens "tk"'],
  ['group without a label', cue('[group tk:2-3]'), ['E306'], 'group "tk:2-3" has no label'],
  ['focus on items', cue('[focus t:1]'), ['E305'], 'focus on items is not supported by table "t"'],
  ['code lines by displayed number', cue('[hl c:1]'), ['E201']],
  ['a typo suggests the nearest id', cue('[hl othr]'), ['E201'], 'did you mean "other"?'],
  ['empty cue', cue('[]'), ['E111']],
  ['verb without target', cue('[show]'), ['E111']],
  ['set combined', cue('[show set t x]'), ['E111']],
  ['unknown verb', cue('[highlight t]'), ['E111']],
  ['swap of one', cue('[swap t]'), ['E304']],
  ['swap across blocks', cue('[swap t:1 tk:1]'), ['E304']],
  ['move without position', cue('[move tk]'), ['E303']],
  ['move to a word', cue('[move tk two]'), ['E303']],
  ['dim none', cue('[dim none]'), ['E307']],
  ['a block move pushing a marker past the strip', script('##\n::: tokens fl markers=cur,peek\na b c d e\n:::\n[move fl 1; move fl:peek 2] Hi [move fl 5] there.'), ['E303'], '[move fl 5] puts marker "peek" on item 6; "fl" has items 1-5'],
  // Inline marks
  ...['`open', '{alt open', '``', '{box }', '`{em x`'].map((l): Rejection => [`unclosed mark ${l}`, script(`##\n::: text a\n${l}\n:::\nHi.`), ['E112']]),
  // Narration that cannot be spoken
  ...([['`(`', 'the open bracket'], ['`)`', 'the closing bracket'], ['`==`', 'equals equals'], ['`+`', 'plus'], ['`add(2, 3)`', 'add of 2 and 3'], ['`x + y`', 'x plus y']] as const)
    .map(([code, say]): Rejection => [`backticks ${code}`, narrate(`Then ${code} comes.`), ['E411'], `fix: write "${say}" instead`]),
  ...['(', ')', '{', '}', '<', '>', '=', '*', '/', '+', '|', ']'].map((ch): Rejection => [`"${ch}" in prose`, narrate(`One ${ch} two.`), ['E412']]),
  ['operators become words', narrate('Then a + b = c.'), ['E412'], 'write it as natural speech, e.g. "a plus b equals c."'],
  ['a call in prose', narrate('So f(1, 2 * 3) works.'), ['E412'], 'write it as natural speech, e.g. "f of 1 and 2 times 3"'],
  ['a mark in prose', narrate('A {em big} deal.'), ['E412']],
  ['symbols in backticks', narrate('The `a*b` part.'), ['E411']],
  ['401 spoken words', script(`##\n${words(401)}.`), ['E420']],
  ['identifiers count per spoken word', script(`##\n${words(399)} \`parseCall\``), ['E420']],
  // The symbolic pass
  ['hl after hide', script(`##\n${BL}[hide b] A [hl b:1] b.`), ['E301']],
  ['set on a hidden item', script(`##\n${BL}[hide b:2] A [set b:2 x] b.`), ['E301']],
  ['hl after swap-out', script('##\n::: text a\nx\n:::\n::: text b\ny\n:::\n[swap a b] A [hl a] b.'), ['E301']],
  ['an item hidden earlier stays hidden', script(`##\n${BL}[hide b:2] A.\n\n##\n::: b\n[hl b:2] B.`), ['E301']],
  ['tokens do not hl markers', script('##\n::: tokens tk markers=cur,peek\na b c\n:::\n[hl tk:cur] A.'), ['E305']],
  ['show on visible', script(`##\n${BL}[hl b:1] A [show b:1] b.`), ['W310']],
  ['swap into a visible block', script('##\n::: text a\nx\n:::\n::: text b\ny\n:::\n[hl b] A [swap a b] b.'), ['E304']],
  ['swap twice', script('##\n::: text a\nx\n:::\n::: text b\ny\n:::\n[swap a b] A [swap a b] b.'), ['E304', 'E304']],
  ['item named like its block', script('##\n::: text a\nx #a\n:::\nHi.'), ['E202']],
  ['group named like a block', script('##\n::: tokens tk\na b\n:::\n[group tk:1 g #tk] Hi.'), ['E202'], 'E202: id "tk" is already declared at line 5'],
  ...['text', 'hl', 'none'].map((w): Rejection => [`reserved id ${w}`, script(`##\n::: callout ${w}\nx\n:::\nHi.`), ['E114']]),
  ['a verb as an item name', script('##\n::: bullets b\n- x #hl\n:::\nHi.'), ['E114']],
  ['a reserved block id is reported once (DH "swap")', script('##\n::: text map\nx\n:::\n::: sequence swap\na -> b: hi\n:::\n[show swap:1] A [hl swap:a] b [dim swap:1-2] c.\n\n##\n::: swap\n[hl swap:b] D.'), ['E114']],
  ['a reserved block id is reported once (DNS "trace")', script('##\n::: terminal trace\n$ dig\nok\n:::\n[hl trace:1] A [hl trace:2] b.'), ['E114']],
  ['a clashing id is reported once (r4-sky)', script('##\n::: custom skies\n<svg viewBox="0 0 200 100"><g data-id="noon"><rect width="10" height="10"/></g></svg>\n:::\n[hl noon] Noon.\n\n##\n::: custom noon\n<svg viewBox="0 0 200 100"><rect width="10" height="10"/></svg>\n:::\n[hl noon] Again. [show noon] And again.'), ['E202']],
  ['a block declared twice is reported once', script('##\n::: text a\nx\n:::\n[hl a] One.\n\n##\n::: text a\ny\n:::\n[hl a] Two.'), ['E202']],
  ['no fix suggests a reserved word', script('##\n::: text a\nx\n:::\n[hl table] Hi.'), ['E201'], 'table-1'],
  ['swap keeps item visibility', script(`##\n${BL}[hide b:2] A.\n\n##\n::: text a\nx\n:::\n::: b\n[swap a b] B [hl b:2] c.`), ['E301']],
  ['an unterminated block ends at the next scene', script('##\n::: text a\nx\n\n##\nThen `(` comes.\n\n##\n[hl nope] Hi.'), ['E105', 'E411', 'E201']],
  ['a mistyped type is one E107', script('##\n::: txt a\nadd(2, 3) {em x\n:::\n[hl a] Hi.'), ['E107']],
  ['a mistyped type without id', script('##\n::: txt\nx\n:::\nHi.'), ['E107']],
  ['an unknown bare word', script('##\n::: nope\nHi.'), ['E107'], 'unknown block type or id "nope"'],
  ['cues on a broken block add nothing', script('##\n::: code c src=missing.go\n[move c 1; hl c:3; set c x] Hi.'), ['E213']],
  ['a sourced name error is at the declaration', script('##\n::: code c src=f.go:2-3 name=2:show\nHi.'), ['E114'], 't.md:5:', { 'f.go': 'a\nb\nc\n' }],
  ['show after hl, focus none', script(`##\n${BL}::: text a\nx\n:::\n[hl b] One [focus a] two [focus none] three [show b] four.`), ['W310']],
  ['parsing continues after an error', script('##\n::: txt a\nx\n:::\nHi [hl b] there.\n\n##\nThen `(` comes.'), ['E107', 'E201', 'E411']],
  // Item names and ids
  ['two items alike in one block', script('##\n::: bullets b\n- x #n\n- y #n\n:::\nHi.'), ['E202']],
  ['two data-ids alike in one drawing', script('##\n::: custom c\n<div data-id="n">a</div><div data-id="n">b</div>\n:::\nHi.'), ['E150']],
  ['a group named like an item', script('##\n::: tokens tk\na b\n:::\n::: bullets b\n- y #g\n:::\n[group tk:1 one #g] Hi.'), ['E202']],
  // Motion
  ['move on a hidden point', script(`##\n${ROLL}[hide ball] A [move ball 1.5] b.`), ['E301'], 'fix: show it first: [show ball; move ball 1.5]'],
  ['move on a hidden drawing', script(`##\n${SKY}[hide sky] A [move earth 0.5] b.`), ['E301'], 'fix: show it first: [show earth; move earth 0.5]'],
  ['move on a hidden strip', script('##\n::: tokens tk markers=cur\na b c\n:::\n[hide tk] A [move tk 2] b.'), ['E301'], 'fix: show it first: [show tk; move tk 2]'],
  // Block bodies
  ['trace duplicate name', script('##\n::: trace tr\na = 1\na = 2\n:::\nHi.'), ['E136']],
  ['trace without =', script('##\n::: trace tr\njust text\n:::\nHi.'), ['E136']],
  ['checklist without a box', script('##\n::: checklist c\n- a\n:::\nHi.'), ['E130']],
  ['graph edge to an unknown node', script('##\n::: graph g\na: A\na -> c\n:::\nHi.'), ['E133']],
  ['graph self loop', script('##\n::: graph g\na: A\na -> a\n:::\nHi.'), ['E133']],
  ['chart series too short', script('##\n::: chart c\nx: a b c\ns: 1 2\n:::\nHi.'), ['E137']],
  ['chart old "line" line', script('##\n::: chart c\nline\nx: a b c\ns: 1 2 3\n:::\nHi.'), ['E137'], 'remove the "line" line'],
  ['chart value with a unit', script('##\n::: chart c\na: 1ms\n:::\nHi.'), ['E137']],
  ['chart x line second', script('##\n::: chart c\nsimple: 1 2 3\nx: a b c\n:::\nHi.'), ['E137'], '"x: 0 5 10"'],
  ['chart series without x', script('##\n::: chart c\nsimple: 10 13.5 17\n:::\nHi.'), ['E137'], 'x: 0 5 10'],
  ['chart currency', script('##\n::: chart c\na: $76,123\n:::\nHi.'), ['E137'], 'format=$'],
  ['chart point on no series', script('##\n::: chart c\nx: a b\ns: 1 2\npoint t b\n:::\nHi.'), ['E137'], 'name one of: s'],
  ['chart mark off the axis', script('##\n::: chart c\nx: a b\ns: 1 2\nmark c\n:::\nHi.'), ['E137'], 'a b'],
  ['chart bad format', script('##\n::: chart c format=x#y#\na: 1\n:::\nHi.'), ['E137']],
  ['sequence message to itself', script('##\n::: sequence s\nA | B\nA -> A: x\n:::\nHi.'), ['E143'], 'note'],
  ['sequence unknown participant', script('##\n::: sequence s\nA | B\nA -> C: x\n:::\nHi.'), ['E143'], 'A, B'],
  ['sequence stray words', script('##\n::: sequence s\nA | B\njust words\n:::\nHi.'), ['E143'], '->'],
  ['sequence without messages', script('##\n::: sequence s\nA | B\nA: idle\n:::\nHi.'), ['E130']],
  // Custom: the allowlist
  ...[
    '<script>alert(1)</script>', '<div onclick="x()">a</div>', '<svg><animate attributeName="x"/></svg>', '<svg><set attributeName="x"/></svg>',
    '<svg><foreignObject></foreignObject></svg>', '<iframe src="x"></iframe>', '<object></object>', '<embed>', '<video></video>', '<audio></audio>',
    '<img src="https://example.com/a.png">', '<svg><use href="https://example.com/s.svg#a"/></svg>', '<svg><rect style="fill: url(https://example.com/p)"/></svg>',
    '<div style="animation: spin 1s">a</div>', '<div style="transition-duration: 1s">a</div>', '<svg><path d="M0 0" fill="javascript:x"/></svg>',
    '<a href="#x">link</a>', '<style>div{}</style>',
    '<div style="background: url(#a), url(https://example.com/x.png)">a</div>', '<div style="background: url(https://example.com/x.png), url(#a)">a</div>',
    '<svg><rect fill="url(#a) url(//example.com/p)"/></svg>', '<div style="background: url(\'#a\'), url(\'http://x\')">a</div>',
    '<div style="background: image-set(\'https://example.com/x.png\' 1x)">a</div>', '<div style="background: \\75 rl(https://example.com/x.png)">a</div>',
    '<svg><rect fill="var(--accent)"/></svg>', '<div style="color: var(--hl-now-ink)">a</div>', '<svg><rect fill="var(--ink-5)"/></svg>',
    '<div style="color: var(--ink-1, var(--secret))">a</div>', '<svg><rect style="fill: var(--ok); stroke: url(https://example.com/p)"/></svg>',
    '<div data-id="a" style="opacity: 0.5">a</div>', '<svg><rect data-id="a" opacity="0.5"/></svg>',
    '<div data-id="Bad">a</div>', img('png', b64(ascii('not an image at all'))),
  ].map((m): Rejection => [`custom ${m.slice(0, 60)}`, custom(m), ['E150']]),
  ['custom unclosed tag', custom('<div><span>a</div>'), ['E151']],
  ['custom unclosed div', custom('<div>'), ['E151']],
  ['animated gif', custom(img('gif', gif(2))), ['E152']],
  ['animated png', custom(img('png', png(3))), ['E152']],
  ['animated webp', custom(img('webp', webp(2))), ['E152']],
  // Custom from a file
  ['src file missing', script('##\n::: custom f src=art/pair.svg\n[show f] Hi.'), ['E213'], 't.md:5:1: error E213: src file "art/pair.svg" not found\n  fix: give the path relative to the script\'s directory'],
  ['src file with an event handler', fromFile(), ['E150'], 'event handler onclick="…" is not allowed (pair.svg, line 3)', { 'pair.svg': PAIR.replace('<path data-id="link"', '<path onclick="x()" data-id="link"') }],
  ['src file unclosed', fromFile(), ['E151'], '<svg> (line 1) is not closed (pair.svg, line 4)', { 'pair.svg': PAIR.replace('</svg>', '') }],
  ['src file empty', fromFile(), ['E130'], 't.md:5:1: error E130: pair.svg is empty\n  fix: draw the SVG in that file', { 'pair.svg': '\n' }],
];

/** Scripts that must pass G1 with no schema finding: forms an agent writes that once drew a false error. */
const ACCEPTED: [string, string, Record<string, string>?][] = [
  ['code spans and arithmetic are not emphasis', text('`*p*` and 2 * 3 * 4 and a*b*c')],
  ['backticks with letters, digits, . and _', narrate('So `p.next_token2` runs.')],
  ['digits and punctuation in prose', narrate(`It's 2.5, 3: "fine" — 50% & more; x-ray, 1st.`)],
  ['400 spoken words', script(`##\n${words(400)}.`)],
  ['an identifier counts per spoken word', script(`##\n${words(398)} \`parseCall\``)],
  ['[show hl x] never warns', script(`##\n${BL}[show hl b:1] A.`)],
  ['reveal a drawing minus a part', script(`##\n${BL}[show b; hide b:1] A.`)],
  ['hl on two words', script(`##\n${BL}[hl b:1] A [hl b:2] b.`)],
  ['hl on two blocks at once', script(`##\n${BL}::: text t\nx\n:::\n[hl b:1; hl t] A.`)],
  ['move reveals a marker', script('##\n::: tokens tk markers=cur,peek\na b c\n:::\n[move tk:peek 2] A.')],
  ['show after hide', script(`##\n${BL}[hide b:1] A [show b:1] b.`)],
  ...['cur', 'peek', 'all'].map((w): [string, string] => [`"${w}" is an id`, script(`##\n::: callout ${w}\nx\n:::\n[hl ${w}] Hi.`)]),
  ['a type name may name an item', script('##\n::: bullets b\n- x #code\n- y\n:::\n[hl code] Hi.')],
  ['a type name may name a group', script('##\n::: tokens tk\na b c\n:::\n[group tk:1-2 pair #table] A [hl table] b.')],
  ['a silent scene', script('##\n::: text a\nx\n:::\n')],
  ['show after dim', script(`##\n${BL}[dim b] One [show b] two.`)],
  ['show after dim on an item', script(`##\n${BL}[dim b:1] One [show b:1] two.`)],
  ['show after focus', script(`##\n${BL}::: text a\nx\n:::\n[focus a] One [show b] two.`)],
  ['item names repeat across blocks, qualified', script('##\n::: custom open\n<svg viewBox="0 0 100 40"><text data-id="syn" x="0" y="20">SYN</text></svg>\n:::\n[show open:syn] One.\n\n##\n::: custom close\n<svg viewBox="0 0 100 40"><text data-id="syn" x="0" y="20">SYN</text></svg>\n:::\n[show close:syn] Two.')],
  ['an item name qualifies on any block', script('##\n::: table t\n| a | b |\n|---|---|\n| x | 1 |\n| sum | 2 | #total\n:::\n::: table u\n| a | b |\n|---|---|\n| y | 3 | #total\n:::\n[hl t:total] One [hl u:total] two.')],
  ['comments anywhere outside bodies', script('<!-- a\nnote -->\n##\nOne <!-- aside --> two.\n<!-- whole line -->\nthree.\n::: text a\n<!-- kept -->\n:::\n')],
  ['Windows line endings and a BOM', '﻿---\r\ntitle: T\r\n---\r\n##\r\nHi there.\r\n'],
  ['a fenced body keeps heading-like lines', script('##\n::: code c\n## not a scene\n# nor a chapter\n:::\nHi.')],
  ['escaped delimiters in a cue', script('##\n::: text a\nx\n:::\n[set a `a]b` \\} done] Next.')],
  ['allowed HTML', custom('<div class="x"><b>bold</b> <code>x</code></div>')],
  ['markers and local url()', custom('<svg viewBox="0 0 10 10"><defs><marker id="m"><path d="M0 0"/></marker></defs><path d="M0 0 H5" marker-end="url(#m)"/><use href="#m"/></svg>')],
  ['theme tokens in attributes', custom('<svg viewBox="0 0 100 40"><rect fill="var(--ink-2)" stroke="var(--line-strong)" style="stroke-width: var(--stroke-edge)"/><text font-size="var(--text-label)" class="bad" y="30">x</text></svg>')],
  ['color as an attribute', custom('<svg viewBox="0 0 100 40"><g color="var(--ok)"><path d="M0 0" stroke="currentColor"/></g><text color="var(--error)" y="30">x</text></svg>')],
  ['opacity on a parent of an item', custom('<div style="opacity: 0.5"><span data-id="a">a</span></div>')],
  ...([['gif', gif(1)], ['png', png()], ['png', png(1)], ['webp', webp(1)]] as const).map(([k, d], i): [string, string] => [`still image ${i}`, custom(img(k, d))]),
  ['src= draws the file', script(`##\n::: custom f "a pair" src=pair.svg\n::: custom g "a pair"\n${PAIR}\n:::\n[show hl f:b] From the file, [show hl g:b] and written inline.`), { 'pair.svg': PAIR }],
  ['"same" is an ordinary node, dir=cycle a header value', script('##\n::: graph g dir=cycle\na: A\nsame: unchanged files\na -> same\nsame -> a\n:::\n[grow g] One.')],
];

const FL = script('##\n::: tokens fl markers=cur,peek\na b c d e\n:::\n[move fl 1; move fl:peek 2] Hi [move fl 5] there.');
/** [what, broken script, code, what the fix says, the script with that fix applied, files]: the fixed script must check clean. */
type Fix = [string, string, string, string, string, Record<string, string>?];
const roll = (svg: string) => script(`##\n::: custom sky\n${svg}\n:::\n[move sky:e 1] Hi.`);
const OK = '<svg viewBox="0 0 400 200"><line id="s" x1="0" y1="50" x2="400" y2="50"/><circle data-id="e" data-along="s" cx="0" cy="50" r="5"/></svg>';
const chartDoc = (body: string) => script(`##\n${body}\n[grow s] One.`);
const FIXES: Fix[] = [
  ['a row short of a value', chartDoc('::: chart s\nseries: noon sunset\nblue: 80\nred: 96 24\n:::'), 'E137', 'one per series on the "series: noon sunset" line', chartDoc('::: chart s\nseries: noon sunset\nblue: 80 0.02\nred: 96 24\n:::')],
  ['log bars at 0: remove log', chartDoc('::: chart s log\nblue: 80\nred: 0\n:::'), 'E137', 'remove "log"', chartDoc('::: chart s\nblue: 80\nred: 0\n:::')],
  ['log bars at 0: raise the value', chartDoc('::: chart s log\nblue: 80\nred: 0\n:::'), 'E137', 'give "red" a value above 0', chartDoc('::: chart s log\nblue: 80\nred: 5\n:::')],
  ['grouped log bars below 0', chartDoc('::: chart s log\nseries: noon sunset\nblue: 80 -2\n:::'), 'E137', 'give "blue" values above 0', chartDoc('::: chart s log\nseries: noon sunset\nblue: 80 2\n:::')],
  ['log line at 0: remove log', chartDoc('::: chart s log\nx: 0 7 14\nfirst: 0 10 4\n:::'), 'E137', 'remove "log"', chartDoc('::: chart s\nx: 0 7 14\nfirst: 0 10 4\n:::')],
  ['log line at 0: raise the value', chartDoc('::: chart s log\nx: 0 7 14\nfirst: 0 10 4\n:::'), 'E137', 'give "first" values above 0', chartDoc('::: chart s log\nx: 0 7 14\nfirst: 1 10 4\n:::')],
  ['one series', chartDoc('::: chart s\nseries: noon\nblue: 80\n:::'), 'E137', '"series: noon sunset"', chartDoc('::: chart s\nseries: noon sunset\nblue: 80 0.02\n:::')],
  ['three series', chartDoc('::: chart s\nseries: a b c\nx1: 1 2 3\n:::'), 'E137', 'keep 2 series', chartDoc('::: chart s\nseries: a b\nx1: 1 2\n:::')],
  ['several values on plain bars', chartDoc('::: chart s\nblue: 80 0.02\n:::'), 'E137', 'grouped bars start with "series: a b"', chartDoc('::: chart s\nseries: a b\nblue: 80 0.02\n:::')],
  ['data-along names no shape', roll(OK.replace('data-along="s"', 'data-along="track"')), 'E150', 'give the path it moves along id="track"', roll(OK.replace('data-along="s"', 'data-along="track"').replace('id="s"', 'id="track"'))],
  ['data-along names a shape in another svg', roll(OK.replace('<line id="s" x1="0" y1="50" x2="400" y2="50"/>', '') + '<svg viewBox="0 0 10 10"><line id="s" x1="0" y1="5" x2="10" y2="5"/></svg>'), 'E150', 'give the path it moves along id="s"', roll(OK)],
  ['data-along without data-id', roll(OK.replace('data-id="e" ', '')), 'E150', 'add data-id="name" to it', roll(OK)],
  ['data-along outside an svg', roll('<div data-id="e" data-along="s">x</div>'), 'E150', 'draw the item and its path inside one <svg>', roll(OK)],
  ['data-along start past 1', roll(OK.replace('data-along="s"', 'data-along="s 1500"')), 'E150', 'write data-along="s 0.5"', roll(OK.replace('data-along="s"', 'data-along="s 0.5"'))],
  ['data-along on several strokes', roll(OK.replace('<line id="s" x1="0" y1="50" x2="400" y2="50"/>', '<path id="s" d="M0 50 L200 50 M200 60 L400 60"/>')), 'E150', 'keep one M in its d', roll(OK.replace('<line id="s" x1="0" y1="50" x2="400" y2="50"/>', '<path id="s" d="M0 50 L200 50"/><path d="M200 60 L400 60"/>'))],
  ['data-along path inside the item', roll('<svg viewBox="0 0 400 200"><g data-id="e" data-along="s"><line id="s" x1="0" y1="50" x2="400" y2="50"/><circle cx="0" cy="50" r="5"/></g></svg>'), 'E150', 'move the path out of the element', roll('<svg viewBox="0 0 400 200"><line id="s" x1="0" y1="50" x2="400" y2="50"/><g data-id="e" data-along="s"><circle cx="0" cy="50" r="5"/></g></svg>')],
  ['src= and a body: keep the body', fromFile(`${PAIR}\n:::\n`), 'E106', 'remove "src=pair.svg" to keep the body', script(`##\n::: custom f\n${PAIR}\n:::\n[show f] Hi.`), { 'pair.svg': PAIR }],
  ['src= and a body: keep the file', fromFile(`${PAIR}\n:::\n`), 'E106', 'or delete the body and its ":::"', fromFile(), { 'pair.svg': PAIR }],
  ['a block move that pushes a later marker past the strip', FL, 'E303', 'or move "cur" alone: [move fl:cur 5]', FL.replace('[move fl 5]', '[move fl:cur 5]')],
  ['src= with an empty fence', fromFile(':::\n'), 'E106', 'delete the ":::" line under it', fromFile(), { 'pair.svg': PAIR }],
];

// Every check starts at once (8 in flight); the tests below read their results.
const fixtures = Object.entries(FIXTURES);
const fixed = fixtures.map((e, i) => [...e, i] as const).filter(([, f]) => f.fixed);
const results = all<Run & { printed: string }>([
  ...fixtures.map(([, f]) => () => check(f.text)),
  ...fixed.map(([, f]) => () => check(f.text.replace(f.fixed![0], f.fixed![1]))),
  ...REJECTED.map(([, s, , , files]) => () => check(s, files)),
  ...ACCEPTED.map(([, s, files]) => () => check(s, files)),
  ...FIXES.flatMap(([, broken, , , good, files]) => [() => check(broken, files), () => check(good, files)]),
]);
const at = async (i: number) => (await results)[i]!;
const T = 120_000;

describe('every diagnostic prints its code at its line, with the message and fix the agent reads', () => {
  fixtures.forEach(([key, f], i) => test(key, async () => {
    const r = await at(i);
    expect(r.printed).toBe(f.expect);
    expect(codes(r)).toEqual([codeOf(key)]);
    // An error fails G1 (exit 1); a warning alone lets the script through.
    expect(r.out).toContain(`gates: G1 schema ${codeOf(key).startsWith('E') ? 'FAIL' : 'pass'}`);
    expect(r.code).toBe(codeOf(key).startsWith('E') ? 1 : 0);
  }, T));
});

describe('a fix in script syntax, applied literally, makes check pass', () => {
  fixed.forEach(([key, f, j], i) => test(key, async () => {
    const [from, , said = f.fixed![1]] = f.fixed!;
    expect(f.text).toContain(from);
    expect((await at(j)).printed.split('\n')[1]).toContain(said);
    const r = await at(fixtures.length + i);
    expect(r.printed).toBe('');
    expect(r.code).toBe(0);
  }, T));
});

describe('rejected, with the code and the words that help', () => {
  const base = fixtures.length + fixed.length;
  REJECTED.forEach(([name, , want, says], i) => test(name, async () => {
    const r = await at(base + i);
    expect(codes(r)).toEqual(want);
    if (says) expect(r.printed).toContain(says);
  }, T));
});

describe('accepted: no schema finding', () => {
  const base = fixtures.length + fixed.length + REJECTED.length;
  ACCEPTED.forEach(([name], i) => test(name, async () => {
    const r = await at(base + i);
    expect(r.out).toContain('gates: G1 schema pass');
    expect(codes(r).filter(c => !c.startsWith('L'))).toEqual([]);
  }, T));
});

describe('block errors: the fix, applied as written, checks clean', () => {
  const base = fixtures.length + fixed.length + REJECTED.length + ACCEPTED.length;
  FIXES.forEach(([name, , code, says], i) => test(name, async () => {
    const [broken, good] = [await at(base + 2 * i), await at(base + 2 * i + 1)];
    expect(codes(broken)[0]).toBe(code);
    expect(issues(broken.out)[0]!.fix).toContain(says);
    expect(good.printed).toBe('');
    expect(good.code).toBe(0);
  }, T));
});

test('at most 50 diagnostics, errors kept before warnings, in source order', async () => {
  const body = Array.from({ length: 60 }, (_, i) => `[hl nope${i}] Word.`).join('\n\n');
  const warn = '::: text a\n' + Array.from({ length: 10 }, () => '*x* y').join('\n') + '\n:::\n';
  const r = await check(script(`##\n${warn}${body}`));
  const found = issues(r.out);
  expect(found.length).toBe(50);
  expect(found.every(d => d.code === 'E201')).toBe(true);
  const lines = found.map(d => Number(/^t\.md:(\d+)/.exec(d.where)![1]));
  expect(lines).toEqual([...lines].sort((a, b) => a - b));
}, T);

test('--json: every diagnostic carries file, line, col, code, severity, message and a fix', async () => {
  const r = await check(FIXTURES.E301!.text, {}, ['--json']);
  const o = JSON.parse(r.out) as { ok: boolean; gates: { G1: boolean }; diagnostics: Record<string, unknown>[] };
  expect([r.code, o.ok, o.gates.G1]).toEqual([1, false, false]);
  expect(o.diagnostics).toEqual([{ file: 't.md', line: 8, col: 21, code: 'E301', severity: 'error',
    message: 'hl on "fnote" while it is hidden; it is first shown at 8:35', fix: 'move this cue after that show, or show it here instead of there: [show hl fnote]' }]);
}, T);

/** Findings of a lint script's `check`, by scene: "CODE block line: message", and their fixes. */
async function lint(file: string) {
  const r = await lectern(['check', file, '--no-audio', '--out', path.join(tmp('lint'), 'out')], { xdg: await cacheHome(), cwd: SCRIPTS });
  const by = new Map<number, { code: string; block?: string; line: number; beat: number; message: string; fix: string }[]>();
  for (const i of issues(r.out)) {
    const m = /^.+?:(\d+) S(\d+)·B(\d+)(?: "([^"]+)")?$/.exec(i.where)!;
    const scene = Number(m[2]);
    by.set(scene, [...(by.get(scene) ?? []), { code: i.code, block: m[4], line: Number(m[1]), beat: Number(m[3]), message: i.message, fix: i.fix }]);
  }
  return { r, scene: (k: number) => by.get(k) ?? [], scenes: [...by.keys()].sort((a, b) => a - b) };
}
const lineOf = (file: string, text: string) => Bun.file(path.join(SCRIPTS, file)).text().then(t => t.split('\n').indexOf(text) + 1);

test('layout findings (lint.md): each at its scene, beat and script line, with a fix that, applied, fits', async () => {
  const { r, scene, scenes } = await lint('lint.md');
  expect(r.code).toBe(1);
  expect(r.out).toContain('gates: G1 schema pass · G2 layout FAIL');
  // Only these scenes have findings; every other scene (the fixes applied, captions, wrapped prose, formulas) is clean.
  expect(scenes).toEqual([0, 2, 3, 5, 8, 10, 12, 16, 18, 20]);
  // Tiny text, inside custom SVG too, at the block's line; an overlap inside one drawing names the author's content.
  const [tiny, own] = scene(0);
  expect(tiny).toMatchObject({ code: 'L406', block: 'pic', beat: 0, line: await lineOf('lint.md', '::: custom pic') });
  expect(tiny!.message).toMatch(/^"far too small" is drawn at \d+(\.\d)?px, below the 14px floor$/);
  expect(tiny!.fix).toContain('one user unit per CSS pixel');
  expect(own).toMatchObject({ code: 'L403', message: 'your custom content overlaps itself: "CLOSED" overlaps "SYN-SENT"' });
  expect(own!.fix).not.toContain('report this');
  // A strip too long for a row: one L410 naming its limit in tokens and a real split.
  expect(scene(2)).toHaveLength(1);
  expect(scene(2)[0]).toMatchObject({ code: 'L410', block: 'long' });
  expect(scene(2)[0]!.fix).toMatch(/^at most \d+ tokens this wide fit a row: use two tokens blocks, one @top/);
  expect(scene(2)[0]!.fix).not.toContain('@main');
  // Text squeezed by a transform is measured at its squeezed size.
  expect(scene(3).map(i => `${i.code} ${i.message.replace(/ at [\d.]+px/, '')}`)).toEqual(['L406 "squeezed flat" is drawn, below the 14px floor', 'L406 "squeezed thin" is drawn, below the 14px floor']);
  // An overfull scene reports only its overflow, whatever else is in it.
  expect(scene(5).map(i => `${i.code} ${i.block}`)).toEqual(['L410 long2']);
  expect(scene(18).map(i => `${i.code} ${i.block}`)).toEqual(['L410 long3']);
  // Two blocks too wide side by side: one finding at the cue's line; scene 9 applies the fix and is clean.
  expect(scene(8)).toHaveLength(1);
  expect(scene(8)[0]!.message).toMatch(/^"wide" \(\d+px\) and "wt" \(\d+px\) need \d+px side by side; the row has 1152px$/);
  expect(scene(8)[0]).toMatchObject({ fix: 'put one of them @top, or remove @left', beat: 0, line: await lineOf('lint.md', '::: code wide @left') });
  // A graph too wide names dir=TB (scene 11 applies it and is clean); prose beside code says how to fix the row.
  expect(scene(10).map(i => i.code)).toEqual(['L410']);
  expect(scene(10)[0]!.fix).toStartWith('draw "wg" top to bottom: add dir=TB to its ::: line');
  expect(scene(12)[0]!.message).toMatch(/^"ops" \(\d+px\) and "rule" \(\d+px\) need \d+px side by side; the row has 1152px$/);
  expect(scene(12)[0]!.fix).toBe('put one of them @top, or remove @left');
  // Too tall: one block alone is told to shrink or split itself (never dir=LR); blocks too tall together, the scene.
  expect(scene(16)).toHaveLength(1);
  expect(scene(16)[0]!.message).toMatch(/^the row "tall" is \d+px too tall for the frame$/);
  expect(scene(16)[0]!.fix).toBe('"tall" alone is taller than the frame: show fewer rows, lines or nodes, or split it into two blocks');
  expect(scene(20).map(i => i.code)).toEqual(['L410']);
  expect(scene(20)[0]!.fix).toStartWith('split the scene');
}, T);

test('layout findings (lint2.md): charts, movers, rings and code', async () => {
  const { scene, scenes } = await lint('lint2.md');
  expect(scenes).toEqual([0, 1, 3, 5]);
  // A set the chart cannot draw is the author's L405, at its own cue, with a fix in script syntax.
  expect(scene(0).map(i => [i.code, i.block, i.message, i.fix])).toEqual([
    ['L405', 'bad', '[set bad:a foo] cannot be drawn: a bar takes one plain number', 'write one number, e.g. [set bad:a 1]'],
    ['L405', 'bad', '[set bad:2 1 2] cannot be drawn: a bar takes one plain number', 'write one number, e.g. [set bad:2 2]'],
    ['L405', 'grp', '[set grp:blue 90 30] cannot be drawn: a grouped row has no value of its own', 'set each bar on its own, e.g. [set grp:blue.noon 90]'],
    ['L405', 'lg', '[set lg:s 0 10 100] cannot be drawn: a log scale shows only values above 0', 'set values above 0, e.g. [set lg:s 1 10 100], or remove "log" from the ::: chart line'],
    ['L405', 'lg', '[set lg:s 1 2] cannot be drawn: this series takes 3 plain numbers, one per x label', 'write 3 numbers, e.g. [set lg:s 1 10 100]'],
  ]);
  // A mover whose text comes to rest on other text: L403 at the move's line; passing text in flight (scene 2) is fine.
  expect(scene(1).map(i => [i.code, i.message])).toEqual([['L403', 'your custom content overlaps itself: "Goal" overlaps "Here"']]);
  expect(scene(1)[0]!.line).toBe(await lineOf('lint2.md', 'The tag starts on the left. [move clash:tag 1] It lands on the goal.'));
  expect(scene(1)[0]!.fix).toContain('move one of them in the custom markup');
  // A ring too crowded for its chord labels is the author's to fix; the same ring unlabelled (scene 4) is clean.
  expect(scene(3).map(i => [i.code, i.block, i.message, i.fix])).toEqual([
    ['L404', 'crowd', 'the ring "crowd" has too many labelled chords to keep their labels clear', 'remove a chord\'s label (say it in the narration instead)'],
  ]);
  // Code never wraps: a line too long beside a table makes the row overfull, never a line out of its panel.
  expect(scene(5).map(i => i.code)).toEqual(['L410']);
}, T);

test('a three-column compare of long prose fits a full row (part 8\'s recap): no L410', async () => {
  const long = (label: string) => `${label}\nA column of long prose, long enough that it has to wrap across several lines of the measure.`;
  const r = await check(script(`##\n::: compare c\n${long('first')}\n---\n${long('second')}\n---\n${long('third')}\n:::\n[hl c:2] Three columns.`));
  expect(r.printed).toBe('');
  expect(r.code).toBe(0);
}, T);
