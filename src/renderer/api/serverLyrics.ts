import type { ILyric, SongResult } from '@/types/music';
import { parseLyricContent } from '@/utils/localMusicUtils';
import { resolveServerSongId } from '@/utils/serverSongIdentity';

import { fetchLyricText, withLyricCacheTimeout } from './lyricResource';
import { readProviderLyricCache, writeProviderLyricCache } from './providerLyricCache';
import { getServerSongMetadata } from './serverSongs';

export async function loadServerLyric(song: SongResult): Promise<ILyric> {
  const empty: ILyric = { lrcArray: [], lrcTimeArray: [], hasWordByWord: false };
  const previous = song.lyric?.lrcArray.length ? song.lyric : empty;
  const id = resolveServerSongId(song);
  if (!id) return previous;
  const metadata = await getServerSongMetadata(id).catch(() => null);
  const url = metadata?.lyricsUrl || song.lyricsUrl;
  if (!url) return previous;
  const key = `server:${id}:${url}`;
  const cached = await withLyricCacheTimeout(readProviderLyricCache(key), null);
  if (cached?.fresh) return cached.lyric;
  const text = await fetchLyricText(url);
  const lyric = text ? parseLyricContent(text, url) : null;
  if (!lyric?.lrcArray.length) return cached?.lyric || previous;
  lyric.sourceId = key;
  await withLyricCacheTimeout(writeProviderLyricCache(key, lyric), undefined);
  return lyric;
}
