/**
 * Media instructions (§6): what the encoder, the narration writer and the muxer must produce, and what their
 * outputs must measure, derived from plans. Timing owns every conversion between frames, time-base ticks,
 * seconds and samples; render only passes these values to ffmpeg and compares them with ffprobe.
 */
import type { ScenePlan } from './types.ts';
import { RATE } from './clock.ts';

/** One encoded video frame: which capture run's image, its presentation time in ticks, and its hold. */
export interface EncodedFrame {
  /** Index into `plan.capture` (and the captured images). */
  image: number;
  /** Presentation time in the time base's ticks. */
  pts: number;
  /** How long the frame shows, seconds, as a decimal for ffmpeg's concat demuxer. */
  seconds: string;
}

/** A scene's video segment: the concat input and the timeline its encode must match. */
export interface SegmentMedia {
  /** Input frame rate for ffmpeg, "num/den". */
  rate: string;
  /** Encoder and muxer time base, "1/timescale", and its timescale (ticks per second). */
  timeBase: string;
  timescale: number;
  /**
   * The encoded frames in order: one per capture run, plus the run's image again on its last frame when the
   * run holds more than one frame. A packet lasts until the next one starts, so the final hold must be
   * explicit; and a seek (ffmpeg `-ss`) returns the first frame at or after t, so without the repeat a grab
   * anywhere inside a hold would show the next run's image.
   */
  frames: EncodedFrame[];
  /** The segment's exact duration in ticks. */
  duration: number;
}

/** The final MP4: every scene back to back, and the narration under it. */
export interface FinalMedia {
  video: {
    timeBase: string;
    timescale: number;
    /** Every frame's presentation time in ticks: each scene's frames shifted by the scenes before it. */
    pts: number[];
    /** Exact duration in ticks. */
    duration: number;
  };
  audio: {
    /** Sample rate, Hz; the narration's time base is 1/rate. */
    rate: number;
    timeBase: string;
    /** Effective samples (after the encoder's priming is trimmed): exactly the plans' total. */
    samples: number;
    /** Effective first sample's presentation time, ticks: the narration starts with the video. */
    start: number;
  };
}

type Plan = Pick<ScenePlan, 'capture' | 'frameRate' | 'frameCount'>;

const ticksPerFrame = (rate: ScenePlan['frameRate']) => rate.den;
const timescale = (rate: ScenePlan['frameRate']) => rate.num;

/** A scene's segment instructions. */
export function segmentMedia(plan: Plan): SegmentMedia {
  const { frameRate: rate } = plan;
  const tick = ticksPerFrame(rate);
  const seconds = (frames: number) => ((frames * rate.den) / rate.num).toFixed(9);
  const frames: EncodedFrame[] = [];
  let f = 0;
  plan.capture.forEach((c, image) => {
    // A segment can end a file (the last scene, a --scenes build). Its last two frames sit one frame apart, so a
    // tool that guesses the final frame's length from the gap before it (ffmpeg's fps filter does) guesses one frame,
    // not the whole hold.
    const last = image === plan.capture.length - 1 && c.repeat > 2;
    if (c.repeat > 1) {
      const head = last ? c.repeat - 2 : c.repeat - 1;
      frames.push({ image, pts: f * tick, seconds: seconds(head) });
      if (last) frames.push({ image, pts: (f + head) * tick, seconds: seconds(1) });
      frames.push({ image, pts: (f + c.repeat - 1) * tick, seconds: seconds(1) });
    } else {
      frames.push({ image, pts: f * tick, seconds: seconds(c.repeat) });
    }
    f += c.repeat;
  });
  return { rate: `${rate.num}/${rate.den}`, timeBase: `1/${timescale(rate)}`, timescale: timescale(rate), frames, duration: plan.frameCount * tick };
}

/** The final MP4's instructions for `plans` in video order. All plans share one frame rate. */
export function finalMedia(plans: ScenePlan[]): FinalMedia {
  const rate = plans[0]!.frameRate;
  if (plans.some(p => p.frameRate.num !== rate.num || p.frameRate.den !== rate.den)) throw new Error('timing: plans differ in frame rate');
  const pts: number[] = [];
  let offset = 0;
  for (const p of plans) {
    const seg = segmentMedia(p);
    for (const fr of seg.frames) pts.push(offset + fr.pts);
    offset += seg.duration;
  }
  const samples = plans.reduce((n, p) => n + p.audio.totalSamples, 0);
  return {
    video: { timeBase: `1/${timescale(rate)}`, timescale: timescale(rate), pts, duration: offset },
    audio: { rate: RATE, timeBase: `1/${RATE}`, samples, start: 0 },
  };
}
