import type { Loc } from '../ir.ts';

/**
 * Text that remembers where each character came from. A paragraph's lines are joined with single spaces,
 * but every offset still maps back to its own line and column, so diagnostics point at the source.
 */
export class SourceText {
  private constructor(
    readonly text: string,
    /** Ascending by offset; the first is always at offset 0. */
    private readonly anchors: readonly { offset: number; loc: Loc }[],
  ) {}

  static at(text: string, loc: Loc): SourceText {
    return new SourceText(text, [{ offset: 0, loc }]);
  }

  /** Lines joined by single spaces. */
  static join(lines: readonly { text: string; loc: Loc }[]): SourceText {
    const anchors: { offset: number; loc: Loc }[] = [];
    let offset = 0;
    for (const l of lines) {
      anchors.push({ offset, loc: l.loc });
      offset += l.text.length + 1;
    }
    return new SourceText(lines.map(l => l.text).join(' '), anchors.length ? anchors : [{ offset: 0, loc: { line: 1, col: 1 } }]);
  }

  /** Location of the character at `offset` (clamped to the text). */
  loc(offset: number): Loc {
    let a = this.anchors[0]!;
    for (const b of this.anchors) {
      if (b.offset > offset) break;
      a = b;
    }
    return { line: a.loc.line, col: a.loc.col + Math.max(0, offset - a.offset) };
  }

  slice(start: number, end = this.text.length): SourceText {
    const anchors = [{ offset: 0, loc: this.loc(start) }];
    for (const a of this.anchors) if (a.offset > start && a.offset < end) anchors.push({ offset: a.offset - start, loc: a.loc });
    return new SourceText(this.text.slice(start, end), anchors);
  }

  /** Slice with surrounding whitespace removed, locations kept. */
  trimmed(): SourceText {
    const start = this.text.length - this.text.trimStart().length;
    const end = this.text.trimEnd().length;
    return this.slice(start, Math.max(start, end));
  }
}
