import { type ClimaxSegment, normalizeClimaxSegments } from '@/api/climax';
import type { Artist, SongResult } from '@/types/music';
import { normalizeSearchText, scoreSearchText } from '@/utils/searchText';
import { resolveServerSongId } from '@/utils/serverSongIdentity';

import { fetchLyricText } from './lyricResource';

/**
 * Zephyrus 云端歌曲 API
 *
 * 从服务器 JSON 文件加载云端托管歌曲（封禁歌曲/独立音乐等）
 * 数据格式：songs.json 列出所有可用歌曲，含音频直链、封面、歌词URL、高潮时段
 */

const API_BASE = 'https://www.mucang.xyz';
const SONGS_JSON_URL = `${API_BASE}/server-music/songs.json`;

/** 云端歌曲数据结构 */
export interface ServerSong {
  id: string;
  name: string;
  artists: string[];
  album: string;
  albumArtist?: string;
  composer?: string;
  genre?: string;
  year?: string;
  track?: string;
  duration: number;
  picUrl: string;
  audioUrl: string;
  popularity?: number;
  playCount?: number;
  hot?: number;
  lyricsUrl?: string;
  climax?: ClimaxSegment[];
}

/**
 * 判断歌曲是否来自 Zephyrus 云端歌曲库
 */
export function isServerSongResult(item: { id?: unknown; platform?: string }): boolean {
  return item?.platform === 'server' || String(item?.id || '').startsWith('server:');
}

/** 云端歌曲列表在内存中缓存一分钟。 */
let cachedSongs: ServerSong[] | null = null;
let cachedAt = 0;
let pendingSongs: Promise<ServerSong[]> | null = null;
const CACHE_TTL_MS = 60_000;

/**
 * 加载云端歌曲列表，过期后刷新。
 */
export async function loadServerSongs(): Promise<ServerSong[]> {
  if (cachedSongs && Date.now() - cachedAt < CACHE_TTL_MS) return cachedSongs;
  if (pendingSongs) return pendingSongs;
  pendingSongs = fetchServerSongs().finally(() => {
    pendingSongs = null;
  });
  return pendingSongs;
}

async function fetchServerSongs(): Promise<ServerSong[]> {
  try {
    // 时间戳绕过缺少 Cache-Control 时的列表缓存。
    const text = await fetchLyricText(`${SONGS_JSON_URL}?t=${Date.now()}`);
    if (!text) throw new Error('Cloud song list unavailable');
    const data = JSON.parse(text);
    if (!Array.isArray(data.songs)) throw new Error('Invalid cloud song list');
    const songs = (data.songs || []) as Array<
      Omit<ServerSong, 'climax'> & { climax?: ClimaxSegment | ClimaxSegment[] }
    >;
    cachedSongs = songs.map((song) => ({
      ...song,
      picUrl: song.picUrl || '/images/default_cover.png',
      climax: normalizeClimaxSegments(song.climax, song.duration)
    }));
    cachedAt = Date.now();
    return cachedSongs;
  } catch (err) {
    // 刷新失败时回退旧缓存,避免列表被清空
    if (cachedSongs) return cachedSongs;
    console.error('[ServerSongs] 加载云端歌曲列表失败:', err);
    return [];
  }
}

/**
 * 搜索云端歌曲
 * @param keyword 搜索关键词
 * @param limit 最大返回数
 */
export async function searchServerSongs(
  keyword: string,
  limit: number = 20
): Promise<ServerSong[]> {
  if (!keyword?.trim()) return [];

  const all = await loadServerSongs();
  const query = normalizeSearchText(keyword);

  return all
    .map((song) => ({ song, score: scoreServerSong(song, query, keyword.trim()) }))
    .filter((item) => Number.isFinite(item.score))
    .sort((left, right) => left.score - right.score)
    .slice(0, limit)
    .map((item) => item.song);
}

function scoreServerSong(song: ServerSong, query: string, rawQuery: string): number {
  const candidates = [
    { value: song.name, weight: 0 },
    ...song.artists.map((artist) => ({ value: artist, weight: 8 })),
    { value: song.album || '', weight: 16 },
    { value: `${song.name}${song.artists.join('')}${song.album || ''}`, weight: 24 }
  ];

  const matchScore = Math.min(
    ...candidates.map(({ value, weight }) => scoreSearchText(value, query, rawQuery) + weight)
  );
  const popularity = Number(song.popularity ?? song.playCount ?? song.hot ?? 0);
  const popularityBoost = Number.isFinite(popularity)
    ? Math.min(8, Math.log10(Math.max(1, popularity)) * 2)
    : 0;
  return matchScore - popularityBoost;
}

export function serverSongToSongResult(song: ServerSong): SongResult {
  const artists: Artist[] = song.artists.map((name, index) => ({
    name,
    id: index,
    picId: 0,
    img1v1Id: 0,
    briefDesc: '',
    picUrl: '',
    img1v1Url: '',
    albumSize: 0,
    alias: [],
    trans: '',
    musicSize: 0,
    topicPerson: 0
  }));
  const picUrl = song.picUrl || '/images/default_cover.png';
  const album = {
    name: song.album || '',
    id: 0,
    type: '',
    size: 0,
    picId: 0,
    blurPicUrl: '',
    companyId: 0,
    pic: 0,
    picUrl,
    publishTime: 0,
    description: '',
    tags: '',
    company: '',
    briefDesc: '',
    artist: artists[0] || ({} as Artist),
    songs: [],
    alias: [],
    status: 0,
    copyrightId: 0,
    commentThreadId: '',
    artists,
    subType: '',
    transName: null,
    onSale: false,
    mark: 0,
    picId_str: ''
  };

  return {
    id: `server:${song.id}`,
    name: song.name,
    picUrl,
    ar: artists,
    artists,
    al: album,
    album,
    count: song.duration,
    dt: song.duration,
    duration: song.duration,
    climaxSegments: normalizeClimaxSegments(song.climax, song.duration),
    platform: 'server',
    platformId: song.id,
    playMusicUrl: song.audioUrl,
    lyricsUrl: song.lyricsUrl,
    source: 'netease'
  };
}

/**
 * 获取单首云端歌曲详情（含歌词文本）
 */
export async function getServerSongDetail(
  songId: string
): Promise<ServerSong & { lyricsText?: string; lyricsUrl?: string }> {
  const song = await getServerSongMetadata(songId);

  // 懒加载歌词文本
  let lyricsText: string | undefined;
  if (song.lyricsUrl) {
    lyricsText = (await fetchLyricText(song.lyricsUrl)) || undefined;
  }

  return {
    ...song,
    lyricsText,
    lyricsUrl: song.lyricsUrl,
    // 高潮时段只信任 songs.json 中人工标注的 climax 字段，
    // 不再根据 LRC 重复句推断额外的副歌时段。
    climax: normalizeClimaxSegments(song.climax, song.duration)
  };
}

/** Recover older saved entries which only retained the namespaced song ID. */
export async function getServerSongMetadata(songId: string): Promise<ServerSong> {
  const id = resolveServerSongId({ id: songId, platform: 'server' });
  const song = (await loadServerSongs()).find((item) => String(item.id) === id);
  if (!song) throw new Error(`Song not found: ${songId}`);
  return song;
}

/**
 * 获取云端同名专辑的全部歌曲（按 track 排序）
 */
export async function getServerAlbumSongs(albumName: string): Promise<SongResult[]> {
  const all = await loadServerSongs();
  return all
    .filter((song) => song.album === albumName)
    .sort((left, right) =>
      String(left.track || '').localeCompare(String(right.track || ''), 'zh-CN', {
        numeric: true
      })
    )
    .map(serverSongToSongResult);
}

/**
 * 清除缓存（用于手动刷新）
 */
export function clearServerSongsCache(): void {
  cachedSongs = null;
}
