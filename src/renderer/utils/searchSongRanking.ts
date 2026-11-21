import type { SongResult } from '@/types/music';

import { normalizeSearchText, scoreSearchText } from './searchText';

const POSITION_COST = 20;
const MAX_TEXT_COST = 80;
const SUPPLEMENT_START_INDEX = 3;
const SUPPLEMENT_CANDIDATE_COUNT = 3;
const MAX_PROMOTED_SUPPLEMENTS = 2;

const SUPPLEMENT_SOURCES = ['server', 'qq', 'kugou', 'vip', 'cross'] as const;
export type SearchSupplementSource = (typeof SUPPLEMENT_SOURCES)[number];

interface RankedSong {
  song: SongResult;
  score: number;
  index: number;
}

function songIdentity(song: SongResult): string {
  const artists = (song.ar || song.artists || []).map((artist) => artist.name);
  return `${song.name?.trim() || ''}|${artists.join(',').trim()}`.toLowerCase();
}

export function createSongSearchResults(keyword: string) {
  const rawQuery = keyword.trim();
  const query = normalizeSearchText(rawQuery);
  let firstPage: RankedSong[] = [];
  const laterPages: SongResult[] = [];
  const supplements = new Map<SearchSupplementSource, readonly SongResult[]>();

  function setFirstPage(songs: readonly SongResult[]) {
    firstPage = songs.map((song, index) => {
      const name = song.name || '';
      const artists = (song.ar || song.artists || []).map((artist) => artist.name).join(' ');
      const album = song.al?.name || song.album?.name || '';
      const textCost = Math.min(
        MAX_TEXT_COST,
        scoreSearchText(name, query, rawQuery),
        scoreSearchText(artists, query, rawQuery) + 8,
        scoreSearchText(album, query, rawQuery) + 16,
        scoreSearchText(`${name} ${artists} ${album}`, query, rawQuery) + 24
      );
      return { song, index, score: index * POSITION_COST + textCost };
    });
  }

  function appendPage(songs: readonly SongResult[]) {
    laterPages.push(...songs);
  }

  function setSupplement(source: SearchSupplementSource, songs: readonly SongResult[]) {
    supplements.set(source, songs);
  }

  function getSongs(): SongResult[] {
    const seen = new Set(firstPage.map(({ song }) => songIdentity(song)));
    for (const song of laterPages) seen.add(songIdentity(song));

    const uniqueSupplements: RankedSong[] = [];
    for (const source of SUPPLEMENT_SOURCES) {
      // 通用跨平台请求聚合多个平台，各自的原始名次从零开始。
      const groups = new Map<string, SongResult[]>();
      for (const song of supplements.get(source) ?? []) {
        const platform = source === 'cross' ? (song.platform ?? '') : source;
        const group = groups.get(platform);
        if (group) group.push(song);
        else groups.set(platform, [song]);
      }
      for (const platform of [...groups.keys()].sort()) {
        groups.get(platform)?.forEach((song, index) => {
          const key = songIdentity(song);
          if (seen.has(key)) return;
          seen.add(key);
          uniqueSupplements.push({
            song,
            index,
            score: (SUPPLEMENT_START_INDEX + index) * POSITION_COST
          });
        });
      }
    }

    const promoted = uniqueSupplements
      .filter(
        ({ song, index }) =>
          query &&
          index < SUPPLEMENT_CANDIDATE_COUNT &&
          normalizeSearchText(song.name || '') === query
      )
      .sort((left, right) => left.score - right.score)
      .slice(0, MAX_PROMOTED_SUPPLEMENTS);
    const promotedSet = new Set(promoted);

    // 同分先保留网易云原序，其后按补充来源顺序。排序稳定性保证相同分数的顺序。
    const head = [...firstPage, ...promoted].sort((left, right) => left.score - right.score);
    return [
      ...head.map(({ song }) => song),
      ...uniqueSupplements.filter((entry) => !promotedSet.has(entry)).map(({ song }) => song),
      ...laterPages
    ];
  }

  return { setFirstPage, appendPage, setSupplement, getSongs };
}

export type SongSearchResults = ReturnType<typeof createSongSearchResults>;
