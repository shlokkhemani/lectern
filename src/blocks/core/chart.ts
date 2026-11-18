/**
 * `chart`: a bar or a line chart.
 * - bar (the default): `label: value` lines. Horizontal bars, label left, value at the bar's end. Items are
 *   bars keyed by label. `[set ch:2 40]` animates the bar to 40 and counts the value up.
 *   Grouped: a first line `series: noon sunset` (two names), then `label: v1 v2` lines, one value per
 *   series. Each row draws one bar per series, stacked tightly in series order, under a legend of short bars.
 *   Items are the rows (keyed by label, `ch:blue`; number selectors count rows only), then the bars, keyed
 *   `row.series` (`ch:blue.noon`; a row with a `#name` keys its bars by the name). A bar is `set` on its own
 *   key, one number; a row has no value to set. Series fills are a light and a dark grey (`--chart-series-1`,
 *   `--chart-series-2`); only the first series takes a row's or the block's `hl` lift, so a lit row never loses
 *   which bar is which; a bar's own `hl` lifts that bar.
 * - A `set` the chart cannot draw (not a number, the wrong count, at or below 0 on `log`, or on a grouped row)
 *   is the author's L405 (`lint`), placed at its cue.
 * - Axis titles: `x="…"` titles the value axis (under a line chart's x labels, under the bars), `y="…"` the
 *   other (above the y labels, or above a bar chart's label column), left-aligned and never rotated.
 * - `log`: the value axis runs in powers of ten (`logTicks`); every value must be above 0. A bar chart then
 *   draws its value axis under the bars, from the power of ten below its smallest value, so every bar has
 *   length (a bar sitting on the base would read as nothing); value labels show the real values.
 * - line: a first line `x: a b c` makes a line chart. Then `name: v v v` series lines, one value per x label; items are series keyed by name, and
 *   `[set ch:name 3 5 8]` morphs the line. Annotations, each an item (keys `mark1`, `point1`, `band1`…, or
 *   a `#name`):
 *   - `mark 35: Ella stops`: a vertical marker at x = 35 (an x label, or a number between numeric labels),
 *     its label above the plot.
 *   - `point Ella 65: retires`: a dot on series Ella at x = 65; the label defaults to the value there.
 *   - `band gross net: lost to fees`: the area between two series, shaded; the label defaults to the gap
 *     at the last x.
 *   A series is named by its key, or by its `#name` (so "1% fee: … #net" is `net` here).
 *   `[move ch:point1 1.22]` slides a point along its series to an x (`movers`); its position is `ItemState.at`
 *   in label units. A point that moves in the scene carries its label in a row above the plot reserved across
 *   its whole sweep, riding straight above the dot.
 * `format=` sets how values and the y axis read: `$` ($76k, $1.2M), `%` (7%), or a template with `#` for
 * the number: `$#k`, `#ms`, `#.00` (fixed decimals). Without a suffix, values of 10,000 and up compact
 * to k/M/B. `grow` draws bars from the baseline and lines from the left. The value scale spans every value
 * the chart can show in the scene (declared and set), rounded out to 3–5 nice y ticks, so it never rescales
 * mid-scene. Bars always start at 0 (a bar's length is its value). A line chart's axis starts at 0 too unless
 * the data sits far from it (`axisTicks`): 147 to 152 gets an axis from 146, not a flat line at the top. Flexible: the bar track or plot width takes the region's spare width between
 * `--chart-plot-w-min` and `--chart-plot-w-max`; the plot height opens with the flexible pitch.
 *
 * Bars are solid neutral fills (`--chart-bar`); `hl` lifts the bar (`--chart-bar-hl`) and marks its value end
 * with the highlight bar (amber while now, `--hl-held-bar` when held); the value is the glyph (amber while
 * now). Lines are strokes in `--ink-2`, `--hl-held-ink` when held, amber while now, `--ink-4` when receded,
 * each named at its right end (no legend) when there are several; a lone series is named by the caption.
 * Labels never meet, at any instant: series names sit in fixed lanes beside the plot (from every end value
 * each series can reach in the scene); mark labels sit in rows above the plot; a point's label takes the first place around its dot that clears every line the scene can draw;
 * a band's label sits inside the band where it fits, else in a lane. Every label lies inside the block.
 */
import type { Inline, ItemDecl, Loc, Reachable } from '../../ir.ts';
import type { BlockLintIssue, BlockModule, Channels, Content, ItemState, Movers } from '../contract.ts';
import { channels, envelope, h, inherit, maxContent, num, pitchOf, plain, scaleOf, showContent, style, svg, token, type Envelope } from '../kit.ts';

// ---------------------------------------------------------------- body

/**
 * How values read: `prefix` + number + `suffix`; fixed `decimals` if given. No suffix and no decimals = compact (76k, 1.2M).
 * `log`: the chart is on a log axis, where a value's magnitude is what it shows, so a value under 1 keeps two
 * significant digits (0.0025), and under 0.001 reads in e-notation (2.1e-6; a power of ten as 1e-12). Never 0.
 */
interface Format { prefix: string; suffix: string; decimals?: number; log?: true }
/** Axis titles as written: `x` the value axis of a bar chart or the x axis of a line chart; `y` the other. */
interface Titles { x?: string; y?: string }
/** A bar chart row: one value per series (one value without a series line); `bars`: the item key of each bar when grouped. */
interface Row { key: string; values: number[]; bars: string[] }
interface Series { key: string; values: number[] }
/** `x` is a position along the x axis in label units: an index, or a fraction between two indices. */
interface Mark { key: string; x: number; label?: Inline }
interface Point { key: string; series: string; x: number; label?: Inline }
interface Band { key: string; a: string; b: string; label?: Inline }
type ChartBody =
  | { kind: 'bar'; format: Format; titles: Titles; log: boolean; series: string[]; rows: Row[] }
  | { kind: 'line'; format: Format; titles: Titles; log: boolean; x: string[]; series: Series[]; marks: Mark[]; points: Point[]; bands: Band[] };

const NUM = /^[-+]?(\d+(\.\d*)?|\.\d+)$/;
const ANNOTATION = /^(mark|point|band)\s+(.+)$/;
/** Grouped bars: neutral fills tell series apart, and past two greys they no longer read as different (round 5). */
const MAX_SERIES = 2;

export const chart: BlockModule<ChartBody> = {
  type: 'chart',
  pack: 'core',
  args: { format: 'string', x: 'string', y: 'string', log: 'flag' },
  flexible: true,
  parse(body, args, ctx) {
    const lines = body.filter(l => l.text.trim());
    const at = lines[0]?.loc ?? body[0]?.loc ?? { line: 0, col: 0 };
    const log = args.log === true;
    let format: Format = { prefix: '', suffix: '' };
    if (typeof args.format === 'string') {
      const f = parseFormat(args.format);
      if (!f) ctx.error(at, 'E137', `format "${args.format}" is not a number format`, 'write format=$ ($76k), format=% (7%), or a template with # for the number: format=$#k, format=#ms, format=#.00');
      format = f!;
    }
    if (log) format = { ...format, log: true };
    const titles: Titles = { ...(typeof args.x === 'string' ? { x: args.x } : {}), ...(typeof args.y === 'string' ? { y: args.y } : {}) };
    // A body that opens with x labels is a line chart; any other is a bar chart.
    const kind: 'bar' | 'line' = lines[0] && /^\s*x\s*:/.test(lines[0].text) ? 'line' : 'bar';
    const items: ItemDecl[] = [];
    const seen = new Map<string, Loc>();
    type L = (typeof lines)[number];
    const lineForm = 'a line chart is "x: 0 5 10" and then one "name: 1 2 3" line per series';
    const entry = (l: L) => {
      const m = l.text.match(/^\s*([^:]+?)\s*:\s*(.*)$/);
      if (!m) ctx.error(l.loc, 'E137', `chart line "${l.text.trim()}" has no ":"`, /^(bar|line)$/.test(l.text.trim())
        ? `remove the "${l.text.trim()}" line: a chart whose body starts with "x: …" is a line chart, any other a bar chart`
        : kind === 'bar' ? 'write each bar as "label: value", e.g. "Go: 42"' : `${lineForm}; annotations are "mark 35: label", "point Ella 65", "band gross net"`);
      return { key: m![1]!, rest: m![2]!.trim() };
    };
    const claim = (key: string, l: L, what: string) => {
      const prev = seen.get(key);
      if (prev) ctx.error(l.loc, 'E137', `${what} "${key}" is already declared at line ${prev.line}`, `give each ${what} a distinct name`);
      seen.set(key, l.loc);
      items.push({ key, index: items.length + 1, kind: what, loc: l.loc, ...(l.name ? { name: l.name } : {}) });
    };
    const number = (s: string, l: L) => {
      if (!NUM.test(s)) {
        const bare = s.replace(/[$€£¥,%\s]|k$|m$/gi, '');
        ctx.error(l.loc, 'E137', `"${s}" is not a number`, NUM.test(bare) && bare !== s
          ? `write the plain number ${bare} and say how it reads on the declaration, e.g. "::: chart id format=$" shows $76k`
          : 'write plain numbers like 42 or 3.5; units go in format= on the declaration');
      }
      return Number(s);
    };
    const aboveZero = (values: number[], what: string, key: string, l: L) => {
      const low = log ? values.find(v => v <= 0) : undefined;
      if (low !== undefined) ctx.error(l.loc, 'E137', `${what} "${key}" has ${low}, and a log scale shows only values above 0`,
        `remove "log" from the ::: chart line, or give "${key}" ${values.length > 1 ? 'values' : 'a value'} above 0`);
      return values;
    };

    if (kind === 'bar') {
      // Grouped bars open with `series: a b`; a bar that happens to be labelled "series" has one number.
      const head = lines[0] && /^\s*series\s*:/.test(lines[0].text) && !NUM.test(entry(lines[0]).rest) ? lines.shift()! : undefined;
      const series = head ? entry(head).rest.split(/\s+/).filter(Boolean) : [];
      const seriesLine = `"series: ${series.join(' ')}"`;
      if (head) {
        const example = '"series: noon sunset", then one value per series on each line: "blue: 80 0.02"';
        if (series.length < 2) ctx.error(head.loc, 'E137', 'grouped bars need two or more series', `name every series on the first line: ${example}`);
        if (series.length > MAX_SERIES) ctx.error(head.loc, 'E137', `grouped bars take at most ${MAX_SERIES} series; this has ${series.length}`, `keep ${MAX_SERIES} series on the ${seriesLine} line and their values, or split the chart in two`);
        const twice = series.find((s, i) => series.indexOf(s) !== i);
        if (twice) ctx.error(head.loc, 'E137', `series "${twice}" is named twice`, 'give each series a distinct name');
      }
      const rows = lines.map(l => {
        const { key, rest } = entry(l);
        if (ANNOTATION.test(key)) ctx.error(l.loc, 'E137', `"${key.split(/\s/)[0]}" annotations are for line charts`, `${lineForm}; then "${l.text.trim()}"`);
        const words = rest.split(/\s+/).filter(Boolean);
        if (!head && (key === 'x' || words.length > 1)) ctx.error(l.loc, 'E137', `bar "${key}" has more than one value`, `${lineForm}; a bar chart is one "label: value" line per bar; grouped bars start with "series: a b"`);
        if (head && words.length !== series.length) ctx.error(l.loc, 'E137', `"${key}" has ${words.length} value${words.length === 1 ? '' : 's'} for ${series.length} series`,
          `give "${key}" exactly ${series.length} values, one per series on the ${seriesLine} line`);
        claim(key, l, head ? 'row' : 'bar');
        return { key, name: l.name, loc: l.loc, values: aboveZero((head ? words : [rest]).map(w => number(w, l)), head ? 'row' : 'bar', key, l) };
      });
      if (!rows.length) ctx.error(at, 'E130', 'bar chart has no bars', head ? 'write one "label: v1 v2" line per row, one value per series' : 'write one "label: value" line per bar');
      // The bars after every row, so `ch:2` and `ch:1-3` still count rows.
      const bars = rows.map(r => series.map(s => {
        const key = `${r.name ?? r.key}.${s}`;
        if (seen.has(key)) ctx.error(r.loc, 'E137', `bar "${key}" is declared twice`, `rename the row "${r.key}" or the series "${s}"`);
        seen.set(key, r.loc);
        items.push({ key, index: items.length + 1, kind: 'bar', loc: r.loc });
        return key;
      }));
      return { body: { kind, format, titles, log, series, rows: rows.map((r, i) => ({ key: r.key, values: r.values, bars: bars[i]! })) }, items };
    }

    const head = lines.shift();
    const x = head ? entry(head) : undefined;
    if (!head || x!.key !== 'x') ctx.error(head?.loc ?? at, 'E137', 'a line chart starts with its x labels', 'write the x labels first, then one line per series: "x: 0 5 10" then "simple: 10 13.5 17"');
    const xs = x!.rest.split(/\s+/).filter(Boolean);
    if (xs.length < 2) ctx.error(head!.loc, 'E137', 'a line chart needs at least two x labels', 'write "x: a b c"');
    const xAt = (s: string, l: L): number =>
      xIndex(xs, s) ?? ctx.error(l.loc, 'E137', `x "${s}" is not on this chart's x axis`, `use one of the x labels: ${xs.join(' ')}`);
    const series: Series[] = [], marks: Mark[] = [], points: Point[] = [], bands: Band[] = [];
    /** `mark 35: label`, `point Ella 65`, `band a b: label`; a series that happens to be named "mark 3" has numbers after its colon. */
    const annotation = (l: L) => {
      const m = ANNOTATION.exec(l.text.trim());
      if (!m) return undefined;
      const colon = m[2]!.indexOf(':');
      const after = colon < 0 ? '' : m[2]!.slice(colon + 1).trim();
      const vals = after.split(/\s+/).filter(Boolean);
      if (vals.length === xs.length && vals.every(v => NUM.test(v))) return undefined;
      return { kind: m[1] as 'mark' | 'point' | 'band', words: (colon < 0 ? m[2]! : m[2]!.slice(0, colon)).trim().split(/\s+/).filter(Boolean), label: after };
    };
    const named = lines.filter(l => !annotation(l));
    const names = named.map(l => entry(l).key);
    // An annotation names a series by its key, or by its #name (the way to reach "1% fee").
    const alias = new Map(named.flatMap(l => (l.name ? [[l.name, entry(l).key] as const] : [])));
    const seriesOf = (s: string, l: L) => names.includes(s) ? s : alias.get(s) ?? ctx.error(l.loc, 'E137', `"${s}" is not a series of this chart`,
      `name one of: ${names.map(n => (/\s/.test(n) ? `${n} (give it a #name to use here)` : n)).join(', ')}`);
    for (const l of lines) {
      const a = annotation(l);
      if (!a) {
        const { key, rest } = entry(l);
        claim(key, l, 'series');
        const values = rest.split(/\s+/).filter(Boolean).map(v => number(v, l));
        if (values.length !== xs.length) ctx.error(l.loc, 'E137', `series "${key}" has ${values.length} values for ${xs.length} x labels`, `give "${key}" exactly ${xs.length} values, one per x label (${xs.join(' ')})`);
        series.push({ key, values: aboveZero(values, 'series', key, l) });
        continue;
      }
      const key = `${a.kind}${{ mark: marks, point: points, band: bands }[a.kind].length + 1}`;
      const label = a.label ? { label: ctx.inline(a.label, l.loc) } : {};
      if (a.kind === 'mark') {
        if (a.words.length !== 1) ctx.error(l.loc, 'E137', 'a mark takes one x', `write "mark ${xs[1]}: label" (the label is optional)`);
        marks.push({ key, x: xAt(a.words[0]!, l), ...label });
      } else if (a.kind === 'point') {
        if (a.words.length !== 2) ctx.error(l.loc, 'E137', 'a point takes a series and an x', `write "point ${names[0]} ${xs[xs.length - 1]}: label" (the label is optional; it defaults to the value)`);
        points.push({ key, series: seriesOf(a.words[0]!, l), x: xAt(a.words[1]!, l), ...label });
      } else {
        if (a.words.length !== 2 || a.words[0] === a.words[1]) ctx.error(l.loc, 'E137', 'a band lies between two series', `write "band ${names[0]} ${names[1] ?? 'other'}: label" (the label is optional; it defaults to the gap at the end)`);
        bands.push({ key, a: seriesOf(a.words[0]!, l), b: seriesOf(a.words[1]!, l), ...label });
      }
      claim(key, l, a.kind);
    }
    if (!series.length) ctx.error(head!.loc, 'E130', 'line chart has no series', 'add a line "name: 1 2 3" under the x labels');
    return { body: { kind, format, titles, log, x: xs, series, marks, points, bands }, items };
  },
  verbs: { show: ['block', 'items'], hide: ['block', 'items'], hl: ['block', 'items', 'none'], dim: ['block', 'items'], set: ['items'], grow: ['block', 'items'], move: ['items'] },
  movers: body => (body.kind === 'line' ? lineMovers(body) : barMovers(body)),
  runtime: {
    mount(el, body, _args, reachable, caption) {
      style('chart', CSS);
      el.classList.add('ch-chart', 'xp');
      const cap = caption ? h('div', 'x-caption ch-cap ch-rest', el) : undefined;
      if (cap) { cap.textContent = caption!; cap.dataset.leaf = ''; }
      if (body.kind === 'bar') mountBars(el, body, reachable.items, cap);
      else mountLines(el, body, reachable, cap);
    },
    measure(el, width) {
      const d = doms.get(el)!;
      // A theme may pad the chart (a sheet of paper around it): the plot is sized inside the padding.
      const cs = getComputedStyle(el), pad = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
      const { natural } = d.kind === 'bar' ? measureBars(el, d, width - pad) : measureLines(el, d, width - pad);
      if (!pad) return { natural, height: el.offsetHeight };
      el.style.width = `${natural + pad}px`;
      return { natural: natural + pad, height: el.offsetHeight };
    },
    lint(el) {
      return [...doms.get(el)!.unset.values()];
    },
    render(el, s) {
      const d = doms.get(el)!;
      // Recession once per part: the root owns visibility; axes and caption recede through --ch-recede; bars,
      // series and annotations recede through inherit().
      channels(el, { vis: s.self.vis });
      el.style.setProperty('--ch-recede', num(s.self.recede));
      if (d.kind === 'bar') renderBars(d, s.self, s.items);
      else renderLines(d, s.self, s.items);
    },
  },
};

// ---------------------------------------------------------------- moving points

/** An x as annotations and `move` write it → its position in label units (fractional between numeric labels). */
function xIndex(xs: string[], s: string): number | undefined {
  const i = xs.indexOf(s);
  if (i >= 0) return i;
  const vs = xs.map(Number);
  const numeric = xs.every(v => NUM.test(v)) && vs.every((v, k) => k === 0 || v > vs[k - 1]!);
  if (!numeric || !NUM.test(s)) return undefined;
  const v = Number(s);
  if (v < vs[0]! || v > vs[vs.length - 1]!) return undefined;
  const j = vs.findIndex((w, k) => k > 0 && v <= w);
  return j - 1 + (v - vs[j - 1]!) / (vs[j]! - vs[j - 1]!);
}

/** A line chart's points slide along their series; a position is an x label, or a number between numeric ones. */
function lineMovers(body: Extract<ChartBody, { kind: 'line' }>): Movers {
  const xs = body.x, last = xs[xs.length - 1]!, mid = xs[Math.floor((xs.length - 1) / 2)]!;
  const numeric = xs.every(v => NUM.test(v)) && xs.every((v, i) => i === 0 || Number(v) > Number(xs[i - 1]));
  return {
    home: Object.fromEntries(body.points.map(p => [p.key, p.x])),
    stop(key, text, _from, { target, block }) {
      const point = body.points.find(p => p.key === key);
      if (!point) {
        // Not a point: say which point would move, or how to add one.
        const kind = body.series.some(s => s.key === key) ? 'series' : key.replace(/\d+$/, '');
        const series = body.series.some(s => s.key === key) ? key : body.series[0]!.key;
        const on = body.points.find(p => p.series === series) ?? body.points[0];
        return {
          message: `move on ${kind} "${key}": a chart moves its points`,
          fix: on ? `move the point: [move ${block}:${on.key} ${mid}]` : `add the line "point ${series} ${xs[0]} #ball" to the chart, then write [move ball ${mid}]`,
        };
      }
      if (!text) return { message: '', fix: `write [move ${target} ${last}]` };
      const x = xIndex(xs, text);
      if (x !== undefined) return x;
      return numeric
        ? { message: `move ${target} ${text}: chart "${block}" has x from ${xs[0]} to ${last}`, fix: `use an x label or a number between them, e.g. [move ${target} ${last}]; to go further, add x labels` }
        : { message: `move ${target} ${text}: "${text}" is not an x label of chart "${block}"`, fix: `use one of: ${xs.join(' ')}, e.g. [move ${target} ${last}]` };
    },
  };
}

/** Bars never move: a bar's value changes with `set`. */
function barMovers(body: Extract<ChartBody, { kind: 'bar' }>): Movers {
  return {
    home: {},
    stop(key, _text, _from, { block }) {
      const row = body.rows.find(r => r.key === key || r.bars.includes(key));
      const bar = row && row.bars.length ? (row.bars.includes(key) ? key : row.bars[0]!) : key;
      const value = row ? row.values[Math.max(0, row.bars.indexOf(bar))]! : 1;
      const sel = /\s/.test(bar) ? String(body.rows.findIndex(r => r.key === key) + 1) : bar;
      return { message: `move on ${row?.bars.length && !row.bars.includes(key) ? 'row' : 'bar'} "${key}": bars do not move`, fix: `change its value instead: [set ${block}:${sel} ${value}]` };
    },
  };
}

// ---------------------------------------------------------------- formatting

/** `$`, `%`, `ms`, or a template with one `#` (`$#k`, `#.0%`). Undefined if it is not a format. */
function parseFormat(s: string): Format | undefined {
  const hash = s.indexOf('#');
  if (hash < 0) {
    if (/^[%°a-zA-Z]+$/.test(s)) return { prefix: '', suffix: s };
    if (/^[^\w\s.#]+$/.test(s)) return { prefix: s, suffix: '' };
    return undefined;
  }
  const prefix = s.slice(0, hash);
  let rest = s.slice(hash + 1);
  const fixed = /^\.(0+)/.exec(rest);
  if (fixed) rest = rest.slice(fixed[0].length);
  if (/[#\d]/.test(prefix + rest)) return undefined;
  return { prefix, suffix: rest, ...(fixed ? { decimals: fixed[1]!.length } : {}) };
}

const UNITS: [number, string][] = [[1e9, 'B'], [1e6, 'M'], [1e3, 'k']];
const SCALE_SUFFIX = /^(k|K|M|B|bn)$/;

/**
 * A number as the chart shows it. `exact` (axis ticks) keeps every decimal the number has; otherwise a value
 * shows the data's own decimals (`decimals`), trailing zeros dropped. Compact values (no suffix, |v| ≥ 10,000)
 * read 76k, 563k, 1.2M: one decimal only under 10. Axis ticks pass `compactFrom` 1,000 when the axis reaches
 * 10,000, so one axis never mixes 5,000 and 10k. Zero drops a scale suffix ($0, not $0k).
 */
function formatValue(v: number, f: Format, decimals: number, exact = false, compactFrom = 1e4): string {
  const a = Math.abs(v);
  const sign = v < 0 && a >= 1e-9 ? '−' : '';
  const trim = (s: string) => (s.includes('.') ? s.replace(/\.?0+$/, '') : s);
  const group = (s: string) => { const [i, frac] = s.split('.'); return i!.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (frac ? `.${frac}` : ''); };
  let body: string;
  const compact = !f.suffix && f.decimals === undefined && a >= compactFrom;
  if (f.log && a > 0 && a < 1) {
    if (a < 1e-3) return `${f.prefix}${a.toExponential(exact ? 0 : 1).replace(/\.0e/, 'e').replace('e+', 'e')}${f.suffix}`;
    body = trim(a.toFixed(exact ? 6 : Math.max(decimals, 1 - Math.floor(Math.log10(a)))));
  } else if (f.decimals !== undefined) body = group(a.toFixed(f.decimals));
  else if (compact) {
    const [div, unit] = UNITS.find(([d]) => a >= d) ?? UNITS[2]!;
    const m = a / div;
    body = (exact ? trim(m.toFixed(3)) : m < 9.95 ? trim(m.toFixed(1)) : m.toFixed(0)) + unit;
  } else body = group(trim(a.toFixed(exact ? 6 : decimals)));
  if (a < 1e-9) return `${f.prefix}0${SCALE_SUFFIX.test(f.suffix) ? '' : f.suffix}`;
  return `${sign}${f.prefix}${body}${f.suffix}`;
}

/**
 * A line chart's y ticks for every value it can show: from 0 when the values reach toward it (all one sign, and
 * the one nearest 0 within `within` of the farthest: 10k..76k starts at 0), else spanning the data alone
 * (147..152 starts at 146). Values of both signs always include 0.
 */
function axisTicks(values: number[], max: number, within: number): number[] {
  const lo = Math.min(...values), hi = Math.max(...values);
  const far = (lo > 0 && lo >= within * hi) || (hi < 0 && hi <= within * lo);
  return far ? niceTicks(lo, hi, max) : niceTicks(Math.min(0, lo), Math.max(0, hi), max);
}

/** 3 to `max` round ticks covering [lo, hi] (steps 1, 2, 5 × 10ⁿ, and 25, 250…), ends included. */
function niceTicks(lo: number, hi: number, max: number): number[] {
  if (hi <= lo) hi = lo + 1;
  const span = hi - lo;
  for (let e = Math.floor(Math.log10(span)) - 3; e <= Math.ceil(Math.log10(span)) + 1; e++)
    for (const m of [1, 2, 2.5, 5]) {
      if (m === 2.5 && e < 1) continue;   // 25 and 250 are round; 2.5 adds a decimal the data may not have
      const step = m * 10 ** e;
      const a = Math.floor(lo / step + 1e-9), b = Math.ceil(hi / step - 1e-9);
      if (b - a + 1 > max) continue;
      return Array.from({ length: b - a + 1 }, (_, i) => Number(((a + i) * step).toPrecision(12)));
    }
  return [lo, hi];
}

/**
 * A log axis's ticks: powers of ten from the one at or below the smallest value above 0 to the one at or above
 * the largest, at least two; every k-th power when more than `max` would show (1, 100, 10k …). `below`: start
 * under the smallest value even when it is itself a power of ten, so a bar of that value still has length.
 */
function logTicks(values: number[], max: number, below = false): number[] {
  const pos = values.filter(v => v > 0);
  const low = Math.log10(Math.min(...pos));
  const a = below ? Math.ceil(low - 1e-9) - 1 : Math.floor(low + 1e-9);
  const top = Math.max(a + 1, Math.ceil(Math.log10(Math.max(...pos)) - 1e-9));
  const step = Math.ceil((top - a) / (max - 1));
  const n = Math.ceil((top - a) / step) + 1;
  return Array.from({ length: n }, (_, i) => Number((10 ** (a + i * step)).toPrecision(12)));
}

// ---------------------------------------------------------------- shared runtime

interface Base {
  /** The value axis: from `lo` to `hi`, linear or (`log`) in powers of ten. */
  format: Format; decimals: number; lo: number; hi: number; log: boolean;
  /** Text widths by class and text (unscaled px), measured once fonts are ready. */
  widths: Map<string, number>; probe: HTMLElement; cap?: HTMLElement;
  /** The block's id, and each item's selector as a cue writes it (its key, or its number when the key has a space). */
  id: string; sel: Map<string, string>;
  /** `set` values the last render could not draw, by item key (`lint`). */
  unset: Map<string, BlockLintIssue>;
}
/** One drawn bar: `part` is its track (bar and value), `key` its item when grouped. */
interface BarDom { part: HTMLElement; bar: HTMLElement; value: HTMLElement; key?: string }
interface RowDom { key: string; label: HTMLElement; declared: number[]; bars: BarDom[] }
/** A drawn value axis under the bars (log only): a label and a grid line per tick. */
interface BarAxis { ticks: number[]; labels: HTMLElement[]; lines: HTMLElement[] }
interface BarsDom extends Base {
  kind: 'bar'; rows: RowDom[]; grid: HTMLElement; head?: HTMLElement; foot?: { el: HTMLElement; title: HTMLElement };
  axis?: BarAxis;
  /** Set in measure (px): the track's length, and where its base (0, or a log axis's lowest tick) sits on it. */
  track: number; zero: number; texts: string[];
}

/** `end`: the series' name and last value at its right end, with a leader to its line; only beside other series. */
interface SeriesDom { line: SVGGElement; path: SVGPathElement; end?: { name: HTMLElement; value: HTMLElement; leader: SVGPathElement }; declared: number[]; states: number[][]; lane: number }
interface MarkDom { m: Mark; part: SVGLineElement; label?: { el: HTMLElement; env: Envelope; w: number; x: number; y: number } }
/**
 * `sweep`: the x range (label units) a point that moves in the scene covers; its label then rides in `row`, reserved
 * across it. `x0`: where a point that does not move in the scene stands (a re-placed chart keeps a moved point where
 * it stopped), for placing its label.
 */
interface PointDom { p: Point; dot: SVGCircleElement; leader: SVGPathElement; label: HTMLElement; env?: Envelope; text?: HTMLElement; sweep?: [number, number]; x0: number; dx: number; dy: number; w: number; lead: boolean; row?: Box }
interface BandDom { b: Band; fill: SVGPathElement; label: HTMLElement; env?: Envelope; text?: HTMLElement; leader: SVGPathElement; inside: boolean; lane: number; w: number; x: number; y: number }
interface LinesDom extends Base {
  kind: 'line'; body: Extract<ChartBody, { kind: 'line' }>;
  plot: HTMLElement; area: HTMLElement; svg: SVGSVGElement; grid: SVGGElement;
  ticks: number[]; tickEls: HTMLElement[]; xEls: HTMLElement[];
  series: Map<string, SeriesDom>; marks: MarkDom[]; points: PointDom[]; bands: BandDom[];
  /** Set in measure (px): plot size, x position of each x label, label height. */
  plotW: number; plotH: number; xpos: number[]; labelH: number;
  titles: { x?: HTMLElement; y?: HTMLElement };
}
type Dom = BarsDom | LinesDom;
const doms = new WeakMap<HTMLElement, Dom>();

/** How a cue writes each of `keys` (the block's first kind of item): its key, or its number when the key has a space. */
const selectors = (keys: string[]) => new Map(keys.map((k, i) => [k, /\s/.test(k) ? String(i + 1) : k]));

/** Every value the chart can show in the scene (declared, and `set` on `keys`), the data's decimals, and their range with 0. */
function valueRange(declared: number[], reachable: Record<string, Inline[]>, keys: string[]): { decimals: number; lo: number; hi: number; all: number[] } {
  const all = [...declared, ...keys.flatMap(k => reachable[k] ?? []).flatMap(c => numbers(c) ?? [])];
  const decimals = Math.min(3, Math.max(0, ...all.map(v => (String(v).split('.')[1] ?? '').length)));
  return { decimals, lo: Math.min(0, ...all), hi: Math.max(0, ...all), all };
}

/** An axis's tick labels: every decimal a tick has; compact from 1,000 when the axis reaches 10,000. */
function tickLabels(ticks: number[], format: Format, decimals: number): string[] {
  const floor = Math.max(...ticks.map(Math.abs)) >= 1e4 ? 1e3 : Infinity;
  return ticks.map(t => formatValue(t, format, decimals, true, floor));
}

/** Where `v` falls on an axis from `lo` to `hi`, as a fraction of its length: linear, or by its power of ten on
 * a log axis (a value under `lo` sits at `lo`). The one scale both chart kinds draw with. */
function along(lo: number, hi: number, log: boolean): (v: number) => number {
  const t = log ? (v: number) => Math.log10(Math.max(v, lo)) : (v: number) => v;
  const a = t(lo), b = t(hi);
  return v => (t(v) - a) / (b - a);
}

/** Text width (unscaled px) of `text` in class `cls`, measured on a hidden probe; cached once fonts have loaded
 * (a width taken in a fallback font would otherwise outlive it). */
function textW(el: HTMLElement, d: Base, cls: string, text: string): number {
  const k = `${cls}|${text}`;
  const hit = d.widths.get(k);
  if (hit !== undefined) return hit;
  const s = h('span', cls, d.probe);
  s.textContent = text;
  // scaleOf is a ratio of rounded widths, a little off at some scales: a pixel of slack keeps text inside its room.
  const w = Math.ceil(s.getBoundingClientRect().width / scaleOf(el)) + 1;
  s.remove();
  if (document.fonts.status === 'loaded') d.widths.set(k, w);
  return w;
}

function labelHeight(el: HTMLElement, d: Base): number {
  const k = 'label-h';
  const hit = d.widths.get(k);
  if (hit !== undefined) return hit;
  const s = h('span', 'ch-tick', d.probe);
  s.textContent = '0';
  const v = s.getBoundingClientRect().height / scaleOf(el);
  s.remove();
  if (document.fonts.status === 'loaded') d.widths.set(k, v);
  return v;
}

// ---------------------------------------------------------------- bars

function mountBars(el: HTMLElement, body: Extract<ChartBody, { kind: 'bar' }>, reachable: Record<string, Inline[]>, cap?: HTMLElement): void {
  const keys = body.series.length ? body.rows.flatMap(r => r.bars) : body.rows.map(r => r.key);
  const sc = valueRange(body.rows.flatMap(r => r.values), reachable, keys);
  if (sc.hi === sc.lo) sc.hi = sc.lo + 1;
  // A log axis spans its ticks; a linear one the values and 0, with no axis drawn (each bar carries its value).
  const ticks = body.log ? logTicks(sc.all, token('--chart-ticks-max'), true) : [];
  const [lo, hi] = body.log ? [ticks[0]!, ticks[ticks.length - 1]!] : [sc.lo, sc.hi];
  // Header line: the label column's title on the left, the legend on the right; one flex line, so they never meet.
  let head: HTMLElement | undefined;
  if (body.titles.y !== undefined || body.series.length) {
    head = h('div', 'ch-head', el);
    const y = h('span', 'ch-title ch-rest', head);
    if (body.titles.y !== undefined) titleText(y, body.titles.y);
    if (body.series.length) {
      const legend = h('div', 'ch-legend ch-rest', head);
      body.series.forEach((s, i) => {
        const key = h('span', `ch-key ch-s${i + 1}`, legend);
        h('span', 'ch-swatch', key);
        const name = h('span', 'ch-kname', key);
        name.textContent = s;
        name.dataset.leaf = '';
        name.dataset.essential = '';
      });
    }
  }
  const grid = h('div', `ch-bars${body.series.length ? ' ch-grouped' : ''}`, el);
  // Grid lines first, so every bar paints over them.
  const lines = ticks.map((_, i) => h('div', `ch-gl ch-rest${i === 0 ? ' ch-gl-base' : ''}`, grid));
  const rows = body.rows.map(r => {
    const part = h('div', 'ch-row', grid);
    const label = h('span', 'ch-label xp', part);
    label.textContent = r.key;
    label.dataset.leaf = '';
    label.dataset.declared = '';
    label.dataset.essential = '';
    const tracks = h('div', 'ch-tracks', part);
    const bars = r.values.map((_, j): BarDom => {
      const track = h('div', `ch-track xp ch-s${j + 1}`, tracks);
      const bar = h('div', 'ch-bar', track);
      h('div', 'ch-edge', bar);
      const value = h('span', 'ch-value', track);
      value.dataset.leaf = '';
      value.dataset.essential = '';
      return { part: track, bar, value, ...(r.bars[j] ? { key: r.bars[j] } : {}) };
    });
    return { key: r.key, label, declared: r.values, bars };
  });
  let axis: BarAxis | undefined;
  if (ticks.length) {
    const row = h('div', 'ch-axis', grid);
    const labels = tickLabels(ticks, body.format, sc.decimals).map(text => {
      const lab = h('span', 'ch-x ch-tick ch-rest', row);
      lab.textContent = text;
      lab.dataset.leaf = '';
      lab.dataset.essential = '';
      return lab;
    });
    axis = { ticks, labels, lines };
  }
  let foot: BarsDom['foot'];
  if (body.titles.x !== undefined) {
    const f = h('div', 'ch-foot', el);
    foot = { el: f, title: titleText(h('span', 'ch-title ch-rest', f), body.titles.x) };
  }
  const probe = h('div', 'ch-probe', el);
  // Room for the widest value beyond the longest bar, so values never leave the block.
  const texts = [...new Set(sc.all.map(v => formatValue(v, body.format, sc.decimals)))];
  doms.set(el, {
    kind: 'bar', format: body.format, decimals: sc.decimals, lo, hi, log: body.log, widths: new Map(), probe, ...(cap ? { cap } : {}),
    id: el.dataset.block ?? '', sel: selectors(body.rows.map(r => r.key)), unset: new Map(),
    rows, grid, ...(head ? { head } : {}), ...(foot ? { foot } : {}), ...(axis ? { axis } : {}), track: 0, zero: 0, texts,
  });
}

/** An axis title: quiet, read (never below --text-label), receding with the block. */
function titleText(el: HTMLElement, text: string): HTMLElement {
  el.textContent = text;
  el.dataset.leaf = '';
  el.dataset.essential = '';
  return el;
}

function measureBars(el: HTMLElement, d: BarsDom, width: number): { natural: number; height: number } {
  const tickW = d.axis ? d.axis.labels.map(l => textW(el, d, 'ch-x ch-tick', l.textContent ?? '')) : [];
  // Right of the track: the widest value beyond the longest bar, and half the last tick label, centred on its end.
  const reach = Math.max(Math.max(...d.texts.map(t => textW(el, d, 'ch-value', t))) + token('--space-3'), Math.ceil((tickW[tickW.length - 1] ?? 0) / 2));
  el.style.setProperty('--ch-reach', `${reach}px`);
  // Flexible: the track takes the width left over, between --chart-plot-w-min and --chart-plot-w-max.
  const min = token('--chart-plot-w-min'), max = token('--chart-plot-w-max');
  setTrack(el, d, min);
  el.style.width = 'max-content';
  const fixed = maxContent(d.grid) - min;
  const span = Math.max(min, Math.min(max, Math.floor(width - fixed)));
  setTrack(el, d, span);
  if (d.axis) {
    // Tick labels under the track, thinned to what fits; a grid line through every row at each tick.
    const f = along(d.lo, d.hi, d.log);
    const xs = d.axis.ticks.map(t => span * f(t));
    const shown = thinned(xs, tickW, token('--space-3'));
    const left = d.rows[0]!.bars[0]!.part.offsetLeft;
    d.axis.labels.forEach((l, i) => Object.assign(l.style, { left: `${num(xs[i]!)}px`, visibility: shown.has(i) ? '' : 'hidden' }));
    d.axis.lines.forEach((g, i) => { g.style.left = `${num(left + xs[i]!)}px`; });
  }
  const cap = d.cap ? maxContent(d.cap) : 0;
  const head = d.head ? maxContent(d.head) : 0;
  const titleW = d.foot ? textW(el, d, 'ch-title', d.foot.title.textContent ?? '') : 0;
  const natural = Math.ceil(Math.max(fixed + span, cap, head, titleW));
  // The value axis title: centred under the bars' track, kept inside the block.
  if (d.foot) {
    const centre = d.rows[0]!.bars[0]!.part.offsetLeft + span / 2;
    d.foot.title.style.left = `${num(Math.max(0, Math.min(natural - titleW, centre - titleW / 2)))}px`;
  }
  el.style.width = `${natural}px`;
  return { natural, height: el.offsetHeight };
}

/** A bar's base: 0, or the lowest tick of a log axis. */
const baseOf = (d: BarsDom) => (d.log ? d.lo : 0);

function setTrack(el: HTMLElement, d: BarsDom, span: number): void {
  d.track = span;
  d.zero = span * along(d.lo, d.hi, d.log)(baseOf(d));
  el.querySelectorAll<HTMLElement>('.ch-track, .ch-axis').forEach(t => { t.style.width = `${span}px`; });
}

function renderBars(d: BarsDom, self: Channels, items: Record<string, ItemState>): void {
  const f = along(d.lo, d.hi, d.log), base = f(baseOf(d));
  d.unset.clear();
  for (const r of d.rows) {
    const rowIt = items[r.key];
    const row = inherit(self, rowIt);
    // A grouped row has no value of its own: each bar is set on its own key, as a plain bar is on its row's.
    if (r.bars[0]!.key !== undefined) unsettable(d, r.key, rowIt?.content, { bar: r.bars[0]!.key });
    let labelHl = row.hl;
    r.bars.forEach((b, j) => {
      const it = b.key === undefined ? rowIt : items[b.key];
      const ch = b.key === undefined ? row : barChannels(row, it, j === 0);
      labelHl = Math.max(labelHl, ch.hl);
      channels(b.part, ch);
      unsettable(d, b.key ?? r.key, it?.content, [r.declared[j]!]);
      const v = valueAt(it, [r.declared[j]!], d.log)[0]!;
      const grown = Math.min(ch.grow, ch.vis);
      const end = d.zero + (f(v) - base) * d.track * grown;
      const left = Math.min(d.zero, end), w = Math.abs(end - d.zero);
      Object.assign(b.bar.style, { left: `${num(left)}px`, width: `${num(w)}px` });
      b.bar.style.opacity = grown > 0 ? '1' : '0';
      b.value.textContent = formatValue(v, d.format, d.decimals);
      // The value reads past the bar's outer end; a negative bar's outer end faces the labels, so its value sits on the zero side.
      b.value.style.left = `${num(left + w)}px`;
      b.bar.classList.toggle('ch-neg', v < 0);
      b.value.style.opacity = num(reveal(grown, token('--reveal-along')));
    });
    // The label is the row's: lit when the row or any of its bars is.
    channels(r.label, { vis: row.vis, hl: labelHl, now: row.now, recede: row.recede * (1 - labelHl) });
  }
}

/**
 * A grouped bar's channels: its row's visibility, growth and recession, and its own highlight. Only the first
 * series takes the row's (or the block's) highlight, so a lit row still tells its series apart.
 */
function barChannels(row: Channels, it: ItemState | undefined, first: boolean): Channels {
  const hl = Math.max(it?.hl ?? 0, first ? row.hl : 0);
  return {
    vis: Math.min(row.vis, it?.vis ?? 1), grow: Math.min(row.grow, it?.grow ?? 1), hl,
    now: Math.max(it?.now ?? 0, first ? row.now : 0), recede: Math.max(row.recede, it?.recede ?? 0) * (1 - hl),
  };
}

/**
 * Records a `set` value item `key` cannot draw, as the author's finding: on a grouped row (`bar`: its first bar)
 * any value, since its bars are set one by one; else anything but one number per `declared` value, and on a log
 * axis a value at or below 0.
 */
function unsettable(d: Dom, key: string, c: Content | undefined, declared: number[] | { bar: string }): void {
  if (!c) return;
  const text = plain(c.cur).trim(), vs = numbers(c.cur);
  const at = `${d.id}:${d.sel.get(key) ?? key}`;
  const example = (values: number[]) => `[set ${at} ${values.map(v => formatValue(v, { prefix: '', suffix: '' }, d.decimals).replace(/,/g, '').replace('−', '-')).join(' ')}]`;
  let why: string | undefined, fix = '';
  if (!Array.isArray(declared)) {
    why = 'a grouped row has no value of its own';
    fix = `set each bar on its own, e.g. [set ${d.id}:${declared.bar} ${vs?.[0] ?? 1}]`;
  } else if (!vs || vs.length !== declared.length) {
    why = declared.length === 1 ? 'a bar takes one plain number' : `this series takes ${declared.length} plain numbers, one per x label`;
    fix = `write ${declared.length === 1 ? 'one number' : `${declared.length} numbers`}, e.g. ${example(declared)}`;
  } else if (d.log && vs.some(v => v <= 0)) {
    why = 'a log scale shows only values above 0';
    fix = `set values above 0, e.g. ${example(declared)}, or remove "log" from the ::: chart line`;
  }
  if (why) d.unset.set(key, { code: 'L405', item: key, message: `[set ${at} ${text}] cannot be drawn: ${why}`, fix });
}

// ---------------------------------------------------------------- lines

function mountLines(el: HTMLElement, body: Extract<ChartBody, { kind: 'line' }>, { items: reachable, markers: stops = [] }: Reachable, cap?: HTMLElement): void {
  const sc = valueRange(body.series.flatMap(s => s.values), reachable, body.series.map(s => s.key));
  const ticks = body.log ? logTicks(sc.all, token('--chart-ticks-max')) : axisTicks(sc.all, token('--chart-ticks-max'), token('--chart-zero-within'));
  const plot = h('div', 'ch-plot', el);
  const titles = {
    ...(body.titles.y !== undefined ? { y: titleText(h('span', 'ch-title ch-rest', plot), body.titles.y) } : {}),
    ...(body.titles.x !== undefined ? { x: titleText(h('span', 'ch-title ch-rest', plot), body.titles.x) } : {}),
  };
  const area = h('div', 'ch-area', plot);
  const root = svg('svg', area);
  root.setAttribute('class', 'ch-svg');
  const grid = svg('g', root);
  grid.setAttribute('class', 'ch-grid ch-rest');
  const tickTexts = tickLabels(ticks, body.format, sc.decimals);
  const tickEls = ticks.map((t, i) => {
    const line = svg('line', grid);
    line.setAttribute('class', t === 0 ? 'ch-base' : 'ch-gridline');
    const lab = h('span', `ch-y ch-tick ch-rest${i === 0 ? ' ch-ylo' : ''}${i === ticks.length - 1 ? ' ch-yhi' : ''}`, area);
    lab.textContent = tickTexts[i]!;
    lab.dataset.leaf = '';
    lab.dataset.essential = '';
    return lab;
  });
  const xEls = body.x.map(x => {
    const t = h('span', 'ch-x ch-tick ch-rest', area);
    t.textContent = x;
    t.dataset.leaf = '';
    t.dataset.essential = '';
    return t;
  });
  const statesOf = (key: string, declared: number[]) =>
    [declared, ...(reachable[key] ?? []).map(c => numbers(c)).filter((v): v is number[] => !!v && v.length === declared.length)];
  // Paint order: bands under everything, then marks, series, points.
  const bands = body.bands.map(b => {
    const fill = svg('path', root);
    fill.setAttribute('class', 'ch-band');
    const leader = svg('path', root);
    leader.setAttribute('class', 'ch-leader');
    const { label, env, text } = annotationLabel(area, 'ch-blabel', b.label, reachable[b.key]);
    return { b, fill, leader, label, ...(env ? { env } : {}), ...(text ? { text } : {}), inside: true, lane: 0, w: 0, x: 0, y: 0 };
  });
  const marks = body.marks.map(m => {
    const part = svg('line', root);
    part.setAttribute('class', 'ch-mark');
    if (!m.label) return { m, part };
    const { label: lab, env } = annotationLabel(area, 'ch-mlabel', m.label, reachable[m.key]);
    return { m, part, label: { el: lab, env: env!, w: 0, x: 0, y: 0 } };
  });
  const series = new Map<string, SeriesDom>();
  for (const s of body.series) {
    const line = svg('g', root);
    line.setAttribute('class', 'ch-series ch-part');
    const path = svg('path', line);
    path.setAttribute('class', 'ch-line');
    path.setAttribute('pathLength', '1');
    // A lone series is named by the caption: an end label would only repeat it (r3 Diffie–Hellman "result 1").
    let end: SeriesDom['end'];
    if (body.series.length > 1) {
      const leader = svg('path', line);
      leader.setAttribute('class', 'ch-leader');
      const name = h('span', 'ch-name ch-ink ch-part', area);
      name.append(`${s.key} `);
      const value = h('span', 'ch-last', name);
      name.dataset.leaf = '';
      name.dataset.essential = '';
      end = { name, value, leader };
    }
    series.set(s.key, { line, path, ...(end ? { end } : {}), declared: s.values, states: statesOf(s.key, s.values), lane: 0 });
  }
  const points = body.points.map(p => {
    const leader = svg('path', root);
    leader.setAttribute('class', 'ch-leader');
    const dot = svg('circle', root);
    dot.setAttribute('class', 'ch-dot');
    const { label, env, text } = annotationLabel(area, 'ch-plabel', p.label, reachable[p.key]);
    // A point that moves in the scene: the x range it sweeps, label units. Its label rides centred on the dot.
    const at = [...new Set(stops.map(m => m[p.key]).filter((x): x is number => x !== undefined))];
    const sweep = at.length > 1 ? { sweep: [Math.min(...at), Math.max(...at)] as [number, number] } : {};
    if (at.length > 1) label.classList.add('ch-ride');
    return { p, dot, leader, label, ...(env ? { env } : {}), ...(text ? { text } : {}), ...sweep, x0: at.length === 1 ? at[0]! : p.x, dx: 0, dy: 0, w: 0, lead: false };
  });
  const probe = h('div', 'ch-probe', el);
  doms.set(el, {
    kind: 'line', body, format: body.format, decimals: sc.decimals, lo: ticks[0]!, hi: ticks[ticks.length - 1]!, widths: new Map(), probe,
    id: el.dataset.block ?? '', sel: selectors(body.series.map(s => s.key)), unset: new Map(),
    ...(cap ? { cap } : {}), plot, area, svg: root, grid, ticks, tickEls, xEls, series, marks, points, bands,
    plotW: 0, plotH: 0, xpos: [], labelH: 0, log: body.log, titles,
  });
}

/** Plot y (px, 0 at the top) of value `v`: linear, or by its power of ten on a log axis. */
function yScale(d: LinesDom): (v: number) => number {
  const f = along(d.lo, d.hi, d.log);
  return v => d.plotH - f(v) * d.plotH;
}

/** An annotation's label: an envelope over its declared and set labels, or (no label) a value the render writes. */
function annotationLabel(area: HTMLElement, cls: string, label: Inline | undefined, reachable: Inline[] = []): { label: HTMLElement; env?: Envelope; text?: HTMLElement } {
  const el = h('span', `ch-alabel ${cls} ch-ink ch-part`, area);
  el.dataset.essential = '';
  if (label) {
    const env = envelope(el, label, reachable);
    env.el.dataset.declared = '';
    return { label: el, env };
  }
  el.dataset.leaf = '';
  const text = h('span', 'ch-num', el);
  return { label: el, text };
}

/**
 * The values a point's label can show: at its x on every state its series reaches; for a point that moves, at
 * every x label it passes and each end of its sweep, and a value at each extreme with every decimal place filled
 * (the widest text a value between them can need).
 */
function pointValues(d: LinesDom, p: PointDom): number[] {
  const states = d.series.get(p.p.series)!.states;
  if (!p.sweep) return states.map(v => valueAtX(v, p.x0, d.log));
  const [a, b] = p.sweep;
  const xs = [a, ...d.body.x.map((_, i) => i).filter(i => i > a && i < b), b];
  const vs = states.flatMap(v => xs.map(x => valueAtX(v, x, d.log)));
  const full = (v: number) => Math.sign(v) * (Math.floor(Math.abs(v)) + 1 - 10 ** -d.decimals);
  return [...vs, full(Math.min(...vs)), full(Math.max(...vs))];
}

/** The widest text a value label can show: every reachable value, and the scale's ends (values move between them). */
function widestValue(el: HTMLElement, d: LinesDom, cls: string, values: number[]): number {
  return Math.max(...[...values, d.lo, d.hi].map(v => textW(el, d, cls, formatValue(v, d.format, d.decimals))));
}

function measureLines(el: HTMLElement, d: LinesDom, width: number): { natural: number; height: number } {
  const gap = token('--space-3');
  const body = d.body;
  const labelH = d.labelH = labelHeight(el, d);
  const xw = d.xEls.map(x => textW(el, d, 'ch-x ch-tick', x.textContent ?? ''));
  const tickW = Math.max(...d.tickEls.map(t => textW(el, d, 'ch-y ch-tick', t.textContent ?? '')));
  const endValues = (s: SeriesDom) => s.states.map(v => v[v.length - 1]!);
  // End labels: name plus the widest value the series' end can show.
  const nameW = [...d.series].filter(([, s]) => s.end).map(([key, s]) => textW(el, d, 'ch-name', `${key} `) + widestValue(el, d, 'ch-name ch-num', endValues(s)));
  const bandW = d.bands.map(b => b.env ? maxContent(b.env.el) : widestValue(el, d, 'ch-blabel', bandGaps(d, b.b)));
  const pointW = d.points.map(p => p.env ? maxContent(p.env.el) : widestValue(el, d, 'ch-plabel', pointValues(d, p)));
  const markW = d.marks.map(m => m.label ? maxContent(m.label.env.el) : 0);
  const lead = Math.ceil(Math.max(tickW + gap, xw[0]! / 2));
  const laneW = Math.max(0, ...nameW, ...bandW);   // a band label may fall back to a lane
  // Right of the plot: the lanes, if any; else room for the last x label, centred on the plot's edge.
  const reach = Math.ceil(laneW ? 2 * gap + laneW : xw[xw.length - 1]! / 2);
  const fixed = lead + reach;
  // Flexible: the plot takes the width left over, between --chart-plot-w-min and --chart-plot-w-max.
  const span = Math.max(token('--chart-plot-w-min'), Math.min(token('--chart-plot-w-max'), Math.floor(width - fixed)));
  const plotW = d.plotW = span;
  const plotH = d.plotH = token('--chart-plot-h') * pitchOf(el);
  const n = body.x.length;
  const xv = body.x.map(Number);
  const proportional = body.x.every(v => NUM.test(v)) && xv.every((v, i) => i === 0 || v > xv[i - 1]!);
  d.xpos = body.x.map((_, i) => (proportional ? (xv[i]! - xv[0]!) / (xv[n - 1]! - xv[0]!) : i / (n - 1)) * plotW);
  const X = (x: number) => { const i = Math.floor(x), f = x - i; return i >= n - 1 ? d.xpos[n - 1]! : d.xpos[i]! + f * (d.xpos[i + 1]! - d.xpos[i]!); };
  const Y = yScale(d);

  // Every label in one pass: series names and band labels that cannot sit inside their band take the lanes on
  // the right; mark labels and point labels without a safe spot near their dot take the rows above the plot.
  const P = placeLabels({
    plotW, plotH, labelH, left: -lead, right: plotW + reach, xpos: d.xpos,
    series: [...d.series].map(([key, s]) => ({ key, named: !!s.end, states: s.states.map(v => v.map(Y)) })),
    marks: d.marks.map((m, i) => ({ x: X(m.m.x), w: m.label ? markW[i]! : 0 })),
    bands: d.bands.map((b, i) => ({ key: b.b.key, a: b.b.a, b: b.b.b, w: bandW[i]! })),
    points: d.points.map((p, i) => ({ series: p.p.series, x: X(p.x0), w: pointW[i]!, ...(p.sweep ? { sweep: [X(p.sweep[0]), X(p.sweep[1])] as [number, number] } : {}) })),
  });
  for (const [key, s] of d.series) s.lane = P.lanes.get(key) ?? 0;
  d.marks.forEach((m, i) => { if (m.label) { const b = P.marks[i]!; Object.assign(m.label, { w: b.w, x: b.x, y: b.y }); } });
  d.bands.forEach((b, i) => {
    const at = P.bands[i]!;
    b.w = bandW[i]!;
    b.inside = 'box' in at;
    if ('box' in at) { b.x = at.box.x; b.y = at.box.y; } else b.lane = at.lane;
  });
  d.points.forEach((p, i) => {
    const at = P.points[i]!;
    p.w = pointW[i]!;
    if ('row' in at) { p.row = at.row; p.lead = true; } else { delete p.row; p.dx = at.dx; p.dy = at.dy; p.lead = at.lead; }
  });
  // Axis titles take lines of their own, above everything over the plot and under the x labels, so no label
  // placed above can meet them.
  const air = token('--space-2');
  const head = d.titles.y ? Math.ceil(labelH + gap) : 0;
  const top = head + Math.ceil(P.top);
  const bottom = Math.ceil(gap + labelH) + (d.titles.x ? Math.ceil(air + labelH) : 0);

  // Static geometry.
  const W = lead + plotW + reach;
  Object.assign(d.plot.style, { width: `${W}px`, height: `${top + plotH + bottom}px` });
  Object.assign(d.area.style, { left: `${lead}px`, top: `${top}px`, width: `${plotW}px`, height: `${plotH}px` });
  d.svg.setAttribute('width', num(plotW));
  d.svg.setAttribute('height', num(plotH));
  d.ticks.forEach((t, i) => {
    const line = d.grid.children[i] as SVGLineElement;
    for (const [k, v] of [['x1', 0], ['x2', plotW], ['y1', Y(t)], ['y2', Y(t)]] as const) line.setAttribute(k, num(v));
    Object.assign(d.tickEls[i]!.style, { left: `${-gap}px`, top: `${num(Y(t))}px` });
  });
  const shown = thinned(d.xpos, xw, gap);
  d.xEls.forEach((x, i) => {
    Object.assign(x.style, { left: `${num(d.xpos[i]!)}px`, top: `${plotH + gap}px`, visibility: shown.has(i) ? '' : 'hidden' });
  });
  for (const s of d.series.values()) if (s.end) Object.assign(s.end.name.style, { left: `${num(plotW + 2 * gap)}px`, top: `${num(s.lane - labelH / 2)}px` });
  for (const m of d.marks) {
    for (const [k, v] of [['x1', X(m.m.x)], ['x2', X(m.m.x)], ['y1', plotH]] as const) m.part.setAttribute(k, num(v));
    if (m.label) Object.assign(m.label.el.style, { left: `${num(m.label.x)}px`, top: `${num(m.label.y)}px` });
  }
  for (const b of d.bands) {
    const at = b.inside ? { x: b.x, y: b.y } : { x: plotW + 2 * gap, y: b.lane - labelH / 2 };
    Object.assign(b.label.style, { left: `${num(at.x)}px`, top: `${num(at.y)}px` });
  }
  const cap = d.cap ? maxContent(d.cap) : 0;
  const titleW = (t?: HTMLElement) => (t ? textW(el, d, 'ch-title', t.textContent ?? '') : 0);
  const natural = Math.ceil(Math.max(W, cap, titleW(d.titles.x), titleW(d.titles.y)));
  // y: above the y labels at the block's top left (CSS); x: centred under the plot, kept inside the block.
  if (d.titles.x) {
    const w = titleW(d.titles.x);
    Object.assign(d.titles.x.style, { left: `${num(Math.max(0, Math.min(natural - w, lead + plotW / 2 - w / 2)))}px`, top: `${num(top + plotH + Math.ceil(gap + labelH) + air)}px` });
  }
  el.style.width = `${natural}px`;
  return { natural, height: el.offsetHeight };
}

/**
 * Which labels centred at `xs` (widths `w`) along a horizontal axis show: every k-th, the first always, the
 * last when it clears its neighbour; shown labels stand at least `gap` apart.
 */
function thinned(xs: number[], w: number[], gap: number): Set<number> {
  const n = xs.length;
  const fits = (a: number, b: number) => xs[b]! - xs[a]! >= (w[a]! + w[b]!) / 2 + gap;
  let step = 1;
  while (step < n - 1 && !Array.from({ length: Math.floor((n - 1) / step) }, (_, j) => j * step).every(i => i + step > n - 1 || fits(i, i + step))) step++;
  const shown = new Set(Array.from({ length: n }, (_, i) => i).filter(i => i % step === 0));
  const lastShown = Math.max(...shown);
  if (lastShown !== n - 1 && fits(lastShown, n - 1)) shown.add(n - 1);
  return shown;
}

function renderLines(d: LinesDom, self: Channels, items: Record<string, ItemState>): void {
  const n = d.body.x.length;
  const Y = yScale(d);
  const X = (x: number) => { const i = Math.floor(x), f = x - i; return i >= n - 1 ? d.xpos[n - 1]! : d.xpos[i]! + f * (d.xpos[i + 1]! - d.xpos[i]!); };
  const gap = token('--space-3');
  const now = new Map<string, { vs: number[]; grown: number }>();
  d.unset.clear();
  for (const [key, s] of d.series) {
    const it = items[key];
    unsettable(d, key, it?.content, s.declared);
    const ch = inherit(self, it);
    const look = { hl: ch.hl, now: ch.now, recede: ch.recede, vis: ch.vis };
    channels(s.line, look);
    const vs = valueAt(it, s.declared, d.log);
    const grown = Math.min(ch.grow, ch.vis);
    now.set(key, { vs, grown });
    const pts = vs.map((v, i) => ({ x: d.xpos[i]!, y: Y(v) }));
    s.path.setAttribute('d', `M${pts.map(p => `${num(p.x)} ${num(p.y)}`).join(' L')}`);
    s.path.style.strokeDashoffset = num(1 - grown);
    s.path.style.opacity = grown > 0 ? '1' : '0';
    if (!s.end) continue;
    const last = pts[pts.length - 1]!;
    channels(s.end.name, look);
    s.end.value.textContent = formatValue(vs[vs.length - 1]!, d.format, d.decimals);
    const shown = reveal(grown, token('--reveal-end'));
    s.end.name.style.setProperty('--reveal', num(shown));
    s.end.leader.setAttribute('d', `M${num(last.x + gap / 2)} ${num(last.y)} L${num(d.plotW + 2 * gap - gap / 2)} ${num(s.lane)}`);
    // The leader appears only once the name sits clearly off its line's end.
    s.end.leader.style.opacity = num(shown * clamp((Math.abs(s.lane - last.y) - d.labelH / 4) / (d.labelH / 4)));
  }
  for (const m of d.marks) {
    const ch = inherit(self, items[m.m.key]);
    const look = { hl: ch.hl, now: ch.now, recede: ch.recede, vis: ch.vis };
    channels(m.part, look);
    const grown = Math.min(ch.grow, ch.vis);
    m.part.setAttribute('y2', num(d.plotH * (1 - grown)));
    if (m.label) {
      channels(m.label.el, look);
      m.label.el.style.setProperty('--reveal', num(reveal(grown, token('--reveal-along'))));
      showContent(m.label.env, items[m.m.key]?.content);
    }
  }
  for (const p of d.points) {
    const it = items[p.p.key];
    const ch = inherit(self, it);
    const s = now.get(p.p.series)!;
    // Where `move` has put it, on its line as drawn now (a `set` morphing the series carries it along).
    const x = it?.at ?? p.p.x;
    // A point waits for its line to be drawn up to it.
    const reached = s.grown >= X(x) / d.plotW - 1e-6 ? 1 : 0;
    const vis = Math.min(ch.vis, reached);
    const look = { hl: ch.hl, now: ch.now, recede: ch.recede, vis };
    const v = valueAtX(s.vs, x, d.log);
    const cx = X(x), cy = Y(v);
    p.dot.setAttribute('cx', num(cx));
    p.dot.setAttribute('cy', num(cy));
    p.dot.setAttribute('r', num(token('--chart-dot-r')));
    channels(p.dot, look);
    channels(p.label, look);
    // Near the dot it rides with it; in a row above the plot it stays put and its leader follows the dot. A point
    // that moves rides centred straight above its dot (its text changes width as it counts), inside the row
    // reserved across its sweep.
    const ride = p.row && p.sweep ? Math.max(p.row.x + p.w / 2, Math.min(p.row.x + p.row.w - p.w / 2, cx)) : undefined;
    const box = !p.row ? { x: cx + p.dx, y: cy + p.dy, w: p.w, h: d.labelH } : ride !== undefined ? { x: ride - p.w / 2, y: p.row.y, w: p.w, h: d.labelH } : p.row;
    Object.assign(p.label.style, { left: `${num(ride ?? box.x)}px`, top: `${num(box.y)}px` });
    // The leader runs from the dot's rim to the nearest point of the label's box.
    const bx = Math.max(box.x, Math.min(cx, box.x + box.w)), by = Math.max(box.y, Math.min(cy, box.y + box.h));
    const len = Math.hypot(bx - cx, by - cy), rr = token('--chart-dot-r');
    p.leader.setAttribute('d', p.lead && len > rr ? `M${num(cx + (bx - cx) * rr / len)} ${num(cy + (by - cy) * rr / len)} L${num(bx)} ${num(by)}` : '');
    channels(p.leader, look);
    if (p.env) showContent(p.env, it?.content);
    if (p.text) p.text.textContent = formatValue(v, d.format, d.decimals);
  }
  for (const b of d.bands) {
    const it = items[b.b.key];
    const ch = inherit(self, it);
    const look = { hl: ch.hl, now: ch.now, recede: ch.recede, vis: ch.vis };
    const A = now.get(b.b.a)!, B = now.get(b.b.b)!;
    const grown = Math.min(ch.grow, ch.vis, A.grown, B.grown);
    // The band fills from the left up to what is grown.
    const gx = grown * d.plotW;
    const k = xIndexAt(d.xpos, gx);
    const upto = d.xpos.map((x, i) => [x, i] as const).filter(([x]) => x < gx - 1e-6).map(([, i]) => i);
    const top = [...upto.map(i => ({ x: d.xpos[i]!, y: Y(A.vs[i]!) })), { x: gx, y: Y(valueAtX(A.vs, k, d.log)) }];
    const bot = [...upto.map(i => ({ x: d.xpos[i]!, y: Y(B.vs[i]!) })), { x: gx, y: Y(valueAtX(B.vs, k, d.log)) }].reverse();
    b.fill.setAttribute('d', grown > 0 ? `M${[...top, ...bot].map(p => `${num(p.x)} ${num(p.y)}`).join(' L')} Z` : '');
    channels(b.fill, look);
    channels(b.label, look);
    // Inside, the label appears as the fill passes over it. In a lane it arrives with the band's end and fades
    // while the band there is thinner than a dot, so it never names a band that has closed.
    const endGap = Math.abs(Y(A.vs[A.vs.length - 1]!) - Y(B.vs[B.vs.length - 1]!));
    const shown = b.inside ? clamp((gx - b.x) / b.w) : reveal(grown, token('--reveal-end')) * clamp(endGap / (2 * token('--chart-dot-r')));
    b.label.style.setProperty('--reveal', num(shown));
    if (b.env) showContent(b.env, it?.content);
    if (b.text) b.text.textContent = formatValue(Math.abs(A.vs[A.vs.length - 1]! - B.vs[B.vs.length - 1]!), d.format, d.decimals);
    if (!b.inside) {
      const mid = (Y(A.vs[A.vs.length - 1]!) + Y(B.vs[B.vs.length - 1]!)) / 2;
      b.leader.setAttribute('d', `M${num(d.plotW + gap / 2)} ${num(mid)} L${num(d.plotW + 2 * gap - gap / 2)} ${num(b.lane)}`);
      b.leader.style.opacity = num(shown * clamp((Math.abs(b.lane - mid) - d.labelH / 4) / (d.labelH / 4)));
    } else b.leader.style.opacity = '0';
  }
}

/** The gap between a band's two series at the last x, at every state they can reach. */
function bandGaps(d: LinesDom, b: Band): number[] {
  const A = d.series.get(b.a)!, B = d.series.get(b.b)!;
  return A.states.flatMap(a => B.states.map(bb => Math.abs(a[a.length - 1]! - bb[bb.length - 1]!)));
}

/**
 * Fixed lanes for series names: each name wants the last end its line reaches in the scene (`ys` in order,
 * declared first), the frame the viewer holds longest; names are stacked top to bottom in that order, at least `h + gap` apart, and pushed back inside
 * [0, bottom] where they can be. Because a lane never moves, two names cannot meet at any instant, however
 * the lines cross mid-animation.
 */
function lanes(series: { key: string; ys: number[] }[], h: number, gap: number, bottom: number): Map<string, number> {
  const want = series.map((s, i) => ({ key: s.key, i, y: s.ys[s.ys.length - 1]! }))
    .sort((a, b) => a.y - b.y || a.i - b.i);
  const ys = want.map(w => w.y);
  for (let i = 1; i < ys.length; i++) ys[i] = Math.max(ys[i]!, ys[i - 1]! + h + gap);
  if (ys.length && ys[ys.length - 1]! > bottom) {
    ys[ys.length - 1] = bottom;
    for (let i = ys.length - 2; i >= 0; i--) ys[i] = Math.min(ys[i]!, ys[i + 1]! - h - gap);
  }
  return new Map(want.map((w, i) => [w.key, ys[i]!]));
}

// ---------------------------------------------------------------- label placement

/** One series to clear: its line at every state the scene can reach (plot px, y at each x label); `named`: its name takes a lane. */
interface PlaceSeries { key: string; named: boolean; states: number[][] }
interface PlaceInput {
  /** Plot size, label height (px); the block's horizontal extent relative to the plot's left edge. */
  plotW: number; plotH: number; labelH: number; left: number; right: number;
  /** x of each x label (px). */
  xpos: number[];
  series: PlaceSeries[];
  /** Mark lines at plot x; `w` 0 for a mark without a label. */
  marks: { x: number; w: number }[];
  bands: { key: string; a: string; b: string; w: number }[];
  /** `sweep`: the plot x range a point that moves covers; its label takes a row reserved across it. */
  points: { series: string; x: number; w: number; sweep?: [number, number] }[];
}
/** Where each label goes (plot px). `top`: room the rows need above the plot. */
interface Placement {
  top: number;
  /** Lane centre y on the right, for each series name and each band label that is not inside its band. */
  lanes: Map<string, number>;
  marks: (Box | undefined)[];
  bands: ({ box: Box } | { lane: number })[];
  /** Near the dot (offset from it, `lead` when away from the first ring), or in a row above the plot (for a point
   * that moves, the row's box spans its whole sweep). */
  points: ({ dx: number; dy: number; lead: boolean } | { row: Box })[];
}

/**
 * Place every label of a line chart so that no two labels meet, no label meets a line or a mark, and none leaves
 * the block, at every instant of the scene, by construction rather than by checking settled frames.
 *
 * Motion: a series moves only by `set`, which carries every vertex linearly from one reachable state to another
 * on one curve. At any plot x its height therefore stays between the lowest and highest of its reachable states
 * there, and between two x labels those extremes are reached at the ends of the interval. So a box is clear of a
 * series for the whole scene when, at the ends of each interval it spans, every reachable state passes above
 * it, or every one passes below it (`sideOf`); a straddle in time (one state above, another below) is a hit.
 * A point's label moves with its dot: against its own line it is checked in the dot's frame (its line, minus the
 * dot, also moves linearly), and against everything else as the box it sweeps from the dot's highest to lowest.
 *
 * Inside the plot: band labels (static, between their two series at every instant), then point labels (rings of
 * 8 directions around the dot, moving out). Whatever has no such place goes outside: band labels to the lanes
 * on the right (fixed, beside the series names: `lanes`), point labels to the rows above the plot (with the mark
 * labels), each row label's leader column kept clear in the rows below it. Exterior places never move, so they
 * can only meet each other, and their allocators keep them apart.
 */
function placeLabels(q: PlaceInput): Placement {
  const gap = token('--space-3'), tight = token('--space-1'), air = token('--space-2'), r = token('--chart-dot-r');
  const { plotW, plotH, labelH: hh, xpos } = q;
  const byKey = new Map(q.series.map(s => [s.key, s]));
  const grow = (b: Box, p: number): Box => ({ x: b.x - p, y: b.y - p, w: b.w + 2 * p, h: b.h + 2 * p });
  const inPlot = (b: Box) => b.x >= 0 && b.x + b.w <= plotW && b.y >= 0 && b.y + b.h <= plotH;
  const taken: Box[] = [];
  const free = (b: Box, skip: PlaceSeries[] = []) => inPlot(b)
    && q.marks.every(m => m.x < b.x - air || m.x > b.x + b.w + air)
    && taken.every(o => !overlaps(o, b, tight))
    && q.series.every(s => skip.includes(s) || sideOf(xpos, s.states, grow(b, air)) !== 'hit');

  // Band labels: rightmost first, centred in the room both series leave over the label at every state.
  const bands = q.bands.map(band => {
    const A = byKey.get(band.a)!, B = byKey.get(band.b)!, w = band.w;
    for (let cx = plotW - w / 2 - gap; cx >= w / 2 + gap; cx -= tight) {
      const x0 = cx - w / 2 - air, x1 = cx + w / 2 + air;
      const a = extentOf(xpos, A.states, x0, x1), b = extentOf(xpos, B.states, x0, x1);
      if (!a || !b) continue;
      const [upper, lower] = a.max < b.min ? [a, b] : b.max < a.min ? [b, a] : [undefined, undefined];
      if (!upper || !lower) continue;
      const room = lower.min - upper.max - 2 * air;
      if (room < hh) continue;
      const box = { x: cx - w / 2, y: (upper.max + lower.min) / 2 - hh / 2, w, h: hh };
      if (free(box, [A, B]) && sideOf(xpos, A.states, grow(box, air)) !== 'hit' && sideOf(xpos, B.states, grow(box, air)) !== 'hit') {
        taken.push(box);
        return { box };
      }
    }
    return undefined;
  });

  // Point labels: the first ring offset clear at every instant.
  const ROW = Symbol('row');
  const points = q.points.map(pt => {
    if (pt.sweep) return ROW;
    const own = byKey.get(pt.series)!, w = pt.w;
    const dots = own.states.map(ys => yAt(xpos, ys, pt.x));
    const rel = own.states.map((ys, i) => ys.map(y => y - dots[i]!));
    const lo = Math.min(...dots), hi = Math.max(...dots);
    for (let k = 0; k <= 4; k++) {
      const e = r + tight + k * gap, o = e * Math.SQRT1_2;
      const ring = [[-w / 2, -e - hh], [-w - o, -o - hh], [o, -o - hh], [-w / 2, e], [-e - w, -hh / 2], [e, -hh / 2], [-w - o, o], [o, o]] as const;
      for (const [dx, dy] of ring) {
        const swept = { x: pt.x + dx, y: lo + dy, w, h: hi - lo + hh };
        if (!free(swept, [own]) || sideOf(xpos, rel, grow({ x: pt.x + dx, y: dy, w, h: hh }, air)) === 'hit') continue;
        taken.push(swept);
        return { dx, dy, lead: k > 0 };
      }
    }
    return ROW;
  });

  // Lanes on the right: series names, then band labels that found no room inside.
  const wants = [
    ...q.series.filter(s => s.named).map(s => ({ key: s.key, ys: s.states.map(v => v[v.length - 1]!) })),
    ...q.bands.flatMap((b, i) => bands[i] ? [] : [{ key: b.key, ys: byKey.get(b.a)!.states.flatMap(a => byKey.get(b.b)!.states.map(c => (a[a.length - 1]! + c[c.length - 1]!) / 2)) }]),
  ];
  const laneAt = lanes(wants, hh, tight, plotH);

  // Rows above the plot (and above any lane pushed over its top). Mark labels first, centred on their mark, a
  // row higher when crowded; then point labels, each as near above its dot as it can be with its leader (from the
  // label down to the dot) clear of the row labels below it. No row label sits across a leader.
  const ceiling = Math.min(-hh / 2, ...[...laneAt.values()].map(y => y - hh / 2)) - tight;
  const placedRows: { box: Box; row: number }[] = [];
  const leaders: { p: Pt; q: Pt }[] = [];
  /** What the leader of a moving point's label sweeps: from its row down to the plot, across the sweep. */
  const swept: Box[] = [];
  const rowY = (i: number) => ceiling - (i + 1) * hh - i * tight;
  let rowCount = 0;
  const put = (cx: number, lw: number, leader: boolean, sweep?: [number, number]): Box => {
    // A moving label reserves its row across the whole sweep, so it meets no other label at any instant.
    const w = sweep ? Math.min(q.right - q.left, sweep[1] - sweep[0] + lw) : lw;
    const clampX = (x: number) => Math.max(q.left, Math.min(q.right - w, x));
    // Centred first; a point label may then shift a gap at a time either way (its leader keeps it attached).
    const xs = sweep ? [clampX(sweep[0] - lw / 2)] : !leader ? [clampX(cx - w / 2)] : [...new Set([0, ...Array.from({ length: Math.ceil((q.right - q.left) / gap) }, (_, j) => [(j + 1) * gap, -(j + 1) * gap]).flat()]
      .map(dx => clampX(cx - w / 2 + dx)))];
    const tryAt = (i: number, x: number) => {
      const box = { x, y: rowY(i), w, h: hh };
      if (placedRows.some(o => o.row === i && overlaps(o.box, box, gap))) return undefined;
      if (leaders.some(l => segHitsBox(l.p, l.q, grow(box, air)))) return undefined;
      if (swept.some(s => overlaps(s, box, air))) return undefined;
      const line = { p: { x: Math.max(x, Math.min(cx, x + w)), y: box.y + hh }, q: { x: cx, y: 0 } };
      const sweepBox = sweep && { x: sweep[0], y: box.y + hh, w: sweep[1] - sweep[0], h: -(box.y + hh) };
      if (sweepBox && placedRows.some(o => o.row < i && overlaps(sweepBox, o.box, air))) return undefined;
      if (leader && !sweep && placedRows.some(o => o.row < i && segHitsBox(line.p, line.q, grow(o.box, air)))) return undefined;
      return { box, line, ...(sweepBox ? { sweepBox } : {}) };
    };
    let got: { box: Box; line: { p: Pt; q: Pt }; sweepBox?: Box } | undefined, row = 0;
    for (; row <= rowCount && !got; row++) for (const x of xs) if ((got = tryAt(row, x))) break;
    row--;
    // Only labels crowded past every offset in every row reach here: a fresh row on top, centred.
    if (!got) {
      row = rowCount;
      const box = { x: xs[0]!, y: rowY(row), w, h: hh };
      got = { box, line: { p: { x: cx, y: box.y + hh }, q: { x: cx, y: 0 } }, ...(sweep ? { sweepBox: { x: sweep[0], y: box.y + hh, w: sweep[1] - sweep[0], h: -(box.y + hh) } } : {}) };
    }
    rowCount = Math.max(rowCount, row + 1);
    placedRows.push({ box: got.box, row });
    if (got.sweepBox) swept.push(got.sweepBox);
    else if (leader) leaders.push(got.line);
    return got.box;
  };
  // A moving label's row comes first, nearest the plot: nothing then sits under it for its leader to cross.
  const riding = new Map(q.points.flatMap((pt, i) => (pt.sweep ? [[i, put(pt.x, pt.w, true, pt.sweep)] as const] : [])));
  const marks = q.marks.map(m => (m.w ? put(m.x, m.w, false) : undefined));
  const pointsOut = points.map((p, i) => (p === ROW ? { row: riding.get(i) ?? put(q.points[i]!.x, q.points[i]!.w, true) } : p));
  return {
    top: rowCount ? -rowY(rowCount - 1) : Math.max(hh / 2, -ceiling - tight),
    lanes: laneAt,
    marks,
    bands: bands.map((b, i) => b ?? { lane: laneAt.get(q.bands[i]!.key)! }),
    points: pointsOut,
  };
}

/** Lowest and highest y every state reaches over plot x [x0, x1] (undefined where no line is drawn). */
function extentOf(xpos: number[], states: number[][], x0: number, x1: number): { min: number; max: number } | undefined {
  const a = Math.max(x0, xpos[0]!), b = Math.min(x1, xpos[xpos.length - 1]!);
  if (a > b) return undefined;
  // Each state is linear between x labels, so its extremes over [a, b] are at a, b or an x label between.
  const xs = [a, ...xpos.filter(x => x > a && x < b), b];
  const ys = states.flatMap(st => xs.map(x => yAt(xpos, st, x)));
  return { min: Math.min(...ys), max: Math.max(...ys) };
}

/** Where a series lies relative to box b over the whole scene: wholly above it, wholly below, not beside it, or a hit. */
function sideOf(xpos: number[], states: number[][], b: Box): 'above' | 'below' | 'none' | 'hit' {
  const e = extentOf(xpos, states, b.x, b.x + b.w);
  if (!e) return 'none';
  return e.max < b.y ? 'above' : e.min > b.y + b.h ? 'below' : 'hit';
}

/** A polyline's y at plot x (linear between x labels, flat beyond the ends). */
function yAt(xpos: number[], ys: number[], x: number): number {
  const n = xpos.length;
  if (x <= xpos[0]!) return ys[0]!;
  for (let i = 1; i < n; i++) if (x <= xpos[i]!) return ys[i - 1]! + (ys[i]! - ys[i - 1]!) * (x - xpos[i - 1]!) / (xpos[i]! - xpos[i - 1]! || 1);
  return ys[n - 1]!;
}

// ---------------------------------------------------------------- geometry and values

interface Box { x: number; y: number; w: number; h: number }
type Pt = { x: number; y: number };

const overlaps = (a: Box, b: Box, pad: number) => a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;

/** Does segment p→q pass through box b (Liang–Barsky clip)? */
function segHitsBox(p: Pt, q: Pt, b: Box): boolean {
  let t0 = 0, t1 = 1;
  const dx = q.x - p.x, dy = q.y - p.y;
  for (const [pp, qq] of [[-dx, p.x - b.x], [dx, b.x + b.w - p.x], [-dy, p.y - b.y], [dy, b.y + b.h - p.y]] as const) {
    if (pp === 0) { if (qq < 0) return false; continue; }
    const t = qq / pp;
    if (pp < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
    else { if (t < t0) return false; if (t < t1) t1 = t; }
  }
  return t0 <= t1;
}

/** Fractional x index (label units) at plot x `px`. */
function xIndexAt(xpos: number[], px: number): number {
  const n = xpos.length;
  if (px <= xpos[0]!) return 0;
  for (let i = 1; i < n; i++) if (px <= xpos[i]!) return i - 1 + (px - xpos[i - 1]!) / (xpos[i]! - xpos[i - 1]! || 1);
  return n - 1;
}

/** A series' value at a fractional x index, on the straight segment the plot draws (geometric on a log axis). */
function valueAtX(vs: number[], x: number, log = false): number {
  const i = Math.min(vs.length - 1, Math.floor(x)), f = x - i;
  return i >= vs.length - 1 ? vs[vs.length - 1]! : lerp(vs[i]!, vs[i + 1]!, f, log);
}

/** From a to b by f: straight, or (log, both above 0) straight in powers of ten, so a drawn segment stays straight. */
const lerp = (a: number, b: number, f: number, log = false) => (log && a > 0 && b > 0 ? a * (b / a) ** f : a + (b - a) * f);

/**
 * The values an item shows now: a `set` mid-change interpolates from its previous value (or, on the first
 * set, the declared one: timing carries no `from` for declared content) to the new one, on the set's curve.
 */
function valueAt(it: ItemState | undefined, declared: number[], log = false): number[] {
  const c: Content | undefined = it?.content;
  const cur = c ? numbers(c.cur) : undefined;
  if (!c || !cur || cur.length !== declared.length) return declared;
  if (c.p >= 1) return cur;
  const prev = (c.prev && numbers(c.prev)) || declared;
  return cur.map((v, i) => lerp(prev[i]!, v, c.p, log));
}

function numbers(c: Inline): number[] | undefined {
  const parts = plain(c).trim().split(/\s+/).filter(Boolean);
  return parts.length && parts.every(p => NUM.test(p)) ? parts.map(Number) : undefined;
}

const clamp = (v: number) => Math.max(0, Math.min(1, v));
/** Fade-in of something drawn along a growth `g` (0..1): 0 until `from`, then linearly to 1 at g = 1. */
const reveal = (g: number, from: number) => clamp((g - from) / (1 - from));

const CSS = `
.ch-chart { position: relative; width: max-content; --ch-recede: 0; }
.ch-cap { margin-bottom: var(--label-gap); }
.ch-probe { position: absolute; visibility: hidden; left: 0; top: 0; white-space: pre; }
.ch-probe > * { position: absolute; white-space: pre; }
.ch-rest { opacity: calc(1 - var(--ch-recede) * (1 - var(--recede-opacity))); }
.ch-part { --vis: 1; --hl: 0; --now: 0; --recede: 0; --reveal: 1;
  opacity: calc(var(--vis) * var(--reveal) * (1 - var(--recede) * (1 - var(--recede-opacity)))); }

/* bars */
.ch-bars { position: relative; display: grid; grid-template-columns: max-content max-content; column-gap: var(--space-5);
  padding-right: var(--ch-reach); row-gap: var(--ch-gap); }
.ch-row { display: grid; grid-template-columns: subgrid; grid-column: 1 / -1; align-items: center; }
.ch-tracks { display: flex; flex-direction: column; gap: var(--space-1); }
/* Sparse frames open the bars apart with the flexible pitch (up to half a bar more between rows), never thicker bars. */
.ch-bars { --ch-gap: calc(var(--space-3) + var(--node-h) * (var(--pitch, 1) - 1)); }
/* Grouped rows: bars tight within a row, a wider gap between rows, so each row reads as one group. */
.ch-bars.ch-grouped { --ch-gap: calc(var(--space-5) + var(--node-h) * (var(--pitch, 1) - 1)); }
/* A log value axis: tick labels in a row of their own under the track; grid lines from the first bar to the last. */
.ch-axis { grid-column: 2; position: relative; height: calc(var(--text-label) * var(--leading-tight)); }
.ch-axis > .ch-x { top: 0; }
.ch-gl { position: absolute; top: 0; bottom: calc(var(--text-label) * var(--leading-tight) + var(--ch-gap)); width: var(--stroke-hair);
  translate: -50% 0; background: var(--line); }
.ch-gl-base { background: var(--line-strong); }
.ch-label { justify-self: end; white-space: nowrap; font: var(--weight-regular) var(--text-body) / var(--leading-tight) var(--font-sans);
  color: color-mix(in srgb, var(--hl-held-ink) calc(var(--hl) * 100%), var(--ink-2)); }
.ch-track { position: relative; height: var(--node-h); }
.ch-grouped .ch-track { height: var(--chart-bar-group-h); }
/* Series fills: a light and a dark grey, never hues; a single-series chart is all --chart-bar. */
.ch-track { --ch-fill: var(--chart-bar); }
.ch-grouped .ch-s1, .ch-legend .ch-s1 { --ch-fill: var(--chart-series-1); }
.ch-grouped .ch-s2, .ch-legend .ch-s2 { --ch-fill: var(--chart-series-2); }
.ch-bar { position: absolute; top: 0; bottom: 0; overflow: hidden; border-radius: var(--radius-cell);
  background: color-mix(in srgb, var(--chart-bar-hl) calc(var(--hl) * 100%), var(--ch-fill)); }
/* The highlight bar sits on the value end: amber while now, held grey after. */
.ch-edge { position: absolute; top: 0; bottom: 0; right: 0; width: var(--stroke-mark); opacity: var(--hl);
  background: color-mix(in srgb, var(--hl-now-bar) calc(var(--now) * 100%), var(--hl-held-bar)); }
.ch-bar.ch-neg > .ch-edge { right: auto; left: 0; }
.ch-value { position: absolute; top: 50%; translate: var(--space-3) -50%; white-space: nowrap;
  font: var(--weight-medium) var(--text-node) / var(--leading-tight) var(--font-sans); font-variant-numeric: var(--numeric);
  color: color-mix(in srgb, var(--hl-now-ink) calc(var(--now) * 100%), var(--ink-1)); }
.ch-probe > .ch-value { translate: none; }
/* Axis titles and the legend: quiet, horizontal, on lines of their own. */
.ch-title { white-space: nowrap; font: var(--weight-regular) var(--text-label) / var(--leading-tight) var(--font-sans); color: var(--ink-3); }
.ch-plot > .ch-title, .ch-foot > .ch-title { position: absolute; left: 0; top: 0; }
.ch-head { display: flex; justify-content: space-between; align-items: center; column-gap: var(--space-5); margin-bottom: var(--space-3); }
.ch-foot { position: relative; height: calc(var(--text-label) * var(--leading-tight)); margin-top: var(--space-3); }
.ch-legend { display: flex; column-gap: var(--space-4); }
.ch-key { display: flex; align-items: center; column-gap: var(--space-2); white-space: nowrap;
  font: var(--weight-regular) var(--text-label) / var(--leading-tight) var(--font-sans); color: var(--ink-2); }
.ch-swatch { width: var(--space-5); height: var(--space-3); border-radius: var(--radius-cell); background: var(--ch-fill); }

/* lines */
.ch-plot { position: relative; }
.ch-area { position: absolute; }
.ch-svg { position: absolute; left: 0; top: 0; display: block; overflow: visible; }
.ch-gridline { stroke: var(--line); stroke-width: var(--stroke-hair); }
.ch-base { stroke: var(--line-strong); stroke-width: var(--stroke-hair); }
.ch-tick { position: absolute; white-space: nowrap; font: var(--weight-regular) var(--text-label) / var(--leading-tight) var(--font-sans);
  font-variant-numeric: var(--numeric); color: var(--ink-3); }
.ch-y { translate: -100% -50%; }
.ch-x { translate: -50% 0; }
.ch-probe > .ch-tick { translate: none; }
/* One look for every drawn part: rest ink, held ink-1, amber while now, ink-4 when receded. */
.ch-series, .ch-ink, .ch-mark, .ch-dot, .ch-band {
  --ink: color-mix(in srgb, var(--ink-4) calc(var(--recede) * 100%),
         color-mix(in srgb, var(--hl-now-bar) calc(var(--now) * 100%),
         color-mix(in srgb, var(--hl-held-ink) calc(var(--hl) * 100%), var(--ch-rest-ink, var(--ink-2))))); }
.ch-line { fill: none; stroke: var(--ink); stroke-width: var(--stroke-mark); stroke-linecap: round; stroke-linejoin: round;
  stroke-dasharray: 1 1; }
.ch-leader { --vis: 1; --recede: 0; fill: none; stroke: var(--line-strong); stroke-width: var(--stroke-hair);
  opacity: calc(var(--vis) * (1 - var(--recede) * (1 - var(--recede-opacity)))); }
.ch-name { position: absolute; white-space: pre; color: var(--ink);
  font: var(--weight-medium) var(--text-label) / var(--leading-tight) var(--font-sans); }
/* Chart numbers are sans with tabular figures: an axis reads as a figure, not as code. */
.ch-last, .ch-num { font-weight: var(--weight-regular); font-variant-numeric: var(--numeric); }
.ch-alabel { position: absolute; white-space: nowrap; color: var(--ink); --ch-rest-ink: var(--ink-1);
  font: var(--weight-medium) var(--text-label) / var(--leading-tight) var(--font-sans); }
.ch-mlabel { --ch-rest-ink: var(--ink-2); }
.ch-ride { translate: -50% 0; }
.ch-mark { --vis: 1; --hl: 0; --now: 0; --recede: 0; stroke: color-mix(in srgb, var(--ink) calc(max(var(--hl), var(--now)) * 100%), var(--line-strong));
  stroke-width: var(--stroke-edge); stroke-dasharray: var(--space-1) var(--space-1); stroke-linecap: butt;
  opacity: calc(min(1, var(--vis) * 4) * (1 - var(--recede) * (1 - var(--recede-opacity)))); }
.ch-dot { --vis: 1; --hl: 0; --now: 0; --recede: 0; --ch-rest-ink: var(--ink-1); fill: var(--ink); stroke: var(--bg); stroke-width: var(--stroke-mark);
  opacity: calc(var(--vis) * (1 - var(--recede) * (1 - var(--recede-opacity)))); }
.ch-band { --vis: 1; --hl: 0; --now: 0; --recede: 0;
  fill: color-mix(in srgb, var(--chart-band-hl) calc(max(var(--hl), var(--now)) * 100%), var(--chart-band));
  opacity: calc(1 - var(--recede) * (1 - var(--recede-opacity))); }
`;
