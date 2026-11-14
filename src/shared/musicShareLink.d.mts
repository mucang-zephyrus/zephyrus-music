export type ShareMusicPlatform = 'netease' | 'qq' | 'kugou';
export type MusicShareTarget =
  | { kind: 'song' | 'playlist' | 'album'; platform: ShareMusicPlatform; id: string }
  | { kind: 'listen'; id: string };
export function musicSharePlatform(value: string): ShareMusicPlatform | null;
export function parseMusicShareUrl(value: string): MusicShareTarget | null;
export function extractMusicShareUrls(text: string): string[];
