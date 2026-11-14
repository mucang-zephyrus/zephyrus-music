import { computed, type Ref, ref, watch } from 'vue';

/** Mount AMLL only inside a visible, measurable viewport, with a fresh height cache. */
export function useMeasuredLyricMount(ready: () => boolean, root: Ref<HTMLElement | null>) {
  const mounted = ref(false);
  const pending = computed(() => ready() && !mounted.value);

  watch(
    [ready, root],
    ([allowed, element], _, onCleanup) => {
      mounted.value = false;
      if (!allowed || !element) return;

      let frame = 0;
      let disposed = false;
      const scheduleMount = () => {
        if (disposed || mounted.value || frame) return;
        // Let the host remove display:none before constructing AMLL's layout.
        frame = requestAnimationFrame(() => {
          frame = 0;
          if (disposed || !ready()) return;
          const rect = element.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) return;
          mounted.value = true;
          observer.disconnect();
        });
      };
      // An ancestor may stay hidden after active=true. Wait for its real size
      // instead of mounting at zero height or polling every animation frame.
      const observer = new ResizeObserver(scheduleMount);
      observer.observe(element);
      scheduleMount();

      onCleanup(() => {
        disposed = true;
        if (frame) cancelAnimationFrame(frame);
        observer.disconnect();
      });
    },
    { immediate: true, flush: 'post' }
  );

  return { mounted, pending };
}
