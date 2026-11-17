/**
 * SceneEntry (§3.2): per scene, the two settled states a scene boundary needs, computed in the page from the IR
 * alone (settled states are timing-independent), identically in every page.
 *
 * A boundary is always a whole-scene crossfade: scene k−1's final frame sits under scene k while k fades in over
 * `--dur-scene`. A reused block whose place and geometry happen to match crossfades into itself, which looks
 * static, so no per-block carry classification is needed (an earlier `carry` field was computed and never used).
 */
import type { Script } from '../ir.ts';
import type { Settler } from './settle.ts';
import type { SceneState } from './state.ts';

export interface SceneEntry {
  /** Scene k at S = 0: reused blocks start from their previous placement's final settled state. */
  entry: SceneState;
  /** Scene k−1's final settled state, drawn frozen under the crossfade (absent for scene 0). */
  outgoing?: SceneState;
}

export function sceneEntries(ir: Script, settler: Settler): SceneEntry[] {
  return ir.scenes.map((_, k) => (k === 0 ? { entry: settler.base(k) } : { entry: settler.base(k), outgoing: settler.final(k - 1) }));
}
