import { afterEach, describe, expect, it, vi } from 'vitest';

import { animateQueueEntrance } from '@/utils/queueEntrance';

function fixture(reduced = false) {
  const motion = new EventTarget();
  Object.assign(motion, { matches: reduced });
  vi.stubGlobal('matchMedia', () => motion);
  const viewport = document.createElement('div');
  viewport.getBoundingClientRect = () => new DOMRect(0, 0, 400, 640);
  const rows = Array.from({ length: 40 }, (_, i) => {
    const row = document.createElement('div');
    row.className = 'row';
    // Opening at song 20: stagger must start from the first visible row, not playlist index.
    row.getBoundingClientRect = () => new DOMRect(0, (i - 20) * 64, 400, 64);
    row.animate = vi.fn(() => ({ cancel: vi.fn(), onfinish: null }) as unknown as Animation);
    viewport.append(row);
    return row;
  });
  return { viewport, rows, motion };
}

afterEach(() => vi.unstubAllGlobals());

describe('queue entrance', () => {
  it('animates only visible rows with a bounded delay independent of playlist index', () => {
    const { viewport, rows } = fixture();
    const stop = animateQueueEntrance(viewport, '.row');
    expect(rows[19].animate).not.toHaveBeenCalled();
    expect(rows[30].animate).not.toHaveBeenCalled();
    expect(rows[20].animate).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ delay: 0 })
    );
    expect(rows[29].animate).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({ delay: 192 })
    );
    stop();
  });

  it('settles from the current display on interaction, then cleans up on close', () => {
    const { viewport, rows } = fixture();
    const stop = animateQueueEntrance(viewport, '.row');
    const first = vi.mocked(rows[20].animate).mock.results[0].value;
    viewport.dispatchEvent(new Event('pointerdown'));
    expect(first.cancel).toHaveBeenCalledOnce();
    expect(rows[20].animate).toHaveBeenCalledTimes(2);
    const settling = vi.mocked(rows[20].animate).mock.results[1].value;
    stop();
    expect(settling.cancel).toHaveBeenCalledOnce();
    viewport.dispatchEvent(new Event('wheel'));
    expect(rows[20].animate).toHaveBeenCalledTimes(2);
  });

  it('respects reduced motion initially and when the preference changes', () => {
    const reduced = fixture(true);
    animateQueueEntrance(reduced.viewport, '.row')();
    expect(reduced.rows[20].animate).not.toHaveBeenCalled();
    const { viewport, rows, motion } = fixture();
    const stop = animateQueueEntrance(viewport, '.row');
    motion.dispatchEvent(new Event('change'));
    expect(vi.mocked(rows[20].animate).mock.results[0].value.cancel).toHaveBeenCalledOnce();
    stop();
  });
});
