import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createPlatformQr,
  fetchPlatformAccountData,
  fetchPlatformPlaylistTracks,
  getQqApiChannels,
  pollPlatformQr
} from '@/api/platformQrApi';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('axios', () => ({ default: { create: () => ({ get }) } }));

const qqApi = '/platform/qq/api';
const kugouApi = '/platform/kugou/api';
const channels = ['qq', 'wechat', 'qqmusic'];

beforeEach(async () => {
  get.mockReset();
  get.mockResolvedValueOnce({ data: { code: 200, data: { channels } } });
  await getQqApiChannels(true);
  get.mockClear();
});

describe('QQ QR login', () => {
  it.each([
    ['123', { tid: '123' }],
    ['dir:201', { dirid: '201' }]
  ] as const)('reads session playlist %s across pages', async (id, key) => {
    const song = {
      mid: 'first',
      name: 'Track',
      interval: 3,
      album: { mid: 'ab', name: 'Album' },
      singer: [{ mid: 'ar', name: 'Artist' }]
    };
    get.mockResolvedValueOnce({ data: { code: 200, songs: [song], more: true } });
    get.mockResolvedValueOnce({
      data: { code: 200, songs: [{ ...song, mid: 'second' }], more: false }
    });
    const cookie = 'qqmusic_session=fixture';
    const detail = await fetchPlatformPlaylistTracks('qq', cookie, id);
    expect(detail.songs).toMatchObject([
      { id: 'qq:first', dt: 3000, ar: [{ name: 'Artist' }] },
      { platformId: 'second' }
    ]);
    for (const offset of [0, 1])
      expect(get).toHaveBeenNthCalledWith(
        offset + 1,
        `${qqApi}/user/playlist-detail`,
        expect.objectContaining({
          headers: { 'X-Platform-Cookie': cookie },
          params: { ...key, offset, limit: 100 }
        })
      );
  });
  it.each(['qq', 'wechat', 'qqmusic'] as const)(
    'creates and polls the %s channel',
    async (channel) => {
      get.mockResolvedValueOnce({ data: { code: 200, data: { unikey: 'qr-key' } } });
      get.mockResolvedValueOnce({
        data: { code: 200, data: { qrimg: 'data:image/png;base64,qr' } }
      });
      const qr = await createPlatformQr('qq', channel);
      expect(get).toHaveBeenNthCalledWith(1, `${qqApi}/login/qr/key`, {
        params: { channel, noCache: expect.any(Number) },
        timeout: 10000
      });
      expect(get).toHaveBeenNthCalledWith(
        2,
        `${qqApi}/login/qr/create`,
        expect.objectContaining({
          params: expect.objectContaining({ key: 'qr-key' })
        })
      );
      expect(qr).toMatchObject({ provider: channel, transport: 'qq-api' });

      for (const [code, status] of [
        [801, 'waiting'],
        [802, 'scanned']
      ] as const) {
        get.mockResolvedValueOnce({ data: { code } });
        await expect(pollPlatformQr(qr)).resolves.toMatchObject({
          provider: channel,
          code: status
        });
      }
      get.mockResolvedValueOnce({ data: { code: 803, cookie: 'qqmusic_session=test-token' } });
      get.mockResolvedValueOnce({ data: { code: 200, data: { profile: { musicid: '1234' } } } });
      await expect(pollPlatformQr(qr)).resolves.toMatchObject({
        provider: channel,
        code: 'success',
        cookie: 'qqmusic_session=test-token',
        userInfo: { userId: '1234' }
      });
      expect(get).toHaveBeenNthCalledWith(
        5,
        `${qqApi}/login/qr/check`,
        expect.objectContaining({
          params: expect.objectContaining({ key: 'qr-key' })
        })
      );
      expect(get).toHaveBeenLastCalledWith(`${qqApi}/login/status`, {
        headers: { 'X-Platform-Cookie': 'qqmusic_session=test-token' },
        timeout: 5000
      });
    }
  );

  it('retains the confirmed session if the profile is initially unavailable', async () => {
    get.mockResolvedValueOnce({ data: { code: 803, cookie: 'qqmusic_session=test-token' } });
    get.mockRejectedValueOnce({ code: 'ECONNABORTED' });
    await expect(
      pollPlatformQr({
        platform: 'qq',
        transport: 'qq-api',
        provider: 'qqmusic',
        key: 'key',
        qrUrl: 'image',
        expiredAt: 0
      })
    ).resolves.toMatchObject({ code: 'success', cookie: 'qqmusic_session=test-token' });
  });

  it.each([
    [{ code: 800, message: 'QR code expired' }, 'expired', '二维码已过期'],
    [{ code: 800, message: 'QR login failed' }, 'error', '登录失败'],
    [{ code: 800, upstreamCode: 20279 }, 'error', '设备管理'],
    [{ code: 800, data: { retryAfterMs: 4500 } }, 'error', '5 秒'],
    [{ code: 803 }, 'error', '未收到登录凭据']
  ])('maps upstream response %j to %s', async (data, code, message) => {
    get.mockResolvedValueOnce({ data });
    const result = await pollPlatformQr({
      platform: 'qq',
      transport: 'qq-api',
      provider: 'qqmusic',
      key: 'key',
      qrUrl: 'image',
      expiredAt: 0
    });
    expect(result.code).toBe(code);
    expect(result.message).toContain(message);
  });

  it('distinguishes unavailable QR sessions from missing routes', async () => {
    get.mockResolvedValueOnce({ data: { code: 200, data: { unikey: 'qr-key' } } });
    get.mockRejectedValueOnce({
      response: { status: 404, data: { message: 'QR session not found or expired' } }
    });
    await expect(createPlatformQr('qq', 'qqmusic')).rejects.toThrow('二维码会话已不可用');
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('loads the nested login profile and reads playlists without using the display ID', async () => {
    get.mockResolvedValueOnce({
      data: {
        code: 200,
        data: {
          profile: {
            musicid: 0,
            info: { str_musicid: '1234', logo: 'https://example.com/avatar.png' }
          }
        }
      }
    });
    get.mockResolvedValueOnce({ data: { code: 200, playlist: [{ dissid: 1, dissname: '歌单' }] } });
    await expect(
      fetchPlatformAccountData('qq', 'qqmusic_session=test-token')
    ).resolves.toMatchObject({
      userInfo: { userId: '1234', nickname: '', avatarUrl: 'https://example.com/avatar.png' },
      playlists: [{ id: '1', name: '歌单' }]
    });
    expect(get).toHaveBeenLastCalledWith(`${qqApi}/user/playlist`, {
      headers: { 'X-Platform-Cookie': 'qqmusic_session=test-token' },
      timeout: 20000
    });
  });

  it('reports an unrecognized session instead of empty account data', async () => {
    get.mockResolvedValueOnce({ data: { code: 200, data: {} } });
    get.mockRejectedValueOnce({ response: { status: 401 } });
    await expect(fetchPlatformAccountData('qq', 'qqmusic_session=test-token')).rejects.toThrow(
      '重新扫码'
    );
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('keeps owned and saved playlists when QQ supplies no usable profile fields', async () => {
    get.mockResolvedValueOnce({ data: { code: 200, data: { profile: { info: {} } } } });
    get.mockResolvedValueOnce({
      data: {
        code: 200,
        playlist: [
          { tid: '123', dirName: '自建', dirShow: 2, songNum: 3, bigpicUrl: 'cover' },
          { tid: '456', name: '收藏', dirShow: 1, orderTime: 5 }
        ]
      }
    });
    await expect(
      fetchPlatformAccountData('qq', 'qqmusic_session=test-token')
    ).resolves.toMatchObject({
      userInfo: undefined,
      profileError: expect.any(String),
      playlistError: undefined,
      playlists: [
        { id: '123', name: '自建', trackCount: 3, coverImgUrl: 'cover' },
        { id: '456', name: '收藏' }
      ],
      favorites: [{ id: '456' }]
    });
  });

  it('keeps the profile and signals playlist errors without passing them off as an empty list', async () => {
    get.mockResolvedValueOnce({
      data: { code: 200, data: { profile: { musicid: '1234', nick: '用户' } } }
    });
    get.mockRejectedValueOnce({ response: { status: 502 } });
    await expect(
      fetchPlatformAccountData('qq', 'qqmusic_session=test-token')
    ).resolves.toMatchObject({
      userInfo: { userId: '1234', nickname: '用户' },
      playlistError: expect.any(String)
    });
  });
});

describe('Kugou QR login', () => {
  it('uses the only generated key and polls the same API', async () => {
    get.mockResolvedValueOnce({ data: { code: 200, data: { qrcode: 'kugou-key' } } });
    const qr = await createPlatformQr('kugou');
    expect(get).toHaveBeenCalledTimes(1);
    expect(qr.transport).toBe('kugou-api');
    expect(qr.qrUrl).toContain('qrcode=kugou-key');
    get.mockResolvedValueOnce({ data: { code: 200, data: { status: 'scanned' } } });
    await expect(pollPlatformQr(qr)).resolves.toMatchObject({ code: 'scanned' });
    expect(get.mock.calls.map(([path]) => path)).toEqual([
      `${kugouApi}/login/qr/key`,
      `${kugouApi}/login/qr/check`
    ]);
  });

  it('only falls back on a missing key route and keeps that route for polling', async () => {
    get.mockRejectedValueOnce({ response: { status: 404 } });
    get.mockResolvedValueOnce({ data: { code: 200, data: { qrUrl: 'img', key: 'legacy-key' } } });
    const qr = await createPlatformQr('kugou');
    expect(qr.transport).toBe('legacy');
    get.mockResolvedValueOnce({ data: { code: 200, data: { status: 'waiting' } } });
    await pollPlatformQr(qr);
    expect(get.mock.calls.map(([path]) => path)).toEqual([
      `${kugouApi}/login/qr/key`,
      '/platform/kugou/qr/create',
      '/platform/kugou/qr/poll'
    ]);
  });

  it('does not switch to legacy when generating a key fails upstream', async () => {
    get.mockRejectedValueOnce({ response: { status: 502, data: { msg: '酷狗暂时不可用' } } });
    await expect(createPlatformQr('kugou')).rejects.toThrow('酷狗暂时不可用');
    expect(get).toHaveBeenCalledTimes(1);
  });
});
