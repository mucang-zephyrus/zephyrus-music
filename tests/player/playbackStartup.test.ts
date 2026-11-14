import { createPinia, disposePinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  lyric: vi.fn(),
  colors: vi.fn(),
  detail: vi.fn(),
  cancel: vi.fn(async () => {}),
  play: vi.fn(async () => ({ stop: vi.fn(), unload: vi.fn() })),
  addMusic: vi.fn()
}));
vi.mock('@/../i18n/renderer', () => ({ default: { global: { t: (key: string) => key } } }));
vi.mock('naive-ui', () => ({
  createDiscreteApi: () => ({ message: { warning: vi.fn(), error: vi.fn() } })
}));
vi.mock('@/api/music', () => ({ getParsingMusicUrl: vi.fn() }));
vi.mock('@/hooks/useLocalMusic', () => ({
  isLocalSong: () => false,
  useLocalMusic: () => ({ loadLocalLyrics: mocks.lyric })
}));
vi.mock('@/hooks/usePlayerHooks', () => ({
  useLyrics: () => ({ loadBestLyric: mocks.lyric }),
  useSongDetail: () => ({ getSongDetail: mocks.detail })
}));
vi.mock('@/services/androidNative', () => ({ isAndroidNative: () => true }));
vi.mock('@/services/audioService', () => ({
  audioService: {
    cancelPendingPlayback: mocks.cancel,
    play: mocks.play,
    getCurrentSound: () => null,
    getCurrentPosition: () => 0,
    isLoading: () => false,
    getCrossfadingSound: () => null
  }
}));
vi.mock('@/services/playbackSnapshot', () => ({
  markSessionSnapshotSong: vi.fn(),
  writePlayerSessionSnapshot: vi.fn(),
  readPlayerSessionSnapshot: vi.fn()
}));
vi.mock('@/services/preloadService', () => ({ preloadService: {} }));
vi.mock('@/services/SongSourceConfigManager', () => ({
  SongSourceConfigManager: { clearTriedSources: vi.fn() }
}));
vi.mock('@/utils', () => ({ getImgUrl: (url: string) => url }));
vi.mock('@/utils/linearColor', () => ({ getImageLinearBackground: mocks.colors }));
vi.mock('@/store/modules/backgroundHealth', () => ({
  BACKGROUND_HEALTH_DEGRADED_EVENT: 'background-degraded',
  useBackgroundHealthStore: () => ({ tryRestoreAtSafePoint: vi.fn() })
}));
vi.mock('@/store/modules/playHistory', () => ({
  usePlayHistoryStore: () => ({ addMusic: mocks.addMusic })
}));
vi.mock('@/store/modules/playlist', () => ({ usePlaylistStore: () => ({ playList: [] }) }));

import { playbackRequestManager } from '@/services/playbackRequestManager';
import { usePlayerCoreStore } from '@/store/modules/playerCore';
import type { SongResult } from '@/types/music';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const track = (id: number) =>
  ({
    id,
    name: `song-${id}`,
    picUrl: `https://slow.example/${id}.jpg`,
    source: 'netease'
  }) as SongResult;
const lyric = (text: string) => ({ lrcArray: [{ text }], lrcTimeArray: [0] });
const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

describe('playback startup auxiliary requests', () => {
  let pinia: ReturnType<typeof createPinia>;
  beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);
    vi.clearAllMocks();
    localStorage.clear();
    mocks.lyric.mockImplementation(() => new Promise(() => {}));
    mocks.colors.mockImplementation(() => new Promise(() => {}));
    mocks.detail.mockImplementation(async (song: SongResult) => ({
      ...song,
      playMusicUrl: `https://audio.example/${song.id}.mp3`
    }));
  });
  afterEach(() => {
    disposePinia(pinia);
    playbackRequestManager.cancelAllRequests();
    vi.restoreAllMocks();
  });

  it('starts audio before artwork or lyrics return, then applies late metadata', async () => {
    const lrc = deferred<ReturnType<typeof lyric>>();
    const colors = deferred<{ backgroundColor: string; primaryColor: string }>();
    mocks.lyric.mockReturnValue(lrc.promise);
    mocks.colors.mockReturnValue(colors.promise);
    const store = usePlayerCoreStore();
    expect(await store.handlePlayMusic(track(1))).toBe(true);
    expect(mocks.play).toHaveBeenCalledOnce();
    expect(mocks.detail.mock.calls[0][2]).toEqual({ loadCoverColor: false });
    expect(store.playMusic.lyric?.lrcArray).toEqual([]);

    lrc.resolve(lyric('late lyric'));
    colors.resolve({ backgroundColor: 'gradient', primaryColor: '#123456' });
    await flush();
    expect(store.playMusic.lyric?.lrcArray[0].text).toBe('late lyric');
    expect(store.playMusic.primaryColor).toBe('#123456');
  });

  it('does not overwrite auxiliary data that arrives while the URL is still loading', async () => {
    const url = deferred<SongResult>();
    mocks.detail.mockReturnValue(url.promise);
    mocks.lyric.mockResolvedValue(lyric('early lyric'));
    mocks.colors.mockResolvedValue({ backgroundColor: 'gradient', primaryColor: '#abcdef' });
    const store = usePlayerCoreStore();
    const pending = store.handlePlayMusic(track(2));
    await flush();
    url.resolve({ ...track(2), playMusicUrl: 'https://audio.example/2.mp3' });
    expect(await pending).toBe(true);
    expect(store.playMusic.lyric?.lrcArray[0].text).toBe('early lyric');
    expect(store.playMusic.primaryColor).toBe('#abcdef');
  });

  it('ignores stale callbacks after switching songs, including same-ID requests', async () => {
    const oldLyric = deferred<ReturnType<typeof lyric>>();
    const oldColors = deferred<{ backgroundColor: string; primaryColor: string }>();
    mocks.lyric.mockReturnValueOnce(oldLyric.promise).mockResolvedValue(lyric('new lyric'));
    mocks.colors
      .mockReturnValueOnce(oldColors.promise)
      .mockResolvedValue({ primaryColor: '#ffffff' });
    const store = usePlayerCoreStore();
    await store.handlePlayMusic(track(3));
    await store.handlePlayMusic(track(3));
    oldLyric.resolve(lyric('wrong lyric'));
    oldColors.resolve({ backgroundColor: 'wrong', primaryColor: '#000000' });
    await flush();
    expect(store.playMusic.lyric?.lrcArray[0].text).toBe('new lyric');
    expect(store.playMusic.primaryColor).toBe('#ffffff');
  });

  it('keeps a manual lyric selected while automatic lyrics are loading', async () => {
    const lrc = deferred<ReturnType<typeof lyric>>();
    mocks.lyric.mockReturnValue(lrc.promise);
    const store = usePlayerCoreStore();
    await store.handlePlayMusic(track(4));
    store.playMusic.lyric = lyric('manual') as SongResult['lyric'];
    lrc.resolve(lyric('automatic'));
    await flush();
    expect(store.playMusic.lyric?.lrcArray[0].text).toBe('manual');
  });

  it('does not replay an old song when its URL fails after a newer song has started', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const oldUrl = deferred<SongResult>();
    const oldLyric = deferred<ReturnType<typeof lyric>>();
    mocks.detail.mockReturnValueOnce(oldUrl.promise);
    mocks.lyric.mockReturnValueOnce(oldLyric.promise).mockResolvedValue(lyric('current'));
    const store = usePlayerCoreStore();
    const oldPlayback = store.handlePlayMusic(track(7));
    await flush();
    expect(await store.handlePlayMusic(track(8))).toBe(true);
    const cancellationCount = mocks.cancel.mock.calls.length;
    oldUrl.reject(new Error('old URL timed out'));
    oldLyric.resolve(lyric('obsolete'));
    expect(await oldPlayback).toBe(false);
    await flush();
    expect(mocks.play).toHaveBeenCalledOnce();
    expect(mocks.cancel.mock.calls.length).toBe(cancellationCount);
    expect(store.playMusic.id).toBe(8);
    expect(store.playMusic.lyric?.lrcArray[0].text).toBe('current');
    expect(store.isPlay).toBe(true);
  });

  it('auxiliary failures do not stop audio, but URL failures still fail playback', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.lyric.mockRejectedValue(new Error('lyric timeout'));
    mocks.colors.mockRejectedValue(new Error('cover timeout'));
    const store = usePlayerCoreStore();
    expect(await store.handlePlayMusic(track(5))).toBe(true);
    mocks.detail.mockRejectedValueOnce(new Error('URL timeout'));
    expect(await store.handlePlayMusic(track(6))).toBe(false);
    expect(mocks.play).toHaveBeenCalledOnce();
    expect(store.isPlay).toBe(false);
  });
});
