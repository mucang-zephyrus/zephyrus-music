import { Capacitor } from '@capacitor/core';
import { cloneDeep } from 'lodash';
import { useMessage } from 'naive-ui';
import { ref } from 'vue';
import { useI18n } from 'vue-i18n';

import { getMusicLrc } from '@/api/music';
import { getServerSongDetail, isServerSongResult } from '@/api/serverSongs';
import { getSongUrl } from '@/store/modules/player';
import type { SongResult } from '@/types/music';

export const mobileDownloadProgress = ref<Record<string, number>>({});

function songFilename(song: SongResult): string {
  const artists = (song.ar || song.artists || song.song?.artists)?.map((a) => a.name).join(',');
  const name = artists ? `${song.name} - ${artists}` : song.name;
  return name.replace(/[<>:"/\\|?*]/g, '_').trim() || String(song.id);
}

function triggerBrowserDownload(url: string, filename: string) {
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.target = '_blank';
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
}

async function saveNativeFile(blob: Blob, filename: string) {
  const { Filesystem, Directory } = await import('@capacitor/filesystem');
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
  try {
    await Filesystem.writeFile({
      path: `Download/${filename}`,
      data,
      directory: Directory.ExternalStorage,
      recursive: true
    });
    return `Download/${filename}`;
  } catch {
    await Filesystem.writeFile({ path: filename, data, directory: Directory.Documents });
    return `Documents/${filename}`;
  }
}

export const useDownload = () => {
  const { t } = useI18n();
  const message = useMessage();
  const isDownloading = ref(false);

  const saveMusic = async (song: SongResult) => {
    let url: string | undefined;
    let type: string | undefined;
    if (isServerSongResult(song)) {
      url = song.playMusicUrl || (await getServerSongDetail(String(song.platformId))).audioUrl;
    } else {
      const audio = await getSongUrl(song.id, cloneDeep(song), true);
      if (typeof audio === 'string') {
        url = audio;
      } else {
        url = audio?.url;
        type = audio?.type;
      }
    }
    if (!url) throw new Error(t('songItem.message.getUrlFailed'));

    const mediaExtension = /\.(flac|mp3|m4a|aac|ogg|opus|wav|webm)(?:[?#]|$)/i.exec(url)?.[1];
    const ext = mediaExtension || (/^(flac|mp3|m4a|aac|ogg|opus|wav|webm)$/i.test(type || '') ? type : 'mp3');
    const filename = `${songFilename(song)}.${ext}`;
    if (!Capacitor.isNativePlatform()) {
      if (new URL(url, location.href).origin === location.origin) {
        triggerBrowserDownload(url, filename);
      } else {
        // Browsers ignore the download attribute for cross-origin URLs.
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const objectUrl = URL.createObjectURL(await response.blob());
        triggerBrowserDownload(objectUrl, filename);
        setTimeout(() => URL.revokeObjectURL(objectUrl), 30_000);
      }
      return;
    }

    if (filename in mobileDownloadProgress.value) throw new Error(t('songItem.message.downloading'));
    mobileDownloadProgress.value[filename] = 0;
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const total = Number(response.headers.get('content-length') || 0);
      const reader = response.body?.getReader();
      if (!reader) throw new Error('Download stream unavailable');

      const chunks: BlobPart[] = [];
      let loaded = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value as BlobPart);
        loaded += value.length;
        if (total) mobileDownloadProgress.value[filename] = Math.min(100, Math.round((loaded / total) * 100));
      }
      return await saveNativeFile(new Blob(chunks), filename);
    } finally {
      delete mobileDownloadProgress.value[filename];
    }
  };

  const downloadMusic = async (song: SongResult) => {
    if (isDownloading.value) return;
    isDownloading.value = true;
    try {
      const savedPath = await saveMusic(song);
      message.success(savedPath ? `${t('favorite.downloadSuccess')} · ${savedPath}` : t('download.browserDownloadStarted'));
    } catch (error) {
      console.error('Download error:', error);
      message.error(t('songItem.message.downloadFailed'));
    } finally {
      isDownloading.value = false;
    }
  };

  const batchDownloadMusic = async (songs: SongResult[]) => {
    if (isDownloading.value) return;
    if (!songs.length) {
      message.warning(t('favorite.selectSongsFirst'));
      return;
    }
    isDownloading.value = true;
    try {
      let failed = 0;
      for (const song of songs) {
        try {
          await saveMusic(song);
        } catch (error) {
          failed++;
          console.error('Download error:', song.name, error);
        }
      }
      if (failed) {
        message.error(`${t('favorite.downloadFailed')} (${failed}/${songs.length})`);
      } else {
        message.success(t(Capacitor.isNativePlatform() ? 'favorite.downloadSuccess' : 'download.browserDownloadStarted'));
      }
    } finally {
      isDownloading.value = false;
    }
  };

  const downloadLyric = async (song: SongResult) => {
    try {
      const { data } = await getMusicLrc(song.id as number);
      const original = data?.lrc?.lyric;
      if (!original) {
        message.warning(t('songItem.message.noLyric'));
        return;
      }
      const translation = data.tlyric?.lyric;
      const text = translation ? mergeLrcWithTranslation(original, translation) : original;
      const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
      const filename = `${songFilename(song)}.lrc`;
      if (Capacitor.isNativePlatform()) {
        await saveNativeFile(blob, filename);
      } else {
        const url = URL.createObjectURL(blob);
        triggerBrowserDownload(url, filename);
        setTimeout(() => URL.revokeObjectURL(url), 30_000);
      }
      message.success(t('songItem.message.lyricDownloaded'));
    } catch (error) {
      console.error('Download lyric error:', error);
      message.error(t('songItem.message.lyricDownloadFailed'));
    }
  };

  return { isDownloading, downloadMusic, downloadLyric, batchDownloadMusic, mobileDownloadProgress };
};

/**
 * 将原文歌词和翻译歌词合并为一个 LRC 字符串
 */
function mergeLrcWithTranslation(originalText: string, translationText: string): string {
  const originalMap = parseLrcText(originalText);
  const translationMap = parseLrcText(translationText);

  const mergedLines: string[] = [];

  for (const [timeTag, content] of originalMap.entries()) {
    mergedLines.push(`${timeTag}${content}`);
    const translated = translationMap.get(timeTag);
    if (translated) {
      mergedLines.push(`${timeTag}${translated}`);
    }
  }

  // 按时间排序
  mergedLines.sort((a, b) => {
    const ta = a.match(/\[\d{2}:\d{2}(\.\d{1,3})?\]/)?.[0] || '';
    const tb = b.match(/\[\d{2}:\d{2}(\.\d{1,3})?\]/)?.[0] || '';
    return ta.localeCompare(tb);
  });

  return mergedLines.join('\n');
}

/**
 * 解析 LRC 文本为 Map<timeTag, content>
 */
function parseLrcText(text: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of text.split('\n')) {
    const tags = line.match(/\[\d{2}:\d{2}(\.\d{1,3})?\]/g);
    if (!tags) continue;
    const content = line.replace(/\[\d{2}:\d{2}(\.\d{1,3})?\]/g, '').trim();
    if (!content) continue;
    for (const tag of tags) {
      map.set(tag, content);
    }
  }
  return map;
}
