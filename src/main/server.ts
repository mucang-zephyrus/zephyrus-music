import { ipcMain } from 'electron';
import Store from 'electron-store';
import fs from 'fs';
import fetch from 'node-fetch';
import os from 'os';
import path from 'path';

import {
  dealBilibiliFavorite,
  getBilibiliFavFolders,
  getBilibiliStream,
  getBilibiliSubtitle,
  getBilibiliVideoInfo,
  resolveBilibiliBvid
} from './modules/bilibili';
import { BILIBILI_UA } from './modules/bilibili/client';
import {
  getPlatformCookie,
  getPlatformLoginStatus,
  loadPlatformCookies,
  multiPlatformSearch,
  type SearchPlatform,
  setPlatformCookie
} from './multiPlatformSearch';
import { type Platform, unblockMusic } from './unblockMusic';

// 必须在 import netease-cloud-music-api-alger 之前创建 anonymous_token 文件
// 否则模块加载时 readFileSync 会因文件不存在而崩溃
if (!fs.existsSync(path.resolve(os.tmpdir(), 'anonymous_token'))) {
  fs.writeFileSync(path.resolve(os.tmpdir(), 'anonymous_token'), '', 'utf-8');
}

const store = new Store();

// 启动时加载已保存的平台 Cookie 到 process.env
loadPlatformCookies();

// 设置音乐解析的处理程序
ipcMain.handle('unblock-music', async (_event, id, songData, enabledSources) => {
  try {
    const result = await unblockMusic(id, songData, 1, enabledSources as Platform[]);
    return result;
  } catch (error) {
    console.error('音乐解析失败:', error);
    return { error: (error as Error).message || '未知错误' };
  }
});

// ==================== 多平台搜索 IPC ====================

// 多平台搜索
ipcMain.handle('multi-platform-search', async (_event, keyword: string, platforms: SearchPlatform[], limit?: number) => {
  try {
    return await multiPlatformSearch(keyword, platforms, limit || 20);
  } catch (error) {
    console.error('多平台搜索失败:', error);
    return [];
  }
});

// 获取平台 Cookie 配置
ipcMain.handle('get-platform-cookie', (_event, platform: SearchPlatform) => {
  return getPlatformCookie(platform);
});

// 设置平台 Cookie
ipcMain.handle('set-platform-cookie', (_event, platform: SearchPlatform, cookie: string) => {
  setPlatformCookie(platform, cookie);
  return true;
});

// 获取所有平台登录状态
ipcMain.handle('get-platform-login-status', () => {
  return getPlatformLoginStatus();
});

// ==================== B 站 IPC ====================

// 账号数据（收藏夹映射为歌单格式，供 /list TAB 使用）
ipcMain.handle('bilibili-account-data', async (_event, cookie: string) => {
  try {
    const headers = { Cookie: cookie || process.env.BILIBILI_COOKIE || '', 'User-Agent': BILIBILI_UA, Referer: 'https://www.bilibili.com/' };
    const navRes = await fetch('https://api.bilibili.com/x/web-interface/nav', { headers });
    const nav = (await navRes.json()) as any;
    const mid = Number(nav?.data?.mid || 0);
    if (!mid) return { error: '哔哩哔哩登录已失效' };

    const favRes = await fetch(`https://api.bilibili.com/x/v3/fav/folder/created/list-all?up_mid=${mid}&type=2`, { headers });
    const fav = (await favRes.json()) as any;
    const playlists = (fav?.data?.list || []).map((folder: any) => ({
      id: Number(folder.id),
      name: String(folder.title || ''),
      coverImgUrl: String(folder.cover || '').replace(/^\/\//, 'https://'),
      trackCount: Number(folder.media_count || 0),
      userId: String(mid)
    }));
    return {
      data: {
        userInfo: { userId: String(mid), nickname: String(nav?.data?.uname || ''), avatarUrl: '', vip: false },
        playlists
      }
    };
  } catch (error) {
    return { error: (error as Error).message || '获取账号数据失败' };
  }
});

// 收藏夹内视频列表
ipcMain.handle('bilibili-playlist-tracks', async (_event, cookie: string, folderId: string, page?: number) => {
  try {
    const pn = Math.max(1, page || 1);
    const headers = { Cookie: cookie || process.env.BILIBILI_COOKIE || '', 'User-Agent': BILIBILI_UA, Referer: 'https://www.bilibili.com/' };
    const res = await fetch(`https://api.bilibili.com/x/v3/fav/resource/list?media_id=${folderId}&pn=${pn}&ps=20&type=2&order=mtime`, { headers });
    const data = (await res.json()) as any;
    const medias = (data?.data?.medias || []).filter((m: any) => m?.bvid);
    const songs = medias.map((media: any) => ({
      bvid: String(media.bvid),
      aid: Number(media.aid || 0),
      cid: Number(media.cid || 0),
      title: String(media.title || '').replace(/<[^>]+>/g, ''),
      picUrl: String(media.cover || '').replace(/^\/\//, 'https://'),
      durationMs: Number(media.duration || 0) * 1000,
      author: String(media.upper?.name || ''),
      url: `https://www.bilibili.com/video/${media.bvid}`
    }));
    const folderInfo = data?.data?.info || {};
    return {
      data: {
        playlist: {
          id: Number(folderInfo.id || folderId),
          name: String(folderInfo.title || ''),
          coverImgUrl: String(folderInfo.cover || '').replace(/^\/\//, 'https://'),
          trackCount: Number(folderInfo.media_count || songs.length)
        },
        songs,
        page: pn
      }
    };
  } catch (error) {
    return { error: (error as Error).message || '获取收藏夹内容失败' };
  }
});

// 评论（旧接口，匿名可读）
ipcMain.handle('bilibili-comments', async (_event, oid: number, pn?: number) => {
  try {
    const pageNum = Math.max(1, pn || 1);
    const headers = { 'User-Agent': BILIBILI_UA, Referer: 'https://www.bilibili.com/' };
    const res = await fetch(`https://api.bilibili.com/x/v2/reply?pn=${pageNum}&type=1&oid=${oid}&sort=1`, { headers });
    const data = (await res.json()) as any;
    if (data.code !== 0) return { error: data.message || '评论获取失败' };
    const replies = (data.data?.replies || []).map((reply: any) => ({
      rpid: Number(reply.rpid),
      oid: Number(reply.oid),
      nickname: String(reply.member?.uname || ''),
      avatarUrl: String(reply.member?.avatar || '').replace(/^\/\//, 'https://'),
      content: String(reply.content?.message || ''),
      ctime: Number(reply.ctime || 0) * 1000,
      likedCount: Number(reply.like || 0),
      replies: (reply.replies || []).map((sub: any) => ({
        rpid: Number(sub.rpid),
        nickname: String(sub.member?.uname || ''),
        avatarUrl: String(sub.member?.avatar || '').replace(/^\/\//, 'https://'),
        content: String(sub.content?.message || ''),
        ctime: Number(sub.ctime || 0) * 1000
      }))
    }));
    return { data: { total: Number(data.data?.page?.count || 0), replies } };
  } catch (error) {
    return { error: (error as Error).message || '评论获取失败' };
  }
});

// 视频信息（拿 cid / 分P）
ipcMain.handle('bilibili-video-info', async (_event, bvid: string) => {
  try {
    return { data: await getBilibiliVideoInfo(bvid) };
  } catch (error) {
    return { error: (error as Error).message || '获取视频信息失败' };
  }
});

// 取流（音频轨；视频轨为二期预留）
ipcMain.handle(
  'bilibili-stream',
  async (_event, params: { bvid: string; cid: number; kind?: 'audio' | 'video' }) => {
    try {
      return { data: await getBilibiliStream(params) };
    } catch (error) {
      return { error: (error as Error).message || '解析播放地址失败' };
    }
  }
);

// 字幕（含候选轨与正文）
ipcMain.handle('bilibili-subtitle', async (_event, params: { bvid: string; cid: number }) => {
  try {
    return { data: await getBilibiliSubtitle(params) };
  } catch (error) {
    return { error: (error as Error).message || '获取字幕失败' };
  }
});

// 链接/短链 → bvid
ipcMain.handle('bilibili-resolve-bvid', async (_event, input: string) => {
  try {
    return { data: await resolveBilibiliBvid(input) };
  } catch (error) {
    return { error: (error as Error).message || '解析链接失败' };
  }
});

// 收藏夹列表（含目标视频的收藏状态；需 B 站登录）
ipcMain.handle('bilibili-fav-folders', async (_event, bvid: string) => {
  try {
    return { data: await getBilibiliFavFolders(bvid) };
  } catch (error) {
    return { error: (error as Error).message || '获取收藏夹失败' };
  }
});

// 收藏/取消收藏（同步到 B 站收藏夹）
ipcMain.handle(
  'bilibili-fav-deal',
  async (_event, params: { bvid: string; addIds?: number[]; delIds?: number[] }) => {
    try {
      await dealBilibiliFavorite(params.bvid, params.addIds || [], params.delIds || []);
      return { data: true };
    } catch (error) {
      return { error: (error as Error).message || '收藏操作失败' };
    }
  }
);

/**
 * 检查端口是否可用
 */
function checkPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const net = require('net');
    const tester = net
      .createServer()
      .once('error', () => {
        resolve(false);
      })
      .once('listening', () => {
        tester.close(() => resolve(true));
      })
      .listen(port);
  });
}

async function startMusicApi(): Promise<void> {

  const settings = store.get('set') as any;
  let port = settings?.musicApiPort || 30488;
  const maxRetries = 10;

  // 检查端口是否可用，如果不可用则尝试下一个端口
  for (let i = 0; i < maxRetries; i++) {
    const isAvailable = await checkPortAvailable(port);
    if (isAvailable) {
      break;
    }
    port++;
  }

  // 如果端口发生变化，保存新端口到配置
  const originalPort = settings?.musicApiPort || 30488;
  if (port !== originalPort) {
    store.set('set', { ...settings, musicApiPort: port });
  }

  try {
    const server = require('netease-cloud-music-api-alger/server');
    await server.serveNcmApi({
      port,
      // 安全默认值：仅监听本机回环地址，避免对局域网暴露
      host: '127.0.0.1'
    });
  } catch (error) {
    console.error(`MUSIC API 启动失败:`, error);
    throw error;
  }
}

export { startMusicApi };
