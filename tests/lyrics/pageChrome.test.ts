import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearPageChromeCache,
  fallbackPageChrome,
  getPageChromeForCover,
  pageChromeVariables,
  resolvePageChrome
} from '@/utils/pageChrome';

vi.mock('@/utils/linearColor', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/linearColor')>()),
  getImageLinearBackground: vi.fn(async () => ({
    backgroundColor: 'linear-gradient(#333, #222)',
    primaryColor: 'rgb(30, 30, 34)'
  }))
}));

import { getImageLinearBackground } from '@/utils/linearColor';

describe('resolvePageChrome', () => {
  it('mixes dark covers with black and keeps light ink', () => {
    const chrome = resolvePageChrome({ r: 30, g: 30, b: 34 });

    expect(chrome.ink).toBe('light');
    // 黑混主色 34%：30*0.34 = 10.2 → 10
    expect(chrome.background).toBe('rgb(10, 10, 12)');
    expect(chrome.inkRgb).toBe('255, 255, 255');
  });

  it('mirrors light covers with white mixing and dark ink', () => {
    const chrome = resolvePageChrome({ r: 240, g: 230, b: 220 });

    expect(chrome.ink).toBe('dark');
    // 白混主色 22%：255*0.78 + 240*0.22 = 251.7 → 252
    expect(chrome.background).toBe('rgb(252, 250, 247)');
    expect(chrome.inkRgb).toBe('23, 23, 26');
  });

  it('exposes css variables consistent with the chrome', () => {
    const vars = pageChromeVariables(fallbackPageChrome());

    expect(vars['--page-chrome-bg']).toBeTruthy();
    expect(vars['--page-chrome-ink-rgb']).toMatch(/^\d+, \d+, \d+$/);
    expect(['#17171a', '#ffffff']).toContain(vars['--page-chrome-ink']);
  });
});

describe('getPageChromeForCover', () => {
  beforeEach(() => {
    clearPageChromeCache();
    vi.mocked(getImageLinearBackground).mockClear();
  });

  it('caches chrome per cover url', async () => {
    const first = await getPageChromeForCover('https://img.example/cover-a');
    const second = await getPageChromeForCover('https://img.example/cover-a');

    expect(first).toBe(second);
    expect(getImageLinearBackground).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['T001', '001UeB5t0QikN1'],
    ['T002', '0034iwRd2KpQBu']
  ])('samples standard QQ %s art through the gateway', async (type, mid) => {
    await getPageChromeForCover(
      `https://y.gtimg.cn/music/photo_new/${type}R500x500M000${mid}.jpg?n=1`
    );
    expect(getImageLinearBackground).toHaveBeenCalledWith(
      expect.stringContaining(`/platform/qq/cover-sample?type=${type}&mid=${mid}`)
    );
  });

  it.each(['muted', 'vivid'] as const)(
    'skips pixel reads for QQ album art (%s)',
    async (strategy) => {
      expect(await getPageChromeForCover('https://y.gtimg.cn/music/cover.jpg', strategy)).toEqual(
        fallbackPageChrome(strategy)
      );
      expect(getImageLinearBackground).not.toHaveBeenCalled();
    }
  );

  it('falls back gracefully when color extraction fails', async () => {
    vi.mocked(getImageLinearBackground).mockRejectedValueOnce(new Error('cors'));

    const chrome = await getPageChromeForCover('https://img.example/broken');

    expect(chrome).toEqual(fallbackPageChrome());
  });
});
