import type { ILyricText } from '@/types/music';
import { normalizeLyricForDisplay } from '@/utils/normalizeLyricForDisplay';

/** Compatibility API; all production display processing belongs to MusicHook. */
export function mergeTranslationFeatures(lines: ILyricText[]): ILyricText[] {
  return normalizeLyricForDisplay({ lrcArray: lines, lrcTimeArray: [] }).lyric.lrcArray;
}

/** No song whitelist: cross-time pairing requires the shared structural gate. */
export const mergeBilingualAlternation = mergeTranslationFeatures;
