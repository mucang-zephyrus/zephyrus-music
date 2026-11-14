<template>
  <div class="word-cloud-background" :data-background="kind" aria-hidden="true">
    <div
      v-if="kind === 'cover'"
      class="cloud-cover-bg"
      :style="{
        backgroundImage: cover ? `url(${JSON.stringify(cover)})` : undefined,
        backgroundColor: theme
      }"
    />
    <div v-else-if="kind === 'grid'" class="cloud-grid-bg" :style="{ '--grid-color': theme }" />
    <beat-ripple-background
      v-else-if="kind === 'ripple'"
      :theme="theme"
      :paused="paused"
      :reduced="reduced"
      :song-key="songKey || ''"
    />
    <mesh-gradient-background
      v-else-if="kind === 'mesh'"
      :cover-url="cover"
      :paused="paused"
      :static-mode="reduced"
    />
    <liquid-ether
      v-else-if="kind === 'liquid'"
      :colors="colors"
      :paused="paused"
      :resolution="0.35"
      :max-fps="30"
      :max-pixel-ratio="1.5"
      :auto-demo="true"
      :mouse-force="18"
      :auto-speed="1"
      :auto-intensity="3.2"
      :iterations-poisson="16"
      :bfecc="false"
    />
    <ether-fluid-layer
      v-else-if="kind === 'ether'"
      :theme-color="theme"
      :raw-color="rawColor"
      :gray-ratio="grayRatio"
      :paused="paused"
    />
    <div class="cloud-background-wash" :class="{ 'ripple-wash': kind === 'ripple' }" />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

import BeatRippleBackground from '@/components/lyric/BeatRippleBackground.vue';
import EtherFluidLayer from '@/components/lyric/EtherFluidLayer.vue';
import LiquidEther from '@/components/lyric/LiquidEther.vue';
import MeshGradientBackground from '@/components/lyric/MeshGradientBackground.vue';
import { useBackgroundHealthStore } from '@/store/modules/backgroundHealth';
import { probeEtherSupport } from '@/utils/etherFluid';

const props = defineProps<{
  preset: string;
  cover: string;
  theme: string;
  rawColor: string;
  grayRatio: number;
  active: boolean;
  playing: boolean;
  reduced: boolean;
  songKey?: string;
}>();
const health = useBackgroundHealthStore();
const visible = ref(!document.hidden);
const supported = ref(false);
onMounted(() => {
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    supported.value = Boolean(gl);
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    supported.value = false;
  }
  document.addEventListener('visibilitychange', visibility);
});
function visibility() {
  visible.value = !document.hidden;
}
onBeforeUnmount(() => document.removeEventListener('visibilitychange', visibility));
const kind = computed(() => {
  const kind = ['grid', 'mesh', 'cover', 'liquid', 'ether', 'ripple'].includes(props.preset)
    ? props.preset
    : 'cover';
  if (
    !['grid', 'cover', 'ripple'].includes(kind) &&
    (health.degraded || !supported.value || !props.active || !visible.value)
  )
    return 'cover';
  if (kind === 'ether' && !probeEtherSupport()) return 'cover';
  return kind;
});
const paused = computed(() => !props.active || !props.playing || props.reduced || !visible.value);
const colors = computed(() => ['#000000', props.theme, '#ffffff']);
</script>

<style scoped>
.word-cloud-background {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  background: #101215;
}
.cloud-cover-bg {
  position: absolute;
  inset: -60px;
  background-position: center;
  background-size: cover;
  filter: blur(42px) brightness(0.45) saturate(0.8);
}
.cloud-grid-bg {
  position: absolute;
  inset: 0;
  background-color: #111417;
  background-image:
    linear-gradient(color-mix(in srgb, var(--grid-color) 17%, transparent) 1px, transparent 1px),
    linear-gradient(
      90deg,
      color-mix(in srgb, var(--grid-color) 17%, transparent) 1px,
      transparent 1px
    );
  background-size: 36px 36px;
}
.cloud-background-wash {
  position: absolute;
  inset: 0;
  /* Keep the brightest possible engine frame below the text palette's contrast bound. */
  background: radial-gradient(ellipse at center, #080b10b3, #080b10dc);
}
.cloud-background-wash.ripple-wash {
  /* Colored dots stay below the same foreground contrast bound, with clearer rings. */
  background: radial-gradient(ellipse at center, #080b1099, #080b10b8);
}
</style>
