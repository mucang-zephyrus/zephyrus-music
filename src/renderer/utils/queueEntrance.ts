/** 只对开场时可见的歌曲做逐行入场，层级独立于列表 FLIP 和拖拽位移。 */
export function animateQueueEntrance(viewport: HTMLElement, selector: string): () => void {
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (motion.matches) return () => {};

  const bounds = viewport.getBoundingClientRect();
  if (bounds.height <= 0) return () => {};
  const rows = Array.from(viewport.querySelectorAll<HTMLElement>(selector)).filter((row) => {
    const rect = row.getBoundingClientRect();
    return rect.height > 0 && rect.bottom > bounds.top && rect.top < bounds.bottom;
  });
  const animations = new Map<HTMLElement, Animation>();
  let interrupted = false;

  // 临界阻尼的弹簧采样：逐行舒展、收稳，无额外回弹。
  const frames = Array.from({ length: 31 }, (_, i) => {
    const t = i / 30;
    const remainder = i === 30 ? 0 : (1 + 9 * t) * Math.exp(-9 * t);
    return {
      offset: t,
      transform: `translate3d(${12 * remainder}px, ${40 * remainder}px, 0)`,
      opacity: 1 - remainder
    };
  });

  function track(row: HTMLElement, animation: Animation) {
    animations.set(row, animation);
    animation.onfinish = () => {
      if (animations.get(row) === animation) animations.delete(row);
      animation.cancel();
    };
  }

  rows.forEach((row, index) => {
    if (typeof row.animate !== 'function') return;
    track(
      row,
      row.animate(frames, {
        duration: 620,
        delay: Math.min(index * 32, 192),
        fill: 'backwards',
        easing: 'linear'
      })
    );
  });

  // 用户触摸/滚动时从实时画面迅速收稳，取消后续排队，不等待入场结束。
  function settle() {
    if (interrupted) return;
    interrupted = true;
    for (const [row, animation] of animations) {
      const style = getComputedStyle(row);
      const from = { transform: style.transform, opacity: style.opacity };
      animation.cancel();
      track(
        row,
        row.animate([from, { transform: 'translate3d(0, 0, 0)', opacity: 1 }], {
          duration: 120,
          easing: 'ease-out'
        })
      );
    }
  }

  function stop() {
    animations.forEach((animation) => animation.cancel());
    animations.clear();
    viewport.removeEventListener('pointerdown', settle, true);
    viewport.removeEventListener('wheel', settle);
    motion.removeEventListener('change', stop);
  }

  viewport.addEventListener('pointerdown', settle, { capture: true, passive: true });
  viewport.addEventListener('wheel', settle, { passive: true });
  motion.addEventListener('change', stop);
  return stop;
}
