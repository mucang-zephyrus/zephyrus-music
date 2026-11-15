import { describe, expect, it } from 'vitest';

import type { TtmlLine, TtmlLyric } from '@/services/ttmlParser';
import {
  buildLyricHoverTimeline,
  hoverWordProgress,
  resolveLyricHoverPreview
} from '@/utils/lyricHoverPreview';

const line = (
  begin: number,
  end: number,
  text: string,
  extra: Partial<TtmlLine> = {}
): TtmlLine => ({
  begin,
  end,
  text,
  words: [{ begin, end, text }],
  isBackground: false,
  translations: [],
  romanizations: [],
  background: [],
  ...extra
});
const lyric = (lines: TtmlLine[]): TtmlLyric => ({
  lines,
  duration: 60,
  timingMode: 'word',
  primaryAgent: 'v1',
  agents: [{ id: 'v1' }, { id: 'v2' }],
  parts: [],
  meta: {}
});
const timeline = (lines: TtmlLine[]) => buildLyricHoverTimeline(lyric(lines), [], []);

describe('progress hover lyrics', () => {
  it('retains word timing and spacing for each TTML voice', () => {
    const rows = timeline([
      line(1, 5, 'Hello world', {
        words: [
          { text: 'Hello ', begin: 1, end: 3 },
          { text: 'world', begin: 3, end: 5 }
        ],
        background: [
          {
            text: 'Echo',
            begin: 2,
            end: 4,
            words: [{ text: 'Echo', begin: 2, end: 4 }],
            translations: [],
            romanizations: []
          }
        ]
      }),
      line(2, 6, 'Duet', { agent: 'v2' })
    ]);
    const preview = resolveLyricHoverPreview(rows, 2, 60);
    expect(preview.lines[0].words.map((word) => word.text).join('')).toBe('Hello world');
    expect(preview.lines.map((row) => hoverWordProgress(row.words[0], 2))).toEqual([0.5, 0, 0]);
  });

  it('calculates word fill for arbitrary hover positions in either direction', () => {
    const word = { text: 'Hello', begin: 1, end: 3 };
    expect([0, 1, 2, 3, 5, 1.5].map((time) => hoverWordProgress(word, time))).toEqual([
      0, 0, 0.5, 1, 1, 0.25
    ]);
    expect(hoverWordProgress({ ...word, end: 1 }, 1)).toBe(1);
  });

  it('only supplies word progress for word-timed sources', () => {
    expect(
      buildLyricHoverTimeline({ ...lyric([line(0, 3, 'Line')]), timingMode: 'line' }, [], [])[0]
        .words
    ).toEqual([]);
    expect(buildLyricHoverTimeline(null, [{ text: 'Line', trText: '' }], [0])[0].words).toEqual([]);
    expect(
      buildLyricHoverTimeline(
        null,
        [
          {
            text: 'Hello world',
            trText: '',
            hasWordByWord: true,
            words: [{ text: 'Hello', startTime: 1000, duration: 2000, space: true }]
          }
        ],
        [1]
      )[0].words
    ).toEqual([{ text: 'Hello ', begin: 1, end: 3 }]);
  });

  it('falls back to provider lyrics when TTML contains no lines', () => {
    const rows = buildLyricHoverTimeline(lyric([]), [{ text: 'Provider', trText: '' }], [0]);
    expect(resolveLyricHoverPreview(rows, 1, 60).lines[0].text).toBe('Provider');
  });

  it('shows simultaneous duet voices and each voice auxiliary text', () => {
    const rows = timeline([
      line(5, 10, '主唱', { agent: 'v1' }),
      line(7, 12, '对唱', {
        agent: 'v2',
        isBackground: true,
        translations: [{ text: 'Duet', role: 'translation', lang: 'en' }],
        romanizations: [{ text: 'dui chang', role: 'roman' }]
      })
    ]);
    const preview = resolveLyricHoverPreview(rows, 8, 60);
    expect(preview.lines.map((row) => [row.text, row.duet, row.background])).toEqual([
      ['主唱', false, false],
      ['对唱', true, false]
    ]);
    expect(preview.lines[1].translations[0].text).toBe('Duet');
    expect(preview.lines[1].romanizations[0].text).toBe('dui chang');
  });

  it('keeps a longer background voice active after its main line ends', () => {
    const rows = timeline([
      line(1, 3, 'Main', {
        agent: 'v2',
        background: [
          {
            begin: 2,
            end: 9,
            text: 'Echo',
            words: [],
            translations: [{ text: '回声', role: 'translation' }],
            romanizations: [{ text: 'hui sheng', role: 'roman' }]
          }
        ]
      }),
      line(15, 17, 'Next')
    ]);
    expect(resolveLyricHoverPreview(rows, 5, 60).lines[0]).toMatchObject({
      text: 'Echo',
      background: true,
      duet: true
    });
    expect(resolveLyricHoverPreview(rows, 10, 60).interlude).toBe(false);
  });

  it('uses the AMLL seven second gap threshold, including the intro', () => {
    const rows = timeline([line(7, 9, 'First'), line(16, 19, 'Next')]);
    for (const time of [0, 6.999, 9, 15.999]) {
      expect(resolveLyricHoverPreview(rows, time, 60).interlude).toBe(true);
    }
    for (const time of [7, 16]) {
      expect(resolveLyricHoverPreview(rows, time, 60).interlude).toBe(false);
    }
    expect(
      resolveLyricHoverPreview(timeline([line(0, 2, 'A'), line(8.999, 10, 'B')]), 3, 60).interlude
    ).toBe(false);
  });

  it('accounts for overlapping voices when measuring the instrumental gap', () => {
    const rows = timeline([line(1, 12, 'Long'), line(3, 4, 'Short'), line(18, 20, 'Next')]);
    expect(resolveLyricHoverPreview(rows, 10, 60).lines[0].text).toBe('Long');
    expect(resolveLyricHoverPreview(rows, 13, 60).interlude).toBe(false);
  });

  it('includes the last word end when the line end is shorter', () => {
    const rows = timeline([
      line(0, 2, 'Sustain', { words: [{ begin: 0, end: 6, text: 'Sustain' }] }),
      line(12, 14, 'Next')
    ]);
    expect(resolveLyricHoverPreview(rows, 5, 60).lines[0].text).toBe('Sustain');
    expect(resolveLyricHoverPreview(rows, 7, 60).interlude).toBe(false);
  });

  it('shows dots in a timed outro and clears at the song boundary', () => {
    const rows = timeline([line(0, 2, 'Last')]);
    expect(resolveLyricHoverPreview(rows, 3, 10).interlude).toBe(true);
    expect(resolveLyricHoverPreview(rows, 10, 10).interlude).toBe(false);
    expect(resolveLyricHoverPreview(rows, 3, 8).interlude).toBe(false);
  });

  it('preserves all translations and romanizations', () => {
    const row = line(0, 4, 'Hello', {
      translations: [
        { text: '你好', role: 'translation' },
        { text: 'こんにちは', role: 'translation' }
      ],
      romanizations: [
        { text: 'hello', role: 'roman' },
        { text: 'he-lo', role: 'roman' }
      ]
    });
    const original = structuredClone(row);
    expect(resolveLyricHoverPreview(timeline([row]), 1, 60).lines[0].translations).toHaveLength(2);
    expect(row).toEqual(original);
  });

  it('uses word ends for provider lyrics and supplies translation and pronunciation', () => {
    const rows = buildLyricHoverTimeline(
      null,
      [
        {
          text: 'First',
          trText: '第一',
          romaText: 'first',
          hasWordByWord: true,
          words: [{ text: 'First', startTime: 1000, duration: 2000 }]
        },
        { text: 'Next', trText: '', startTime: 12000 }
      ],
      [1, 12]
    );
    expect(resolveLyricHoverPreview(rows, 2, 60).lines[0]).toMatchObject({ text: 'First', end: 3 });
    expect(rows[0].translations[0].text).toBe('第一');
    expect(rows[0].romanizations[0].text).toBe('first');
    expect(resolveLyricHoverPreview(rows, 4, 60).interlude).toBe(true);
  });

  it('uses only timestamp boundaries for plain LRC, regardless of filled duration', () => {
    const rows = buildLyricHoverTimeline(
      null,
      [
        { text: 'First', trText: '', duration: 1000 },
        { text: 'Next', trText: '' }
      ],
      [5, 20]
    );
    expect(resolveLyricHoverPreview(rows, 0, 60)).toEqual({ lines: [], interlude: false });
    expect(resolveLyricHoverPreview(rows, 15, 60).lines[0].text).toBe('First');
    expect(resolveLyricHoverPreview(rows, 19, 60).interlude).toBe(false);
    expect(resolveLyricHoverPreview(rows, 20, 60).lines[0].text).toBe('Next');
  });

  it('respects empty LRC timestamps and hidden credit rows', () => {
    const rows = buildLyricHoverTimeline(
      null,
      [
        { text: 'First', trText: '' },
        { text: '', trText: '' },
        { text: 'Credit', trText: '', creditHidden: true },
        { text: 'Next', trText: '' }
      ],
      [0, 2, 5, 12]
    );
    expect(resolveLyricHoverPreview(rows, 6, 60)).toEqual({ lines: [], interlude: true });
    expect(timeline([line(0, 3, 'Credit', { creditHidden: true })])).toEqual([]);
  });

  it('supports seeking in either direction and replacing the song timeline', () => {
    const rows = timeline([line(0, 2, 'First'), line(12, 16, 'Next')]);
    for (const time of [5, 14, 1, 8]) {
      const preview = resolveLyricHoverPreview(rows, time, 60);
      expect(preview.interlude).toBe(time === 5 || time === 8);
    }
    expect(resolveLyricHoverPreview([], 5, 60)).toEqual({ lines: [], interlude: false });
    expect(resolveLyricHoverPreview(rows, NaN, 60)).toEqual({ lines: [], interlude: false });
  });
});
