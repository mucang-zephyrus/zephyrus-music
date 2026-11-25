/**
 * 多平台扫码登录 API（渲染进程）
 *
 * - 通过服务器调用扫码登录 API（/platform/{platform}/qr/create|poll）
 *
 * 服务器中转的优势：
 * - 解决 CapacitorHttp 在某些设备上无法读取 Set-Cookie 头的问题
 * - 统一处理 QQ 音乐的 hash33 算法和重定向 Cookie 获取
 * - 酷狗新 API (login-user.kugou.com) 需要 Web 签名，服务器端统一处理
 */

import axios, { type AxiosError } from 'axios';

import type { SongResult } from '@/types/music';
import {
  IS_WEB_TEST_SITE,
  platformAccountStorageKey,
  testGatewayForOrigin
} from '@/utils/appVersion';
import {
  classifyPlatformLoginFailure,
  parseQqChannels,
  type QqLoginChannels
} from '@/utils/platformLoginDiagnostics';
import { normalizePlatformQrProvider, normalizePlatformQrStatus } from '@/utils/platformQr';

// ==================== 类型定义 ====================

export type LoginPlatform = 'qq' | 'kugou' | 'bilibili';
export type QqLoginProvider = 'qq' | 'wechat';
/** 新链三通道（qq-music-api channels），qqmusic=QQ 音乐 App 通用码（三 App 都能扫） */
export type QqApiChannel = QqLoginProvider | 'qqmusic';

export interface QrCreateResult {
  platform: LoginPlatform;
  provider: QqLoginProvider | 'qqmusic' | 'kugou' | 'bilibili';
  transport: 'legacy' | 'qq-api' | 'kugou-api';
  qrUrl: string;
  key: string;
  expiredAt: number;
  error?: string;
}

export interface QrPollResult {
  platform: LoginPlatform;
  provider: QqLoginProvider | 'qqmusic' | 'kugou' | 'bilibili';
  code: 'waiting' | 'scanned' | 'success' | 'expired' | 'error';
  message: string;
  cookie?: string;
  userInfo?: {
    nickname?: string;
    avatarUrl?: string;
    userId?: string;
  };
}

export interface PlatformAccountData {
  userInfo?: {
    userId?: string;
    nickname?: string;
    avatarUrl?: string;
    vip?: boolean;
    vipLabel?: string;
  };
  playlists: any[];
  favorites: any[];
  albums: any[];
  history: any[];
  playlistError?: string;
  profileError?: string;
}

export interface PlatformPlaylistTracks {
  playlist?: Record<string, unknown>;
  songs: any[];
  page?: number;
  pageSize?: number;
}

// ==================== 服务器中转 API ====================

const DEFAULT_GATEWAY_URL = 'https://mucang.xyz/zephyrus/api';
const gatewayBaseURL = (import.meta.env.VITE_MUSIC_GATEWAY || DEFAULT_GATEWAY_URL)
  .replace(/\/+$/, '')
  .replace(/\/platform$/i, '');

const gatewayRequest = axios.create({
  baseURL: gatewayBaseURL,
  timeout: 15000
});

if (IS_WEB_TEST_SITE) {
  const testGateway = testGatewayForOrigin(window.location.origin);
  gatewayRequest.interceptors.request.use((config) => {
    if (/^\/platform\/(?:qq|kugou)\//.test(config.url ?? '')) config.baseURL = testGateway;
    return config;
  });
}

function gatewayError(error: unknown, action: string): Error {
  const axiosError = error as AxiosError<{ msg?: string }>;
  const status = axiosError.response?.status;
  const serverMessage = axiosError.response?.data?.msg;

  if (status === 404) {
    return new Error(`扫码网关路由不存在，请检查 VITE_MUSIC_GATEWAY：${gatewayBaseURL}`);
  }
  if (serverMessage) {
    return new Error(serverMessage);
  }
  if (axiosError.code === 'ECONNABORTED') {
    return new Error(`${action}超时，请检查扫码网关连接`);
  }
  return new Error(axiosError.message || `${action}失败`);
}

/**
 * 通过服务器中转 API 创建二维码
 * 路由：GET /platform/{platform}/qr/create
 */
async function createQrViaServer(
  platform: LoginPlatform,
  provider: QqLoginProvider = 'qq'
): Promise<QrCreateResult> {
  try {
    // 哔哩哔哩的路由挂在独立的 /bilibili 前缀下
    const path =
      platform === 'bilibili' ? '/bilibili/qr/create' : `/platform/${platform}/qr/create`;
    const response = await gatewayRequest.get(path, {
      params: { provider: platform === 'qq' ? provider : undefined, noCache: Date.now() }
    });
    const json = response.data;
    if (json.code !== 0 && json.code !== 200) {
      throw new Error(json.msg || `${platform} 二维码创建失败`);
    }
    if (!json.data) {
      throw new Error(`${platform} 二维码创建失败`);
    }
    if (platform === 'qq' && provider === 'wechat' && json.data.provider !== 'wechat') {
      throw new Error('QQ 音乐登录网关版本过旧，未返回微信登录二维码');
    }
    return {
      platform,
      provider: normalizePlatformQrProvider(platform, json.data.provider, provider),
      transport: 'legacy',
      qrUrl: json.data.qrUrl || json.data.url,
      key: json.data.qrcodeKey || json.data.key,
      expiredAt: json.data.expiredAt || Date.now() + 180000
    };
  } catch (error) {
    throw gatewayError(error, `${platform} 二维码创建`);
  }
}

/**
 * 通过服务器中转 API 轮询扫码状态
 * 路由：GET /platform/{platform}/qr/poll?key=xxx
 */
async function pollQrViaServer(
  platform: LoginPlatform,
  key: string,
  provider: QqLoginProvider = 'qq'
): Promise<QrPollResult> {
  try {
    const path = platform === 'bilibili' ? '/bilibili/qr/poll' : `/platform/${platform}/qr/poll`;
    const response = await gatewayRequest.get(path, {
      params: {
        key,
        ...(platform === 'bilibili' ? { qrcodeKey: key } : {}),
        provider: platform === 'qq' ? provider : undefined,
        noCache: Date.now()
      }
    });
    const json = response.data;
    if (json.code !== 0 && json.code !== 200) {
      return {
        platform,
        provider: normalizePlatformQrProvider(platform, json.data?.provider, provider),
        code: 'error',
        message: json.msg || '轮询状态失败'
      };
    }
    const data = json.data;
    if (platform === 'bilibili') {
      return {
        platform,
        provider: 'bilibili' as QqLoginProvider,
        code: normalizePlatformQrStatus(data.status),
        message: '',
        cookie: data.cookie || undefined,
        userInfo: data.userInfo || undefined
      };
    }
    if (json.code !== 200 || !data) {
      return {
        platform,
        provider: normalizePlatformQrProvider(platform, data?.provider, provider),
        code: data?.status === 'expired' ? 'expired' : 'error',
        message: data?.message || json.msg || '轮询状态失败'
      };
    }
    if (platform === 'qq' && provider === 'wechat' && data.provider !== 'wechat') {
      return {
        platform,
        provider,
        code: 'error',
        message: 'QQ 音乐登录网关返回了错误的登录方式，请刷新后重试'
      };
    }
    return {
      platform,
      provider: normalizePlatformQrProvider(platform, data.provider, provider),
      code: normalizePlatformQrStatus(data.status),
      message: data.message,
      cookie: data.cookie,
      userInfo: data.userInfo
    };
  } catch (error) {
    throw gatewayError(error, `${platform} 登录状态轮询`);
  }
}

// ==================== 新链（Folia 移植：qq-music-api / KuGouMusicApi） ====================

/**
 * 探测网关新链能力：GET /platform/qq/api/login/channels。
 * 旧网关（404/HTML）或未配密钥（501）→ null，调用方回退旧自建登录链。
 */
export async function probeQqLoginChannels(): Promise<QqLoginChannels | null> {
  try {
    const response = await gatewayRequest.get('/platform/qq/api/login/channels', {
      timeout: 8000,
      params: { noCache: Date.now() }
    });
    return parseQqChannels(response.data);
  } catch {
    return null;
  }
}

/** 新链 QQ 扫码创建：login/qr/key → login/qr/create（响应形态 data.unikey / data.qrimg） */
async function createQqApiQr(provider: QqApiChannel): Promise<QrCreateResult> {
  try {
    const keyRes = await gatewayRequest.get('/platform/qq/api/login/qr/key', {
      params: { channel: provider, noCache: Date.now() },
      timeout: 10000
    });
    const keyData = keyRes.data?.data;
    // 上游在发放 key 时绑定扫码通道。
    const unikey = keyData?.unikey || keyData?.key;
    if (keyRes.data?.code !== 200 || !unikey) {
      throw new Error(keyRes.data?.message || 'qq-music-api 二维码 key 获取失败');
    }
    const qrRes = await gatewayRequest.get('/platform/qq/api/login/qr/create', {
      params: { key: unikey, noCache: Date.now() },
      timeout: 10000
    });
    // 响应是 JSON：{code:200, data:{qrimg: dataURL}}（qrCreate.js 恒返回 base64 图）
    const qrUrl = qrRes.data?.data?.qrimg || '';
    if (qrRes.data?.code !== 200 || !qrUrl) {
      throw new Error(qrRes.data?.message || 'qq-music-api 二维码生成失败');
    }
    return {
      platform: 'qq',
      provider,
      transport: 'qq-api',
      qrUrl,
      key: unikey,
      expiredAt: Date.now() + 180000
    };
  } catch (error) {
    const response = (error as AxiosError).response;
    if (response) {
      const failure = qqQrFailure(response.data, response.status);
      if (response.status === 404 || failure.kind === 'qr-timeout') {
        throw new Error('QQ 二维码会话已不可用，请刷新重试或切换扫码方式。');
      }
      throw new Error(failure.userMessage);
    }
    throw gatewayError(error, 'QQ 二维码创建');
  }
}

function qqQrFailure(raw: unknown, status?: number) {
  type Failure = Parameters<typeof classifyPlatformLoginFailure>[0];
  const body = raw as (Failure & { code?: number; msg?: string; data?: Failure }) | undefined;
  return classifyPlatformLoginFailure({
    status: status ?? body?.code,
    upstreamCode: body?.upstreamCode ?? body?.data?.upstreamCode ?? body?.code,
    failureReason: body?.failureReason ?? body?.data?.failureReason,
    failureHint: body?.failureHint ?? body?.data?.failureHint,
    retryAfterMs: body?.retryAfterMs ?? body?.data?.retryAfterMs,
    message: body?.message ?? body?.msg ?? body?.data?.message
  });
}

/** 800 既可能是过期，也可能是扫码后的登录交换失败。 */
async function pollQqApiQr(key: string, provider: QqApiChannel): Promise<QrPollResult> {
  try {
    const response = await gatewayRequest.get('/platform/qq/api/login/qr/check', {
      params: { key, noCache: Date.now() },
      timeout: 12000
    });
    const json = response.data;
    const code = Number(json?.code);
    // qrService.js 语义：801/802/803/800；成功时 cookie 挂在 body 顶层（非 data 内）
    if (code === 803) {
      const cookie = json?.cookie || json?.data?.cookie;
      if (typeof cookie !== 'string' || !/(?:^|;\s*)qqmusic_session=[^;\s]+/.test(cookie)) {
        return {
          platform: 'qq',
          provider,
          code: 'error',
          message: 'QQ 扫码已确认，但未收到登录凭据，请重试。'
        };
      }
      const userInfo = await fetchQqApiProfile(cookie, 5000).catch(() => undefined);
      return {
        platform: 'qq',
        provider,
        code: 'success',
        message: '登录成功',
        // stored 模式下网关持有会话；qrCheck 成功时 body.cookie 为会话引用
        cookie,
        userInfo
      };
    }
    if (code === 802) {
      return {
        platform: 'qq',
        provider,
        code: 'scanned',
        message: '请在手机上确认'
      };
    }
    if (code === 801) {
      return {
        platform: 'qq',
        provider,
        code: 'waiting',
        message: ''
      };
    }
    const failure = qqQrFailure(json);
    return {
      platform: 'qq',
      provider,
      code: code === 800 && failure.kind === 'qr-timeout' ? 'expired' : 'error',
      message: failure.userMessage
    };
  } catch (error) {
    const response = (error as AxiosError).response;
    if (response && response.status < 500) {
      const failure = qqQrFailure(response.data, response.status);
      return {
        platform: 'qq',
        provider,
        code: failure.kind === 'qr-timeout' ? 'expired' : 'error',
        message: failure.userMessage
      };
    }
    throw gatewayError(error, 'QQ 新链登录轮询');
  }
}

/** 新链酷狗扫码创建（KuGouMusicApi login/qr/key，返回内嵌二维码图） */
async function createKugouApiQr(): Promise<QrCreateResult | null> {
  try {
    const response = await gatewayRequest.get('/platform/kugou/api/login/qr/key', {
      params: { noCache: Date.now() },
      timeout: 20000
    });
    const json = response.data;
    if (json?.code !== 200 || !json?.data?.qrcode) {
      throw new Error(json?.msg || '酷狗二维码创建失败');
    }
    return {
      platform: 'kugou',
      provider: 'kugou',
      transport: 'kugou-api',
      qrUrl:
        json.data.qrcode_img ||
        `https://h5.kugou.com/apps/loginQRCode/html/index.html?qrcode=${encodeURIComponent(json.data.qrcode)}`,
      key: json.data.qrcode,
      expiredAt: Date.now() + 300000
    };
  } catch (error) {
    if ((error as AxiosError).response?.status === 404) return null;
    throw gatewayError(error, '酷狗二维码创建');
  }
}

/** 新链酷狗轮询：qrcodeStatus 1/2/4/0 → waiting/scanned/success/expired */
async function pollKugouApiQr(key: string): Promise<QrPollResult> {
  try {
    const response = await gatewayRequest.get('/platform/kugou/api/login/qr/check', {
      params: { key, noCache: Date.now() },
      timeout: 10000
    });
    const json = response.data;
    if (json?.code !== 200 || !json?.data) {
      throw new Error(json?.msg || '酷狗扫码状态查询失败');
    }
    return {
      platform: 'kugou',
      provider: 'kugou',
      code: normalizePlatformQrStatus(json.data.status),
      message: json.data.status === 'scanned' ? '请在手机上确认' : '',
      cookie: json.data.cookie,
      userInfo: json.data.userInfo
    };
  } catch (error) {
    throw gatewayError(error, '酷狗扫码轮询');
  }
}

/** QQ 登录态续期：POST /platform/qq/api/login/refresh（到期 <6h 时网关换新令牌） */
export async function refreshQqApiSession(
  cookie: string
): Promise<{ refreshed: boolean; cookie?: string }> {
  try {
    const response = await gatewayRequest.post(
      '/platform/qq/api/login/refresh',
      {},
      { headers: { 'X-Platform-Cookie': cookie }, timeout: 15000 }
    );
    const json = response.data;
    if (json?.code !== 200) return { refreshed: false };
    return { refreshed: true, cookie: json.data?.cookie || undefined };
  } catch {
    return { refreshed: false };
  }
}

/** 酷狗登录态续期：GET /platform/kugou/api/login/token/refresh */
export async function refreshKugouApiSession(
  cookie: string
): Promise<{ refreshed: boolean; cookie?: string }> {
  try {
    const response = await gatewayRequest.get('/platform/kugou/api/login/token/refresh', {
      headers: { 'X-Platform-Cookie': cookie },
      timeout: 15000
    });
    const json = response.data;
    if (json?.code !== 200 || !json?.data?.cookie) return { refreshed: false };
    return { refreshed: true, cookie: json.data.cookie };
  } catch {
    return { refreshed: false };
  }
}

/**
 * 新链歌曲播放 URL（qq → getMusicPlay 音质档位回退；kugou → song_url 带 hash）。
 * 返回 null = 新链不可用/失败，调用方回退 unblock 解析链。
 */
export async function fetchPlatformPlayUrlViaApi(
  platform: 'qq' | 'kugou',
  songId: string,
  cookie?: string,
  quality: 'standard' | 'high' | 'lossless' = 'standard'
): Promise<string | null> {
  try {
    if (platform === 'qq') {
      // qq-music-api 音质档位（Folia fallback 表）：flac→320→128 按偏好降档。
      // songmid 是路径参数（/getMusicPlay/:songmid），quality 走 query；
      // 响应形态 data.playUrl[songmid].url（匿名=试听/受限，带会话=完整链接）
      const qualityChain: Record<typeof quality, string[]> = {
        standard: ['128'],
        high: ['320', '128'],
        lossless: ['flac', '320', '128']
      };
      for (const q of qualityChain[quality]) {
        const response = await gatewayRequest.get(
          `/platform/qq/api/getMusicPlay/${encodeURIComponent(songId)}`,
          {
            params: { q },
            headers: cookie ? { 'X-Platform-Cookie': cookie } : undefined,
            timeout: 20000
          }
        );
        const playUrlMap =
          response.data?.data?.playUrl || response.data?.data?.url || response.data?.url;
        const url = typeof playUrlMap === 'string' ? playUrlMap : playUrlMap?.[songId]?.url;
        if (url && typeof url === 'string' && url.startsWith('http')) {
          return url;
        }
      }
      return null;
    }
    // 酷狗：song_url（hash 即 songId）
    const response = await gatewayRequest.get('/platform/kugou/api/song/url', {
      params: { hash: songId },
      headers: cookie ? { 'X-Platform-Cookie': cookie } : undefined,
      timeout: 20000
    });
    const url = response.data?.data?.url;
    if (response.data?.code === 200 && url && typeof url === 'string' && url.startsWith('http')) {
      return url;
    }
    return null;
  } catch {
    return null;
  }
}

// ==================== 统一入口 ====================

/** QQ 新链能力缓存 */
let qqApiChannels: QqLoginChannels | null | undefined;

/** qq 新链能力（含三通道列表）；探测失败缓存 null 走旧链 */
export async function getQqApiChannels(force = false): Promise<QqLoginChannels | null> {
  if (qqApiChannels === undefined || force) {
    qqApiChannels = await probeQqLoginChannels();
  }
  return qqApiChannels;
}

/**
 * 创建平台扫码二维码。
 * 新链优先（qq-music-api / KuGouMusicApi，Folia 移植），探测失败回退旧链：
 */
export async function createPlatformQr(
  platform: LoginPlatform,
  provider: QqApiChannel = 'qq'
): Promise<QrCreateResult> {
  if (platform === 'qq') {
    const channels = await getQqApiChannels();
    if (channels?.configured && channels.channels.includes(provider)) {
      return createQqApiQr(provider);
    }
    if (provider === 'qqmusic') throw new Error('当前网关不支持 QQ 音乐通用码');
  }
  if (platform === 'kugou') {
    const qr = await createKugouApiQr();
    if (qr) return qr;
  }

  return createQrViaServer(platform, provider === 'wechat' ? 'wechat' : 'qq');
}

/** 只在签发二维码的链路上轮询，不重新探测或回退。 */
export async function pollPlatformQr(qr: QrCreateResult): Promise<QrPollResult> {
  const { platform, key, provider, transport } = qr;
  if (
    transport === 'qq-api' &&
    (provider === 'qq' || provider === 'wechat' || provider === 'qqmusic')
  ) {
    return pollQqApiQr(key, provider);
  }
  if (transport === 'kugou-api') return pollKugouApiQr(key);

  return pollQrViaServer(platform, key, provider === 'wechat' ? 'wechat' : 'qq');
}

/**
 * 拉取已登录平台的账号资料和列表数据。
 * Cookie 只通过请求头传递，不进入 URL 或日志。
 */
export async function fetchPlatformAccountData(
  platform: LoginPlatform,
  cookie: string
): Promise<PlatformAccountData> {
  if (!cookie.trim()) {
    throw new Error(`${platform} 登录凭据为空`);
  }

  // QQ 新链会话（qqmusic_session token，网关托管）走 qq-music-api 接口族：
  // 旧链 account/data 读的是明文 qm_keyst/uin Cookie，对新链 token 恒 401
  if (platform === 'qq' && cookie.includes('qqmusic_session=')) {
    return fetchQqApiAccountData(cookie);
  }

  try {
    const response = await gatewayRequest.get(`/platform/${platform}/account/data`, {
      headers: {
        'X-Platform-Cookie': cookie,
        'Cache-Control': 'no-cache'
      },
      timeout: 20000,
      params: { noCache: Date.now() }
    });
    const json = response.data;
    if (json.code !== 200 || !json.data) {
      throw new Error(json.msg || `${platform} 账号数据获取失败`);
    }
    return {
      userInfo: json.data.userInfo,
      playlistError:
        typeof json.data.playlistError === 'string' ? json.data.playlistError : undefined,
      profileError: typeof json.data.profileError === 'string' ? json.data.profileError : undefined,
      playlists: Array.isArray(json.data.playlists) ? json.data.playlists : [],
      favorites: Array.isArray(json.data.favorites) ? json.data.favorites : [],
      albums: Array.isArray(json.data.albums) ? json.data.albums : [],
      history: Array.isArray(json.data.history) ? json.data.history : []
    };
  } catch (error) {
    throw gatewayError(error, `${platform} 账号数据加载`);
  }
}

async function fetchQqApiProfile(cookie: string, timeout: number) {
  const { data } = await gatewayRequest.get('/platform/qq/api/login/status', {
    headers: { 'X-Platform-Cookie': cookie },
    timeout
  });
  const profile = data?.data?.profile;
  if (data?.code !== 200 || !profile || typeof profile !== 'object' || Array.isArray(profile)) {
    throw new Error('QQ 音乐未能确认当前登录状态，请重新扫码');
  }
  const info = profile.info || {};
  const vip = profile.vipType ?? profile.is_vip ?? info.is_vip;
  const userInfo = {
    userId:
      [
        profile.str_musicid,
        profile.musicid,
        profile.uin,
        profile.id,
        info.str_musicid,
        info.musicid,
        info.uin
      ]
        .map((id) => String(id ?? '').trim())
        .find((id) => id && id !== '0') || '',
    nickname:
      profile.nickname ||
      profile.nick ||
      profile.name ||
      profile.userName ||
      info.nickname ||
      info.nick ||
      info.name ||
      info.userName ||
      '',
    avatarUrl:
      info.logo || profile.avatarUrl || info.avatarUrl || info.headpic || profile.headpic || '',
    vip: vip == null ? undefined : Boolean(Number(vip) || vip === 'true')
  };
  if (!userInfo.userId && !userInfo.nickname && !userInfo.avatarUrl) {
    throw new Error('QQ 音乐没有返回账号资料，请稍后重试');
  }
  return userInfo;
}

/** 登录状态以会话返回的 profile 为准；歌单读取失败不影响资料。 */
async function fetchQqApiAccountData(cookie: string): Promise<PlatformAccountData> {
  const headers = { 'X-Platform-Cookie': cookie };
  try {
    // The session, not the displayed music ID, identifies the playlist owner.
    const [profileResult, listResult] = await Promise.allSettled([
      fetchQqApiProfile(cookie, 15000),
      gatewayRequest.get('/platform/qq/api/user/playlist', { headers, timeout: 20000 })
    ]);
    const userInfo = profileResult.status === 'fulfilled' ? profileResult.value : undefined;
    const profileError =
      profileResult.status === 'rejected'
        ? gatewayError(profileResult.reason, 'QQ 音乐账号资料加载').message
        : undefined;
    const playlistRes = listResult.status === 'fulfilled' ? listResult.value : undefined;
    const playlistsRaw = playlistRes?.data?.playlist;
    const playlistOk = playlistRes?.data?.code === 200 && Array.isArray(playlistsRaw);
    const playlists = (playlistOk ? playlistsRaw : [])
      .filter((item: unknown) => item && typeof item === 'object')
      .map((item: Record<string, any>) => ({
        id: String(
          [item.tid, item.dissid, item.id].find((v) => v && String(v) !== '0') ||
            (Number(item.dirId ?? item.dirid) > 0 ? `dir:${item.dirId ?? item.dirid}` : '')
        ),
        name: String(
          item.dirName ||
            item.dirname ||
            item.dissname ||
            item.diss_name ||
            item.title ||
            item.name ||
            ''
        ),
        coverImgUrl: item.bigpicUrl || item.picUrl || item.picurl || item.logo || item.imgurl || '',
        trackCount: Number(
          item.songNum ?? item.song_cnt ?? item.songnum ?? item.total_song_num ?? 0
        ),
        playCount: Number(item.listennum ?? item.accessnum ?? 0),
        dirShow: Number(item.dirShow ?? item.dir_show ?? 1),
        isFavorite:
          item.dirName == null &&
          item.dirname == null &&
          (item.orderTime != null || item.dirType != null)
      }))
      .filter((item: { id: string }) => item.id);
    const playlistError =
      !playlistOk || playlists.length !== playlistsRaw.length
        ? 'QQ 音乐歌单未能完整加载，请稍后重试'
        : undefined;
    if (profileError && playlistError && !playlists.length)
      throw new Error(`${profileError}；${playlistError}`);
    return {
      userInfo,
      playlists,
      profileError,
      playlistError,
      favorites: playlists.filter((p: { isFavorite: boolean }) => p.isFavorite),
      albums: [],
      history: []
    };
  } catch (error) {
    throw gatewayError(error, 'QQ 账号数据加载');
  }
}

export async function fetchPlatformPlaylistTracks(
  platform: LoginPlatform,
  cookie: string,
  id: string
): Promise<PlatformPlaylistTracks> {
  if (!cookie.trim()) {
    throw new Error(`${platform} 登录凭据为空`);
  }
  if (!id.trim()) {
    throw new Error(`${platform} 歌单 ID 为空`);
  }

  // QQ 新链会话走 /user/playlist-detail（带凭据可读自建不公开歌单，
  // Folia 文档语义；旧链匿名 song_list_detail 读不了）
  if (platform === 'qq' && cookie.includes('qqmusic_session=')) {
    return fetchQqApiPlaylistTracks(cookie, id);
  }

  try {
    const loadPage = async (page: number) =>
      gatewayRequest.get(`/platform/${platform}/playlist/tracks`, {
        headers: {
          'X-Platform-Cookie': cookie,
          'Cache-Control': 'no-cache'
        },
        params: { id, page, noCache: Date.now() },
        timeout: 20000
      });
    const json = (await loadPage(1)).data;
    if (json.code !== 200 || !json.data) {
      throw new Error(json.msg || `${platform} 歌单加载失败`);
    }
    const songs = Array.isArray(json.data.songs) ? [...json.data.songs] : [];
    let more = json.data.more === true;
    for (let page = 2; more; page++) {
      const next = (await loadPage(page)).data;
      if (
        next.code !== 200 ||
        !Array.isArray(next.data?.songs) ||
        page > 1000 ||
        (next.data.more &&
          (!next.data.songs.length ||
            next.data.songs[0].id === songs[songs.length - (json.data.pageSize || 100)]?.id))
      ) {
        throw new Error(next.msg || '歌单分页加载失败');
      }
      songs.push(...next.data.songs);
      more = next.data.more === true;
    }
    return {
      playlist: json.data.playlist,
      songs,
      page: json.data.page,
      pageSize: json.data.pageSize
    };
  } catch (error) {
    throw gatewayError(error, `${platform} 歌单加载`);
  }
}

/** qq-music-api returns songs at the top level, at most 100 per request. */
async function fetchQqApiPlaylistTracks(
  cookie: string,
  id: string
): Promise<PlatformPlaylistTracks> {
  try {
    const key = id.startsWith('dir:') ? { dirid: id.slice(4) } : { tid: id };
    const songs: PlatformPlaylistTracks['songs'] = [];
    let previousPage = '';
    for (let offset = 0; ; ) {
      const { data } = await gatewayRequest.get('/platform/qq/api/user/playlist-detail', {
        headers: { 'X-Platform-Cookie': cookie },
        params: { ...key, offset, limit: 100 },
        timeout: 20000
      });
      if (data?.code !== 200 || !Array.isArray(data.songs))
        throw new Error(data?.message || 'QQ 歌单加载失败');
      const pageKey = JSON.stringify(data.songs.map((s: any) => s.mid || s.songmid || s.id));
      if (offset && pageKey === previousPage) throw new Error('QQ 歌单返回了重复的分页');
      previousPage = pageKey;
      for (const item of data.songs) {
        const mid = String(item.mid || item.songmid || item.id || '');
        if (!mid) continue;
        const albumMid = item.album?.mid || item.albummid || '';
        const picUrl = albumMid
          ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${albumMid}.jpg`
          : '';
        const album = { id: albumMid, name: item.album?.name || item.albumname || '', picUrl };
        const artists = (item.singer || []).map((s: any) => ({ id: s.mid || s.id, name: s.name }));
        const duration = Number(item.interval || 0) * 1000;
        songs.push({
          id: `qq:${mid}`,
          name: item.name || item.songname,
          platform: 'qq',
          platformId: mid,
          source: 'qq',
          al: album,
          album,
          ar: artists,
          artists,
          dt: duration,
          duration,
          picUrl
        });
      }
      if (!data.more) break;
      offset += data.songs.length;
      if (!data.songs.length || offset >= 100000) throw new Error('QQ 歌单分页加载失败');
    }
    return { playlist: { id }, songs, page: 1, pageSize: songs.length };
  } catch (error) {
    throw gatewayError(error, 'QQ 歌单加载');
  }
}

export interface QqLyricPayload {
  sourceId?: string;
  platform: 'qq';
  format: 'qrc' | 'lrc';
  lyric: string;
  translation: string;
  romanization: string;
}

export interface QqAlbumDetail {
  album: {
    id: string;
    name: string;
    picUrl: string;
    artist?: { id?: number | string; name?: string };
  };
  songs: SongResult[];
}

export interface QqSingerSongs {
  artist: {
    id: string;
    mid: string;
    name: string;
    picUrl: string;
    fans?: number;
  };
  songs: SongResult[];
  total?: number;
  hasMore?: boolean;
}

/**
 * QQ 专辑详情 + 曲目（未签名通道，无需登录 Cookie）
 */
export async function fetchQqAlbumDetail(id: string): Promise<QqAlbumDetail> {
  if (!id.trim()) throw new Error('QQ 专辑 ID 为空');
  try {
    const response = await gatewayRequest.get('/platform/qq/album', {
      params: { id, noCache: Date.now() },
      timeout: 20000
    });
    const json = response.data;
    if (json.code !== 200 || !json.data) {
      throw new Error(json.msg || 'QQ 专辑加载失败');
    }
    return {
      album: json.data.album,
      songs: Array.isArray(json.data.songs) ? json.data.songs : []
    };
  } catch (error) {
    throw gatewayError(error, 'QQ 专辑加载');
  }
}

/**
 * QQ 歌手热门歌曲（未签名通道，无需登录 Cookie）
 */
export async function fetchQqSingerHotSongs(
  mid: string,
  limit = 50,
  offset = 0
): Promise<QqSingerSongs> {
  if (!mid.trim()) throw new Error('QQ 歌手 ID 为空');
  try {
    const response = await gatewayRequest.get('/platform/qq/singer/songs', {
      params: { mid, limit, offset, noCache: Date.now() },
      timeout: 20000
    });
    const json = response.data;
    if (json.code !== 200 || !json.data) {
      throw new Error(json.msg || 'QQ 歌手歌曲加载失败');
    }
    return {
      artist: json.data.artist,
      songs: Array.isArray(json.data.songs) ? json.data.songs : [],
      total: json.data.total,
      hasMore: Boolean(json.data.hasMore)
    };
  } catch (error) {
    throw gatewayError(error, 'QQ 歌手歌曲加载');
  }
}

export interface KugouLyricPayload {
  sourceId?: string;
  platform: 'kugou';
  format: 'krc';
  lyric: string;
  translation: string;
  romanization: string;
}

function normalizeLyricMatchText(value: unknown): string {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/\.(?:mp3|flac|wav|m4a|aac|ogg|ape)$/i, '')
    .replace(/[\s\-–—_.·•()[\]{}（）【】,，。!！?？:：;'"“”‘’]/g, '');
}

function songArtists(song: SongResult): string[] {
  return (song.ar || song.artists || []).map((artist) => artist.name).filter(Boolean);
}

function lyricMatchScore(source: SongResult, candidate: SongResult): number {
  const sourceTitle = normalizeLyricMatchText(source.name);
  const candidateTitle = normalizeLyricMatchText(candidate.name);
  if (!sourceTitle || sourceTitle !== candidateTitle) return -1;
  let score = 60;

  const sourceArtists = songArtists(source).map(normalizeLyricMatchText);
  const candidateArtists = songArtists(candidate).map(normalizeLyricMatchText);
  if (sourceArtists.length) {
    const matched = sourceArtists.some((artist) =>
      candidateArtists.some(
        (candidateArtist) =>
          candidateArtist === artist ||
          candidateArtist.includes(artist) ||
          artist.includes(candidateArtist)
      )
    );
    if (!matched) return -1;
    score += 25;
  }

  const sourceDuration = Number(source.dt || source.duration || 0);
  const candidateDuration = Number(candidate.dt || candidate.duration || 0);
  if (sourceDuration > 0 && candidateDuration > 0) {
    const difference = Math.abs(sourceDuration - candidateDuration);
    if (difference > 12000) return -1;
    score += difference <= 2500 ? 20 : difference <= 8000 ? 10 : 4;
  }

  const sourceAlbum = normalizeLyricMatchText(source.al?.name || source.album?.name);
  const candidateAlbum = normalizeLyricMatchText(candidate.al?.name || candidate.album?.name);
  if (sourceAlbum && candidateAlbum && sourceAlbum === candidateAlbum) score += 10;
  return score;
}

async function searchGatewayMusic(
  platform: 'qq' | 'kugou',
  song: SongResult
): Promise<SongResult | null> {
  const keyword = [song.name, ...songArtists(song).slice(0, 2)].filter(Boolean).join(' ');
  if (!keyword) return null;
  try {
    const response = await gatewayRequest.get(`/platform/${platform}/search`, {
      params: { keyword, limit: 12, noCache: Date.now() },
      timeout: 12000
    });
    const songs = response.data?.data?.songs;
    if (!Array.isArray(songs)) return null;
    const ranked = (songs as SongResult[])
      .map((candidate) => ({ candidate, score: lyricMatchScore(song, candidate) }))
      .filter((item) => item.score >= 85)
      .sort((left, right) => right.score - left.score);
    return ranked[0]?.candidate || null;
  } catch {
    return null;
  }
}

/**
 * 搜索已登录平台（QQ/酷狗）的音乐，返回可直接播放的 SongResult 列表
 */
export async function searchPlatformMusic(
  platform: 'qq' | 'kugou',
  keyword: string,
  limit = 20
): Promise<SongResult[]> {
  if (!keyword?.trim()) return [];
  const cookie = localStorage.getItem(platformAccountStorageKey('cookie', platform)) || '';
  if (!cookie.trim()) return [];

  try {
    const response = await gatewayRequest.get(`/platform/${platform}/search`, {
      headers: {
        'X-Platform-Cookie': cookie,
        'Cache-Control': 'no-cache'
      },
      params: { keyword, limit, noCache: Date.now() },
      timeout: 20000
    });
    const json = response.data;
    if (json.code !== 200 || !json.data) {
      throw new Error(json.msg || `${platform} 搜索失败`);
    }
    return Array.isArray(json.data.songs) ? (json.data.songs as SongResult[]) : [];
  } catch (error) {
    throw gatewayError(error, `${platform} 搜索`);
  }
}

/** 获取网关已解密的 QQ 逐字歌词。未找到歌词时返回 null。 */
export async function fetchQqLyric(mid: string): Promise<QqLyricPayload | null> {
  const songMid = String(mid || '').trim();
  if (!songMid) return null;
  const cookie = localStorage.getItem(platformAccountStorageKey('cookie', 'qq')) || '';

  try {
    const response = await gatewayRequest.get('/platform/qq/lyric', {
      headers: cookie ? { 'X-Platform-Cookie': cookie } : undefined,
      params: { mid: songMid },
      timeout: 12000
    });
    const data = response.data?.data;
    if (response.data?.code !== 200 || !data?.lyric) return null;
    return {
      platform: 'qq',
      format: data.format === 'qrc' ? 'qrc' : 'lrc',
      sourceId: `qq:${songMid}`,
      lyric: String(data.lyric || ''),
      translation: String(data.translation || ''),
      romanization: String(data.romanization || '')
    };
  } catch (error) {
    if ((error as AxiosError).response?.status === 404) return null;
    throw gatewayError(error, 'QQ 歌词加载');
  }
}

export async function fetchMatchedQqLyric(song: SongResult): Promise<QqLyricPayload | null> {
  const matched = await searchGatewayMusic('qq', song);
  return matched?.platformId ? fetchQqLyric(matched.platformId) : null;
}

/** 通过严格元数据匹配获取酷狗 KRC 逐字歌词。 */
export async function fetchKugouLyric(song: SongResult): Promise<KugouLyricPayload | null> {
  const matched =
    song.platform === 'kugou' && song.platformId ? song : await searchGatewayMusic('kugou', song);
  const hash = String(matched?.platformId || '').trim();
  if (!hash) return null;

  try {
    const response = await gatewayRequest.get('/platform/kugou/lyric', {
      params: {
        hash,
        keyword: [song.name, ...songArtists(song).slice(0, 2)].filter(Boolean).join(' '),
        duration: Number(song.dt || song.duration || 0)
      },
      timeout: 15000
    });
    const data = response.data?.data;
    if (response.data?.code !== 200 || !data?.lyric) return null;
    return {
      platform: 'kugou',
      format: 'krc',
      sourceId: `kugou:${hash}:${String(data.id || '')}`,
      lyric: String(data.lyric || ''),
      translation: String(data.translation || ''),
      romanization: String(data.romanization || '')
    };
  } catch (error) {
    if ((error as AxiosError).response?.status === 404) return null;
    return null;
  }
}
