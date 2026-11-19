<template>
  <word-cloud-player v-bind="$attrs" visual-style="impact" />
</template>

<script setup lang="ts">
import WordCloudPlayer from '@/components/lyric/WordCloudPlayer.vue';

defineOptions({ inheritAttrs: false });
</script>
