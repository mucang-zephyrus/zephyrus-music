<template>
  <div v-if="isComponent ? favoriteSongs.length : true" class="favorite-page h-full flex flex-col">
    <!-- Header Section -->
    <div
      class="flex items-center justify-between px-6 py-4 flex-shrink-0"
      :class="setAnimationClass('animate__fadeInLeft')"
    >
      <div class="flex items-center gap-4">
        <div>
          <h2 class="text-2xl font-bold text-gray-900 dark:text-white">
            {{ t('favorite.title') }}
          </h2>
          <p class="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            {{ t('favorite.count', { count: favoriteList.length }) }}
          </p>
        </div>
      </div>

    </div>

    <!-- Main Content -->
    <div class="flex-grow min-h-0 px-2" :class="setAnimationClass('animate__bounceInRight')">
      <n-scrollbar ref="scrollbarRef" class="h-full pr-4" @scroll="handleScroll">
        <div
          v-if="favoriteList.length === 0"
          class="h-full flex flex-col items-center justify-center text-gray-400"
        >
          <div
            class="w-24 h-24 rounded-full bg-gray-100 dark:bg-neutral-800 flex items-center justify-center mb-4"
          >
            <i class="ri-heart-line text-4xl text-gray-300 dark:text-gray-600"></i>
          </div>
          <p>{{ t('favorite.emptyTip') }}</p>
        </div>

        <div v-else class="space-y-1 pb-24" :class="{ 'max-w-[400px]': isComponent }">
          <song-item
            v-for="(song, index) in favoriteSongs"
            :key="song.id"
            :item="song"
            :favorite="false"
            class="rounded-xl hover:bg-gray-100 dark:hover:bg-neutral-800 transition-colors"
            :class="setAnimationClass('animate__bounceInLeft')"
            :style="getItemAnimationDelay(index)"
            @play="handlePlay"
          />

          <div v-if="isComponent" class="pt-4 text-center">
            <n-button text type="primary" @click="handleMore">
              {{ t('common.viewMore') }} <i class="ri-arrow-right-s-line ml-1"></i>
            </n-button>
          </div>

          <!-- Loading Skeletons -->
          <div v-if="loading" class="space-y-2 pt-2">
            <div
              v-for="i in 5"
              :key="i"
              class="flex items-center gap-4 rounded-xl p-2 animate-pulse"
            >
              <div class="h-12 w-12 rounded-xl bg-gray-200 dark:bg-neutral-800"></div>
              <div class="flex-1 space-y-2">
                <div class="h-4 w-1/3 rounded bg-gray-200 dark:bg-neutral-800"></div>
                <div class="h-3 w-1/4 rounded bg-gray-200 dark:bg-neutral-800"></div>
              </div>
            </div>
          </div>

          <div v-if="noMore" class="text-center py-8 text-sm text-gray-400 dark:text-gray-500">
            {{ t('common.noMore') }}
          </div>
        </div>
      </n-scrollbar>
      <play-bottom />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';

import { getMusicDetail } from '@/api/music';
import PlayBottom from '@/components/common/PlayBottom.vue';
import SongItem from '@/components/common/SongItem.vue';
import { usePlayerStore } from '@/store';
import type { SongResult } from '@/types/music';
import { setAnimationClass, setAnimationDelay } from '@/utils';

const { t } = useI18n();
const playerStore = usePlayerStore();
const favoriteList = computed(() => playerStore.favoriteList);
const favoriteSongs = ref<SongResult[]>([]);
const loading = ref(false);
const noMore = ref(false);

// 排序相关
const isDescending = ref(true); // 默认倒序显示

// 无限滚动相关
const pageSize = 100;
const currentPage = ref(1);

const props = defineProps({
  isComponent: {
    type: Boolean,
    default: false
  }
});

// 获取当前页的收藏歌曲ID
const getCurrentPageIds = () => {
  let ids = [...favoriteList.value]; // 复制一份以免修改原数组

  // 根据排序方式调整顺序
  if (isDescending.value) {
    ids = ids.reverse(); // 倒序，最新收藏的在前面
  }

  const startIndex = (currentPage.value - 1) * pageSize;
  const endIndex = startIndex + pageSize;
  // 返回原始ID，不进行类型转换
  return ids.slice(startIndex, endIndex);
};

// 获取收藏歌曲详情
const getFavoriteSongs = async () => {
  if (favoriteList.value.length === 0) {
    favoriteSongs.value = [];
    return;
  }

  if (props.isComponent && favoriteSongs.value.length >= 16) {
    return;
  }

  loading.value = true;
  try {
    const currentIds = getCurrentPageIds();

    const musicIds = currentIds.filter((id) => typeof id === 'number') as number[];

    // 处理音乐数据
    let neteaseSongs: SongResult[] = [];
    if (musicIds.length > 0) {
      const res = await getMusicDetail(musicIds);
      if (res.data.songs) {
        neteaseSongs = res.data.songs.map((song: SongResult) => ({
          ...song,
          picUrl: song.al?.picUrl || '',
          source: 'netease'
        }));
      }
    }

    // 合并数据，保持原有顺序
    const newSongs = currentIds
      .map((id) => {
        const strId = String(id);

        // 查找音乐
        const found = neteaseSongs.find((song) => String(song.id) === strId);
        return found;
      })
      .filter((song): song is SongResult => !!song);

    // 追加新数据而不是替换
    if (currentPage.value === 1) {
      favoriteSongs.value = newSongs;
    } else {
      favoriteSongs.value = [...favoriteSongs.value, ...newSongs];
    }

    // 判断是否还有更多数据
    noMore.value = favoriteSongs.value.length >= favoriteList.value.length;
  } catch (error) {
    console.error('获取收藏歌曲失败:', error);
  } finally {
    loading.value = false;
  }
};

// 处理滚动事件
const handleScroll = (e: any) => {
  const { scrollTop, scrollHeight, offsetHeight } = e.target;
  const threshold = 100; // 距离底部多少像素时加载更多

  if (!loading.value && !noMore.value && scrollHeight - (scrollTop + offsetHeight) < threshold) {
    currentPage.value++;
    getFavoriteSongs();
  }
};

const hasLoaded = ref(false);

onMounted(async () => {
  if (!hasLoaded.value) {
    await playerStore.initializeFavoriteList();
    await getFavoriteSongs();
    hasLoaded.value = true;
  }
});

// 监听收藏列表变化，变化时重置并重新加载
watch(
  favoriteList,
  async () => {
    hasLoaded.value = false;
    currentPage.value = 1;
    noMore.value = false;
    await getFavoriteSongs();
    hasLoaded.value = true;
  },
  { deep: true }
);

const handlePlay = (song: SongResult) => {
  playerStore.setPlayList(favoriteSongs.value);
  playerStore.setPlay(song);
};

const getItemAnimationDelay = (index: number) => {
  return setAnimationDelay(index, 30);
};

const router = useRouter();
const handleMore = () => {
  router.push('/history');
};

</script>

<style lang="scss" scoped>
/* Scoped styles kept minimal as we use Tailwind classes */
</style>
