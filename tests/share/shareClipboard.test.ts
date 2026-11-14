import { afterEach, describe, expect, it, vi } from 'vitest';

import { startShareClipboardMonitor } from '@/services/shareClipboard';

const url = 'https://163cn.tv/bku4CHzS';
const cleanups: (() => void)[] = [];
afterEach(() => {
  cleanups.splice(0).forEach((stop) => stop());
  vi.restoreAllMocks();
  vi.useRealTimers();
});
const flush = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};

describe('foreground share clipboard monitor', () => {
  it('reads granted foreground content once and re-detects after clipboard changes', async () => {
    vi.useFakeTimers();
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    let text = url;
    const readText = vi.fn(async () => text),
      onText = vi.fn();
    cleanups.push(startShareClipboardMonitor({ readText, onText, canRead: async () => true }));
    await flush();
    expect(onText).toHaveBeenCalledExactlyOnceWith(url);
    await vi.advanceTimersByTimeAsync(4000);
    expect(onText).toHaveBeenCalledTimes(1);
    text = 'ordinary text';
    await vi.advanceTimersByTimeAsync(4000);
    text = url;
    await vi.advanceTimersByTimeAsync(4000);
    expect(onText).toHaveBeenCalledTimes(2);
  });
  it('never auto-reads without permission and still accepts an explicit paste', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    const readText = vi.fn(),
      onText = vi.fn();
    cleanups.push(startShareClipboardMonitor({ readText, onText, canRead: async () => false }));
    await flush();
    expect(readText).not.toHaveBeenCalled();
    const clipboardData = new DataTransfer();
    clipboardData.setData('text/plain', `share ${url}`);
    window.dispatchEvent(new ClipboardEvent('paste', { clipboardData }));
    expect(onText).toHaveBeenCalledExactlyOnceWith(`share ${url}`);
  });
  it('does not read in background, dispatch after stop, or consume import textareas', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    const readText = vi.fn(async () => url),
      onText = vi.fn();
    const stop = startShareClipboardMonitor({ readText, onText, canRead: async () => true });
    cleanups.push(stop);
    await flush();
    expect(readText).not.toHaveBeenCalled();
    const textarea = document.createElement('textarea');
    textarea.setAttribute('data-share-import', '');
    document.body.append(textarea);
    const clipboardData = new DataTransfer();
    clipboardData.setData('text/plain', url);
    textarea.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true }));
    expect(onText).not.toHaveBeenCalled();
    textarea.remove();
    stop();
    window.dispatchEvent(new ClipboardEvent('paste', { clipboardData }));
    expect(onText).not.toHaveBeenCalled();
  });
  it('drops a pending clipboard read when monitoring is disposed', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    let resolve!: (text: string) => void;
    const onText = vi.fn();
    const stop = startShareClipboardMonitor({
      readText: () =>
        new Promise<string>((done) => {
          resolve = done;
        }),
      onText,
      canRead: async () => true
    });
    cleanups.push(stop);
    await flush();
    stop();
    resolve(url);
    await flush();
    expect(onText).not.toHaveBeenCalled();
  });
});
