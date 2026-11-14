/**
 * B 站业务模块（主进程）
 *
 * 覆盖：搜索、视频信息（cid）、取流（音频/视频）、字幕、b23.tv 短链。
 * 与 BBPlayer（MIT）的实现思路一致：playurl 的音质优先级为
 * flac(Hi-Res) > dolby > 带宽最高的一条；老视频无 dash 时回退 durl[0]。
 */
import fetch from 'node-fetch';

import {
  BILIBILI_API_BASE,
  BILIBILI_REFERER,
  BILIBILI_UA,
  bilibiliFetchText,
  bilibiliGet,
  bilibiliHeaders,
  normalizeUrl
} from './client';
import { withWbi } from './wbi';

export { normalizeUrl } from './client';

// ==================== 类型 ====================

export interface BilibiliSearchItem {
  bvid: string;
  aid: number;
  title: string;
  picUrl: string;
  durationMs: number;
  author: string;
  authorId: number;
  playCount: number;
  pubdate: number;
  url: string;
}

export interface BilibiliVideoInfo {
  bvid: string;
  aid: number;
  cid: number;
  title: string;
  picUrl: string;
  durationMs: number;
  author: string;
  authorId: number;
  pages: { cid: number; page: number; part: string; durationMs: number }[];
}

export interface BilibiliStream {
  url: string;
  /** 'dash' = 单轨 fMP4；'mp4' = durl 老视频回退 */
  kind: 'dash' | 'mp4';
  /** 音质/清晰度 id（B 站原始值） */
  quality: number;
  /** 直链失效时间戳（毫秒） */
  expireAt: number;
  /** 视频模式的分离轨（音频模式忽略） */
  videoTracks?: { id: number; url: string; width: number; height: number; bandwidth: number }[];
}

export interface BilibiliSubtitleTrack {
  id: string;
  lan: string;
  lanDoc: string;
  url: string;
}

export interface BilibiliSubtitleLine {
  from: number;
  to: number;
  content: string;
}

// ==================== 内部工具 ====================

const stripHtml = (value: string): string => String(value || '').replace(/<[^>]+>/g, '');

/** '12:34' / '1:02:33' → 毫秒 */
export function parseDurationToMs(value: string | number | undefined): number {
  if (typeof value === 'number') return Math.round(value * 1000);
  const text = String(value || '').trim();
  if (!text) return 0;
  const parts = text.split(':').map((item) => Number(item));
  if (parts.some((item) => Number.isNaN(item))) return 0;
  return parts.reduce((total, item) => total * 60 + item, 0) * 1000;
}

/** 从直链的 deadline 参数推断失效时间，留 60s 提前量 */
function resolveExpireAt(url: string): number {
  try {
    const deadline = new URL(url).searchParams.get('deadline');
    if (deadline) {
      const seconds = Number(deadline);
      if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000 - 60_000;
    }
  } catch {
    /* 忽略解析失败 */
  }
  return Date.now() + 30 * 60 * 1000;
}

// ==================== 搜索 ====================

export async function searchBilibili(keyword: string, limit = 20): Promise<BilibiliSearchItem[]> {
  const query = await withWbi({ keyword, search_type: 'video', page: '1' });
  const data = await bilibiliGet<{ result?: any[] }>('/x/web-interface/wbi/search/type', {
    query,
    skipCookie: true
  });

  return (data?.result || [])
    // search_type=video 会混入 B 站课堂（ketang）条目，这些不是稿件、没有 bvid
    .filter((item) => item?.type !== 'ketang' && item?.bvid)
    .slice(0, limit)
    .map((item) => ({
      bvid: String(item.bvid),
      aid: Number(item.aid || item.id || 0),
      title: stripHtml(item.title),
      picUrl: normalizeUrl(String(item.pic || '')),
      durationMs: parseDurationToMs(item.duration),
      author: String(item.author || ''),
      authorId: Number(item.mid || 0),
      playCount: Number(item.play || 0),
      pubdate: Number(item.pubdate || 0),
      url: `https://www.bilibili.com/video/${item.bvid}`
    }));
}

// ==================== 视频信息（取 cid）====================

export async function getBilibiliVideoInfo(bvid: string): Promise<BilibiliVideoInfo> {
  // 用 pagelist 而非 view：pagelist 免 Cookie/指纹、无 412 风险，且分P自带 cid/标题/时长；
  // 标题与封面由调用方（搜索结果）提供，这里只负责 cid 与分P 结构。
  const data = await bilibiliGet<any[]>('/x/player/pagelist', {
    query: `bvid=${encodeURIComponent(bvid)}`,
    skipCookie: true
  });
  const pages = (data || []).map((page: any) => ({
    cid: Number(page.cid),
    page: Number(page.page || 0),
    part: String(page.part || ''),
    durationMs: parseDurationToMs(page.duration)
  }));
  if (!pages.length) throw new Error('该视频没有可用分P');
  return {
    bvid,
    aid: 0,
    cid: pages[0].cid,
    title: pages[0].part || '',
    picUrl: '',
    durationMs: pages.reduce((total, page) => total + page.durationMs, 0),
    author: '',
    authorId: 0,
    pages
  };
}

// ==================== 取流 ====================

/**
 * 取可播放直链。音频模式默认返回 durl 渐进式 mp4（含音轨）——
 * dash 的 fMP4 分片在 <audio>/Howl html5 模式下不可靠（iOS 必挂）。
 * 视频模式返回分离的音视频轨（供二期 MSE 播放器使用）。
 */
export async function getBilibiliStream(params: {
  bvid: string;
  cid: number;
  kind?: 'audio' | 'video';
  /** 'mp4'（默认，音频模式）= fnval 1 渐进式 mp4；'dash' = 纯音频轨 */
  format?: 'mp4' | 'dash';
}): Promise<BilibiliStream> {
  const { bvid, cid, kind = 'audio', format = 'mp4' } = params;
  if (!bvid || !cid) throw new Error('缺少 bvid 或 cid');

  const useDash = kind === 'video' || format === 'dash';
  const query = await withWbi({
    bvid,
    cid: String(cid),
    fnval: useDash ? '4048' : '1',
    fnver: '0',
    fourk: '1',
    ...(useDash ? {} : { qn: '16' }),
    voice_balance: '1'
  });
  const data = await bilibiliGet<any>('/x/player/wbi/playurl', { query });
  const dash = data?.dash;

  // 无 dash（含 fnval=1 的 mp4 模式）：直接用 durl
  if (!dash) {
    const durl = data?.durl?.[0];
    if (!durl?.url) throw new Error('该视频没有可用的音视频流');
    return {
      url: durl.url,
      kind: 'mp4',
      quality: Number(data?.quality || 0),
      expireAt: resolveExpireAt(durl.url)
    };
  }

  let picked: { url: string; quality: number } | null = null;
  // Hi-Res（FLAC）
  if (dash?.flac?.audio?.baseUrl) {
    picked = { url: dash.flac.audio.baseUrl, quality: Number(dash.flac.audio.id || 0) };
  }
  // 杜比全景声
  if (!picked && dash?.dolby?.audio?.[0]?.baseUrl) {
    picked = {
      url: dash.dolby.audio[0].baseUrl,
      quality: Number(dash.dolby.audio[0].id || 0)
    };
  }
  // 普通音频轨：取带宽最高的一条
  if (!picked && Array.isArray(dash?.audio) && dash.audio.length) {
    const best = [...dash.audio].sort(
      (a, b) => Number(b.bandwidth || 0) - Number(a.bandwidth || 0)
    )[0];
    picked = { url: best.baseUrl, quality: Number(best.id || 0) };
  }
  if (!picked?.url) throw new Error('未能解析出音频流');

  const stream: BilibiliStream = {
    url: picked.url,
    kind: 'dash',
    quality: picked.quality,
    expireAt: resolveExpireAt(picked.url)
  };

  if (kind === 'video' && Array.isArray(dash?.video)) {
    stream.videoTracks = dash.video.map((track: any) => ({
      id: Number(track.id || 0),
      url: String(track.baseUrl || ''),
      width: Number(track.width || 0),
      height: Number(track.height || 0),
      bandwidth: Number(track.bandwidth || 0)
    }));
  }

  return stream;
}

// ==================== 字幕 ====================

const SUBTITLE_LANGUAGE_PRIORITY = ['zh-CN', 'zh-Hans', 'zh-Hant', 'ai-zh'];

function pickSubtitleTrack(tracks: BilibiliSubtitleTrack[]): BilibiliSubtitleTrack | null {
  if (!tracks.length) return null;
  for (const lan of SUBTITLE_LANGUAGE_PRIORITY) {
    const hit = tracks.find((track) => track.lan === lan);
    if (hit) return hit;
  }
  return tracks.find((track) => track.lan.startsWith('zh')) || tracks[0];
}

/** 列出该视频可用字幕（需要登录 Cookie，否则通常为空） */
export async function getBilibiliSubtitleTracks(params: {
  bvid: string;
  cid: number;
}): Promise<BilibiliSubtitleTrack[]> {
  const query = await withWbi({ bvid: params.bvid, cid: String(params.cid) });
  const data = await bilibiliGet<any>('/x/player/wbi/v2', { query });
  const list = data?.subtitle?.subtitles || [];
  return list
    .filter((item: any) => item?.subtitle_url)
    .map((item: any) => ({
      id: String(item.id || item.id_str || item.lan),
      lan: String(item.lan || ''),
      lanDoc: String(item.lan_doc || item.lan || ''),
      url: normalizeUrl(String(item.subtitle_url))
    }));
}

/** 拉取并解析字幕正文（字幕文件本身不需要 Cookie） */
export async function fetchBilibiliSubtitleLines(
  track: BilibiliSubtitleTrack
): Promise<BilibiliSubtitleLine[]> {
  const text = await bilibiliFetchText(track.url);
  const payload = JSON.parse(text) as { body?: any[] };
  return (payload?.body || [])
    .map((item) => ({
      from: Number(item.from || 0),
      to: Number(item.to || 0),
      content: String(item.content || '').trim()
    }))
    .filter((line) => line.content && line.to > line.from);
}

/**
 * 一次性取回字幕：优先中文（可用 lan 指定具体轨），返回候选列表与选中轨的正文
 */
export async function getBilibiliSubtitle(params: {
  bvid: string;
  cid: number;
  /** 指定字幕语言（如 'ai-zh'）；不传则按中文优先自动选 */
  lan?: string;
}): Promise<{
  tracks: BilibiliSubtitleTrack[];
  picked: BilibiliSubtitleTrack | null;
  lines: BilibiliSubtitleLine[];
}> {
  const tracks = await getBilibiliSubtitleTracks(params);
  if (!tracks.length) return { tracks: [], picked: null, lines: [] };

  const preferred = params.lan ? tracks.find((track) => track.lan === params.lan) : null;
  const auto = pickSubtitleTrack(tracks);
  const ordered: BilibiliSubtitleTrack[] = [];
  for (const track of [preferred, auto, ...tracks]) {
    if (track && !ordered.includes(track)) ordered.push(track);
  }

  for (const track of ordered) {
    try {
      const lines = await fetchBilibiliSubtitleLines(track);
      if (lines.length) return { tracks, picked: track, lines };
    } catch (error) {
      console.warn('[bilibili] 字幕拉取失败，尝试下一轨:', track.lan, error);
    }
  }
  return { tracks, picked: null, lines: [] };
}

// ==================== 短链 / 链接解析 ====================

const BV_PATTERN = /BV[0-9A-Za-z]{10}/;

// ==================== 扫码登录 ====================

const PASSPORT_QR_GENERATE = 'https://passport.bilibili.com/x/passport-login/web/qrcode/generate';
const PASSPORT_QR_POLL = 'https://passport.bilibili.com/x/passport-login/web/qrcode/poll';

export interface BilibiliLoginQr {
  /** 二维码内容（用 B 站 APP 扫码） */
  url: string;
  qrcodeKey: string;
  /** 二维码失效时间（毫秒，约 180 秒） */
  expireAt: number;
}

export interface BilibiliLoginQrPoll {
  status: 'waiting' | 'scanned' | 'success' | 'expired' | 'error';
  cookie: string;
  userInfo: { nickname: string; avatarUrl: string; userId: string } | null;
}

/** 申请登录二维码 */
export async function createBilibiliLoginQr(): Promise<BilibiliLoginQr> {
  const data = await bilibiliGet<{ url: string; qrcode_key: string }>(PASSPORT_QR_GENERATE, {
    skipCookie: true
  });
  if (!data?.url || !data?.qrcode_key) throw new Error('二维码生成失败');
  return { url: data.url, qrcodeKey: data.qrcode_key, expireAt: Date.now() + 180_000 };
}

/** 从 Set-Cookie 头数组拼出 cookie 串（同名取最后一条，与浏览器行为一致） */
function combineSetCookieHeaders(rawCookies: string[]): string {
  const jar = new Map<string, string>();
  for (const entry of rawCookies) {
    const pair = entry.split(';')[0];
    const eq = pair.indexOf('=');
    if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
  return [...jar.entries()].map(([key, value]) => `${key}=${value}`).join('; ');
}

/**
 * 轮询扫码状态。
 * 成功时 cookie 来自 poll 响应的 Set-Cookie 头（SESSDATA/bili_jct/DedeUserID 等）。
 */
export async function pollBilibiliLoginQr(qrcodeKey: string): Promise<BilibiliLoginQrPoll> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  let response: any;
  let payload: { code: number; data: { code: number; url: string } };
  try {
    response = await fetch(`${PASSPORT_QR_POLL}?qrcode_key=${encodeURIComponent(qrcodeKey)}`, {
      headers: { 'User-Agent': BILIBILI_UA },
      signal: controller.signal as any
    });
    if (!response.ok) throw new Error(`二维码轮询失败: ${response.status}`);
    payload = (await response.json()) as { code: number; data: { code: number; url: string } };
  } finally {
    clearTimeout(timer);
  }
  if (payload.code !== 0) throw new Error(`二维码轮询失败: ${payload.code}`);

  const rawCode = payload.data.code;
  const status =
    rawCode === 0
      ? 'success'
      : rawCode === 86090
        ? 'scanned'
        : rawCode === 86101
          ? 'waiting'
          : rawCode === 86038
            ? 'expired'
            : 'error';

  if (status !== 'success') {
    return { status, cookie: '', userInfo: null };
  }

  // 优先用 Set-Cookie；兜底用 data.url 的查询串（同一组参数）
  const rawHeaders = (response as any).headers?.raw?.()?.['set-cookie'] || [];
  let cookie = combineSetCookieHeaders(rawHeaders);
  if (!cookie.includes('SESSDATA')) {
    try {
      const pairs = [...new URL(payload.data.url).searchParams.entries()].map(
        ([key, value]) => `${key}=${value}`
      );
      if (pairs.some((pair) => pair.startsWith('SESSDATA='))) cookie = pairs.join('; ');
    } catch {
      /* 保留原 cookie */
    }
  }
  if (!cookie.includes('SESSDATA')) throw new Error('登录成功但未能取得 SESSDATA');

  // 取账号信息（昵称/头像/mid）
  let userInfo: BilibiliLoginQrPoll['userInfo'] = null;
  try {
    const navController = new AbortController();
    const navTimer = setTimeout(() => navController.abort(), 10000);
    const navResponse = await fetch(`${BILIBILI_API_BASE}/x/web-interface/nav`, {
      headers: { 'User-Agent': BILIBILI_UA, Cookie: cookie, Referer: BILIBILI_REFERER },
      signal: navController.signal as any
    });
    clearTimeout(navTimer);
    const nav = (await navResponse.json()) as { data?: { isLogin?: boolean; mid?: number; uname?: string; face?: string } };
    if (nav?.data?.isLogin) {
      userInfo = {
        nickname: String(nav.data.uname || ''),
        avatarUrl: String(nav.data.face || ''),
        userId: String(nav.data.mid || '')
      };
    }
  } catch (error) {
    console.warn('[bilibili] 登录后获取账号信息失败:', error);
  }

  return { status: 'success', cookie, userInfo };
}

// ==================== BV/AV 互转 ====================

/**
 * BV 号 → AV 号（B 站公开算法，参考 bbplayer-app/BBPlayer，MIT）
 */
export function bv2av(bvid: string): number {
  const XOR_CODE = 23442827791579n;
  const MASK_CODE = 2251799813685247n;
  const BASE = 58n;
  const ALPHABET = 'FcwAPNKTMug3GV5Lj7EJnHpWsx4tb8haYeviqBz6rkCy12mUSDQX9RdoZf';

  const chars = Array.from(bvid);
  [chars[3], chars[9]] = [chars[9], chars[3]];
  [chars[4], chars[7]] = [chars[7], chars[4]];
  const body = chars.slice(3);
  const value = body.reduce(
    (total, ch) => total * BASE + BigInt(ALPHABET.indexOf(ch)),
    0n
  );
  return Number((value & MASK_CODE) ^ XOR_CODE);
}

// ==================== 收藏夹（需登录）====================

function getCookieValue(name: string): string {
  const cookie = process.env.BILIBILI_COOKIE || '';
  const pair = cookie
    .split(';')
    .find((item) => item.trim().startsWith(`${name}=`));
  return pair ? pair.split('=').slice(1).join('=').trim() : '';
}

async function getBilibiliMid(): Promise<number> {
  const data = await bilibiliGet<any>('/x/web-interface/nav', {});
  return Number(data?.mid || 0);
}

export interface BilibiliFavFolder {
  id: number;
  title: string;
  /** 该文件夹是否已包含目标视频 */
  favState: number;
  mediaCount: number;
}

/** 列出用户收藏夹及目标视频在其中的收藏状态 */
export async function getBilibiliFavFolders(bvid: string): Promise<BilibiliFavFolder[]> {
  const mid = await getBilibiliMid();
  if (!mid) throw new Error('哔哩哔哩未登录');
  const avid = bv2av(bvid);
  const data = await bilibiliGet<any>('/x/v3/fav/folder/created/list-all', {
    query: `up_mid=${mid}&rid=${avid}&type=2`
  });
  return (data?.list || []).map((folder: any) => ({
    id: Number(folder.id),
    title: String(folder.title || ''),
    favState: Number(folder.fav_state || 0),
    mediaCount: Number(folder.media_count || 0)
  }));
}

/** 收藏/取消收藏：add_ids 加入的文件夹，del_ids 移出的文件夹 */
export async function dealBilibiliFavorite(
  bvid: string,
  addIds: number[] = [],
  delIds: number[] = []
): Promise<void> {
  const csrf = getCookieValue('bili_jct');
  if (!csrf) throw new Error('哔哩哔哩未登录');
  const avid = bv2av(bvid);
  const body = new URLSearchParams({
    rid: String(avid),
    add_media_ids: addIds.join(','),
    del_media_ids: delIds.join(','),
    type: '2',
    csrf
  });
  const response = await fetch(`${BILIBILI_API_BASE}/x/v3/fav/resource/deal`, {
    method: 'POST',
    headers: {
      ...bilibiliHeaders({}),
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: body.toString()
  });
  const payload = (await response.json()) as { code: number; message?: string };
  if (payload.code !== 0) {
    throw new Error(`收藏操作失败: ${payload.code} ${payload.message || ''}`.trim());
  }
}

/** 从任意文本（含 b23.tv 短链）里解析出 bvid */
export async function resolveBilibiliBvid(input: string): Promise<string | null> {  const text = String(input || '').trim();
  if (!text) return null;

  const direct = BV_PATTERN.exec(text);
  if (direct) return direct[0];

  if (/b23\.tv/i.test(text)) {
    const shortUrl = /https?:\/\/[^\s]*b23\.tv[^\s]*/i.exec(text)?.[0];
    if (shortUrl) {
      try {
        const html = await bilibiliFetchText(shortUrl);
        const canonical = /<link[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["']/i.exec(html);
        const fromCanonical = canonical ? BV_PATTERN.exec(canonical[1]) : null;
        if (fromCanonical) return fromCanonical[0];
      } catch (error) {
        console.warn('[bilibili] b23 短链解析失败:', error);
      }
    }
  }
  return null;
}
