/**
 * Deep link / 剪贴板分享处理工具
 * 识别三平台分享文本及 Zephyrus 链接，弹出卡片供用户手动播放
 *
 * 统一入口：无论是 Intent deep link 还是剪贴板检测，都走卡片流程
 */

import { getMusicDetail } from '@/api/music';
import { startShareClipboardMonitor } from '@/services/shareClipboard';
import type { SongResult } from '@/types/music';

import { extractMusicShareUrls, parseMusicShareUrl } from '../../shared/musicShareLink.mjs';

// 防止重复处理同一个 URL（卡片显示期间）
let lastHandledUrl = '';

// SharedSongCard 组件引用
let sharedSongCardRef: {
  showSongCard: (songId: number) => void;
  showShareCard: (url: string) => void;
  showCollectionCard: (kind: 'playlist' | 'album', id: number) => void;
} | null = null;

// ListenTogetherInviteModal 组件引用
let listenTogetherInviteRef: { showInvite: (roomCode: string) => void } | null = null;

// 待处理的 URL 队列：如果组件尚未就绪，先缓存，就绪后重放
let pendingUrl: string | null = null;

/** Native intents, clipboard text and explicit paste share this entry. */
async function processShareUrl(text: string): Promise<boolean> {
  const url = extractMusicShareUrls(text)[0];
  if (!url) return false;
  const target = parseMusicShareUrl(url);
  if (target?.kind === 'listen') {
    if (listenTogetherInviteRef) listenTogetherInviteRef.showInvite(target.id);
    else pendingUrl = url;
    return true;
  }
  if (!sharedSongCardRef) {
    pendingUrl = url;
    return true;
  }
  const key = target ? `${target.kind}:${target.platform}:${target.id}` : url;
  if (key === lastHandledUrl) return true;
  lastHandledUrl = key;
  if (target?.kind === 'playlist' || target?.kind === 'album')
    sharedSongCardRef.showCollectionCard(target.kind, Number(target.id));
  else sharedSongCardRef.showShareCard(url);
  return true;
}

/**
 * 兜底：直接播放（仅在卡片组件完全不可用时使用）
 */
export async function playSongById(songId: number): Promise<void> {
  const { usePlayerStore } = await import('@/store/modules/player');
  const playerStore = usePlayerStore();

  const res = await getMusicDetail([songId]);
  const song = res?.data?.songs?.[0] as SongResult | undefined;
  if (!song) {
    console.warn('[ShareLink] 未找到歌曲, id:', songId);
    return;
  }

  // 确保 picUrl 在顶层（播放器 UI 依赖）
  const playableSong = {
    ...song,
    picUrl: song.al?.picUrl || song.album?.picUrl || song.picUrl || ''
  };

  playerStore.setPlayList([playableSong], false);
  playerStore.setPlay(playableSong);
  playerStore.setMusicFull(true);
}

/**
 * 处理 deep link（Intent 跳转）
 * 注册到 window.__handleDeepLink，行为与剪贴板一致：弹卡片
 */
export async function handleDeepLink(url: string): Promise<boolean> {
  return processShareUrl(url);
}

/**
 * 处理剪贴板分享链接
 * 注册到 window.__handleClipboardShare
 */
export async function handleClipboardShare(url: string): Promise<boolean> {
  return processShareUrl(url);
}

/**
 * 重置去重标记（卡片关闭后调用，允许同一链接再次处理）
 */
export function resetLastHandledUrl(): void {
  lastHandledUrl = '';
}

/**
 * 注册 SharedSongCard 组件引用
 * 注册后如果有待处理的 URL，立即重放
 */
export function setSharedSongCardRef(
  ref: {
    showSongCard: (songId: number) => void;
    showShareCard: (url: string) => void;
    showCollectionCard: (kind: 'playlist' | 'album', id: number) => void;
  } | null
): void {
  sharedSongCardRef = ref;

  // 组件就绪后，重放缓存的 URL
  replayPendingUrl();
}

function replayPendingUrl() {
  const target = pendingUrl && parseMusicShareUrl(pendingUrl);
  const ready = target && target.kind === 'listen' ? listenTogetherInviteRef : sharedSongCardRef;
  if (ready && pendingUrl) {
    const url = pendingUrl;
    pendingUrl = null;
    // 重放时清除 lastHandledUrl，确保能正常处理
    lastHandledUrl = '';
    processShareUrl(url).catch(console.error);
  }
}

/**
 * 注册一起听邀请弹窗组件引用
 */
export function setListenTogetherInviteRef(
  ref: { showInvite: (roomCode: string) => void } | null
): void {
  listenTogetherInviteRef = ref;
  replayPendingUrl();
}

/**
 * 注册处理器到 window
 * 在应用启动时调用，原生 MainActivity 通过 evaluateJavascript 调用
 */
let stopClipboard: (() => void) | undefined;
export function setupDeepLinkHandler(): void {
  stopClipboard?.();
  const accept = (text: string) => {
    if (!extractMusicShareUrls(text).length) return false;
    void processShareUrl(text).catch(console.error);
    return true;
  };
  (window as any).__handleDeepLink = accept;
  (window as any).__handleClipboardShare = accept;
  // Android's native listener supplies clipboard text and handles foreground access.
  if (!(window as any).AndroidNative) {
    stopClipboard = startShareClipboardMonitor({
      onText: handleClipboardShare,
      ...((window as any).api?.readMusicShareClipboard
        ? {
            readText: () => (window as any).api.readMusicShareClipboard(),
            canRead: async () => true
          }
        : {})
    });
  }
}
