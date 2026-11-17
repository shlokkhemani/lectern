import type { Bezier } from '../verbs.ts';

/**
 * A cubic-bezier easing y(x) for x in [0, 1], solved by bisection on x(u): deterministic, and identical
 * to the page's evaluator in `src/runtime/state.ts` so a span's `from` is exactly what the page shows at t0.
 */
export function ease(b: Bezier, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const [x1, y1, x2, y2] = b;
  const at = (a1: number, a2: number, u: number) => 3 * a1 * u * (1 - u) ** 2 + 3 * a2 * u * u * (1 - u) + u ** 3;
  let lo = 0, hi = 1, u = x;
  for (let i = 0; i < 40; i++) {
    u = (lo + hi) / 2;
    if (at(x1, x2, u) < x) lo = u; else hi = u;
  }
  return at(y1, y2, u);
}
