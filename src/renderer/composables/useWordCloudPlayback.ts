import { computed } from 'vue';

import { useWordTimedPlayback } from '@/composables/useWordTimedPlayback';
import { providerCloudInputs, ttmlCloudInputs } from '@/utils/wordCloudInput';
export function useWordCloudPlayback() {
  const playback = useWordTimedPlayback();
  const inputs = computed(() =>
    playback.usingTtml.value && playback.lyric.value
      ? ttmlCloudInputs(playback.lyric.value)
      : providerCloudInputs(playback.displayLines.value, playback.source.value)
  );
  return { inputs, time: playback.correctedTime };
}
