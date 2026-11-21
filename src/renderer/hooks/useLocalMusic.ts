/**
 * 本地歌曲专属解析逻辑模块
 *
 * 所有本地歌曲（URL 以 local:// 开头）的播放、歌词、进度条逻辑
 * 与在线歌曲完全分离，不走网易云 API
 */
import { createDiscreteApi } from 'naive-ui';

import type { ILyric, SongResult } from '@/types/music';

import { parseLyricContent } from '@/utils/localMusicUtils';

let _message: ReturnType<typeof createDiscreteApi>['message'] | null = null;
const getMessage = () => {
  if (!_message) _message = createDiscreteApi(['message']).message;
  return _message;
};

/**
 * 判断是否为本地歌曲
 */
export function isLocalSong(song: SongResult | null | undefined): boolean {
  if (!song) return false;
  // 云端托管歌曲和跨平台歌曲不是本地歌曲
  if (song.platform && song.platform !== 'netease') return false;
  return song.playMusicUrl?.startsWith('local://') || typeof song.id === 'string';
}

/**
 * 本地歌曲专属逻辑
 */
export function useLocalMusic() {
  const message = getMessage();

  /**
   * 本地歌词加载（不走网易云 API）
   * 优先级：内嵌歌词 → 社区歌词 → 空
   */
  const loadLocalLyrics = async (song: SongResult): Promise<ILyric> => {
    const songId = song.id?.toString();

    // 内嵌歌词（已存在于 song.lyric）
    if (song.lyric) {
      if (song.lyric.lrcTimeArray.length > 0) {
        return song.lyric;
      }
      // 内嵌歌词无时间戳但有文本：也返回，供静态展示
      if (song.lyric.lrcArray.length > 0) {
        return song.lyric;
      }
    }

    // 社区歌词
    try {
      const { loadCommunityLyricForSong } = await import('@/api/communityLyric');
      const communityLyric = await loadCommunityLyricForSong(songId || '');
      if (communityLyric?.lrc) {
        const result = parseLyricContent(communityLyric.lrc);
        if (result && result.lrcTimeArray.length > 0) {
          result.sourceId = `community:${communityLyric.id}`;
          return result;
        }
      }
    } catch {
      // 社区歌词加载失败，静默处理
    }

    // 空歌词
    return { lrcTimeArray: [], lrcArray: [], hasWordByWord: false };
  };

  /**
   * 本地歌曲错误处理（不自动跳下一首）
   */
  const handleLocalError = (song: SongResult) => {
    message.error(`本地文件无法播放: ${song.name}`);
  };

  return {
    loadLocalLyrics,
    handleLocalError
  };
}
