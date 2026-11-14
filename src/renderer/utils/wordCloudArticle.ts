import type { CloudLine, CloudRect } from './wordCloud';

function rank(text: string) {
  let value = 2166136261;
  for (let i = 0; i < text.length; i++) value = Math.imul(value ^ text.charCodeAt(i), 16777619);
  return value >>> 0;
}

/** Keep backing vocals attached even when their parent appears later in the input. */
export function cloudArticleGroups(lines: CloudLine[]): CloudLine[][] {
  const byId = new Map(lines.map((line) => [line.id, line]));
  const groups = new Map<number, CloudLine[]>();
  for (const line of lines) {
    let root = line;
    const seen = new Set([line.id]);
    while (root.background && root.parent !== undefined) {
      const parent = byId.get(root.parent);
      if (!parent || seen.has(parent.id)) break;
      root = parent;
      seen.add(root.id);
    }
    const group = groups.get(root.id) ?? [];
    group.push(line);
    groups.set(root.id, group);
  }
  return [...groups.entries()].map(([id, group]) =>
    group.sort((a, b) => Number(b.id === id) - Number(a.id === id) || a.id - b.id)
  );
}

function bounds(rects: CloudRect[]): CloudRect {
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  return {
    x,
    y,
    width: Math.max(...rects.map((r) => r.x + r.width)) - x,
    height: Math.max(...rects.map((r) => r.y + r.height)) - y
  };
}

/** Reflow measured tokens; font sizes, character offsets and provider times stay intact. */
function reflow(line: CloudLine, wrap: number, scale: number, angle: number): CloudLine {
  let x = 0,
    y = 0,
    rowHeight = 0,
    width = 0;
  const tokens = line.tokens.map((token) => {
    if (x > 0 && (x + token.width > wrap || token.text.includes('\n'))) {
      x = 0;
      y += rowHeight + 8 * scale;
      rowHeight = 0;
    }
    const result = { ...token, x, y };
    x += token.width;
    rowHeight = Math.max(rowHeight, token.size * 1.4);
    width = Math.max(width, x);
    return result;
  });
  let height = y + rowHeight;
  const visible = tokens.filter(
    (t) => t.text.trim() && t.ink && t.ink.width > 0 && t.ink.height > 0
  );
  if (visible.length) {
    const ink = bounds(
      visible.map((t) => ({
        x: t.x + t.ink!.x,
        y: t.y + t.ink!.y,
        width: t.ink!.width,
        height: t.ink!.height
      }))
    );
    width = ink.width;
    height = ink.height;
    for (const token of tokens) {
      token.x -= ink.x;
      token.y -= ink.y;
    }
  }
  return {
    ...line,
    tokens,
    angle,
    localWidth: width,
    localHeight: height,
    rect: { x: 0, y: 0, width: angle ? height : width, height: angle ? width : height }
  };
}

/**
 * Folia Fume's article composition: stable shuffled blocks, shortest-column placement
 * and contiguous column spans. Adapted to uniform fonts and optional rotated sentences.
 * Try a bounded set of column widths instead of changing lyric font sizes for density.
 */
export function* packCloudArticleSteps(
  lines: CloudLine[],
  seed: string,
  scale: number,
  gap: number
): Generator<void, CloudLine[]> {
  if (!lines.length) return lines;
  const groups = cloudArticleGroups(lines)
    .map((group) => ({ group, rank: rank(`${seed}:${group[0].id}:${group[0].text}`) }))
    .sort((a, b) => a.rank - b.rank || a.group[0].id - b.group[0].id);
  let best = lines;
  let bestScore = Infinity;
  const reflows = new Map<string, CloudLine>();
  // Canonical composition stays fixed across viewport changes. Only the final gap
  // projection fits the physical screen, so a rotation never reshuffles the song.
  for (const columnWidth of [224, 288, 352].map((width) => width * scale)) {
    for (let columns = Math.min(4, groups.length); columns >= 1; columns--) {
      const heights = Array<number>(columns).fill(0);
      const result: CloudLine[] = [];
      let cursor = 0;
      for (const { group, rank: order } of groups) {
        yield;
        const main = group[0];
        const naturalWidth = Math.max(...group.map((l) => l.localWidth));
        const wide = !main.angle && naturalWidth > columnWidth && order % 3 !== 0;
        const wrap = Math.min(
          560 * scale,
          columnWidth * (wide && columns > 1 ? 2 : 1) + (wide && columns > 1 ? gap : 0)
        );
        const members = group.map((line) => {
          const limit = main.angle ? 560 * scale : wrap;
          const key = `${line.id}:${limit}:${main.angle}`;
          let measured = reflows.get(key);
          if (!measured) {
            measured = reflow(line, limit, scale, main.angle);
            reflows.set(key, measured);
          }
          return { ...measured, rect: { ...measured.rect } };
        });
        let groupHeight = 0;
        for (const line of members) {
          line.rect.y = groupHeight;
          groupHeight += line.rect.height + gap;
        }
        groupHeight -= gap;
        const groupWidth = Math.max(...members.map((line) => line.rect.width));
        const span = Math.min(
          columns,
          Math.max(1, Math.ceil((groupWidth + gap) / (columnWidth + gap)))
        );
        let minHeight = Infinity;
        const starts: number[] = [];
        for (let column = 0; column <= columns - span; column++) {
          const top = Math.max(...heights.slice(column, column + span));
          if (top < minHeight - 1e-7) {
            minHeight = top;
            starts.length = 0;
          }
          if (Math.abs(top - minHeight) < 1e-7) starts.push(column);
        }
        const start = starts[cursor++ % starts.length];
        for (const line of members) {
          line.rect.x = start * (columnWidth + gap);
          line.rect.y += minHeight;
          result.push(line);
        }
        for (let column = start; column < start + span; column++)
          heights[column] = minHeight + groupHeight + gap;
      }
      const box = bounds(result.map((line) => line.rect));
      const area = result.reduce((sum, line) => sum + line.rect.width * line.rect.height, 0);
      // Balance whitespace against a compact article aspect without altering glyphs.
      const score =
        ((box.width * box.height) / Math.max(1, area)) *
        (1 + Math.abs(Math.log(box.width / Math.max(1, box.height) / (4 / 3))) * 0.65);
      if (score < bestScore) {
        bestScore = score;
        best = result;
      }
    }
  }
  return best.sort((a, b) => a.id - b.id);
}
