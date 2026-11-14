/** Pure word-cloud projection, layout and playback math. All times are seconds. */
import tinycolor from 'tinycolor2';

import { cloudArticleGroups, packCloudArticleSteps } from './wordCloudArticle';

/** The background wash bounds even white engine output below this backdrop. */
export function cloudPalette(theme: string): string[] {
  const hsl = tinycolor(theme).toHsl();
  return Array.from({ length: 12 }, (_, i) => {
    const color = {
      h: hsl.h + (i - 5) * 2,
      s: hsl.s < 0.08 ? 0 : Math.min(0.8, Math.max(0.25, hsl.s + ((i % 3) - 1) * 0.1)),
      l: 0.65 + (i / 11) * 0.24
    };
    while (tinycolor.readability(tinycolor(color), '#565a60') < 4.5 && color.l < 0.98) {
      color.l += 0.01;
    }
    return tinycolor(color).toHexString();
  });
}

export interface CloudInput {
  text: string;
  begin: number;
  end?: number;
  reliableEnd?: boolean;
  words?: { text: string; begin: number; end: number }[];
  translation?: string;
  roman?: string;
  background?: boolean;
  primary?: boolean;
  parent?: number;
}
export interface CloudSlice {
  text: string;
  offset: number;
  begin: number;
  end: number;
}
export interface CloudWord {
  text: string;
  offset: number;
  tag: string;
  slices: CloudSlice[];
  x: number;
  y: number;
  width: number;
  size: number;
  shade: number;
  ink?: CloudRect;
  stops: { offset: number; x: number }[];
}
export interface CloudRect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface CloudLine extends CloudInput {
  id: number;
  end: number;
  reliableEnd: boolean;
  timedWords: boolean;
  tokens: CloudWord[];
  rect: CloudRect;
  angle: number;
  localWidth: number;
  localHeight: number;
}
export interface CloudLayout {
  lines: CloudLine[];
  bounds: CloudRect;
  untimed: boolean;
}
export interface CloudOptions {
  scale: number;
  spacing: number;
  vertical: number;
}
export type CloudSegmenter = (text: string) => { word: string; tag: string }[];
export interface CloudCamera {
  x: number;
  y: number;
  scale: number;
  angle: number;
}
export interface CloudPhase {
  kind: 'singing' | 'intro' | 'interlude' | 'outro' | 'static';
  next: number;
}
export const clampCloud = (x: number, min = 0, max = 1) => Math.min(max, Math.max(min, x));

function hash(text: string) {
  let value = 2166136261;
  for (let i = 0; i < text.length; i++) value = Math.imul(value ^ text.charCodeAt(i), 16777619);
  return value >>> 0;
}
export function segmentCloudText(text: string, segment?: CloudSegmenter) {
  let parts: { word: string; tag: string }[];
  try {
    parts =
      segment?.(text) ??
      [...new Intl.Segmenter(undefined, { granularity: 'word' }).segment(text)].map((s) => ({
        word: s.segment,
        tag: 'x'
      }));
  } catch {
    parts = Array.from(text).map((word) => ({ word, tag: 'x' }));
  }
  const result: { text: string; offset: number; tag: string }[] = [];
  let cursor = 0;
  for (const part of parts) {
    if (!part.word) continue;
    const offset = text.indexOf(part.word, cursor);
    if (offset < 0) continue;
    if (offset > cursor)
      result.push({ text: text.slice(cursor, offset), offset: cursor, tag: 'x' });
    result.push({ text: part.word, offset, tag: part.tag });
    cursor = offset + part.word.length;
  }
  if (cursor < text.length) result.push({ text: text.slice(cursor), offset: cursor, tag: 'x' });
  return result;
}

export function mapCloudTiming(input: CloudInput): CloudSlice[] | null {
  if (!input.words?.length) return null;
  if (
    input.words.some(
      (w) =>
        w.text.trim() &&
        (!Number.isFinite(w.begin) || !Number.isFinite(w.end) || w.end <= w.begin || w.begin < 0)
    )
  )
    return null;
  if (
    input.words
      .map((w) => w.text)
      .join('')
      .replace(/\s/g, '') !== input.text.replace(/\s/g, '')
  )
    return null;
  const result: CloudSlice[] = [];
  let cursor = 0;
  for (const word of input.words) {
    for (const char of Array.from(word.text)) {
      if (/\s/.test(char)) continue;
      while (cursor < input.text.length && /\s/.test(input.text[cursor])) cursor++;
      if (input.text.slice(cursor, cursor + char.length) !== char) return null;
      result.push({ text: char, offset: cursor, begin: word.begin, end: word.end });
      cursor += char.length;
    }
  }
  return result;
}

export function estimateCloudDuration(text: string) {
  const han = (
    text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu) || []
  ).length;
  const other = (
    text
      .replace(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu, ' ')
      .match(/[\p{L}\p{N}]+/gu) || []
  ).length;
  return Math.min(24, Math.max(6, 4 + Math.max(han * 0.5, other * 0.7)));
}

export function cloudOverlap(a: CloudRect, b: CloudRect, gap = 0) {
  return (
    a.x < b.x + b.width + gap &&
    a.x + a.width + gap > b.x &&
    a.y < b.y + b.height + gap &&
    a.y + a.height + gap > b.y
  );
}

export function* buildCloudLayoutSteps(
  inputs: CloudInput[],
  seed: string,
  options: CloudOptions,
  measure: (text: string, size: number) => number,
  segment?: CloudSegmenter,
  measureInk?: (text: string, size: number) => CloudRect
): Generator<void, CloudLayout> {
  const untimed = !inputs.some((line) => line.text.trim() && line.begin >= 0);
  const lines: CloudLine[] = [];
  for (const [id, input] of inputs.entries()) {
    yield;
    if (!input.text.trim()) continue;
    const slices = mapCloudTiming(input);
    let end =
      input.reliableEnd && Number.isFinite(input.end) && input.end! > input.begin
        ? input.end!
        : slices?.length
          ? Math.max(...slices.map((s) => s.end))
          : input.begin + estimateCloudDuration(input.text);
    if (!input.reliableEnd && !slices?.length && input.begin >= 0) {
      const nextBegin = inputs
        .slice(id + 1)
        .find((l) => !l.background && l.begin > input.begin)?.begin;
      if (nextBegin !== undefined) end = Math.min(end, nextBegin);
    }
    if (slices?.length) end = Math.max(end, ...slices.map((s) => s.end));
    const parentLine = input.background ? lines.find((l) => l.id === input.parent) : undefined;
    const angle =
      parentLine?.angle ??
      (hash(`${seed}:${id}:direction`) / 4294967296 < options.vertical ? Math.PI / 2 : 0);
    let x = 0,
      y = 0,
      rowHeight = 0,
      width = 0;
    const tokens: CloudWord[] = [];
    for (const part of segmentCloudText(input.text, segment)) {
      const variation = hash(`${seed}:${id}:${part.offset}`) / 4294967296;
      const size = 32 * options.scale * (input.background ? 0.65 : 1);
      // A single long token is split only for wrapping; its offsets/timing stay intact.
      const pieces =
        measure(part.text, size) > 560 * options.scale ? Array.from(part.text) : [part.text];
      let offset = part.offset;
      for (const text of pieces) {
        const tokenWidth = measure(text, size);
        if (x > 0 && (x + tokenWidth > 560 * options.scale || text.includes('\n'))) {
          x = 0;
          y += rowHeight + 8 * options.scale;
          rowHeight = 0;
        }
        const tokenSlices =
          slices?.filter((s) => s.offset >= offset && s.offset < offset + text.length) ?? [];
        const offsets = new Set([0, text.length]);
        for (const slice of tokenSlices) {
          offsets.add(slice.offset - offset);
          offsets.add(slice.offset - offset + slice.text.length);
        }
        tokens.push({
          text,
          offset,
          tag: part.tag,
          slices: tokenSlices,
          x,
          y,
          width: tokenWidth,
          size,
          shade: variation,
          stops: [...offsets]
            .sort((a, b) => a - b)
            .map((offset) => ({
              offset,
              x: measure(text.slice(0, offset), size)
            })),
          ...(measureInk ? { ink: measureInk(text, size) } : {})
        });
        offset += text.length;
        x += tokenWidth;
        rowHeight = Math.max(rowHeight, size * 1.4);
        width = Math.max(width, x);
      }
    }
    let height = y + rowHeight;
    if (measureInk) {
      const visible = tokens.filter((t) => t.text.trim() && t.ink!.width > 0 && t.ink!.height > 0);
      if (visible.length) {
        const left = Math.min(...visible.map((t) => t.x + t.ink!.x));
        const top = Math.min(...visible.map((t) => t.y + t.ink!.y));
        width = Math.max(...visible.map((t) => t.x + t.ink!.x + t.ink!.width)) - left;
        height = Math.max(...visible.map((t) => t.y + t.ink!.y + t.ink!.height)) - top;
        for (const token of tokens) {
          token.x -= left;
          token.y -= top;
        }
      }
    }
    const rect = { x: 0, y: 0, width: angle ? height : width, height: angle ? width : height };
    lines.push({
      ...input,
      id,
      end: Math.max(input.begin, end),
      reliableEnd: Boolean(
        (input.reliableEnd && Number.isFinite(input.end) && input.end! > input.begin) ||
        slices?.length
      ),
      timedWords: Boolean(slices?.length),
      tokens,
      rect,
      angle,
      localWidth: width,
      localHeight: height
    });
  }
  const packed = yield* packCloudArticleSteps(lines, seed, options.scale, 16 * options.spacing);
  return { lines: packed, untimed, bounds: cloudBounds(packed.map((line) => line.rect)) };
}

/** Synchronous entry for pure projections and tests. Scene uses cancellable slices. */
export function buildCloudLayout(...args: Parameters<typeof buildCloudLayoutSteps>): CloudLayout {
  const steps = buildCloudLayoutSteps(...args);
  let step = steps.next();
  while (!step.done) step = steps.next();
  return step.value;
}

/** Yield between 8ms tasks so long songs never block player interactions. */
export function runCloudLayout(
  steps: Generator<void, CloudLayout>,
  signal?: AbortSignal
): Promise<CloudLayout | null> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      resolve(null);
      return;
    }
    const channel = new MessageChannel();
    let running = false;
    let cancelled = false;
    const close = () => {
      channel.port1.close();
      channel.port2.close();
      signal?.removeEventListener('abort', cancel);
    };
    const cancel = () => {
      cancelled = true;
      close();
      if (!running) steps.return(null as never);
      resolve(null);
    };
    signal?.addEventListener('abort', cancel, { once: true });
    channel.port1.onmessage = () => {
      const deadline = performance.now() + 8;
      try {
        do {
          running = true;
          const step = steps.next();
          running = false;
          if (cancelled) {
            steps.return(null as never);
            return;
          }
          if (step.done) {
            close();
            resolve(step.value);
            return;
          }
        } while (performance.now() < deadline);
        channel.port2.postMessage(null);
      } catch (error) {
        running = false;
        close();
        reject(error);
      }
    };
    channel.port2.postMessage(null);
  });
}

function cloudBounds(rects: CloudRect[]): CloudRect {
  if (!rects.length) return { x: 0, y: 0, width: 1, height: 1 };
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  return {
    x,
    y,
    width: Math.max(0.001, Math.max(...rects.map((r) => r.x + r.width)) - x),
    height: Math.max(0.001, Math.max(...rects.map((r) => r.y + r.height)) - y)
  };
}

/** Match the physical viewport by opening gaps, never stretching glyphs or blocks.
 * Always project the original packing so rotations/resizes cannot accumulate drift.
 */
export function fitCloudLayoutToViewport(
  base: CloudLayout,
  width: number,
  height: number
): CloudLayout {
  if (!base.lines.length || !(width > 0 && height > 0)) return base;
  const lines = base.lines.map((line) => ({ ...line, rect: { ...line.rect } }));
  if (lines.length === 1) {
    const line = lines[0];
    const words = line.tokens.filter((word) => word.text.trim());
    if (words.length > 1) {
      const rects = words.map((word) => ({
        x: word.x + (word.ink?.x ?? 0),
        y: word.y + (word.ink?.y ?? 0),
        width: word.ink?.width ?? word.width,
        height: word.ink?.height ?? word.size * 1.4
      }));
      const projected = expandCloudRects(rects, line.angle ? height / width : width / height);
      const bounds = cloudBounds(projected);
      let i = 0;
      line.tokens = line.tokens.map((word) => {
        if (!word.text.trim()) return { ...word };
        const spot = projected[i++];
        return {
          ...word,
          x: spot.x - bounds.x - (word.ink?.x ?? 0),
          y: spot.y - bounds.y - (word.ink?.y ?? 0)
        };
      });
      line.localWidth = bounds.width;
      line.localHeight = bounds.height;
      line.rect.width = line.angle ? bounds.height : bounds.width;
      line.rect.height = line.angle ? bounds.width : bounds.height;
    }
  } else {
    const groups = cloudArticleGroups(lines);
    const boxes = groups.map((group) => cloudBounds(group.map((line) => line.rect)));
    const rects = expandCloudRects(boxes, width / height);
    groups.forEach((group, i) => {
      for (const line of group) {
        line.rect.x += rects[i].x - boxes[i].x;
        line.rect.y += rects[i].y - boxes[i].y;
      }
    });
  }
  return { ...base, lines, bounds: cloudBounds(lines.map((line) => line.rect)) };
}

function expandCloudRects(source: CloudRect[], aspect: number): CloudRect[] {
  const rects = source.map((rect) => ({ ...rect }));
  const bounds = cloudBounds(rects);
  const axis = bounds.width / bounds.height < aspect ? 'x' : 'y';
  const extent = axis === 'x' ? 'width' : 'height';
  const desired = axis === 'x' ? bounds.height * aspect : bounds.width / aspect;
  const centers = rects.map((rect) => rect[axis] + rect[extent] / 2);
  if (rects.length < 2 || Math.abs(desired - bounds[extent]) < 1e-8) return rects;
  // Coincident centers occur for stacked identical phrases. Their other axis
  // already separates them, so moving one block sideways cannot create a collision.
  if (Math.max(...centers) - Math.min(...centers) < 1e-8) {
    const left = Math.min(...rects.slice(0, -1).map((rect) => rect[axis]));
    const last = rects[rects.length - 1];
    last[axis] = left + desired - last[extent];
  } else {
    const origin = (Math.min(...centers) + Math.max(...centers)) / 2;
    const at = (factor: number) =>
      rects.map((rect, i) => ({
        ...rect,
        [axis]: origin + (centers[i] - origin) * factor - rect[extent] / 2
      }));
    let low = 1,
      high = 2;
    while (cloudBounds(at(high))[extent] < desired) high *= 2;
    for (let i = 0; i < 60; i++) {
      const middle = (low + high) / 2;
      if (cloudBounds(at(middle))[extent] < desired) low = middle;
      else high = middle;
    }
    return at((low + high) / 2);
  }
  return rects;
}

export function cloudPhase(
  layout: CloudLayout,
  time: number,
  duration: number,
  estimate: boolean
): CloudPhase {
  const lines = layout.lines.filter((l) => l.begin >= 0).sort((a, b) => a.begin - b.begin);
  if (layout.untimed || !lines.length) return { kind: 'static', next: -1 };
  const started = lines.filter((l) => l.begin <= time);
  const next = lines.find((l) => l.begin > time);
  if (!started.length)
    return {
      kind: lines[0].begin >= 5 && time < lines[0].begin - 0.5 ? 'intro' : 'singing',
      next: lines[0].begin
    };
  const lastMain = lines.filter((l) => !l.background).at(-1) ?? lines.at(-1)!;
  const tail = lines.filter((l) => l.begin >= lastMain.begin || l.end > lastMain.begin);
  const tailEnd = Math.min(
    Math.max(...tail.map((l) => l.end)),
    duration > lastMain.begin ? duration : Infinity
  );
  // Fume begins its closing overview halfway through the last vocal group.
  // Unreliable LRC endings still obey the user's conservative-estimation choice.
  if (
    (tail.every((l) => l.reliableEnd) || estimate) &&
    time >= lastMain.begin + Math.max(0, tailEnd - lastMain.begin) / 2
  )
    return { kind: 'outro', next: -1 };
  const latest = started.reduce((a, b) => (a.end > b.end ? a : b));
  if (started.some((l) => time < l.end)) return { kind: 'singing', next: next?.begin ?? -1 };
  const allowed = latest.reliableEnd || estimate;
  if (!allowed) return { kind: 'singing', next: next?.begin ?? -1 };
  if (!next) return { kind: 'singing', next: -1 };
  const validGap =
    next.begin - latest.end >= 5 && (latest.reliableEnd || next.begin - latest.begin >= 12);
  return { kind: validGap && time < next.begin - 0.5 ? 'interlude' : 'singing', next: next.begin };
}

export function cloudOpacity(
  line: CloudLine,
  slice: CloudSlice | undefined,
  time: number,
  untimed: boolean,
  reduced = false
) {
  if (untimed || line.begin < 0) return 1;
  if (!line.timedWords || !slice) return clampCloud((time - line.begin) / (reduced ? 0.12 : 0.32));
  return clampCloud(
    (time - slice.begin) / Math.max(0.016, Math.min(reduced ? 0.12 : 0.18, slice.end - slice.begin))
  );
}

export function cloudPoint(line: CloudLine, x: number, y: number) {
  return line.angle
    ? { x: line.rect.x + line.localHeight - y, y: line.rect.y + x }
    : { x: line.rect.x + x, y: line.rect.y + y };
}

export function activeCloudLines(layout: CloudLayout, time: number) {
  return layout.lines.filter((l) => !l.background && l.begin <= time && l.end > time);
}

/** Follow the printed edge, including progress inside the provider's original word.
 * Cross-row movement blends around the reading boundary instead of snapping back.
 */
export function cloudReadingPoint(line: CloudLine, time: number) {
  const words = line.tokens.filter((word) => word.text.trim());
  if (!words.length) return { x: line.localWidth / 2, y: line.localHeight / 2 };
  const rows: { y: number; height: number; start: number; end: number }[] = [];
  for (const word of words) {
    let row = rows.at(-1);
    if (!row || Math.abs(row.y - word.y) > 0.001) {
      row = { y: word.y, height: word.size, start: word.x, end: word.x + word.width };
      rows.push(row);
    } else {
      row.end = Math.max(row.end, word.x + word.width);
      row.height = Math.max(row.height, word.size);
    }
  }
  let rowIndex = 0,
    x = rows[0].start;
  if (line.timedWords) {
    const spans: { word: CloudWord; begin: number; end: number; from: number; to: number }[] = [];
    for (const word of words) {
      for (const slice of word.slices) {
        const from = word.stops.find((s) => s.offset === slice.offset - word.offset)?.x ?? 0;
        const to =
          word.stops.find((s) => s.offset === slice.offset - word.offset + slice.text.length)?.x ??
          word.width;
        const previous = spans.at(-1);
        if (previous?.word === word && previous.begin === slice.begin && previous.end === slice.end)
          previous.to = to;
        else spans.push({ word, begin: slice.begin, end: slice.end, from, to });
      }
    }
    const span = spans.filter((s) => s.begin <= time).at(-1) ?? spans[0];
    if (span) {
      const progress = clampCloud((time - span.begin) / Math.max(0.001, span.end - span.begin));
      const offset = span.from + (span.to - span.from) * progress;
      const rtl = /[\p{Script=Arabic}\p{Script=Hebrew}]/u.test(span.word.text);
      x = span.word.x + (rtl ? span.word.width - offset : offset);
      rowIndex = rows.findIndex((row) => Math.abs(row.y - span.word.y) < 0.001);
    }
  } else {
    let distance =
      clampCloud((time - line.begin) / Math.max(0.001, line.end - line.begin)) *
      rows.reduce((sum, row) => sum + row.end - row.start, 0);
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i],
        length = row.end - row.start;
      rowIndex = i;
      x = row.start + Math.min(distance, length);
      if (distance <= length) break;
      distance -= length;
    }
  }
  const row = rows[Math.max(0, rowIndex)];
  let y = row.y + row.height * 0.5;
  const window = Math.min(72, (row.end - row.start) * 0.22);
  const ease = (v: number) => (v < 0.5 ? 4 * v ** 3 : 1 - (-2 * v + 2) ** 3 / 2);
  if (window > 0 && rowIndex > 0 && x < row.start + window) {
    const previous = rows[rowIndex - 1];
    const blend = 0.5 * ease(1 - clampCloud((x - row.start) / window));
    x += (previous.end - x) * blend;
    y += (previous.y + previous.height * 0.5 - y) * blend;
  } else if (window > 0 && rowIndex < rows.length - 1 && x > row.end - window) {
    const next = rows[rowIndex + 1];
    const blend = 0.5 * ease(clampCloud((x - row.end + window) / window));
    x += (next.start - x) * blend;
    y += (next.y + next.height * 0.5 - y) * blend;
  }
  return { x, y };
}

export function cloudCameraTarget(
  layout: CloudLayout,
  time: number,
  view: CloudRect,
  focus: boolean,
  phase: CloudPhase,
  reduced = false
): CloudCamera {
  const fit = (rect: CloudRect): CloudCamera => ({
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2,
    scale: Math.min(view.width / (rect.width + 64), view.height / (rect.height + 64), 2),
    angle: 0
  });
  const panorama = (): CloudCamera => ({
    x: layout.bounds.x + layout.bounds.width / 2,
    y: layout.bounds.y + layout.bounds.height / 2,
    scale: Math.min(view.width / layout.bounds.width, view.height / layout.bounds.height),
    angle: 0
  });
  if (!focus || layout.untimed || phase.kind === 'outro' || phase.kind === 'static')
    return panorama();
  let active = activeCloudLines(layout, time);
  // Captions retain both singers; only camera framing prefers the primary agent.
  const primary = active.filter((line) => line.primary);
  if (primary.length) active = primary;
  if (!active.length) {
    const next = layout.lines
      .filter((l) => !l.background && l.begin > time)
      .sort((a, b) => a.begin - b.begin)[0];
    const previous = layout.lines
      .filter((l) => !l.background && l.begin <= time)
      .sort((a, b) => b.begin - a.begin)[0];
    active = previous ? [previous] : next ? [next] : [];
  }
  if (!active.length) return panorama();
  if (active.length > 1) {
    const x = Math.min(...active.map((l) => l.rect.x)),
      y = Math.min(...active.map((l) => l.rect.y));
    return fit({
      x,
      y,
      width: Math.max(...active.map((l) => l.rect.x + l.rect.width)) - x,
      height: Math.max(...active.map((l) => l.rect.y + l.rect.height)) - y
    });
  }
  const line = active[0];
  const meaningful = line.tokens.filter((t) => t.text.trim());
  if (!meaningful.length) return fit(line.rect);
  if (reduced) {
    const p = cloudPoint(line, line.localWidth / 2, line.localHeight / 2);
    return {
      ...p,
      scale: Math.min(
        view.width / (line.localWidth + 64),
        view.height / (line.localHeight + 64),
        2
      ),
      angle: -line.angle
    };
  }
  const reading = cloudReadingPoint(line, time);
  const point = cloudPoint(line, reading.x, reading.y);
  const lineHeight = Math.max(...meaningful.map((word) => word.size)) * 1.4;
  const targetHeight = clampCloud(Math.min(view.width, view.height) * 0.115, 64, 124);
  return {
    ...point,
    scale: clampCloud(targetHeight / lineHeight, 0.88, 2.2),
    angle: -line.angle
  };
}

export function stepCloudCamera(
  current: CloudCamera,
  velocity: CloudCamera,
  target: CloudCamera,
  dt: number,
  speed = 1
) {
  const next = { ...current },
    nextVelocity = { ...velocity };
  const omega = 20 * speed;
  const decay = Math.exp(-omega * Math.max(0, dt));
  let settled = true;
  for (const key of ['x', 'y', 'scale', 'angle'] as const) {
    const desired =
      key === 'angle'
        ? current.angle +
          Math.atan2(Math.sin(target.angle - current.angle), Math.cos(target.angle - current.angle))
        : target[key];
    const delta = current[key] - desired,
      impulse = velocity[key] + omega * delta;
    next[key] = desired + (delta + impulse * dt) * decay;
    nextVelocity[key] = (velocity[key] - omega * impulse * dt) * decay;
    if (
      Math.abs(next[key] - desired) > (key === 'x' || key === 'y' ? 0.3 : 0.001) ||
      Math.abs(nextVelocity[key]) > 0.1
    )
      settled = false;
  }
  return { camera: next, velocity: nextVelocity, settled };
}
