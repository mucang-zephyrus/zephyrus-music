import axios from 'axios';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { isAndroidNative } from '@/services/androidNative';
import { checkUpdate } from '@/utils/update';

vi.mock('@/services/androidNative', () => ({ isAndroidNative: vi.fn(() => false) }));
vi.mock('axios', () => ({ default: { get: vi.fn() } }));
const release = {
  tag_name: 'v1.4.2',
  body: 'release notes',
  assets: [
    {
      name: 'player.apk',
      size: 100,
      browser_download_url: 'https://mucang.xyz/zephyrus/apks/player.apk'
    }
  ]
};
afterEach(() => vi.resetAllMocks());

describe('server updates', () => {
  it('uses the server manifest and APK URL', async () => {
    vi.mocked(axios.get).mockResolvedValue({ data: release });
    const result = await checkUpdate('1.4.1');
    expect(result?.latestVersion).toBe('1.4.2');
    expect(result?.releaseInfo?.assets).toEqual(release.assets);
    expect(axios.get).toHaveBeenCalledWith(
      'https://mucang.xyz/zephyrus/apks/latest.json',
      expect.any(Object)
    );
  });
  it('does not contact the lost GitHub account when the server is unavailable', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(axios.get).mockRejectedValue(new Error('offline'));
    expect(await checkUpdate('1.4.1')).toBeNull();
    expect(axios.get).toHaveBeenCalledTimes(1);
    log.mockRestore();
  });
  it.each([
    {},
    { ...release, tag_name: 'latest' },
    { ...release, assets: [] },
    {
      ...release,
      assets: [{ name: 'bad.apk', browser_download_url: 'https://github.com/old.apk' }]
    },
    { ...release, assets: [{ name: 'bad.apk', browser_download_url: 'javascript:alert(1)' }] }
  ])('rejects an unusable manifest', async (data) => {
    vi.mocked(axios.get).mockResolvedValue({ data });
    expect(await checkUpdate('1.4.1')).toBeNull();
  });
  it('does not offer the current or older version', async () => {
    vi.mocked(axios.get).mockResolvedValue({ data: release });
    expect(await checkUpdate('1.4.2')).toBeNull();
    expect(await checkUpdate('1.4.3')).toBeNull();
  });
});

describe('test APK updates', () => {
  const testRelease = {
    ...release,
    tag_name: 'v1.4.3-test10',
    assets: [
      {
        name: 'zephyrus-player-v1.4.3-test10.apk',
        browser_download_url:
          'https://mucang.xyz/zephyrus/webtest/zephyrus-player-v1.4.3-test10.apk',
        size: 100
      }
    ]
  };

  it('does not check for a test APK update from the test website', async () => {
    vi.mocked(isAndroidNative).mockReturnValue(false);
    expect(await checkUpdate('1.4.3-test2')).toBeNull();
    expect(axios.get).not.toHaveBeenCalled();
  });

  it('offers a newer test number from the test channel only', async () => {
    vi.mocked(isAndroidNative).mockReturnValue(true);
    vi.mocked(axios.get).mockResolvedValue({ data: testRelease });
    const update = await checkUpdate('1.4.3-test2');
    expect(update?.latestVersion).toBe('1.4.3-test10');
    expect(update?.releaseInfo?.assets).toEqual(testRelease.assets);
    expect(axios.get).toHaveBeenCalledWith(
      'https://mucang.xyz/zephyrus/webtest/latest.json',
      expect.objectContaining({ timeout: 8000 })
    );
    expect(vi.mocked(axios.get).mock.calls[0]?.[1]?.headers).toBeUndefined();
    expect(await checkUpdate('1.4.3-test10')).toBeNull();
    expect(await checkUpdate('1.4.2')).toBeNull();
  });
});
