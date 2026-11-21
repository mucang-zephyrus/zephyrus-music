/**
 * 哔哩哔哩网关路由（Web / Android 端播放与字幕的中转层）
 *
 * 为什么要中转：
 * - B 站 CDN 与接口硬校验 Referer（非 https://www.bilibili.com 直接 403，且拒绝空 Referer），
 *   浏览器里的 <audio>/<video>/fetch 无法自定义 Referer；
 *
 * 安全约束（重要）：
 * - /stream 只转发「白名单域名内的 B 站直链」，绝不接受任意 URL（防 SSRF）；
 * - 仅允许 GET/HEAD；每 IP 限流；透传 Range 以支持拖动进度。
 *
 * 复用主进程同款实现：wbi 签名逻辑与取值策略保持一致（fnval=4048，
 * flac > dolby > 带宽最高的普通音频轨，老视频回退 durl）。
 */
const express = require('express');
const axios = require('axios');
const crypto = require('crypto');

const BILIBILI_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const BILIBILI_REFERER = 'https://www.bilibili.com/';
const API_BASE = 'https://api.bilibili.com';

/** 允许转发的 CDN 域名后缀（B 站音视频与字幕） */
const STREAM_HOST_SUFFIXES = [
  '.bilivideo.com',
  '.bilivideo.cn',
  '.mcdn.bilivideo.cn',
  '.akamaized.net',
  '.hdslb.com'
];

const MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29,
  28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25,
  54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52
];

/** BV 号 → AV 号（B 站公开算法） */
function bv2av(bvid) {
  const XOR_CODE = 23442827791579n;
  const MASK_CODE = 2251799813685247n;
  const BASE = 58n;
  const ALPHABET = 'FcwAPNKTMug3GV5Lj7EJnHpWsx4tb8haYeviqBz6rkCy12mUSDQX9RdoZf';
  const chars = Array.from(String(bvid));
  [chars[3], chars[9]] = [chars[9], chars[3]];
  [chars[4], chars[7]] = [chars[7], chars[4]];
  const body = chars.slice(3);
  const value = body.reduce((total, ch) => total * BASE + BigInt(ALPHABET.indexOf(ch)), 0n);
  return Number((value & MASK_CODE) ^ XOR_CODE);
}

let wbiKeysCache = { imgKey: '', subKey: '', day: '' };

function createRateLimit({ windowMs, max }) {
  const buckets = new Map();
  return function rateLimit(req, res, next) {
    const key = req.ip || req.connection?.remoteAddress || 'unknown';
    const now = Date.now();
    const entry = buckets.get(key);
    if (!entry || now - entry.start > windowMs) {
      buckets.set(key, { start: now, count: 1 });
      return next();
    }
    entry.count += 1;
    if (entry.count > max) {
      return res.status(429).json({ code: 429, msg: '请求过于频繁，请稍后再试' });
    }
    return next();
  };
}

/**
 * CORS：与 platformLogin.js 的 platformCors 同一语义 ——
 * 仅 ALLOWED_ORIGINS 白名单内的 Origin 反射 CORS 头；预检 204/403；无 Origin 放行。
 * 防御式写法：响应头已存在时不重复设置（避免与外层中间件叠加产生重复头）。
 */
const ALLOWED_ORIGINS = String(process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);

/** 与 platformLogin.js 同名函数一致：从请求头取用户平台 Cookie */
function getPlatformCookieFromRequest(req) {
  const value = req.headers['x-platform-cookie'];
  return Array.isArray(value) ? value[0] || '' : String(value || '').trim();
}

function bilibiliCors(req, res, next) {
  const origin = req.headers.origin;
  const allowed = Boolean(origin) && ALLOWED_ORIGINS.includes(origin);
  if (allowed && !res.getHeader('Access-Control-Allow-Origin')) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    if (!res.getHeader('Access-Control-Allow-Headers')) {
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Cache-Control, Range');
    }
    if (!res.getHeader('Access-Control-Allow-Methods')) {
      res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    }
    res.setHeader('Vary', 'Origin');
  }
  if (req.method === 'OPTIONS') {
    if (origin && !allowed) return res.sendStatus(403);
    return res.sendStatus(204);
  }
  return next();
}

function bilibiliHeaders(extra = {}) {
  const cookie = extra.cookie || process.env.BILIBILI_COOKIE || '';
  const headers = {
    'User-Agent': BILIBILI_UA,
    Referer: BILIBILI_REFERER,
    Origin: 'https://www.bilibili.com',
    Accept: 'application/json, text/plain, */*',
    ...extra.headers
  };
  if (cookie) headers.Cookie = cookie;
  return headers;
}

function normalizeUrl(url) {
  if (!url) return '';
  if (url.startsWith('//')) return `https:${url}`;
  if (url.startsWith('http://')) return url.replace('http://', 'https://');
  return url;
}

function isAllowedStreamHost(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return STREAM_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
  } catch {
    return false;
  }
}

const md5 = (value) => crypto.createHash('md5').update(value).digest('hex');
const today = () => new Date().toISOString().slice(0, 10);

async function getWbiKeys() {
  if (wbiKeysCache.imgKey && wbiKeysCache.day === today()) return wbiKeysCache;

  const { data } = await axios.get(`${API_BASE}/x/web-interface/nav`, {
    headers: bilibiliHeaders(),
    timeout: 12000
  });
  const imgUrl = data?.data?.wbi_img?.img_url || '';
  const subUrl = data?.data?.wbi_img?.sub_url || '';
  const imgKey = imgUrl.slice(imgUrl.lastIndexOf('/') + 1, imgUrl.lastIndexOf('.'));
  const subKey = subUrl.slice(subUrl.lastIndexOf('/') + 1, subUrl.lastIndexOf('.'));
  if (!imgKey || !subKey) throw new Error('未能解析 wbi keys');
  wbiKeysCache = { imgKey, subKey, day: today() };
  return wbiKeysCache;
}

async function withWbi(params) {
  const { imgKey, subKey } = await getWbiKeys();
  const mixinKey = MIXIN_KEY_ENC_TAB.map((index) => (imgKey + subKey)[index])
    .join('')
    .slice(0, 32);
  const signed = { ...params, wts: Math.round(Date.now() / 1000) };
  const query = Object.keys(signed)
    .sort()
    .map((key) => {
      const value = String(signed[key]).replace(/[!'()*]/g, '');
      return `${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
    })
    .join('&');
  return `${query}&w_rid=${md5(query + mixinKey)}`;
}

/** 匿名设备指纹（buvid3/buvid4）：/x/web-interface/view 等接口无指纹会返回 412 */
let buvidCache = null;
async function ensureBuvid() {
  if (buvidCache) return buvidCache;
  try {
    const { data } = await axios.get(`${API_BASE}/x/frontend/finger/spi`, {
      headers: { 'User-Agent': BILIBILI_UA, Referer: BILIBILI_REFERER },
      timeout: 10000
    });
    buvidCache = {
      b3: String(data?.data?.b_3 || ''),
      b4: String(data?.data?.b_4 || '')
    };
  } catch (error) {
    console.warn('[bilibili-gateway] 获取设备指纹失败:', error.message);
    buvidCache = { b3: '', b4: '' };
  }
  return buvidCache;
}

/** 组合最终请求头：登录 Cookie（若有）+ 设备指纹 */
async function bilibiliHeadersWithFingerprint(extra = {}) {
  const headers = bilibiliHeaders(extra);
  const { b3, b4 } = await ensureBuvid();
  const fingerprint = [b3 ? `buvid3=${b3}` : '', b4 ? `buvid4=${b4}` : ''].filter(Boolean).join('; ');
  if (fingerprint) {
    headers.Cookie = headers.Cookie ? `${headers.Cookie}; ${fingerprint}` : fingerprint;
  }
  return headers;
}

async function bilibiliApi(endpoint, query, options = {}) {
  const url = `${API_BASE}${endpoint}${query ? `?${query}` : ''}`;
  const headers = await bilibiliHeadersWithFingerprint(options);
  const { data } = await axios.get(url, {
    headers,
    timeout: 15000
  });
  if (data.code !== 0 && endpoint !== '/x/web-interface/nav') {
    throw new Error(`B 站接口返回异常: code=${data.code} ${data.message || ''}`.trim());
  }
  return data.data;
}

const stripHtml = (value) => String(value || '').replace(/<[^>]+>/g, '');

function parseDurationToMs(value) {
  if (typeof value === 'number') return Math.round(value * 1000);
  const text = String(value || '').trim();
  if (!text) return 0;
  const parts = text.split(':').map((item) => Number(item));
  if (parts.some((item) => Number.isNaN(item))) return 0;
  return parts.reduce((total, item) => total * 60 + item, 0) * 1000;
}

function resolveExpireAt(url) {
  try {
    const deadline = new URL(url).searchParams.get('deadline');
    if (deadline) {
      const seconds = Number(deadline);
      if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000 - 60000;
    }
  } catch {
    /* ignore */
  }
  return Date.now() + 30 * 60 * 1000;
}

function createBilibiliRouter() {
  const router = express.Router();
  const apiLimit = createRateLimit({ windowMs: 60 * 1000, max: 120 });
  const streamLimit = createRateLimit({ windowMs: 60 * 1000, max: 240 });

  router.use(bilibiliCors);

  router.get('/health', (_req, res) => {
    res.json({ code: 0, msg: 'bilibili gateway ok' });
  });

  // 搜索视频
  router.get('/search', apiLimit, async (req, res) => {
    try {
      const keyword = String(req.query.keyword || '').trim();
      const limit = Math.min(Number(req.query.limit) || 20, 40);
      if (!keyword) return res.json({ code: 0, data: [] });

      const query = await withWbi({ keyword, search_type: 'video', page: '1' });
      const data = await bilibiliApi('/x/web-interface/wbi/search/type', query, {
        cookie: ''
      });
      const items = (data?.result || [])
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
      res.json({ code: 0, data: items });
    } catch (error) {
      res.status(500).json({ code: 500, msg: error.message || '搜索失败' });
    }
  });

  // 视频信息（cid / 分P）
  router.get('/video-info', apiLimit, async (req, res) => {
    try {
      const bvid = String(req.query.bvid || '').trim();
      if (!bvid) return res.status(400).json({ code: 400, msg: '缺少 bvid' });

      // 用 pagelist 而非 /x/web-interface/view：后者对数据中心 IP 返回 412（风控），
      // pagelist 免 Cookie 免指纹且返回全部分P的 cid/标题/时长。
      // 标题/封面/UP主由调用方从搜索结果带入，这里只负责 cid 与分P。
      const data = await bilibiliApi('/x/player/pagelist', `bvid=${encodeURIComponent(bvid)}`, {
        cookie: ''
      });
      const pages = (data || []).map((page) => ({
        cid: Number(page.cid),
        page: Number(page.page || 0),
        part: String(page.part || ''),
        durationMs: parseDurationToMs(page.duration)
      }));
      if (!pages.length) return res.status(502).json({ code: 502, msg: '该视频没有可用分P' });

      res.json({
        code: 0,
        data: {
          bvid,
          aid: 0,
          cid: pages[0].cid,
          title: pages[0].part || '',
          picUrl: '',
          durationMs: pages.reduce((total, page) => total + page.durationMs, 0),
          author: '',
          authorId: 0,
          pages
        }
      });
    } catch (error) {
      res.status(500).json({ code: 500, msg: error.message || '获取视频信息失败' });
    }
  });

  // 取流（只回传白名单域内的直链）
  // kind=audio：
  //   - format=mp4（默认）：fnval=1 取 durl 的渐进式 mp4（含音轨），<audio>/Howl 在
  //     iOS/Android/桌面都能直接播。dash 的 fMP4 分片（.m4s）在 <audio> 里不可靠。
  //     qn 固定 16（360P）压缩体积——音频方式只取其音轨，画质无意义。
  //   - format=dash：fnval=4048 取纯音频轨（音质更高），仅供确认支持 fMP4 的端使用。
  router.get('/playurl', apiLimit, async (req, res) => {
    try {
      const bvid = String(req.query.bvid || '').trim();
      const cid = String(req.query.cid || '').trim();
      const kind = req.query.kind === 'video' ? 'video' : 'audio';
      const format = req.query.format === 'dash' ? 'dash' : 'mp4';
      if (!bvid || !cid) return res.status(400).json({ code: 400, msg: '缺少 bvid 或 cid' });

      const fnval = kind === 'video' || format === 'dash' ? '4048' : '1';
      const query = await withWbi({
        bvid,
        cid,
        fnval,
        fnver: '0',
        fourk: '1',
        // fnval=1 的 durl 档位：qn=16（360P）最小体积，音轨仍为 AAC
        ...(fnval === '1' ? { qn: '16' } : {}),
        voice_balance: '1'
      });
      const data = await bilibiliApi('/x/player/wbi/playurl', query);
      const dash = data?.dash;

      // fnval=1（mp4 模式）：B 站直接返回 durl 渐进式 mp4，所有端可播
      if (fnval === '1') {
        const durl = data?.durl?.[0];
        if (!durl?.url) return res.status(502).json({ code: 502, msg: '该视频没有可用音视频流' });
        if (!isAllowedStreamHost(durl.url)) {
          return res.status(502).json({ code: 502, msg: '播放地址不在允许的域名内' });
        }
        return res.json({
          code: 0,
          data: {
            url: durl.url,
            kind: 'mp4',
            quality: Number(data?.quality || 0),
            expireAt: resolveExpireAt(durl.url)
          }
        });
      }

      let picked = null;
      let videoTracks;
      if (dash) {
        if (dash?.flac?.audio?.baseUrl) {
          picked = { url: dash.flac.audio.baseUrl, quality: Number(dash.flac.audio.id || 0) };
        }
        if (!picked && dash?.dolby?.audio?.[0]?.baseUrl) {
          picked = {
            url: dash.dolby.audio[0].baseUrl,
            quality: Number(dash.dolby.audio[0].id || 0)
          };
        }
        if (!picked && Array.isArray(dash?.audio) && dash.audio.length) {
          const best = [...dash.audio].sort(
            (a, b) => Number(b.bandwidth || 0) - Number(a.bandwidth || 0)
          )[0];
          picked = { url: best.baseUrl, quality: Number(best.id || 0) };
        }
        if (kind === 'video' && Array.isArray(dash?.video)) {
          videoTracks = dash.video.map((track) => ({
            id: Number(track.id || 0),
            url: String(track.baseUrl || ''),
            width: Number(track.width || 0),
            height: Number(track.height || 0),
            bandwidth: Number(track.bandwidth || 0)
          }));
        }
      }

      if (!picked?.url) {
        const durl = data?.durl?.[0];
        if (!durl?.url) return res.status(502).json({ code: 502, msg: '该视频没有可用音视频流' });
        if (!isAllowedStreamHost(durl.url)) {
          return res.status(502).json({ code: 502, msg: '播放地址不在允许的域名内' });
        }
        return res.json({
          code: 0,
          data: {
            url: durl.url,
            kind: 'mp4',
            quality: 0,
            expireAt: resolveExpireAt(durl.url)
          }
        });
      }

      if (!isAllowedStreamHost(picked.url)) {
        return res.status(502).json({ code: 502, msg: '播放地址不在允许的域名内' });
      }

      res.json({
        code: 0,
        data: {
          url: picked.url,
          kind: 'dash',
          quality: picked.quality,
          expireAt: resolveExpireAt(picked.url),
          ...(videoTracks ? { videoTracks } : {})
        }
      });
    } catch (error) {
      res.status(500).json({ code: 500, msg: error.message || '解析播放地址失败' });
    }
  });

  // 字幕（需要服务端持有 B 站 Cookie）
  router.get('/subtitle', apiLimit, async (req, res) => {
    try {
      const bvid = String(req.query.bvid || '').trim();
      const cid = String(req.query.cid || '').trim();
      if (!bvid || !cid) return res.status(400).json({ code: 400, msg: '缺少 bvid 或 cid' });

      const query = await withWbi({ bvid, cid });
      const data = await bilibiliApi('/x/player/wbi/v2', query);
      const tracks = (data?.subtitle?.subtitles || [])
        .filter((item) => item?.subtitle_url)
        .map((item) => ({
          id: String(item.id || item.id_str || item.lan),
          lan: String(item.lan || ''),
          lanDoc: String(item.lan_doc || item.lan || ''),
          url: normalizeUrl(String(item.subtitle_url))
        }));

      if (!tracks.length) return res.json({ code: 0, data: { tracks: [], picked: null, lines: [] } });

      const priority = ['zh-CN', 'zh-Hans', 'zh-Hant', 'ai-zh'];
      const requestedLan = String(req.query.lan || '').trim();
      const requested = requestedLan ? tracks.find((track) => track.lan === requestedLan) : null;
      const ordered = [];
      const pushUnique = (track) => {
        if (track && !ordered.includes(track)) ordered.push(track);
      };
      pushUnique(requested);
      priority.forEach((lan) => pushUnique(tracks.find((track) => track.lan === lan)));
      tracks.forEach(pushUnique);

      for (const track of ordered) {
        try {
          if (!isAllowedStreamHost(track.url)) continue;
          const { data: payload } = await axios.get(track.url, {
            headers: bilibiliHeaders({ cookie: '' }),
            timeout: 15000
          });
          const lines = (payload?.body || [])
            .map((item) => ({
              from: Number(item.from || 0),
              to: Number(item.to || 0),
              content: String(item.content || '').trim()
            }))
            .filter((line) => line.content && line.to > line.from);
          if (lines.length) {
            return res.json({ code: 0, data: { tracks, picked: track, lines } });
          }
        } catch {
          /* 换下一轨 */
        }
      }
      res.json({ code: 0, data: { tracks, picked: null, lines: [] } });
    } catch (error) {
      res.status(500).json({ code: 500, msg: error.message || '获取字幕失败' });
    }
  });

  // 链接 / b23.tv 短链 → bvid
  router.get('/resolve', apiLimit, async (req, res) => {
    try {
      const input = String(req.query.input || '').trim();
      const direct = /BV[0-9A-Za-z]{10}/.exec(input);
      if (direct) return res.json({ code: 0, data: direct[0] });

      const shortUrl = /https?:\/\/[^\s]*b23\.tv[^\s]*/i.exec(input)?.[0];
      if (!shortUrl) return res.json({ code: 0, data: null });

      const { data: html } = await axios.get(shortUrl, {
        headers: bilibiliHeaders({ cookie: '' }),
        timeout: 15000,
        responseType: 'text',
        maxRedirects: 5
      });
      const canonical = /<link[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["']/i.exec(html || '');
      const bvid = canonical ? /BV[0-9A-Za-z]{10}/.exec(canonical[1]) : null;
      res.json({ code: 0, data: bvid ? bvid[0] : null });
    } catch (error) {
      res.status(500).json({ code: 500, msg: error.message || '解析链接失败' });
    }
  });

  // 扫码登录：申请二维码
  router.get('/qr/create', apiLimit, async (req, res) => {
    try {
      const { data } = await axios.get(
        'https://passport.bilibili.com/x/passport-login/web/qrcode/generate',
        { headers: bilibiliHeaders({ cookie: '' }), timeout: 15000 }
      );
      if (data.code !== 0) return res.status(502).json({ code: 502, msg: data.message || '二维码生成失败' });
      res.json({
        code: 0,
        data: {
          platform: 'bilibili',
          provider: 'bilibili',
          url: data.data.url,
          qrcodeKey: data.data.qrcode_key,
          expiredAt: Date.now() + 180000
        }
      });
    } catch (error) {
      res.status(500).json({ code: 500, msg: error.message || '二维码生成失败' });
    }
  });

  // 扫码登录：轮询状态（成功时从 Set-Cookie 组装 cookie 并取账号信息）
  router.get('/qr/poll', apiLimit, async (req, res) => {
    try {
      const qrcodeKey = String(req.query.qrcodeKey || req.query.key || '').trim();
      if (!qrcodeKey) return res.status(400).json({ code: 400, msg: '缺少 qrcodeKey' });

      const response = await axios.get(
        `https://passport.bilibili.com/x/passport-login/web/qrcode/poll?qrcode_key=${encodeURIComponent(qrcodeKey)}`,
        { headers: bilibiliHeaders({ cookie: '' }), timeout: 15000 }
      );
      const payload = response.data;
      if (payload.code !== 0) return res.status(502).json({ code: 502, msg: payload.message || '轮询失败' });

      const rawCode = Number(payload.data.code || 0);
      const statusMap = { 86101: 'waiting', 86090: 'scanned', 0: 'success', 86038: 'expired' };
      const status = statusMap[rawCode] || 'error';

      let cookie = '';
      let userInfo = null;
      if (status === 'success') {
        const setCookies = response.headers['set-cookie'] || [];
        const jar = new Map();
        for (const entry of setCookies) {
          const pair = String(entry).split(';')[0];
          const eq = pair.indexOf('=');
          if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
        }
        cookie = [...jar.entries()].map(([key, value]) => `${key}=${value}`).join('; ');

        if (cookie.includes('SESSDATA')) {
          try {
            const { data: nav } = await axios.get(`${API_BASE}/x/web-interface/nav`, {
              headers: bilibiliHeaders({ cookie }),
              timeout: 12000
            });
            if (nav?.data?.isLogin) {
              userInfo = {
                nickname: String(nav.data.uname || ''),
                avatarUrl: String(nav.data.face || ''),
                userId: String(nav.data.mid || '')
              };
            }
          } catch {
            /* 账号信息获取失败不影响登录 */
          }
        } else {
          return res.status(502).json({ code: 502, msg: '登录成功但未能取得 SESSDATA' });
        }
      }

      res.json({ code: 0, data: { status, cookie, userInfo } });
    } catch (error) {
      res.status(500).json({ code: 500, msg: error.message || '轮询失败' });
    }
  });

  // 收藏夹列表（含目标视频的收藏状态；需用户 Cookie）
  router.get('/fav/folders', apiLimit, async (req, res) => {
    try {
      const bvid = String(req.query.bvid || '').trim();
      if (!bvid) return res.status(400).json({ code: 400, msg: '缺少 bvid' });
      const cookie = getPlatformCookieFromRequest(req);
      if (!cookie.includes('SESSDATA')) {
        return res.status(401).json({ code: 401, msg: '哔哩哔哩未登录' });
      }

      const navData = await bilibiliApi('/x/web-interface/nav', '', { cookie });
      const mid = Number(navData?.mid || 0);
      if (!mid) return res.status(401).json({ code: 401, msg: '哔哩哔哩登录已失效' });

      const avid = bv2av(bvid);
      const data = await bilibiliApi(
        '/x/v3/fav/folder/created/list-all',
        `up_mid=${mid}&rid=${avid}&type=2`,
        { cookie }
      );
      const folders = (data?.list || []).map((folder) => ({
        id: Number(folder.id),
        title: String(folder.title || ''),
        favState: Number(folder.fav_state || 0),
        mediaCount: Number(folder.media_count || 0)
      }));
      res.json({ code: 0, data: folders });
    } catch (error) {
      res.status(500).json({ code: 500, msg: error.message || '获取收藏夹失败' });
    }
  });

  // 收藏/取消收藏（同步到 B 站收藏夹；需用户 Cookie）
  router.post('/fav/deal', apiLimit, express.json(), async (req, res) => {
    try {
      const bvid = String(req.body?.bvid || '').trim();
      const addIds = (Array.isArray(req.body?.addIds) ? req.body.addIds : []).map(Number).filter(Number.isFinite);
      const delIds = (Array.isArray(req.body?.delIds) ? req.body.delIds : []).map(Number).filter(Number.isFinite);
      if (!bvid || (!addIds.length && !delIds.length)) {
        return res.status(400).json({ code: 400, msg: '缺少 bvid 或收藏夹 ID' });
      }
      const cookie = getPlatformCookieFromRequest(req);
      if (!cookie.includes('SESSDATA') || !cookie.includes('bili_jct')) {
        return res.status(401).json({ code: 401, msg: '哔哩哔哩未登录' });
      }
      const csrfMatch = /bili_jct=([^;]+)/.exec(cookie);
      const csrf = csrfMatch ? csrfMatch[1] : '';

      const avid = bv2av(bvid);
      const body = new URLSearchParams({
        rid: String(avid),
        add_media_ids: addIds.join(','),
        del_media_ids: delIds.join(','),
        type: '2',
        csrf
      });
      const { data } = await axios.post(`${API_BASE}/x/v3/fav/resource/deal`, body.toString(), {
        headers: bilibiliHeaders({ cookie, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }),
        timeout: 15000
      });
      if (data.code !== 0) return res.status(502).json({ code: 502, msg: data.message || '收藏操作失败' });
      res.json({ code: 0, data: true });
    } catch (error) {
      res.status(500).json({ code: 500, msg: error.message || '收藏操作失败' });
    }
  });

  // 账号数据（供歌单列表 TAB 使用）：收藏夹映射为歌单卡片格式
  router.get('/account/data', apiLimit, async (req, res) => {
    try {
      const cookie = getPlatformCookieFromRequest(req);
      if (!cookie.includes('SESSDATA')) {
        return res.status(401).json({ code: 401, msg: '哔哩哔哩未登录' });
      }

      const navData = await bilibiliApi('/x/web-interface/nav', '', { cookie });
      const mid = Number(navData?.mid || 0);
      if (!mid) return res.status(401).json({ code: 401, msg: '哔哩哔哩登录已失效' });

      const userInfo = {
        userId: String(mid),
        nickname: String(navData?.uname || ''),
        avatarUrl: normalizeUrl(String(navData?.face || '')),
        vip: Number(navData?.vipStatus || 0) > 0
      };

      // 收藏夹 → 歌单卡片格式
      const favData = await bilibiliApi(
        '/x/v3/fav/folder/created/list-all',
        `up_mid=${mid}&type=2`,
        { cookie }
      );
      const playlists = (favData?.data?.list || []).map((folder) => ({
        id: Number(folder.id),
        name: String(folder.title || ''),
        coverImgUrl: normalizeUrl(String(folder.cover || '')),
        trackCount: Number(folder.media_count || 0),
        userId: mid,
        // B 站收藏夹专有字段
        biliFavFolder: true
      }));

      res.json({
        code: 200,
        data: { userInfo, playlists, favorites: [], albums: [], history: [] }
      });
    } catch (error) {
      res.status(500).json({ code: 500, msg: error.message || '获取账号数据失败' });
    }
  });

  // 收藏夹内视频列表（映射为可播放的 SongResult 格式）
  router.get('/playlist/tracks', apiLimit, async (req, res) => {
    try {
      const cookie = getPlatformCookieFromRequest(req);
      if (!cookie.includes('SESSDATA')) {
        return res.status(401).json({ code: 401, msg: '哔哩哔哩未登录' });
      }
      const mediaId = String(req.query.id || '').trim();
      const page = Math.max(1, Number(req.query.page) || 1);
      if (!mediaId) return res.status(400).json({ code: 400, msg: '缺少收藏夹 ID' });

      const data = await bilibiliApi(
        '/x/v3/fav/resource/list',
        `media_id=${mediaId}&pn=${page}&ps=20&type=2&order=mtime`,
        { cookie }
      );
      const medias = (data?.medias || []).filter((m) => m?.bvid);
      const songs = medias.map((media) => ({
        bvid: String(media.bvid),
        aid: Number(media.aid || 0),
        cid: Number(media.cid || 0),
        title: stripHtml(String(media.title || '')),
        picUrl: normalizeUrl(String(media.cover || '')),
        durationMs: Number(media.duration || 0) * 1000,
        author: String(media.upper?.name || ''),
        authorId: Number(media.upper?.mid || 0),
        playCount: 0,
        url: `https://www.bilibili.com/video/${media.bvid}`
      }));

      const folderInfo = data?.info || {};
      res.json({
        code: 200,
        data: {
          playlist: {
            id: Number(folderInfo.id || mediaId),
            name: String(folderInfo.title || ''),
            coverImgUrl: normalizeUrl(String(folderInfo.cover || '')),
            trackCount: Number(folderInfo.media_count || songs.length)
          },
          songs,
          page,
          pageSize: 20
        }
      });
    } catch (error) {
      res.status(500).json({ code: 500, msg: error.message || '获取收藏夹内容失败' });
    }
  });

  // 评论区（旧接口，匿名可用）
  router.get('/comments', apiLimit, async (req, res) => {
    try {
      const oid = String(req.query.oid || '').trim();
      const pn = Math.max(1, Number(req.query.pn) || 1);
      if (!oid) return res.status(400).json({ code: 400, msg: '缺少 oid' });

      const { data } = await axios.get(
        `${API_BASE}/x/v2/reply?pn=${pn}&type=1&oid=${oid}&sort=1`,
        { headers: bilibiliHeaders({ cookie: '' }), timeout: 15000 }
      );
      if (data.code !== 0) return res.status(502).json({ code: 502, msg: data.message || '评论获取失败' });

      const replies = (data.data?.replies || []).map((reply) => ({
        rpid: Number(reply.rpid),
        oid: Number(reply.oid),
        mid: Number(reply.mid),
        nickname: String(reply.member?.uname || ''),
        avatarUrl: normalizeUrl(String(reply.member?.avatar || '')),
        content: String(reply.content?.message || ''),
        ctime: Number(reply.ctime || 0) * 1000,
        likedCount: Number(reply.like || 0),
        replies: (reply.replies || []).map((sub) => ({
          rpid: Number(sub.rpid),
          nickname: String(sub.member?.uname || ''),
          avatarUrl: normalizeUrl(String(sub.member?.avatar || '')),
          content: String(sub.content?.message || ''),
          ctime: Number(sub.ctime || 0) * 1000
        }))
      }));
      const total = Number(data.data?.page?.count || 0);

      res.json({
        code: 200,
        data: { total, replies, page: pn, pageSize: 20 }
      });
    } catch (error) {
      res.status(500).json({ code: 500, msg: error.message || '评论获取失败' });
    }
  });

  // 流式中转（核心）：只允许白名单域内的 B 站直链
  router.all('/stream', streamLimit, async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return res.status(405).json({ code: 405, msg: 'Method Not Allowed' });
    }
    const target = String(req.query.url || '');
    if (!target || !isAllowedStreamHost(target)) {
      return res.status(400).json({ code: 400, msg: '仅支持转发哔哩哔哩的音视频地址' });
    }

    try {
      const upstream = await axios.get(target, {
        headers: {
          ...bilibiliHeaders({ cookie: '' }),
          ...(req.headers.range ? { Range: req.headers.range } : {})
        },
        responseType: 'stream',
        timeout: 30000,
        maxRedirects: 3,
        validateStatus: (status) => status >= 200 && status < 400
      });

      res.status(upstream.status);
      const passthrough = [
        'content-type',
        'content-length',
        'content-range',
        'accept-ranges',
        'etag',
        'last-modified'
      ];
      passthrough.forEach((header) => {
        const value = upstream.headers[header];
        if (value) res.setHeader(header, value);
      });
      if (!res.getHeader('Access-Control-Allow-Origin')) {
        res.setHeader('Access-Control-Allow-Origin', '*');
      }
      res.setHeader('Access-Control-Expose-Headers', 'Content-Length,Content-Range,Accept-Ranges');
      res.setHeader('Cache-Control', 'no-store');

      if (req.method === 'HEAD') {
        upstream.data.destroy();
        return res.end();
      }
      upstream.data.on('error', () => res.end());
      upstream.data.pipe(res);
    } catch (error) {
      const status = error.response?.status || 502;
      res.status(status).json({ code: status, msg: error.message || '转发失败' });
    }
  });

  return router;
}

module.exports = { createBilibiliRouter, isAllowedStreamHost };
