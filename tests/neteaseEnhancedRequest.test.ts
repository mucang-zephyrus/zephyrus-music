import { type AxiosAdapter, AxiosError } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/renderer/utils/index', () => ({ isMobile: { value: false } }));
vi.mock('../src/renderer/store/modules/user', () => ({
  useUserStore: () => ({ handleLogout: vi.fn() })
}));
vi.mock('../src/renderer/api/gatewayBase', () => ({ gatewayBaseURL: 'https://gateway.example/api' }));

const enhanced = 'https://gateway.example/api/netease-enhanced';
const success: AxiosAdapter = async (config) => ({
  status: 200, statusText: 'OK', headers: {}, data: { code: 200 }, config
});

describe('NetEase Enhanced request client', () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => {
    localStorage.clear();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('uses Enhanced for search, lyrics and playback even with a retired preference', async () => {
    localStorage.setItem('appSettings', '{"neteaseRequestMode":"alger"}');
    const token = 'MUSIC_U=mock-only; __csrf=mock-csrf';
    localStorage.setItem('token', token);
    const request = (await import('../src/renderer/utils/request')).default;
    const adapter = vi.fn(success);
    await request.get('/cloudsearch', { params: { keywords: '北平' }, adapter });
    await request.get('/lyric/new', { params: { id: 347230 }, adapter });
    await request.get('/song/url/v1', { params: { id: 347230 }, adapter });
    await request.get('/login/qr/key', { params: { noCookie: true }, withCredentials: false, adapter });
    const results = adapter.mock.calls.map(([config]) => config);
    expect(results.map((config) => config.baseURL)).toEqual(Array(4).fill(enhanced));
    expect(results[0].params).toMatchObject({ keywords: '北平', cookie: token, device: 'web' });
    expect(results[1].params.randomCNIP).toBeUndefined();
    expect(results[2].params).toMatchObject({ id: 347230, randomCNIP: true, cookie: token });
    expect(results[3].params.cookie).toBeUndefined();
    expect(results[3].withCredentials).toBe(false);
  });

  it('retries against the same Enhanced endpoint', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const request = (await import('../src/renderer/utils/request')).default;
    const adapter = vi.fn(success).mockImplementationOnce(async (config) => {
      throw new AxiosError('mock transient failure', 'ERR_NETWORK', config);
    });
    const result = request.get('/song/url/v1', { adapter });
    await vi.runAllTimersAsync();
    expect((await result).data.code).toBe(200);
    expect(adapter.mock.calls.map(([config]) => config.baseURL)).toEqual([enhanced, enhanced]);
    expect(adapter.mock.calls[1][0].params.randomCNIP).toBe(true);
  });
});
