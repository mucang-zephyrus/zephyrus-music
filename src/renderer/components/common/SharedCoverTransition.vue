<template>
  <Teleport to="body">
    <div
      v-if="layer"
      class="shared-cover-transition"
      :style="{
        width: `${layer.width}px`,
        height: `${layer.height}px`,
        borderRadius: `${Math.max(0, layer.radius)}px`,
        transform: `translate3d(${layer.x}px, ${layer.y}px, 0)`
      }"
      aria-hidden="true"
    >
      <span
        class="cover-shadow"
        :style="{ boxShadow: layer.sourceShadow, opacity: 1 - shadowProgress }"
      />
      <span
        class="cover-shadow"
        :style="{ boxShadow: layer.targetShadow, opacity: shadowProgress }"
      />
      <img
        :src="layer.src"
        alt=""
        draggable="false"
        referrerpolicy="no-referrer"
        @error="cancelSharedCoverTransition()"
      />
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue';

import {
  cancelSharedCoverTransition,
  useSharedCoverTransition
} from '@/composables/useSharedCoverTransition';

const { layer } = useSharedCoverTransition();
const shadowProgress = computed(() => Math.min(1, Math.max(0, layer.value?.shadowProgress ?? 0)));
const onResize = () => cancelSharedCoverTransition();
const onVisibilityChange = () => {
  if (document.visibilityState === 'hidden') cancelSharedCoverTransition();
};
onMounted(() => {
  window.addEventListener('resize', onResize);
  document.addEventListener('visibilitychange', onVisibilityChange);
});
onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize);
  document.removeEventListener('visibilitychange', onVisibilityChange);
  cancelSharedCoverTransition();
});
</script>

<style scoped>
.shared-cover-transition {
  position: fixed;
  top: 0;
  left: 0;
  z-index: 450;
  display: block;
  pointer-events: none;
  will-change: transform, width, height;
}

.cover-shadow,
.shared-cover-transition > img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border-radius: inherit;
}

.cover-shadow {
  will-change: opacity;
}

.shared-cover-transition > img {
  display: block;
  object-fit: cover;
}
</style>
