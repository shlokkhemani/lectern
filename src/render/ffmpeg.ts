/** Running ffmpeg/ffprobe from PATH. Errors carry ffmpeg's own stderr. */

export interface RunOptions {
  stdin?: Uint8Array;
  /**
   * Wall-clock budget, ms. Past it the process is killed (SIGKILL) and reaped, then the call rejects: no
   * subprocess can hold a build, its scratch or its custody forever. Scale it to the job with `budget`.
   */
  deadlineMs?: number;
}

/** Default budgets: probes read headers and packet tables; an unscaled ffmpeg job is a small one. */
const DEFAULT_DEADLINE = { ffmpeg: 120_000, ffprobe: 60_000 } as const;

/** A deadline for a job of `units` (frames, images, seconds of audio): a fixed allowance plus a per-unit one. */
export const budget = (units: number, msPerUnit: number, baseMs = 30_000): number => baseMs + units * msPerUnit;

class DeadlineError extends Error {}

export async function run(cmd: 'ffmpeg' | 'ffprobe', args: string[], opts: RunOptions = {}): Promise<string> {
  const deadline = opts.deadlineMs ?? DEFAULT_DEADLINE[cmd];
  const p = Bun.spawn([cmd, '-hide_banner', '-v', 'error', ...args], { stdin: opts.stdin ?? 'ignore', stdout: 'pipe', stderr: 'pipe' });
  let expired = false;
  const timer = setTimeout(() => { expired = true; p.kill('SIGKILL'); }, deadline);
  try {
    const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
    if (expired) throw new DeadlineError(`${cmd} ran past its ${(deadline / 1000).toFixed(1)} s deadline and was killed\n  ${cmd} ${args.join(' ')}`);
    if (code !== 0) throw new Error(`${cmd} failed (${code}): ${err.trim().split('\n').slice(-5).join('\n')}\n  ${cmd} ${args.join(' ')}`);
    return out;
  } finally {
    clearTimeout(timer);
    if (p.exitCode === null && p.signalCode === null) { p.kill('SIGKILL'); await p.exited; }
  }
}

/** Packets in the first stream of a kind: frames for video, AAC frames for audio. Fast (no decode). */
export async function packets(file: string, stream: 'v' | 'a'): Promise<number> {
  const out = await run('ffprobe', ['-select_streams', `${stream}:0`, '-count_packets', '-show_entries', 'stream=nb_read_packets', '-of', 'default=nw=1:nk=1', file]);
  return Number(out.trim());
}

/** Presentation timestamps of a stream's packets, in its time base, in presentation order. No decode. */
export async function packetPts(file: string, stream: 'v' | 'a'): Promise<number[]> {
  const out = await run('ffprobe', ['-select_streams', `${stream}:0`, '-show_entries', 'packet=pts', '-of', 'csv=p=0', file]);
  return out.trim().split('\n').filter(Boolean).map(l => Number(l.replace(/,$/, ''))).sort((a, b) => a - b);
}

/**
 * A stream's effective extent in its own time base: first presentation time and duration, after the edit
 * list (so AAC priming and the padding of the last frame are excluded), e.g. samples for 48 kHz audio.
 */
export async function durationTs(file: string, stream: 'v' | 'a'): Promise<{ ts: number; timeBase: string; start: number }> {
  const out = await run('ffprobe', ['-select_streams', `${stream}:0`, '-show_entries', 'stream=duration_ts,time_base,start_pts', '-of', 'json', file]);
  const s = (JSON.parse(out) as { streams: { duration_ts: number; time_base: string; start_pts: number }[] }).streams[0]!;
  return { ts: Number(s.duration_ts), timeBase: s.time_base, start: Number(s.start_pts) };
}
