import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/api/music', () => ({ getMusicDetail: vi.fn() }));
let links: typeof import('@/utils/deepLink');
const url = 'https://163cn.tv/bku4CHzS';
beforeEach(async () => {
  vi.resetModules();
  links = await import('@/utils/deepLink');
});

describe('unified share entry', () => {
  it('replays a cold invitation only after its own modal is registered', async () => {
    await links.handleDeepLink('zephyrus://listen/aBc123');
    links.setSharedSongCardRef({
      showSongCard: vi.fn(),
      showShareCard: vi.fn(),
      showCollectionCard: vi.fn()
    });
    const invite = { showInvite: vi.fn() };
    links.setListenTogetherInviteRef(invite);
    expect(invite.showInvite).toHaveBeenCalledExactlyOnceWith('ABC123');
  });
  it('holds cold-start content until card registration and replays it once', async () => {
    expect(await links.handleClipboardShare(`prose ${url}`)).toBe(true);
    const ref = { showSongCard: vi.fn(), showShareCard: vi.fn(), showCollectionCard: vi.fn() };
    links.setSharedSongCardRef(ref);
    expect(ref.showShareCard).toHaveBeenCalledExactlyOnceWith(url);
    await links.handleDeepLink(url);
    expect(ref.showShareCard).toHaveBeenCalledTimes(1);
    links.resetLastHandledUrl();
    await links.handleClipboardShare(url);
    expect(ref.showShareCard).toHaveBeenCalledTimes(2);
  });
  it('ignores arbitrary text without poisoning the next valid share', async () => {
    const ref = { showSongCard: vi.fn(), showShareCard: vi.fn(), showCollectionCard: vi.fn() };
    links.setSharedSongCardRef(ref);
    expect(await links.handleClipboardShare('private ordinary clipboard content')).toBe(false);
    await links.handleClipboardShare(url);
    await links.handleClipboardShare('https://c6.y.qq.com/base/fcgi-bin/u?__=Sm5jdCo0qBcJ');
    expect(ref.showShareCard).toHaveBeenCalledTimes(2);
  });
  it('preserves existing album, playlist and listen invitations', async () => {
    const ref = { showSongCard: vi.fn(), showShareCard: vi.fn(), showCollectionCard: vi.fn() };
    const invite = { showInvite: vi.fn() };
    links.setSharedSongCardRef(ref);
    links.setListenTogetherInviteRef(invite);
    await links.handleDeepLink('zephyrus://album/123');
    await links.handleDeepLink('zephyrus://playlist/456');
    await links.handleDeepLink('zephyrus://listen/aBc123');
    expect(ref.showCollectionCard.mock.calls).toEqual([
      ['album', 123],
      ['playlist', 456]
    ]);
    expect(invite.showInvite).toHaveBeenCalledWith('ABC123');
  });
});
