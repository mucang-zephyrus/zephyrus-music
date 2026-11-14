<template>
  <div ref="root" class="dot-matrix-scene" :data-phase="playback.phase" :data-grid-step="grid.step">
    <canvas ref="canvas" aria-hidden="true" />
    <div class="matrix-accessible" role="status">{{ currentText }}</div>
    <div
      v-if="!inputs.some((line) => line.text.trim()) || playback.phase === 'outro'"
      class="matrix-track"
    >
      <h1>{{ song.title }}</h1>
      <p v-if="song.artist">{{ song.artist }}</p>
      <p v-if="song.album">{{ song.album }}</p>
      <small v-if="!inputs.some((line) => line.text.trim())">{{ $t('player.lrc.noLrc') }}</small>
    </div>
    <div v-if="translation || roman" class="matrix-subtitles">
      <p v-if="translation">{{ translation }}</p>
      <p v-if="roman">{{ roman }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import '@/assets/fonts/fusion-pixel/fonts.css';

import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';

import { isAndroidNative } from '@/services/androidNative';
import { climaxDetector } from '@/services/climaxDetector';
import { drumDetector } from '@/services/drumDetector';
import { useStyleEngineStore } from '@/store/modules/styleEngine';
import type { PlayerStyleCustomConfig } from '@/types/playerStyle';
import {
  buildMatrixLines,
  buildMatrixMask,
  createMatrixGrid,
  createReadableMatrixGrid,
  matrixCell,
  matrixClamp,
  matrixEase,
  type MatrixEffect,
  matrixEnvelope,
  matrixField,
  matrixLyricTargets,
  type MatrixMask,
  matrixPlayback,
  stepMatrixLevel
} from '@/utils/dotMatrix';
import { createMatrixFontRaster, loadMatrixFonts } from '@/utils/dotMatrixFont';
import type { CloudInput } from '@/utils/wordCloud';
import { ensureWordSplitterReady, splitLyricsWithTags } from '@/utils/wordSplitter';

const props = defineProps<{
  inputs: CloudInput[];
  time: number;
  playing: boolean;
  active: boolean;
  font: string;
  config: PlayerStyleCustomConfig;
  reduced: boolean;
  song: { title: string; artist: string; album: string; key: string };
  showTranslation: boolean;
  showRoman: boolean;
}>();
const engine = useStyleEngineStore();
const root = ref<HTMLElement>(),
  canvas = ref<HTMLCanvasElement>();
const lines = shallowRef(buildMatrixLines(props.inputs));
const playback = computed(() => matrixPlayback(lines.value, props.time));
const currentText = computed(() => playback.value.lines.map((line) => line.text).join('\n'));
const translation = computed(() =>
  props.showTranslation
    ? playback.value.lines
        .map((line) => line.translation)
        .filter(Boolean)
        .join('\n')
    : ''
);
const roman = computed(() =>
  props.showRoman
    ? playback.value.lines
        .map((line) => line.roman)
        .filter(Boolean)
        .join('\n')
    : ''
);
const grid = shallowRef(createMatrixGrid(1, 1, 8));
let mask: MatrixMask = { dots: [], bounds: { left: 0, top: 0, right: 0, bottom: 0 } };
let levels = new Float32Array(1),
  links = new Float32Array(1),
  targets = new Float32Array(1);
let frame = 0,
  previous = 0,
  generation = 0,
  pageVisible = !document.hidden;
let observer: ResizeObserver | undefined, unsubscribe: (() => void) | undefined;
let highEnergy = false,
  smoothedEnergy = 0,
  lastTime = props.time;
let beats: { time: number; strength: number }[] = [];
const rasterCanvas = document.createElement('canvas');
const rasterContext = rasterCanvas.getContext('2d', { willReadFrequently: true });
let raster = rasterContext ? createMatrixFontRaster(rasterContext, props.font) : undefined;
function rebuildMask() {
  if (!raster) return;
  mask = buildMatrixMask(
    grid.value,
    playback.value.lines,
    Number(props.config.dotFontCells || 22),
    raster
  );
  wake();
}
async function rebuildLines() {
  const token = ++generation;
  // Replace the previous song immediately; optional segmentation/fonts may arrive later.
  lines.value = buildMatrixLines(props.inputs);
  await Promise.all([ensureWordSplitterReady(), loadMatrixFonts().catch(() => undefined)]);
  if (token !== generation) return;
  raster = rasterContext ? createMatrixFontRaster(rasterContext, props.font) : undefined;
  lines.value = buildMatrixLines(props.inputs, splitLyricsWithTags);
  resize();
}
function resize() {
  if (!root.value || !canvas.value) return;
  const { width, height } = root.value.getBoundingClientRect();
  if (width <= 0 || height <= 0) return;
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  canvas.value.width = Math.round(width * ratio);
  canvas.value.height = Math.round(height * ratio);
  grid.value = raster
    ? createReadableMatrixGrid(
        width,
        height,
        Number(props.config.dotSpacing || 8),
        lines.value,
        raster
      )
    : createMatrixGrid(width, height, Number(props.config.dotSpacing || 8));
  const count = grid.value.columns * grid.value.rows;
  levels = new Float32Array(count);
  links = new Float32Array(count);
  targets = new Float32Array(count);
  rebuildMask();
}
function effectAt(time: number): MatrixEffect {
  const energy = Math.max(0, engine.energyLevel);
  smoothedEnergy += (energy - smoothedEnergy) * 0.06;
  const native = isAndroidNative();
  if (!highEnergy && smoothedEnergy > (native ? 0.62 : 1.12)) highEnergy = true;
  if (highEnergy && smoothedEnergy < (native ? 0.44 : 0.82)) highEnergy = false;
  if (props.reduced || playback.value.phase === 'static') return 'lyrics';
  if (['intro', 'interlude', 'outro'].includes(playback.value.phase))
    return highEnergy ? 'sweep' : 'quiet';
  if (!engine.isInClimax && !climaxDetector.isClimax) return 'lyrics';
  const chosen = props.config.dotClimax || 'auto';
  if (chosen !== 'auto') return chosen;
  const choices = ['ripple', 'checker', 'radial'] as const;
  return choices[Math.floor(time / 12) % 3];
}
function draw(now: number) {
  frame = 0;
  if (!canvas.value || !props.active || !pageVisible) return;
  const ctx = canvas.value.getContext('2d');
  if (!ctx) return;
  const dt = previous ? matrixClamp((now - previous) / 1000, 0, 0.08) : 1 / 60;
  previous = now;
  const time = props.time,
    g = grid.value;
  if (Math.abs(time - lastTime) > 0.7) {
    beats = [];
  }
  lastTime = time;
  const effect = effectAt(time);
  const bpm = matrixClamp(engine.bpm || 0, 0, 240);
  const beat = (time * bpm) / 60;
  beats = beats.filter((event) => time - event.time >= 0 && time - event.time < 0.8);
  const pulse =
    props.config.dotBeat !== false && !props.reduced && effect === 'quiet'
      ? Math.max(0, ...beats.map((event) => matrixEnvelope(time - event.time) * event.strength))
      : 0;
  const intensity = Number(props.config.dotIntensity ?? 1);
  const b = mask.bounds;
  // The same targets array contains both lyrics and effects. There is one draw per cell.
  matrixLyricTargets(mask, g, time, props.config.effectWordDrop === true, props.reduced, targets);
  const buckets: number[][] = Array.from({ length: 40 }, () => []);
  const linkBuckets: number[][] = Array.from({ length: 24 }, () => []);
  let settling = false;
  for (let row = 0; row < g.rows; row++)
    for (let column = 0; column < g.columns; column++) {
      const index = row * g.columns + column;
      const outside = mask.dots.length
        ? Math.max(b.left - column, column - b.right, b.top - row, row - b.bottom)
        : 10;
      const clearance = effect === 'quiet' || effect === 'sweep' ? 1 : matrixEase(outside / 8);
      const field = props.reduced
        ? 0
        : matrixField(effect, column, row, g, beat) * clearance * 0.85;
      const target = Math.max(targets[index], matrixClamp(Math.max(field, pulse) * intensity));
      const level = stepMatrixLevel(levels[index], target, dt);
      levels[index] = level;
      if (Math.abs(level - target) > 0.003) settling = true;
      buckets[Math.round(matrixClamp(level) * 39)].push(index);
      const linkTarget = effect === 'sweep' && !props.reduced ? matrixClamp(field * intensity) : 0;
      links[index] = stepMatrixLevel(links[index], linkTarget, dt);
      if (Math.abs(links[index] - linkTarget) > 0.003) settling = true;
      if (row > 0 && column < g.columns - 1 && links[index] > 0.02)
        linkBuckets[Math.round(matrixClamp(links[index]) * 23)].push(index);
    }
  const ratio = canvas.value.width / g.width;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, g.width, g.height);
  // A link joins two existing diagonal neighbours; endpoints share the background lattice.
  ctx.lineWidth = Math.max(0.7, g.step * 0.12);
  for (let shade = 1; shade < linkBuckets.length; shade++) {
    ctx.strokeStyle = `rgba(24,24,24,${(shade / 23) * 0.75})`;
    ctx.beginPath();
    for (const index of linkBuckets[shade]) {
      const p = matrixCell(g, index % g.columns, Math.floor(index / g.columns));
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x + g.step, p.y - g.step);
    }
    ctx.stroke();
  }
  const square = props.config.dotShape === 'grid';
  if (square) {
    ctx.beginPath();
    ctx.strokeStyle = '#ededed';
    ctx.lineWidth = 0.5;
    for (let c = 0; c <= g.columns; c++) {
      ctx.moveTo(c * g.step, 0);
      ctx.lineTo(c * g.step, g.height);
    }
    for (let r = 0; r <= g.rows; r++) {
      ctx.moveTo(0, r * g.step);
      ctx.lineTo(g.width, r * g.step);
    }
    ctx.stroke();
  }
  const radius = g.step * (square ? 0.43 : Number(props.config.dotRadius ?? 0.27));
  for (let shade = 0; shade < buckets.length; shade++) {
    const gray = Math.round((square ? 255 : 228) - (shade / 39) * (square ? 231 : 204));
    ctx.fillStyle = `rgb(${gray} ${gray} ${gray})`;
    ctx.beginPath();
    for (const index of buckets[shade]) {
      const p = matrixCell(g, index % g.columns, Math.floor(index / g.columns));
      if (square) ctx.rect(p.x - radius, p.y - radius, radius * 2, radius * 2);
      else {
        ctx.moveTo(p.x + radius, p.y);
        ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      }
    }
    ctx.fill();
  }
  // Pausing freezes lyric time and background state; finish only the current color fade.
  if ((props.playing && !props.reduced) || settling) frame = requestAnimationFrame(draw);
}
function wake() {
  if (!frame && props.active && pageVisible) frame = requestAnimationFrame(draw);
}
function visibility() {
  pageVisible = !document.hidden;
  previous = 0;
  if (!pageVisible) {
    cancelAnimationFrame(frame);
    frame = 0;
  } else wake();
}
watch(() => [props.inputs, props.song.key, props.font, props.config.fontWeight], rebuildLines);
watch(() => [props.config.dotSpacing], resize);
watch(
  () => [
    playback.value.lines.map((line) => line.id).join(','),
    lines.value,
    props.config.dotFontCells
  ],
  rebuildMask
);
watch(
  () => [props.time, props.playing, props.active, props.reduced, props.config],
  () => {
    if (!props.active) {
      cancelAnimationFrame(frame);
      frame = 0;
      previous = 0;
    } else wake();
  },
  { deep: true }
);
watch(
  () => props.song.key,
  () => {
    beats = [];
    highEnergy = false;
    smoothedEnergy = 0;
    levels.fill(0);
    links.fill(0);
  }
);
onMounted(() => {
  observer = new ResizeObserver(resize);
  if (root.value) observer.observe(root.value);
  unsubscribe = drumDetector.onBeat((info) => {
    if (props.active && props.playing && !props.reduced) {
      beats.push({ time: props.time, strength: info.isStrong ? 1 : 0.65 });
      if (beats.length > 12) beats.shift();
      wake();
    }
  });
  document.addEventListener('visibilitychange', visibility);
  resize();
  void rebuildLines();
});
onBeforeUnmount(() => {
  generation++;
  cancelAnimationFrame(frame);
  observer?.disconnect();
  unsubscribe?.();
  document.removeEventListener('visibilitychange', visibility);
});
</script>

<style scoped>
.dot-matrix-scene {
  position: absolute;
  inset: 0;
  overflow: hidden;
  background: #fff;
  color: #181818;
  pointer-events: none;
}
canvas {
  position: absolute;
  width: 100%;
  height: 100%;
  inset: 0;
}
.matrix-accessible {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
}
.matrix-track {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  padding: 12%;
  text-align: center;
}
.matrix-track h1 {
  font-size: clamp(24px, 4vw, 64px);
  line-height: 1.2;
  letter-spacing: -0.04em;
  font-weight: 600;
}
.matrix-track p {
  margin: 8px 0 0;
  color: #666;
  font-size: 14px;
}
.matrix-track small {
  margin-top: 20px;
  color: #777;
}
.matrix-subtitles {
  position: absolute;
  left: 8%;
  right: 8%;
  top: 76%;
  text-align: center;
  font-size: clamp(12px, 1.4vw, 18px);
  color: #555;
}
.matrix-subtitles p {
  margin: 4px 0;
}
</style>
