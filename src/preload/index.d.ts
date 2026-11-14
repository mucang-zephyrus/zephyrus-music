import { ElectronAPI } from '@electron-toolkit/preload';

import type { InstalledPlugin, PluginStoreItem } from '../renderer/types/plugin';
import type { AppUpdateState } from '../shared/appUpdate';

interface API {
  readMusicShareClipboard: () => Promise<string>;
  minimize: () => void;
  maximize: () => void;
  close: () => void;
  quitApp: () => void;
  dragStart: (data: any) => void;
  miniTray: () => void;
  miniWindow: () => void;
  restore: () => void;
  toggleFullScreen: () => void;
  isFullScreen: () => Promise<boolean>;
  onFullScreenChanged: (callback: (isFullScreen: boolean) => void) => () => void;
  restart: () => void;
  resizeWindow: (width: number, height: number) => void;
  resizeMiniWindow: (showPlaylist: boolean) => void;
  openLyric: () => void;
  sendLyric: (data: any) => void;
  sendCoverColor: (color: string) => void;
  sendSong: (data: any) => void;
  unblockMusic: (id: number, data: any, enabledSources?: string[]) => Promise<any>;
  onLyricWindowClosed: (callback: () => void) => void;
  onLyricWindowReady: (callback: () => void) => void;
  getAppUpdateState: () => Promise<AppUpdateState>;
  checkAppUpdate: (manual?: boolean) => Promise<AppUpdateState>;
  downloadAppUpdate: () => Promise<AppUpdateState>;
  installAppUpdate: () => Promise<boolean>;
  openAppUpdatePage: () => Promise<boolean>;
  onAppUpdateState: (callback: (state: AppUpdateState) => void) => void;
  removeAppUpdateListeners: () => void;
  onLanguageChanged: (callback: (locale: string) => void) => void;
  importCustomApiPlugin: () => Promise<{ name: string; content: string } | null>;
  importLxMusicScript: () => Promise<{ name: string; content: string } | null>;
  openExternal: (url: string) => Promise<void>;
  invoke: (channel: string, ...args: any[]) => Promise<any>;
  getSearchSuggestions: (keyword: string) => Promise<any>;
  lxMusicHttpRequest: (request: { url: string; options: any; requestId: string }) => Promise<any>;
  lxMusicHttpCancel: (requestId: string) => Promise<void>;
  /** 扫描指定文件夹中的本地音乐文件 */
  scanLocalMusic: (folderPath: string) => Promise<{ files: string[]; count: number }>;
  /** 扫描指定文件夹中的本地音乐文件（包含修改时间） */
  scanLocalMusicWithStats: (
    folderPath: string
  ) => Promise<{ files: { path: string; modifiedTime: number }[]; count: number }>;
  /** 批量解析本地音乐文件元数据 */
  parseLocalMusicMetadata: (
    filePaths: string[]
  ) => Promise<import('../renderer/types/localMusic').LocalMusicMeta[]>;

  /** 插件商店 API */
  plugin: {
    getRegistry: () => Promise<PluginStoreItem[]>;
    getInstalled: () => Promise<Record<string, InstalledPlugin>>;
    install: (_item: PluginStoreItem) => Promise<InstalledPlugin>;
    uninstall: (_pluginId: string) => Promise<boolean>;
    toggleEnabled: (_pluginId: string, _enabled: boolean) => Promise<boolean>;
    importFile: (
      _type: string
    ) => Promise<{ name: string; content: string; filePath: string } | null>;
    refreshRegistry: () => Promise<PluginStoreItem[]>;
    testMirrors: () => Promise<
      { name: string; url: string; ok: boolean; latencyMs: number; speed: number; error?: string }[]
    >;
    onInstallProgress: (
      _callback: (data: { pluginId: string; status: string; percent?: number }) => void
    ) => () => void;
  };

  /** 多平台搜索 */
  multiPlatformSearch: (
    keyword: string,
    platforms: string[],
    limit?: number
  ) => Promise<
    {
      platform: string;
      songs: {
        id: string;
        name: string;
        artists: string[];
        album: string;
        duration: number;
        picUrl?: string;
        platform: string;
        platformId: string;
      }[];
      error?: string;
    }[]
  >;
  getPlatformCookie: (
    platform: string
  ) => Promise<{ cookie: string; expiresAt: number; updatedAt: number } | null>;
  setPlatformCookie: (platform: string, cookie: string) => Promise<boolean>;
  getPlatformLoginStatus: () => Promise<Record<string, boolean>>;
  openPlatformLogin: (platform: string) => Promise<boolean>;
  onPlatformLoginCookie: (callback: (platform: string, cookie: string) => void) => void;

  /** 平台扫码登录 */
  platformQrCreate: (platform: string, provider?: 'qq' | 'wechat') => Promise<{
    platform: string;
    provider: string;
    qrUrl: string;
    key: string;
    expiredAt: number;
    error?: string;
  }>;
  platformQrPoll: (
    platform: string,
    key: string,
    provider?: 'qq' | 'wechat'
  ) => Promise<{
    platform: string;
    provider: string;
    code: 'waiting' | 'scanned' | 'success' | 'expired' | 'error';
    message: string;
    cookie?: string;
    userInfo?: {
      nickname?: string;
      avatarUrl?: string;
      userId?: string;
    };
  }>;

  /** 哔哩哔哩：视频信息 / 取流 / 字幕 / 链接解析 */
  bilibiliVideoInfo: (bvid: string) => Promise<{
    data?: {
      bvid: string;
      aid: number;
      cid: number;
      title: string;
      picUrl: string;
      durationMs: number;
      author: string;
      authorId: number;
      pages: { cid: number; page: number; part: string; durationMs: number }[];
    };
    error?: string;
  }>;
  bilibiliStream: (params: { bvid: string; cid: number; kind?: 'audio' | 'video' }) => Promise<{
    data?: {
      url: string;
      kind: 'dash' | 'mp4';
      quality: number;
      expireAt: number;
      videoTracks?: { id: number; url: string; width: number; height: number; bandwidth: number }[];
    };
    error?: string;
  }>;
  bilibiliSubtitle: (params: { bvid: string; cid: number; lan?: string }) => Promise<{
    data?: {
      tracks: { id: string; lan: string; lanDoc: string; url: string }[];
      picked: { id: string; lan: string; lanDoc: string; url: string } | null;
      lines: { from: number; to: number; content: string }[];
    };
    error?: string;
  }>;
  bilibiliResolveBvid: (input: string) => Promise<{ data?: string | null; error?: string }>;
  bilibiliFavFolders: (bvid: string) => Promise<{
    data?: { id: number; title: string; favState: number; mediaCount: number }[];
    error?: string;
  }>;
  bilibiliFavDeal: (params: { bvid: string; addIds?: number[]; delIds?: number[] }) => Promise<{
    data?: boolean;
    error?: string;
  }>;
  bilibiliAccountData: (cookie: string) => Promise<{
    data?: {
      userInfo: { userId: string; nickname: string; avatarUrl: string; vip: boolean };
      playlists: { id: number; name: string; coverImgUrl: string; trackCount: number; userId: string }[];
    };
    error?: string;
  }>;
  bilibiliPlaylistTracks: (cookie: string, folderId: string, page?: number) => Promise<{
    data?: {
      playlist: { id: number; name: string; coverImgUrl: string; trackCount: number };
      songs: { bvid: string; title: string; picUrl: string; durationMs: number; author: string; url: string }[];
      page: number;
    };
    error?: string;
  }>;
  bilibiliComments: (oid: number, pn?: number) => Promise<{
    data?: { total: number; replies: any[] };
    error?: string;
  }>;
}

// 自定义IPC渲染进程通信接口
interface IpcRenderer {
  send: (channel: string, ...args: any[]) => void;
  invoke: (channel: string, ...args: any[]) => Promise<any>;
  on: (channel: string, listener: (...args: any[]) => void) => () => void;
  removeAllListeners: (channel: string) => void;
}

declare global {
  interface Window {
    electron: ElectronAPI;
    api: API;
    ipcRenderer: IpcRenderer;
    $message: any;
  }
}
