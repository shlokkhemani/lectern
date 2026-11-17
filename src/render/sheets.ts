/**
 * Contact sheets (§7): one 640×360 tile per beat at its settle point, 3×4 tiles per 1920×1530 sheet (a last,
 * partial sheet is cut to the rows it uses), with a label strip, lint rects and
 * audio warnings drawn over the tiles (along the top edge, over the headline, so the burned-in subtitle stays
 * readable).
 */
import path from 'node:path';
import fs from 'node:fs/promises';
import type { Browser } from 'puppeteer-core';
import type { Script } from '../ir.ts';
import type { ScenePlan } from '../timing/types.ts';
import { toGlobal } from '../timing/global.ts';
import { frameAtOrAfter, frameTime } from '../timing/clock.ts';
import type { Rect } from '../blocks/contract.ts';
import type { LintIssue, SheetNotes } from './types.ts';
import { shoot } from './capture.ts';
import { STAGE } from './chrome.ts';
import { givePlan, type Pool } from './pool.ts';
import { settled } from './settled.ts';

const COLS = 3, ROWS = 4, TILE_W = 640, TILE_H = 360, LABEL = 22.5, PER_SHEET = COLS * ROWS;
const STAGE_W = 1280;
const FONT = new URL('../../theme/v2/fonts/GeistMono.woff2', import.meta.url).href;

interface Tile { image: Buffer; label: string; failed: boolean; lint: LintIssue[]; audio: string[] }

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/**
 * The tile times of a plan: for each beat, the first frame where its motion has settled and its first word has
 * begun (the frame its subtitle appears on), so the tile holds the picture and the subtitle a viewer sees for
 * that beat. A beat whose motion settles before its voice starts would otherwise show the previous beat's
 * lingering subtitle (DH S1·B1, S3·B2). `firstWord[b]` indexes the beat's first word in `plan.words` (-1: none).
 * A scene without beats: its last captured frame.
 */
function tileTimes(plan: ScenePlan, firstWord: number[]): number[] {
  if (!plan.beats.length) return [plan.capture[plan.capture.length - 1]!.t];
  return plan.beats.map((b, i) => {
    const voice = plan.words[firstWord[i]!]?.start;
    return voice === undefined || voice <= b.settle ? b.settle : frameTime(Math.min(plan.frameCount - 1, frameAtOrAfter(voice)));
  });
}

async function collectTiles(ir: Script, pool: Pool, plans: ScenePlan[], notes: SheetNotes): Promise<Tile[]> {
  const perScene = await settled(plans.map((plan, i) => pool.use(async p => {
    const k = plan.scene;
    await givePlan(p, k, plan);
    const scene = ir.scenes[k]!;
    const words = scene.beats.map(b => b.words.map(w => w.display).join(' '));
    const lint = notes.lint.filter(l => l.scene === k);
    const audio = notes.audio[k] ?? [];
    const firstWord = scene.beats.map((beat, bi) => beat.words.length ? scene.beats.slice(0, bi).reduce((n, b) => n + b.words.length, 0) : -1);
    const tiles: Tile[] = [];
    for (const [b, t] of tileTimes(plan, firstWord).entries()) {
      const image = await shoot(p, k, t, { format: 'jpeg', quality: 90 });
      const text = words[b] ?? '';
      const quote = text.length > 34 ? `${text.slice(0, 33).trimEnd()}…` : text;
      const mine = lint.filter(l => l.beat === b);
      const heard = audio.filter(a => a.word !== undefined && a.beat === b)
        .map(a => `${a.code} ${a.heard !== undefined ? `heard "${a.heard}": ` : ''}${a.message}`);
      tiles.push({
        image, lint: mine, audio: heard,
        label: `S${k}·B${b}  ${clock(toGlobal(plans, i, t))}  ${quote ? `"${quote}"` : ''}`,
        failed: mine.some(l => l.severity === 'error'),
      });
    }
    return tiles;
  })));
  return perScene.flat();
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

const S = TILE_W / STAGE_W;
const box = (cls: string, r: Rect, label = '') =>
  `<div class="${cls}" style="left:${r.x * S}px;top:${r.y * S}px;width:${r.w * S}px;height:${r.h * S}px">${label}</div>`;

/** The mark one issue draws on its tile: a box round what it found, labelled with its code. */
function issueMarks(l: LintIssue): string {
  return l.rect ? box('mark', l.rect, `<span>${esc(l.code)}</span>`) : '';
}

function sheetHtml(tiles: Tile[]): string {
  const cells = tiles.map(t => {
    const marks = t.lint.map(issueMarks).join('');
    const audio = t.audio.length ? `<div class="audio">${esc(t.audio.join(' · '))}</div>` : '';
    return `<div class="cell"><div class="tile"><img src="data:image/jpeg;base64,${t.image.toString('base64')}">${marks}${audio}</div>`
      + `<div class="label${t.failed ? ' fail' : ''}">${esc(t.label)}${t.lint.length ? `  ${esc(t.lint.map(l => l.code).join(' '))}` : ''}</div></div>`;
  }).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face { font-family: M; src: url(${FONT}); }
html, body { margin: 0; background: #0b0b0c; }
.grid { display: grid; grid-template-columns: repeat(${COLS}, ${TILE_W}px); grid-auto-rows: ${TILE_H + LABEL}px; width: ${COLS * TILE_W}px; height: ${ROWS * (TILE_H + LABEL)}px; }
.tile { position: relative; width: ${TILE_W}px; height: ${TILE_H}px; overflow: hidden; }
.tile img { width: 100%; height: 100%; display: block; }
.cell { position: relative; }
.cell::after { content: ''; position: absolute; inset: 0; border-right: 1px solid #2c2c30; border-bottom: 1px solid #2c2c30; pointer-events: none; }
.label { height: ${LABEL}px; line-height: ${LABEL}px; padding: 0 8px; font: 12px M, monospace; color: #a1a1a6; background: #161618; white-space: nowrap; overflow: hidden; }
.label.fail { color: #fff; background: #b42318; }
.mark { position: absolute; outline: 2px solid #f04438; }
.mark span { position: absolute; left: 0; top: -14px; font: 10px M, monospace; color: #fff; background: #f04438; padding: 0 3px; }
.audio { position: absolute; left: 0; right: 0; top: 0; padding: 2px 8px; font: 11px M, monospace; color: #1a1300; background: #f5b83d; white-space: nowrap; overflow: hidden; }
</style></head><body><div class="grid">${cells}</div></body></html>`;
}

/**
 * Write the sheets for `plans` (video order) into `dir`, removing the sheets an earlier run left there (and
 * nothing else); returns their paths. The sheets render at once, each on its own page, spread over the
 * browsers (pages of one browser share a renderer process).
 */
export async function writeSheets(ir: Script, browsers: Browser[], pool: Pool, plans: ScenePlan[], notes: SheetNotes, dir: string, workDir: string): Promise<string[]> {
  const tiles = await collectTiles(ir, pool, plans, notes);
  await fs.mkdir(dir, { recursive: true });
  const stale = (await fs.readdir(dir)).filter(f => /^sheet-\d+\.png$/.test(f));
  await settled(stale.map(f => fs.rm(path.join(dir, f), { force: true })));
  const width = COLS * TILE_W;
  return settled(Array.from({ length: Math.ceil(tiles.length / PER_SHEET) }, async (_, i) => {
    const mine = tiles.slice(i * PER_SHEET, (i + 1) * PER_SHEET);
    const height = Math.round(Math.ceil(mine.length / COLS) * (TILE_H + LABEL));
    const html = path.join(workDir, `sheet-${i}.html`);
    await Bun.write(html, sheetHtml(mine));
    const page = await browsers[i % browsers.length]!.newPage();
    try {
      await page.setViewport({ width, height: Math.round(ROWS * (TILE_H + LABEL)), deviceScaleFactor: STAGE.deviceScaleFactor });
      await page.goto(`file://${html}`, { waitUntil: 'load' });
      await page.evaluate(() => document.fonts.ready);
      const file = path.join(dir, `sheet-${String(i + 1).padStart(2, '0')}.png`);
      // The browser renders at the stage's device scale; scale back so a full sheet is 1920×1530 pixels.
      await page.screenshot({ path: file as `${string}.png`, type: 'png', clip: { x: 0, y: 0, width, height, scale: 1 / STAGE.deviceScaleFactor } });
      return file;
    } finally {
      await page.close();
    }
  }));
}
