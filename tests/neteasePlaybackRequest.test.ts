import axios from 'axios';
import { describe, expect, it, vi } from 'vitest';

import { sendNeteasePlaybackReport } from '@/services/neteasePlaybackRequest';

vi.mock('axios', () => ({ default: { post: vi.fn() } }));

const report = { id: 42, time: 31, total: 180 };

describe('NetEase report request', () => {
  it('accepts a successful write', async () => {
    vi.mocked(axios.post).mockResolvedValueOnce({ data: { code: 200, data: 'ok' } });
    await expect(sendNeteasePlaybackReport(report, 'MUSIC_U=test')).resolves.toBeUndefined();
    expect(axios.post).toHaveBeenCalledWith(
      expect.stringMatching(/\/netease-enhanced\/scrobble\/v1$/),
      { ...report, cookie: 'MUSIC_U=test' },
      expect.objectContaining({ withCredentials: false })
    );
  });

  it.each([{ code: 301 }, { code: 200, msg: 'second upload failed' }])(
    'rejects a business failure returned over HTTP 200',
    async (data) => {
      vi.mocked(axios.post).mockResolvedValueOnce({ status: 200, data });
      await expect(sendNeteasePlaybackReport(report, 'MUSIC_U=test')).rejects.toThrow();
    }
  );
});
