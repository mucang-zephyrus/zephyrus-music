import axios from 'axios';

import type { SongResult } from '@/types/music';

import { type MusicShareTarget, parseMusicShareUrl } from '../../shared/musicShareLink.mjs';

const base = (import.meta.env.VITE_MUSIC_GATEWAY || 'https://mucang.xyz/zephyrus/api')
  .replace(/\/+$/, '')
  .replace(/\/platform$/i, '');

export async function resolveSharedSong(url: string): Promise<SongResult> {
  const direct = parseMusicShareUrl(url);
  if (direct?.kind === 'song' && direct.platform === 'netease') return loadNetease(direct);
  // No platform login cookies or clipboard prose are attached to public share requests.
  const response = await axios.get<{
    code: number;
    data: { target: MusicShareTarget; song?: SongResult };
  }>(`${base}/platform/share/resolve`, { params: { url }, timeout: 25000 });
  const { target, song } = response.data.data;
  if (response.data.code !== 200 || target.kind !== 'song')
    throw new Error('Invalid share response');
  if (target.platform === 'netease') return loadNetease(target);
  if (!song?.name || song.platform !== target.platform || song.platformId !== target.id)
    throw new Error('Invalid shared song');
  return song;
}

async function loadNetease(target: { id: string }): Promise<SongResult> {
  const { getMusicDetail } = await import('@/api/music');
  const response = await getMusicDetail([Number(target.id)]);
  const song = response?.data?.songs?.[0] as SongResult | undefined;
  if (!song) throw new Error('Shared song unavailable');
  return {
    ...song,
    platform: 'netease',
    picUrl: song.al?.picUrl || song.album?.picUrl || song.picUrl || ''
  };
}
