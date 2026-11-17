/**
 * `Promise.all` that waits for every task before failing. A rejection is thrown only once no sibling is
 * still running, so a caller that then releases its scratch directory (or its custody) never does so under
 * a writer that is still going, such as a mux after a failed HTML or a capture chunk after a failed one.
 * The error thrown is the first rejection in time, the one that started the failure, not the first by
 * position. Tasks must end on their own: subprocesses carry deadlines (`run` in ffmpeg.ts).
 */
export async function settled<T>(tasks: Iterable<Promise<T>>): Promise<T[]> {
  const failed: { first?: { reason: unknown } } = {};
  const watched = [...tasks].map(t => t.catch(reason => {
    failed.first ??= { reason };
    return undefined as T;
  }));
  const values = await Promise.all(watched);
  if (failed.first) throw failed.first.reason;
  return values;
}
