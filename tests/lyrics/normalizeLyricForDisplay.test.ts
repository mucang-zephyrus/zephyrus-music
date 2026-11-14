import { describe, expect, it } from 'vitest';

import type { ILyric, ILyricText } from '../../src/renderer/types/music';
import { normalizeLyricForDisplay } from '../../src/renderer/utils/normalizeLyricForDisplay';
import { subtitleLinesToLyric } from '../../src/renderer/utils/subtitleParser';
import { mergeAuxiliaryLyrics, parseTimedLyrics } from '../../src/renderer/utils/timedLyrics';

const line = (text: string, startTime: number, extra: Partial<ILyricText> = {}): ILyricText => ({
  text,
  trText: '',
  startTime,
  duration: 900,
  ...extra
});
const raw = (lines: ILyricText[], extra: Partial<ILyric> = {}): ILyric => ({
  rawSchemaVersion: 2,
  lrcArray: lines,
  lrcTimeArray: lines.map((l) => l.startTime! / 1000),
  ...extra
});
const normalize = (lines: ILyricText[], extra: Partial<ILyric> = {}) =>
  normalizeLyricForDisplay(raw(lines, extra));
// Synthetic text, with timing/run structures modeled on CHAOS and the Chunxiao album.
const groups = (direction = 'latin', count = 6, sourceCount = 1, translationCount = 1) =>
  Array.from({ length: count }, (_, group) => {
    const source = Array.from({ length: sourceCount }, (_, i) =>
      line(
        direction === 'latin' ? 'Listen to the morning' : '清晨的声音慢慢响起',
        group * 8000 + i * 1000
      )
    );
    const translation = Array.from({ length: translationCount }, (_, i) =>
      line(
        direction === 'latin' ? '清晨的声音慢慢响起' : 'Listen to the morning',
        group * 8000 + sourceCount * 1000 + i * 1000
      )
    );
    return [...source, ...translation];
  }).flat();

describe('immutable lyric display normalization', () => {
  it('does not split mismatched brackets, credits or labeled backing vocals', () => {
    for (const text of [
      'Hello (你好）',
      'Hello（你好)',
      'Vocals: Hello（你好）',
      '[bg] Hello（你好）'
    ]) {
      expect(normalize([line(text, 1000)]).mergeInfo.rules).toEqual([]);
    }
  });
  it('splits closed trailing brackets only and keeps metadata', () => {
    const result = normalize([
      line('Hello（你好）', 1000),
      line('Hello（你好）again', 2000),
      line('Hello (Live)', 3000)
    ]);
    expect(result.lyric.lrcArray.map((l) => l.text)).toEqual([
      'Hello',
      'Hello（你好）again',
      'Hello (Live)'
    ]);
    expect(result.mergeInfo.records).toEqual([
      { rule: 'inline', originalIndices: [0], outputIndex: 0 }
    ]);
  });
  it.each([0, 49, 50, 51])('honors the 50ms boundary (%dms)', (delta) => {
    const result = normalize([line('Hello there', 1000), line('你好世界', 1000 + delta)]);
    expect(result.lyric.lrcArray).toHaveLength(delta <= 50 ? 1 : 2);
  });
  it('handles reverse same-time ordering and seeks from the original', () => {
    const result = normalize([line('你好世界', 1000), line('Hello there', 1040)]);
    expect(result.lyric.lrcArray[0]).toMatchObject({
      text: 'Hello there',
      trText: '你好世界',
      startTime: 1040
    });
    expect(result.lyric.lrcTimeArray).toEqual([1.04]);
  });
  it('does not overwrite official translation or romanization', () => {
    const lyric = parseTimedLyrics('[00:01]Hello（你好）\n[00:01]你好');
    mergeAuxiliaryLyrics(lyric, '[00:01]官方译文', 'trText');
    expect(normalizeLyricForDisplay(lyric).mergeInfo.rules).toEqual([]);
    expect(normalize([line('Hello（你好）', 0, { romaText: 'ni hao' })]).mergeInfo.rules).toEqual(
      []
    );
  });
  it('trims timed words only at an exact token boundary', () => {
    const words = [
      { text: 'Hello', startTime: 1000, duration: 500 },
      { text: '（你好）', startTime: 1500, duration: 500 }
    ];
    const result = normalize([line('Hello（你好）', 1000, { words, hasWordByWord: true })]);
    expect(result.lyric.lrcArray[0].words).toEqual(words.slice(0, 1));
    expect(result.lyric.lrcArray[0].text).toBe('Hello');
    expect(
      normalize([
        line('Hello（你好）', 1000, {
          words: [{ text: 'Hello（你好）', startTime: 1000, duration: 1000 }]
        })
      ]).mergeInfo.rules
    ).toEqual([]);
  });
  it('skips words that cannot reliably map to the source text', () => {
    const source = line('Hello（你好）', 1000, {
      words: [{ text: 'Other', startTime: 1000, duration: 500 }]
    });
    expect(normalize([source]).lyric.lrcArray[0].text).toBe(source.text);
  });
  it('never mutates source lines, words or time arrays; repeated calculation is stable', () => {
    const source = raw([...groups(), line('Hello（你好）', 50000)]);
    const before = JSON.stringify(source);
    const first = normalizeLyricForDisplay(source);
    expect(JSON.stringify(source)).toBe(before);
    expect(normalizeLyricForDisplay(source)).toEqual(first);
    expect(normalizeLyricForDisplay(first.lyric).lyric).toEqual(first.lyric);
  });
  it('disabling all intelligent rules restores raw data and preserves official tracks', () => {
    const source = raw([line('Hello（你好）', 1000), line('Hello', 2000, { trText: '官方' })]);
    const result = normalizeLyricForDisplay(source, { enabled: false, sourceId: 'netease:42' });
    expect(result.lyric.lrcArray).toEqual(source.lrcArray);
    expect(result.mergeInfo.rules).toEqual([]);
    expect(result.mergeInfo.sourceId).toBe('netease:42');
  });
  it('does not reprocess a legacy snapshot', () => {
    expect(
      normalize([line('Hello（你好）', 1000)], { legacyProcessed: true }).mergeInfo.rules
    ).toEqual([]);
  });
  it('keeps subtitle times in milliseconds and timeline seconds', () => {
    const source = subtitleLinesToLyric([{ from: 1.5, to: 3, content: 'Hello（你好）' }]);
    const result = normalizeLyricForDisplay(source);
    expect(result.lyric.lrcArray[0].startTime).toBe(1500);
    expect(result.lyric.lrcArray[0].duration).toBe(1500);
    expect(result.lyric.lrcTimeArray).toEqual([1.5]);
  });
});

describe('whole-lyric structural gate', () => {
  it('keeps reversed simultaneous pairs on the Latin-original same-time rule', () => {
    const rows = groups('cjk').map((row, index) => ({
      ...row,
      startTime: Math.floor(index / 2) * 8000
    }));
    const result = normalize(rows);
    expect(result.mergeInfo.rules).toEqual(['same-time']);
    expect(result.lyric.lrcArray.every((row) => row.text === 'Listen to the morning')).toBe(true);
  });
  it('accepts exactly 12 seconds, but does not exceed the group span', () => {
    const make = (last: number) =>
      groups('latin', 6, 3, 3).map((row, i) => ({
        ...row,
        startTime: Math.floor(i / 6) * 16000 + [0, 2000, 4000, 8000, 10000, last][i % 6]
      }));
    expect(normalize(make(12000)).mergeInfo.rules).toEqual(['structure']);
    expect(normalize(make(12001)).mergeInfo.rules).toEqual([]);
  });
  it('enforces 85% coverage independently for both languages', () => {
    const suffix = groups('latin', 1, 3, 3).map((row, i) => ({
      ...row,
      startTime: 140000 + [0, 1000, 2000, 10000, 11000, 12001][i]
    }));
    expect(normalize([...groups('latin', 17), ...suffix]).mergeInfo.rules).toEqual(['structure']);
    expect(normalize([...groups('latin', 16), ...suffix]).mergeInfo.rules).toEqual([]);
  });
  it.each(['latin', 'cjk'])('recognizes at least six anchored %s groups', (direction) => {
    const result = normalize(groups(direction));
    expect(result.mergeInfo.rules).toEqual(['structure']);
    expect(result.lyric.lrcArray).toHaveLength(6);
    expect(result.lyric.lrcTimeArray).toEqual([0, 8, 16, 24, 32, 40]);
  });
  it('groups multiple originals before consuming CHAOS-style simultaneous translations', () => {
    const rows = groups('latin', 8, 3);
    rows.forEach((row, i) => {
      if (i % 4 === 3) row.startTime = rows[i - 1].startTime;
    });
    const result = normalize(rows);
    expect(result.mergeInfo.rules).toEqual(['structure']);
    expect(result.lyric.lrcArray).toHaveLength(8);
    expect(result.mergeInfo.records[0].originalIndices).toEqual([0, 1, 2, 3]);
    expect(result.lyric.lrcArray[0].text.split('Listen')).toHaveLength(4);
    expect(result.lyric.lrcArray[0].words).toBeUndefined();
  });
  it('supports 1–3 originals followed by 1–3 translations', () => {
    const result = normalize(groups('cjk', 6, 2, 3));
    expect(result.mergeInfo.records).toHaveLength(6);
    expect(result.lyric.lrcArray[0].trText).toBe(Array(3).fill('Listen to the morning').join(' '));
    expect(result.lyric.lrcArray[0].duration).toBe(4900);
  });
  it('retains source word times and never manufactures translation timings', () => {
    const rows = groups('latin', 6, 2);
    rows.forEach((row, i) => {
      if (i % 3 !== 2) {
        row.words = [{ text: row.text, startTime: row.startTime!, duration: 800 }];
        row.hasWordByWord = true;
      }
    });
    const result = normalize(rows);
    expect(result.lyric.lrcArray[0].words).toEqual([
      { ...rows[0].words![0], space: true },
      rows[1].words![0]
    ]);
    expect(result.lyric.lrcTimeArray[0]).toBe(rows[0].startTime! / 1000);
  });
  it('rejects independent bilingual word timing', () => {
    const rows = groups();
    rows.forEach((row) => {
      row.words = [{ text: row.text, startTime: row.startTime!, duration: 500 }];
    });
    expect(normalize(rows).mergeInfo.rules).toEqual([]);
  });
  it('keeps unpaired tails', () => {
    const rows = [...groups('latin', 8), line('The final unpaired sentence', 65000)];
    const result = normalize(rows);
    expect(result.lyric.lrcArray).toHaveLength(9);
    expect(result.lyric.lrcArray.at(-1)?.trText).toBe('');
  });
  it('requires six groups and 85% coverage in each language', () => {
    expect(normalize(groups('latin', 5)).mergeInfo.rules).toEqual([]);
    expect(
      normalize([
        ...groups(),
        ...Array.from({ length: 4 }, (_, i) => line('Unpaired ending sentence', 50000 + i * 1000))
      ]).mergeInfo.rules
    ).toEqual([]);
  });
  it('does not shift a first row to manufacture a better direction', () => {
    const rows = [
      line('开始的独立中文', 0),
      ...groups('latin', 6).map((r) => ({ ...r, startTime: r.startTime! + 2000 }))
    ];
    const result = normalize(rows);
    expect(result.lyric.lrcArray[0].text.startsWith('开始')).toBe(true);
    expect(result.lyric.lrcArray[0].text).toBe('开始的独立中文');
    // The anchored direction is Chinese → English, never shifted to English → Chinese.
    expect(result.lyric.lrcArray[0].trText).toBe('Listen to the morning');
    expect(result.mergeInfo.records[0].originalIndices).toEqual([0, 1]);
  });
  it('does not cross blanks, mixed scripts, credits, background or >12s gaps', () => {
    for (const boundary of [
      line('', 500),
      line('Hello 世界混合', 500),
      line('Lyrics: Example', 500),
      line('和声：示例', 500),
      line('Hello', 500, { isBG: true }),
      line('Hello', 500, { isDuet: true }),
      line('Hello', 500, { trText: '官方' })
    ]) {
      const rows = groups().flatMap((row, i) =>
        i % 2 === 0 ? [row, { ...boundary, startTime: row.startTime! + 500 }] : [row]
      );
      expect(normalize(rows).mergeInfo.rules).toEqual([]);
    }
    const rows = groups().map((row, i) => ({
      ...row,
      startTime: Math.floor(i / 2) * 30000 + (i % 2) * 13000
    }));
    expect(normalize(rows).mergeInfo.rules).toEqual([]);
  });
  it('rejects long groups, four-line runs and ambiguous directions', () => {
    expect(normalize(groups('latin', 6, 4)).mergeInfo.rules).toEqual([]);
    const rows = groups('latin', 6, 3, 3).map((row, i) => ({
      ...row,
      startTime: Math.floor(i / 6) * 30000 + (i % 6) * 3000
    }));
    expect(normalize(rows).mergeInfo.rules).toEqual([]);
    const mixed = [
      ...groups(),
      line('', 47000),
      ...groups('cjk').map((l) => ({ ...l, startTime: l.startTime! + 50000 }))
    ];
    expect(normalize(mixed).mergeInfo.rules).toEqual([]);
  });
  it('never infers TTML or structured harmony/duet text', () => {
    expect(normalize(groups(), { format: 'ttml' }).mergeInfo.rules).toEqual([]);
    expect(normalize(groups().map((l) => ({ ...l, isBG: true }))).mergeInfo.rules).toEqual([]);
    expect(normalize(groups().map((l) => ({ ...l, isDuet: true }))).mergeInfo.rules).toEqual([]);
  });
  it('rejects reversed/overlapping word timing and keeps ordinary LRC unworded', () => {
    const rows = groups('latin', 6, 2);
    rows.forEach((row, i) => {
      if (i % 3 !== 2) row.words = [{ text: row.text, startTime: row.startTime!, duration: 3000 }];
    });
    expect(normalize(rows).mergeInfo.rules).toEqual([]);
    expect(normalize(groups()).lyric.hasWordByWord).toBe(false);
  });
});
