import type { TtmlAuxiliaryText, TtmlLyric } from '@/services/ttmlParser';
import type { ILyricText } from '@/types/music';

export interface HoverLyricWord {
  text: string;
  begin: number;
  end: number;
}

export interface HoverLyricLine {
  key: string;
  text: string;
  words: HoverLyricWord[];
  translations: TtmlAuxiliaryText[];
  romanizations: TtmlAuxiliaryText[];
  background: boolean;
  duet: boolean;
  begin: number;
  end: number;
}

export interface LyricHoverPreview {
  lines: HoverLyricLine[];
  interlude: boolean;
}

export function buildLyricHoverTimeline(
  ttml: TtmlLyric | null,
  lines: readonly ILyricText[],
  times: readonly number[]
): HoverLyricLine[] {
  if (ttml?.lines.length) {
    return ttml.lines
      .flatMap((line, index) => {
        if (line.creditHidden) return [];
        const duet = Boolean(ttml.primaryAgent && line.agent && line.agent !== ttml.primaryAgent);
        return [line, ...line.background].map((voice, voiceIndex) => ({
          key: `ttml:${index}:${voiceIndex}`,
          text: voice.text.trim(),
          words: ttml.timingMode === 'word' ? voice.words.map((word) => ({ ...word })) : [],
          translations: voice.translations,
          romanizations: voice.romanizations,
          background: voiceIndex > 0,
          duet,
          begin: voice.begin,
          end: Math.max(voice.end, ...voice.words.map((word) => word.end))
        }));
      })
      .filter((line) => line.text)
      .sort((a, b) => a.begin - b.begin);
  }

  return lines
    .flatMap((line, index): HoverLyricLine[] => {
      const begin = times[index] ?? (line.startTime ?? 0) / 1000;
      if (begin < 0 || line.creditHidden || !line.text.trim()) return [];
      const timedEnd =
        line.hasWordByWord && line.words?.length
          ? Math.max(...line.words.map((word) => (word.startTime + word.duration) / 1000))
          : null;
      // LRC only supplies starts: its display range ends at the next timestamp.
      const end = timedEnd ?? times[index + 1] ?? Infinity;
      return [
        {
          key: `provider:${index}`,
          text: line.text.trim(),
          words: line.hasWordByWord
            ? (line.words || []).map((word) => ({
                text: `${word.text}${word.space ? ' ' : ''}`,
                begin: word.startTime / 1000,
                end: (word.startTime + word.duration) / 1000
              }))
            : [],
          translations: line.trText ? [{ text: line.trText, role: 'translation' }] : [],
          romanizations: line.romaText ? [{ text: line.romaText, role: 'roman' }] : [],
          background: Boolean(line.isBG),
          duet: Boolean(line.isDuet),
          begin,
          end: Math.max(begin, end)
        }
      ];
    })
    .sort((a, b) => a.begin - b.begin);
}

export function hoverWordProgress(word: HoverLyricWord, time: number): number {
  if (time < word.begin) return 0;
  if (time >= word.end) return 1;
  return Math.max(0, Math.min(1, (time - word.begin) / (word.end - word.begin)));
}

/** Timeline and hover time use seconds; AMLL's minimum interlude gap is 7 seconds. */
export function resolveLyricHoverPreview(
  timeline: readonly HoverLyricLine[],
  time: number,
  duration: number
): LyricHoverPreview {
  if (!Number.isFinite(time) || time < 0 || !timeline.length) {
    return { lines: [], interlude: false };
  }
  const lines = timeline.filter((line) => time >= line.begin && time < line.end);
  if (lines.length) return { lines, interlude: false };

  let previousEnd = 0;
  let nextBegin = duration > time ? duration : Infinity;
  for (const line of timeline) {
    if (line.begin > time) nextBegin = Math.min(nextBegin, line.begin);
    else previousEnd = Math.max(previousEnd, line.end);
  }
  return {
    lines: [],
    interlude: Number.isFinite(nextBegin) && nextBegin - previousEnd >= 7 && time < nextBegin
  };
}
