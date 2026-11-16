import type { SongResult } from '@/types/music';

export function resolveServerSongId(
  song: Pick<SongResult, 'id' | 'platform' | 'platformId'>
): string | null {
  const id = String(song.id ?? '');
  if (id.startsWith('server:')) return id.slice('server:'.length) || null;
  return song.platform === 'server' ? String(song.platformId || id) || null : null;
}
