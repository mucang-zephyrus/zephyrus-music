<template>
  <teleport to="body" :disabled="overlayMode">
    <transition name="word-cloud-mobile-fade">
      <div
        v-if="isVisible"
        class="word-cloud-mobile-player player-style-surface"
        :class="{
          'overlay-mode': overlayMode,
          'dot-matrix-player': visualStyle === 'dotMatrix',
          'player-style-customized': isCustom,
          'player-style-custom-font': customFontActive,
          'player-style-custom-background': customBackgroundActive
        }"
        :style="{
          ...styleVars,
          '--player-style-resolved-font': cloudFont,
          background: visualStyle === 'dotMatrix' ? '#ffffff' : '#101215',
          ...lyricsSwipeStyle
        }"
        @click="handleTapToggle"
        @pointerdown.capture="
          onLyricsSwipePointerDown($event);
          commentsSwipe.onPointerDown($event);
        "
        @pointermove.capture="
          onLyricsSwipePointerMove($event);
          commentsSwipe.onPointerMove($event);
        "
        @pointerup.capture="
          onLyricsSwipePointerUp($event);
          commentsSwipe.onPointerUp($event);
        "
        @pointercancel.capture="
          onLyricsSwipePointerCancel($event);
          commentsSwipe.onPointerCancel($event);
        "
        @touchstart="onSwipeCloseTouchStart"
        @touchend="onSwipeCloseTouchEnd"
      >
        <word-cloud-background
          v-if="visualStyle === 'wordCloud'"
          :preset="String(styleCfg.cloudBackground || 'cover')"
          :cover="coverUrl"
          :theme="themeColor"
          :raw-color="averageThemeColor"
          :gray-ratio="coverGrayRatio"
          :active="sceneActive"
          :playing="playerStore.isPlaying"
          :reduced="reduceMotion"
          :song-key="cloudSong.key"
        />
        <dot-matrix-scene
          v-if="visualStyle === 'dotMatrix'"
          :inputs="cloudPlayback.inputs.value"
          :time="cloudPlayback.time.value"
          :playing="playerStore.isPlaying"
          :active="sceneActive"
          :font="cloudFont"
          :config="styleCfg"
          :song="cloudSong"
          :show-translation="auxiliaryConfig.showTranslation"
          :show-roman="auxiliaryConfig.showRomanization"
          :reduced="reduceMotion"
          :style="lyricsUnderlayStyle"
        />
        <impact-scene
          v-else-if="visualStyle === 'impact'"
          :title="playMusic?.name || ''"
          :artists="trackArtists"
          :duration="allTime"
          :font="selectedFontFamily"
          :inputs="cloudPlayback.inputs.value"
          :time="cloudPlayback.time.value"
          :playing="playerStore.isPlaying"
          :active="sceneActive"
          :controls="controlsVisible && !overlayMode"
          :song-key="cloudSong.key"
          :theme="themeColor"
          :climax="styleEngine.isInClimax"
          :reduced="reduceMotion"
          :config="styleCfg"
          :style="lyricsUnderlayStyle"
        />
        <word-cloud-scene
          v-else
          :inputs="cloudPlayback.inputs.value"
          :time="cloudPlayback.time.value"
          :duration="allTime"
          :playing="playerStore.isPlaying"
          :active="sceneActive"
          :controls="controlsVisible && !overlayMode"
          :font="cloudFont"
          :config="styleCfg"
          :theme="themeColor"
          :song="cloudSong"
          :show-translation="auxiliaryConfig.showTranslation"
          :show-roman="auxiliaryConfig.showRomanization"
          :reduced="reduceMotion"
          :style="lyricsUnderlayStyle"
        />

        <!-- 顶部控件（tap 弹出） -->
        <transition name="ctrl-fade">
          <div v-show="controlsVisible && !overlayMode" class="top-controls no-toggle">
            <div class="ctrl-btn" @click="close">
              <i class="ri-arrow-down-s-line"></i>
            </div>
            <div style="flex: 1"></div>
            <div class="ctrl-btn" @click="showPlayerSettings = true">
              <i class="ri-more-2-fill"></i>
            </div>
          </div>
        </transition>

        <!-- 半透明遮罩 + 滚动歌词（点击歌词时显示） -->
        <div
          v-show="showFullLyrics || lyricsSwipePreview || risePreviewing"
          class="lyrics-mask"
          :style="riseMaskStyle || lyricsBackdropStyle"
          @click="closeImmersive()"
        ></div>
        <mobile-comments-overlay :gesture="commentsSwipe" />
        <div
          v-show="showFullLyrics || lyricsSwipePreview || risePreviewing"
          class="scrolling-lyrics-overlay"
          :style="riseOverlayStyle || lyricsOverlayStyle"
        >
          <mobile-scrolling-lyrics
            v-if="immersiveSurfaceMode === 'lyrics'"
            class="scrolling-lyrics-content"
            :back-closes="showFullLyrics"
            :active="showFullLyrics || lyricsSwipePreview || risePreviewing"
            @close="closeImmersive"
            @interact="showControls"
            @generatePoster="handleGeneratePoster"
          />
          <!-- 沉浸态内容区替换：设置/播放列表就地取代歌词区（按钮为切换型，带显隐动画） -->
          <Transition name="ip-surface">
            <div
              v-if="showFullLyrics && immersiveSurfaceMode === 'settings'"
              class="immersive-panel"
              :style="panelSurfaceVars"
            >
              <mobile-player-settings
                embedded
                :visible="true"
                @update:visible="toggleImmersiveSurface('settings')"
              />
            </div>
          </Transition>
          <Transition name="ip-surface">
            <div
              v-if="showFullLyrics && immersiveSurfaceMode === 'playlist'"
              class="immersive-panel"
              :style="panelSurfaceVars"
            >
              <immersive-playlist-panel />
            </div>
          </Transition>
          <!-- 沉浸歌词顶部栏：让位顶部关闭条，显隐随控件栏 -->
          <div
            class="immersive-header-wrap"
            :class="{
              'header-hidden': showFullLyrics && immersiveSurfaceMode === 'settings'
            }"
            :style="immersiveHeaderDragStyle"
            @pointerdown="immersiveHeaderCollapse.onHeaderPointerDown"
            @pointermove="immersiveHeaderCollapse.onHeaderPointerMove"
            @pointerup="immersiveHeaderCollapse.onHeaderPointerUp"
            @pointercancel="immersiveHeaderCollapse.onHeaderPointerCancel"
          >
            <lyric-immersive-header
              :cover-url="playMusic?.picUrl || ''"
              :title="playMusic?.name || 'Zephyrus'"
              :progress="immersiveProgress"
              :settings-active="immersiveSurfaceMode === 'settings'"
              entrance="rise"
              @show-settings="toggleImmersiveSurface('settings')"
              @return-cover="closeImmersive()"
            />
          </div>
        </div>

        <!-- 底部控件（3秒自动隐藏） -->
        <mobile-controls-area
          :visible="controlsVisible && !overlayMode"
          :is-fullscreen="showFullLyrics"
          @close="closeImmersive"
          @showPlaylist="openPlaylist"
          @show-settings="showPlayerSettings = true"
          @interact="showControls"
        />
      </div>
    </transition>
  </teleport>

  <!-- 播放设置弹窗 -->
  <mobile-player-settings v-model:visible="showPlayerSettings" />

  <!-- 歌词海报分享弹窗 -->
  <poster-share-modal
    v-model:visible="showPosterModal"
    :lyrics="selectedLyrics"
    :subject="posterSubject"
  />
</template>

<script setup lang="ts">
import { usePreferredReducedMotion } from '@vueuse/core';
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';

import MobileCommentsOverlay from '@/components/comment/MobileCommentsOverlay.vue';
import DotMatrixScene from '@/components/lyric/DotMatrixScene.vue';
import ImpactScene from '@/components/lyric/ImpactScene.vue';
import LyricImmersiveHeader from '@/components/lyric/LyricImmersiveHeader.vue';
import MobileControlsArea from '@/components/lyric/MobileControlsArea.vue';
import MobileScrollingLyrics from '@/components/lyric/MobileScrollingLyrics.vue';
import WordCloudBackground from '@/components/lyric/WordCloudBackground.vue';
import WordCloudScene from '@/components/lyric/WordCloudScene.vue';
import ImmersivePlaylistPanel from '@/components/player/ImmersivePlaylistPanel.vue';
import MobilePlayerSettings from '@/components/player/MobilePlayerSettings.vue';
import PosterShareModal from '@/components/share/PosterShareModal.vue';
import { useCommentsPage } from '@/composables/useCommentsPage';
import {
  immersiveSurfaceMode,
  toggleImmersiveSurface,
  useStyleImmersiveHeaderCollapse,
  useStyleImmersiveLyrics
} from '@/composables/useImmersiveLyrics';
import { useLyricSwipeGesture } from '@/composables/useLyricSwipeGesture';
import { useMobilePlayerTransition } from '@/composables/useMobilePlayerTransition';
import { usePlayerStyleAppearance } from '@/composables/usePlayerStyleAppearance';
import { usePosterShare } from '@/composables/usePosterShare';
import { useSwipeClose } from '@/composables/useSwipeClose';
import { useTapToggle } from '@/composables/useTapToggle';
import { useWordCloudPlayback } from '@/composables/useWordCloudPlayback';
import { allTime, playMusic } from '@/hooks/MusicHook';
import { usePlayerStore } from '@/store/modules/player';
import { useStyleEngineStore } from '@/store/modules/styleEngine';
import { DEFAULT_LYRIC_CONFIG } from '@/types/lyric';

// ==================== Props ====================

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  background: { type: String, default: '' },
  overlayMode: { type: Boolean, default: false },
  // These canvas styles share controls, gestures, and immersive panels.
  visualStyle: { type: String as () => 'wordCloud' | 'dotMatrix' | 'impact', default: 'wordCloud' }
});

const emit = defineEmits(['update:modelValue']);

// ==================== Store & Hooks ====================

const playerStore = usePlayerStore();
const styleEngine = useStyleEngineStore();

const { controlsVisible, handleTapToggle, showControls } = useTapToggle({
  onDoubleClick: () => {
    openLyricsAnimated();
  }
});

const commentsSwipe = useCommentsPage();
const showFullLyrics = ref(false);
const {
  style: lyricsSwipeStyle,
  overlayStyle: lyricsOverlayStyle,
  underlayStyle: lyricsUnderlayStyle,
  backdropStyle: lyricsBackdropStyle,
  previewing: lyricsSwipePreview,
  onPointerDown: onLyricsSwipePointerDown,
  onPointerMove: onLyricsSwipePointerMove,
  onPointerUp: onLyricsSwipePointerUp,
  onPointerCancel: onLyricsSwipePointerCancel,
  animateOpen: openLyricsAnimated,
  animateClose: closeLyricsAnimated
} = useLyricSwipeGesture({
  isOpen: () => showFullLyrics.value,
  suppressed: () => playerStore.fullCommentsVisible,
  onOpen: () => {
    showFullLyrics.value = true;
    playerStore.setFullLyricsVisible(true);
    showControls();
  },
  onClose: () => {
    resetOnGestureClose();
    showFullLyrics.value = false;
    playerStore.setFullLyricsVisible(false);
  }
});
// 沉浸歌词 rise 路径：信息栏上拉手势经共享模块调起，关闭下沉镜像；横滑路径保持现状
const {
  risePreviewing,
  immersiveProgress,
  riseOverlayStyle,
  riseMaskStyle,
  closeImmersive,
  resetOnGestureClose
} = useStyleImmersiveLyrics({
  showFullLyrics,
  closeAnimated: closeLyricsAnimated,
  swipePreviewing: () => lyricsSwipePreview.value
});
const immersiveHeaderCollapse = useStyleImmersiveHeaderCollapse(closeImmersive);
const immersiveHeaderDragStyle = computed(() =>
  immersiveHeaderCollapse.dragOffset.value > 0
    ? { transform: `translate3d(0, ${immersiveHeaderCollapse.dragOffset.value.toFixed(1)}px, 0)` }
    : undefined
);
// 沉浸面板几何：控件栏可见时夹在顶栏（safe+66 起 44px 高）与底部控件栏之间，
// 控件栏隐藏后才扩展到全屏；渐隐截断只保留边缘小截
const panelSurfaceVars = computed(() => ({
  '--ip-inset-top': controlsVisible.value ? 'calc(var(--safe-area-inset-top, 0px) + 120px)' : '0px',
  '--ip-inset-bottom': controlsVisible.value
    ? 'calc(var(--safe-area-inset-bottom, 0px) + 170px)'
    : '0px',
  '--ip-fade-top': controlsVisible.value ? '18px' : '24px',
  '--ip-fade-bottom': controlsVisible.value ? '18px' : '24px'
}));
const { onTouchStart: onSwipeCloseTouchStart, onTouchEnd: onSwipeCloseTouchEnd } = useSwipeClose({
  shouldClose: () => !showFullLyrics.value && !playerStore.fullCommentsVisible,
  onClose: () => close()
});

// 海报分享
const { showPosterModal, selectedLyrics, posterSubject, handleGeneratePoster } = usePosterShare();
const {
  config: styleCfg,
  styleVars,
  isCustom,
  customBackgroundActive,
  selectedFontFamily,
  themeColor,
  averageThemeColor,
  coverGrayRatio,
  customFontActive
} = usePlayerStyleAppearance(props.visualStyle);
const cloudPlayback = useWordCloudPlayback();

if (props.visualStyle === 'impact') {
  watch(
    () => [props.modelValue, playerStore.currentSong?.id] as const,
    ([visible, songId]) => {
      if (visible && songId) void styleEngine.loadClimaxData(String(songId));
    },
    { immediate: true }
  );
}

watch(
  () => playerStore.fullLyricsVisible,
  (visible) => {
    if (!visible && showFullLyrics.value) closeLyricsAnimated();
  }
);

onMounted(() => {
  styleEngine.syncFromPlayerStore();
  styleEngine.syncCoverColors();
});

const isVisible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value)
});
const motionPreference = usePreferredReducedMotion();
const reduceMotion = computed(() => motionPreference.value === 'reduce');
const showPlayerSettings = computed({
  get: () => playerStore.playerSettingsVisible,
  set: (value) => playerStore.setPlayerSettingsVisible(value)
});
const sceneActive = computed(
  () =>
    isVisible.value &&
    !playerStore.fullCommentsVisible &&
    !showFullLyrics.value &&
    !showPlayerSettings.value
);
const cloudFont = computed(() => selectedFontFamily.value || 'system-ui, sans-serif');
const coverUrl = computed(
  () =>
    playMusic.value?.picUrl || playMusic.value?.al?.picUrl || playMusic.value?.album?.picUrl || ''
);
const trackArtists = computed(() =>
  (playMusic.value?.ar || playMusic.value?.artists || []).map((artist) => artist.name)
);
const cloudSong = computed(() => ({
  title: playMusic.value?.name || 'Zephyrus',
  artist: trackArtists.value.join(' / '),
  album: playMusic.value?.al?.name || playMusic.value?.album?.name || '',
  key: `${playMusic.value?.platform || 'netease'}:${playMusic.value?.id || ''}`
}));
const auxiliaryConfig = ref({
  showTranslation: DEFAULT_LYRIC_CONFIG.showTranslation,
  showRomanization: DEFAULT_LYRIC_CONFIG.showRomanization
});
function loadAuxiliaryConfig() {
  try {
    const saved = JSON.parse(localStorage.getItem('music-full-config') || '{}');
    auxiliaryConfig.value = {
      showTranslation: saved.showTranslation !== false,
      showRomanization: saved.showRomanization === true
    };
  } catch {
    /* Keep current display preferences when storage is unavailable. */
  }
}
onMounted(() => {
  loadAuxiliaryConfig();
  window.addEventListener('music-full-config-updated', loadAuxiliaryConfig);
  window.addEventListener('storage', loadAuxiliaryConfig);
});
onUnmounted(() => {
  window.removeEventListener('music-full-config-updated', loadAuxiliaryConfig);
  window.removeEventListener('storage', loadAuxiliaryConfig);
});
// ==================== 播放控制 ====================

function close() {
  useMobilePlayerTransition().close(0, () => {
    isVisible.value = false;
    playerStore.setMusicFull(false);
  });
}

function openPlaylist() {
  // 歌词页内：就地切换为队列面板；其他分页（封面/评论）：先跳转歌词页再打开
  if (showFullLyrics.value) {
    toggleImmersiveSurface('playlist');
    return;
  }
  if (playerStore.fullCommentsVisible) playerStore.setFullCommentsVisible(false);
  openLyricsAnimated();
  toggleImmersiveSurface('playlist');
}
</script>

<style lang="scss" scoped>
.word-cloud-mobile-player {
  position: fixed;
  inset: 0;
  z-index: 9999;
  overflow: hidden;
  background: #101215;
  color: #fff;
}
.word-cloud-mobile-player.overlay-mode {
  position: absolute;
  z-index: 0;
}
.dot-matrix-player {
  color: #181818;
  font-family: 'SFMono-Regular', Consolas, 'Microsoft YaHei', monospace;
}
.dot-matrix-player .top-controls .ctrl-btn {
  color: #181818;
  background: rgba(255, 255, 255, 0.94);
  border: 1px solid #dedede;
  border-radius: 4px;
}
.dot-matrix-player :deep(.mobile-controls) {
  --player-ink-rgb: 24, 24, 24;
  --accent-color: #181818;
  --text-color-active: #181818;
  background: rgba(255, 255, 255, 0.94);
  border-radius: 0;
}
.dot-matrix-player :deep(.mobile-controls .info-flight-copy strong) {
  color: #181818;
}
.dot-matrix-player :deep(.mobile-controls .info-flight-copy span) {
  color: #666;
}
.top-controls {
  z-index: 10;
}
/* 顶部控件 */
.top-controls {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  display: flex;
  align-items: center;
  padding: calc(var(--safe-area-inset-top, 0px) + 16px) 20px 0;

  .ctrl-btn {
    @apply flex items-center justify-center;
    @apply w-10 h-10 rounded-full;
    @apply text-xl;
    color: #fff;
    background: rgba(255, 255, 255, 0.1);
    cursor: pointer;
    transition: transform var(--m-duration-press, 160ms) var(--m-ease-out, ease-out);

    &:active {
      transform: scale(0.97);
    }
  }
}

/* 过渡动画 */
.word-cloud-mobile-fade-enter-active,
.word-cloud-mobile-fade-leave-active {
  transition: opacity 0.3s var(--m-ease-out, ease);
}

.word-cloud-mobile-fade-enter-from,
.word-cloud-mobile-fade-leave-to {
  opacity: 0;
}

.ctrl-fade-enter-active,
.ctrl-fade-leave-active {
  transition: opacity 0.2s var(--m-ease-out, ease);
}

.ctrl-fade-enter-from,
.ctrl-fade-leave-to {
  opacity: 0;
}

/* 减少动画 */
@media (prefers-reduced-motion: reduce) {
  .word-cloud-mobile-fade-enter-active,
  .word-cloud-mobile-fade-leave-active,
  .ctrl-fade-enter-active,
  .ctrl-fade-leave-active {
    transition: opacity 0.2s ease;
  }
}

/* 半透明遮罩 */
.lyrics-mask {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 8;
  cursor: pointer;
}

.scrolling-lyrics-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 40;
  color: #fff;
}

.scrolling-lyrics-content {
  width: 100%;
  height: 100%;
}
</style>
