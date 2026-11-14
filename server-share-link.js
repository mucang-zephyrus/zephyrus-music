/** Resolve public music share pages only; never execute embedded page JavaScript. */
const axios = require('axios');
const express = require('express');
const UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1';
const parser = () => import('./src/shared/musicShareLink.mjs');

// Read exactly one JSON value from an assignment, respecting escaped quotes/braces.
function assignmentJson(html, name) {
  const match = new RegExp(`(?:var\\s+|window\\.)?${name}\\s*=\\s*`).exec(html);
  if (!match) return null;
  const start = match.index + match[0].length;
  let quoted = false,
    escaped = false,
    depth = 0;
  const stringValue = html[start] === '"';
  for (let i = start; i < html.length; i++) {
    const char = html[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') {
        quoted = false;
        if (stringValue) {
          try {
            return JSON.parse(JSON.parse(html.slice(start, i + 1)));
          } catch {
            return null;
          }
        }
      }
    } else if (char === '"') quoted = true;
    else if (char === '{' || char === '[') depth++;
    else if (char === '}' || char === ']') {
      if (--depth === 0) {
        try {
          return JSON.parse(html.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    } else if (!depth && !stringValue) return null;
  }
  return null;
}

function songShape(platform, id, name, artists, album, duration) {
  if (!name || !id) return null;
  return {
    id: `${platform}:${id}`,
    platform,
    platformId: id,
    name,
    ar: artists,
    artists,
    al: album,
    album,
    picUrl: album.picUrl || '',
    count: 0,
    dt: duration || 0,
    duration: duration || 0
  };
}

function songFromPage(platform, html) {
  if (platform === 'kugou') {
    const p = assignmentJson(html, 'phpParam');
    const song = p?.song_info?.data;
    const id = song?.hash || p?.hash;
    if (!id || !/^[a-f\d]{32}$/i.test(id) || !song?.songName) return null;
    const artists = (song.authors || []).map((a) => ({
      id: a.author_id || 0,
      name: a.author_name || ''
    }));
    if (!artists.length && song.author_name) artists.push({ id: 0, name: song.author_name });
    const picUrl = String(song.album_img || p.imgurl || '')
      .replace('{size}', '400')
      .replace(/^http:/, 'https:');
    const album = {
      id: String(song.albumid || p.album_id || '0'),
      name: song.album_name || '',
      picUrl
    };
    return songShape(
      platform,
      id.toUpperCase(),
      song.songName,
      artists,
      album,
      Number(song.timeLength || 0) * 1000
    );
  }
  if (platform === 'qq') {
    const song = assignmentJson(html, '__ssrFirstPageData__')?.song;
    if (!song?.mid || !/^[a-z\d]{8,32}$/i.test(song.mid)) return null;
    const artists = (song.singer || []).map((a) => ({
      id: a.mid || a.id || 0,
      name: a.name || ''
    }));
    const mid = song.album?.mid;
    return songShape(
      platform,
      song.mid,
      song.name || song.title,
      artists,
      {
        id: mid || '0',
        name: song.album?.name || '',
        picUrl: mid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${mid}.jpg` : ''
      },
      Number(song.interval || 0) * 1000
    );
  }
  return null;
}

async function resolveMusicShare(value, request = axios.get) {
  const { musicSharePlatform, parseMusicShareUrl } = await parser();
  const platform = musicSharePlatform(value);
  if (!platform || value.length > 4096)
    throw Object.assign(new Error('Unsupported share URL'), { status: 400 });
  const direct = parseMusicShareUrl(value);
  if (direct?.platform === 'netease' && direct.kind === 'song') return { target: direct };
  let current = new URL(value);
  current.protocol = 'https:';
  current.port = '';
  const visited = new Set();
  const deadline = Date.now() + 20000;
  for (let hop = 0; hop < 6; hop++) {
    if (Date.now() >= deadline) throw new Error('Share resolution timed out');
    // Validate every hop before requesting: this endpoint is not an open proxy.
    if (musicSharePlatform(current.href) !== platform || visited.has(current.href))
      throw new Error('Invalid share redirect');
    visited.add(current.href);
    const response = await request(current.href, {
      timeout: Math.max(1, Math.min(7000, deadline - Date.now())),
      maxRedirects: 0,
      maxContentLength: 1024 * 1024,
      responseType: 'text',
      transformResponse: [(data) => data],
      headers: { 'User-Agent': UA },
      validateStatus: () => true
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (!response.headers.location) throw new Error('Share redirect missing location');
      current = new URL(response.headers.location, current);
      if (musicSharePlatform(current.href) !== platform) throw new Error('Invalid share redirect');
      const target = parseMusicShareUrl(current.href);
      if (platform === 'netease' && target?.kind === 'song' && target.platform === platform)
        return { target };
      continue;
    }
    if (response.status !== 200) throw new Error('Share page unavailable');
    const song = songFromPage(platform, String(response.data));
    if (song) return { target: { kind: 'song', platform, id: song.platformId }, song };
    const target = parseMusicShareUrl(current.href);
    if (target?.kind === 'song' && platform === 'netease') return { target };
    // Desktop QQ pages may have no SSR song. Resolve their public mobile equivalent.
    if (platform === 'qq' && target?.kind === 'song' && !current.pathname.includes('/playsong/')) {
      const key = /^\d+$/.test(target.id) ? 'songid' : 'songmid';
      current = new URL(
        `https://i2.y.qq.com/n3/other/pages/playsong/index.html?${key}=${target.id}`
      );
      continue;
    }
    throw new Error('No song found in share page');
  }
  throw new Error('Too many share redirects');
}

function createShareLinkRouter() {
  const router = express.Router();
  const pending = new Map();
  let active = 0;
  router.get('/resolve', async (req, res) => {
    const url = typeof req.query.url === 'string' ? req.query.url : '';
    if (active >= 12) return res.status(429).json({ code: 429, msg: 'Share resolver busy' });
    active++;
    try {
      // Deduplicate concurrent requests, without retaining user sharing parameters.
      if (!pending.has(url)) pending.set(url, resolveMusicShare(url));
      const data = await pending.get(url);
      res.setHeader('Cache-Control', 'no-store');
      res.json({ code: 200, data });
    } catch (error) {
      res
        .status(error.status || 502)
        .json({ code: error.status || 502, msg: 'Share link could not be resolved' });
    } finally {
      active--;
      pending.delete(url);
    }
  });
  return router;
}

module.exports = { assignmentJson, songFromPage, resolveMusicShare, createShareLinkRouter };
