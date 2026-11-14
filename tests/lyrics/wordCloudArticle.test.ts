import { describe, expect, it } from 'vitest';

import {
  buildCloudLayout,
  buildCloudLayoutSteps,
  cloudOverlap,
  fitCloudLayoutToViewport,
  runCloudLayout
} from '@/utils/wordCloud';
import { cloudArticleGroups } from '@/utils/wordCloudArticle';

const options = { scale: 1, spacing: 1, vertical: 0 };
const measure = (text: string, size: number) => Array.from(text).length * size * 0.6;
const source = Array.from({ length: 48 }, (_, i) => ({
  text: [
    'short line',
    'A longer sentence walking across the article columns',
    '春风 吹过 明天的 世界'
  ][i % 3],
  begin: i * 4,
  translation: `translation ${i}`
}));
const build = () => buildCloudLayout(source, 'article', options, measure);

describe('Fume inspired article layout', () => {
  it('shuffles spatial placement while retaining chronological identities and auxiliary text', () => {
    const layout = build();
    expect(layout.lines.map((l) => l.id)).toEqual(source.map((_, i) => i));
    expect(layout.lines.map((l) => [l.begin, l.text, l.translation])).toEqual(
      source.map((l) => [l.begin, l.text, l.translation])
    );
    expect(
      [...layout.lines].sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x).map((l) => l.id)
    ).not.toEqual(layout.lines.map((l) => l.id));
    expect(build()).toEqual(layout);
    expect(new Set(layout.lines.flatMap((l) => l.tokens.map((t) => t.size)))).toEqual(
      new Set([32])
    );
  });

  it('balances identical short blocks over columns with no tall isolated tail', () => {
    const layout = buildCloudLayout(
      source.map((l) => ({ ...l, text: 'short phrase' })),
      'balance',
      options,
      measure
    );
    const bottoms = new Map<number, number>();
    for (const line of layout.lines)
      bottoms.set(
        line.rect.x,
        Math.max(bottoms.get(line.rect.x) ?? 0, line.rect.y + line.rect.height)
      );
    expect(bottoms.size).toBeGreaterThan(1);
    expect(Math.max(...bottoms.values()) - Math.min(...bottoms.values())).toBeLessThanOrEqual(61);
  });

  it('reserves contiguous columns for wide blocks without resizing their glyphs', () => {
    const layout = build();
    expect(new Set(layout.lines.map((l) => l.rect.x)).size).toBeGreaterThan(1);
    expect(Math.max(...layout.lines.map((l) => l.localWidth))).toBeGreaterThan(352);
    for (let i = 0; i < layout.lines.length; i++) {
      expect(layout.lines[i].tokens.map((t) => t.text).join('')).toBe(source[i].text);
      for (let j = i + 1; j < layout.lines.length; j++)
        expect(cloudOverlap(layout.lines[i].rect, layout.lines[j].rect, 15.99)).toBe(false);
    }
  });

  it('attaches backing groups even if inputs precede their parent, including screen projection', () => {
    const layout = buildCloudLayout(
      [
        { text: 'backing', begin: 1, background: true, parent: 1 },
        { text: 'main vocal sentence', begin: 0 },
        ...source
      ],
      'group',
      { ...options, vertical: 0.6 },
      measure
    );
    expect(cloudArticleGroups(layout.lines)[0].map((l) => l.id)).toEqual([1, 0]);
    for (const [width, height] of [
      [390, 844],
      [1440, 1000]
    ]) {
      const result = fitCloudLayoutToViewport(layout, width, height);
      const [backing, parent] = result.lines;
      expect(backing.angle).toBe(parent.angle);
      expect(backing.rect.y - parent.rect.y - parent.rect.height).toBeCloseTo(16);
      expect(backing.rect.x).toBeCloseTo(parent.rect.x);
      expect(result.bounds.width / result.bounds.height).toBeCloseTo(width / height, 7);
      for (let i = 0; i < result.lines.length; i++)
        for (let j = i + 1; j < result.lines.length; j++)
          expect(cloudOverlap(result.lines[i].rect, result.lines[j].rect, 15.99)).toBe(false);
    }
  });

  it('produces the same result in slices and closes cancelled layout generators', async () => {
    expect(
      await runCloudLayout(buildCloudLayoutSteps(source, 'article', options, measure))
    ).toEqual(build());
    const controller = new AbortController();
    let closed = false;
    function* steps(): ReturnType<typeof buildCloudLayoutSteps> {
      try {
        yield;
        controller.abort();
        yield;
        return build();
      } finally {
        closed = true;
      }
    }
    expect(await runCloudLayout(steps(), controller.signal)).toBeNull();
    expect(closed).toBe(true);
  });
});
