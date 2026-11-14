<template>
  <div
    ref="root"
    class="word-cloud-scene"
    :data-phase="phase.kind"
    :data-line-count="layout.lines.length"
    :data-layout-version="layoutVersion"
  >
    <canvas ref="canvas" aria-hidden="true" />
    <div class="cloud-accessible" role="status">{{ currentText }}</div>
    <div
      v-if="(phase.kind === 'outro' && !currentLines.length) || !layout.lines.length"
      class="cloud-track-info"
    >
      <h1>{{ song.title }}</h1>
      <p v-if="song.artist">{{ song.artist }}</p>
      <p v-if="song.album">{{ song.album }}</p>
      <small v-if="!layout.lines.length">{{ $t('player.lrc.noLrc') }}</small>
    </div>
    <div
      v-if="currentLines.length && (translation || roman)"
      class="cloud-subtitles"
      :class="{ 'with-controls': controls }"
    >
      <p v-if="translation">{{ translation }}</p>
      <p v-if="roman" class="cloud-roman">{{ roman }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';

import type { PlayerStyleCustomConfig } from '@/types/playerStyle';
import {
  activeCloudLines,
  buildCloudLayoutSteps,
  cloudCameraTarget,
  type CloudInput,
  type CloudLayout,
  cloudOpacity,
  cloudPalette,
  cloudPhase,
  type CloudRect,
  fitCloudLayoutToViewport,
  runCloudLayout
} from '@/utils/wordCloud';
import { createCloudMotion, stepCloudMotion } from '@/utils/wordCloudCamera';

const props = defineProps<{
  inputs: CloudInput[];
  time: number;
  duration: number;
  playing: boolean;
  active: boolean;
  controls: boolean;
  font: string;
  config: PlayerStyleCustomConfig;
  theme: string;
  song: { title: string; artist: string; album: string; key: string };
  showTranslation: boolean;
  showRoman: boolean;
  reduced: boolean;
}>();
const root = ref<HTMLElement>();
const canvas = ref<HTMLCanvasElement>();
const layout = shallowRef<CloudLayout>({
  lines: [],
  bounds: { x: 0, y: 0, width: 1, height: 1 },
  untimed: true
});
const layoutVersion = ref(0);
let baseLayout = layout.value;
let layoutAbort: AbortController | undefined;
const phase = computed(() =>
  cloudPhase(layout.value, props.time, props.duration, props.config.cloudEstimate !== false)
);
const currentLines = computed(() => activeCloudLines(layout.value, props.time));
const currentText = computed(() => currentLines.value.map((l) => l.text).join('\n'));
const translation = computed(() =>
  props.showTranslation
    ? currentLines.value
        .map((l) => l.translation)
        .filter(Boolean)
        .join('\n')
    : ''
);
const roman = computed(() =>
  props.showRoman
    ? currentLines.value
        .map((l) => l.roman)
        .filter(Boolean)
        .join('\n')
    : ''
);
const palette = computed(() => cloudPalette(props.theme));
let frame = 0,
  previous = 0,
  generation = 0,
  observer: ResizeObserver | undefined;
let width = 0,
  height = 0,
  pageVisible = !document.hidden;
let motion = createCloudMotion();
const fontValue = () => props.font || 'system-ui, sans-serif';
const fontSpec = (size: number) => `${props.config.fontWeight || 600} ${size}px ${fontValue()}`;
const measureCache = new Map<string, number>();
const inkCache = new Map<string, CloudRect>();
function prepareText(ctx: CanvasRenderingContext2D, text: string, size: number) {
  ctx.font = fontSpec(size);
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.direction = /[\p{Script=Arabic}\p{Script=Hebrew}]/u.test(text) ? 'rtl' : 'ltr';
}
function measure(text: string, size: number) {
  const key = `${size}:${text}`;
  if (measureCache.has(key)) return measureCache.get(key)!;
  const ctx = canvas.value?.getContext('2d');
  if (!ctx) return text.length * size;
  prepareText(ctx, text, size);
  const value = ctx.measureText(text.replace(/\n/g, '')).width;
  measureCache.set(key, value);
  return value;
}
function measureInk(text: string, size: number): CloudRect {
  const key = `${size}:${text}`;
  if (inkCache.has(key)) return inkCache.get(key)!;
  const ctx = canvas.value!.getContext('2d')!;
  prepareText(ctx, text, size);
  const metrics = ctx.measureText(text.replace(/\n/g, ''));
  const ink = {
    x: -metrics.actualBoundingBoxLeft,
    y: -metrics.actualBoundingBoxAscent,
    width: metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight,
    height: metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent
  };
  inkCache.set(key, ink);
  return ink;
}
function projectLayout() {
  layout.value = fitCloudLayoutToViewport(baseLayout, width, height);
}
async function rebuild() {
  const token = ++generation;
  layoutAbort?.abort();
  const abort = new AbortController();
  layoutAbort = abort;
  let fontLoad: Promise<unknown> | undefined;
  try {
    fontLoad = document.fonts?.load(fontSpec(32)).catch(() => []);
  } catch {
    /* Use system fallback. */
  }
  await Promise.race([
    fontLoad ?? Promise.resolve(),
    new Promise((resolve) => setTimeout(resolve, 800))
  ]);
  if (token !== generation || !canvas.value) return;
  measureCache.clear();
  inkCache.clear();
  const next = await runCloudLayout(
    buildCloudLayoutSteps(
      props.inputs,
      props.song.key,
      {
        scale: Number(props.config.cloudScale ?? 1),
        spacing: Number(props.config.cloudSpacing ?? 1),
        vertical: Number(props.config.cloudVertical ?? 0.3)
      },
      measure,
      undefined,
      measureInk
    ),
    abort.signal
  );
  if (!next || token !== generation) return;
  baseLayout = next;
  projectLayout();
  layoutVersion.value++;
  motion = createCloudMotion();
  wake();
}
function resize() {
  if (!root.value || !canvas.value) return;
  const rect = root.value.getBoundingClientRect();
  width = rect.width;
  height = rect.height;
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  canvas.value.width = Math.round(width * ratio);
  canvas.value.height = Math.round(height * ratio);
  projectLayout();
  wake();
}
function draw(now: number) {
  frame = 0;
  if (!props.active || !pageVisible || !canvas.value || width <= 0 || height <= 0) return;
  const dt = previous ? Math.max(0, (now - previous) / 1000) : 1 / 60;
  previous = now;
  // Controls and captions overlay the physical canvas, never shrink its viewport.
  const view = { x: 0, y: 0, width, height };
  const target = cloudCameraTarget(
    layout.value,
    props.time,
    view,
    props.config.cloudFocus !== false,
    phase.value,
    props.reduced
  );
  const overview = cloudCameraTarget(layout.value, props.time, view, false, phase.value);
  const panorama =
    props.config.cloudFocus === false || layout.value.untimed || phase.value.kind === 'outro';
  let focusLines = currentLines.value.filter((line) => line.primary);
  if (!focusLines.length) focusLines = currentLines.value;
  const previousLine = layout.value.lines
    .filter((line) => !line.background && line.begin <= props.time)
    .at(-1);
  const firstLine = layout.value.lines.find((line) => !line.background);
  const source = panorama
    ? 'overview'
    : focusLines.length
      ? focusLines.map((line) => line.id).join(':')
      : String((previousLine ?? firstLine)?.id ?? -1);
  motion = stepCloudMotion(motion, {
    target,
    overview,
    view,
    source,
    time: props.time,
    dt,
    speed: Number(props.config.cloudCameraSpeed ?? 1),
    floating: !panorama,
    reduced: props.reduced
  });
  const camera = motion.camera;
  const ctx = canvas.value.getContext('2d');
  if (!ctx) return;
  const ratio = canvas.value.width / width;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.save();
  ctx.translate(width / 2, view.y + view.height / 2);
  ctx.scale(camera.scale, camera.scale);
  ctx.rotate(camera.angle);
  ctx.translate(-camera.x, -camera.y);
  ctx.textBaseline = 'top';
  const radius = Math.hypot(width, height) / Math.max(0.001, camera.scale);
  for (const line of layout.value.lines) {
    if (!layout.value.untimed && line.begin > props.time) continue;
    if (
      line.rect.x > camera.x + radius ||
      line.rect.y > camera.y + radius ||
      line.rect.x + line.rect.width < camera.x - radius ||
      line.rect.y + line.rect.height < camera.y - radius
    )
      continue;
    ctx.save();
    ctx.translate(line.rect.x + (line.angle ? line.localHeight : 0), line.rect.y);
    ctx.rotate(line.angle);
    for (const word of line.tokens) {
      prepareText(ctx, word.text, word.size);
      ctx.fillStyle = palette.value[Math.floor(word.shade * 11)];
      if (line.timedWords) {
        for (const slice of word.slices) {
          ctx.globalAlpha = cloudOpacity(
            line,
            slice,
            props.time,
            layout.value.untimed,
            props.reduced
          );
          if (!ctx.globalAlpha) continue;
          // Clip a fully shaped token rather than drawing disconnected glyphs.
          const prefix = word.text.slice(0, slice.offset - word.offset);
          const from = measure(prefix, word.size),
            to = measure(prefix + slice.text, word.size);
          const rtl = /[\p{Script=Arabic}\p{Script=Hebrew}]/u.test(word.text);
          let left = rtl ? word.width - to : from;
          let right = rtl ? word.width - from : to;
          if (left < 0.01) left = Math.min(left, word.ink?.x ?? 0);
          if (right > word.width - 0.01)
            right = Math.max(right, (word.ink?.x ?? 0) + (word.ink?.width ?? word.width));
          ctx.save();
          ctx.beginPath();
          ctx.rect(
            word.x + left,
            word.y + (word.ink?.y ?? 0),
            Math.max(0.01, right - left),
            word.ink?.height ?? word.size * 1.4
          );
          ctx.clip();
          prepareText(ctx, word.text, word.size);
          ctx.fillText(word.text, word.x, word.y);
          ctx.restore();
        }
      } else {
        ctx.globalAlpha = cloudOpacity(
          line,
          undefined,
          props.time,
          layout.value.untimed,
          props.reduced
        );
        if (ctx.globalAlpha) ctx.fillText(word.text.replace(/\n/g, ''), word.x, word.y);
      }
    }
    ctx.restore();
  }
  ctx.restore();
  if ((props.playing && !layout.value.untimed) || !motion.settled)
    frame = requestAnimationFrame(draw);
}
function wake() {
  if (frame || !props.active || !pageVisible) return;
  previous = performance.now();
  frame = requestAnimationFrame(draw);
}
function visibility() {
  pageVisible = !document.hidden;
  if (pageVisible) wake();
  else {
    cancelAnimationFrame(frame);
    frame = 0;
  }
}
watch(
  () => props.song.key,
  () => {
    generation++;
    layoutAbort?.abort();
    layout.value = { lines: [], bounds: { x: 0, y: 0, width: 1, height: 1 }, untimed: true };
    baseLayout = layout.value;
    motion = createCloudMotion();
    wake();
  },
  { flush: 'sync' }
);
watch(
  () => [
    props.inputs,
    props.font,
    props.config.fontWeight,
    props.config.cloudScale,
    props.config.cloudSpacing,
    props.config.cloudVertical,
    props.song.key
  ],
  rebuild
);
watch(
  () => [
    props.time,
    props.active,
    props.playing,
    props.controls,
    props.reduced,
    props.theme,
    props.config.cloudFocus,
    props.config.cloudEstimate,
    props.config.cloudCameraSpeed,
    props.showTranslation,
    props.showRoman
  ],
  () => {
    if (!props.active) {
      cancelAnimationFrame(frame);
      frame = 0;
    } else wake();
  }
);
onMounted(() => {
  observer = new ResizeObserver(resize);
  observer.observe(root.value!);
  resize();
  void rebuild();
  document.addEventListener('visibilitychange', visibility);
});
onBeforeUnmount(() => {
  generation++;
  layoutAbort?.abort();
  cancelAnimationFrame(frame);
  observer?.disconnect();
  document.removeEventListener('visibilitychange', visibility);
});
defineExpose({ layout, phase, getCamera: () => ({ ...motion.camera }) });
</script>

<style scoped>
.word-cloud-scene {
  position: absolute;
  inset: 0;
  z-index: 2;
  overflow: hidden;
  pointer-events: none;
  color: #fff;
}
canvas {
  width: 100%;
  height: 100%;
  display: block;
}
.cloud-accessible {
  position: absolute;
  width: 1px;
  height: 1px;
  clip-path: inset(50%);
  overflow: hidden;
}
.cloud-track-info {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}
.cloud-track-info {
  padding: 28px;
  flex-direction: column;
  text-align: center;
  gap: 10px;
  text-shadow: 0 2px 22px #0008;
}
.cloud-track-info h1 {
  font-size: clamp(24px, 5vw, 48px);
  line-height: 1.15;
  max-width: 900px;
}
.cloud-track-info p {
  opacity: 0.8;
}
.cloud-track-info small {
  opacity: 0.5;
  margin-top: 12px;
}
.cloud-subtitles {
  position: absolute;
  left: 24px;
  right: 24px;
  bottom: calc(var(--safe-area-inset-bottom, 0px) + 26px);
  text-align: center;
  font-size: clamp(14px, 2vw, 20px);
  white-space: pre-line;
  text-shadow: 0 2px 12px #000;
}
.cloud-subtitles.with-controls {
  bottom: calc(var(--safe-area-inset-bottom, 0px) + 185px);
}
.cloud-roman {
  opacity: 0.65;
  font-size: 0.85em;
  margin-top: 6px;
}
@media (orientation: landscape) and (max-height: 500px) {
  .cloud-subtitles.with-controls {
    bottom: 120px;
    font-size: 13px;
  }
}
</style>
