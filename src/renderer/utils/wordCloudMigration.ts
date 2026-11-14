/** Idempotent storage projection; callers retain ownership of persistence. */
export function migrateWordCloudSettings<T extends Record<string, any>>(saved: T): T {
  const result: Record<string, any> = { ...saved };
  if (result.playerStyle === 'frenzy') result.playerStyle = 'wordCloud';
  if (result.wordCloudMigration === 1) return result as T;
  const configs = { ...(result.styleCustomConfig || {}) };
  const old = configs.frenzy;
  if (old && !configs.wordCloud) {
    const next: Record<string, unknown> = { mode: old.mode === 'custom' ? 'custom' : 'original' };
    for (const key of [
      'builtinFontId',
      'customFontFamily',
      'customFontName',
      'customFontData',
      'fontWeight'
    ]) {
      if (old[key] !== undefined) next[key] = old[key];
    }
    configs.wordCloud = next;
  }
  return { ...result, styleCustomConfig: configs, wordCloudMigration: 1 } as unknown as T;
}
