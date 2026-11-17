/**
 * A pool of identical pages, each with the script's page loaded and `window.lectern` ready. Callers borrow
 * a page for one job and give it back; pages never share state, so any job can run on any page.
 */
import type { Browser, CDPSession, Page } from 'puppeteer-core';
import type { ScenePlan } from '../timing/types.ts';
import { STAGE } from './chrome.ts';
import { settled } from './settled.ts';

export interface PoolPage {
  page: Page;
  cdp: CDPSession;
  /** Scenes whose plan this page already holds, by identity. */
  plans: Map<number, ScenePlan>;
  errors: string[];
}

/** Open one page on `url` in `browser` and wait until `lectern.ready` resolves. */
async function openPage(browser: Browser, url: string): Promise<PoolPage> {
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e instanceof Error ? e.message : String(e)));
  await page.setViewport({ ...STAGE });
  await page.goto(url, { waitUntil: 'load', timeout: 120_000 });
  await page.evaluate(() => window.lectern.ready);
  if (errors.length) throw new Error(`lectern page failed to load: ${errors[0]}`);
  return { page, cdp: await page.createCDPSession(), plans: new Map(), errors };
}

export class Pool {
  private idle: PoolPage[] = [];
  private waiting: ((p: PoolPage) => void)[] = [];

  private constructor(readonly pages: PoolPage[], private browsers: Browser[], private url: string) { this.idle = [...pages]; }

  /**
   * Open `n` pages on `url`, spread round-robin over `browsers`, and wait until each page's
   * `lectern.ready` resolves. Each browser composites in one process, so capture scales with browsers.
   */
  static async open(browsers: Browser[], url: string, n: number): Promise<Pool> {
    const pages = await settled(Array.from({ length: n }, (_, i) => openPage(browsers[i % browsers.length]!, url)));
    return new Pool(pages, browsers, url);
  }

  /**
   * Run `job` on a borrowed page. With `retry`, a job that fails runs once more on a fresh page that replaces
   * the failed one (a page that timed out or crashed is not trusted again); a second failure is thrown.
   * Retry only jobs whose output depends on nothing but their arguments, such as capture chunks.
   */
  async use<T>(job: (p: PoolPage) => Promise<T>, opts: { retry?: boolean } = {}): Promise<T> {
    let p = this.idle.pop() ?? await new Promise<PoolPage>(r => this.waiting.push(r));
    try {
      try {
        return await job(p);
      } catch (e) {
        if (!opts.retry) throw e;
        p = await this.replace(p).catch(() => { throw e; });
        return await job(p);
      }
    } finally {
      const next = this.waiting.shift();
      if (next) next(p); else this.idle.push(p);
    }
  }

  /** Close `old` and open a fresh page in its slot: in its own browser, else in any other that still works. */
  private async replace(old: PoolPage): Promise<PoolPage> {
    await Promise.race([old.page.close().catch(() => {}), Bun.sleep(2000)]);   // a crashed page may never answer
    const own = old.page.browser();
    let last: unknown;
    for (const b of [own, ...this.browsers.filter(x => x !== own)]) {
      try {
        const fresh = await openPage(b, this.url);
        const i = this.pages.indexOf(old);
        if (i >= 0) this.pages[i] = fresh;
        return fresh;
      } catch (e) { last = e; }
    }
    throw last;
  }
}

/** Evaluate an expression in the page; page exceptions become errors. */
export async function evaluate<T = unknown>(p: PoolPage, expression: string): Promise<T> {
  const r = await p.cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(`lectern page: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
  return r.result.value as T;
}

/** Make sure the page holds `plan` for scene k. */
export async function givePlan(p: PoolPage, k: number, plan: ScenePlan): Promise<void> {
  if (p.plans.get(k) === plan) return;
  await evaluate(p, `lectern.plan(${k}, ${JSON.stringify(plan)})`);
  p.plans.set(k, plan);
}
