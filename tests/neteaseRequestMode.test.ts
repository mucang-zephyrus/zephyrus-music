import { type AxiosAdapter, AxiosError } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { normalizeNeteaseRequestMode, resolveNeteaseRequestBase } from '../src/renderer/utils/neteaseRequestMode';

const state = vi.hoisted(() => ({ settings: {} as Record<string, unknown> }));
vi.mock('../src/renderer/utils/index', () => ({
  getSetData: () => state.settings,
  isElectron: false,
  isMobile: { value: false }
}));
vi.mock('../src/renderer/store/modules/user', () => ({
  useUserStore: () => ({ handleLogout: vi.fn() })
}));
vi.mock('../src/renderer/api/gatewayBase', () => ({ gatewayBaseURL: 'https://gateway.example/api' }));

describe('NetEase backend selection', () => {
  beforeEach(() => {
    vi.resetModules();
    state.settings = {};
    localStorage.clear();
  });
  afterEach(() => vi.restoreAllMocks());

  it('keeps existing and invalid preferences on the original backend', () => {
    for (const value of [undefined, null, 'alger', 'unknown', true]) {
      expect(normalizeNeteaseRequestMode(value)).toBe('alger');
    }
    expect(resolveNeteaseRequestBase('http://127.0.0.1:30488', 'https://gateway.example/api/', 'alger')).toBe('http://127.0.0.1:30488');
    expect(resolveNeteaseRequestBase('http://127.0.0.1:30488', 'https://gateway.example/api/', 'enhanced')).toBe('https://gateway.example/api/netease-enhanced');
  });

  it('uses the saved mode, preserves credentials, and switches back on the next request', async () => {
    state.settings = JSON.parse('{"neteaseRequestMode":"enhanced"}');
    localStorage.setItem('token', 'MUSIC_U=mock-only; __csrf=mock-csrf');
    const request = (await import('../src/renderer/utils/request')).default;
    const records: any[] = [];
    const adapter: AxiosAdapter = async config => {
      records.push(config);
      return { status: 200, statusText: 'OK', headers: {}, data: { code: 200 }, config };
    };
    await request.get('/song/url/v1', { params: { id: 347230 }, adapter });
    expect(records[0].baseURL).toBe('https://gateway.example/api/netease-enhanced');
    expect(records[0].params).toMatchObject({ id: 347230, randomCNIP: true, cookie: localStorage.getItem('token') });
    await request.get('/login/qr/key', { params: { noCookie: true }, withCredentials: false, adapter });
    expect(records[1].params.cookie).toBeUndefined();
    expect(records[1].params.randomCNIP).toBeUndefined();
    expect(records[1].withCredentials).toBe(false);
    state.settings.neteaseRequestMode = 'alger';
    await request.get('/song/detail', { params: { ids: '347230' }, adapter });
    expect(records[2].baseURL).not.toContain('/netease-enhanced');
    expect(records[2].params.cookie).toBe(localStorage.getItem('token'));
  });

  it('pins an in-flight retry to its chosen backend', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    state.settings = { neteaseRequestMode: 'enhanced' };
    const request = (await import('../src/renderer/utils/request')).default;
    const bases: (string | undefined)[] = [];
    const adapter: AxiosAdapter = async config => {
      bases.push(config.baseURL);
      const response = { status: 200, statusText: 'OK', headers: {}, data: { code: 200 }, config };
      if (bases.length === 1) {
        state.settings.neteaseRequestMode = 'alger';
        throw new AxiosError('mock transient failure', 'ERR_NETWORK', config, undefined, response);
      }
      return response;
    };
    await request.get('/song/url/v1', { adapter });
    expect(bases).toEqual(['https://gateway.example/api/netease-enhanced', 'https://gateway.example/api/netease-enhanced']);
    await request.get('/song/detail', { adapter });
    expect(bases[2]).not.toContain('/netease-enhanced');
  });
});
