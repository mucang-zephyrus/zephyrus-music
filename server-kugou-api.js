/**
 * server-kugou-api.js — KuGouMusicApi(MakcRe v1.6.0) 网关包装（Folia 移植）。
 *
 * KuGouMusicApi 的 main.js 是可直接 require 的编程式入口（不起 HTTP 服务），
 * 网关进程内直调，按薄路由映射到 /platform/kugou/api/*：
 *   GET /login/qr/key      → login_qr_key（返回 qrcode + 内嵌二维码图）
 *   GET /login/qr/create   → login_qr_create（拼 H5 登录页链接便于本地图库重绘）
 *   GET /login/qr/check    → login_qr_check（status 0/1/2/4，4=成功且 cookie 带 token/userid）
 *   GET /login/token/refresh → login_token（登录态续期，需 cookie: { token, userid }）
 *   GET /song/url          → song_url / song_url_new（播放链接，带登录态）
 *
 * 客户端凭据由 X-Platform-Cookie 头传入（与现有 /platform/kugou/* 路由同约定）。
 */
const express = require('express');
const { randomBytes } = require('node:crypto');

let kugouApi = null;

function getKugouApi() {
  if (!kugouApi) {
    kugouApi = require('kugoumusicapi/main.js');
  }
  return kugouApi;
}

/** X-Platform-Cookie 头（"k=v; k2=v2"）→ KuGouMusicApi 的 cookie 对象（{k:'v'}） */
function parseCookieHeader(header) {
  const out = Object.create(null);
  if (!header) return out;
  for (const part of String(header).split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) out[key] = value;
  }
  return out;
}

const deviceGuid = process.env.KUGOU_API_GUID || randomBytes(16).toString('hex');
const deviceDev = process.env.KUGOU_API_DEV || randomBytes(5).toString('hex').toUpperCase();

function makeDeviceCookie(guid, dev) {
  return {
    KUGOU_API_GUID: guid,
    KUGOU_API_MID: require('kugoumusicapi/util').calculateMid(guid),
    KUGOU_API_DEV: dev,
    KUGOU_API_MAC: process.env.KUGOU_API_MAC || '02:00:00:00:00:00'
  };
}

function getDeviceCookie() {
  return makeDeviceCookie(deviceGuid, deviceDev);
}

async function registerQrDevice(api) {
  const cookie = makeDeviceCookie(
    randomBytes(16).toString('hex'),
    randomBytes(5).toString('hex').toUpperCase()
  );
  const result = shapeResult(await api.register_dev({ cookie }));
  const dfid = result.body?.data?.dfid || parseCookieHeader(result.cookie.join('; ')).dfid;
  if (
    result.status !== 200 ||
    Number(result.body?.status) !== 1 ||
    !isCookieValue(dfid) ||
    dfid === '-'
  ) {
    throw new Error('Kugou device registration failed');
  }
  return { ...cookie, dfid: String(dfid) };
}

function accountDevice(cookie) {
  const device = { ...getDeviceCookie(), ...cookie };
  if (!cookie.KUGOU_API_MID && cookie.mid) device.KUGOU_API_MID = cookie.mid;
  return device;
}

async function readKugouPlaylistIndex(cookie) {
  try {
    return shapeResult(
      await getKugouApi().user_playlist({
        cookie: accountDevice(cookie),
        userid: cookie.userid,
        token: cookie.token,
        page: 1,
        pagesize: 100
      })
    );
  } catch (error) {
    return shapeResult(error);
  }
}

async function readKugouTracks(cookie, listid, page, pagesize, globalId) {
  try {
    if (globalId)
      return shapeResult(
        await getKugouApi().playlist_track_all({
          cookie: accountDevice(cookie),
          id: globalId,
          page,
          pagesize
        })
      );
    return shapeResult(
      await getKugouApi().playlist_track_all_new({
        cookie: accountDevice(cookie),
        userid: cookie.userid,
        token: cookie.token,
        listid,
        page,
        pagesize
      })
    );
  } catch (error) {
    return shapeResult(error);
  }
}

async function readKugouAccount(cookie) {
  const api = getKugouApi();
  const device = accountDevice(cookie);
  const read = async (request) => {
    try {
      return shapeResult(await request());
    } catch (error) {
      // SDK 业务错误以 { status, body, cookie } reject。
      return shapeResult(error);
    }
  };
  const { userid, token } = cookie;
  return Promise.all([
    read(() => api.user_detail({ userid, token, cookie: { ...device } })),
    readKugouPlaylistIndex(cookie)
  ]);
}

function isCookieValue(value) {
  return /^[\x21-\x7e]+$/.test(String(value ?? '')) && !/[;]|^(?:undefined|null)$/i.test(value);
}

function hasKugouCredentials(cookie) {
  return (
    /^\d+$/.test(String(cookie.userid || '')) &&
    Number(cookie.userid) > 0 &&
    isCookieValue(cookie.token)
  );
}

function mergeLoginCookie(base, result) {
  const upstream = parseCookieHeader(result.cookie.join('; '));
  const next = { ...base };
  for (const key of [
    'userid',
    'token',
    'dfid',
    't1',
    'vip_type',
    'vip_token',
    'KUGOU_API_MID',
    'KUGOU_API_GUID',
    'KUGOU_API_DEV',
    'KUGOU_API_MAC',
    'KUGOU_API_WEBGL'
  ]) {
    const value = result.body?.data?.[key] ?? upstream[key];
    if (key === 'dfid' && value === '-') continue;
    if (isCookieValue(value)) next[key] = String(value);
    else if (isCookieValue(upstream[key])) next[key] = String(upstream[key]);
  }
  return next;
}

function serializeLoginCookie(cookie) {
  return Object.entries(cookie)
    .filter(([, value]) => isCookieValue(value))
    .map(([key, value]) => `${key}=${value}`)
    .join('; ');
}

/** KuGouMusicApi 响应统一整形：错误保持原始结构供前端分类，成功透传 body */
function shapeResult(result) {
  const status = Number(result?.status || 0);
  return {
    status,
    body: result?.body ?? null,
    cookie: Array.isArray(result?.cookie) ? result.cookie : []
  };
}

function createKugouApiRouter() {
  const router = express.Router();
  const qrDevices = new Map();
  const qrTtlMs = 5 * 60 * 1000;
  let pendingKeys = 0;
  const takeActiveQrDevice = (key) => {
    const session = qrDevices.get(key);
    if (session && session.expiresAt > Date.now()) return session.cookie;
    qrDevices.delete(key);
    return null;
  };
  router.use('/login', (_req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    next();
  });

  router.get('/login/qr/key', async (_req, res) => {
    for (const key of qrDevices.keys()) takeActiveQrDevice(key);
    if (pendingKeys >= 16 || qrDevices.size + pendingKeys >= 512) {
      return res.status(429).json({ code: 429, msg: '酷狗扫码请求过多，请稍后重试' });
    }
    pendingKeys++;
    try {
      const api = getKugouApi();
      const cookie = await registerQrDevice(api);
      const { status, body } = shapeResult(await api.login_qr_key({ cookie }));
      const key = body?.data?.qrcode;
      if (status !== 200 || typeof key !== 'string' || !key) throw new Error('Missing QR key');
      qrDevices.set(key, { cookie, expiresAt: Date.now() + qrTtlMs });
      return res.json({ code: 200, data: body.data });
    } catch {
      return res.status(502).json({ code: 502, msg: '酷狗未能注册设备或创建二维码，请稍后重试' });
    } finally {
      pendingKeys--;
    }
  });

  router.get('/login/qr/create', async (req, res) => {
    try {
      const key = String(req.query.key || '');
      if (!key) {
        res.status(400).json({ code: 400, msg: 'missing key' });
        return;
      }
      const cookie = takeActiveQrDevice(key);
      if (!cookie) return res.status(410).json({ code: 410, msg: '酷狗二维码已失效，请刷新' });
      const result = await getKugouApi().login_qr_create({ key, qrimg: true, cookie });
      const shaped = shapeResult(result);
      // H5 登录链接 + 服务端生成的内嵌二维码图都给前端，前端按需重绘
      res.json({
        code: shaped.status === 200 ? 200 : 502,
        data:
          shaped.status === 200
            ? {
                url: `https://h5.kugou.com/apps/loginQRCode/html/index.html?qrcode=${key}`,
                qrcode_img: shaped.body?.data?.qrcode_img || null
              }
            : null
      });
    } catch (e) {
      res.status(502).json({ code: 502, msg: `酷狗二维码生成失败: ${String(e?.message || e)}` });
    }
  });

  router.get('/login/qr/check', async (req, res) => {
    try {
      const key = String(req.query.key || '');
      if (!key) {
        res.status(400).json({ code: 400, msg: 'missing key' });
        return;
      }
      const device = takeActiveQrDevice(key);
      if (!device) return res.json({ code: 200, data: { status: 'expired', qrcodeStatus: 0 } });
      const result = await getKugouApi().login_qr_check({ key, cookie: device });
      const shaped = shapeResult(result);
      const status = Number(shaped.body?.data?.status);
      // 0=过期 1=等待 2/3=待确认 4=成功。
      const succeeded = status === 4;
      const data = shaped.body?.data || {};
      const cookie = succeeded ? mergeLoginCookie(device, shaped) : null;
      if (
        shaped.status !== 200 ||
        ![0, 1, 2, 3, 4].includes(status) ||
        (cookie && !hasKugouCredentials(cookie))
      ) {
        return res.status(502).json({ code: 502, msg: '未能获取酷狗扫码登录凭据或状态，请重试' });
      }
      if (status === 0) qrDevices.delete(key);
      res.json({
        code: 200,
        data: {
          status: succeeded
            ? 'success'
            : status === 2 || status === 3
              ? 'scanned'
              : status === 0
                ? 'expired'
                : 'waiting',
          qrcodeStatus: status,
          // 成功时组装凭据 Cookie 串（与旧链平台 cookie 形态一致，前端存 platform-cookie-kugou）
          cookie: cookie ? serializeLoginCookie(cookie) : undefined,
          userInfo: succeeded
            ? {
                userId: cookie.userid,
                nickname: data.nick_name || undefined,
                avatarUrl: data.head_img || undefined
              }
            : undefined
        }
      });
    } catch {
      res.status(502).json({ code: 502, msg: '酷狗扫码状态查询失败，请重试' });
    }
  });

  router.get('/login/token/refresh', async (req, res) => {
    try {
      const cookie = parseCookieHeader(req.get('X-Platform-Cookie'));
      if (!hasKugouCredentials(cookie)) {
        return res.status(401).json({ code: 401, msg: '酷狗登录凭据缺失，请重新扫码' });
      }
      const device = { ...getDeviceCookie(), ...cookie };
      const result = await getKugouApi().login_token({ cookie: device });
      const shaped = shapeResult(result);
      const refreshed = mergeLoginCookie(device, shaped);
      const issued = mergeLoginCookie({}, shaped);
      const ok =
        shaped.status === 200 &&
        Number(shaped.body?.status) === 1 &&
        isCookieValue(issued.token) &&
        refreshed.userid === cookie.userid;
      res.status(ok ? 200 : 502).json({
        code: ok ? 200 : 502,
        data: ok ? { cookie: serializeLoginCookie(refreshed) } : null,
        msg: ok ? 'ok' : '酷狗登录态续期失败'
      });
    } catch (e) {
      res.status(502).json({ code: 502, msg: `酷狗登录态续期失败: ${String(e?.message || e)}` });
    }
  });

  router.get('/song/url', async (req, res) => {
    try {
      const hash = String(req.query.hash || '');
      if (!hash) {
        res.status(400).json({ code: 400, msg: 'missing hash' });
        return;
      }
      const cookie = parseCookieHeader(req.get('X-Platform-Cookie'));
      const useNew = req.query.api === 'new';
      const params = useNew ? { hash, cookie } : { hash, cookie };
      const result = await getKugouApi()[useNew ? 'song_url_new' : 'song_url'](params);
      const shaped = shapeResult(result);
      const url =
        shaped.body?.data?.[0]?.url || shaped.body?.url?.[0] || shaped.body?.data?.url || null;
      res.json({
        code: shaped.status === 200 && url ? 200 : 502,
        data: url ? { url } : null,
        msg: url ? 'ok' : '酷狗播放链接获取失败'
      });
    } catch (e) {
      res.status(502).json({ code: 502, msg: `酷狗播放链接获取失败: ${String(e?.message || e)}` });
    }
  });

  return router;
}

module.exports = {
  createKugouApiRouter,
  parseCookieHeader,
  hasKugouCredentials,
  readKugouAccount,
  readKugouPlaylistIndex,
  readKugouTracks
};
