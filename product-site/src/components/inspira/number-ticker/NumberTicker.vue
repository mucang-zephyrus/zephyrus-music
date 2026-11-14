<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

import { cn } from '@/lib/cn';

/**
 * Inspira UI NumberTicker（拷贝自 unovue/inspira-ui，MIT）。
 * 仅调整：cn 指向本地实现；入场判定改为 IntersectionObserver 直实现
 * （原 @vueuse useElementVisibility 回调在本页不稳定），缓动保持 easeOutCubic。
 */
interface NumberTickerProps {
  value?: number;
  direction?: 'up' | 'down';
  duration?: number;
  delay?: number;
  decimalPlaces?: number;
  class?: string;
}

const props = withDefaults(defineProps<NumberTickerProps>(), {
  value: 0,
  direction: 'up',
  delay: 0,
  duration: 1000,
  decimalPlaces: 2
});

const spanRef = ref<HTMLSpanElement>();
const display = ref(props.direction === 'down' ? props.value : 0);
let started = false;
let frame = 0;
let observer: IntersectionObserver | null = null;

const output = computed(() => {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: props.decimalPlaces,
    maximumFractionDigits: props.decimalPlaces
  }).format(Number(display.value.toFixed(props.decimalPlaces)));
});

function start() {
  if (started) return;
  started = true;
  const from = props.direction === 'down' ? props.value : 0;
  const to = props.direction === 'down' ? 0 : props.value;
  const startedAt = performance.now() + props.delay;
  const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
  const frameFn = (now: number) => {
    const raw = (now - startedAt) / props.duration;
    if (raw < 0) {
      frame = requestAnimationFrame(frameFn);
      return;
    }
    const t = Math.min(1, raw);
    display.value = from + (to - from) * easeOutCubic(t);
    if (t < 1) frame = requestAnimationFrame(frameFn);
  };
  frame = requestAnimationFrame(frameFn);
}

onMounted(() => {
  if (
    typeof IntersectionObserver === 'undefined' ||
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  ) {
    display.value = props.value;
    return;
  }
  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          start();
          observer?.disconnect();
          observer = null;
        }
      }
    },
    { threshold: 0.4 }
  );
  if (spanRef.value) observer.observe(spanRef.value);
  else start();
});

onBeforeUnmount(() => {
  if (frame) cancelAnimationFrame(frame);
  observer?.disconnect();
  observer = null;
});
</script>

<template>
  <span ref="spanRef" :class="cn('inline-block tabular-nums text-ink', props.class)">
    {{ output }}
  </span>
</template>
