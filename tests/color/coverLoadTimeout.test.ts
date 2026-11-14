import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getImageLinearBackground } from '@/utils/linearColor';

describe('cover extraction under slow networks', () => {
  let image: HTMLImageElement;
  beforeEach(() => {
    vi.useFakeTimers();
    image = document.createElement('img');
    vi.stubGlobal('Image', function () {
      return image;
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('unresponsive artwork falls back and releases its request after 2.5 seconds', async () => {
    const pending = getImageLinearBackground('https://slow.example/cover.jpg');
    await vi.advanceTimersByTimeAsync(2500);
    expect(await pending).toEqual({ backgroundColor: '', primaryColor: '' });
    expect(image.getAttribute('src')).toBeNull();
    expect(image.onload).toBeNull();
    expect(image.onerror).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('canvas CORS errors fall back instead of leaving the promise pending', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => {
      throw new DOMException('Tainted canvas', 'SecurityError');
    });
    const pending = getImageLinearBackground('https://no-cors.example/cover.jpg');
    image.dispatchEvent(new Event('load'));
    expect(await pending).toEqual({ backgroundColor: '', primaryColor: '' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('successful extraction keeps the original average color algorithm', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
      getImageData: () => ({ data: new Uint8ClampedArray([120, 60, 30, 255]) })
    } as unknown as CanvasRenderingContext2D);
    const pending = getImageLinearBackground('https://ok.example/cover.jpg');
    image.dispatchEvent(new Event('load'));
    expect((await pending).primaryColor).toBe('rgb(120,60,30)');
    expect(vi.getTimerCount()).toBe(0);
  });
});
