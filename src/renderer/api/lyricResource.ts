const pending = new Map<string, Promise<string | null>>();

/** A blocked browser cache must not hold up the network request or lyric display. */
export async function withLyricCacheTimeout<T>(
  task: Promise<T>,
  fallback: T,
  timeoutMs = 500
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      task.catch(() => fallback),
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), timeoutMs);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Retry transient failures once; an absent file is a normal source miss. */
export function fetchLyricText(
  url: string,
  timeoutMs = 8000,
  retry = true
): Promise<string | null> {
  const key = `${timeoutMs}:${retry}:${url}`;
  const existing = pending.get(key);
  if (existing) return existing;
  const task = (async () => {
    for (let attempt = 0; attempt < (retry ? 2 : 1); attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(url, {
          signal: controller.signal,
          ...(attempt > 0 ? { cache: 'reload' as RequestCache } : {})
        });
        if (response.ok) return await response.text();
        if (response.status !== 408 && response.status !== 429 && response.status < 500)
          return null;
      } catch {
        // Timeout and network errors use the remaining attempt.
      } finally {
        clearTimeout(timer);
      }
    }
    return null;
  })().finally(() => pending.delete(key));
  pending.set(key, task);
  return task;
}
