/**
 * Capture: for each of the plan's capture runs, draw the page at the run's time and screenshot it. The
 * format is locked by calibration (docs/render-calibration.md).
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import type { ScenePlan } from '../timing/types.ts';
import { evaluate, givePlan, type PoolPage } from './pool.ts';
import { settled } from './settled.ts';

export const CAPTURE: CaptureFormat = { format: 'png' };
export type CaptureFormat = { format: 'jpeg'; quality: number } | { format: 'png' };

/** Draw scene k at t and return the screenshot bytes. */
export async function shoot(p: PoolPage, k: number, t: number, fmt: CaptureFormat = CAPTURE): Promise<Buffer> {
  await evaluate(p, `lectern.render(${k}, ${t})`);
  return screenshot(p, fmt);
}

async function screenshot(p: PoolPage, fmt: CaptureFormat): Promise<Buffer> {
  const { data } = await p.cdp.send('Page.captureScreenshot', fmt.format === 'jpeg'
    ? { format: 'jpeg', quality: fmt.quality, optimizeForSpeed: true }
    : { format: 'png', optimizeForSpeed: true });
  return Buffer.from(data, 'base64');
}

/**
 * Draw scene k at t; false when the stage's markup is what the previous `draw` on this page left. A frame is a
 * pure function of the stage's markup (the page has no canvas, scroll state or style outside `#stage`; the
 * speed audit found 0 of 1,133 repeated markups drawing a different image), so an unchanged markup needs no
 * new screenshot. A quarter of the capture runs repeat the frame before (a span's end, a subtitle cut).
 */
function draw(p: PoolPage, k: number, t: number): Promise<boolean> {
  // LECTERN_SHOOT_EVERY_RUN=1 (tests of the skip rule only) shoots every run, so a build can be compared without it.
  if (process.env.LECTERN_SHOOT_EVERY_RUN === '1') return evaluate<boolean>(p, `(lectern.render(${k}, ${t}), true)`);
  return evaluate<boolean>(p, `(() => { lectern.render(${k}, ${t}); const s = document.getElementById('stage');
    if (!s) return true; const m = s.innerHTML; const changed = m !== globalThis.__explainDrawn; globalThis.__explainDrawn = m; return changed; })()`);
}

/**
 * A digest of what runs [from, to) of scene k's plan show, or null for a page without a `#stage`: the page
 * around the stage (its head, and the html, body and stage tags) and, per run, the markup of each stage child
 * that is displayed. Equal digests draw equal images (a frame is a pure function of the markup, above), so the
 * digest keys a cached segment. Hidden scenes are left out, so that editing one scene leaves the others' keys
 * alone. Hidden markup could still reach the picture through a stylesheet, or through an id that the shown
 * markup references (`url(#id)`, `href="#id"`); in either case the run's digest takes the whole stage instead.
 */
export async function drawnDigest(p: PoolPage, k: number, plan: ScenePlan, from: number, to: number): Promise<string | null> {
  await givePlan(p, k, plan);
  return evaluate<string | null>(p, `(async ts => {
    const stage = document.getElementById('stage');
    if (!stage) return null;
    const sha = async s => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map(b => b.toString(16).padStart(2, '0')).join('');
    const head = document.head.outerHTML;   // ~0.7 MB with the fonts: digested once per page
    if (globalThis.__explainHead?.text !== head) globalThis.__explainHead = { text: head, digest: await sha(head) };
    const tag = e => e.cloneNode(false).outerHTML;
    const parts = [globalThis.__explainHead.digest, tag(document.documentElement), tag(document.body), tag(stage)];
    const sheets = !!stage.querySelector('style, link');
    for (const t of ts) {
      lectern.render(${k}, t);
      const shown = [...stage.children].filter(c => getComputedStyle(c).display !== 'none');
      // An emptied style attribute draws as none, and whether one is left depends on what the page drew before.
      const markup = shown.map(c => c.outerHTML).join('\\n').replaceAll(' style=""', '');
      const refs = [...markup.matchAll(/url\\((?:\\s|'|"|&quot;)*#([^\\s'")&]+)|href="#([^"]*)"/g)].map(r => r[1] ?? r[2]);
      const outside = refs.some(id => { const e = document.getElementById(id); return !e || !shown.some(c => c.contains(e)); });
      const m = sheets || outside ? 'stage:' + stage.innerHTML : 'shown:' + markup;
      parts.push(m.length + ':' + m);
    }
    return sha(parts.join('\\n'));
  })(${JSON.stringify(plan.capture.slice(from, to).map(c => c.t))})`);
}

/**
 * Capture runs [from, to) of scene k's plan into `dir` (all runs by default); returns their image paths in
 * run order, a repeated image under the path of its first capture. Any page draws any run identically, so one
 * scene's runs may be split across pages.
 */
export async function captureScene(p: PoolPage, k: number, plan: ScenePlan, dir: string, fmt: CaptureFormat = CAPTURE,
  from = 0, to = plan.capture.length): Promise<string[]> {
  await fs.mkdir(dir, { recursive: true });
  await givePlan(p, k, plan);
  const ext = fmt.format === 'jpeg' ? 'jpg' : 'png';
  const images: string[] = [];
  const writes: Promise<unknown>[] = [];
  try {
    for (let i = from; i < to; i++) {
      // The chunk's first run is always shot: there is no earlier image of this chunk to reuse.
      if (!await draw(p, k, plan.capture[i]!.t) && i > from) {
        images.push(images[images.length - 1]!);
        continue;
      }
      const file = path.join(dir, `${String(i).padStart(5, '0')}.${ext}`);
      writes.push(Bun.write(file, await screenshot(p, fmt)));
      images.push(file);
    }
  } finally {
    await Promise.allSettled(writes);   // no write outlives this call, even when a shot fails
  }
  await settled(writes);
  if (p.errors.length) throw new Error(`lectern page error in scene ${k}: ${p.errors[0]}`);
  return images;
}
