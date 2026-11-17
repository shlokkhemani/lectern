/**
 * The final MP4 (§6): scene segments back to back plus the narration, stream-copied. Checked with ffprobe
 * against timing's `finalMedia` before anyone may publish it (R701 video, R702 audio). Exact, no tolerance:
 * every frame sits at its planned presentation time, and the narration's effective samples start with the
 * video and number exactly the plans' total.
 */
import path from 'node:path';
import type { ScenePlan } from '../timing/types.ts';
import { finalMedia } from '../timing/media.ts';
import { budget, durationTs, packetPts, run } from './ffmpeg.ts';
import { TAGS } from './encode.ts';

/**
 * Concatenate `segments` (one per plan, in order) with the narration `m4a` into `out`, then verify `out`.
 * Subtitles are burned into the frames by the page, so the MP4 carries no subtitle track.
 */
export async function mux(segments: string[], plans: ScenePlan[], m4a: string, out: string, workDir: string): Promise<void> {
  const media = finalMedia(plans);
  const list = path.join(workDir, 'segments.txt');
  await Bun.write(list, segments.map(s => `file '${s.replace(/'/g, "'\\''")}'`).join('\n') + '\n');
  await run('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', list, '-i', m4a, '-map', '0:v', '-map', '1:a',
    '-c:v', 'copy', '-c:a', 'copy', ...TAGS, '-video_track_timescale', String(media.video.timescale),
    // Edit lists are counted in the movie timescale. At a coarse one (1000 Hz, some ffmpeg versions' default)
    // the narration's trimmed length rounds, e.g. 104 frames → 166,368 samples, not 166,400.
    '-movie_timescale', String(media.audio.rate), '-movflags', '+faststart', '-f', 'mp4', out],
    { deadlineMs: budget(media.video.pts.length, 20) });   // stream copy: well under 1 ms per packet
  await verifyFinal(out, plans);
}

/** R701/R702 unless `file` holds exactly the plans' video timeline and narration samples. */
export async function verifyFinal(file: string, plans: ScenePlan[]): Promise<void> {
  const { video, audio } = finalMedia(plans);
  const [v, pts, a] = await Promise.all([durationTs(file, 'v'), packetPts(file, 'v'), durationTs(file, 'a')]);
  if (v.timeBase !== video.timeBase || v.start !== 0 || v.ts !== video.duration)
    throw new Error(`R701: the video runs from ${v.start} for ${v.ts} × ${v.timeBase} s; the plans need 0 for ${video.duration} × ${video.timeBase} s`);
  const bad = pts.length === video.pts.length ? pts.findIndex((p, i) => p !== video.pts[i]) : Math.min(pts.length, video.pts.length);
  if (bad >= 0)
    throw new Error(`R701: the video's frame ${bad} is at ${pts[bad]} (${pts.length} frames); the plans put it at ${video.pts[bad]} (${video.pts.length} frames)`);
  if (a.timeBase !== audio.timeBase || a.start !== audio.start || a.ts !== audio.samples)
    throw new Error(`R702: the narration runs from ${a.start} for ${a.ts} × ${a.timeBase} s; the plans need ${audio.start} for ${audio.samples} × ${audio.timeBase} s`);
}
