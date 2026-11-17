/**
 * The step-through player (§6), bundled only into the exported HTML, never into capture pages. It reads
 * the plans (`#lectern-plans`) and narration (`#lectern-narration`) the exporter embeds, and drives
 * `window.lectern.render` from one clock: the audio element's time, or a frame-callback clock when
 * there is no audio. `locate` (timing) maps that global time to (scene, t); ←/→ step between beat settle
 * points; space plays and pauses. Play after loading or a step starts at the start of the beat on screen. The controls sit outside the stage; the subtitles are in it (the page draws them).
 */
import type { Script } from '../ir.ts';
import type { ScenePlan } from '../timing/types.ts';
// The global clock only: the timing index also carries the theme reader (`import.meta`, the block registry),
// which cannot run in a classic inline script.
import { locate, toGlobal } from '../timing/global.ts';

const CSS = `
html, body { height: 100%; }
body { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--space-4);
  font-family: var(--font-sans); color: var(--ink-2); overflow: hidden; }
.p-frame { position: relative; flex: none; overflow: hidden; border-radius: var(--radius-field); }
.p-frame #stage { position: absolute; left: 0; top: 0; transform-origin: 0 0; }
.p-bar { display: flex; align-items: center; gap: var(--space-4); font-size: var(--text-meta); font-variant-numeric: var(--numeric); }
.p-bar button { background: var(--surface-2); color: var(--ink-1); border: 0; border-radius: var(--radius-cell);
  padding: var(--space-1) var(--space-3); font: inherit; cursor: pointer; }
.p-bar button:hover { background: var(--surface-3); }
.p-bar input[type=range] { width: calc(var(--measure-max) * 1.2); accent-color: var(--ink-2); }
.p-bar select { background: var(--surface-2); color: var(--ink-1); border: 0; border-radius: var(--radius-cell);
  padding: var(--space-1) var(--space-2); font: inherit; }
.p-time { color: var(--ink-3); min-width: calc(var(--space-8) * 1.5); }
`;

const json = <T>(id: string): T | undefined => {
  const el = document.getElementById(id);
  return el?.textContent ? (JSON.parse(el.textContent) as T) : undefined;
};

async function main(): Promise<void> {
  const page = window.lectern;
  const ir = json<Script>('lectern-ir')!;
  const plans = json<ScenePlan[]>('lectern-plans') ?? [];
  const audio = document.getElementById('lectern-narration') as HTMLAudioElement | null;
  await page.ready;
  plans.forEach(p => page.plan(p.scene, p));
  const total = toGlobal(plans, plans.length, 0);   // the end of the last scene
  const stops = plans.flatMap((p, k) => p.beats.map(b => toGlobal(plans, k, b.settle)));
  const starts = plans.flatMap((p, k) => p.beats.map(b => toGlobal(plans, k, b.start)));

  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const stage = document.getElementById('stage')!;
  const frame = document.createElement('div');
  frame.className = 'p-frame';
  stage.replaceWith(frame);
  frame.appendChild(stage);
  const bar = el('div', 'p-bar');
  document.body.append(bar);
  const play = button(bar, 'Play');
  const prev = button(bar, '←');
  const next = button(bar, '→');
  const scrub = el('input', '', bar) as HTMLInputElement;
  Object.assign(scrub, { type: 'range', min: '0', max: '1000', value: '0' });
  const time = el('span', 'p-time', bar);
  const list = el('select', '', bar) as HTMLSelectElement;
  plans.forEach((p, k) => {
    const s = ir.scenes[p.scene]!;
    const o = document.createElement('option');
    o.value = String(k);
    o.textContent = `${p.scene + 1}. ${s.headline ? plainText(s.headline) : s.chapter?.text ?? 'untitled'}`;
    list.appendChild(o);
  });

  // `from`: where the next Play starts, set by loading or a step (the settle point is only the still picture).
  let g = 0, playing = false, last: number | undefined, from: number | undefined;
  const fit = () => {
    const s = Math.min(innerWidth * 0.92 / stage.offsetWidth, (innerHeight - bar.offsetHeight - 64) / stage.offsetHeight);
    stage.style.transform = `scale(${s})`;
    frame.style.width = `${stage.offsetWidth * s}px`;
    frame.style.height = `${stage.offsetHeight * s}px`;
  };
  const draw = () => {
    if (!plans.length) return;
    const { scene: k, t } = locate(plans, g);
    const p = plans[k]!;
    page.render(p.scene, t);
    scrub.value = String(Math.round((g / Math.max(total, 1e-9)) * 1000));
    time.textContent = `${clock(g)} / ${clock(total)}`;
    list.value = String(k);
  };
  const seek = (to: number) => {
    g = Math.max(0, Math.min(total, to));
    from = undefined;
    if (audio && audio.src) audio.currentTime = g;
    draw();
  };
  const setPlaying = (on: boolean) => {
    playing = on && plans.length > 0;
    if (playing && from !== undefined) seek(from);
    play.textContent = playing ? 'Pause' : 'Play';
    if (audio && audio.src) { if (playing) void audio.play(); else audio.pause(); }
    last = undefined;
  };
  const tick = (ts: number) => {
    if (playing) {
      if (audio && audio.src) g = audio.currentTime;
      else { if (last !== undefined) g += (ts - last) / 1000; last = ts; }
      if (g >= total) { g = total; setPlaying(false); }
      draw();
    }
    requestAnimationFrame(tick);
  };
  const step = (dir: 1 | -1) => {
    setPlaying(false);
    const eps = 1e-3;
    const i = dir > 0 ? stops.findIndex(s => s > g + eps) : stops.reduce((j, s, k) => (s < g - eps ? k : j), -1);
    seek(i >= 0 ? stops[i]! : dir > 0 ? total : 0);
    if (i >= 0) from = starts[i];
  };

  play.onclick = () => setPlaying(!playing);
  prev.onclick = () => step(-1);
  next.onclick = () => step(1);
  scrub.oninput = () => seek((Number(scrub.value) / 1000) * total);
  list.onchange = () => seek(toGlobal(plans, Number(list.value), 0));
  addEventListener('keydown', (e: KeyboardEvent) => {
    // Handled keys never reach a focused control: the scrubber would otherwise move again after the step.
    if (e.key === ' ') { e.preventDefault(); setPlaying(!playing); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
  });
  addEventListener('resize', fit);
  fit();
  seek(stops[0] ?? 0);
  from = 0;
  requestAnimationFrame(tick);
}

function el(tag: string, cls: string, parent?: Element): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  parent?.appendChild(e);
  return e;
}

function button(parent: Element, label: string): HTMLButtonElement {
  const b = el('button', '', parent) as HTMLButtonElement;
  b.textContent = label;
  return b;
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const plainText = (c: Script['scenes'][number]['headline'] & object): string => c.map(r => (typeof r === 'string' ? r : plainText(r.children))).join('');

void main();
