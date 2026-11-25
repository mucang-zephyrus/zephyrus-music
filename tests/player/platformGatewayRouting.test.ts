// @vitest-environment-options { "url": "https://www.mucang.xyz/" }
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('published Web account requests', () => {
  it.each([
    ['1.4.3-test2', 19, '/preview/', '/api-test/', true],
    ['1.4.3-test2', 19, '/zephyrus/webtest/', '/api-test/', true],
    ['1.4.3', 0, '/zephyrus/web/', '/api/', false]
  ] as const)(
    '%s at %s %s routes both platforms',
    async (version, code, path, gateway, isolated) => {
      vi.resetModules();
      vi.stubGlobal('__APP_VERSION__', version);
      vi.stubGlobal('__TEST_VERSION_CODE__', code);
      window.history.replaceState({}, '', path);
      const { default: axios } = await import('axios');
      const paths: string[] = [];
      const original = axios.defaults.adapter;
      axios.defaults.adapter = async (config) => {
        const url = new URL(axios.getUri(config));
        paths.push(url.origin + url.pathname);
        const data = config.url?.endsWith('/login/status')
          ? { code: 200, data: { profile: { musicid: 42 } } }
          : config.url?.endsWith('/user/playlist')
            ? { code: 200, playlist: [] }
            : { code: 200, data: {} };
        return { config, data, status: 200, statusText: 'OK', headers: {} };
      };
      try {
        const api = await import('@/api/platformQrApi');
        const { platformAccountStorageKey } = await import('@/utils/appVersion');
        await api.fetchPlatformAccountData('qq', 'qqmusic_session=fixture');
        await api.fetchPlatformAccountData('kugou', 'fixture');
        expect(paths).toEqual(
          ['qq/api/login/status', 'qq/api/user/playlist', 'kugou/account/data'].map(
            (route) =>
              `https://${isolated ? 'www.' : ''}mucang.xyz/zephyrus${gateway}platform/${route}`
          )
        );
        expect(platformAccountStorageKey('cookie', 'qq').startsWith('webtest:')).toBe(isolated);
      } finally {
        axios.defaults.adapter = original;
        window.history.replaceState({}, '', '/');
      }
    }
  );
});
