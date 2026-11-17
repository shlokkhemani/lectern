/**
 * Custody of an output directory: at most one build (or check) works in it at a time, and only the holder
 * may withdraw, publish or clean up there.
 *
 * The mechanism is the kernel's advisory lock, `flock(2)`, on `<outDir>/.lectern.lock`. The kernel grants an
 * exclusive lock to one open file description at a time, so there can be only one owner. The lock lives on
 * that open descriptor: closing it, or the process dying (SIGINT, SIGKILL, a crash), releases it. Nothing
 * is ever read and then unlinked, so there is no takeover race. It sits in the output directory, outside the
 * `.work/` scratch the build deletes.
 *
 * Release removes the file while still holding its lock, then closes, so a finished build leaves no lock
 * behind (a killed one leaves a file whose text is not the lock). A contender that opened the file before
 * it was removed may then lock an inode no path names; so a lock counts only if the path still names the
 * locked inode, else the contender opens the path again. Only a holder removes the file, and the path names
 * a holder's inode for as long as it holds, so every owner locks the inode the path names.
 * Design it twice: never removing the file needs no inode check, but leaves a stale file in every out dir.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { dlopen, FFIType, read } from 'bun:ffi';

const LOCK_EX = 2, LOCK_NB = 4;
const darwin = process.platform === 'darwin';
const libc = dlopen(darwin ? 'libSystem.B.dylib' : 'libc.so.6', {
  flock: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 },
  // The calling thread's errno cell.
  [darwin ? '__error' : '__errno_location']: { args: [], returns: FFIType.ptr },
} as const);
const errnoCell = (libc.symbols as unknown as Record<string, () => number>)[darwin ? '__error' : '__errno_location']!;
/** EWOULDBLOCK (= EAGAIN): the lock is held by another open file. 35 on macOS, 11 on Linux. */
export const EWOULDBLOCK = darwin ? 35 : 11;

/**
 * One non-blocking attempt at the exclusive lock on `fd`: 0 when taken, else the errno, read immediately
 * after the call (before any other libc call on this thread can overwrite it).
 */
export function tryLock(fd: number): number {
  if (libc.symbols.flock(fd, LOCK_EX | LOCK_NB) === 0) return 0;
  return read.i32(errnoCell()!, 0);
}

/** Another live build or check holds the output directory; it, not this one, owns what is there. */
class BusyError extends Error {
  readonly code = 'R700';
}

const LOCK_NAME = '.lectern.lock';
/** Where each invocation's private scratch directory lives, under the output directory. */
const SCRATCH = '.work';

const stampPid = (fd: number) => { fs.ftruncateSync(fd, 0); fs.writeSync(fd, String(process.pid), 0); };

export class Custody {
  /**
   * This invocation's own scratch directory, `<dir>/.work/<unique>`. Nothing else ever uses it: a writer
   * orphaned by an earlier, killed build can only touch its own directory, never this one.
   */
  readonly scratch: string;

  private constructor(private fd: number | undefined, readonly dir: string) {
    this.scratch = path.join(dir, SCRATCH, `run-${process.pid}-${randomBytes(4).toString('hex')}`);
  }

  /**
   * Take custody of `dir` (created if missing). Throws BusyError at once if another open file holds the lock
   * (EWOULDBLOCK), and any other failure as itself. The descriptor is closed on every failure; the caller
   * owns it only through the returned Custody.
   */
  static acquire(dir: string): Custody {
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, LOCK_NAME);
    for (;;) {
      const fd = fs.openSync(file, fs.constants.O_RDWR | fs.constants.O_CREAT, 0o644);
      try {
        const errno = tryLock(fd);
        if (errno === EWOULDBLOCK) {
          let holder = '';
          try { holder = fs.readFileSync(file, 'utf8').trim(); } catch { /* the message only */ }
          throw new BusyError(`R700: another build${holder ? ` (pid ${holder})` : ''} is working in ${dir}; wait for it, or build into another --out`);
        }
        if (errno !== 0) throw new Error(`custody: flock on ${file} failed (errno ${errno})`);
        // The holder before us removed the file we opened: open the path again.
        if (!names(file, fd)) { fs.closeSync(fd); continue; }
        // For the message above only: who holds it. The lock is the descriptor, not this text.
        stampPid(fd);
        const custody = new Custody(fd, dir);
        fs.mkdirSync(custody.scratch, { recursive: true });
        return custody;
      } catch (e) {
        fs.closeSync(fd);
        throw e;
      }
    }
  }

  get held(): boolean { return this.fd !== undefined; }

  /**
   * Remove every other invocation's scratch directory: left by builds that died, or kept with --keep. Only
   * the holder may; no live build can be using them, since every build holds custody for its whole life.
   */
  async sweep(): Promise<void> {
    this.assertHeld();
    const root = path.join(this.dir, SCRATCH);
    const mine = path.basename(this.scratch);
    const entries = await fsp.readdir(root).catch(() => [] as string[]);
    await Promise.allSettled(entries.filter(e => e !== mine).map(e => fsp.rm(path.join(root, e), { recursive: true, force: true })));
  }

  /** Remove this invocation's own scratch directory. */
  async clean(): Promise<void> {
    this.assertHeld();
    await fsp.rm(this.scratch, { recursive: true, force: true });
  }

  private assertHeld(): void {
    if (this.fd === undefined) throw new Error(`custody of ${this.dir} is not held`);
  }

  /** Release custody: remove the lock file, then close the locked descriptor (the kernel drops the lock with it). Idempotent. */
  release(): void {
    if (this.fd === undefined) return;
    const fd = this.fd;
    this.fd = undefined;
    const file = path.join(this.dir, LOCK_NAME);
    try { if (names(file, fd)) fs.unlinkSync(file); } finally { fs.closeSync(fd); }
  }
}

/** Whether `file` names the inode open on `fd`. */
function names(file: string, fd: number): boolean {
  const open = fs.fstatSync(fd);
  const at = fs.statSync(file, { throwIfNoEntry: false });
  return at !== undefined && at.ino === open.ino && at.dev === open.dev;
}
