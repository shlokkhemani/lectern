/**
 * Per-scene segment encode (§6, variable frame rate). Each captured image is encoded
 * as one frame whose duration is its hold, and again on the hold's last frame, so repeated frames cost
 * nothing and a seek inside a hold lands on the held image. A segment ends on two frames one frame apart, so
 * tools that guess the last frame's length (ffmpeg's fps filter, editors, upload transcoders) do not stretch
 * the end. Timing says where every frame goes (`segmentMedia`); this module hands that to ffmpeg and checks it.
 *
 * Verified before use (R701): the packets sit exactly at the planned presentation times, and the segment
 * lasts exactly the planned duration.
 */
import path from 'node:path';
import type { ScenePlan } from '../timing/types.ts';
import { segmentMedia, type SegmentMedia } from '../timing/media.ts';
import { budget, durationTs, packetPts, run } from './ffmpeg.ts';

/**
 * The encoder, locked by calibration (docs/render-calibration.md). No B-frames: with reordering, MP4
 * sample durations come from decode order and the holds are lost. Captured images are full-range sRGB;
 * the output is BT.709 limited range 4:2:0, tagged as such.
 */
export const ENCODER = {
  args: ['-c:v', 'libx264', '-preset', 'superfast', '-crf', '16', '-g', '300', '-bf', '0'],
} as const;

const VF = 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p';
/** BT.709 tags, on each segment and again on the final mux (stream copy through concat drops them). */
export const TAGS = ['-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv'];

type Plan = Pick<ScenePlan, 'capture' | 'frameRate' | 'frameCount' | 'scene'>;

/** The concat list: every encoded frame's image, read at the plan's rate and held for its time. */
function ffconcat(images: string[], media: SegmentMedia): string {
  const quote = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;
  return ['ffconcat version 1.0', ...media.frames.flatMap(f =>
    [`file ${quote(images[f.image]!)}`, `option framerate ${media.rate}`, `duration ${f.seconds}`])].join('\n') + '\n';
}

export class FrameCountError extends Error {
  readonly code = 'R701';
}

/** Encode one scene's captured images to `out` and verify its timeline against the plan. */
export async function encodeSegment(images: string[], plan: Plan, out: string, encoder: readonly string[] = ENCODER.args): Promise<void> {
  const media = segmentMedia(plan);
  const list = path.join(path.dirname(out), `${path.basename(out, '.mp4')}.ffconcat`);
  await Bun.write(list, ffconcat(images, media));
  await run('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', list, '-vf', VF, '-fps_mode', 'passthrough',
    '-enc_time_base', media.timeBase, '-video_track_timescale', String(media.timescale), ...encoder, ...TAGS, '-an', out],
    { deadlineMs: budget(media.frames.length, 250) });   // ~13 ms per image when measured under load: 20× margin
  await verifySegment(plan, out);
}

/** R701 unless every packet starts where timing says and the segment lasts exactly its planned duration. */
export async function verifySegment(plan: Plan, file: string): Promise<void> {
  const media = segmentMedia(plan);
  const fail = (what: string) => { throw new FrameCountError(`R701: scene ${plan.scene} ${what}`); };
  const want = media.frames.map(f => f.pts);
  const got = await packetPts(file, 'v');
  if (got.length !== want.length || got.some((p, i) => p !== want[i]))
    fail(`has ${got.length} frames at [${got.slice(0, 8).join(',')}…]; its plan places ${want.length} at [${want.slice(0, 8).join(',')}…]`);
  const d = await durationTs(file, 'v');
  if (d.timeBase !== media.timeBase || d.ts !== media.duration)
    fail(`lasts ${d.ts} × ${d.timeBase} s; its plan lasts ${media.duration} × ${media.timeBase} s`);
}
