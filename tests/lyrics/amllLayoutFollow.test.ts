import type { LyricPlayer } from '@applemusic-like-lyrics/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { followAmllLayout } from '@/utils/amllLayoutFollow';

describe('AMLL container layout following', () => {
  let frames: Map<number, FrameRequestCallback>;
  let nextFrame: number;
  const paint = () => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((callback) => callback(performance.now()));
  };
  const createPlayer = () => ({
    calcLayout: vi.fn<LyricPlayer['calcLayout']>(),
    update: vi.fn<LyricPlayer['update']>()
  });

  beforeEach(() => {
    frames = new Map();
    nextFrame = 0;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.set(++nextFrame, callback);
      return nextFrame;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('synchronizes only resize layout on the active instance, preserving other motion', () => {
    const player = createPlayer();
    const other = createPlayer();
    const original = player.calcLayout;
    const controller = followAmllLayout(player);
    controller.setFollowing(true);

    player.calcLayout('resize');
    expect(original).toHaveBeenLastCalledWith('continuous-scroll');
    expect(original.mock.contexts.at(-1)).toBe(player);
    expect(player.update).toHaveBeenCalledExactlyOnceWith(0);
    for (const reason of ['playback-tick', 'seek', 'config-change', 'discrete-scroll'] as const) {
      player.calcLayout(reason);
      expect(original).toHaveBeenLastCalledWith(reason);
    }
    expect(player.update).toHaveBeenCalledTimes(1);
    other.calcLayout('resize');
    expect(other.calcLayout).toHaveBeenLastCalledWith('resize');

    controller.dispose();
    expect(player.calcLayout).toBe(original);
  });

  it('includes the final resize notification before returning to normal layout', () => {
    const player = createPlayer();
    const original = player.calcLayout;
    const controller = followAmllLayout(player);
    player.calcLayout('resize');
    expect(original).toHaveBeenLastCalledWith('resize');

    controller.setFollowing(true);
    controller.setFollowing(false);
    player.calcLayout('resize');
    expect(original).toHaveBeenLastCalledWith('continuous-scroll');
    paint();
    player.calcLayout('resize');
    expect(original).toHaveBeenLastCalledWith('continuous-scroll');
    paint();
    player.calcLayout('resize');
    expect(original).toHaveBeenLastCalledWith('resize');
    controller.dispose();
  });

  it('keeps following when a new gesture interrupts the pending release', () => {
    const player = createPlayer();
    const original = player.calcLayout;
    const controller = followAmllLayout(player);
    controller.setFollowing(true);
    controller.setFollowing(false);
    paint();
    controller.setFollowing(true);
    paint();
    paint();
    player.calcLayout('resize');
    expect(original).toHaveBeenLastCalledWith('continuous-scroll');

    controller.setFollowing(false);
    controller.dispose();
    expect(frames.size).toBe(0);
    expect(player.calcLayout).toBe(original);
  });
});
