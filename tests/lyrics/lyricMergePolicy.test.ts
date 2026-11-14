import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ILyric, SongResult } from '../../src/renderer/types/music';
import { createLyricDisplayPipeline } from '../../src/renderer/utils/lyricDisplayPipeline';
import { normalizeLyricForDisplay } from '../../src/renderer/utils/normalizeLyricForDisplay';

const song = { id: 42, name: 'Test song', ar: [{ name: 'Artist' }] } as SongResult;
const raw: ILyric = {
  rawSchemaVersion: 2,
  sourceId: 'community:8',
  lrcTimeArray: [1],
  lrcArray: [{ text: 'Hello（你好）', trText: '', startTime: 1000 }]
};
beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
});

describe('source-scoped merge preferences and feedback', () => {
  it('persists disable/restore by song platform, ID and actual lyric source', async () => {
    const policy = await import('../../src/renderer/services/lyricMergePolicy');
    const key = policy.lyricSongKey(song);
    expect(policy.setLyricMergeEnabled(key, 'community:8', false)).toBe(true);
    expect(policy.isLyricMergeEnabled(key, 'community:8')).toBe(false);
    expect(policy.isLyricMergeEnabled(key, 'community:9')).toBe(true);
    expect(
      policy.isLyricMergeEnabled(policy.lyricSongKey({ ...song, platform: 'qq' }), 'community:8')
    ).toBe(true);
    expect(
      policy.isLyricMergeEnabled(policy.lyricSongKey({ ...song, id: 43 }), 'community:8')
    ).toBe(true);
    vi.resetModules();
    const reloaded = await import('../../src/renderer/services/lyricMergePolicy');
    expect(reloaded.isLyricMergeEnabled(key, 'community:8')).toBe(false);
    expect(reloaded.setLyricMergeEnabled(key, 'community:8', true)).toBe(true);
    expect(reloaded.isLyricMergeEnabled(key, 'community:8')).toBe(true);
  });
  it('syncs decisions made in another window', async () => {
    const policy = await import('../../src/renderer/services/lyricMergePolicy');
    const key = policy.mergePreferenceKey(policy.lyricSongKey(song), 'community:8');
    localStorage.setItem('lyric-smart-merge-disabled-v1', JSON.stringify([key]));
    window.dispatchEvent(new StorageEvent('storage', { key: 'lyric-smart-merge-disabled-v1' }));
    expect(policy.isLyricMergeEnabled(policy.lyricSongKey(song), 'community:8')).toBe(false);
  });
  it('snapshots feedback on open and includes only bounded explicit diagnostics', async () => {
    const policy = await import('../../src/renderer/services/lyricMergePolicy');
    const result = normalizeLyricForDisplay(raw);
    const context = policy.createLyricMergeContext(song, raw, result.lyric, result.mergeInfo);
    policy.openLyricMergeFeedback(context);
    context.songName = 'New song';
    context.samples[0].before[0] = 'changed';
    policy.currentLyricMergeContext.value = null;
    expect(policy.lyricMergeFeedbackTarget.value?.songName).toBe('Test song');
    const info = JSON.parse(policy.lyricMergeDiagnostics(policy.lyricMergeFeedbackTarget.value!));
    expect(info.source).toBe('community:8');
    expect(info.algorithm).toBe('2.1.0');
    expect(info).not.toHaveProperty('lrcArray');
    expect(info.samples[0].before[0]).not.toBe('changed');
  });
  it('ignores malformed stored preferences', async () => {
    localStorage.setItem('lyric-smart-merge-disabled-v1', '{"bad":true}');
    const policy = await import('../../src/renderer/services/lyricMergePolicy');
    expect(policy.disabledLyricMerges.value).toEqual([]);
  });
});

describe('asynchronous lyric display pipeline', () => {
  it('drops old conversion results when the same ID gets new lyrics', async () => {
    const pipeline = createLyricDisplayPipeline();
    let finish!: (lines: ILyric['lrcArray']) => void;
    const first = pipeline.project(
      () => raw,
      () => ({}),
      (lines) =>
        new Promise((resolve) => {
          finish = () => resolve(lines);
        })
    );
    await Promise.resolve();
    const replacement = { ...raw, lrcArray: [{ ...raw.lrcArray[0], text: 'Goodbye（再见）' }] };
    const second = await pipeline.project(
      () => replacement,
      () => ({}),
      async (lines) => lines
    );
    finish([]);
    expect(await first).toBeNull();
    expect(second?.lyric.lrcArray[0].text).toBe('Goodbye');
  });
  it('drops an old raw parse when switching songs or clearing the player', async () => {
    const pipeline = createLyricDisplayPipeline();
    let finish!: (value: ILyric) => void;
    const first = pipeline.project(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
      () => ({}),
      async (lines) => lines
    );
    pipeline.invalidate();
    finish(raw);
    expect(await first).toBeNull();
  });
  it('recomputes raw data for disable/restore rather than stacking transformed snapshots', async () => {
    const pipeline = createLyricDisplayPipeline();
    const run = (enabled: boolean) =>
      pipeline.project(
        () => raw,
        () => ({ enabled }),
        async (lines) => lines
      );
    expect((await run(true))?.lyric.lrcArray[0].text).toBe('Hello');
    expect((await run(false))?.lyric.lrcArray[0].text).toBe('Hello（你好）');
    expect((await run(true))?.lyric.lrcArray[0].text).toBe('Hello');
    expect(raw.lrcArray[0].text).toBe('Hello（你好）');
  });
});
