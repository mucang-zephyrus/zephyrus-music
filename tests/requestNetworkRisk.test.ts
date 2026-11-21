import { type AxiosAdapter,AxiosError } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { createDiscreteApi } = vi.hoisted(() => ({ createDiscreteApi: vi.fn() }));
vi.mock('naive-ui', () => ({ createDiscreteApi }));
vi.mock('../src/renderer/utils/index', () => ({
  getSetData: () => ({}),
  isMobile: { value: false }
}));
vi.mock('../src/renderer/store/modules/user', () => ({
  useUserStore: () => ({ handleLogout: vi.fn() })
}));

async function loadRequest() {
  return (await import('../src/renderer/utils/request')).default;
}

function adapterFor(code: number, status = 400): AxiosAdapter {
  return vi.fn(async (config) => {
    const response = { data: { code }, status, statusText: '', headers: {}, config };
    if (status >= 400)
      throw new AxiosError('rejected', 'ERR_BAD_REQUEST', config, undefined, response);
    return response;
  });
}

describe('NetEase risk response interceptor', () => {
  beforeEach(() => {
    vi.resetModules();
    createDiscreteApi.mockReset();
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.each([400, 200])(
    'retries risk errors with HTTP %s without creating notices, including repeated failures',
    async (status) => {
      const request = await loadRequest();
      const adapter = adapterFor(-460, status);
      for (let i = 0; i < 3; i++) {
        const result = request.get('/song/url/v1', { adapter }).catch((error) => error);
        await vi.runAllTimersAsync();
        expect(await result).toBeInstanceOf(AxiosError);
      }
      expect(adapter).toHaveBeenCalledTimes(6);
      expect(createDiscreteApi).not.toHaveBeenCalled();
    }
  );

  it('keeps retrying unrelated HTTP 400 errors without creating notices', async () => {
    const request = await loadRequest();
    const result = request
      .get('/song/url/v1', { adapter: adapterFor(400) })
      .catch((error) => error);
    await vi.runAllTimersAsync();
    expect(await result).toBeInstanceOf(AxiosError);
    expect(createDiscreteApi).not.toHaveBeenCalled();
  });

  it('returns successful retries without creating notices', async () => {
    const request = await loadRequest();
    let attempts = 0;
    const adapter: AxiosAdapter = async (config) => {
      const code = ++attempts % 2 ? -460 : 200;
      return adapterFor(code, code === 200 ? 200 : 400)(config);
    };
    for (let i = 0; i < 3; i++) {
      const result = request.get('/song/url/v1', { adapter });
      await vi.runAllTimersAsync();
      expect((await result).data.code).toBe(200);
    }
    expect(createDiscreteApi).not.toHaveBeenCalled();
  });

  it('keeps noRetry requests from automatically retrying', async () => {
    const request = await loadRequest();
    const adapter = adapterFor(-460);
    const result = await request({ url: '/song/url/v1', adapter, noRetry: true } as any).catch(
      (error) => error
    );
    expect(result).toBeInstanceOf(AxiosError);
    expect(adapter).toHaveBeenCalledTimes(1);
    expect(createDiscreteApi).not.toHaveBeenCalled();
  });
});
