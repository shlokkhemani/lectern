/**
 * The global clock G (§4.1): scenes laid end to end by frame count. `plans` is the video's scenes in
 * order, and `k` is a position in that array (with `--scenes 3-5`, position 0 is scene 3).
 */
import type { Locate, ToGlobal } from './types.ts';
import { frameTime } from './clock.ts';

function startFrame(plans: { frameCount: number }[], k: number): number {
  let f = 0;
  for (let j = 0; j < k; j++) f += plans[j]!.frameCount;
  return f;
}

export const toGlobal: ToGlobal = (plans, k, s) => frameTime(startFrame(plans, k)) + s;

export const locate: Locate = (plans, g) => {
  if (!plans.length) return { scene: 0, t: 0 };
  let start = 0;
  for (let k = 0; k < plans.length; k++) {
    const end = start + plans[k]!.frameCount;
    if (g < frameTime(end) || k === plans.length - 1)
      return { scene: k, t: Math.min(Math.max(0, g - frameTime(start)), frameTime(plans[k]!.frameCount - 1)) };
    start = end;
  }
  return { scene: 0, t: 0 };
};
