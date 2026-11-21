import { describe, expect, it } from 'vitest';

import type { SongResult } from '@/types/music';
import { createSongSearchResults } from '@/utils/searchSongRanking';

function song(id: string, name: string, artist = 'Unknown', platform?: string): SongResult {
  return { id, name, ar: [{ name: artist }], platform } as SongResult;
}

const primary = [
  song('alias', '北平', '霜冻前夜'),
  song('other-1', '入阵曲'),
  song('other-2', '大风歌'),
  song('other-3', '阳关三叠'),
  song('other-4', '将军令'),
  song('other-5', '山河')
];
const keyword = 'Beijing';
const ids = (search: ReturnType<typeof createSongSearchResults>) =>
  search.getSongs().map(({ id }) => id);

describe('single track search ranking', () => {
  it('lets an exact fourth result pass an alias hit but keeps the original order on a fifth-place tie', () => {
    const search = createSongSearchResults(keyword);
    const exact = song('exact', keyword);
    search.setFirstPage([...primary.slice(0, 3), exact]);
    expect(ids(search)).toEqual(['exact', 'alias', 'other-1', 'other-2']);

    search.setFirstPage([...primary.slice(0, 4), exact]);
    expect(ids(search)).toEqual(['alias', 'exact', 'other-1', 'other-2', 'other-3']);
  });

  it('preserves the original list when no titles or metadata match', () => {
    const search = createSongSearchResults(keyword);
    search.setFirstPage(primary);
    expect(ids(search)).toEqual(primary.map(({ id }) => id));
  });

  it('resolves supplemental ties and duplicates consistently in both response orders', () => {
    const cloud = song('cloud', 'Ｂｅｉｊｉｎｇ', 'Cloud artist', 'server');
    const cloudDuplicate = song('cloud-duplicate', 'Ｂｅｉｊｉｎｇ', 'Cloud artist', 'qq');
    const qq = song('qq', keyword, 'QQ artist', 'qq');
    const kugou = song('kugou', keyword, 'Kugou artist', 'kugou');
    const batches = [
      ['server', [cloud]],
      ['qq', [cloudDuplicate, qq]],
      ['kugou', [kugou]],
      ['cross', [song('duplicate-primary', '北平', '霜冻前夜', 'joox')]]
    ] as const;

    for (const order of [batches, [...batches].reverse()]) {
      const search = createSongSearchResults(keyword);
      search.setFirstPage(primary);
      for (const [source, songs] of order) search.setSupplement(source, songs);
      expect(ids(search)).toEqual(['cloud', 'kugou', ...primary.map(({ id }) => id), 'qq']);
    }
  });

  it('keeps the top-three cutoff per platform and uses the title alone for promotion', () => {
    const search = createSongSearchResults(keyword);
    search.setFirstPage(primary);
    search.setSupplement('cross', [
      song('artist-only', 'Unrelated', keyword, 'qq'),
      song('qq-2', 'Second', 'QQ artist', 'qq'),
      song('qq-3', 'Third', 'QQ artist', 'qq'),
      song('qq-4', keyword, 'QQ artist', 'qq'),
      song('joox-1', keyword, 'Joox artist', 'joox')
    ]);
    expect(ids(search)).toEqual([
      'joox-1', ...primary.map(({ id }) => id), 'artist-only', 'qq-2', 'qq-3', 'qq-4'
    ]);
  });

  it('keeps a main result before a supplement with the same score', () => {
    const search = createSongSearchResults(keyword);
    search.setFirstPage([...primary.slice(0, 3), song('main', keyword, 'Main artist')]);
    search.setSupplement('server', [song('cloud', keyword, 'Cloud artist', 'server')]);
    expect(ids(search).slice(0, 2)).toEqual(['main', 'cloud']);
  });

  it('keeps later pages in source order and gives them priority over matching supplements', () => {
    const later = [song('page-2-first', 'Later'), song('page-2-exact', keyword, 'Later artist')];
    const supplement = [song('duplicate', keyword, 'Later artist', 'server')];
    for (const appendFirst of [true, false]) {
      const search = createSongSearchResults(keyword);
      search.setFirstPage(primary);
      if (appendFirst) search.appendPage(later);
      search.setSupplement('server', supplement);
      if (!appendFirst) search.appendPage(later);
      search.setSupplement('cross', [song('late', keyword, 'Cross artist', 'qq')]);
      expect(ids(search)).toEqual(['late', ...primary.map(({ id }) => id), 'page-2-first', 'page-2-exact']);
    }
  });
});
