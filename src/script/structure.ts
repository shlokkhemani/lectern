import type { BodyLine } from '../blocks/contract.ts';
import type { Loc } from '../ir.ts';
import type { Diagnostics } from './diagnostics.ts';
import { SourceText } from './source.ts';

/** One word of a `:::` line after the type or reused id, with its column. Quotes are kept. */
export interface HeaderToken { text: string; loc: Loc }

export interface DeclSrc { kind: 'decl'; loc: Loc; type: string; tokens: HeaderToken[]; body: BodyLine[] }
export interface ReuseSrc { kind: 'reuse'; loc: Loc; id: string; tokens: HeaderToken[] }

export interface SceneSrc {
  loc: Loc;
  chapter?: { n: number; text: string };
  headline?: SourceText;
  /** Declarations and reuses in reading order. */
  blocks: (DeclSrc | ReuseSrc)[];
  /** Narration paragraphs, each joined into one text. */
  paragraphs: SourceText[];
}

const FENCE = /^:::\s*$/;
const OPEN = /^:::\s+(\S+)(.*)$/;
const NAME = /\s+#([a-z][a-z0-9-]*)\s*$/;
const HEADING = /^##?(\s|$)/;

/**
 * The line grammar (§1.2): `#` chapters, `##` scenes, `:::` blocks and reuses, comments, and narration
 * paragraphs. A `:::` line opens a block when it is declaration-shaped; a bare `::: id @region` is a reuse.
 */
export function readStructure(lines: readonly string[], start: number, isType: (word: string) => boolean, diags: Diagnostics): SceneSrc[] {
  const scenes: SceneSrc[] = [];
  let scene: SceneSrc | undefined;
  let chapter: { n: number; text: string } | undefined;
  let para: { text: string; loc: Loc }[] = [];
  let comment: Loc | undefined;
  let orphanReported = false;

  const endParagraph = () => {
    if (para.length && scene) scene.paragraphs.push(SourceText.join(para));
    para = [];
  };
  const outsideScene = (loc: Loc, what: string) => {
    if (orphanReported) return;
    orphanReported = true;
    diags.report('E104', loc, `${what} before the first scene`, 'add a line "##" (or "## headline") above it to start a scene');
  };

  for (let i = start; i < lines.length; i++) {
    const lineNo = i + 1;
    const stripped = stripComments(lines[i]!, comment, lineNo);
    comment = stripped.open;
    if (stripped.skip) continue;
    const text = stripped.text.trimEnd();
    if (!text.trim()) {
      endParagraph();
      continue;
    }
    const loc = { line: lineNo, col: 1 };

    if (FENCE.test(text)) {
      endParagraph();
      diags.report('E106', loc, '":::" closes no block', 'remove it, or check the block above for a missing opening "::: type id" line');
      continue;
    }
    const open = OPEN.exec(text);
    if (open) {
      endParagraph();
      const word = open[1]!;
      const tokens = headerTokens(open[2]!, { line: lineNo, col: text.length - open[2]!.length + 1 }, diags);
      if (!scene) outsideScene(loc, `block "${word}"`);
      // A reuse is `::: id` plus at most an @region, with no body. Anything declaration-shaped (a known type,
      // args, or a body closed by a fence) is a declaration, even with a mistyped type, so a typo costs one error.
      const declShaped = isType(word) || tokens.some(t => !t.text.startsWith('@')) || fenceComesFirst(lines, i + 1);
      if (!declShaped) {
        scene?.blocks.push({ kind: 'reuse', loc, id: word, tokens });
        continue;
      }
      const body: BodyLine[] = [];
      // A sourced declaration (`src=`) has no body and no closing fence. One written with a fence anyway is read
      // to it (so its body is not taken for narration) and reported once, below.
      const src = tokens.find(t => t.text.startsWith('src='));
      const fenced = !src || fenceComesFirst(lines, i + 1);
      let closed = !fenced;
      while (!closed && ++i < lines.length) {
        const raw = lines[i]!;
        if (FENCE.test(raw)) {
          closed = true;
          break;
        }
        const nested = OPEN.exec(raw);
        if (nested && isType(nested[1]!)) {
          i--; // let the next block open normally
          break;
        }
        const name = NAME.exec(raw);
        body.push({
          raw,
          text: name ? raw.slice(0, name.index) : raw,
          ...(name ? { name: name[1]! } : {}),
          loc: { line: i + 1, col: 1 },
        });
      }
      if (!closed) {
        diags.report('E105', loc, `block "${word}" is not closed`, 'add a line ":::" after its last body line');
        // An unterminated body ends at the first scene or chapter heading inside it; parsing resumes there.
        // (A fenced body keeps such lines: only an unterminated block is cut.)
        const cut = body.findIndex(l => HEADING.test(l.raw));
        if (cut >= 0) {
          i = body[cut]!.loc.line - 2;
          body.length = cut;
        }
      }
      if (src && fenced) {
        const written = body.some(l => l.raw.trim());
        diags.report('E106', src.loc, `${word} takes its content from ${src.text}, so it has no body and no closing ":::"`,
          written ? `remove "${src.text}" to keep the body, or delete the body and its ":::"` : 'delete the ":::" line under it');
        if (written) tokens.splice(tokens.indexOf(src), 1); // parse the body it was given
      }
      scene?.blocks.push({ kind: 'decl', loc, type: word, tokens, body });
      continue;
    }

    const heading = /^(#+)(?:\s+(.*))?$/.exec(text);
    if (heading) {
      endParagraph();
      const level = heading[1]!.length;
      const title = heading[2]?.trim() ?? '';
      if (level === 1 && title) chapter = { n: (chapter?.n ?? 0) + 1, text: title };
      else if (level === 2) {
        scene = { loc, ...(chapter ? { chapter } : {}), blocks: [], paragraphs: [] };
        if (title) scene.headline = SourceText.at(title, { line: lineNo, col: text.indexOf(title, 2) + 1 });
        scenes.push(scene);
      } else if (level === 1)
        diags.report('E115', loc, 'chapter "#" has no text', 'write "# <chapter title>"; for a scene write "##"');
      else diags.report('E115', loc, `"${heading[1]}" is not a heading here`, 'use "# chapter" or "## scene headline"; there are no deeper levels');
      continue;
    }

    if (!scene) {
      outsideScene(loc, 'narration');
      continue;
    }
    para.push({ text, loc });
  }
  endParagraph();
  if (comment) diags.report('E109', comment, 'comment is not closed', 'add "-->" where the comment ends');
  return scenes;
}

/** Whether a closing fence comes before any other `:::` line or heading: the `:::` line above opened a body. */
function fenceComesFirst(lines: readonly string[], from: number): boolean {
  for (let k = from; k < lines.length; k++) {
    const l = lines[k]!;
    if (FENCE.test(l)) return true;
    if (OPEN.test(l) || HEADING.test(l)) return false;
  }
  return false;
}

/**
 * Blanks out `<!-- … -->` (keeping columns). `open` is where a still-open comment began.
 * `skip` is true for a line that held only comment.
 */
function stripComments(line: string, open: Loc | undefined, lineNo: number): { text: string; open: Loc | undefined; skip: boolean } {
  let text = line;
  let from = 0;
  if (open) {
    const end = text.indexOf('-->');
    if (end < 0) return { text: '', open, skip: true };
    text = ' '.repeat(end + 3) + text.slice(end + 3);
    from = end + 3;
  }
  let touched = !!open;
  open = undefined;
  for (;;) {
    const s = text.indexOf('<!--', from);
    if (s < 0) break;
    touched = true;
    const e = text.indexOf('-->', s + 4);
    if (e < 0) {
      open = { line: lineNo, col: s + 1 };
      text = text.slice(0, s);
      break;
    }
    text = text.slice(0, s) + ' '.repeat(e + 3 - s) + text.slice(e + 3);
    from = e + 3;
  }
  return { text, open, skip: touched && !text.trim() };
}

/** Splits the rest of a `:::` line into words; a `"quoted caption"` (or `key="value"`) stays one word. */
function headerTokens(rest: string, at: Loc, diags: Diagnostics): HeaderToken[] {
  const out: HeaderToken[] = [];
  const re = /[^\s"]*"(?:[^"\\]|\\.)*"|[^\s"]+|"/g;
  for (const m of rest.matchAll(re)) {
    const loc = { line: at.line, col: at.col + m.index };
    if (m[0] === '"' || /^[^"]+"$/.test(m[0])) {
      diags.report('E108', loc, 'quote is not closed', 'close the caption with a second "');
      break;
    }
    out.push({ text: m[0], loc });
  }
  return out;
}
