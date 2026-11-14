/** Fixed-lattice display projection. All times are seconds; dots never move. */
import { type CloudInput, mapCloudTiming, segmentCloudText } from './wordCloud';

export interface MatrixToken {
  text: string;
  offset: number;
  begin: number;
}
export interface MatrixLine {
  id: number;
  text: string;
  begin: number;
  end: number;
  explicitEnd: boolean;
  timed: boolean;
  background: boolean;
  primary: boolean;
  translation?: string;
  roman?: string;
  tokens: MatrixToken[];
}
export type MatrixPhase = 'intro' | 'singing' | 'interlude' | 'outro' | 'static';
export type MatrixEffect = 'quiet' | 'sweep' | 'ripple' | 'checker' | 'radial' | 'lyrics';
export interface MatrixGrid {
  step: number;
  columns: number;
  rows: number;
  width: number;
  height: number;
}
export const matrixClamp = (x: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));
export function matrixEase(value: number) {
  const x = matrixClamp(value);
  return x * x * (3 - 2 * x);
}

export function buildMatrixLines(
  inputs: CloudInput[],
  segment?: (text: string) => { word: string; tag: string }[]
): MatrixLine[] {
  return inputs.map((input, id) => {
    const slices = mapCloudTiming(input);
    const next = inputs.slice(id + 1).find((line) => !line.background && line.begin > input.begin);
    const wordEnd = slices?.length ? Math.max(...slices.map((slice) => slice.end)) : undefined;
    const explicitEnd = Boolean(
      wordEnd !== undefined ||
      (input.reliableEnd && Number.isFinite(input.end) && input.end! > input.begin)
    );
    const end = wordEnd ?? (explicitEnd ? input.end! : (next?.begin ?? Infinity));
    const parts = segmentCloudText(input.text, segment);
    const tokens = parts.map((part) => {
      const timing = slices?.filter(
        (slice) => slice.offset >= part.offset && slice.offset < part.offset + part.text.length
      );
      return {
        text: part.text,
        offset: part.offset,
        begin: timing?.length ? Math.min(...timing.map((slice) => slice.begin)) : input.begin
      };
    });
    return {
      id,
      text: input.text,
      begin: input.begin,
      end,
      explicitEnd,
      timed: Boolean(slices?.length),
      background: Boolean(input.background),
      primary: Boolean(input.primary),
      translation: input.translation,
      roman: input.roman,
      tokens
    };
  });
}

export function matrixPlayback(lines: MatrixLine[], time: number) {
  const main = lines.filter((line) => !line.background && line.text.trim());
  if (!main.length) return { phase: 'static' as MatrixPhase, lines: [] as MatrixLine[] };
  const timed = main.filter((line) => line.begin >= 0);
  if (!timed.length) return { phase: 'static' as MatrixPhase, lines: main.slice(0, 3) };
  const first = Math.min(...timed.map((line) => line.begin));
  if (time < first) return { phase: 'intro' as MatrixPhase, lines: [] as MatrixLine[] };
  const started = timed.filter((line) => line.begin <= time);
  const latest = started.reduce((a, b) => (b.begin >= a.begin ? b : a));
  // Blank timestamp lines explicitly end ordinary LRC. No invented character or vocal duration.
  const blank = lines.some(
    (line) => !line.text.trim() && line.begin > latest.begin && line.begin <= time
  );
  const next = timed.some((line) => line.begin > time);
  const active = started.filter((line) =>
    line.explicitEnd ? time < line.end : line.begin === latest.begin && !blank
  );
  const backgrounds = lines.filter(
    (line) => line.background && line.begin <= time && time < line.end && line.text.trim()
  );
  if (active.length || backgrounds.length)
    return {
      phase: 'singing' as MatrixPhase,
      lines: [
        ...active.sort((a, b) => Number(b.primary) - Number(a.primary)).slice(0, 2),
        ...backgrounds.slice(0, 1)
      ]
    };
  return { phase: (next ? 'interlude' : 'outro') as MatrixPhase, lines: [] as MatrixLine[] };
}

export function createMatrixGrid(width: number, height: number, spacing: number): MatrixGrid {
  // Bound CPU cost on very large displays without rendering a giant bitmap.
  const step = Math.max(
    4,
    Number.isFinite(spacing) ? spacing : 8,
    Math.sqrt((width * height) / 36000)
  );
  return { width, height, step, columns: Math.ceil(width / step), rows: Math.ceil(height / step) };
}
export function matrixCell(grid: MatrixGrid, column: number, row: number) {
  return { x: (column + 0.5) * grid.step, y: (row + 0.5) * grid.step };
}

export interface MatrixDot {
  index: number;
  token: number;
  line: number;
  begin: number;
  timed: boolean;
}
export interface MatrixMask {
  dots: MatrixDot[];
  bounds: { left: number; top: number; right: number; bottom: number };
  fits?: boolean;
}
export interface MatrixRaster {
  /** Pixel fonts must use native sizes or integer multiples, even for dense lyrics. */
  sizes?: readonly number[];
  measure(text: string, size: number): number;
  /** Raster pixels are grid cells, never physical screen coordinates. */
  pixels(text: string, size: number, width: number, height: number): { x: number; y: number }[];
}

export function buildMatrixMask(
  grid: MatrixGrid,
  lines: MatrixLine[],
  fontCells: number,
  raster: MatrixRaster
): MatrixMask {
  const sizes = raster.sizes;
  const snapSize = (size: number) => sizes
    ? [...sizes].reverse().find(value => value <= size) ?? sizes[0]
    : Math.max(4, Math.round(size));
  const maxWidth = Math.max(8, Math.floor(grid.columns * 0.82));
  const maxHeight = Math.max(10, Math.floor(grid.rows * 0.58));
  type Row = {
    text: string;
    line: MatrixLine;
    pieces: { text: string; token: number; begin: number }[];
    size: number;
  };
  function pack(size: number) {
    const rows: Row[] = [];
    for (const line of lines) {
      const actualSize = line.background ? snapSize(size * 0.65) : size;
      let row: Row = { text: '', line, pieces: [], size: actualSize };
      for (const [token, part] of line.tokens.entries()) {
        for (const char of Array.from(part.text)) {
          if (
            row.text &&
            (char === '\n' || raster.measure(row.text + char, actualSize) > maxWidth - 4)
          ) {
            rows.push(row);
            row = { text: '', line, pieces: [], size: actualSize };
          }
          if (char === '\n') continue;
          row.text += char;
          row.pieces.push({ text: char, token, begin: part.begin });
        }
      }
      if (row.text) rows.push(row);
    }
    return rows;
  }
  let size = sizes ? snapSize(fontCells) : Math.max(8, Math.round(fontCells)),
    rows = pack(size);
  while (size > (sizes?.[0] ?? 4) && rows.reduce((n, row) => n + Math.ceil(row.size * 1.4), 0) > maxHeight) {
    size = sizes ? sizes[sizes.indexOf(size) - 1] : size - 1;
    rows = pack(size);
  }
  const totalHeight = rows.reduce((n, row) => n + Math.ceil(row.size * 1.4), 0);
  let top = Math.max(2, Math.round((grid.rows - totalHeight) / 2 - grid.rows * 0.025));
  const dots: MatrixDot[] = [];
  for (const row of rows) {
    const width = Math.min(maxWidth, Math.ceil(raster.measure(row.text, row.size)) + 4);
    const height = Math.ceil(row.size * 1.4);
    const left = Math.round((grid.columns - width) / 2);
    let prefix = '';
    const spans = row.pieces.map((piece) => {
      prefix += piece.text;
      return { ...piece, end: raster.measure(prefix, row.size) + 2 };
    });
    const rtl = /[\p{Script=Arabic}\p{Script=Hebrew}]/u.test(row.text);
    for (const pixel of raster.pixels(row.text, row.size, width, height)) {
      const column = left + pixel.x,
        y = top + pixel.y;
      if (column < 0 || column >= grid.columns || y < 0 || y >= grid.rows) continue;
      const at = rtl ? width - pixel.x : pixel.x;
      const piece = spans.find((span) => span.end > at) ?? spans[spans.length - 1];
      dots.push({
        index: y * grid.columns + column,
        token: piece.token,
        line: row.line.id,
        begin: piece.begin,
        timed: row.line.timed
      });
    }
    top += height;
  }
  const columns = dots.map((dot) => dot.index % grid.columns),
    ys = dots.map((dot) => Math.floor(dot.index / grid.columns));
  return {
    dots,
    fits: totalHeight <= grid.rows - 4,
    bounds: dots.length
      ? {
          left: Math.min(...columns),
          right: Math.max(...columns),
          top: Math.min(...ys),
          bottom: Math.max(...ys)
        }
      : { left: 0, right: 0, top: 0, bottom: 0 }
  };
}

/** Choose once for the whole song so playback never changes the background lattice. */
export function createReadableMatrixGrid(
  width: number,
  height: number,
  spacing: number,
  lines: MatrixLine[],
  raster: MatrixRaster
): MatrixGrid {
  let grid = createMatrixGrid(width, height, spacing);
  if (!raster.sizes || !lines.length) return grid;
  const times = [...new Set(lines.filter(line => line.text.trim()).map(line => line.begin))];
  const groups = times.map(time => matrixPlayback(lines, time).lines);
  // Fit is determined by line metrics; do not rasterize the entire song during loading.
  const metricsOnly = { ...raster, pixels: () => [] };
  while (true) {
    if (groups.every(group => buildMatrixMask(grid, group, raster.sizes![0], metricsOnly).fits)) break;
    if (grid.step <= 4) break;
    const next = createMatrixGrid(width, height, Math.max(4, grid.step - 1));
    if (next.step >= grid.step) break;
    grid = next;
  }
  return grid;
}

export function matrixEnvelope(age: number, attack = 0.16, release = 0.42) {
  if (age < 0 || age >= attack + release) return 0;
  return age < attack ? matrixEase(age / attack) : 1 - matrixEase((age - attack) / release);
}
export function matrixFallRows(age: number, reduced: boolean, enabled: boolean) {
  if (!enabled || reduced || age < 0 || age >= 0.46) return 0;
  // Integer rows: illuminate successive cells of the fixed lattice; never translate dots.
  if (age < 0.22) return -Math.round(4 * (1 - (age / 0.22) ** 2));
  if (age < 0.34) return Math.round(Math.sin(((age - 0.22) / 0.12) * Math.PI));
  return 0;
}
export function matrixLyricTargets(
  mask: MatrixMask,
  grid: MatrixGrid,
  time: number,
  wordDrop: boolean,
  reduced: boolean,
  target = new Float32Array(grid.columns * grid.rows)
) {
  target.fill(0);
  for (const dot of mask.dots) {
    const age = time - dot.begin;
    const on = dot.timed ? matrixEase(age / 0.16) : 1;
    const offset = matrixFallRows(age, reduced, wordDrop && dot.timed);
    const index = dot.index + offset * grid.columns;
    if (index >= 0 && index < target.length) target[index] = Math.max(target[index], on);
  }
  return target;
}
function noise(x: number, y: number, seed: number) {
  const value = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
  return value - Math.floor(value);
}
export function matrixField(
  effect: MatrixEffect,
  column: number,
  row: number,
  grid: MatrixGrid,
  beat: number
) {
  const x = (column + 0.5) / grid.columns,
    y = (row + 0.5) / grid.rows;
  if (effect === 'quiet') {
    const whole = Math.floor(beat),
      phase = beat - whole;
    return noise(column, row, whole) > 0.965 ? matrixEnvelope(phase, 0.22, 0.78) : 0;
  }
  if (effect === 'sweep') {
    const phase = (beat / 6) % 1;
    const center = (-0.2 + phase * 1.4) * (grid.width + grid.height);
    const distance =
      ((column + 0.5) * grid.step + (row + 0.5) * grid.step - center) / (grid.step * 4);
    // x+y constant gives a true 45° line, including on non-square viewports.
    return (
      Math.exp(-(distance ** 2)) * matrixEase(phase / 0.1) * (1 - matrixEase((phase - 0.9) / 0.1))
    );
  }
  const dx = (x - 0.5) * grid.width,
    dy = (y - 0.5) * grid.height;
  if (effect === 'ripple') {
    const distance = Math.hypot(dx, dy) / Math.hypot(grid.width / 2, grid.height / 2);
    const phase = (beat / 2) % 1;
    return (
      Math.exp(-(((distance - phase * 1.4) / 0.08) ** 2)) *
      matrixEase(phase / 0.12) *
      (1 - matrixEase((phase - 0.85) / 0.15))
    );
  }
  if (effect === 'checker')
    return (
      0.5 -
      0.5 * Math.cos(beat * Math.PI + (Math.floor(column / 6) + Math.floor(row / 6)) * Math.PI)
    );
  if (effect === 'radial') return (0.5 + 0.5 * Math.cos(Math.atan2(dy, dx) * 7 - beat * 0.8)) ** 6;
  return 0;
}
/** Asymmetric continuous color response, even when a beat or mask changes abruptly. */
export function stepMatrixLevel(current: number, target: number, dt: number) {
  const tau = target > current ? 0.055 : 0.15;
  return current + (target - current) * (1 - Math.exp(-matrixClamp(dt, 0, 0.08) / tau));
}
