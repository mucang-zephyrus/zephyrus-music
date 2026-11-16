/** Current AMLL TTML lyric state. */

import { defineStore } from 'pinia';
import { computed, onScopeDispose, ref, watch } from 'vue';

import { getAmllLyricForSong, resolveAmllSource } from '@/api/amllLyrics';
import type { TtmlLyric } from '@/services/ttmlParser';

import { usePlayerStore } from './player';

export const useAmllStore = defineStore('amll', () => {
  const ttmlLyric = ref<TtmlLyric | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const currentSource = ref<string | null>(null);
  let requestId = 0;
  let currentResource: string | null = null;
  let pendingLoad: Promise<void> | null = null;

  function loadForSong(
    song: Parameters<typeof getAmllLyricForSong>[0] | null | undefined
  ): Promise<void> {
    const source = song ? resolveAmllSource(song) : null;
    const sourceKey = source ? `${source.platform}:${source.songId}` : null;
    const resourceKey = sourceKey ? `${sourceKey}:${song?.lyricsUrl || ''}` : null;
    if (resourceKey && resourceKey === currentResource) {
      if (pendingLoad) return pendingLoad;
      if (ttmlLyric.value) return Promise.resolve();
    }
    requestId += 1;
    const activeRequest = requestId;
    currentResource = resourceKey;

    if (!source) {
      ttmlLyric.value = null;
      currentSource.value = null;
      error.value = null;
      loading.value = false;
      pendingLoad = null;
      return Promise.resolve();
    }

    loading.value = true;
    error.value = null;
    currentSource.value = sourceKey;
    ttmlLyric.value = null;
    const task = getAmllLyricForSong(song!)
      .then((result) => {
        if (activeRequest !== requestId) return;
        ttmlLyric.value = result;
        if (!result) error.value = 'AMLL TTML lyric not found';
      })
      .catch((loadError) => {
        if (activeRequest !== requestId) return;
        ttmlLyric.value = null;
        error.value = loadError instanceof Error ? loadError.message : 'Failed to load AMLL lyric';
      })
      .finally(() => {
        if (activeRequest === requestId) {
          loading.value = false;
          pendingLoad = null;
        }
      });
    pendingLoad = task;
    return task;
  }

  function clear() {
    requestId += 1;
    ttmlLyric.value = null;
    currentSource.value = null;
    loading.value = false;
    error.value = null;
    currentResource = null;
    pendingLoad = null;
  }

  const hasTtml = computed(() => Boolean(ttmlLyric.value?.lines.length));
  const playerStore = usePlayerStore();

  watch(
    [() => playerStore.currentSong, () => playerStore.currentSong?.lyricsUrl],
    () => {
      const song = playerStore.currentSong;
      if (!song) clear();
      else void loadForSong(song);
    },
    { immediate: true }
  );

  const retryUnavailable = () => {
    if (playerStore.currentSong && !ttmlLyric.value && !loading.value) {
      void loadForSong(playerStore.currentSong);
    }
  };
  window.addEventListener('online', retryUnavailable);
  onScopeDispose(() => window.removeEventListener('online', retryUnavailable));

  return {
    ttmlLyric,
    loading,
    error,
    hasTtml,
    currentSource,
    loadForSong,
    clear
  };
});
