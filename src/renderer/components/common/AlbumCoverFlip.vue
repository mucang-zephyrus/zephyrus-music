<template>
  <div
    ref="rootRef"
    class="album-cover-flip"
    :class="{ 'uses-keyboard': keyboardNavigation }"
    tabindex="-1"
    @pointerdown="keyboardNavigation = false"
    @keydown="keyboardNavigation = true"
    @keydown.esc="onEscape"
  >
    <div ref="cardRef" class="album-cover-card">
      <button
        ref="frontRef"
        type="button"
        class="album-cover-face album-cover-front"
        :inert="flipped"
        :aria-hidden="flipped"
        :aria-label="`${title} · ${descriptionLabel || t('comp.musicList.showAlbumDescription')}`"
        :aria-expanded="flipped"
        @click="setFlipped(!flipped)"
      >
        <img :src="src" alt="" draggable="false" />
        <span class="album-cover-hint" aria-hidden="true">
          <i class="ri-information-line" />
        </span>
      </button>
      <section
        class="album-cover-face album-cover-back"
        :inert="!flipped"
        :aria-hidden="!flipped"
        :aria-label="descriptionLabel || t('comp.musicList.albumDescription')"
      >
        <img class="album-description-background" :src="src" alt="" draggable="false" />
        <div class="album-description-scrim" />
        <div class="album-description-heading">
          <span>{{ descriptionLabel || t('comp.musicList.albumDescription') }}</span>
          <button
            ref="backRef"
            type="button"
            class="album-cover-return"
            :aria-label="t('comp.musicList.backToAlbumCover')"
            @click="setFlipped(!flipped)"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="m10 6-6 6 6 6M4 12h16"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
            <span>{{ t('comp.musicList.albumCover') }}</span>
          </button>
        </div>
        <div
          ref="descriptionRef"
          class="album-description-scroll"
          :tabindex="flipped ? 0 : -1"
          :aria-label="descriptionLabel || t('comp.musicList.albumDescription')"
          @wheel.stop
          @touchmove.stop
        >
          <p>{{ description || t('comp.musicList.noAlbumDescription') }}</p>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onDeactivated, ref } from 'vue';
import { useI18n } from 'vue-i18n';

defineProps<{ src: string; title: string; description: string; descriptionLabel?: string }>();

const { t } = useI18n();
const flipped = ref(false);
const keyboardNavigation = ref(false);
const rootRef = ref<HTMLElement>();
const cardRef = ref<HTMLElement>();
const frontRef = ref<HTMLButtonElement>();
const backRef = ref<HTMLButtonElement>();
const descriptionRef = ref<HTMLElement>();
let angle = 0;
let velocity = 0;
let frame = 0;
let lastTime = 0;
let pendingFocus = false;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

function draw() {
  if (cardRef.value) cardRef.value.style.transform = `rotateY(${angle}deg)`;
  // 背面尚未转入视野时浏览器会拒绝 focus；经过中线后再移交焦点。
  if (pendingFocus && (flipped.value ? angle < -90 : angle > -90)) {
    const button = flipped.value ? backRef.value : frontRef.value;
    button?.focus({ preventScroll: true });
    if (document.activeElement === button) pendingFocus = false;
  }
}

function settle() {
  cancelAnimationFrame(frame);
  frame = 0;
  angle = flipped.value ? -180 : 0;
  velocity = 0;
  draw();
}

function step(now: number) {
  const dt = Math.min((now - lastTime) / 1000, 0.04);
  lastTime = now;
  const target = flipped.value ? -180 : 0;
  // 临界阻尼解析积分；中途翻回保留当前角度和速度，不重播入场。
  const offset = angle - target;
  const impulse = velocity + 20 * offset;
  const decay = Math.exp(-20 * dt);
  angle = target + (offset + impulse * dt) * decay;
  velocity = (velocity - 20 * impulse * dt) * decay;
  draw();
  if (Math.abs(angle - target) < 0.02 && Math.abs(velocity) < 0.1) {
    settle();
  } else {
    frame = requestAnimationFrame(step);
  }
}

function setFlipped(value: boolean) {
  flipped.value = value;
  pendingFocus = true;
  if (reducedMotion.matches) {
    settle();
  } else if (!frame) {
    lastTime = performance.now();
    frame = requestAnimationFrame(step);
  }
  void nextTick(() => {
    if (flipped.value !== value) return;
    if (value && descriptionRef.value) descriptionRef.value.scrollTop = 0;
    draw();
    if (pendingFocus) rootRef.value?.focus({ preventScroll: true });
  });
}

function onEscape(event: KeyboardEvent) {
  if (!flipped.value) return;
  event.stopPropagation();
  setFlipped(false);
}

reducedMotion.addEventListener('change', settle);
onDeactivated(() => {
  pendingFocus = false;
  flipped.value = false;
  settle();
});
onBeforeUnmount(() => {
  cancelAnimationFrame(frame);
  reducedMotion.removeEventListener('change', settle);
});
</script>

<style scoped lang="scss">
.album-cover-flip {
  position: relative;
  perspective: 1000px;
  flex-shrink: 0;
  outline: none;
}

.album-cover-card {
  width: 100%;
  height: 100%;
  border-radius: inherit;
  transform-style: preserve-3d;
}

.album-cover-face {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  margin: 0;
  padding: 0;
  overflow: hidden;
  border: 0;
  border-radius: inherit;
  background: #242426;
  color: #fff;
  box-shadow: 0 18px 44px rgba(0, 0, 0, 0.35);
  -webkit-backface-visibility: hidden;
  backface-visibility: hidden;
}

.album-cover-front {
  cursor: pointer;
  transform: rotateY(0deg);

  > img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
}

.album-cover-hint {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  border: 1px solid rgba(255, 255, 255, 0.22);
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.32);
  color: #fff;
  font-size: 18px;
}

.album-cover-hint {
  position: absolute;
  right: 12px;
  bottom: 12px;
}

.album-cover-front:active .album-cover-hint,
.album-cover-return:active {
  opacity: 0.6;
}

.album-cover-front:focus-visible,
.uses-keyboard .album-cover-return:focus-visible,
.album-description-scroll:focus-visible {
  outline: 2px solid #fff;
  outline-offset: -4px;
}

.album-cover-back {
  display: flex;
  flex-direction: column;
  padding: 20px;
  transform: rotateY(180deg);
}

.album-description-background,
.album-description-scrim {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.album-description-background {
  object-fit: cover;
  filter: blur(22px);
  transform: scale(1.2);
}

.album-description-scrim {
  background: rgba(10, 10, 14, 0.65);
}

.album-description-heading {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-shrink: 0;
  min-height: 24px;
  margin-bottom: 0;
  padding-right: 6px;
  font-size: 14px;
  font-weight: 600;
}

.album-cover-return {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  flex-shrink: 0;
  min-width: 44px;
  min-height: 44px;
  margin: -10px 0;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  outline: none;
  color: rgba(255, 255, 255, 0.72);
  font-size: 12px;
  font-weight: 400;
  cursor: pointer;
  transition: color 120ms ease;

  @media (hover: hover) {
    &:hover {
      color: #fff;
    }
  }
}

.album-description-scroll {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  touch-action: pan-y;
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 255, 255, 0.32) transparent;
  padding: 12px 6px 28px 0;
  border-radius: 3px;
  font-size: 13px;
  line-height: 1.75;
  text-align: left;
  user-select: text;
  -webkit-mask-image: linear-gradient(
    to bottom,
    transparent,
    #000 12px,
    #000 calc(100% - 28px),
    transparent
  );
  mask-image: linear-gradient(
    to bottom,
    transparent,
    #000 12px,
    #000 calc(100% - 28px),
    transparent
  );

  p {
    margin: 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
}
</style>
