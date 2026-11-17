/** Theme reads for the runtime. Numeric tokens come from the kit's one cached reader. */
export { token as tok } from '../blocks/kit.ts';
import { token } from '../blocks/kit.ts';

/** The body's floor (stage px): above the bottom margin and the subtitle band every scene reserves. */
export const bodyFloor = (): number => token('--stage-h') - token('--margin-y') - token('--subtitle-band');

/** A colour token resolved to sRGB 0..1 channels and alpha, via the browser's own colour parsing. */
export function parseColour(css: string): [number, number, number, number] {
  const m = css.match(/rgba?\(([^)]+)\)/) ?? css.match(/color\(srgb ([^)]+)\)/);
  if (!m) return [0, 0, 0, 0];
  const parts = m[1]!.split(/[\s,/]+/).filter(Boolean).map(Number);
  const scale = css.startsWith('color(') ? 1 : 255;
  return [parts[0]! / scale, parts[1]! / scale, parts[2]! / scale, parts[3] ?? 1];
}
