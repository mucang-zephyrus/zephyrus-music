import type { TtmlLyric } from '@/services/ttmlParser';
import type { ILyricText, LyricFormat } from '@/types/music';

import type { CloudInput } from './wordCloud';

/** Display projection only. Providers use milliseconds; TTML already uses seconds. */
export function providerCloudInputs(
  lines: ILyricText[],
  format: LyricFormat | 'none'
): CloudInput[] {
  const visible = lines.filter((line) => !line.creditHidden);
  return visible.map((line, index) => {
    const begin = line.startTime == null || line.startTime < 0 ? -1 : line.startTime / 1000;
    const next = visible
      .slice(index + 1)
      .find((item) => (item.startTime ?? -1) > (line.startTime ?? -1));
    const blankEnd = next && !next.text.trim() ? next.startTime! / 1000 : undefined;
    const words =
      line.hasWordByWord && line.words?.length
        ? line.words.map((word) => ({
            text: word.text,
            begin: word.startTime / 1000,
            end: (word.startTime + word.duration) / 1000
          }))
        : undefined;
    const explicit = format !== 'lrc' && format !== 'none' && (line.duration ?? 0) > 0;
    return {
      text: line.text,
      begin,
      words,
      end: blankEnd ?? (explicit ? begin + line.duration! / 1000 : undefined),
      reliableEnd: blankEnd !== undefined || explicit,
      background: line.isBG === true && !line.isDuet,
      translation: line.trText,
      roman: line.romaText
    };
  });
}

export function ttmlCloudInputs(lyric: TtmlLyric): CloudInput[] {
  const result: CloudInput[] = [];
  for (const line of lyric.lines) {
    if (line.creditHidden) continue;
    const parent = result.length;
    result.push({
      text: line.text,
      begin: line.begin,
      end: line.end,
      reliableEnd: line.end > line.begin,
      primary: Boolean(lyric.primaryAgent && line.agent === lyric.primaryAgent),
      words: lyric.timingMode === 'word' ? line.words.map((word) => ({ ...word })) : undefined,
      translation: line.translations[0]?.text,
      roman: line.romanizations[0]?.text
    });
    for (const bg of line.background)
      result.push({
        text: bg.text,
        begin: bg.begin,
        end: bg.end,
        reliableEnd: bg.end > bg.begin,
        words: lyric.timingMode === 'word' ? bg.words.map((word) => ({ ...word })) : undefined,
        background: true,
        parent
      });
  }
  return result;
}
