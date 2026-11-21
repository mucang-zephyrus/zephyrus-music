<template>
  <div
    class="local-music-page"
    :class="{ 'is-embedded': embedded, 'drop-target': dropActive }"
    @dragover.prevent="onDragOver"
    @dragleave.self="dropActive = false"
    @drop.prevent="onDrop"
  >
    <!-- ==================== 移动端（Capacitor） ==================== -->
    <div
      v-if="isMobileNative"
      ref="scrollRef"
      class="lm-scroll"
      :class="{ 'is-embedded': embedded }"
      @scroll.passive="onScroll"
    >
      <glow-tabs
        v-if="localMusicStore.musicList.length > 0"
        v-model="activeTab"
        :tabs="tabs.map((tab) => ({ key: tab.key, label: tab.label }))"
        :page-path="embedded ? '/list' : '/local-music'"
        full-width
        class="tab-bar-glow"
      />

      <!-- 网页版:本地文件导入(会话级,免扫描) -->
      <div v-if="isWebBrowser" class="web-import-bar">
        <button class="web-import-btn" @click="audioFileInput?.click()">
          <i class="ri-upload-2-line" />
          导入音乐文件
        </button>
        <button
          v-if="sessionFiles.size > 0"
          class="web-import-btn web-import-btn--ghost"
          :disabled="reparseBusy"
          @click="reparseSessionFiles"
        >
          <i :class="reparseBusy ? 'ri-loader-4-line animate-spin' : 'ri-refresh-line'" />
          {{
            reparseBusy ? `重新解析中 ${reparseProgress}/${sessionFiles.size}` : '重新解析元数据'
          }}
        </button>
        <input
          ref="audioFileInput"
          type="file"
          accept="audio/*"
          multiple
          hidden
          @change="onAudioFilePick"
        />
      </div>

      <!-- Scanning progress -->
      <div v-if="localMusicStore.scanning" class="scan-progress">
        <n-spin size="small" />
        <span>{{ t('localMusic.scanning') }} ({{ localMusicStore.scanProgress }})</span>
      </div>

      <!-- Empty state -->
      <div
        v-if="!localMusicStore.scanning && localMusicStore.musicList.length === 0"
        class="empty-state"
      >
        <i class="ri-folder-music-fill empty-icon" />
        <p class="empty-text">{{ t('localMusic.emptyState') }}</p>
        <button
          class="empty-action"
          @click="isWebBrowser ? audioFileInput?.click() : handleAddFolder()"
        >
          <i :class="isWebBrowser ? 'ri-upload-2-line' : 'ri-folder-add-line'" />
          {{ isWebBrowser ? '导入音乐文件' : t('localMusic.scanFolder') }}
        </button>
      </div>

      <!-- Content -->
      <div v-else-if="!localMusicStore.scanning" class="content-area">
        <!-- Songs tab -->
        <template v-if="activeTab === 'songs'">
          <div v-if="displayedSongResults.length === 0" class="no-results">
            <i class="ri-search-line" />
            <p>{{ t('localMusic.search') }}</p>
          </div>
          <div v-else class="song-list">
            <song-item
              v-for="(item, index) in displayedSongResults"
              :key="item.id"
              :item="item"
              :index="index"
              @play="handlePlaySong"
            />
            <div class="bottom-spacer" />
          </div>
        </template>

        <!-- Artists tab -->
        <template v-else-if="activeTab === 'artists'">
          <div class="artist-grid">
            <button
              v-for="artist in artistList"
              :key="artist.name"
              class="artist-card"
              @click="enterDetailView('artist', artist.name)"
            >
              <div class="artist-avatar">{{ artist.name.charAt(0).toUpperCase() }}</div>
              <p class="artist-name">{{ artist.name }}</p>
              <p class="artist-count">{{ artist.count }} {{ t('localMusic.tabSongs') }}</p>
            </button>
          </div>
          <div class="bottom-spacer" />
        </template>

        <!-- Albums tab -->
        <template v-else-if="activeTab === 'albums'">
          <div class="album-grid">
            <button
              v-for="album in albumList"
              :key="album.name"
              class="album-card"
              @click="enterDetailView('album', album.name)"
            >
              <div class="album-cover">
                <img v-if="album.cover" :src="album.cover" :alt="album.name" />
                <i v-else class="ri-disc-line" />
              </div>
              <p class="album-name">{{ album.name }}</p>
              <p class="album-artist">{{ album.artist }}</p>
            </button>
          </div>
          <div class="bottom-spacer" />
        </template>
      </div>
    </div>

    <div v-else class="flex h-full flex-col items-center justify-center px-8 text-center">
      <div
        class="mb-6 flex h-24 w-24 items-center justify-center rounded-3xl bg-[var(--accent-color)]/10"
      >
        <i class="ri-folder-music-fill text-5xl text-[var(--accent-color)] opacity-60" />
      </div>
      <p class="max-w-xs text-sm leading-relaxed text-neutral-500 dark:text-neutral-400">
        {{ t('localMusic.desktopOnly') }}
      </p>
    </div>

    <!-- Folder manager（底部玻璃 sheet） -->
    <Teleport to="body">
      <Transition name="folder-sheet">
        <div
          v-if="showFolderManager"
          class="folder-sheet-overlay"
          @click.self="showFolderManager = false"
        >
          <div class="folder-sheet">
            <div class="folder-sheet-grabber"></div>
            <header class="folder-sheet-header">
              <h3>{{ t('localMusic.removeFolder') }}</h3>
              <button class="folder-sheet-close" @click="showFolderManager = false">
                <i class="ri-close-line" />
              </button>
            </header>
            <div class="folder-sheet-body">
              <div class="space-y-3 py-2">
                <div
                  v-for="folder in localMusicStore.folderPaths"
                  :key="folder"
                  class="folder-item"
                >
                  <div class="flex items-center gap-3 min-w-0 flex-1">
                    <i class="ri-folder-line text-lg text-[var(--accent-color)] flex-shrink-0" />
                    <span class="text-sm text-white/80 truncate">{{ folder }}</span>
                  </div>
                  <button
                    class="w-9 h-9 rounded-full flex items-center justify-center text-white/45 active:text-red-500 active:bg-red-500/10 transition-all flex-shrink-0 ml-2"
                    @click="handleRemoveFolder(folder)"
                  >
                    <i class="ri-delete-bin-line" />
                  </button>
                </div>

                <div v-if="localMusicStore.folderPaths.length === 0" class="text-center py-8">
                  <i class="ri-folder-line text-4xl text-white/15" />
                  <p class="text-sm text-white/40 mt-2">{{ t('localMusic.emptyState') }}</p>
                </div>
              </div>
            </div>
            <div class="folder-sheet-footer">
              <button class="folder-sheet-add" @click="handleAddFolder">
                <i class="ri-folder-add-line" />
                {{ t('localMusic.scanFolder') }}
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { createDiscreteApi } from 'naive-ui';
import { computed, getCurrentInstance, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRoute, useRouter } from 'vue-router';

import GlowTabs from '@/components/common/GlowTabs.vue';
import SongItem from '@/components/common/SongItem.vue';
import {
  registerMobileTopbarAction,
  registerMobileTopbarPresentation,
  unregisterMobileTopbarAction,
  unregisterMobileTopbarPresentation
} from '@/composables/useMobileTopbarMenu';
import { useLocalMusicStore } from '@/store/modules/localMusic';
import { usePlayerStore } from '@/store/modules/player';
import type { LocalMusicEntry } from '@/types/localMusic';
import type { SongResult } from '@/types/music';

import { parseAudioFileMetadata } from '@/utils/audioMetadata';
import type { SortKey } from '@/utils/localMusicUtils';
import { filterByKeyword, sortMusicList, toSongResult } from '@/utils/localMusicUtils';

const route = useRoute();
const router = useRouter();

// ==================== Stores ====================
const { t } = useI18n();
const { message } = createDiscreteApi(['message']);
const localMusicStore = useLocalMusicStore();
const playerStore = usePlayerStore();

// ==================== Platform detection ====================
const isMobileNative = true;
// ==================== 网页版:本地音频文件导入 + 拖拽 ====================
// 会话级能力(blob URL 刷新失效):条目入 IndexedDB 但标记 fileUrl,
// 播放走 blob URL;刷新后这些条目自动清除
const isWebBrowser =
  typeof window !== 'undefined' && !(window as any).AndroidNative;
const dropActive = ref(false);
const audioFileInput = ref<HTMLInputElement | null>(null);
const sessionFiles = ref<Set<string>>(new Set());

const AUDIO_EXT_RE = /\.(mp3|flac|wav|ogg|m4a|aac|opus|wma|ape)$/i;

// 会话条目 id → 原始 File 映射:供「重新解析」再次读取(刷新后失效)
const sessionFileRefs = new Map<string, File>();

/** 把本地文件加入列表并返回 SongResult(会话级 blob URL,全格式元数据解析) */
async function importAudioFile(file: File): Promise<SongResult | null> {
  if (!AUDIO_EXT_RE.test(file.name)) return null;
  const entry = await buildSessionEntry(file);
  await localMusicStore.applyEntryMetadata(JSON.stringify(entry));
  sessionFiles.value.add(entry.id);
  sessionFileRefs.set(entry.id, file);
  const song = toSongResult(entry);
  // blob 直链:绕过 playerCore 的 local:// 改写,网页版可直接播放
  song.playMusicUrl = entry.fileUrl;
  return song;
}

async function buildSessionEntry(file: File) {
  const meta = await parseAudioFileMetadata(file);
  const filePath = `web-session://${file.name}`;
  const entry: any = {
    id: `web_${file.name}_${file.size}`,
    filePath,
    title: meta.title || file.name.replace(/\.[^.]+$/, ''),
    artist: meta.artist,
    album: meta.album,
    duration: meta.duration,
    cover: meta.cover,
    lyrics: meta.lyrics,
    fileSize: file.size,
    modifiedTime: file.lastModified,
    fileUrl: URL.createObjectURL(file),
    isSession: true
  };
  return entry;
}

// ── 重新解析:对会话条目用当前版本解析器重建元数据(旧导入的补歌词/封面) ──
const reparseBusy = ref(false);
const reparseProgress = ref(0);
async function reparseSessionFiles() {
  if (reparseBusy.value) return;
  const ids = [...sessionFiles.value].filter((id) => sessionFileRefs.has(id));
  if (!ids.length) {
    message.warning('本会话没有可重新解析的文件(刷新后需重新导入)');
    return;
  }
  reparseBusy.value = true;
  reparseProgress.value = 0;
  try {
    for (const id of ids) {
      const file = sessionFileRefs.get(id)!;
      const entry = await buildSessionEntry(file);
      entry.id = id;
      entry.fileUrl =
        localMusicStore.musicList.find((it: any) => it.id === id)?.fileUrl || entry.fileUrl;
      await localMusicStore.applyEntryMetadata(JSON.stringify(entry));
      reparseProgress.value++;
    }
    message.success(`已重新解析 ${ids.length} 个文件`);
  } finally {
    reparseBusy.value = false;
  }
}

const onDragOver = (e: DragEvent) => {
  if (!isWebBrowser) return;
  dropActive.value = true;
  e.dataTransfer && (e.dataTransfer.dropEffect = 'copy');
};

const onDrop = async (e: DragEvent) => {
  dropActive.value = false;
  if (!isWebBrowser) return;
  const files = [...(e.dataTransfer?.files || [])].filter((f) => AUDIO_EXT_RE.test(f.name));
  if (!files.length) return;
  const imported: SongResult[] = [];
  for (const file of files) {
    const song = await importAudioFile(file);
    if (song) imported.push(song);
  }
  if (imported.length) {
    message.success(`已导入 ${imported.length} 个音频文件`);
    playerStore.setPlayList(imported);
    void playerStore.setPlay(imported[0]);
  }
};

const onAudioFilePick = async (event: Event) => {
  const input = event.target as HTMLInputElement;
  const files = [...(input.files || [])].filter((f) => AUDIO_EXT_RE.test(f.name));
  input.value = '';
  const imported: SongResult[] = [];
  for (const file of files) {
    const song = await importAudioFile(file);
    if (song) imported.push(song);
  }
  if (imported.length) {
    message.success(`已导入 ${imported.length} 个音频文件`);
    playerStore.setPlayList(imported);
    void playerStore.setPlay(imported[0]);
  }
};
const { embedded } = withDefaults(defineProps<{ embedded?: boolean }>(), {
  embedded: false
});

// ==================== State ====================
const searchKeyword = ref('');
const showFolderManager = ref(false);
const activeTab = ref<'songs' | 'artists' | 'albums'>('songs');
const sortKey = ref<SortKey>('default');
const detailView = ref(false);
const detailType = ref<'artist' | 'album' | null>(null);
const detailName = ref('');

// Mobile scroll compact state
const scrollRef = ref<HTMLElement | null>(null);
const isCompact = ref(false);

// ==================== Computed ====================
type TabKey = 'songs' | 'artists' | 'albums';

const tabs = computed<{ key: TabKey; label: string }[]>(() => [
  { key: 'songs', label: t('localMusic.tabSongs') },
  { key: 'artists', label: t('localMusic.tabArtists') },
  { key: 'albums', label: t('localMusic.tabAlbums') }
]);

watch(
  () => route.query.localTab,
  (tab) => {
    if (tab === 'songs' || tab === 'artists' || tab === 'albums') activeTab.value = tab;
  },
  { immediate: true }
);

watch(activeTab, (tab) => {
  if (route.path !== '/list' || route.query.localTab === tab) return;
  void router.replace({ query: { ...route.query, source: 'local', localTab: tab } });
});

const topbarActionPrefix = `local-music-${getCurrentInstance()?.uid ?? 'view'}`;
const syncTopbarActions = () => {
  if (!isMobileNative) return;
  registerMobileTopbarPresentation({
    routePath: '/local-music/*',
    title: t('localMusic.title') || '本地音乐',
    subtitle: `${localMusicStore.musicList.length} 首`
  });
  if (isWebBrowser) {
    // 网页版:扫描/文件夹管理不可用,顶栏只保留导入入口
    registerMobileTopbarAction({
      id: `${topbarActionPrefix}-import`,
      routePath: route.path,
      label: '导入音乐文件',
      icon: 'ri-upload-2-line',
      run: () => audioFileInput.value?.click()
    });
    return;
  }
  registerMobileTopbarAction({
    id: `${topbarActionPrefix}-scan`,
    routePath: route.path,
    label: t('localMusic.scanFolder'),
    icon: 'ri-folder-add-line',
    run: () => void handleAddFolder()
  });
  registerMobileTopbarAction({
    id: `${topbarActionPrefix}-folders`,
    routePath: route.path,
    label: '管理文件夹',
    icon: 'ri-folder-settings-line',
    run: () => {
      showFolderManager.value = true;
    }
  });
  registerMobileTopbarAction({
    id: `${topbarActionPrefix}-refresh`,
    routePath: route.path,
    label: t('localMusic.scanComplete'),
    icon: 'ri-refresh-line',
    run: () => void handleScan()
  });
};

const filteredList = computed<LocalMusicEntry[]>(() => {
  let list = localMusicStore.musicList;
  if (detailView.value && detailType.value) {
    if (detailType.value === 'artist') {
      list = list.filter((e) => e.artist === detailName.value);
    } else if (detailType.value === 'album') {
      list = list.filter((e) => e.album === detailName.value);
    }
  }
  list = filterByKeyword(list, searchKeyword.value);
  list = sortMusicList(list, sortKey.value);
  return list;
});

const displayedList = computed<LocalMusicEntry[]>(() => filteredList.value);

const displayedSongResults = computed<SongResult[]>(() => {
  return displayedList.value.map((entry: any) => {
    const song = toSongResult(entry);
    // 网页版会话导入条目:blob URL 仅本会话有效
    if (entry.isSession && entry.fileUrl) {
      song.playMusicUrl = entry.fileUrl;
      song.expiredAt = Date.now() + 365 * 24 * 3600 * 1000;
    }
    return song;
  });
});

const artistList = computed<{ name: string; count: number }[]>(() => {
  const map = new Map<string, number>();
  const keyword = searchKeyword.value.trim().toLowerCase();
  for (const entry of localMusicStore.musicList) {
    if (keyword && !entry.artist.toLowerCase().includes(keyword)) continue;
    const name = entry.artist || t('localMusic.unknownArtist');
    map.set(name, (map.get(name) || 0) + 1);
  }
  return Array.from(map.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);
});

const albumList = computed<{ name: string; artist: string; cover: string | null; count: number }[]>(
  () => {
    const map = new Map<string, { artist: string; cover: string | null; count: number }>();
    const keyword = searchKeyword.value.trim().toLowerCase();
    for (const entry of localMusicStore.musicList) {
      if (
        keyword &&
        !entry.album.toLowerCase().includes(keyword) &&
        !entry.artist.toLowerCase().includes(keyword)
      )
        continue;
      const name = entry.album || t('localMusic.unknownAlbum');
      const existing = map.get(name);
      if (existing) {
        existing.count++;
        if (!existing.cover && entry.cover) existing.cover = entry.cover;
      } else {
        map.set(name, { artist: entry.artist, cover: entry.cover, count: 1 });
      }
    }
    return Array.from(map.entries())
      .map(([name, info]) => ({ name, ...info }))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  }
);

// ==================== Mobile scroll handler ====================
const onScroll = () => {
  if (!isMobileNative || !scrollRef.value) return;
  isCompact.value = scrollRef.value.scrollTop > 10;
};

// ==================== Watchers ====================
watch(activeTab, () => {
  detailView.value = false;
  detailType.value = null;
  detailName.value = '';
});

// ==================== Methods ====================
function enterDetailView(type: 'artist' | 'album', name: string): void {
  detailType.value = type;
  detailName.value = name;
  detailView.value = true;
  sortKey.value = type === 'album' ? 'album' : 'default';
}

// ==================== Folder picker ====================
async function handleAddFolder(): Promise<void> {
  // 纯浏览器环境（Web 版）没有文件夹访问能力
  if (!(window as any).AndroidNative) {
    message.warning('网页版暂不支持扫描本地音乐，请使用客户端');
    return;
  }
  if (isMobileNative) {
    // 移动端：使用 NativeBridge 的文件夹选择器
    (window as any).AndroidNative.pickAudioFolder();
    // 等待用户选择文件夹（回调由 window.__localMusicFolderPicked 触发）
    const treeUri = await waitForFolderPick();
    if (!treeUri) {
      message.error('未选择文件夹');
      return;
    }
    localMusicStore.addFolder(treeUri);
    await localMusicStore.scanFolders();
    message.success(t('localMusic.scanComplete'));
    return;
  }
}

function handleRemoveFolder(folder: string): void {
  localMusicStore.removeFolder(folder);
}

async function handleScan(): Promise<void> {
  if (localMusicStore.folderPaths.length === 0) {
    await handleAddFolder();
    return;
  }
  await localMusicStore.scanFolders();
  if (isMobileNative) {
    message.success(t('localMusic.scanComplete'));
  }
}

async function handlePlaySong(song: SongResult): Promise<void> {
  playerStore.setPlayList(displayedSongResults.value);
  await playerStore.setPlay(song);
}

// ==================== Mobile folder picker callback ====================
let folderPickerResolver: ((treeUri: string | null) => void) | null = null;

function waitForFolderPick(): Promise<string | null> {
  return new Promise((resolve) => {
    folderPickerResolver = resolve;
  });
}

// Register global callback for folder picker result
if (typeof window !== 'undefined') {
  (window as any).__localMusicFolderPicked = (treeUri: string | null) => {
    if (folderPickerResolver) {
      folderPickerResolver(treeUri);
      folderPickerResolver = null;
    }
  };
}

// ==================== Lifecycle ====================
onMounted(async () => {
  if (!isMobileNative) return;
  await localMusicStore.loadFromCache();
  syncTopbarActions();
});

onBeforeUnmount(() => {
  unregisterMobileTopbarAction(`${topbarActionPrefix}-scan`);
  unregisterMobileTopbarAction(`${topbarActionPrefix}-folders`);
  unregisterMobileTopbarAction(`${topbarActionPrefix}-refresh`);
  unregisterMobileTopbarPresentation('/local-music/*');
  if (typeof window !== 'undefined') {
    delete (window as any).__localMusicFolderPicked;
  }
});

// Watch for mobile folder picker callback to trigger scan
watch(
  () => (window as any).__localMusicFolderPicked,
  () => {},
  { immediate: false }
);
</script>

<style lang="scss" scoped>
$spring: cubic-bezier(0.34, 1.56, 0.64, 1);
$smooth: cubic-bezier(0.32, 0.72, 0, 1);

.local-music-page {
  height: 100%;
  width: 100%;

  &.is-embedded {
    height: auto;
    min-height: calc(100dvh - var(--safe-area-inset-top, 0px) - 116px);
  }
}

/* ==================== 移动端样式 ==================== */
.lm-scroll {
  height: 100%;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
  &::-webkit-scrollbar {
    display: none;
  }

  &.is-embedded {
    height: auto;
    min-height: inherit;
    overflow: visible;
    -webkit-overflow-scrolling: auto;
  }
}

/* Hero Card — sticky morphing floating card */
.hero-card {
  position: fixed;
  top: calc(var(--safe-area-inset-top, 0px) + 52px);
  left: 16px;
  right: 16px;
  z-index: 50;
  border-radius: 22px;
  overflow: hidden;
  transition:
    border-radius 0.4s $spring,
    box-shadow 0.4s $spring,
    top 0.4s $spring;

  &.compact {
    border-radius: 18px;
    box-shadow: 0 2px 20px rgba(0, 0, 0, 0.08);
    top: var(--mobile-topbar-inset);
  }
}

.hero-bg {
  position: absolute;
  inset: 0;
  background: var(--cover-surface, var(--m-surface, var(--d-surface, #fff)));
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
  opacity: 1;
  transition: opacity 0.4s $spring;
}

.hero-top {
  position: relative;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 20px 20px 12px;
  transition:
    padding 0.4s $spring,
    gap 0.4s $spring;

  .hero-card.compact & {
    padding: 10px 16px 8px;
    gap: 10px;
  }
}

.cover-wrap {
  flex-shrink: 0;
  display: flex;
  justify-content: center;

  .hero-card.compact & {
    justify-content: flex-start;
  }
}

.cover-icon {
  font-size: 48px;
  color: var(--accent-color, #888);
  opacity: 0.8;
  transition: font-size 0.4s $spring;

  .hero-card.compact & {
    font-size: 28px;
  }
}

.hero-info {
  flex: 1;
  min-width: 0;
}

.hero-title {
  font-size: 28px;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--cover-text-primary, var(--m-text-primary, var(--text-color, #000)));
  margin: 0;
  transition: font-size 0.4s $spring;

  .hero-card.compact & {
    font-size: 17px;
    font-weight: 600;
  }
}

.hero-meta {
  font-size: 13px;
  color: var(--cover-text-muted, var(--m-text-muted, #9a9590));
  margin-top: 2px;
  transition: opacity 0.3s ease;

  .hero-card.compact & {
    font-size: 11px;
  }
}

.hero-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.action-btn {
  width: 36px;
  height: 36px;
  border: none;
  border-radius: 50%;
  background: var(--cover-surface-alt, rgba(128, 128, 128, 0.08));
  color: var(--cover-text-secondary, var(--m-text-secondary, #6b6560));
  font-size: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition:
    background 0.2s ease,
    transform 0.2s $spring;

  &:active {
    transform: scale(0.88);
  }

  &:disabled {
    opacity: 0.4;
  }
}

/* Tab bar — glow tabs */
.tab-bar-glow {
  margin: 4px 4px 8px;
  transition: margin 0.4s $spring;

  .hero-card.compact & {
    margin: 0 16px 6px;
  }
}

/* Scan progress */
.scan-progress {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 12px 16px;
  padding: 16px;
  border-radius: 16px;
  background: rgba(var(--accent-color-rgb, 136, 136, 136), 0.08);
  border: 1px solid rgba(var(--accent-color-rgb, 136, 136, 136), 0.15);
  font-size: 14px;
  color: var(--cover-text-primary, var(--m-text-primary, #000));
}

/* Empty state */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: calc(100dvh - var(--safe-area-inset-top, 0px) - 220px);
  padding: 48px 20px 120px;
  gap: 16px;
}

.empty-icon {
  font-size: 56px;
  color: var(--cover-text-muted, var(--m-text-muted, #9a9590));
  opacity: 0.3;
}

.empty-text {
  font-size: 14px;
  color: var(--cover-text-muted, var(--m-text-muted, #9a9590));
  text-align: center;
}

.empty-action {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 24px;
  border-radius: 9999px;
  border: none;
  background: var(--accent-color, #888);
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: transform 0.2s $spring;

  &:active {
    transform: scale(0.95);
  }
}

/* Content area */
.content-area {
  padding: 0 16px;
  margin-top: 0;
}

.no-results {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 80px 20px;
  gap: 12px;
  color: var(--cover-text-muted, var(--m-text-muted, #9a9590));

  i {
    font-size: 40px;
    opacity: 0.3;
  }
  p {
    font-size: 14px;
  }
}

/* Song list */
.song-list {
  display: flex;
  flex-direction: column;
}

/* Artist grid */
.artist-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
}

.artist-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 20px 12px;
  border: none;
  border-radius: 16px;
  background: transparent;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: background 0.2s ease;

  &:active {
    background: var(--cover-surface-alt, rgba(128, 128, 128, 0.06));
  }
}

.artist-avatar {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
  font-weight: 700;
  color: var(--accent-color, #888);
  background: linear-gradient(
    135deg,
    rgba(var(--accent-color-rgb, 136, 136, 136), 0.2),
    rgba(var(--accent-color-rgb, 136, 136, 136), 0.05)
  );
}

.artist-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--cover-text-primary, var(--m-text-primary, #000));
  text-align: center;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  width: 100%;
}

.artist-count {
  font-size: 11px;
  color: var(--cover-text-muted, var(--m-text-muted, #9a9590));
}

/* Album grid */
.album-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
}

.album-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px;
  border: none;
  border-radius: 16px;
  background: transparent;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: background 0.2s ease;

  &:active {
    background: var(--cover-surface-alt, rgba(128, 128, 128, 0.06));
  }
}

.album-cover {
  position: relative;
  aspect-ratio: 1;
  border-radius: 12px;
  overflow: hidden;
  background: var(--cover-surface-alt, rgba(128, 128, 128, 0.08));

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  i {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    font-size: 28px;
    color: var(--accent-color, #888);
    opacity: 0.4;
  }
}

.album-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--cover-text-primary, var(--m-text-primary, #000));
  text-align: center;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.album-artist {
  font-size: 11px;
  color: var(--cover-text-muted, var(--m-text-muted, #9a9590));
  text-align: center;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Bottom spacer for safe area + nav bar */
.bottom-spacer {
  height: calc(var(--mobile-dock-content-inset, 144px) + var(--safe-area-inset-bottom, 0px) + 12px);
}

.local-music-page.is-embedded .bottom-spacer {
  height: 0;
}

/* ==================== Desktop styles (shared) ==================== */
.song-virtual-list {
  @apply w-full;
}

.song-virtual-list :deep(.n-virtual-list__scroll) {
  scrollbar-width: thin;
}

.song-virtual-list :deep(.n-virtual-list__scroll)::-webkit-scrollbar {
  width: 6px;
}

.song-virtual-list :deep(.n-virtual-list__scroll)::-webkit-scrollbar-thumb {
  @apply bg-neutral-300 dark:bg-neutral-700 rounded-full;
}

.song-virtual-list :deep(.n-virtual-list__scroll)::-webkit-scrollbar-track {
  @apply bg-transparent;
}

/* Animation */
.animate-spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .hero-card,
  .hero-top,
  .cover-icon,
  .hero-title,
  .hero-meta,
  .tab-bar-glow {
    transition: none;
  }
}

/* ===== 文件夹管理：底部实色 sheet（毛玻璃已下线） ===== */
.folder-sheet-overlay {
  position: fixed;
  inset: 0;
  z-index: 100100;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}

.folder-sheet {
  width: 100%;
  max-width: 520px;
  max-height: 70vh;
  display: flex;
  flex-direction: column;
  padding: 10px 20px calc(16px + var(--safe-area-inset-bottom, 0px));
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-bottom: none;
  border-radius: 24px 24px 0 0;
  background: #1c1c20;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
  box-shadow:
    0 -16px 48px rgba(0, 0, 0, 0.5),
    inset 0 1px 0 rgba(255, 255, 255, 0.06);
}

.folder-sheet-grabber {
  width: 40px;
  height: 4px;
  margin: 0 auto 12px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.22);
}

.folder-sheet-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;

  h3 {
    margin: 0;
    color: #f5f5f7;
    font-size: 17px;
    font-weight: 700;
  }
}

.folder-sheet-close {
  display: grid;
  width: 32px;
  height: 32px;
  padding: 0;
  border: none;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.6);
  font-size: 18px;
  place-items: center;
}

.folder-sheet-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.folder-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.05);
}

.folder-sheet-footer {
  padding-top: 14px;
}

.folder-sheet-add {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  padding: 14px 0;
  border: none;
  border-radius: 999px;
  color: #1a1a1c;
  background: var(--accent-color, #d4a056);
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  transition: transform 0.15s ease;

  &:active {
    transform: scale(0.98);
  }
}

.folder-sheet-enter-active,
.folder-sheet-leave-active {
  transition: opacity 0.3s ease;

  .folder-sheet {
    transition: transform 0.38s cubic-bezier(0.22, 1, 0.36, 1);
  }
}

.folder-sheet-enter-from,
.folder-sheet-leave-to {
  opacity: 0;

  .folder-sheet {
    transform: translateY(100%);
  }
}

.local-music-page.drop-target::after {
  content: '';
  position: fixed;
  inset: 0;
  z-index: 999;
  border: 3px dashed var(--accent-color, #888);
  border-radius: 18px;
  background: color-mix(in srgb, var(--accent-color, #888) 8%, transparent);
  pointer-events: none;
}

/* ── 网页版导入入口 ── */
.web-import-bar {
  display: flex;
  padding: 0 16px 12px;
}

.web-import-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 18px;
  border: 1px solid rgba(var(--accent-color-rgb, 136, 136, 136), 0.35);
  border-radius: 9999px;
  background: rgba(var(--accent-color-rgb, 136, 136, 136), 0.1);
  color: var(--m-text-primary, #2c2c2c);
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition:
    transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1),
    background 0.2s ease;
}

.web-import-btn--ghost {
  background: transparent;
}

.web-import-btn--ghost:disabled {
  opacity: 0.6;
  cursor: default;
}

.web-import-btn:active {
  transform: scale(0.96);
}

.web-import-btn i {
  color: var(--accent-color, #888);
}
</style>
