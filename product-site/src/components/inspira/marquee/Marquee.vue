<script lang="ts" setup>
import { cn } from '@/lib/cn';

/**
 * Inspira UI Marquee（拷贝自 unovue/inspira-ui，MIT）。
 * 仅调整：cn 导入指向本地实现。需要 Tailwind v4 的 gap-(--gap) 变量简写。
 */
withDefaults(
  defineProps<{
    class?: string;
    reverse?: boolean;
    pauseOnHover?: boolean;
    vertical?: boolean;
    repeat?: number;
  }>(),
  {
    pauseOnHover: false,
    vertical: false,
    repeat: 4
  }
);
</script>

<template>
  <div
    :class="
      cn(
        `group flex gap-(--gap) overflow-hidden p-2 [--duration:40s] [--gap:1rem]`,
        vertical ? 'flex-col' : 'flex-row',
        $props.class
      )
    "
  >
    <div
      v-for="index in repeat"
      :key="index"
      :style="{
        animationDirection: reverse ? 'reverse' : 'normal'
      }"
      :class="
        cn(
          `flex shrink-0 justify-around gap-(--gap)`,
          vertical ? 'animate-marquee-vertical flex-col' : 'animate-marquee flex-row',
          pauseOnHover ? 'group-hover:[animation-play-state:paused]' : ''
        )
      "
    >
      <slot />
    </div>
  </div>
</template>

<style scoped>
.animate-marquee {
  animation: marquee var(--duration) linear infinite;
  animation-direction: reverse;
}

.animate-marquee-vertical {
  animation: marquee-vertical var(--duration) linear infinite;
}

@keyframes marquee {
  from {
    transform: translateX(0);
  }
  to {
    transform: translateX(calc(-100% - var(--gap)));
  }
}

@keyframes marquee-vertical {
  from {
    transform: translateY(0);
  }
  to {
    transform: translateY(calc(-100% - var(--gap)));
  }
}

@media (prefers-reduced-motion: reduce) {
  .animate-marquee,
  .animate-marquee-vertical {
    animation: none;
  }
}
</style>
