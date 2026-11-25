import { describe, expect, it } from 'vitest';

import { albumPath, qqArtistMid, qqArtistPath } from '@/utils/qqDetailRoute';

describe('QQ detail navigation', () => {
  const mid = '001UeB5t0QikN1';
  it('resolves the path-only MID emitted by the player', () => {
    const url = new URL(qqArtistPath(mid, '梅卡德尔乐队'), 'https://example.test');
    expect(
      qqArtistMid(
        url.searchParams.get('platform'),
        url.searchParams.get('singerMID'),
        url.pathname.split('/').pop()
      )
    ).toBe(mid);
  });
  it('preserves old query MIDs and leaves NetEase routes alone', () => {
    expect(qqArtistMid('qq', mid, '123')).toBe(mid);
    expect(qqArtistMid(undefined, mid, '123')).toBe('');
  });
  it('retains the QQ album source', () => {
    expect(albumPath('001ZuHZI0MeBkc', 'qq')).toBe(
      '/music-list/001ZuHZI0MeBkc?type=album&platform=qq'
    );
    expect(albumPath(123)).toBe('/music-list/123?type=album');
  });
});
