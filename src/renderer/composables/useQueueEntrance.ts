import { onBeforeUnmount } from 'vue';

import { animateQueueEntrance } from '@/utils/queueEntrance';

export function useQueueEntrance() {
  let cleanup: (() => void) | undefined;
  function stop() {
    cleanup?.();
    cleanup = undefined;
  }
  function start(viewport: HTMLElement | null, selector: string) {
    stop();
    if (viewport) cleanup = animateQueueEntrance(viewport, selector);
  }
  onBeforeUnmount(stop);
  return { start, stop };
}
