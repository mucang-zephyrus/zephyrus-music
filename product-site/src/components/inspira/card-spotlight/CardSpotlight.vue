<script setup lang="ts">
import type { HTMLAttributes } from 'vue';
import { computed, onMounted, ref } from 'vue';

import { cn } from '@/lib/cn';

/**
 * Inspira UI CardSpotlight（拷贝自 unovue/inspira-ui，MIT）。
 * 仅调整：cn 导入指向本地实现、底色改为官网面板色、光晕默认电光蓝。
 */
const props = withDefaults(
  defineProps<{
    class?: HTMLAttributes['class'];
    slotClass?: HTMLAttributes['class'];
    gradientSize?: number;
    gradientColor?: string;
    gradientOpacity?: number;
  }>(),
  {
    class: '',
    slotClass: '',
    gradientSize: 220,
    gradientColor: 'rgba(77, 125, 255, 0.16)',
    gradientOpacity: 0.9
  }
);

const mouseX = ref(-props.gradientSize * 10);
const mouseY = ref(-props.gradientSize * 10);

function handleMouseMove(e: MouseEvent) {
  const target = e.currentTarget as HTMLElement;
  const rect = target.getBoundingClientRect();
  mouseX.value = e.clientX - rect.left;
  mouseY.value = e.clientY - rect.top;
}

function handleMouseLeave() {
  mouseX.value = -props.gradientSize * 10;
  mouseY.value = -props.gradientSize * 10;
}

onMounted(() => {
  mouseX.value = -props.gradientSize * 10;
  mouseY.value = -props.gradientSize * 10;
});

const backgroundStyle = computed(() => {
  return `radial-gradient(
    circle at ${mouseX.value}px ${mouseY.value}px,
    ${props.gradientColor} 0%,
    rgba(0, 0, 0, 0) 70%
  )`;
});
</script>

<template>
  <div
    :class="
      cn(
        `group relative flex size-full overflow-hidden rounded-(--radius-card) border border-line bg-panel text-ink`,
        $props.class
      )
    "
    @mousemove="handleMouseMove"
    @mouseleave="handleMouseLeave"
  >
    <div :class="cn(`relative z-10`, props.slotClass)">
      <slot />
    </div>
    <div
      class="pointer-events-none absolute inset-0 rounded-(--radius-card) opacity-0 transition-opacity duration-300 group-hover:opacity-100"
      :style="{
        background: backgroundStyle,
        opacity: gradientOpacity
      }"
    />
  </div>
</template>
