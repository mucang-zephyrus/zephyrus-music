import { describe, expect, it } from 'vitest';

import type { ILyric } from '../../src/renderer/types/music';
import { normalizeLyricForDisplay } from '../../src/renderer/utils/normalizeLyricForDisplay';
import { mergeAuxiliaryLyrics, parseTimedLyrics } from '../../src/renderer/utils/timedLyrics';
import fixtures from './fixtures/chunxiaoStructure.json';

interface AlbumStructure {
  id: number;
  times: number[];
  credits: Partial<Record<string, string>>;
  groups: number[][];
  inline: number[];
  roman: Partial<Record<string, string>>;
  embeddedLatin: number[];
  emoticon: number[];
}
const structures: AlbumStructure[] = fixtures;
const mainText = '清晨过后我们继续走向远方';
const translatedText = 'After the morning we keep walking to the distance';
const romanText = 'qing chen guo hou wo men ji xu zou xiang yuan fang';
const stamp = (ms: number) =>
  `[${Math.floor(ms / 60000)}:${((ms % 60000) / 1000).toFixed(3).padStart(6, '0')}]`;

/** Real API timing/role layouts, entirely synthetic lyric and artist text. */
function providerInput(fixture: AlbumStructure): ILyric {
  const originals = new Set(fixture.groups.map((g) => g[0]));
  const translations = new Set(fixture.groups.flatMap((g) => g.slice(1)));
  const texts = fixture.times.map((_, i) => {
    const main = fixture.embeddedLatin.includes(i)
      ? '清晨过后我们谈论X然后继续走向远方'
      : fixture.emoticon.includes(i)
        ? `${mainText}，ε=(´ο｀*)))唉`
        : mainText;
    if (fixture.inline.includes(i)) return `${main}${translatedText}`;
    if (originals.has(i)) return main;
    if (translations.has(i)) return translatedText;
    return fixture.credits[i] || '';
  });
  const payload = texts
    .map((text, i) => `${fixture.times[i] < 0 ? '' : stamp(fixture.times[i])}${text}`)
    .join('\n');
  const raw = parseTimedLyrics(payload, { format: 'lrc', source: 'netease' });
  // These album samples have no empty untimed rows; timed blanks must survive parsing.
  expect(raw.lrcArray).toHaveLength(fixture.times.length);
  if (Object.keys(fixture.roman).length) {
    const roman = texts
      .map((text, i) => {
        const kind = fixture.roman[i];
        const auxiliary =
          kind === 'echo'
            ? text
            : kind === 'suffix'
              ? `${romanText} ${translatedText}`
              : kind === 'source'
                ? romanText
                : '';
        return `${stamp(fixture.times[i])}${auxiliary}`;
      })
      .join('\n');
    mergeAuxiliaryLyrics(raw, roman, 'romaText', 'lrc');
  }
  raw.sourceId = `netease:${fixture.id}`;
  return raw;
}

describe('complete Chunxiao album source layouts', () => {
  it.each(structures)('preserves exact roles, auxiliary text and indices for $id', (fixture) => {
    const raw = providerInput(fixture);
    const before = JSON.stringify(raw);
    const result = normalizeLyricForDisplay(raw);
    const wanted = [...fixture.groups, ...fixture.inline.map((i) => [i])].sort(
      (a, b) => a[0] - b[0]
    );
    expect(result.mergeInfo.records.map((r) => r.originalIndices)).toEqual(wanted);
    for (const record of result.mergeInfo.records) {
      const output = result.lyric.lrcArray[record.outputIndex];
      const indices = record.originalIndices;
      const original = raw.lrcArray[indices[0]];
      if (indices.length === 1) {
        expect(output.text + output.trText).toBe(original.text);
      } else {
        expect(output.text).toBe(original.text);
        expect(output.trText).toBe(
          indices
            .slice(1)
            .map((i) => raw.lrcArray[i].text)
            .join(' ')
        );
      }
      expect(output.startTime).toBe(original.startTime);
      expect(output.words).toBeUndefined();
      if (fixture.roman[indices[0]]) expect(output.romaText).toBe(romanText);
      if (original.startTime === -1) expect(output.duration).toBe(0);
    }
    for (const [index, text] of Object.entries(fixture.credits)) {
      const unchanged = result.lyric.lrcArray.find(
        (l) => l.startTime === fixture.times[Number(index)] && l.text === text
      );
      expect(unchanged).toBeDefined();
    }
    expect(result.lyric.lrcTimeArray).toEqual(
      result.lyric.lrcArray.map((l) => l.startTime! / 1000)
    );
    expect(JSON.stringify(raw)).toBe(before);
    expect(normalizeLyricForDisplay(raw)).toEqual(result);
    expect(normalizeLyricForDisplay(result.lyric).lyric).toEqual(result.lyric);
    expect(normalizeLyricForDisplay(raw, { enabled: false }).lyric.lrcArray).toEqual(raw.lrcArray);
  });
});
