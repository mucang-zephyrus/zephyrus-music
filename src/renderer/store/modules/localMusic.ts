// 本地音乐 Pinia Store
// 管理本地音乐列表、扫描状态和文件夹配置
// 使用 IndexedDB 缓存音乐元数据，localStorage 持久化文件夹路径

import { createDiscreteApi } from 'naive-ui';
import { defineStore } from 'pinia';
import { ref } from 'vue';

import useIndexedDB from '@/hooks/IndexDBHook';
import { listLocalAudioFiles, readLocalAudioMetadata } from '@/services/localMusicNative';
import type { LocalMusicEntry } from '@/types/localMusic';

const { message } = createDiscreteApi(['message']);

/** IndexedDB store 名称 */
const LOCAL_MUSIC_STORE = 'local_music' as const;

/** IndexedDB 数据类型映射 */
type LocalMusicDBStores = {
  local_music: LocalMusicEntry;
};

/**
 * 使用 filePath 生成唯一 ID
 * 采用简单的字符串 hash 算法，确保同一路径始终生成相同 ID
 * @param filePath 文件绝对路径
 * @returns hash 字符串作为唯一 ID
 */
function generateId(filePath: string): string {
  let hash = 0;
  for (let i = 0; i < filePath.length; i++) {
    const char = filePath.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  // 转为正数的十六进制字符串
  return (hash >>> 0).toString(16);
}

/**
 * 初始化 IndexedDB 实例
 * 使用 localMusicDB 数据库，包含 local_music 表
 */
async function initLocalMusicDB() {
  return await useIndexedDB<typeof LOCAL_MUSIC_STORE, LocalMusicDBStores>(
    'localMusicDB',
    [{ name: LOCAL_MUSIC_STORE, keyPath: 'id' }],
    1
  );
}

/**
 * 本地音乐管理 Store
 * 负责：文件夹管理、音乐扫描、IndexedDB 缓存、增量更新
 */
export const useLocalMusicStore = defineStore(
  'localMusic',
  () => {
    // ==================== 状态 ====================
    /** 已配置的文件夹路径列表 */
    const folderPaths = ref<string[]>([]);
    /** 本地音乐列表（从 IndexedDB 加载） */
    const musicList = ref<LocalMusicEntry[]>([]);
    /** 是否正在扫描 */
    const scanning = ref(false);
    /** 已扫描文件数（用于显示进度） */
    const scanProgress = ref(0);

    /** IndexedDB 实例（延迟初始化） */
    let db: ReturnType<typeof initLocalMusicDB> | undefined;
    let cacheLoad: Promise<void> | undefined;
    let scan: Promise<boolean> | undefined;
    let activeFolders: string[] = [];
    let triedRecovery = false;

    /**
     * 获取 IndexedDB 实例，首次调用时初始化
     */
    function getDB() {
      db ??= initLocalMusicDB().catch((error) => {
        db = undefined;
        throw error;
      });
      return db;
    }

    // ==================== 动作 ====================

    /**
     * 添加文件夹路径
     * 如果路径已存在则忽略
     * @param path 文件夹路径
     */
    function addFolder(path: string): void {
      if (!path || folderPaths.value.includes(path)) {
        return;
      }
      folderPaths.value.push(path);
    }

    /**
     * 移除文件夹路径
     * @param path 要移除的文件夹路径
     */
    async function removeFolder(path: string): Promise<void> {
      if (scan) await scan;
      await loadFromCache();
      const localDB = await getDB();
      const entries = musicList.value;
      const removed = entries.filter((entry) => belongsToFolder(entry.filePath, path));
      await localDB.updateBatch(
        LOCAL_MUSIC_STORE,
        [],
        removed.map((entry) => entry.id)
      );
      folderPaths.value = folderPaths.value.filter((folder) => folder !== path);
      const removedIds = new Set(removed.map((entry) => entry.id));
      musicList.value = musicList.value.filter((entry) => !removedIds.has(entry.id));
    }

    function belongsToFolder(uri: string, folder: string) {
      return uri.startsWith(`${folder.replace(/\/$/, '')}/document/`);
    }

    function scanFolders(paths = [...folderPaths.value]): Promise<boolean> {
      if (!window.AndroidNative || !paths.length) return Promise.resolve(false);
      if (scan) {
        const remaining = paths.filter((path) => !activeFolders.includes(path));
        return remaining.length
          ? scan.then(() =>
              scanFolders(remaining.filter((path) => folderPaths.value.includes(path)))
            )
          : scan;
      }
      activeFolders = paths;
      scanning.value = true;
      scanProgress.value = 0;
      scan = refreshFolders(paths).finally(() => {
        scanning.value = false;
        scan = undefined;
        activeFolders = [];
      });
      return scan;
    }

    async function refreshFolders(paths: string[]): Promise<boolean> {
      let complete = true;
      try {
        await loadFromCache();
        const localDB = await getDB();
        const entries = new Map(musicList.value.map((entry) => [entry.filePath, entry]));
        let lastListUpdate = 0;
        let listChanged = false;
        for (const folder of paths) {
          try {
            const { files, reliable } = await listLocalAudioFiles(folder);
            const seen = new Set(files.map((file) => file.uri));
            const pending: LocalMusicEntry[] = [];
            for (const file of files) {
              const cached = entries.get(file.uri);
              if (
                !cached ||
                cached.modifiedTime !== file.lastModified ||
                cached.fileSize !== file.size
              ) {
                try {
                  const meta = await readLocalAudioMetadata(file);
                  pending.push({
                    ...meta,
                    filePath: file.uri,
                    modifiedTime: file.lastModified,
                    fileSize: file.size,
                    id: cached?.id ?? generateId(file.uri)
                  });
                } catch (error) {
                  console.warn('读取本地歌曲失败:', file.name, error);
                  complete = false;
                }
              }
              scanProgress.value++;
              if (pending.length >= 24) {
                await localDB.updateBatch(LOCAL_MUSIC_STORE, pending);
                for (const entry of pending) entries.set(entry.filePath, entry);
                pending.length = 0;
                listChanged = true;
                if (performance.now() - lastListUpdate > 250) {
                  musicList.value = [...entries.values()];
                  lastListUpdate = performance.now();
                  listChanged = false;
                }
              }
            }
            // Older Android builds cannot distinguish an empty folder from a listing error.
            const stale = reliable
              ? [...entries.values()].filter(
                  (entry) => belongsToFolder(entry.filePath, folder) && !seen.has(entry.filePath)
                )
              : [];
            await localDB.updateBatch(
              LOCAL_MUSIC_STORE,
              pending,
              stale.map((entry) => entry.id)
            );
            for (const entry of pending) entries.set(entry.filePath, entry);
            for (const entry of stale) entries.delete(entry.filePath);
            listChanged ||= pending.length > 0 || stale.length > 0;
          } catch (error) {
            console.warn('扫描本地音乐目录失败:', folder, error);
            complete = false;
          }
        }
        if (listChanged) musicList.value = [...entries.values()];
      } catch (error) {
        console.error('扫描本地音乐失败:', error);
        complete = false;
      }
      if (!complete) message.warning('部分本地歌曲未能读取，请刷新重试。');
      return complete;
    }

    function loadFromCache(): Promise<void> {
      cacheLoad ??= getDB()
        .then(async (localDB) => {
          const entries = await localDB.getAllData(LOCAL_MUSIC_STORE);
          // Blob URLs only work in the document where they were created.
          const stale = entries.filter((entry) => entry.isSession);
          await localDB.updateBatch(
            LOCAL_MUSIC_STORE,
            [],
            stale.map((entry) => entry.id)
          );
          musicList.value = entries.filter((entry) => !entry.isSession);
        })
        .catch((error) => {
          cacheLoad = undefined;
          throw error;
        });
      return cacheLoad;
    }

    async function restoreLibrary(): Promise<void> {
      await loadFromCache();
      if (
        window.AndroidNative &&
        !triedRecovery &&
        !musicList.value.length &&
        folderPaths.value.length
      ) {
        triedRecovery = true;
        await scanFolders();
      }
    }

    /** 元数据写回文件成功后，用原生复检返回的新元数据更新 IndexedDB 与列表。 */
    async function applyEntryMetadata(metadataJson: string) {
      await loadFromCache();
      if (scan) await scan;
      const meta = JSON.parse(metadataJson) as LocalMusicEntry;
      const entry: LocalMusicEntry = {
        ...meta,
        cover: meta.cover ?? null,
        lyrics: meta.lyrics ?? null,
        modifiedTime:
          meta.modifiedTime ||
          musicList.value.find((item) => item.filePath === meta.filePath)?.modifiedTime ||
          0,
        id: generateId(meta.filePath)
      };
      if (!entry.isSession) {
        const localDB = await getDB();
        await localDB.updateBatch(LOCAL_MUSIC_STORE, [entry]);
      }
      const index = musicList.value.findIndex((item) => item.id === entry.id);
      if (index >= 0) musicList.value.splice(index, 1, entry);
      else musicList.value.push(entry);
      return entry;
    }

    return {
      // 状态
      folderPaths,
      musicList,
      scanning,
      scanProgress,

      // 动作
      addFolder,
      removeFolder,
      scanFolders,
      loadFromCache,
      restoreLibrary,
      applyEntryMetadata
    };
  },
  {
    // 持久化配置：仅持久化文件夹路径到 localStorage
    // 音乐列表存储在 IndexedDB 中，不需要 localStorage 持久化
    persist: {
      key: 'local-music-store',
      storage: localStorage,
      pick: ['folderPaths']
    }
  }
);
