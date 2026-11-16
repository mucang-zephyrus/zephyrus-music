import type { LyricLine } from '@applemusic-like-lyrics/core';

import { lyricLineText } from './amllLyricAdapter';

function withBackgroundText(line: LyricLine, background: readonly LyricLine[]): string {
  const words = line.words.map((word) => word.word);
  const insertions = new Map<number, string[]>();
  for (const backing of background) {
    const text = lyricLineText(backing);
    if (!text) continue;
    let index = 0;
    while (index < line.words.length && line.words[index].startTime < backing.startTime) {
      index += 1;
    }
    const slot = insertions.get(index) || [];
    slot.push(`（${text}）`);
    insertions.set(index, slot);
  }
  let text = '';
  for (let index = 0; index <= words.length; index += 1) {
    const insertion = (insertions.get(index) || []).join('');
    if (insertion) {
      const spacing = text.match(/\s+$/u)?.[0] || '';
      text = text.trimEnd() + insertion + (index < words.length ? spacing : '');
    }
    text += words[index] || '';
  }
  return text.trim();
}

/** AMLL stores each main line followed by its attached background lines. */
export function formatLyricsForCopy(
  lines: readonly LyricLine[],
  selectedIndices: ReadonlySet<number>
): string {
  const result: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!selectedIndices.has(index) || line.isBG || !lyricLineText(line)) continue;
    const background: LyricLine[] = [];
    for (let next = index + 1; next < lines.length && lines[next].isBG; next += 1) {
      background.push(lines[next]);
    }
    background.sort((a, b) => a.startTime - b.startTime);
    result.push(withBackgroundText(line, background));
    // Auxiliary translations have no word timeline, so keep their attached vocals together.
    const translation = [
      line.translatedLyric,
      ...background
        .map((backing) => backing.translatedLyric.trim())
        .filter(Boolean)
        .map((text) => `（${text}）`)
    ].join('');
    if (translation.trim()) result.push(translation);
  }
  return result.join('\n');
}
