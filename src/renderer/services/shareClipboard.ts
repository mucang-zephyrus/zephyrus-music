import { extractMusicShareUrls } from '../../shared/musicShareLink.mjs';

interface ShareClipboardOptions {
  onText: (text: string) => void | Promise<unknown>;
  readText?: () => Promise<string>;
  canRead?: () => Promise<boolean>;
}

/** Foreground only. Automatic web reads never trigger a clipboard permission prompt. */
export function startShareClipboardMonitor(options: ShareClipboardOptions) {
  let stopped = false,
    reading = false,
    lastText = '';
  const accept = (text: string) => {
    if (stopped || text === lastText) return;
    lastText = text;
    if (extractMusicShareUrls(text).length)
      void Promise.resolve(options.onText(text)).catch(() => {});
  };
  const read = options.readText || (() => navigator.clipboard.readText());
  const canRead =
    options.canRead ||
    (async () => {
      try {
        const permission = await navigator.permissions.query({
          name: 'clipboard-read' as PermissionName
        });
        return permission.state === 'granted';
      } catch {
        return false;
      }
    });
  const check = async () => {
    if (stopped || reading || document.hidden || !document.hasFocus()) return;
    reading = true;
    try {
      if (await canRead()) {
        const text = await read();
        if (!document.hidden && document.hasFocus()) accept(text);
      }
    } catch {
      /* Denied or unavailable: explicit paste remains usable. */
    } finally {
      reading = false;
    }
  };
  const paste = (event: ClipboardEvent) => {
    // Import dialog owns its textarea so text can be reviewed before resolving.
    if ((event.target as Element | null)?.closest?.('[data-share-import]')) return;
    accept(event.clipboardData?.getData('text/plain') || '');
  };
  window.addEventListener('paste', paste);
  window.addEventListener('focus', check);
  document.addEventListener('visibilitychange', check);
  const timer = window.setInterval(check, 4000);
  void check();
  return () => {
    stopped = true;
    clearInterval(timer);
    window.removeEventListener('paste', paste);
    window.removeEventListener('focus', check);
    document.removeEventListener('visibilitychange', check);
  };
}
