<template>
  <canvas ref="canvas" class="beat-ripple-background" aria-hidden="true" />
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';

import { drumDetector } from '@/services/drumDetector';
import {
  advanceRipples,
  createRippleState,
  emitBeatRipple,
  rippleAmplitude,
  rippleGrid,
  ripplePalette
} from '@/utils/beatRipple';
import { isLowEndDevice } from '@/utils/deviceTier';

const props = defineProps<{ theme: string; paused: boolean; reduced: boolean; songKey: string }>();
const canvas = ref<HTMLCanvasElement>();
let state = createRippleState();
let width = 0,
  height = 0,
  ratio = 1;
let grid = rippleGrid(1, 1);
let frame = 0,
  previous = 0,
  lastPaint = 0;
let pageVisible = !document.hidden;
let observer: ResizeObserver | undefined, unsubscribe: (() => void) | undefined;
let colors = ripplePalette(props.theme, 0);
const LEVELS = 24;
const buckets: number[][] = Array.from({ length: LEVELS * 3 }, () => []);
function running() {
  return !props.paused && !props.reduced && pageVisible;
}
function paint(dt = 0) {
  if (!pageVisible) return;
  const ctx = canvas.value?.getContext('2d', { alpha: false });
  if (!ctx || !width || !height) return;
  const target = ripplePalette(props.theme, props.reduced ? 0 : state.time);
  const blend = 1 - Math.exp(-dt / 0.8);
  colors = colors.map((color, i) => {
    const next = { ...color };
    for (const channel of ['r', 'g', 'b'] as const) {
      next[channel] += (target[i][channel] - color[channel]) * blend;
    }
    return next;
  });
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, width, height);
  for (const bucket of buckets) bucket.length = 0;
  for (let row = 0; row < grid.rows; row++)
    for (let column = 0; column < grid.columns; column++) {
      const x = grid.offsetX + column * grid.spacing;
      const y = grid.offsetY + row * grid.spacing;
      const level = props.reduced ? 0 : rippleAmplitude(x, y, state);
      const band = Math.min(2, Math.max(0, Math.floor(((x / width + y / height) / 2) * 3)));
      buckets[band * LEVELS + Math.round(level * (LEVELS - 1))].push(x, y);
    }
  for (let band = 0; band < 3; band++) {
    const color = colors[band];
    ctx.fillStyle = `rgb(${Math.round(color.r)} ${Math.round(color.g)} ${Math.round(color.b)})`;
    for (let level = 0; level < LEVELS; level++) {
      const points = buckets[band * LEVELS + level];
      if (!points.length) continue;
      const amount = level / (LEVELS - 1);
      const radius = 1.35 + amount * 2.24;
      ctx.globalAlpha = 0.22 + amount * 0.7;
      ctx.beginPath();
      for (let i = 0; i < points.length; i += 2) {
        ctx.moveTo(points[i] + radius, points[i + 1]);
        ctx.arc(points[i], points[i + 1], radius, 0, Math.PI * 2);
      }
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}
function draw(now: number) {
  frame = 0;
  if (!pageVisible) return;
  // Limit background cost without reducing the foreground lyric frame rate.
  if (lastPaint && now - lastPaint < (isLowEndDevice ? 50 : 1000 / 30) - 1) {
    frame = requestAnimationFrame(draw);
    return;
  }
  const dt = previous ? Math.min(0.1, (now - previous) / 1000) : 0;
  previous = lastPaint = now;
  if (running()) advanceRipples(state, dt);
  paint(dt);
  if (running()) frame = requestAnimationFrame(draw);
  else previous = lastPaint = 0;
}
function wake() {
  if (!frame && pageVisible) frame = requestAnimationFrame(draw);
}
function stop() {
  cancelAnimationFrame(frame);
  frame = previous = lastPaint = 0;
}
function resize() {
  if (!canvas.value) return;
  const bounds = canvas.value.getBoundingClientRect();
  if (width > 0 && height > 0 && bounds.width > 0 && bounds.height > 0)
    for (const wave of state.waves) {
      wave.x *= bounds.width / width;
      wave.y *= bounds.height / height;
    }
  width = bounds.width;
  height = bounds.height;
  if (!width || !height) return;
  ratio = Math.min(window.devicePixelRatio || 1, isLowEndDevice ? 1 : 1.5);
  canvas.value.width = Math.round(width * ratio);
  canvas.value.height = Math.round(height * ratio);
  grid = rippleGrid(width, height, isLowEndDevice);
  paint();
  wake();
}
function visibility() {
  pageVisible = !document.hidden;
  stop();
  if (pageVisible) wake();
}
watch(
  () => [props.paused, props.reduced],
  () => {
    stop();
    if (props.reduced) {
      state = createRippleState();
      colors = ripplePalette(props.theme, 0);
    }
    paint();
    if (running()) wake();
  }
);
watch(
  () => props.theme,
  () => {
    if (running()) wake();
    else {
      colors = ripplePalette(props.theme, props.reduced ? 0 : state.time);
      paint();
    }
  }
);
watch(
  () => props.songKey,
  () => {
    state = createRippleState();
    stop();
    paint();
    wake();
  }
);
onMounted(() => {
  observer = new ResizeObserver(resize);
  if (canvas.value) observer.observe(canvas.value);
  unsubscribe = drumDetector.onBeat((beat) => {
    if (running() && emitBeatRipple(state, width, height, beat.isStrong)) wake();
  });
  document.addEventListener('visibilitychange', visibility);
  resize();
});
onBeforeUnmount(() => {
  stop();
  observer?.disconnect();
  unsubscribe?.();
  document.removeEventListener('visibilitychange', visibility);
});
</script>

<style scoped>
.beat-ripple-background {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}
</style>
