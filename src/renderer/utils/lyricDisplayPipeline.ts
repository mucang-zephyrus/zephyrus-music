import type { ILyric, ILyricText } from '@/types/music';
import {
  type LyricDisplayPolicy,
  normalizeLyricForDisplay
} from '@/utils/normalizeLyricForDisplay';

/** The generation covers parsing and asynchronous text conversion, including same-song replacements. */
export function createLyricDisplayPipeline() {
  let generation = 0;
  return {
    invalidate() {
      generation++;
    },
    async project(
      prepare: () => ILyric | Promise<ILyric>,
      policy: (raw: ILyric) => LyricDisplayPolicy,
      convert: (lines: ILyricText[]) => Promise<ILyricText[]>
    ) {
      const request = ++generation;
      const raw = await prepare();
      if (request !== generation) return null;
      const result = normalizeLyricForDisplay(raw, policy(raw));
      let lines = result.lyric.lrcArray;
      try {
        lines = await convert(lines);
      } catch (error) {
        console.warn('歌词显示转换失败，保留原文', error);
      }
      if (request !== generation) return null;
      return { raw, ...result, lyric: { ...result.lyric, lrcArray: lines } };
    }
  };
}
