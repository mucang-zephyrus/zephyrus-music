// Older links use a numeric path id and pass the QQ MID in the query.
export function qqArtistMid(platform: unknown, legacyMid: unknown, pathId: unknown): string {
  if (platform !== 'qq') return '';
  return (
    (typeof legacyMid === 'string' && legacyMid.trim()) ||
    (typeof pathId === 'string' ? pathId.trim() : '')
  );
}

export function qqArtistPath(id: string | number, name = '') {
  return `/artist/detail/${encodeURIComponent(id)}?platform=qq&name=${encodeURIComponent(name)}`;
}

export function albumPath(id: string | number, platform?: string) {
  return `/music-list/${encodeURIComponent(id)}?type=album${platform === 'qq' ? '&platform=qq' : ''}`;
}
