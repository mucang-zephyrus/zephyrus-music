#!/usr/bin/env node
/**
 * Zephyrus 单曲下载器（网易云源）
 *
 * 交互：输入歌名 → 列出候选（Zephyrus 云端曲库 + 网易云）→ 输入编号 → 下载
 *       → 写入封面/歌名/专辑/作者/歌词 → 打印路径与元数据项。
 *
 * 歌词优先级与播放器链条一致：
 *   0. Zephyrus 云端歌词（平台托管歌曲的 lyricsUrl 直链，仅 platform=server）
 *   1. Zephyrus 自有 TTML（mucang.xyz/zephyrus/ttml）
 *   2. AMLL TTML DB（GitHub raw → jsDelivr → amlldb 镜像）
 *   3. 网易云 YRC（/lyric/new 的 yrc 字段）
 *   4. QQ QRC（网关 /platform/qq/lyric，按歌名+歌手+时长精确匹配）
 *   5. 网易云 LRC（/lyric 或 /lyric/new 的行级歌词，含翻译）
 *   6. LRCLIB（兜底）
 *
 * 用法：
 *   node scripts/fetch-song.mjs "晴天"
 *   node scripts/fetch-song.mjs "晴天" --index 2 --level lossless
 *   node scripts/fetch-song.mjs --id 3339553801 --out D:/Music --json
 *
 * 参数：
 *   --id <neteaseId>   跳过搜索，直接指定网易云歌曲 id
 *   --index <n>        跳过交互，直接选择第 n 条
 *   --limit <n>        候选数量，默认 15
 *   --level <音质>     lossless | exhigh | higher | standard，默认 exhigh（不足自动降级）
 *   --out <dir>        输出目录，默认 ./downloads
 *   --enhanced         歌词写成逐字增强 LRC（默认行级 LRC，兼容性最好）
 *   --no-lrclib        关闭 LRCLIB 兜底（国内网络下它常常超时）
 *   --no-cloud         只搜网易云，不查 Zephyrus 云端曲库
 *   --json             结束时输出 JSON 摘要
 *
 * 可选环境变量：
 *   NETEASE_COOKIE          网易云 cookie（VIP 歌曲取流用）
 *   QQ_COOKIE               QQ 音乐 cookie（QRC 歌词，缺省走游客接口）
 *   ZEPHYRUS_API / ZEPHYRUS_TTML  覆盖网关与 TTML 基址
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { writeFlacTags } from 'flac-tagger';
import NodeID3 from 'node-id3';
import { parseFile } from 'music-metadata';
import sharp from 'sharp';

// ==================== 配置 ====================

const API_BASE = (process.env.ZEPHYRUS_API || 'https://mucang.xyz/zephyrus/api').replace(/\/+$/, '');
const TTML_BASE = (process.env.ZEPHYRUS_TTML || 'https://mucang.xyz/zephyrus/ttml').replace(/\/+$/, '');
const CLOUD_CATALOG_URL = (
  process.env.ZEPHYRUS_CLOUD_JSON || 'https://www.mucang.xyz/server-music/songs.json'
).replace(/\/+$/, '');
const AMLL_SOURCES = [
  { base: 'https://raw.githubusercontent.com/amll-dev/amll-ttml-db/refs/heads/main', timeout: 3000 },
  { base: 'https://cdn.jsdelivr.net/gh/amll-dev/amll-ttml-db@main', timeout: 4000 },
  { base: 'https://amlldb.bikonoo.com', timeout: 4000 }
];
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';
const LEVELS = ['lossless', 'exhigh', 'higher', 'standard'];
const COVER_LIMIT = 2 * 1024 * 1024;
const NETEASE_COOKIE = (process.env.NETEASE_COOKIE || '').trim();
const QQ_COOKIE = (process.env.QQ_COOKIE || '').trim();
const rawLog = console.log.bind(console);
const execFileAsync = promisify(execFile);
let silentOutput = false;

// ==================== 基础工具 ====================

class FetchError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'FetchError';
    this.status = status;
  }
}

async function httpText(url, { timeout = 15000, headers = {} } = {}) {
  const response = await fetch(url, {
    headers: { 'User-Agent': UA, ...headers },
    signal: AbortSignal.timeout(timeout),
    redirect: 'follow'
  });
  if (!response.ok) throw new FetchError(`HTTP ${response.status}`, response.status);
  return await response.text();
}

async function httpJson(url, options) {
  const text = await httpText(url, options);
  try {
    return JSON.parse(text);
  } catch {
    throw new FetchError('响应不是合法 JSON');
  }
}

function formatDuration(ms) {
  const total = Math.max(0, Math.round(Number(ms || 0) / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** index;
  return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function sanitizeFilename(name) {
  const cleaned = String(name || '')
    .replace(/[\\/:*?"<>|\r\n\t]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  return (cleaned || 'untitled').slice(0, 120);
}

function decodeEntities(value) {
  return String(value || '')
    .replace(/&#(\d+);/g, (_, code) => {
      const point = Number.parseInt(code, 10);
      return Number.isInteger(point) && point >= 0 && point <= 0x10ffff
        ? String.fromCodePoint(point)
        : '';
    })
    .replace(/&#x([\da-f]+);/gi, (_, code) => {
      const point = Number.parseInt(code, 16);
      return Number.isInteger(point) && point >= 0 && point <= 0x10ffff
        ? String.fromCodePoint(point)
        : '';
    })
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

const stripTags = (html) => String(html || '').replace(/<[^>]*>/g, '');
const normalizeSpace = (text) =>
  String(text || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[\t\r]+/g, ' ')
    .replace(/ {2,}/g, ' ')
    .trim();

/** 标记每个词后面是否跟空格，保证增强 LRC 还原原始词间距。 */
function assignWordSpacing(words, fullText) {
  let cursor = 0;
  for (const word of words) {
    const index = fullText.indexOf(word.text, cursor);
    if (index < 0) continue;
    const end = index + word.text.length;
    word.space = end < fullText.length && /\s/.test(fullText[end]);
    cursor = end;
  }
  return words;
}

/** 解析标签属性（含 ttm: 等带命名空间前缀的键），返回小写键。 */
function parseAttrs(source) {
  const attrs = {};
  const pattern = /([\w:.-]+)\s*=\s*(["'])([\s\S]*?)\2/g;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    attrs[match[1].toLowerCase()] = decodeEntities(match[3]);
  }
  return attrs;
}

/** TTML 时间：秒（"0.530"）或 m:ss.mmm / h:mm:ss.mmm，统一为毫秒。 */
function parseTtmlTime(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const text = String(value).trim();
  if (!text) return undefined;
  if (text.includes(':')) {
    const parts = text.split(':').map((part) => Number.parseFloat(part));
    if (parts.some((part) => !Number.isFinite(part))) return undefined;
    const seconds = parts.pop() || 0;
    const minutes = parts.pop() || 0;
    const hours = parts.pop() || 0;
    return Math.round((hours * 3600 + minutes * 60 + seconds) * 1000);
  }
  const seconds = Number.parseFloat(text);
  if (!Number.isFinite(seconds)) return undefined;
  return Math.round(seconds * 1000);
}

const lrcTimeTag = (ms) => {
  const safe = Math.max(0, Math.round(ms || 0));
  const minutes = Math.floor(safe / 60000);
  const seconds = Math.floor((safe % 60000) / 1000);
  const centis = Math.floor((safe % 1000) / 10);
  return `[${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(centis).padStart(2, '0')}]`;
};

const inlineTimeTag = (ms) => `<${lrcTimeTag(ms).slice(1, -1)}>`;

// ==================== 搜索与取流 ====================

async function searchSongs(keyword, limit) {
  const url = `${API_BASE}/cloudsearch?keywords=${encodeURIComponent(keyword)}&type=1&limit=${limit}`;
  const data = await httpJson(url);
  const songs = data?.result?.songs;
  if (!Array.isArray(songs) || songs.length === 0) return [];
  return songs.map((song) => ({
    id: String(song.id),
    name: String(song.name || '').trim(),
    artists: (song.ar || song.artists || []).map((artist) => artist.name).filter(Boolean),
    album: String(song.al?.name || song.album?.name || '').trim(),
    cover: song.al?.picUrl || song.album?.picUrl || song.picUrl || '',
    duration: Number(song.dt || song.duration || 0),
    fee: Number(song.fee ?? -1),
    privilege: song.privilege || null
  }));
}

async function getSongDetail(id) {
  const data = await httpJson(`${API_BASE}/song/detail?ids=${encodeURIComponent(id)}`);
  const song = data?.songs?.[0];
  if (!song) return null;
  return {
    id: String(song.id),
    name: String(song.name || '').trim(),
    artists: (song.ar || []).map((artist) => artist.name).filter(Boolean),
    album: String(song.al?.name || '').trim(),
    cover: song.al?.picUrl || '',
    duration: Number(song.dt || 0),
    track: Number(song.no) || undefined,
    publishTime: Number(song.publishTime) || undefined,
    albumId: song.al?.id || undefined
  };
}

/** ==================== Zephyrus 云端曲库 ==================== */

let cloudCatalog = null;

function parseTrackNumber(value) {
  const match = String(value ?? '').match(/\d+/);
  const track = match ? Number.parseInt(match[0], 10) : 0;
  return track > 0 ? track : undefined;
}

/** 拉取 songs.json（App 端同样的数据源），一次进程内只拉一次。 */
async function loadCloudSongs() {
  if (cloudCatalog) return cloudCatalog;
  try {
    const data = await httpJson(`${CLOUD_CATALOG_URL}?t=${Date.now()}`, { timeout: 8000 });
    const list = Array.isArray(data) ? data : Array.isArray(data?.songs) ? data.songs : [];
    cloudCatalog = list
      .filter((song) => song && song.id && song.audioUrl)
      .map((song) => ({
        kind: 'server',
        id: String(song.id),
        name: String(song.name || '').trim(),
        artists: (Array.isArray(song.artists) ? song.artists : []).filter(Boolean).map(String),
        album: String(song.album || '').trim(),
        cover: String(song.picUrl || ''),
        duration: Number(song.duration || 0),
        track: parseTrackNumber(song.track),
        year: String(song.year || ''),
        audioUrl: String(song.audioUrl),
        lyricsUrl: String(song.lyricsUrl || '')
      }));
  } catch (error) {
    if (process.env.DEBUG) console.error('[cloud] 曲库加载失败:', error.message);
    cloudCatalog = [];
  }
  return cloudCatalog;
}

let pinyinMatcher;

async function getPinyinMatcher() {
  if (pinyinMatcher !== undefined) return pinyinMatcher;
  try {
    const mod = await import('pinyin-match');
    pinyinMatcher = mod.default || mod;
  } catch {
    pinyinMatcher = null;
  }
  return pinyinMatcher;
}

function subsequenceGap(value, query) {
  let queryIndex = 0;
  let firstMatch = -1;
  let lastMatch = -1;
  for (let index = 0; index < value.length && queryIndex < query.length; index += 1) {
    if (value[index] !== query[queryIndex]) continue;
    if (firstMatch < 0) firstMatch = index;
    lastMatch = index;
    queryIndex += 1;
  }
  if (queryIndex !== query.length) return null;
  return lastMatch - firstMatch + 1 - query.length;
}

function editDistance(left, right) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1)
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length];
}

/** 与 App 的 scoreText 同构：精确 < 前缀 < 包含 < 拼音 < 子序列 < 编辑距离。 */
function scoreCloudText(value, query, rawQuery, pinyin) {
  const normalized = normalizeMatchText(value);
  if (!normalized || !query) return Number.POSITIVE_INFINITY;
  if (normalized === query) return 0;
  if (normalized.startsWith(query)) return 4 + normalized.length - query.length;
  const includesAt = normalized.indexOf(query);
  if (includesAt >= 0) return 12 + includesAt;
  if (pinyin?.match?.(value, rawQuery)) return 30;
  const gap = subsequenceGap(normalized, query);
  if (gap !== null) return 48 + gap;
  if (Math.abs(normalized.length - query.length) <= 3) {
    const distance = editDistance(normalized, query);
    const threshold = Math.min(3, Math.max(1, Math.ceil(query.length * 0.3)));
    if (distance <= threshold) return 72 + distance;
  }
  return Number.POSITIVE_INFINITY;
}

/** 统一的文本相关度：歌名/歌手/专辑/整串取最优，权重与 App 的 rankSearchResults 一致。 */
function scoreSongRelevance(song, query, rawQuery, pinyin) {
  const artists = (song.artists || []).join(' ');
  return Math.min(
    scoreCloudText(song.name, query, rawQuery, pinyin),
    scoreCloudText(artists, query, rawQuery, pinyin) + 8,
    scoreCloudText(song.album || '', query, rawQuery, pinyin) + 16,
    scoreCloudText(`${song.name} ${artists} ${song.album || ''}`, query, rawQuery, pinyin) + 24
  );
}

/**
 * 搜索：云端曲库与网易云结果合并成同一条按相关度排序的列表。
 * 同分时网易云在前（保持其自身热度排序），云端结果只按文本匹配插队。
 */
async function searchAllSongs(keyword, { limit = 15, cloud = true, cloudLimit = 10 } = {}) {
  const rawQuery = String(keyword || '').trim();
  if (!rawQuery) return [];
  const query = normalizeMatchText(rawQuery);
  const pinyin = await getPinyinMatcher();

  const [cloudSongs, neteaseSongs] = await Promise.all([
    cloud ? loadCloudSongs().catch(() => []) : Promise.resolve([]),
    searchSongs(rawQuery, limit).catch(() => [])
  ]);

  const cloudHits = cloudSongs
    .map((song) => ({ song, score: scoreSongRelevance(song, query, rawQuery, pinyin) }))
    .filter((item) => Number.isFinite(item.score))
    .sort((left, right) => left.score - right.score)
    .slice(0, cloudLimit);

  const merged = [
    ...neteaseSongs.map((song, index) => ({
      song: { ...song, kind: 'netease' },
      score: scoreSongRelevance(song, query, rawQuery, pinyin),
      index
    })),
    ...cloudHits.map((item, index) => ({
      song: { ...item.song, kind: 'server' },
      score: item.score,
      index: neteaseSongs.length + index
    }))
  ];

  merged.sort((left, right) => left.score - right.score || left.index - right.index);
  return interleaveTiedScores(merged).map((item) => item.song);
}

/** 同分区间内交替网易云 / 云端，避免云端整段堆在末尾。 */
function interleaveTiedScores(entries) {
  const result = [];
  let cursor = 0;
  while (cursor < entries.length) {
    let end = cursor;
    while (end < entries.length && entries[end].score === entries[cursor].score) end += 1;
    const group = entries.slice(cursor, end);
    const netease = group.filter((entry) => entry.song.kind === 'netease');
    const server = group.filter((entry) => entry.song.kind === 'server');
    const rounds = Math.max(netease.length, server.length);
    for (let index = 0; index < rounds; index += 1) {
      if (netease[index]) result.push(netease[index]);
      if (server[index]) result.push(server[index]);
    }
    cursor = end;
  }
  return result;
}

async function searchCloudSongs(keyword, limit = 5) {
  const songs = await loadCloudSongs();
  if (!songs.length || !keyword?.trim()) return [];
  const query = normalizeMatchText(keyword);
  const pinyin = await getPinyinMatcher();
  return songs
    .map((song) => {
      const score = Math.min(
        scoreCloudText(song.name, query, keyword.trim(), pinyin),
        scoreCloudText(song.artists.join(' '), query, keyword.trim(), pinyin) + 8,
        scoreCloudText(song.album, query, keyword.trim(), pinyin) + 16
      );
      return { song, score };
    })
    .filter((item) => Number.isFinite(item.score))
    .sort((left, right) => left.score - right.score)
    .slice(0, limit)
    .map((item) => item.song);
}

/** 云端曲目的歌词就在 lyricsUrl（LRC 或 TTML），优先于任何回退源。 */
async function fetchServerLyric(song) {
  if (!song.lyricsUrl) return null;
  try {
    const text = await httpText(song.lyricsUrl, { timeout: 8000 });
    const isTtml = text.includes('<tt');
    const lines = isTtml ? parseTtml(text) : parsePlainLrc(text);
    if (!isUsableLyric(lines)) return null;
    return {
      source: 'Zephyrus 云端歌词',
      detail: song.lyricsUrl,
      lines,
      wordTimed: isTtml || lines.some((line) => line.words?.length)
    };
  } catch {
    return null;
  }
}

/** 逐级降级取流；返回可直接下载的地址。 */
async function resolveAudioUrl(song, preferredLevel) {
  const startIndex = Math.max(0, LEVELS.indexOf(preferredLevel));
  const failures = [];
  for (const level of LEVELS.slice(startIndex)) {
    const params = new URLSearchParams({ id: song.id, level, encodeType: level === 'lossless' ? 'flac' : 'mp3' });
    if (NETEASE_COOKIE) params.set('cookie', NETEASE_COOKIE);
    try {
      const data = await httpJson(`${API_BASE}/song/url/v1?${params}`, { timeout: 20000 });
      const item = data?.data?.[0];
      if (item?.url) {
        return {
          url: item.url,
          type: String(item.type || '').toLowerCase(),
          level: String(item.level || level).toLowerCase(),
          br: Number(item.br || 0),
          size: Number(item.size || 0),
          requestedLevel: level
        };
      }
      failures.push(`${level}: 无可用地址`);
    } catch (error) {
      failures.push(`${level}: ${error.message}`);
    }
  }
  throw new Error(
    `取流失败（${failures.join('；')}）。该曲可能需要 VIP 或已被版权下架，可设置 NETEASE_COOKIE 后重试。`
  );
}

async function downloadAudio(url, targetBase) {
  const response = await fetch(url, {
    headers: { 'User-Agent': UA, Referer: 'https://music.163.com/' },
    signal: AbortSignal.timeout(180000),
    redirect: 'follow'
  });
  if (!response.ok || !response.body) throw new FetchError(`下载失败 HTTP ${response.status}`);

  const total = Number(response.headers.get('content-length') || 0);
  const tmp = `${targetBase}.part`;
  let loaded = 0;
  let lastTick = 0;
  const body = Readable.fromWeb(response.body);
  body.on('data', (chunk) => {
    loaded += chunk.length;
    const now = Date.now();
    if (!silentOutput && process.stdout.isTTY && now - lastTick > 400) {
      lastTick = now;
      const percent = total ? Math.floor((loaded / total) * 100) : 0;
      process.stdout.write(`\r  下载中 ${total ? `${percent}%` : formatBytes(loaded)}  ${formatBytes(loaded)}   `);
    }
  });
  await pipeline(body, fs.createWriteStream(tmp));
  if (!silentOutput && process.stdout.isTTY) {
    process.stdout.write(`\r  下载完成 ${formatBytes(loaded)}                              \n`);
  }

  if (total > 0 && loaded !== total) {
    await fsp.rm(tmp, { force: true });
    throw new Error(`文件不完整：收到 ${loaded} / ${total} 字节`);
  }
  return { tmp, bytes: loaded, contentType: response.headers.get('content-type') || '' };
}

async function sniffFormat(file, contentType = '') {
  const handle = await fsp.open(file, 'r');
  const buffer = Buffer.alloc(12);
  try {
    await handle.read(buffer, 0, 12, 0);
  } finally {
    await handle.close();
  }
  const ascii = buffer.toString('latin1');
  if (ascii.startsWith('fLaC')) return 'flac';
  if (ascii.startsWith('ID3')) return 'mp3';
  if (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) return 'mp3';
  if (ascii.slice(4, 8) === 'ftyp') return 'm4a';
  if (ascii.startsWith('OggS')) return 'ogg';
  if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46) return 'wav';
  if (/mpeg|mp3/i.test(contentType)) return 'mp3';
  if (/flac/i.test(contentType)) return 'flac';
  return '';
}

// ==================== 歌词：解析原语 ====================

/**
 * 统一歌词行结构：
 * { start: 毫秒, end?: 毫秒, text: 行文本, words?: [{text,start,end}], trans?: 翻译, bg?: 背景和声 }
 */

function parseTtml(xml) {
  const body = String(xml || '').replace(/<head[\s\S]*?<\/head>/i, '');
  const lines = [];
  const paragraph = /<p\b([^>]*)>([\s\S]*?)<\/p>/gi;
  let match;
  while ((match = paragraph.exec(body)) !== null) {
    const attrs = parseAttrs(match[1]);
    const start = parseTtmlTime(attrs.begin) ?? 0;
    const end = parseTtmlTime(attrs.end);
    const words = [];
    let translated = '';
    let background = '';

    const inner = match[2].replace(/<span\b([^>]*)>([\s\S]*?)<\/span>/gi, (whole, rawAttrs, content) => {
      const spanAttrs = parseAttrs(rawAttrs);
      const role = String(spanAttrs['ttm:role'] || '').toLowerCase();
      const plain = normalizeSpace(decodeEntities(stripTags(content)));
      if (role === 'x-translation') {
        if (plain) translated = translated ? `${translated} ${plain}` : plain;
        return '';
      }
      if (role === 'x-roman') return '';
      if (role === 'x-bg') {
        if (plain) background = background ? `${background} ${plain}` : plain;
        return '';
      }
      const wordStart = parseTtmlTime(spanAttrs.begin);
      const wordEnd = parseTtmlTime(spanAttrs.end);
      if (plain && wordStart !== undefined) {
        words.push({ text: plain, start: wordStart, end: wordEnd ?? wordStart });
      }
      return whole;
    });

    const text = normalizeSpace(decodeEntities(stripTags(inner)));
    if (!text) continue;
    lines.push({
      start,
      end,
      text,
      trans: translated || undefined,
      bg: background || undefined,
      words: words.length > 1 ? assignWordSpacing(words, text) : undefined
    });
  }
  lines.sort((left, right) => left.start - right.start);
  return lines;
}

function extractQrcContent(payload) {
  const source = String(payload || '').trim();
  if (!source.startsWith('<')) return source;
  const attribute = source.match(/\bLyricContent\s*=\s*(["'])([\s\S]*?)\1/i);
  return attribute ? decodeEntities(attribute[2]) : source;
}

/** 解析 [mm:ss.xx] 行级 LRC（多时间标签、增强 LRC 的词时间、翻译合并都在这里处理）。 */
function parsePlainLrc(text) {
  const lines = [];
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const tags = [...line.matchAll(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
    if (tags.length === 0) continue;
    const content = line.replace(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g, '').trim();
    if (!content) continue;

    // 增强 LRC：<mm:ss.xx>词<mm:ss.xx>词
    const words = [];
    let plain = content;
    if (/<\d{1,3}:\d{2}(?:[.:]\d{1,3})?>/.test(content)) {
      plain = normalizeSpace(content.replace(/<\d{1,3}:\d{2}(?:[.:]\d{1,3})?>/g, ''));
      const marker = /<(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?>/g;
      const marks = [];
      let match;
      while ((match = marker.exec(content)) !== null) {
        marks.push({
          index: marker.lastIndex,
          start:
            Number.parseInt(match[1], 10) * 60000 +
            Number.parseInt(match[2], 10) * 1000 +
            (match[3] ? Number.parseInt(match[3].padEnd(3, '0').slice(0, 3), 10) : 0)
        });
      }
      marks.forEach((mark, index) => {
        const end = marks[index + 1]?.index ?? content.length;
        const wordText = content.slice(mark.index, end);
        if (wordText.trim()) words.push({ text: wordText, start: mark.start, end: 0 });
      });
      if (words.length > 1) assignWordSpacing(words, plain);
    }

    for (const tag of tags) {
      const minutes = Number.parseInt(tag[1], 10);
      const seconds = Number.parseInt(tag[2], 10);
      const fraction = tag[3] ? Number.parseInt(tag[3].padEnd(3, '0').slice(0, 3), 10) : 0;
      lines.push({
        start: minutes * 60000 + seconds * 1000 + fraction,
        text: plain,
        words: words.length > 1 ? words : undefined
      });
    }
  }
  lines.sort((left, right) => left.start - right.start);
  return lines;
}

/** 网易云 /lyric/new 的富文本歌词：每行一个 JSON {"t":ms,"c":[{"tx":"..."}]} */
function parseRichJsonLrc(text) {
  const lines = [];
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith('{')) continue;
    try {
      const entry = JSON.parse(line);
      if (!Array.isArray(entry?.c)) continue;
      const content = normalizeSpace(entry.c.map((item) => item?.tx || '').join(''));
      if (!content) continue;
      lines.push({ start: Number(entry.t) || 0, text: content });
    } catch {
      // 跳过坏行
    }
  }
  lines.sort((left, right) => left.start - right.start);
  return lines;
}

/**
 * 网易云 /lyric 的 lrc 字段可能是两种格式的混合：
 * 前几行是富文本 JSON（制作人员表），后面直接接标准 LRC 正文。
 */
function parseNeteaseLrcPayload(text) {
  const merged = [...parseRichJsonLrc(text), ...parsePlainLrc(text)];
  merged.sort((left, right) => left.start - right.start);
  return merged;
}

/** 解析 YRC / QRC 的逐字行：[start,dur]text(start,dur,0)text(start,dur,0) */
function parseWordTimedLyric(text, { relativeWords = false } = {}) {
  const lines = [];
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    const head = line.match(/^\[(\d+),(\d+)\]([\s\S]*)$/);
    if (!head) continue;
    const start = Number.parseInt(head[1], 10);
    const duration = Number.parseInt(head[2], 10);
    const content = head[3];
    if (!Number.isFinite(start) || !Number.isFinite(duration)) continue;

    const words = [];
    const wordPattern = /([^()[\]<>]*?)(?:\((\d+),(\d+)(?:,\d+)?\)|\[(\d+),(\d+)(?:,\d+)?\]|<(\d+),(\d+)(?:,\d+)?>)/g;
    let match;
    while ((match = wordPattern.exec(content)) !== null) {
      const rawStart = Number.parseInt(match[2] ?? match[4] ?? match[6], 10);
      const rawDuration = Number.parseInt(match[3] ?? match[5] ?? match[7], 10);
      const wordText = match[1];
      if (!wordText || !Number.isFinite(rawStart) || !Number.isFinite(rawDuration)) continue;
      // QRC 的词时间是相对行首的偏移；YRC 是绝对时间。两者都能用这个判据区分。
      const absolute =
        relativeWords || (rawStart < start && rawStart <= duration) ? start + rawStart : rawStart;
      words.push({ text: wordText, start: absolute, end: absolute + Math.max(0, rawDuration) });
    }

    const text = normalizeSpace(words.map((word) => word.text).join('') || content);
    if (!text) continue;
    lines.push({
      start,
      end: start + duration,
      text,
      words: words.length > 1 ? assignWordSpacing(words, text) : undefined
    });
  }
  lines.sort((left, right) => left.start - right.start);
  return lines;
}

/** 按时间对齐翻译（±300ms），与播放器的合并阈值一致。 */
function attachTranslation(lines, translationLines) {
  if (!lines.length || !translationLines.length) return lines;
  for (const line of lines) {
    let best;
    let bestDiff = 301;
    for (const candidate of translationLines) {
      const diff = Math.abs(candidate.start - line.start);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = candidate;
      }
    }
    if (best) line.trans = best.text;
  }
  return lines;
}

const PLACEHOLDER_PATTERNS = [
  /^(?:暂无|暂不|暂未|没有|无)(?:相关)?歌词$/i,
  /^该歌曲(?:暂无|暂不|暂未|没有|无)(?:相关)?歌词$/i,
  /^(?:纯音乐|instrumental)$/i,
  /该歌曲(?:为)?(?:没有填词的)?纯音乐/i,
  /(?:版权方|版权)要求.*(?:不|暂不)展示歌词/i,
  /(?:因版权|由于版权).*无法.*歌词/i,
  /lyrics?\s*(?:not found|unavailable)/i,
  /no\s+lyrics?/i
];
const CREDIT_PATTERN =
  /^(?:作词|作曲|编曲|制作人|词|曲|混音|母带|录音|和声|吉他|贝斯|鼓|人声|管乐|键盘|弦乐|监制|出品|发行|统筹|企划|制作)\s*[:：]/i;

const compactText = (value) =>
  String(value || '')
    .replace(/[\s\u200b-\u200d\ufeff]+/g, '')
    .replace(/[.,，。!！?？:：;；'"“”‘’()（）[\]【】]/g, '');

function isMeaningfulLine(line) {
  const text = compactText(line?.text);
  if (!text) return false;
  if (PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(text))) return false;
  return !CREDIT_PATTERN.test(String(line?.text || '').trim());
}

function isUsableLyric(lines) {
  if (!Array.isArray(lines) || lines.length < 2) return false;
  return lines.filter(isMeaningfulLine).length >= 1;
}

// ==================== 歌词：取源链条 ====================

async function fetchOwnTtml(id) {
  const url = `${TTML_BASE}/ncm-lyrics/${encodeURIComponent(id)}.ttml`;
  try {
    const xml = await httpText(url, { timeout: 4000 });
    if (!xml.includes('<tt')) return null;
    const lines = parseTtml(xml);
    return isUsableLyric(lines) ? { source: 'Zephyrus TTML', detail: url, lines, wordTimed: true } : null;
  } catch {
    return null;
  }
}

async function fetchAmllTtml(id) {
  const suffix = `/ncm-lyrics/${encodeURIComponent(id)}.ttml`;
  // 三个地址是同一份数据的镜像，取最快返回的一个（优先级只在来源类型之间生效）。
  const attempt = async ({ base, timeout }) => {
    const xml = await httpText(`${base}${suffix}`, { timeout });
    if (!xml.includes('<tt')) throw new Error('不是 TTML');
    const lines = parseTtml(xml);
    if (!isUsableLyric(lines)) throw new Error('歌词为空');
    return { source: 'AMLL TTML', detail: `${base}${suffix}`, lines, wordTimed: true };
  };
  try {
    return await Promise.any(AMLL_SOURCES.map(attempt));
  } catch {
    return null;
  }
}

async function fetchNeteaseLyricRaw(id) {
  const cache = { new: null, legacy: null };
  try {
    cache.new = await httpJson(`${API_BASE}/lyric/new?id=${encodeURIComponent(id)}`);
  } catch {
    /* 忽略，走旧接口 */
  }
  if (!cache.new) {
    try {
      cache.legacy = await httpJson(`${API_BASE}/lyric?id=${encodeURIComponent(id)}`);
    } catch {
      /* 无歌词 */
    }
  }
  return cache;
}

function pickNeteaseField(payload, keys) {
  for (const key of keys) {
    const value = payload?.[key];
    if (typeof value === 'string' && value.trim()) return value;
    if (value && typeof value === 'object' && typeof value.lyric === 'string' && value.lyric.trim()) {
      return value.lyric;
    }
  }
  return '';
}

async function fetchNeteaseYrc(id, cache) {
  const payload = cache.new;
  if (!payload) return null;
  const raw = pickNeteaseField(payload, ['yrc', 'ylyric']);
  if (!raw || !/^\s*\[\d+,\d+\]/m.test(raw)) return null;
  const lines = parseWordTimedLyric(raw);
  if (!isUsableLyric(lines)) return null;
  const translation = pickNeteaseField(payload, ['ytlrc', 'tlyric']);
  if (translation) attachTranslation(lines, parsePlainLrc(translation));
  return {
    source: '网易云 YRC',
    detail: `${API_BASE}/lyric/new?id=${id}`,
    lines,
    wordTimed: true
  };
}

async function fetchNeteaseLrc(id, cache) {
  const payloadNew = cache.new;
  const payloadLegacy = cache.legacy;
  let raw = pickNeteaseField(payloadNew, ['lrc']);
  if (!raw && payloadLegacy) raw = await Promise.resolve(pickNeteaseField(payloadLegacy, ['lrc']));
  if (!raw) return null;

  const lines = parseNeteaseLrcPayload(raw);
  if (!isUsableLyric(lines)) return null;

  const translation = pickNeteaseField(payloadNew, ['tlyric']) || pickNeteaseField(payloadLegacy, ['tlyric']);
  if (translation) attachTranslation(lines, parsePlainLrc(translation));
  return {
    source: '网易云 LRC',
    detail: `${API_BASE}/lyric/new?id=${id}`,
    lines,
    wordTimed: false
  };
}

const normalizeMatchText = (value) =>
  String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/\.(?:mp3|flac|wav|m4a|aac|ogg|ape)$/i, '')
    .replace(/[\s\-–—_.·•()[\]{}（）【】,，。!！?？:：;'"“”‘’]/g, '');

/** 与播放器一致：标题必须完全一致，歌手至少一个匹配，时长差 ≤12s。 */
function lyricMatchScore(source, candidate) {
  const sourceTitle = normalizeMatchText(source.name);
  const candidateTitle = normalizeMatchText(candidate.name);
  if (!sourceTitle || sourceTitle !== candidateTitle) return -1;
  let score = 60;

  const sourceArtists = (source.artists || []).map(normalizeMatchText);
  const candidateArtists = (candidate.artists || []).map(normalizeMatchText);
  if (sourceArtists.length) {
    const matched = sourceArtists.some((artist) =>
      candidateArtists.some(
        (other) => other === artist || other.includes(artist) || artist.includes(other)
      )
    );
    if (!matched) return -1;
    score += 25;
  }

  if (source.duration > 0 && candidate.duration > 0) {
    const diff = Math.abs(source.duration - candidate.duration);
    if (diff > 12000) return -1;
    score += diff <= 2500 ? 20 : diff <= 8000 ? 10 : 4;
  }

  const sourceAlbum = normalizeMatchText(source.album);
  const candidateAlbum = normalizeMatchText(candidate.album);
  if (sourceAlbum && candidateAlbum && sourceAlbum === candidateAlbum) score += 10;
  return score;
}

async function fetchQqQrc(song) {
  const keyword = [song.name, ...(song.artists || []).slice(0, 2)].filter(Boolean).join(' ');
  if (!keyword) return null;
  try {
    const search = await httpJson(
      `${API_BASE}/platform/qq/search?keyword=${encodeURIComponent(keyword)}&limit=12&noCache=${Date.now()}`,
      { timeout: 12000, headers: QQ_COOKIE ? { 'X-Platform-Cookie': QQ_COOKIE } : {} }
    );
    const candidates = (search?.data?.songs || []).map((item) => ({
      id: String(item.id || ''),
      name: String(item.name || ''),
      artists: (item.ar || item.artists || []).map((artist) => artist.name).filter(Boolean),
      album: String(item.al?.name || item.album?.name || ''),
      duration: Number(item.dt || item.duration || 0)
    }));
    const best = candidates
      .map((candidate) => ({ candidate, score: lyricMatchScore(song, candidate) }))
      .filter((item) => item.score >= 85)
      .sort((left, right) => right.score - left.score)[0]?.candidate;
    if (!best) return null;

    const mid = best.id.replace(/^qq:/i, '');
    const payload = await httpJson(
      `${API_BASE}/platform/qq/lyric?mid=${encodeURIComponent(mid)}`,
      { timeout: 12000, headers: QQ_COOKIE ? { 'X-Platform-Cookie': QQ_COOKIE } : {} }
    );
    const data = payload?.data;
    if (payload?.code !== 200 || !data?.lyric) return null;

    const isQrc = String(data.format).toLowerCase() === 'qrc' || /^\s*<QrcInfos/i.test(data.lyric);
    const lines = isQrc
      ? parseWordTimedLyric(extractQrcContent(data.lyric))
      : parsePlainLrc(data.lyric);
    if (!isUsableLyric(lines)) return null;
    if (data.translation) {
      const translated = isQrc
        ? parseWordTimedLyric(extractQrcContent(data.translation))
        : parsePlainLrc(data.translation);
      attachTranslation(lines, translated);
    }
    return {
      source: isQrc ? 'QQ QRC' : 'QQ LRC',
      detail: `${API_BASE}/platform/qq/lyric?mid=${mid}`,
      lines,
      wordTimed: isQrc
    };
  } catch {
    return null;
  }
}

async function fetchLrclib(song) {
  try {
    const params = new URLSearchParams({
      track_name: song.name,
      artist_name: (song.artists || []).join(', '),
      album_name: song.album || ''
    });
    if (song.duration > 0) params.set('duration', String(Math.round(song.duration / 1000)));
    const data = await httpJson(`https://lrclib.net/api/get?${params}`, { timeout: 6000 });
    if (!data || data.instrumental) return null;
    const lines = parsePlainLrc(data.syncedLyrics || '');
    if (!isUsableLyric(lines)) {
      const plain = String(data.plainLyrics || '')
        .split(/\r?\n/)
        .map((text) => text.trim())
        .filter(Boolean)
        .map((text) => ({ start: 0, text }));
      if (plain.length < 2) return null;
      return { source: 'LRCLIB（无时间轴）', detail: 'https://lrclib.net', lines: plain, wordTimed: false };
    }
    return { source: 'LRCLIB', detail: 'https://lrclib.net', lines, wordTimed: false };
  } catch {
    return null;
  }
}

async function resolveLyrics(song, { lrclib = true } = {}) {
  const isServer = song.kind === 'server';
  const cache = isServer ? null : await fetchNeteaseLyricRaw(song.id);
  const attempts = isServer
    ? [{ label: 'Zephyrus 云端歌词', run: () => fetchServerLyric(song) }]
    : [
        { label: 'Zephyrus TTML', run: () => fetchOwnTtml(song.id) },
        { label: 'AMLL TTML', run: () => fetchAmllTtml(song.id) },
        { label: '网易云 YRC', run: () => fetchNeteaseYrc(song.id, cache) }
      ];
  attempts.push({ label: 'QQ QRC', run: () => fetchQqQrc(song) });
  if (!isServer) {
    attempts.push({ label: '网易云 LRC', run: () => fetchNeteaseLrc(song.id, cache) });
  }
  if (lrclib) attempts.push({ label: 'LRCLIB', run: () => fetchLrclib(song) });
  for (const attempt of attempts) {
    const startedAt = Date.now();
    try {
      const result = await attempt.run();
      const usable = result && isUsableLyric(result.lines);
      if (process.env.DEBUG) {
        console.error(`[lyrics] ${attempt.label} ${Date.now() - startedAt}ms -> ${usable ? 'hit' : 'miss'}`);
      }
      if (usable) return result;
    } catch (error) {
      if (process.env.DEBUG) {
        console.error(`[lyrics] ${attempt.label} ${Date.now() - startedAt}ms -> ${error.message}`);
      }
    }
  }
  return null;
}

// ==================== 歌词：输出为 LRC ====================

function toLrc(song, lyric, { enhanced = false } = {}) {
  const header = [
    `[ti:${song.name}]`,
    `[ar:${(song.artists || []).join(' / ')}]`,
    `[al:${song.album || ''}]`,
    `[by:Zephyrus · ${lyric.source}]`
  ];
  const body = [];
  for (const line of lyric.lines) {
    const tag = lrcTimeTag(line.start);
    if (enhanced && line.words?.length) {
      const words = line.words
        .map((word) => `${inlineTimeTag(word.start)}${word.text}${word.space ? ' ' : ''}`)
        .join('')
        .trimEnd();
      body.push(`${tag}${words}`);
    } else {
      body.push(`${tag}${line.text}`);
    }
    if (line.trans) body.push(`${tag}${line.trans}`);
    if (line.bg) body.push(`${tag}(和声) ${line.bg}`);
  }
  return `${header.join('\n')}\n${body.join('\n')}\n`;
}

// ==================== 封面与标签 ====================

async function fetchCover(url) {
  if (!url) return null;

  /** 网易图床支持 ?param=，其它 CDN 加了反而可能 404。 */
  const withParam = (base) => {
    if (base.includes('?') || !/^https?:/i.test(base)) return base;
    try {
      return /(^|\.)126\.net$/i.test(new URL(base).hostname) ? `${base}?param=1024y1024` : base;
    } catch {
      return base;
    }
  };

  const candidates = [];
  const secured = url.replace(/^http:/i, 'https:');
  if (secured !== url) candidates.push(secured);
  candidates.push(url);

  for (const base of candidates) {
    try {
      const response = await fetch(withParam(base), {
        headers: { 'User-Agent': UA, Referer: 'https://music.163.com/' },
        signal: AbortSignal.timeout(20000)
      });
      if (!response.ok) continue;
      let buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length === 0) continue;

      if (buffer.length > COVER_LIMIT) {
        try {
          buffer = await sharp(buffer)
            .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 80 })
            .toBuffer();
        } catch {
          // 压缩失败则使用原图
        }
      }

      const mime = buffer.subarray(0, 4).toString('hex').startsWith('89504e47')
        ? 'image/png'
        : buffer.subarray(0, 2).toString('latin1') === 'BM'
          ? 'image/bmp'
          : 'image/jpeg';
      return { buffer, mime };
    } catch {
      // 换下一个候选地址
    }
  }
  return null;
}

function writeMp3Tags(file, meta) {
  NodeID3.removeTags(file);
  const tags = {
    title: meta.title,
    artist: meta.artist,
    album: meta.album,
    // node-id3 用 performerInfo 映射 TPE2；写 albumArtist 会被静默忽略
    performerInfo: meta.albumArtist || meta.artist,
    trackNumber: meta.track ? String(meta.track) : undefined,
    year: meta.year ? String(meta.year) : undefined
  };
  if (meta.cover) {
    tags.APIC = {
      mime: meta.cover.mime,
      type: { id: 3, name: 'front cover' },
      description: 'Cover',
      imageBuffer: meta.cover.buffer
    };
  }
  if (meta.lyrics) {
    tags.USLT = { language: 'chi', description: 'Lyrics', text: meta.lyrics };
  }
  const result = NodeID3.write(tags, file);
  if (!result) throw new Error('ID3 标签写入失败');
  return [
    'TITLE',
    'ARTIST (TPE1)',
    'ALBUM',
    'ALBUMARTIST (TPE2)',
    ...(meta.track ? ['TRACKNUMBER (TRCK)'] : []),
    ...(meta.year ? ['YEAR (TYER)'] : []),
    ...(meta.lyrics ? ['USLT (歌词)'] : []),
    ...(meta.cover ? ['APIC (封面)'] : [])
  ];
}

async function writeFlacTagsFile(file, meta) {
  const tagMap = {
    TITLE: meta.title,
    ARTIST: meta.artist,
    ALBUM: meta.album,
    ALBUMARTIST: meta.artist,
    LYRICS: meta.lyrics || ''
  };
  if (meta.track) tagMap.TRACKNUMBER = String(meta.track);
  if (meta.year) tagMap.DATE = String(meta.year);

  await writeFlacTags(
    {
      tagMap,
      picture: meta.cover ? { buffer: meta.cover.buffer, mime: meta.cover.mime } : undefined
    },
    file
  );
  return [
    'TITLE',
    'ARTIST',
    'ALBUM',
    'ALBUMARTIST',
    ...(meta.track ? ['TRACKNUMBER'] : []),
    ...(meta.year ? ['DATE'] : []),
    ...(meta.lyrics ? ['LYRICS'] : []),
    ...(meta.cover ? ['METADATA_BLOCK_PICTURE (封面)'] : [])
  ];
}

let ffmpegPathResolved;

async function resolveFfmpeg() {
  if (ffmpegPathResolved !== undefined) return ffmpegPathResolved;
  const candidates = [process.env.FFMPEG_PATH, 'ffmpeg'].filter(Boolean);
  for (const bin of candidates) {
    try {
      await execFileAsync(bin, ['-version'], { timeout: 8000 });
      ffmpegPathResolved = bin;
      return bin;
    } catch {
      // 试下一个
    }
  }
  ffmpegPathResolved = null;
  return null;
}

/** m4a 等 MP4 容器：用 ffmpeg 转封装写出标签（不改音频码流）。 */
async function writeFfmpegTags(file, meta) {
  const ffmpeg = await resolveFfmpeg();
  if (!ffmpeg) return null;

  const dir = path.dirname(file);
  const stamp = `${Date.now()}`;
  const coverPath = meta.cover
    ? path.join(dir, `.cover-${stamp}.${meta.cover.mime === 'image/png' ? 'png' : 'jpg'}`)
    : null;
  const tempOut = path.join(dir, `.tagged-${stamp}.m4a`);

  try {
    if (coverPath) await fsp.writeFile(coverPath, meta.cover.buffer);
    const args = ['-y', '-v', 'error', '-i', file];
    if (coverPath) args.push('-i', coverPath);
    args.push('-map', '0:a');
    if (coverPath) {
      args.push('-map', '1:v', '-c:v', 'copy', '-disposition:v', 'attached_pic');
    }
    args.push('-c:a', 'copy');
    args.push('-metadata', `title=${meta.title}`, '-metadata', `artist=${meta.artist}`);
    args.push('-metadata', `album=${meta.album}`, '-metadata', `album_artist=${meta.artist}`);
    if (meta.track) args.push('-metadata', `track=${meta.track}`);
    if (meta.year) args.push('-metadata', `date=${meta.year}`);
    if (meta.lyrics) args.push('-metadata', `lyrics=${meta.lyrics}`);
    args.push(tempOut);

    await execFileAsync(ffmpeg, args, { timeout: 120000, maxBuffer: 8 * 1024 * 1024 });
    const verified = await verifyTags(tempOut);
    if (!verified?.title) {
      await fsp.rm(tempOut, { force: true });
      return null;
    }
    await fsp.copyFile(tempOut, file);
    return [
      'TITLE',
      'ARTIST',
      'ALBUM',
      'ALBUMARTIST',
      ...(meta.track ? ['TRACKNUMBER'] : []),
      ...(meta.year ? ['DATE'] : []),
      ...(meta.lyrics ? ['LYRICS (©lyr)'] : []),
      ...(meta.cover ? ['COVER (attached_pic)'] : [])
    ];
  } catch {
    return null;
  } finally {
    await fsp.rm(tempOut, { force: true });
    if (coverPath) await fsp.rm(coverPath, { force: true });
  }
}

async function verifyTags(file) {
  try {
    const metadata = await parseFile(file, { duration: false });
    const common = metadata.common || {};
    // music-metadata 会按 "/" 把 TPE1 拆成多帧，取全部帧拼接才能反映真正写入的值
    const nativeFrames = Object.values(metadata.native || {}).flat();
    const frameText = (frame) => {
      const value = frame.value;
      if (typeof value === 'string') return value;
      if (value && typeof value === 'object' && 'text' in value) return String(value.text);
      return String(value ?? '');
    };
    const rawText = (id, fallback = '') => {
      const values = nativeFrames.filter((entry) => entry.id === id).map(frameText).filter(Boolean);
      return values.length ? values.join(' / ') : fallback;
    };
    return {
      format: metadata.format?.container || metadata.format?.codec || '',
      bitrate: metadata.format?.bitrate || 0,
      title: common.title || '',
      artist: rawText('TPE1', common.artist || ''),
      albumArtist: rawText('TPE2'),
      album: common.album || '',
      track: common.track?.no || null,
      year: common.year || null,
      hasCover: Boolean(common.picture?.length),
      lyricLines: (common.lyrics || []).reduce(
        (count, entry) => count + String(entry.text || '').split('\n').length,
        0
      )
    };
  } catch {
    return null;
  }
}

// ==================== 交互与主流程 ====================

function parseArgs(argv) {
  const options = {
    keyword: '',
    id: '',
    index: 0,
    limit: 15,
    level: 'exhigh',
    out: path.join(process.cwd(), 'downloads'),
    enhanced: false,
    json: false,
    lrclib: true,
    cloud: true
  };
  const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[++i];
    if (arg === '--id') options.id = String(next() || '').trim();
    else if (arg === '--index') options.index = Number.parseInt(next(), 10) || 0;
    else if (arg === '--limit') options.limit = Math.max(1, Number.parseInt(next(), 10) || 15);
    else if (arg === '--level') {
      const level = String(next() || '').trim();
      if (!LEVELS.includes(level)) throw new Error(`--level 只支持 ${LEVELS.join(' / ')}`);
      options.level = level;
    } else if (arg === '--out') options.out = path.resolve(String(next() || 'downloads'));
    else if (arg === '--enhanced') options.enhanced = true;
    else if (arg === '--no-lrclib') options.lrclib = false;
    else if (arg === '--no-cloud') options.cloud = false;
    else if (arg === '--json') options.json = true;
    else if (arg === '-h' || arg === '--help') options.help = true;
    else if (!arg.startsWith('--')) rest.push(arg);
  }
  options.keyword = rest.join(' ').trim();
  return options;
}

function printHelp() {
  console.log(`Zephyrus 单曲下载器

用法：
  node scripts/fetch-song.mjs "歌名" [--index n] [--level lossless] [--out 目录] [--enhanced] [--no-lrclib] [--no-cloud] [--json]
  node scripts/fetch-song.mjs --id 3339553801
  node scripts/fetch-song.mjs --id server:banned_001

搜索同时覆盖网易云与 Zephyrus 云端曲库（songs.json），结果合并后按相关度排序（同分交替），云端命中标 [云]。
歌词优先级：云端曲目 → 自有 TTML → AMLL TTML → 网易云 YRC → QQ QRC → 网易云 LRC → LRCLIB

参数：
  --index <n>    直接选第 n 条（合并后的序号）
  --limit <n>    网易云候选数，默认 15（云端最多再补 10 条）
  --level <音质> lossless | exhigh | higher | standard，默认 exhigh
  --out <dir>    输出目录，默认 ./downloads
  --enhanced     歌词写逐字增强 LRC
  --no-cloud     只搜网易云
  --no-lrclib    关闭 LRCLIB 兜底
  --json         输出机器可读摘要
`);
}

function printCandidates(list) {
  console.log(`\n找到 ${list.length} 首候选：`);
  list.forEach((item, index) => {
    const badges = [];
    if (item.kind === 'server') badges.push('云');
    if (item.fee === 1 || item.fee === 4) badges.push('VIP');
    const suffix = badges.length ? ` [${badges.join('/')}]` : '';
    console.log(
      `  ${String(index + 1).padStart(2, '0')}. ${item.name} — ${item.artists.join('/') || '未知'}` +
        `  ·  ${item.album || '未知专辑'}  ·  ${formatDuration(item.duration)}${suffix}`
    );
  });
}

/**
 * 统一输入：TTY 下走 readline；管道/重定向时预先缓冲全部行，便于脚本化调用。
 */
function createPromptSession() {
  const interactive = Boolean(process.stdin.isTTY);
  const rl = interactive
    ? readline.createInterface({ input: process.stdin, output: process.stdout })
    : null;
  const buffered = [];
  let bufferedPromise = null;

  const loadBuffered = () => {
    if (!bufferedPromise) {
      bufferedPromise = (async () => {
        const chunks = [];
        for await (const chunk of process.stdin) chunks.push(chunk);
        buffered.push(...Buffer.concat(chunks).toString('utf8').split(/\r?\n/));
      })();
    }
    return bufferedPromise;
  };

  return {
    interactive,
    async ask(question) {
      if (rl) return rl.question(question);
      process.stdout.write(question);
      await loadBuffered();
      const value = buffered.shift();
      process.stdout.write('\n');
      return value === undefined ? null : value;
    },
    close() {
      rl?.close();
    }
  };
}

async function pickInteractively(list, ask) {
  while (true) {
    const answer = String((await ask(`选择编号 1-${list.length}（q 退出）：`)) ?? '').trim();
    if (!answer) return null;
    if (/^q$/i.test(answer)) return null;
    const index = Number.parseInt(answer, 10);
    if (Number.isInteger(index) && index >= 1 && index <= list.length) return list[index - 1];
    if (/^\d+$/.test(answer) && index > list.length) {
      const again = String((await ask(`只有 ${list.length} 条，是否重新搜索？(y/n) `)) ?? '').trim();
      if (/^y/i.test(again)) return 'retry';
      continue;
    }
    console.log('  请输入列表中的编号。');
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  if (options.json) {
    silentOutput = true;
    console.log = () => {};
  }

  await fsp.mkdir(options.out, { recursive: true });
  const prompts = createPromptSession();

  try {
    let keyword = options.keyword;
    let selected = null;

    if (options.id) {
      const rawId = options.id;
      const serverId = rawId.replace(/^server:/i, '');
      const cloudHit = options.cloud
        ? (await loadCloudSongs()).find((item) => item.id === serverId)
        : null;
      if (cloudHit) {
        selected = cloudHit;
        console.log(`指定云端曲目：${cloudHit.name} — ${cloudHit.artists.join('/')}`);
      } else {
        const detail = await getSongDetail(rawId);
        if (!detail) throw new Error(`未找到 id 为 ${rawId} 的歌曲`);
        selected = { ...detail, kind: 'netease' };
        console.log(`指定歌曲：${detail.name} — ${detail.artists.join('/')}`);
      }
    } else {
      while (!selected) {
        if (!keyword) {
          keyword = String((await prompts.ask('歌名（或「歌名 歌手」）：')) ?? '').trim();
          if (!keyword) {
            if (!prompts.interactive) {
              console.log('未输入歌名，退出。');
              return;
            }
            continue;
          }
        }
        const list = await searchAllSongs(keyword, {
          limit: options.limit,
          cloud: options.cloud
        });
        if (list.length === 0) {
          console.log(`未搜索到「${keyword}」相关歌曲。`);
          keyword = '';
          continue;
        }
        printCandidates(list);

        let choice;
        if (options.index) {
          if (options.index < 1 || options.index > list.length) {
            throw new Error(`--index ${options.index} 超出候选范围 1-${list.length}`);
          }
          choice = list[options.index - 1];
        } else {
          choice = await pickInteractively(list, prompts.ask);
        }
        if (choice === null) {
          console.log('已取消。');
          return;
        }
        if (choice === 'retry') {
          keyword = '';
          continue;
        }
        selected = choice;
      }
    }

    let song;
    if (selected.kind === 'server') {
      song = { ...selected };
    } else {
      const detail = await getSongDetail(selected.id).catch(() => null);
      song = {
        ...selected,
        ...(detail || {}),
        kind: 'netease',
        artists: detail?.artists?.length ? detail.artists : selected.artists,
        album: detail?.album || selected.album,
        cover: detail?.cover || selected.cover,
        duration: detail?.duration || selected.duration
      };
    }

    console.log(`\n已选择：${song.name} — ${song.artists.join('/')}  ·  ${song.album || '未知专辑'}`);

    let audio;
    if (song.kind === 'server') {
      if (!song.audioUrl) throw new Error('云端曲目缺少 audioUrl');
      audio = { url: song.audioUrl, type: '', level: '云端直链', br: 0, requestedLevel: '云端直链' };
      console.log('  音质：云端直链');
    } else {
      console.log('  解析音频地址…');
      audio = await resolveAudioUrl(song, options.level);
      const downgraded =
        audio.level !== audio.requestedLevel
          ? `（请求 ${audio.requestedLevel}，实际 ${audio.level}）`
          : '';
      console.log(`  音质：${audio.level}${audio.br ? ` · ${Math.round(audio.br / 1000)} kbps` : ''}${downgraded}`);
    }

    const base = sanitizeFilename(`${song.name} - ${song.artists.join(',') || '未知艺术家'}`);
    const tempBase = path.join(options.out, `${base}.tmp`);
    const { tmp, bytes, contentType } = await downloadAudio(audio.url, tempBase);

    const format = (await sniffFormat(tmp, contentType || audio.type)) || audio.type || 'mp3';
    let finalPath = path.join(options.out, `${base}.${format}`);
    let counter = 1;
    while (fs.existsSync(finalPath)) {
      finalPath = path.join(options.out, `${base} (${counter}).${format}`);
      counter += 1;
    }
    await fsp.rename(tmp, finalPath);
    const stat = await fsp.stat(finalPath);
    console.log(`  文件：${finalPath}  (${formatBytes(stat.size)})`);

    console.log('  匹配歌词…');
    const lyric = await resolveLyrics(song, { lrclib: options.lrclib });
    let lyricText = '';
    if (lyric) {
      lyricText = toLrc(song, lyric, { enhanced: options.enhanced });
      const wordNote = lyric.wordTimed ? (options.enhanced ? '逐字增强 LRC' : '逐字源→行级 LRC') : '行级 LRC';
      console.log(`  歌词：${lyric.source} · ${lyric.lines.length} 行 · ${wordNote}`);
    } else {
      console.log('  歌词：未找到可用歌词，仅写入音频与封面');
    }

    console.log('  下载封面…');
    const cover = await fetchCover(song.cover);
    if (cover) console.log(`  封面：${formatBytes(cover.buffer.length)} ${cover.mime}`);

    const artistText = song.artists.join('、') || '未知艺术家';
    const meta = {
      title: song.name,
      artist: artistText,
      album: song.album || song.name,
      albumArtist: artistText,
      track: song.track,
      year:
        song.kind === 'server'
          ? Number.parseInt(song.year, 10) || undefined
          : song.publishTime
            ? new Date(song.publishTime).getFullYear()
            : undefined,
      lyrics: lyricText,
      cover
    };

    let written = [];
    let writeFailure = '';
    try {
      if (format === 'mp3') written = await writeMp3Tags(finalPath, meta);
      else if (format === 'flac') written = await writeFlacTagsFile(finalPath, meta);
      else if (format === 'm4a') {
        written = (await writeFfmpegTags(finalPath, meta)) || [];
        if (written.length === 0) writeFailure = 'm4a 标签需要 ffmpeg（可设置 FFMPEG_PATH 指定）';
      } else {
        writeFailure = `${format.toUpperCase()} 容器不支持可靠的内嵌标签`;
      }
    } catch (error) {
      written = [];
      writeFailure = `标签写入失败：${error.message}`;
    }
    if (written.length === 0 && !writeFailure) writeFailure = '标签写入未生效';

    // 写不进标签时，把「本该写进元数据」的全部内容导出到旁挂文件并完整回显
    let payload = null;
    const sidecars = [];
    if (written.length === 0) {
      payload = {
        title: meta.title,
        artist: meta.artist,
        album: meta.album,
        albumArtist: meta.albumArtist,
        trackNumber: meta.track ?? null,
        year: meta.year ?? null,
        duration: song.duration || null,
        lyrics: meta.lyrics || '',
        cover: null,
        platform: song.kind === 'server' ? 'server' : 'netease',
        id: song.id,
        lyricSource: lyric?.source || null,
        lyricUrl: lyric?.detail || null
      };
      if (lyricText) {
        const lrcPath = finalPath.replace(/\.[^.]+$/, '.lrc');
        await fsp.writeFile(lrcPath, lyricText, 'utf8');
        sidecars.push(lrcPath);
        payload.lyricsPath = lrcPath;
      }
      if (cover) {
        const coverPath = finalPath.replace(
          /\.[^.]+$/,
          `.cover.${cover.mime === 'image/png' ? 'png' : 'jpg'}`
        );
        await fsp.writeFile(coverPath, cover.buffer);
        sidecars.push(coverPath);
        payload.cover = { mime: cover.mime, bytes: cover.buffer.length, path: coverPath };
      }
      const payloadPath = finalPath.replace(/\.[^.]+$/, '.metadata.json');
      await fsp.writeFile(payloadPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
      sidecars.push(payloadPath);
      payload.payloadPath = payloadPath;

      const label = (text) => `    ${text.padEnd(12)}`;
      console.log(`\n  未写入标签：${writeFailure}`);
      console.log('  以下为应写入元数据的全部内容：');
      console.log(`${label('TITLE')}${payload.title}`);
      console.log(`${label('ARTIST')}${payload.artist}`);
      console.log(`${label('ALBUM')}${payload.album}`);
      console.log(`${label('ALBUMARTIST')}${payload.albumArtist}`);
      console.log(`${label('TRACKNUMBER')}${payload.trackNumber ?? '—'}`);
      console.log(`${label('DATE')}${payload.year ?? '—'}`);
      console.log(`${label('DURATION')}${formatDuration(payload.duration || 0)}`);
      if (payload.cover) {
        console.log(
          `${label('COVER')}${payload.cover.mime} · ${formatBytes(payload.cover.bytes)} → ${payload.cover.path}`
        );
      }
      if (payload.lyrics) {
        const lyricLines = payload.lyrics.trimEnd().split('\n');
        console.log(`${label('LYRICS')}${lyricLines.length} 行 → ${payload.lyricsPath}`);
        for (const line of lyricLines) console.log(`      ${line}`);
      } else {
        console.log(`${label('LYRICS')}（无）`);
      }
      console.log(`${label('全量数据')}${payload.payloadPath}`);
    }

    const verified = await verifyTags(finalPath);

    if (options.json) {
      rawLog(
        JSON.stringify(
          {
            path: finalPath,
            platform: song.kind === 'server' ? 'server' : 'netease',
            id: song.id,
            format,
            bytes: stat.size,
            quality: { level: audio.level, br: audio.br },
            lyrics: lyric
              ? { source: lyric.source, detail: lyric.detail, lines: lyric.lines.length, wordTimed: lyric.wordTimed }
              : null,
            cover: cover ? { mime: cover.mime, bytes: cover.buffer.length } : null,
            metadata: written,
            metadataWritten: written.length > 0,
            ...(payload
              ? { metadataFailure: writeFailure, metadataPayload: payload, sidecars }
              : {}),
            verified
          },
          null,
          2
        )
      );
      return;
    }

    console.log('\n✔ 完成');
    console.log(`  路径      ${finalPath}`);
    console.log(
      `  音频      ${format.toUpperCase()} · ${formatBytes(stat.size)}${verified?.bitrate ? ` · ${Math.round(verified.bitrate / 1000)} kbps` : ''}`
    );
    if (lyric) {
      console.log(`  歌词来源  ${lyric.source}`);
      console.log(`  歌词明细  ${lyric.detail}`);
      console.log(`  歌词行数  ${lyric.lines.length}${lyric.wordTimed ? '（原始逐字）' : ''}`);
    }
    console.log(`  元数据    ${written.length > 0 ? `${written.length} 项` : '0 项（未写入，全量数据见上）'}`);
    for (const field of written) console.log(`            · ${field}`);
    if (verified && written.length > 0) {
      console.log(
        `  写回校验  title="${verified.title}" artist="${verified.artist}"` +
          `${verified.albumArtist ? ` albumArtist="${verified.albumArtist}"` : ''} album="${verified.album}"` +
          ` 封面=${verified.hasCover ? '有' : '无'} 歌词行=${verified.lyricLines}`
      );
    }
  } finally {
    prompts.close();
  }
}

const isDirectRun =
  process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url;

if (isDirectRun) {
  main().catch((error) => {
    console.error(`\n✖ ${error.message}`);
    if (process.env.DEBUG) console.error(error);
    process.exitCode = 1;
  });
}

export {
  fetchCover,
  fetchQqQrc,
  fetchServerLyric,
  loadCloudSongs,
  parseNeteaseLrcPayload,
  parsePlainLrc,
  parseRichJsonLrc,
  parseTtml,
  parseWordTimedLyric,
  resolveLyrics,
  searchAllSongs,
  searchCloudSongs,
  searchSongs,
  toLrc,
  writeFfmpegTags,
  writeFlacTagsFile,
  writeMp3Tags
};
