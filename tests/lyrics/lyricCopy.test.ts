import type { LyricLine } from '@applemusic-like-lyrics/core';
import { DOMParser as XmlDomParser } from '@xmldom/xmldom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { parseTtml } from '@/services/ttmlParser';
import { providerLyricsToAmll, ttmlLyricsToAmll } from '@/utils/amllLyricAdapter';
import { formatLyricsForCopy } from '@/utils/lyricCopy';

function sampleLines(): LyricLine[] {
  return ttmlLyricsToAmll(
    parseTtml(`
    <tt xmlns="http://www.w3.org/ns/ttml"
        xmlns:ttm="http://www.w3.org/ns/ttml#metadata"
        xmlns:itunes="http://music.apple.com/lyric-ttml-internal" itunes:timing="Word">
      <head><metadata>
        <ttm:agent xml:id="v1" type="person"/><ttm:agent xml:id="v2" type="person"/>
      </metadata></head>
      <body><div>
        <p begin="1s" end="5s" ttm:agent="v1">
          <span begin="1s" end="2s">迎着</span><span begin="2s" end="3s">风</span><span begin="3s" end="5s">向前走</span>
          <span ttm:role="x-bg" begin="2.5s" end="4s"><span begin="2.5s" end="4s">（向前）</span><span ttm:role="x-translation">onward</span></span>
          <span ttm:role="x-translation">Walk into the wind</span>
          <span ttm:role="x-roman">ying zhe feng xiang qian zou</span>
        </p>
        <p begin="5s" end="7s" ttm:agent="v2">
          <span begin="5s" end="7s">与你同行</span>
          <span ttm:role="x-bg" begin="6s" end="7s">同行</span>
        </p>
      </div></body>
    </tt>
  `)!
  );
}

describe('lyric copy', () => {
  beforeEach(() => vi.stubGlobal('DOMParser', XmlDomParser));
  afterEach(() => vi.unstubAllGlobals());

  it('inserts TTML background vocals between the corresponding main words', () => {
    const lines = sampleLines();
    expect(formatLyricsForCopy(lines, new Set([0]))).toBe(
      '迎着风（向前）向前走\nWalk into the wind（onward）'
    );
  });

  it('keeps duet lines and their own backing vocals in selection order', () => {
    const lines = sampleLines();
    expect(lines[2].isDuet).toBe(true);
    expect(formatLyricsForCopy(lines, new Set([2, 0]))).toBe(
      '迎着风（向前）向前走\nWalk into the wind（onward）\n与你同行（同行）'
    );
    expect(formatLyricsForCopy(lines, new Set([2]))).toBe('与你同行（同行）');
  });

  it('places vocals before, within, and after a sentence using word boundaries', () => {
    const [main, backing] = sampleLines();
    const lines = [
      main,
      ...[500, 1000, 2000, 2200, 6000].map((startTime, index) => ({
        ...backing,
        translatedLyric: '',
        startTime,
        words: [{ word: String(index), startTime, endTime: startTime + 500 }]
      }))
    ];
    expect(formatLyricsForCopy(lines, new Set([0]))).toBe(
      '（0）（1）迎着（2）风（3）向前走（4）\nWalk into the wind'
    );
  });

  it('retains multiple backing vocals in chronological order including equal starts', () => {
    const [main, backing] = sampleLines();
    const lines = [
      main,
      ...[
        ['晚', 4000],
        ['先', 1500],
        ['同', 1500]
      ].map(([text, start]) => ({
        ...backing,
        translatedLyric: '',
        startTime: Number(start),
        words: [{ word: String(text), startTime: Number(start), endTime: 5000 }]
      }))
    ];
    expect(formatLyricsForCopy(lines, new Set([0]))).toBe(
      '迎着（先）（同）风向前走（晚）\nWalk into the wind'
    );
  });

  it('respects hidden translations and ignores empty backing text', () => {
    const lines = sampleLines().map((line) => ({ ...line, translatedLyric: '' }));
    lines.splice(2, 0, { ...lines[1], words: [] });
    expect(formatLyricsForCopy(lines, new Set([0]))).toBe('迎着风（向前）向前走');
  });

  it('appends backing vocals when the main line has only line timing', () => {
    const lines = sampleLines();
    lines[0] = { ...lines[0], words: [{ word: '整句歌词', startTime: 1000, endTime: 5000 }] };
    expect(formatLyricsForCopy(lines, new Set([0]))).toBe(
      '整句歌词（向前）\nWalk into the wind（onward）'
    );
  });

  it('preserves provider text, spacing and translations for ordinary lyrics', () => {
    const lines = providerLyricsToAmll([
      {
        text: 'Hello world',
        trText: '你好',
        words: [
          { text: 'Hello', startTime: 1000, duration: 1000, space: true },
          { text: 'world', startTime: 2000, duration: 1000 }
        ]
      },
      { text: '下一句', trText: '', startTime: 4000 }
    ]);
    expect(formatLyricsForCopy(lines, new Set([1, 0]))).toBe('Hello world\n你好\n下一句');
    expect(formatLyricsForCopy(lines, new Set([1]))).toBe('下一句');
  });

  it('keeps word spacing beside inserted backing vocals', () => {
    const lines = providerLyricsToAmll([
      {
        text: 'Hello world',
        trText: '',
        words: [
          { text: 'Hello', startTime: 1000, duration: 1000, space: true },
          { text: 'world', startTime: 2000, duration: 1000 }
        ]
      },
      { text: 'echo', trText: '', startTime: 1500, isBG: true }
    ]);
    expect(formatLyricsForCopy(lines, new Set([0]))).toBe('Hello（echo） world');
  });

  it('does not mutate playback lines and ignores invalid or background-only selections', () => {
    const lines = sampleLines();
    const before = JSON.stringify(lines);
    expect(formatLyricsForCopy(lines, new Set([1, -1, 99]))).toBe('');
    formatLyricsForCopy(lines, new Set([0, 2]));
    expect(JSON.stringify(lines)).toBe(before);
  });
});
