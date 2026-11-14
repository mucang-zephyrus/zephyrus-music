import { ref } from 'vue';

import type { ILyric, SongResult } from '@/types/music';
import type { LyricMergeInfo } from '@/utils/normalizeLyricForDisplay';

const STORAGE_KEY = 'lyric-smart-merge-disabled-v1';
function readDisabled(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}
export const disabledLyricMerges = ref(readDisabled());
if (typeof window !== 'undefined')
  window.addEventListener('storage', (event) => {
    if (event.key === STORAGE_KEY) disabledLyricMerges.value = readDisabled();
  });

export function lyricSongKey(song: Pick<SongResult, 'id' | 'platform' | 'platformId'>): string {
  return JSON.stringify([song.platform || 'netease', String(song.platformId ?? song.id)]);
}
export function lyricSourceId(raw: ILyric): string {
  return (
    raw.sourceId || raw.manualSelection?.id || `${raw.source || 'local'}:${raw.format || 'lrc'}`
  );
}
export function mergePreferenceKey(songKey: string, sourceId: string): string {
  return JSON.stringify([songKey, sourceId]);
}
export function isLyricMergeEnabled(songKey: string, sourceId: string): boolean {
  return !disabledLyricMerges.value.includes(mergePreferenceKey(songKey, sourceId));
}
export function setLyricMergeEnabled(songKey: string, sourceId: string, enabled: boolean): boolean {
  const key = mergePreferenceKey(songKey, sourceId);
  const next = readDisabled().filter((item) => item !== key);
  if (!enabled) next.push(key);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    if (localStorage.getItem(STORAGE_KEY) !== JSON.stringify(next)) return false;
    disabledLyricMerges.value = next;
    return true;
  } catch {
    return false;
  }
}

export interface LyricMergeContext {
  legacySnapshot: boolean;
  songKey: string;
  songName: string;
  artist: string;
  sourceId: string;
  mergeInfo: LyricMergeInfo;
  samples: { indices: number[]; before: string[]; after: string; translation: string }[];
}
export const currentLyricMergeContext = ref<LyricMergeContext | null>(null);
export const lyricMergeFeedbackTarget = ref<LyricMergeContext | null>(null);
export const lyricMergeFeedbackVisible = ref(false);

export function createLyricMergeContext(
  song: SongResult,
  raw: ILyric,
  display: ILyric,
  mergeInfo: LyricMergeInfo
): LyricMergeContext {
  return {
    legacySnapshot: !!raw.legacyProcessed,
    songKey: lyricSongKey(song),
    songName: song.name,
    artist: (song.ar || song.artists || []).map((a) => a.name).join(' / '),
    sourceId: mergeInfo.sourceId,
    mergeInfo,
    // Deliberately bounded excerpts, never the entire lyric or raw source payload.
    samples: mergeInfo.records.slice(0, 3).map((record) => ({
      indices: record.originalIndices,
      before: record.originalIndices
        .slice(0, 6)
        .map((i) => raw.lrcArray[i]?.text.slice(0, 80) || ''),
      after: display.lrcArray[record.outputIndex]?.text.slice(0, 120) || '',
      translation: display.lrcArray[record.outputIndex]?.trText.slice(0, 120) || ''
    }))
  };
}
export function openLyricMergeFeedback(context: LyricMergeContext) {
  lyricMergeFeedbackTarget.value = JSON.parse(JSON.stringify(context));
  lyricMergeFeedbackVisible.value = true;
}

export function lyricMergeDiagnostics(context: LyricMergeContext): string {
  // Only explicit safe fields enter the feedback body.
  return JSON.stringify(
    {
      song: context.songName,
      artist: context.artist,
      songKey: context.songKey,
      source: context.sourceId,
      algorithm: context.mergeInfo.version,
      rules: context.mergeInfo.rules,
      samples: context.samples
    },
    null,
    2
  );
}
