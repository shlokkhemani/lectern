/**
 * Motion tokens from `theme/v2/tokens.css`: the timing module is their only reader (seam 6).
 */
import type { Verb } from '../ir.ts';
import type { Bezier, DurationToken, EaseToken, MotionTokens } from '../verbs.ts';
import { VERBS } from '../verbs.ts';
import { BLOCKS } from '../blocks/registry.ts';
import type { LoadMotion } from './types.ts';

/**
 * Motion tokens plus per-block-type verb durations: `--dur-<verb>-<type>` (e.g. `--dur-show-sequence`)
 * replaces the verb's motion duration (its first phase) for every span on a block of that type. The theme
 * decides; block modules and the compiler name no type.
 */
type Motion = MotionTokens & { byType?: Record<string, Partial<Record<Verb, number>>> };

/** A verb's motion duration on a block of `type`: the type's override if the theme has one, else the verb's. */
export function verbDuration(m: Motion, verb: Verb, type: string | undefined, phase = 0): number {
  const own = phase === 0 && type !== undefined ? m.byType?.[type]?.[verb] : undefined;
  return own ?? m.durations[VERBS[verb].phases[phase]!.duration];
}

const TOKENS = new URL('../../theme/v2/tokens.css', import.meta.url);

const DURATIONS: DurationToken[] = ['--dur-appear', '--dur-hide', '--dur-move', '--dur-grow', '--dur-highlight', '--dur-recede', '--dur-scene', '--dur-settle'];
const EASES: EaseToken[] = ['--ease-out', '--ease-in-out', '--ease-in', '--ease-appear', '--ease-move', '--ease-grow', '--ease-highlight', '--ease-hide'];

/**
 * Parse motion tokens from a stylesheet. Throws, naming the token, if one is missing or malformed, or if a
 * `--dur-<verb>-<type>` names no block type (a typo would otherwise be ignored silently).
 */
export function parseMotion(css: string): Motion {
  const decls = new Map<string, string>();
  for (const m of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) decls.set(m[1]!, m[2]!.trim());
  const raw = (name: string, seen: string[] = []): string => {
    const v = decls.get(name);
    if (v === undefined) throw new Error(`theme token ${name} is missing from tokens.css`);
    const alias = v.match(/^var\((--[\w-]+)\)$/);
    if (!alias) return v;
    if (seen.includes(name)) throw new Error(`theme token ${name} refers to itself`);
    return raw(alias[1]!, [...seen, name]);
  };
  const seconds = (name: string): number => {
    const m = raw(name).match(/^(-?[\d.]+)(ms|s)$/);
    if (!m) throw new Error(`theme token ${name} is not a duration: "${raw(name)}"`);
    return m[2] === 'ms' ? Number(m[1]) / 1000 : Number(m[1]);
  };
  const curve = (name: string): Bezier => {
    const m = raw(name).match(/^cubic-bezier\(([^)]+)\)$/);
    const n = m?.[1]!.split(',').map(Number);
    if (!n || n.length !== 4 || n.some(x => !Number.isFinite(x))) throw new Error(`theme token ${name} is not a cubic-bezier: "${raw(name)}"`);
    return [n[0]!, n[1]!, n[2]!, n[3]!];
  };
  const durations = Object.fromEntries(DURATIONS.map(d => [d, seconds(d)])) as Record<DurationToken, number>;
  const eases = Object.fromEntries(EASES.map(e => [e, curve(e)])) as Record<EaseToken, Bezier>;
  const stagger = seconds('--stagger');
  const staggerMax = Number(raw('--stagger-max'));
  if (!Number.isInteger(staggerMax) || staggerMax < 0) throw new Error(`theme token --stagger-max is not a count: "${raw('--stagger-max')}"`);
  const byType: NonNullable<Motion['byType']> = {};
  const verbs = Object.keys(VERBS).join('|');
  for (const name of decls.keys()) {
    const m = name.match(new RegExp(`^--dur-(${verbs})-([\\w-]+)$`));
    if (!m) continue;
    const [, verb, type] = m as unknown as [string, Verb, string];
    if (!(type in BLOCKS)) throw new Error(`theme token ${name} names no block type "${type}"`);
    (byType[type] ??= {})[verb] = seconds(name);
  }
  return { durations, eases, stagger, staggerMax, byType };
}

export const loadMotion: LoadMotion = async () => parseMotion(await Bun.file(TOKENS).text());
