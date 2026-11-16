import { createPinia, disposePinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick, reactive } from 'vue';

import type { TtmlLyric } from '@/services/ttmlParser';
import type { SongResult } from '@/types/music';

const state = vi.hoisted(() => ({ player: null as any, load: vi.fn() }));
vi.mock('@/store/modules/player', () => ({ usePlayerStore: () => state.player }));
vi.mock('@/api/amllLyrics', async (original) => ({
  ...(await original<typeof import('@/api/amllLyrics')>()),
  getAmllLyricForSong: state.load
}));

let pinia: ReturnType<typeof createPinia>;
beforeEach(() => {
  vi.resetModules();
  state.load.mockReset();
  state.player = reactive({ currentSong: null as SongResult | null });
  pinia = createPinia();
  setActivePinia(pinia);
});
afterEach(() => disposePinia(pinia));

describe('TTML request state', () => {
  it('keeps the pending load when song details replace the same track object', async () => {
    let finish!: (lyric: TtmlLyric) => void;
    state.load.mockImplementation(
      () =>
        new Promise<TtmlLyric>((resolve) => {
          finish = resolve;
        })
    );
    const { useAmllStore } = await import('@/store/modules/amll');
    state.player.currentSong = { id: 29713329, name: 'test', platform: 'netease' } as SongResult;
    const store = useAmllStore();
    const result = { lines: [{ text: 'test' }] } as TtmlLyric;
    state.player.currentSong = {
      ...state.player.currentSong,
      playMusicUrl: 'https://audio.example/test.mp3'
    };
    await nextTick();
    expect(state.load).toHaveBeenCalledTimes(1);
    finish(result);
    await vi.waitFor(() => expect(store.ttmlLyric).toEqual(result));
    expect(store.loading).toBe(false);
  });

  it('loads again when the same cloud track receives a lyrics URL', async () => {
    state.load.mockResolvedValue(null);
    const { useAmllStore } = await import('@/store/modules/amll');
    state.player.currentSong = {
      id: 'server:one',
      platform: 'server',
      platformId: 'one'
    } as SongResult;
    useAmllStore();
    await nextTick();
    state.player.currentSong.lyricsUrl = 'https://lyrics.example/one.ttml';
    await nextTick();
    expect(state.load).toHaveBeenCalledTimes(2);
  });

  it('ignores the previous track when it finishes after a song switch', async () => {
    let finishOld!: (lyric: TtmlLyric) => void;
    state.load.mockImplementationOnce(
      () =>
        new Promise<TtmlLyric>((resolve) => {
          finishOld = resolve;
        })
    );
    const next = { lines: [{ text: 'next' }] } as TtmlLyric;
    state.load.mockResolvedValueOnce(next);
    const { useAmllStore } = await import('@/store/modules/amll');
    state.player.currentSong = { id: 1 } as SongResult;
    const store = useAmllStore();
    state.player.currentSong = { id: 2 } as SongResult;
    await nextTick();
    finishOld({ lines: [{ text: 'old' }] } as TtmlLyric);
    await vi.waitFor(() => expect(store.ttmlLyric).toEqual(next));
  });

  it('retries a failed lyric on reselecting the same track or reconnecting', async () => {
    state.load.mockResolvedValue(null);
    const { useAmllStore } = await import('@/store/modules/amll');
    state.player.currentSong = { id: 1 } as SongResult;
    const store = useAmllStore();
    await vi.waitFor(() => expect(store.loading).toBe(false));
    state.player.currentSong = { id: 1 } as SongResult;
    await nextTick();
    await vi.waitFor(() => expect(store.loading).toBe(false));
    expect(state.load).toHaveBeenCalledTimes(2);
    window.dispatchEvent(new Event('online'));
    await vi.waitFor(() => expect(store.loading).toBe(false));
    expect(state.load).toHaveBeenCalledTimes(3);
  });
});
