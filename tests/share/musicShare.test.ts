import { get } from 'node:http';
import { createRequire } from 'node:module';

import { describe, expect, it, vi } from 'vitest';

import {
  extractMusicShareUrls,
  musicSharePlatform,
  parseMusicShareUrl
} from '../../src/shared/musicShareLink.mjs';

const require = createRequire(import.meta.url);
const {
  assignmentJson,
  songFromPage,
  resolveMusicShare,
  createShareLinkRouter
} = require('../../server-share-link.js');
const hash = 'C0D1020729B5D7249648D9864FB8F844';
const kg = 'https://m.kugou.com/share/song.html?chain=CsmD6aG7V3';
const qq = 'https://c6.y.qq.com/base/fcgi-bin/u?__=Sm5jdCo0qBcJ';
const netease = 'https://163cn.tv/bku4CHzS';
const data = {
  song: {
    mid: '000kqpJn4G62Yv',
    name: 'Test } "; song',
    singer: [{ mid: 'artist', name: 'Artist' }],
    album: { mid: 'album', name: 'Album' },
    interval: 256
  }
};
const page = `window.__ssrFirstPageData__=${JSON.stringify(JSON.stringify(data))};`;

describe('share text and URL parser', () => {
  it('extracts supplied three-platform shares, markdown and punctuation without prose', () => {
    expect(
      extractMusicShareUrls(
        `分享野肆乐队Reckless Abandon的单曲《人民艺术家》${netease} (@网易云音乐)`
      )
    ).toEqual([netease]);
    expect(extractMusicShareUrls(`分享野肆乐队的单曲《人民艺术家》${kg} （@酷狗音乐）`)).toEqual([
      kg
    ]);
    expect(extractMusicShareUrls(`野肆乐队《人民艺术家》 ${qq} @QQ音乐`)).toEqual([qq]);
    expect(extractMusicShareUrls(`[song](${qq}), ${qq}。`)).toEqual([qq]);
  });
  it.each([
    ['https://music.163.com/#/song?id=3339553801', 'netease', '3339553801'],
    ['https://y.music.163.com/m/song?id=3339553801&userid=100', 'netease', '3339553801'],
    ['https://y.qq.com/n/ryqq/songDetail/000kqpJn4G62Yv', 'qq', '000kqpJn4G62Yv'],
    [
      'https://i2.y.qq.com/n3/other/pages/playsong/index.html?songmid=000kqpJn4G62Yv&media_mid=different',
      'qq',
      '000kqpJn4G62Yv'
    ],
    [`https://www.kugou.com/song/#hash=${hash}`, 'kugou', hash],
    ['zephyrus://song/123', 'netease', '123']
  ])('retains exact platform ID from %s', (url, platform, id) => {
    expect(parseMusicShareUrl(url)).toEqual({ kind: 'song', platform, id });
  });
  it.each([
    'https://music.163.com.evil.test/song?id=1',
    'https://evil.test/?url=https%3A%2F%2Fmusic.163.com',
    'https://user:password@y.qq.com/songDetail/abcdefgh',
    'file:///song?id=1',
    'https://m.kugou.com:1234/share/song.html',
    'https://music.163.com/user/home?id=1',
    'https://y.qq.com/n/ryqq/albumDetail/000kqpJn4G62Yv',
    'zephyrus://song/9007199254740993'
  ])('ignores unsupported clipboard content: %s', (url) => {
    expect(extractMusicShareUrls(url)).toEqual([]);
  });
  it('keeps collection and listen deep links', () => {
    expect(parseMusicShareUrl('zephyrus://playlist/5')?.kind).toBe('playlist');
    expect(parseMusicShareUrl('zephyrus://album/6')?.kind).toBe('album');
    expect(parseMusicShareUrl('zephyrus://listen/aBc123')).toEqual({
      kind: 'listen',
      id: 'ABC123'
    });
    expect(extractMusicShareUrls('x'.repeat(65537))).toEqual([]);
    expect(musicSharePlatform('https://127.0.0.1/song?id=1')).toBeNull();
  });
});

describe('share resolver', () => {
  it('parses embedded JSON including quoted braces, without evaluating scripts', () => {
    expect(assignmentJson(page, '__ssrFirstPageData__')).toEqual(data);
    expect(assignmentJson('var phpParam = (globalThis.compromised=true)', 'phpParam')).toBeNull();
    expect(songFromPage('qq', page)).toMatchObject({
      platform: 'qq',
      platformId: data.song.mid,
      name: data.song.name,
      dt: 256000
    });
  });
  it('uses Kugou embedded audio hash instead of outer transport variant; omits expiring audio URLs', () => {
    const html = `var phpParam=${JSON.stringify({ hash: '46E01D6292DE31F5B539027C5F567A63', song_info: { data: { hash, songName: 'Test', author_name: 'Artist', timeLength: 256, url: 'https://temporary-audio', album_img: 'http://imge.kugou.com/{size}/cover.jpg' } } })};`;
    const song = songFromPage('kugou', html);
    expect(song).toMatchObject({
      id: `kugou:${hash}`,
      platformId: hash,
      dt: 256000,
      picUrl: 'https://imge.kugou.com/400/cover.jpg'
    });
    expect(song).not.toHaveProperty('playMusicUrl');
    expect(JSON.stringify(song)).not.toContain('temporary-audio');
  });
  it('follows a relative multi-hop short link with bounded public-only requests', async () => {
    const get = vi
      .fn()
      .mockResolvedValueOnce({ status: 302, headers: { location: '/next' } })
      .mockResolvedValueOnce({
        status: 302,
        headers: { location: 'https://y.music.163.com/m/song?id=3339553801' }
      });
    expect(await resolveMusicShare(netease, get)).toEqual({
      target: { kind: 'song', platform: 'netease', id: '3339553801' }
    });
    expect(get).toHaveBeenCalledTimes(2);
    expect(get.mock.calls[0][1]).toMatchObject({ maxRedirects: 0, maxContentLength: 1048576 });
  });
  it('resolves supplied QQ short link through SSR and directly embedded Kugou JSON', async () => {
    const get = vi
      .fn()
      .mockResolvedValueOnce({
        status: 302,
        headers: {
          location: `https://i2.y.qq.com/n3/other/pages/playsong/index.html?songmid=${data.song.mid}`
        }
      })
      .mockResolvedValueOnce({ status: 200, data: page });
    expect((await resolveMusicShare(qq, get)).song.platformId).toBe(data.song.mid);
    expect(
      (
        await resolveMusicShare(kg, async () => ({
          status: 200,
          data: `var phpParam=${JSON.stringify({ song_info: { data: { hash, songName: 'Test' } } })};`
        }))
      ).song.platformId
    ).toBe(hash);
  });
  it.each([
    'http://127.0.0.1/private',
    'https://evil.test/x',
    'https://music.163.com@evil.test/x',
    'file:///etc/passwd',
    'https://y.qq.com/songDetail/000kqpJn4G62Yv'
  ])('rejects redirect outside original platform before fetching: %s', async (location) => {
    const get = vi.fn().mockResolvedValue({ status: 302, headers: { location } });
    await expect(resolveMusicShare(netease, get)).rejects.toThrow();
    expect(get).toHaveBeenCalledTimes(1);
  });
  it('rejects loops, HTTP errors, malformed pages and unsupported input', async () => {
    await expect(
      resolveMusicShare(netease, async () => ({ status: 302, headers: { location: netease } }))
    ).rejects.toThrow();
    await expect(resolveMusicShare(qq, async () => ({ status: 403 }))).rejects.toThrow();
    await expect(
      resolveMusicShare(kg, async () => ({ status: 200, data: '<script>untrusted()</script>' }))
    ).rejects.toThrow();
    const get = vi.fn();
    await expect(resolveMusicShare('http://localhost/private', get)).rejects.toThrow();
    expect(get).not.toHaveBeenCalled();
  });
  it('mounts a working resolver API without starting unrelated gateways', async () => {
    const express = require('express');
    const app = express();
    app.use('/platform/share', createShareLinkRouter());
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    try {
      const response = await new Promise<{ status: number | undefined; body: string }>(
        (resolve, reject) => {
          get(
            `http://127.0.0.1:${server.address().port}/platform/share/resolve?url=${encodeURIComponent('https://music.163.com/song?id=3339553801')}`,
            (res) => {
              let body = '';
              res.setEncoding('utf8');
              res.on('data', (chunk) => {
                body += chunk;
              });
              res.on('end', () => resolve({ status: res.statusCode, body }));
              res.on('error', reject);
            }
          ).on('error', reject);
        }
      );
      expect(response.status).toBe(200);
      expect(JSON.parse(response.body).data.target.id).toBe('3339553801');
    } finally {
      await new Promise<void>((resolve) => server.close(resolve));
    }
  });
});
