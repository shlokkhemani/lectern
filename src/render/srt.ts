/**
 * The .srt sidecar (§6): timing's scene subtitle cues (the same ones the page burns into every frame), shifted
 * onto the global clock.
 */
import type { Script } from '../ir.ts';
import type { ScenePlan } from '../timing/types.ts';
import { toGlobal } from '../timing/global.ts';
import { subtitles, type Cue } from '../timing/subtitles.ts';


const stamp = (s: number) => {
  const ms = Math.max(0, Math.round(s * 1000));
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(Math.floor(ms / 3_600_000))}:${p(Math.floor(ms / 60_000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
};

/** The subtitle cues for `plans` in video order, in G seconds. */
function subtitleCues(ir: Script, plans: ScenePlan[]): Cue[] {
  return plans.flatMap((plan, k) => subtitles(ir.scenes[plan.scene]!, plan)
    .map(c => ({ start: toGlobal(plans, k, c.start), end: toGlobal(plans, k, c.end), lines: c.lines })));
}

/** The cues as an .srt file. */
export function srt(ir: Script, plans: ScenePlan[]): string {
  return subtitleCues(ir, plans).map((c, i) => `${i + 1}\n${stamp(c.start)} --> ${stamp(c.end)}\n${c.lines.join('\n')}\n`).join('\n');
}
