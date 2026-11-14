<template>
  <div v-if="visible && target?.mergeInfo.rules.length" class="lyric-merge-notice">
    <button
      type="button"
      @click.stop="openLyricMergeFeedback(target)"
      @pointerdown.stop
      @touchstart.stop
    >
      {{ t('comp.smartLyricMerge.notice') }}
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useI18n } from 'vue-i18n';

import {
  currentLyricMergeContext,
  type LyricMergeContext,
  openLyricMergeFeedback
} from '@/services/lyricMergePolicy';

const props = withDefaults(
  defineProps<{ visible?: boolean; context?: LyricMergeContext | null }>(),
  { visible: true }
);
const { t } = useI18n();
const target = computed(() =>
  props.context === undefined ? currentLyricMergeContext.value : props.context
);
</script>

<style scoped>
.lyric-merge-notice {
  padding: 28px 0 36px;
  width: 100%;
}
button {
  display: block;
  max-width: 34em;
  padding: 8px 0;
  border: 0;
  background: none;
  color: inherit;
  opacity: 0.65;
  font-family: inherit;
  font-weight: 400;
  font-size: 12px;
  line-height: 1.7;
  text-align: inherit;
  cursor: pointer;
  white-space: normal;
}
button:hover,
button:focus-visible {
  opacity: 1;
}
button:focus-visible {
  outline: 2px solid currentColor;
  outline-offset: 5px;
  border-radius: 3px;
}
button:active {
  opacity: 0.45;
}
</style>
