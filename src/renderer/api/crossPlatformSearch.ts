/**
 * 跨平台搜索聚合模块
 *
 * 职责：
 * 1. 当网易云搜索结果不足或为空时，调用多平台搜索进行补充
 * 2. 将各平台搜索结果统一映射为 SongResult 格式
 *
 * Spotify、哔哩哔哩走网关，其他来源使用 GD 音乐台。
 *
 * 注意：GD 音乐台不支持 tencent/qq 音源（返回 400），
 * joox 是 QQ 音乐的国际版，曲库覆盖高度重合。
 */

import type { Artist, SongResult } from '@/types/music';

import { searchBilibiliViaGateway } from './bilibili';
import { type GDCrossPlatformSearchItem, searchFromGDMusic } from './gdmusic';
import { searchSpotifyViaGateway } from './spotify';

/**
 * 跨平台搜索配置
 */
export interface CrossPlatformSearchConfig {
  /** 触发跨平台搜索的网易云结果数量阈值（少于该值时触发） */
  minNeteaseResults?: number;
  /** 每个音源返回的最大结果数 */
  perSourceLimit?: number;
  /** 是否启用 kuwo 音源（搜索可用但 URL 解析可能失败） */
  enableKuwo?: boolean;
  /** 是否使用原生多平台搜索（主进程 IPC） */
  /** 原生搜索的平台列表 */
  nativePlatforms?: string[];
}

const DEFAULT_CONFIG: Required<CrossPlatformSearchConfig> = {
  minNeteaseResults: 5,
  perSourceLimit: 20,
  enableKuwo: false, // kuwo URL 解析不稳定，默认关闭
  nativePlatforms: ['qq', 'migu', 'kugou', 'kuwo', 'joox', 'spotify', 'bilibili']
};

/**
 * GD 音乐台跨平台音源优先级
 * joox 优先（覆盖 QQ 独占内容且 URL 解析稳定）
 */
const CROSS_PLATFORM_SOURCES = ['joox'] as const;

/**
 * 判断是否需要触发跨平台搜索
 * @param neteaseResultCount 网易云搜索结果数量
 * @param config 配置
 */
export function shouldTriggerCrossSearch(
  neteaseResultCount: number,
  config?: CrossPlatformSearchConfig
): boolean {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  return neteaseResultCount < cfg.minNeteaseResults;
}

/**
 * 生成跨平台歌曲的唯一 ID
 * 格式：platform:platformId（确保不与网易云数字 ID 冲突）
 */
function makeCrossPlatformId(platform: string, platformId: string): string {
  return `${platform}:${platformId}`;
}

/**
 * 将 GD 音乐台搜索结果项转换为 SongResult 格式
 */
function convertGdItemToSongResult(
  item: GDCrossPlatformSearchItem,
  platform: string
): SongResult {
  const artists: Artist[] = (item.artist || []).map((name, idx) => ({
    name,
    id: idx, // 跨平台歌曲无可靠艺术家 ID
    picId: 0,
    img1v1Id: 0,
    briefDesc: '',
    picUrl: '',
    img1v1Url: '',
    albumSize: 0,
    alias: [],
    trans: '',
    musicSize: 0,
    topicPerson: 0
  }));

  const album = {
    name: item.album || '',
    id: 0,
    type: '',
    size: 0,
    picId: 0,
    blurPicUrl: '',
    companyId: 0,
    pic: 0,
    picUrl: '',
    publishTime: 0,
    description: '',
    tags: '',
    company: '',
    briefDesc: '',
    artist: artists[0] || ({} as Artist),
    songs: [],
    alias: [],
    status: 0,
    copyrightId: 0,
    commentThreadId: '',
    artists,
    subType: '',
    transName: null,
    onSale: false,
    mark: 0,
    picId_str: ''
  };

  const crossId = makeCrossPlatformId(platform, String(item.url_id || item.id));

  return {
    id: crossId,
    name: item.name || '未知歌曲',
    picUrl: '',
    ar: artists,
    artists,
    al: album,
    album,
    count: 0,
    platform,
    platformId: String(item.url_id || item.id),
    source: 'netease' as any // 保持兼容，实际来源通过 platform 字段判断
  };
}

/**
 * GD 音乐台搜索（作为 fallback）
 */
async function gdMusicSearch(
  keyword: string,
  sources: readonly string[],
  limit: number
): Promise<SongResult[]> {
  const searchPromises = sources.map(async (source) => {
    try {
      const items = await searchFromGDMusic(source, keyword, limit, 1);
      return { source, items };
    } catch (error) {
      console.error(`[gdMusicSearch] ${source} 搜索失败:`, error);
      return { source, items: [] as GDCrossPlatformSearchItem[] };
    }
  });

  const results = await Promise.all(searchPromises);

  const songs: SongResult[] = [];
  for (const { source, items } of results) {
    for (const item of items) {
      songs.push(convertGdItemToSongResult(item, source));
    }
  }
  return songs;
}

/**
 * 跨平台搜索（聚合多音源）
 *
 * 优先使用原生多平台搜索（主进程 IPC），若不可用则回退到 GD 音乐台。
 *
 * @param keyword 搜索关键词
 * @param config 搜索配置
 * @returns 跨平台搜索结果（已去重、已转换格式）
 */
export async function crossPlatformSearch(
  keyword: string,
  config?: CrossPlatformSearchConfig
): Promise<SongResult[]> {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  if (!keyword || !keyword.trim()) {
    return [];
  }

  // 获取搜索结果
  let rawSongs: SongResult[] = [];

  // Spotify 与哔哩哔哩都经网关，
  // 其余平台由网关侧的 platform 路由覆盖或由 GD 音乐台兜底。
  const gatewayTasks: Promise<SongResult[]>[] = [
    searchSpotifyViaGateway(keyword, cfg.perSourceLimit)
  ];
  if (cfg.nativePlatforms.includes('bilibili')) {
    gatewayTasks.push(searchBilibiliViaGateway(keyword, cfg.perSourceLimit));
  }
  const settled = await Promise.allSettled(gatewayTasks);
  rawSongs = settled.flatMap((item) => (item.status === 'fulfilled' ? item.value : []));

  // 如果原生搜索无结果，回退到 GD 音乐台
  if (rawSongs.length === 0) {
    const sources: string[] = [...CROSS_PLATFORM_SOURCES];
    if (cfg.enableKuwo) {
      sources.push('kuwo');
    }
    rawSongs = await gdMusicSearch(keyword, sources, cfg.perSourceLimit);
  }

  return rawSongs;
}

/**
 * 判断歌曲是否为跨平台歌曲
 */
export function isCrossPlatformSong(song: SongResult | null | undefined): boolean {
  if (!song) return false;
  return Boolean(song.platform && song.platform !== 'netease' && song.platformId);
}

/**
 * 获取跨平台歌曲的显示名称
 */
export function getCrossPlatformDisplayName(platform: string): string {
  switch (platform) {
    case 'qq':
      return 'QQ 音乐';
    case 'migu':
      return '咪咕';
    case 'joox':
      return 'JOOX';
    case 'kuwo':
      return '酷我';
    case 'kugou':
      return '酷狗';
    case 'spotify':
      return 'Spotify';
    case 'bilibili':
      return '哔哩哔哩';
    case 'netease':
      return '网易云';
    default:
      return platform;
  }
}
