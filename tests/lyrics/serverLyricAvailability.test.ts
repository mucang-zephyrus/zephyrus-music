import { DOMParser as XmlDomParser } from '@xmldom/xmldom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ILyric, SongResult } from '@/types/music';

const state = vi.hoisted(() => ({
  metadata: vi.fn(),
  values: new Map<string, { lyric: ILyric; fresh: boolean }>()
}));
vi.mock('@/api/serverSongs', () => ({ getServerSongMetadata: state.metadata }));
vi.mock('@/api/providerLyricCache', () => ({
  readProviderLyricCache: async (key: string) => state.values.get(key) || null,
  writeProviderLyricCache: async (key: string, lyric: ILyric) => {
    state.values.set(key, { lyric, fresh: true });
  }
}));

beforeEach(() => {
  vi.resetModules();
  state.values.clear();
  state.metadata.mockReset();
  vi.stubGlobal('DOMParser', XmlDomParser);
});
afterEach(() => vi.unstubAllGlobals());

describe('cloud lyric availability', () => {
  it('recovers a legacy saved cloud ID and retries a temporary LRC failure', async () => {
    state.metadata.mockResolvedValue({ id: 'one', lyricsUrl: 'https://songs.example/one.lrc' });
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(new Response('[00:01.00]Test line'));
    vi.stubGlobal('fetch', fetcher);
    const { loadServerLyric } = await import('@/api/serverLyrics');
    const result = await loadServerLyric({ id: 'server:one' } as SongResult);
    expect(state.metadata).toHaveBeenCalledWith('one');
    expect(result.lrcArray[0].text).toBe('Test line');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('keeps an expired successful LRC cache when the network is unavailable', async () => {
    state.metadata.mockResolvedValue({ id: 'one', lyricsUrl: 'https://songs.example/one.lrc' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('[00:01.00]Test line'))
    );
    const { loadServerLyric } = await import('@/api/serverLyrics');
    const song = { id: 'server:one' } as SongResult;
    const original = await loadServerLyric(song);
    for (const entry of state.values.values()) entry.fresh = false;
    vi.mocked(fetch).mockRejectedValue(new TypeError('offline'));
    expect(await loadServerLyric(song)).toEqual(original);
  });

  it('provides parsed TTML as a fallback even with a query string in the URL', async () => {
    state.metadata.mockResolvedValue({
      id: 'one',
      lyricsUrl: 'https://songs.example/one.ttml?revision=2'
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            '<tt xmlns="http://www.w3.org/ns/ttml"><body><div><p begin="1s" end="3s"><span begin="1s" end="2s">Test</span><span begin="2s" end="3s"> line</span></p></div></body></tt>'
          )
      )
    );
    const { loadServerLyric } = await import('@/api/serverLyrics');
    const result = await loadServerLyric({ id: 'server:one' } as SongResult);
    expect(result.format).toBe('ttml');
    expect(result.hasWordByWord).toBe(true);
    expect(result.lrcTimeArray).toEqual([1]);
  });

  it('uses saved lyrics URL when the cloud catalogue is temporarily unavailable', async () => {
    state.metadata.mockRejectedValue(new TypeError('offline'));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('[00:01.00]Saved link'))
    );
    const { loadServerLyric } = await import('@/api/serverLyrics');
    const result = await loadServerLyric({
      id: 'server:one',
      lyricsUrl: 'https://songs.example/one.lrc'
    } as SongResult);
    expect(result.lrcArray[0].text).toBe('Saved link');
  });

  it('restores the direct TTML URL for old saved cloud entries', async () => {
    state.metadata.mockResolvedValue({ id: 'one', lyricsUrl: 'https://songs.example/one.ttml' });
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            '<tt xmlns="http://www.w3.org/ns/ttml"><body><div><p begin="1s" end="3s">Test</p></div></body></tt>'
          )
      )
    );
    const { getAmllLyricForSong } = await import('@/api/amllLyrics');
    const result = await getAmllLyricForSong({ id: 'server:one' });
    expect(result?.source).toBe('https://songs.example/one.ttml');
    expect(result?.lines).toHaveLength(1);
  });
});
