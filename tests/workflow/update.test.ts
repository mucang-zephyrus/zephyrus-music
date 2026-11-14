import axios from 'axios';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { checkUpdate } from '@/utils/update';

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
