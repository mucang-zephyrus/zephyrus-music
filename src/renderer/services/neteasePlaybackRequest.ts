import axios from 'axios';

import { gatewayBaseURL } from '@/api/gatewayBase';

import type { PlaybackReport } from './neteaseListenTracker';

export async function sendNeteasePlaybackReport(report: PlaybackReport, cookie: string) {
  const response = await axios.post<{ code?: number; data?: unknown }>(
    `${gatewayBaseURL}/netease-enhanced/scrobble/v1`,
    { ...report, cookie },
    { timeout: 15000, withCredentials: false }
  );
  // Enhanced may return HTTP 200 and code 200 after only one of its two uploads succeeds.
  if (response.data?.code !== 200 || !response.data?.data) {
    throw new Error('NetEase playback report failed');
  }
}
