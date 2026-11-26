import { describe, expect, it, vi } from 'vitest';

import {
  NeteaseListenTracker,
  NeteaseReportGate,
  neteaseReportSongId
} from '@/services/neteaseListenTracker';
import type { SongResult } from '@/types/music';

const sound = {};
const otherSound = {};
const sample = (seconds: number, position = seconds, extra = {}) => ({
  sound,
  songId: 1,
  position,
  duration: 180,
  playing: true,
  rate: 1,
  now: seconds * 1000,
  ...extra
});

function setup() {
  const send = vi.fn();
  const tracker = new NeteaseListenTracker(send);
  return { tracker, send };
}

describe('NetEase listening rounds', () => {
  it.each([29, 30])('settles a %ss play once', (seconds) => {
    const { tracker, send } = setup();
    for (let i = 0; i <= seconds; i++) tracker.sample(sample(i));
    expect(send).not.toHaveBeenCalled();
    tracker.finish();
    tracker.finish();
    expect(send).toHaveBeenCalledTimes(seconds === 30 ? 1 : 0);
    if (seconds === 30) expect(send).toHaveBeenCalledWith({ id: 1, time: 30, total: 180 });
  });

  it('excludes paused time, a small explicit seek, and an unobserved interval', () => {
    const { tracker, send } = setup();
    for (let i = 0; i <= 20; i++) tracker.sample(sample(i));
    tracker.sample(sample(20.25, 20.35), true);
    tracker.sample(sample(20.5, 20.35, { playing: false }));
    tracker.sample(sample(60, 20.35));
    tracker.sample(sample(65, 25.35));
    for (let i = 1; i <= 9; i++) tracker.sample(sample(65 + i, 25.35 + i));
    tracker.finish();
    expect(send).not.toHaveBeenCalled();
  });

  it('uses wall time for qualification and reports accumulated media time', () => {
    const { tracker, send } = setup();
    for (let i = 0; i <= 30; i++) tracker.sample(sample(i, i * 2, { rate: 2 }));
    tracker.sample(sample(31, 0, { sound: otherSound, songId: 2 }));
    expect(send).toHaveBeenCalledExactlyOnceWith({ id: 1, time: 60, total: 180 });
  });

  it('keeps a source replacement at the same position and settles on replay', () => {
    const { tracker, send } = setup();
    for (let i = 0; i <= 20; i++) tracker.sample(sample(i));
    for (let i = 20; i <= 30; i++) tracker.sample(sample(i, i, { sound: otherSound }));
    tracker.sample(sample(31, 0, { sound: otherSound }), true);
    tracker.sample(null);
    expect(send).toHaveBeenCalledExactlyOnceWith({ id: 1, time: 30, total: 180 });
  });

  it('discards elapsed time on reset, such as opt-out or account change', () => {
    const { tracker, send } = setup();
    for (let i = 0; i <= 35; i++) tracker.sample(sample(i));
    tracker.reset();
    for (let i = 35; i <= 40; i++) tracker.sample(sample(i));
    tracker.finish();
    expect(send).not.toHaveBeenCalled();
  });

  it('accepts only valid NetEase catalog tracks', () => {
    const id = (track: object) => neteaseReportSongId({ id: 123, ...track } as SongResult);
    expect(id({})).toBe(123);
    expect(id({ platform: 'netease', id: '123' })).toBe(123);
    for (const track of [
      { id: 0 },
      { id: '1e3' },
      { platform: 'qq' },
      { program: {} },
      { pc: {} },
      { simpleSong: {} },
      { playMusicUrl: 'local://sample' }
    ]) {
      expect(id(track)).toBeNull();
    }
  });
});

describe('NetEase report limiter', () => {
  it('limits in-flight writes, throttles failures and never retries', async () => {
    const gate = new NeteaseReportGate();
    let resolve = () => {};
    const send = vi.fn(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        })
    );
    const first = gate.submit(0, send);
    const failed = vi.fn().mockRejectedValue(new Error());
    await gate.submit(6000, failed);
    resolve();
    await first;
    await gate.submit(4000, failed);
    expect(failed).not.toHaveBeenCalled();
    await gate.submit(6000, failed);
    expect(failed).toHaveBeenCalledTimes(1);
  });

  it('limits writes to 60 within a rolling hour', async () => {
    const gate = new NeteaseReportGate();
    const send = vi.fn();
    for (let i = 0; i <= 60; i++) await gate.submit(i * 5000, send);
    expect(send).toHaveBeenCalledTimes(60);
    await gate.submit(3_600_000, send);
    expect(send).toHaveBeenCalledTimes(61);
  });
});
