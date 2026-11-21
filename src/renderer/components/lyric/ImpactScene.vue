<template>
  <div ref="surface" class="impact-scene" :class="{ 'impact-controls-visible': controls }">
    <canvas
      ref="output"
      aria-hidden="true"
      :data-phase="phase"
      :data-card="scene.card"
      :data-landed="frame?.landed || 0"
    ></canvas>
    <p class="sr-only">
      {{ displayText(cardLabel || frame?.line.text || '') }}
      <span v-for="line in centerLyrics" :key="line.key" :data-impact-field="line.field">{{
        displayText(line.text)
      }}</span>
    </p>
    <div v-if="bottomLyrics.length" ref="subtitles" class="impact-subtitles">
      <p v-for="line in bottomLyrics" :key="line.key" :data-impact-field="line.field">
        {{ displayText(line.text) }}
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useElementSize } from '@vueuse/core';
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';

import { drumDetector } from '@/services/drumDetector';
import type { PlayerStyleCustomConfig } from '@/types/playerStyle';
import { impactArtistCredit } from '@/utils/impactArtist';
import { loadFontById } from '@/utils/fontLoader';
import { drawCracks, drawGlass, drawShards, glassPalette, printGlyph } from '@/utils/impactGlass';
import {
  buildImpactAccompaniment,
  buildImpactTimeline,
  buildImpactVocalRanges,
  clampUnit,
  glassGeometry,
  impactAccompanimentAt,
  impactFrame,
  impactSceneAt,
  type ImpactLine,
  impactShatters,
  impactText
} from '@/utils/impactTimeline';
import type { CloudInput } from '@/utils/wordCloud';

const props = defineProps<{
  active: boolean;
  playing: boolean;
  controls: boolean;
  time: number;
  songKey: string;
  title: string;
  artists: string[];
  duration: number;
  font: string;
  theme: string;
  climax: boolean;
  reduced: boolean;
  config: PlayerStyleCustomConfig;
  inputs: CloudInput[];
}>();

const surface = ref<HTMLElement>();
const output = ref<HTMLCanvasElement>();
const { width, height } = useElementSize(surface, { width: 0, height: 0 }, { box: 'border-box' });
const subtitles = ref<HTMLElement>();
const { height: subtitleHeight } = useElementSize(subtitles);
const fontReady = ref(false);
const timeline = computed(() => buildImpactTimeline(props.inputs, props.config.impactWholeLine));
const frame = computed(() => impactFrame(timeline.value, props.time, props.reduced));
const accompaniment = computed(() => buildImpactAccompaniment(props.inputs));
const activeLyrics = computed(() => impactAccompanimentAt(accompaniment.value, props.time));
const vocalRanges = computed(() => buildImpactVocalRanges(timeline.value, accompaniment.value));
const artist = computed(() =>
  impactArtistCredit(props.artists, props.config.impactSwapArtistLanguages === true)
);
const scene = computed(() =>
  impactSceneAt(
    vocalRanges.value,
    props.time,
    Boolean(artist.value.main),
    props.reduced,
    props.duration
  )
);
const cardLabel = computed(() => {
  if (scene.value.card === 'title') return props.title;
  if (scene.value.card === 'artist')
    return [artist.value.main, artist.value.outline].filter(Boolean).join(' / ');
  return '';
});
const customInkFont = computed(() =>
  props.font ? `${props.config.fontWeight || 900} 160px ${props.font}` : undefined
);
const fillsScreen = computed(() => Boolean(props.config.impactFill));
const centerLyrics = computed(() => (fillsScreen.value && frame.value ? activeLyrics.value : []));
const bottomLyrics = computed(() => (centerLyrics.value.length ? [] : activeLyrics.value));
const displayText = (text: string) => impactText(text, props.config.impactUppercase === true);
const phase = computed(() => {
  if (!frame.value) return scene.value.phase;
  if (!frame.value.line.words.length) return 'static';
  return frame.value.shattered ? 'shattered' : 'impact';
});
function geometryFor(line: ImpactLine) {
  return glassGeometry(width.value, height.value, `${props.songKey}:${line.key}`);
}

const geometry = computed(() => {
  const line = frame.value?.line;
  return line ? geometryFor(line) : undefined;
});
const palette = computed(() => glassPalette(props.theme));
const glyphs = new Map<string, HTMLCanvasElement>();
let texture: HTMLCanvasElement | undefined;
let textureContext: CanvasRenderingContext2D | null | undefined;
let unsubscribe: (() => void) | undefined;
let lastBeat = -Infinity;
let beatPower = 0;
let lastTime = -Infinity;
let lastClimax = false;
let climaxMix = 0;
let raf = 0;
let inset = 20;

function updateInset() {
  if (surface.value) inset = parseFloat(getComputedStyle(surface.value).paddingTop) || 20;
}

interface InkRow {
  top: number;
  height: number;
  stacked: boolean;
}

function lyricRows(accompaniments: number, hasSubtitles: boolean) {
  const h = height.value;
  const footer = hasSubtitles ? Math.min(h * 0.24, subtitleHeight.value) + 8 : 0;
  const available = Math.max(h * 0.29, h - 2 * (inset + footer));
  const count = accompaniments + 1;
  const gap = count > 1 ? Math.min(12, available / (4 * count)) : 0;
  const rowHeight = (available - gap * (count - 1)) / count;
  return Array.from(
    { length: count },
    (_, i): InkRow => ({
      top: (h - available) / 2 + i * (rowHeight + gap),
      height: rowHeight,
      stacked: count > 1
    })
  );
}

function drawInk(
  ctx: CanvasRenderingContext2D,
  text: string,
  key: string,
  alpha: number,
  outline: boolean,
  row: InkRow,
  scale = 1,
  cardOutline = false
) {
  const ink = displayText(text);
  const cacheKey = `${key}:${outline}:${ink}:${customInkFont.value || ''}`;
  let glyph = glyphs.get(cacheKey);
  if (!glyph) {
    glyph = printGlyph(
      ink,
      palette.value.ink,
      key,
      Number(props.config.impactDistress ?? 35) / 100,
      props.config.impactRough !== false,
      outline,
      customInkFont.value,
      cardOutline ? 2.6 : undefined
    );
    if (glyphs.size >= 36) glyphs.delete(glyphs.keys().next().value!);
    glyphs.set(cacheKey, glyph);
  }
  const maxWidth = Math.max(1, width.value - 2 * Math.max(20, width.value * 0.045));
  const maxHeight = row.height;
  let drawWidth = maxWidth;
  let drawHeight = maxHeight;
  if (!props.config.impactFill) {
    const fit = Math.min(
      (maxWidth * 0.92) / glyph.width,
      (maxHeight * 0.6) / glyph.height,
      Math.min(width.value * 0.24, height.value * 0.27, 220) / glyph.height
    );
    drawWidth = glyph.width * fit;
    drawHeight = glyph.height * fit;
  }
  drawWidth *= scale;
  drawHeight *= scale;
  ctx.save();
  ctx.globalAlpha = alpha;
  if (row.stacked && scale > 1) {
    ctx.beginPath();
    ctx.rect(0, row.top, width.value, row.height);
    ctx.clip();
  }
  ctx.drawImage(
    glyph,
    (width.value - drawWidth) / 2,
    row.top + (row.height - drawHeight) / 2,
    drawWidth,
    drawHeight
  );
  ctx.restore();
}

function drawImpressions(
  ctx: CanvasRenderingContext2D,
  line: ImpactLine,
  cracks: ReturnType<typeof glassGeometry>['cracks'],
  landed: number,
  hitAge: number,
  row: InkRow
) {
  if (!landed) return;
  const shattered = landed === line.words.length;
  drawCracks(ctx, cracks, landed / line.words.length, shattered);
  const firstVisible = Math.max(0, landed - 16);
  for (let index = 0; index < landed; index++) {
    const opacity = index === landed - 1 ? 0.86 : index < firstVisible ? 0.14 : 0.28;
    drawInk(ctx, line.words[index].text, `${line.key}:${index}`, opacity, true, row);
  }
  const alpha = props.reduced ? 0.86 : Math.max(0, (shattered ? 0.85 : 1) * (1 - hitAge / 0.18));
  if (alpha > 0)
    drawInk(ctx, line.words[landed - 1].text, `${line.key}:${landed - 1}`, alpha, false, row);
}

function applyShock(ctx: CanvasRenderingContext2D, age: number, strength: number) {
  if (props.reduced || age >= 0.15) return false;
  const shock = Math.exp(-age * 26) * strength;
  ctx.translate(Math.cos(age * 124) * shock, Math.sin(age * 171) * shock * 0.68);
  return true;
}

function render() {
  const canvas = output.value;
  const w = width.value;
  const h = height.value;
  if (!props.active || !canvas || w < 12 || h < 12 || !texture || !textureContext) return;
  const scale = Math.min(window.devicePixelRatio || 1, 1.5, Math.sqrt(1600000 / (w * h)));
  const pixelW = Math.round(w * scale);
  const pixelH = Math.round(h * scale);
  if (canvas.width !== pixelW || canvas.height !== pixelH) {
    canvas.width = texture.width = pixelW;
    canvas.height = texture.height = pixelH;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const glass = textureContext;
  const delta = props.time - lastTime;
  const discontinuity = delta < -0.015 || delta > 0.3;
  if (discontinuity && lastBeat !== props.time) lastBeat = -Infinity;
  const targetClimax = Number(props.climax);
  if (discontinuity || props.reduced || !props.playing) climaxMix = targetClimax;
  else if (delta > 0 || lastClimax !== props.climax) {
    const fraction = 1 - Math.exp(-Math.max(0.014, delta) / 0.11);
    climaxMix += (targetClimax - climaxMix) * fraction;
    if (Math.abs(targetClimax - climaxMix) < 0.01) climaxMix = targetClimax;
  }
  lastClimax = props.climax;
  lastTime = props.time;
  const age = props.time - lastBeat;
  const beat = !props.reduced && age >= 0 && age < 0.32 ? beatPower * Math.exp(-age / 0.075) : 0;
  const current = frame.value;
  const lightTime = props.reduced ? 0 : props.time;
  const { card, opacity, edgeLight } = scene.value;
  const paintGlass = (context: CanvasRenderingContext2D) =>
    drawGlass(context, w, h, palette.value, climaxMix, Math.max(beat, edgeLight), lightTime);

  ctx.setTransform(pixelW / w, 0, 0, pixelH / h, 0, 0);
  paintGlass(ctx);
  const rows = lyricRows(centerLyrics.value.length, Boolean(bottomLyrics.value.length));
  if (current && !current.shattered && geometry.value) {
    const { line, landed, active, hitAge } = current;
    ctx.save();
    if (applyShock(ctx, hitAge, 6)) paintGlass(ctx);
    if (!line.words.length) drawInk(ctx, line.text, line.key, 1, false, rows[0]);
    else {
      drawImpressions(ctx, line, geometry.value.cracks, landed, hitAge, rows[0]);
      if (!props.reduced && active >= landed) {
        const word = line.words[active];
        const t = clampUnit((props.time - word.begin) / (word.hit - word.begin));
        drawInk(
          ctx,
          word.text,
          `${line.key}:${active}`,
          0.3 + t * 0.7,
          false,
          rows[0],
          1 + 1.35 * (1 - t) ** 2
        );
      }
    }
    ctx.restore();
  } else if (!current && !activeLyrics.value.length) {
    if (card === 'title' && props.title) {
      drawInk(ctx, props.title, `${props.songKey}:title`, opacity, false, rows[0]);
    } else if (card === 'artist') {
      const { main, outline } = artist.value;
      drawInk(ctx, main, `${props.songKey}:artist`, opacity, false, rows[0]);
      if (outline) {
        drawInk(
          ctx,
          outline,
          `${props.songKey}:artist:outline`,
          opacity * 0.58,
          true,
          rows[0],
          0.83,
          true
        );
      }
    }
  }

  // Old shards stay over the intact pane until their playback-time fade finishes.
  glass.setTransform(pixelW / w, 0, 0, pixelH / h, 0, 0);
  for (const { line, age } of impactShatters(timeline.value, props.time, props.reduced)) {
    const { cracks, shards } =
      line === current?.line && geometry.value ? geometry.value : geometryFor(line);
    paintGlass(glass);
    const hitLyrics = impactAccompanimentAt(accompaniment.value, props.time - age);
    const shardRows = lyricRows(
      fillsScreen.value ? hitLyrics.length : 0,
      !fillsScreen.value && Boolean(hitLyrics.length)
    );
    drawImpressions(glass, line, cracks, line.words.length, age, shardRows[0]);
    ctx.save();
    applyShock(ctx, age, 10);
    drawShards(ctx, texture, shards, w, h, age, props.reduced);
    ctx.restore();
  }
  centerLyrics.value.forEach((line, index) => {
    drawInk(ctx, line.text, line.key, 0.88, false, rows[index + 1]);
  });
}

function schedule() {
  if (props.active && output.value && !raf)
    raf = requestAnimationFrame(() => {
      raf = 0;
      render();
    });
}

watch([() => props.songKey, () => props.active], () => {
  lastBeat = -Infinity;
  lastTime = -Infinity;
  glyphs.clear();
});
watch(
  [
    () => props.theme,
    () => props.config.impactDistress,
    () => props.config.impactRough,
    fontReady,
    () => frame.value?.line.key
  ],
  () => glyphs.clear()
);
watch([width, height, () => props.controls], updateInset, { flush: 'post' });
watch(() => props.config.customFontData, refreshGlyphs);
watch(
  () => props.config.builtinFontId,
  (fontId) => {
    if (fontId) void loadFontById(fontId).then(refreshGlyphs);
  },
  { immediate: true }
);
function refreshGlyphs() {
  glyphs.clear();
  schedule();
}
watch(
  [
    width,
    height,
    frame,
    activeLyrics,
    scene,
    artist,
    customInkFont,
    () => props.title,
    subtitleHeight,
    fontReady,
    () => props.time,
    () => props.playing,
    () => props.active,
    () => props.climax,
    () => props.reduced,
    () => props.theme,
    () => props.config.impactDistress,
    () => props.config.impactRough,
    () => props.config.impactFill,
    () => props.config.impactUppercase,
    () => props.controls
  ],
  schedule,
  { flush: 'post' }
);

onMounted(() => {
  document.fonts.addEventListener('loadingdone', refreshGlyphs);
  texture = document.createElement('canvas');
  textureContext = texture.getContext('2d');
  unsubscribe = drumDetector.onBeat((info) => {
    if (!props.active || !props.playing || props.reduced) return;
    lastBeat = props.time;
    beatPower = Math.min(1, 0.25 + info.kickEnergy * 0.8 + (info.isStrong ? 0.2 : 0));
    schedule();
  });
  void loadFontById('noto-serif-sc').then(() => {
    fontReady.value = true;
  });
  updateInset();
  schedule();
});
onUnmounted(() => {
  document.fonts.removeEventListener('loadingdone', refreshGlyphs);
  unsubscribe?.();
  cancelAnimationFrame(raf);
});
</script>

<style scoped>
.impact-scene {
  position: absolute;
  inset: 0;
  overflow: hidden;
  box-sizing: border-box;
  --impact-inset: max(24px, var(--safe-area-inset-top, env(safe-area-inset-top)));
  padding-top: var(--impact-inset);
  background: #050911;
}
.impact-controls-visible {
  --impact-inset: min(
    31vh,
    calc(156px + var(--safe-area-inset-bottom, env(safe-area-inset-bottom)))
  );
}
.impact-scene canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}
.impact-subtitles {
  position: absolute;
  left: 8%;
  right: 8%;
  bottom: max(7%, var(--impact-inset));
  max-height: 24%;
  overflow: hidden;
  overflow-wrap: anywhere;
  text-align: center;
  font-size: clamp(12px, 1.4vw, 18px);
  color: #f4f7ff;
  text-shadow: 0 1px 4px #050911;
}
.impact-subtitles p {
  margin: 4px 0;
}
</style>
