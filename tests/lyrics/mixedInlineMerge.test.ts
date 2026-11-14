import { describe, expect, it } from 'vitest';

import type { ILyric, ILyricText } from '../../src/renderer/types/music';
import { normalizeLyricForDisplay } from '../../src/renderer/utils/normalizeLyricForDisplay';

const main = '清晨过后我们继续走向远方';
const translated = 'After the morning we keep walking to the distance';
const roman = 'qing chen guo hou wo men ji xu zou xiang yuan fang';
const line = (text: string, startTime = 0, extra: Partial<ILyricText> = {}): ILyricText => ({
  text,
  startTime,
  trText: '',
  duration: 900,
  ...extra
});
const inline = (count = 6, extra: Partial<ILyricText> = {}) =>
  Array.from({ length: count }, (_, i) => line(main + translated, i * 8000, extra));
const project = (lines: ILyricText[], extra: Partial<ILyric> = {}) =>
  normalizeLyricForDisplay({
    rawSchemaVersion: 2,
    lrcArray: lines,
    lrcTimeArray: lines.map((l) => l.startTime! / 1000),
    ...extra
  });

describe('conservative unbracketed inline translation', () => {
  it('requires six repeated candidates, retaining short fragments', () => {
    expect(project(inline(5)).mergeInfo.records).toEqual([]);
    const result = project(inline());
    expect(result.mergeInfo.records).toHaveLength(6);
    expect(result.lyric.lrcArray[0]).toMatchObject({ text: main, trText: translated });
  });
  it('keeps isolated Latin letters inside the original and splits only the complete suffix', () => {
    const original = '清晨过后我们讨论X然后继续走向远方';
    const result = project(inline(6).map((l) => ({ ...l, text: original + translated })));
    expect(result.lyric.lrcArray.every((l) => l.text === original && l.trText === translated)).toBe(
      true
    );
  });
  it.each([
    '我喜欢Coldplay',
    '我们走向 New York',
    '清晨过后我们继续 California',
    'hello你好世界 goodbye'
  ])('preserves names, loanwords and mixed singing: %s', (text) => {
    expect(project(inline().map((l) => ({ ...l, text }))).mergeInfo.records).toEqual([]);
  });
  it('rejects sparse candidates and unclassified text instead of ignoring the denominator', () => {
    expect(
      project([
        ...inline(),
        ...Array.from({ length: 3 }, (_, i) => line('unpaired English sentence', 50000 + i * 1000))
      ]).mergeInfo.records
    ).toEqual([]);
    expect(
      project([
        ...inline(),
        ...Array.from({ length: 3 }, (_, i) => line('abc中文混合???', 50000 + i * 1000))
      ]).mergeInfo.records
    ).toEqual([]);
  });
  it('protects official translations, TTML, backgrounds, duets and legacy data', () => {
    for (const extra of [{ trText: '官方译文' }, { isBG: true }, { isDuet: true }])
      expect(project(inline(6, extra)).mergeInfo.records).toEqual([]);
    expect(project(inline(), { format: 'ttml' }).mergeInfo.records).toEqual([]);
    expect(project(inline(), { legacyProcessed: true }).mergeInfo.records).toEqual([]);
    expect(
      project(inline().map((l) => ({ ...l, text: '[bg] ' + l.text }))).mergeInfo.records
    ).toEqual([]);
  });
  it('retains aligned source romanization, and skips auxiliary text whose mapping is unknown', () => {
    const result = project(inline(6, { romaText: `${roman} ${translated}` }));
    expect(result.lyric.lrcArray.every((l) => l.romaText === roman)).toBe(true);
    expect(
      project(inline(6, { romaText: 'unrelated official romanization' })).mergeInfo.records
    ).toEqual([]);
  });
  it('keeps independent word timing on both languages as bilingual singing', () => {
    const input = inline().map((l) => ({
      ...l,
      words: [
        { text: main, startTime: l.startTime!, duration: 300 },
        { text: translated, startTime: l.startTime! + 300, duration: 600 }
      ]
    }));
    expect(project(input).mergeInfo.records).toEqual([]);
  });
  it('preserves source word times only at an exact boundary with untimed auxiliary suffix', () => {
    const input = inline().map((l) => ({
      ...l,
      words: [
        { text: main, startTime: l.startTime!, duration: 800 },
        { text: translated, startTime: l.startTime! + 800, duration: 0 }
      ]
    }));
    const result = project(input);
    expect(result.mergeInfo.records).toHaveLength(6);
    expect(result.lyric.lrcArray.map((l) => l.words)).toEqual(
      input.map((l) => l.words.slice(0, 1))
    );
    expect(
      project(
        inline().map((l) => ({
          ...l,
          words: [{ text: l.text, startTime: l.startTime!, duration: 800 }]
        }))
      ).mergeInfo.records
    ).toEqual([]);
  });
});

describe('auxiliary-preserving cross-line grouping', () => {
  const pairs = (count = 6) =>
    Array.from({ length: count }, (_, i) => [
      line(main, i * 8000, { romaText: roman }),
      line(translated, i * 8000 + 1000, { romaText: translated })
    ]).flat();
  it('retains original romanization and ignores exact provider echoes on translation rows', () => {
    const result = project(pairs());
    expect(result.mergeInfo.records).toHaveLength(6);
    expect(result.lyric.lrcArray.every((l) => l.romaText === roman)).toBe(true);
  });
  it('joins multiple originals and their romanizations without changing word times', () => {
    const input = Array.from({ length: 6 }, (_, i) => [
      line(main, i * 8000, { romaText: roman }),
      line(main, i * 8000 + 1000, { romaText: roman }),
      line(translated, i * 8000 + 2000)
    ]).flat();
    const result = project(input);
    expect(result.mergeInfo.records).toHaveLength(6);
    expect(result.lyric.lrcArray[0].romaText).toBe(`${roman} ${roman}`);
  });
  it('preserves non-echo auxiliary text on translation rows instead of deleting it', () => {
    const input = pairs().map((l, i) =>
      i % 2 ? { ...l, romaText: 'distinct official auxiliary' } : l
    );
    expect(project(input).mergeInfo.records).toEqual([]);
    expect(
      project([line(translated, 0), line(main, 0, { romaText: roman })]).mergeInfo.records
    ).toEqual([]);
  });
});

describe('untimed text has separate evidence and never receives manufactured timing', () => {
  it('does not treat adjacent missing timestamps as simultaneous lines', () => {
    expect(project([line(main, -1), line(translated, -1)]).mergeInfo.records).toEqual([]);
  });
  it('uses repeated inline evidence to establish untimed direction for a few adjacent pairs', () => {
    const input = [
      ...inline(6, { startTime: -1, duration: 0 }),
      line(main, -1, { duration: 0 }),
      line(translated, -1, { duration: 0 }),
      line(`${main}，ε=(´ο｀*)))唉`, -1, { duration: 0 }),
      line(translated, -1, { duration: 0 })
    ];
    const result = project(input);
    expect(result.mergeInfo.records.map((r) => r.originalIndices)).toEqual([
      [0],
      [1],
      [2],
      [3],
      [4],
      [5],
      [6, 7],
      [8, 9]
    ]);
    expect(result.lyric.lrcTimeArray).toEqual(Array(8).fill(-0.001));
    expect(
      result.lyric.lrcArray.every((l) => l.startTime === -1 && l.duration === 0 && !l.words)
    ).toBe(true);
    expect(result.lyric.lrcArray.at(-1)?.text).toContain('ε=(´ο｀*)))唉');
  });
  it('never crosses blank or labeled background boundaries to find a translation', () => {
    const input = [
      ...inline(12, { startTime: -1, duration: 0 }),
      line(main, -1),
      line('', -1),
      line(translated, -1),
      line(main, -1),
      line('和声：示例', -1),
      line(translated, -1)
    ];
    expect(project(input).mergeInfo.records.every((r) => r.originalIndices.length === 1)).toBe(
      true
    );
  });
  it('does not allow untimed evidence to relax timed group count or span', () => {
    const input = [
      ...inline(10, { startTime: -1, duration: 0 }),
      line(main, 20000),
      line(translated, 22000)
    ];
    expect(project(input).mergeInfo.records.every((r) => r.originalIndices.length === 1)).toBe(
      true
    );
  });
});
