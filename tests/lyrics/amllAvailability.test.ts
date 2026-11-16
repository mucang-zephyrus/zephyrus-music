import { DOMParser as XmlDomParser } from '@xmldom/xmldom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const OWNED = 'https://lyrics.example/ttml';
const XML =
  '<tt xmlns="http://www.w3.org/ns/ttml"><body><div><p begin="1s" end="3s">Test line</p></div></body></tt>';
const values = new Map<string, unknown>();

function installDatabase(blocked = false) {
  const database = {
    objectStoreNames: { contains: () => true },
    close: vi.fn(),
    transaction: () => {
      const transaction = {
        oncomplete: null as null | (() => void),
        onerror: null,
        objectStore: () => ({
          get: (key: string) => {
            const request = {
              result: values.get(key),
              onsuccess: null as null | (() => void),
              onerror: null
            };
            queueMicrotask(() => request.onsuccess?.());
            return request;
          },
          put: (value: unknown, key: string) => {
            values.set(key, value);
            queueMicrotask(() => transaction.oncomplete?.());
          },
          delete: (key: string) => values.delete(key)
        })
      };
      return transaction;
    }
  };
  vi.stubGlobal('indexedDB', {
    open: () => {
      const request = {
        result: database,
        onsuccess: null as null | (() => void),
        onblocked: null as null | (() => void),
        onerror: null
      };
      queueMicrotask(() => (blocked ? request.onblocked?.() : request.onsuccess?.()));
      return request;
    }
  });
}

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.stubEnv('VITE_TTML_DB_BASE_URL', OWNED);
  vi.stubGlobal('DOMParser', XmlDomParser);
  values.clear();
  installDatabase();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('TTML availability', () => {
  it('accepts an owned lyric that takes three seconds to arrive', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        if (!url.startsWith(OWNED)) return Promise.resolve(new Response('', { status: 404 }));
        return new Promise<Response>((resolve, reject) => {
          const timer = setTimeout(() => resolve(new Response(XML)), 3000);
          init?.signal?.addEventListener(
            'abort',
            () => {
              clearTimeout(timer);
              reject(new DOMException('Aborted', 'AbortError'));
            },
            { once: true }
          );
        });
      })
    );
    const { getAmllLyric } = await import('@/api/amllLyrics');
    const pending = getAmllLyric('29713329');
    await vi.advanceTimersByTimeAsync(3100);
    expect((await pending)?.source).toBe(`${OWNED}/ncm-lyrics/29713329.ttml`);
  });

  it('retries a temporary owned-server failure before falling back', async () => {
    let attempts = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (!url.startsWith(OWNED)) return new Response('', { status: 404 });
        return ++attempts === 1 ? new Response('', { status: 503 }) : new Response(XML);
      })
    );
    const { getAmllLyric } = await import('@/api/amllLyrics');
    const pending = getAmllLyric('29713329');
    await vi.runAllTimersAsync();
    expect((await pending)?.lines).toHaveLength(1);
    expect(attempts).toBe(2);
  });

  it('shares a pending request for the same lyric', async () => {
    const fetcher = vi.fn(async () => new Response(XML));
    vi.stubGlobal('fetch', fetcher);
    const { getAmllLyric } = await import('@/api/amllLyrics');
    const [left, right] = await Promise.all([getAmllLyric('42'), getAmllLyric('42')]);
    expect(left?.lines).toHaveLength(1);
    expect(right).toEqual(left);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('uses the last successful cloud TTML after an expired-cache network failure', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(XML));
    vi.stubGlobal('fetch', fetcher);
    const { getAmllLyric } = await import('@/api/amllLyrics');
    const original = await getAmllLyric('cloud-1', 'server', 'https://songs.example/one.ttml');
    vi.setSystemTime(Date.now() + 2 * 24 * 60 * 60 * 1000);
    fetcher.mockRejectedValue(new TypeError('offline'));
    expect(await getAmllLyric('cloud-1', 'server', 'https://songs.example/one.ttml')).toEqual(
      original
    );
  });

  it('loads a changed cloud lyrics URL instead of returning the previous file', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(XML))
    );
    const { getAmllLyric } = await import('@/api/amllLyrics');
    await getAmllLyric('cloud-1', 'server', 'https://songs.example/one.ttml');
    const updated = await getAmllLyric('cloud-1', 'server', 'https://songs.example/two.ttml');
    expect(updated?.source).toBe('https://songs.example/two.ttml');
  });

  it('continues fetching when IndexedDB is blocked by another tab', async () => {
    installDatabase(true);
    const fetcher = vi.fn(async () => new Response(XML));
    vi.stubGlobal('fetch', fetcher);
    const { getAmllLyric } = await import('@/api/amllLyrics');
    void getAmllLyric('42');
    await vi.advanceTimersByTimeAsync(1500);
    expect(fetcher).toHaveBeenCalled();
  });

  it('recognizes a restored cloud entry from its namespaced ID', async () => {
    const { resolveAmllSource } = await import('@/api/amllLyrics');
    expect(resolveAmllSource({ id: 'server:cloud-1' })).toEqual({
      platform: 'server',
      songId: 'cloud-1'
    });
  });
});
