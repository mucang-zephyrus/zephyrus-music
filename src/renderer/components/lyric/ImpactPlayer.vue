<template>
  <word-cloud-player
    v-bind="$attrs"
    :overlay-mode="overlayMode || embedded"
    visual-style="impact"
  />
</template>

<script setup lang="ts">
import WordCloudPlayer from '@/components/lyric/WordCloudPlayer.vue';

defineOptions({ inheritAttrs: false });
defineProps<{ overlayMode?: boolean; embedded?: boolean }>();
</script>
