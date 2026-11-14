import { beforeEach, describe, expect, it, vi } from 'vitest';

const values = new Map<string, unknown>();
function installDatabase() {
  const database = {
    objectStoreNames: { contains: () => true },
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
          }
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
        onerror: null,
        onblocked: null,
        onupgradeneeded: null
      };
      queueMicrotask(() => request.onsuccess?.());
      return request;
    }
  });
}
beforeEach(() => {
  values.clear();
  vi.resetModules();
  installDatabase();
});
const lyric = {
  lrcArray: [{ text: 'Hello（你好）', trText: '', startTime: 1000 }],
  lrcTimeArray: [1]
};

describe('provider lyric cache migration', () => {
  it('invalidates old automatic caches and marks their snapshot irreversible', async () => {
    values.set('netease:1', { schemaVersion: 1, cachedAt: Date.now(), lyric });
    const { readProviderLyricCache } = await import('../../src/renderer/api/providerLyricCache');
    const entry = await readProviderLyricCache('netease:1');
    expect(entry?.fresh).toBe(false);
    expect(entry?.lyric.legacyProcessed).toBe(true);
    expect(entry?.lyric.rawSchemaVersion).toBeUndefined();
  });
  it('keeps a legacy manual selection and snapshot instead of dropping it', async () => {
    values.set('manual:netease:1', { schemaVersion: 1, cachedAt: Date.now(), lyric });
    const { readProviderLyricCache } = await import('../../src/renderer/api/providerLyricCache');
    expect((await readProviderLyricCache('manual:netease:1'))?.lyric.lrcArray).toEqual(
      lyric.lrcArray
    );
  });
  it('stores new raw lyrics and stable source identity without merging cache contents', async () => {
    const { readProviderLyricCache, writeProviderLyricCache } =
      await import('../../src/renderer/api/providerLyricCache');
    await writeProviderLyricCache('netease:1', {
      ...lyric,
      rawSchemaVersion: 2,
      sourceId: 'netease:1'
    });
    const entry = await readProviderLyricCache('netease:1');
    expect(entry?.fresh).toBe(true);
    expect(entry?.lyric.sourceId).toBe('netease:1');
    expect(entry?.lyric.lrcArray[0].text).toBe('Hello（你好）');
  });
});
