<template>
  <div
    ref="songItemRef"
    class="song-item"
    :class="{ 'is-active': isActive }"
    @click="handleItemClick"
    @contextmenu.prevent="handleItemContextMenu"
    @touchstart.passive="handleTouchStart"
    @touchend="handleTouchEnd"
    @touchmove.passive="handleTouchMove"
    @touchcancel="cancelLongPress"
  >
    <slot name="index"></slot>
    <slot name="select" v-if="selectable"></slot>
    <slot name="image"></slot>
    <slot name="content"></slot>
    <slot name="operating"></slot>

  </div>
</template>

<script lang="ts" setup>
import { inject, ref } from 'vue';

import { openLyricMatch } from '@/composables/useLyricMatch';
import {
  type MobileSongActionOrigin,
  useMobileSongActionSurface
} from '@/composables/useMobileSongActionSurface';
import { useMatchNeteasePlay } from '@/hooks/useNeteaseMatchPlay';
import { useSongItem } from '@/hooks/useSongItem';
import type { SongResult } from '@/types/music';



const props = defineProps<{
  item: SongResult;
  selectable?: boolean;
  selected?: boolean;
  canRemove?: boolean;
  isNext?: boolean;
  index?: number;
}>();

const emits = defineEmits<{
  play: [item: SongResult];
  select: [id: string | number, selected: boolean];
  'remove-song': [id: string | number];
}>();

const songItemRef = ref<HTMLElement | null>(null);
const songActionSurface = useMobileSongActionSurface();
const songActionOrigin = inject<MobileSongActionOrigin>('mobileSongActionOrigin', 'mini-player');

// 使用公共逻辑
const {
  playLoading,
  isPlaying,
  isFavorite,
  isDislike,
  artists,
  isActive,
  handleImageLoad,
  playMusicEvent,
  toggleFavorite,
  handlePlayNext,
  handleArtistClick,
  handleAlbumClick,
  activate
} = useSongItem(props);
const { playAsNetease } = useMatchNeteasePlay();

const requestPlay = () => {
  emits('play', props.item);
};

const handleItemClick = () => {
  if (props.selectable) return;
  if (Date.now() < suppressClickUntil) return;
  activate();
  requestPlay();
};

// 处理图片加载
const imageLoad = async (event: Event) => {
  const target = event.target as HTMLImageElement;
  if (!target) return;
  await handleImageLoad(target);
};

// 切换选择状态
const toggleSelect = () => {
  emits('select', props.item.id, !props.selected);
};

// 移动端长按菜单
let longPressTimer: number | null = null;
let suppressClickUntil = 0;

const openMobileActionSheet = () => {
  songActionSurface.open({
    item: props.item,
    isFavorite: isFavorite.value,
    canRemove: props.canRemove,
    origin: songActionOrigin,
    sourceElement: songItemRef.value,
    callbacks: {
      play: requestPlay,
      playNext: handlePlayNext,
      favorite: toggleFavorite,
      remove: () => emits('remove-song', props.item.id),
      gotoArtist: handleArtistClick,
      gotoAlbum: handleAlbumClick,
      matchNetease: () => playAsNetease(props.item),
      matchLyric: () => openLyricMatch(props.item)
    }
  });
};

const handleTouchStart = () => {

  cancelLongPress();
  longPressTimer = window.setTimeout(() => {
    suppressClickUntil = Date.now() + 700;
    activate();
    openMobileActionSheet();
    longPressTimer = null;
  }, 500);
};

const cancelLongPress = () => {
  if (longPressTimer) {
    window.clearTimeout(longPressTimer);
    longPressTimer = null;
  }
};

const handleTouchEnd = () => cancelLongPress();
const handleTouchMove = () => cancelLongPress();

const openItemMenu = (_event: MouseEvent) => {
  openMobileActionSheet();
};

const handleItemContextMenu = () => {
  suppressClickUntil = Date.now() + 700;
  openMobileActionSheet();
};
defineExpose({
  imageLoad,
  toggleSelect,
  handleArtistClick,
  handleAlbumClick,
  openItemMenu,
  playMusicEvent,
  handleItemClick,
  toggleFavorite,
  handlePlayNext,
  playLoading,
  isPlaying,
  isFavorite,
  isDislike,
  artists,
  isActive
});
</script>

<style lang="scss" scoped>
.song-item {
  -webkit-user-select: none;
  -moz-user-select: none;
  -ms-user-select: none;
  user-select: none;
  @apply rounded-[var(--d-radius-lg)] p-3 flex items-center bg-transparent;
  color: var(--d-text-primary);
  cursor: pointer;
  transition:
    background-color 90ms ease,
    transform 90ms cubic-bezier(0.23, 1, 0.32, 1);

  &:active {
    transform: scale(0.99);
  }

  &.is-active {
    /* 点击反馈只做轻微着色:不透明浅灰块叠在深色玻璃面上会变成刺眼白块 */
    background: rgba(var(--accent-color-rgb, 136, 136, 136), 0.12);
  }
}

.text-ellipsis {
  width: 100%;
}

@media (prefers-reduced-motion: reduce) {
  .song-item {
    transition: background-color 120ms ease;
  }

  .song-item:active {
    transform: none;
  }
}
</style>
