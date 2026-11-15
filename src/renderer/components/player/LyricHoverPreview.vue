<template>
  <div class="lyric-hover-preview">
    <div v-if="preview.interlude" class="interlude-dots" role="img" aria-label="间奏">
      <span v-for="dot in 3" :key="dot" />
    </div>
    <div v-else class="preview-lines">
      <div
        v-for="line in preview.lines"
        :key="line.key"
        class="preview-line"
        :class="{ 'is-background': line.background, 'is-duet': line.duet }"
      >
        <div class="preview-original">
          <template v-if="line.words.length">
            <span
              v-for="(word, index) in line.words"
              :key="index"
              class="preview-word"
              :style="{ '--word-progress': `${hoverWordProgress(word, correctedTime) * 100}%` }"
              >{{ word.text }}</span
            >
          </template>
          <template v-else>{{ line.text }}</template>
        </div>
        <template v-if="line.romanizations.length">
          <div
            v-for="(text, index) in line.romanizations"
            :key="index"
            class="preview-roman"
            :lang="text.lang"
          >
            {{ text.text }}
          </div>
        </template>
        <template v-if="line.translations.length">
          <div
            v-for="(text, index) in line.translations"
            :key="index"
            class="preview-translation"
            :lang="text.lang"
          >
            {{ text.text }}
          </div>
        </template>
      </div>
    </div>
    <div class="preview-time">{{ secondToMinute(time) }}</div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

import { correctionTime, getLyricPreviewAtTime } from '@/hooks/MusicHook';
import { secondToMinute } from '@/utils';
import { hoverWordProgress } from '@/utils/lyricHoverPreview';

const props = defineProps<{ time: number }>();
const preview = computed(() => getLyricPreviewAtTime(props.time));
const correctedTime = computed(() => props.time + correctionTime.value);
</script>

<style scoped lang="scss">
.lyric-hover-preview {
  width: max-content;
  max-width: min(640px, 70vw);
  font-family:
    system-ui,
    -apple-system,
    BlinkMacSystemFont,
    'Segoe UI',
    sans-serif;
  font-weight: 400;
  font-style: normal;
  letter-spacing: normal;
  color: #fff;
  white-space: normal;
  text-align: center;
}

.preview-lines {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.preview-line {
  text-align: center;
  overflow-wrap: anywhere;
  line-height: 1.45;
  font-size: 13px;

  &.is-background {
    font-size: 11px;
    opacity: 0.7;
  }
}

.preview-original {
  font-weight: 600;
  white-space: pre-wrap;
}
.preview-word {
  color: transparent;
  background-image: linear-gradient(
    90deg,
    #fff var(--word-progress),
    rgba(255, 255, 255, 0.35) var(--word-progress)
  );
  background-clip: text;
  -webkit-background-clip: text;
}
.preview-roman,
.preview-translation {
  font-size: 0.9em;
  opacity: 0.75;
}
.preview-roman {
  font-style: italic;
}
.preview-time {
  margin-top: 5px;
  font-size: 11px;
  opacity: 0.6;
  font-variant-numeric: tabular-nums;
}

.interlude-dots {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.18em;
  padding: 0.4em 0;
  font-size: 24px;

  > span {
    display: inline-block;
    width: 0.3em;
    height: 0.3em;
    border-radius: 50%;
    background: currentColor;
  }
}
</style>
