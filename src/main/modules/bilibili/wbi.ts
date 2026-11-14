/**
 * B 站 wbi 签名（主进程）
 *
 * B 站的 /wbi/ 前缀接口要求 wts + w_rid 两个参数：
 *  1. 从 GET /x/web-interface/nav 取 wbi_img.img_url / sub_url，
 *     从文件名里截出 img_key / sub_key（按“天”缓存，B 站每日轮换）；
 *  2. 用固定的 64 位打乱表重排 img_key + sub_key，取前 32 位得到 mixin_key；
 *  3. 参数加 wts，按 key 字典序排序、value 过滤 "!'()*" 后拼 query，
 *     w_rid = md5(query + mixin_key)。
 *
 * 算法为公开实现，参考 bbplayer-app/BBPlayer（MIT）的 lib/api/bilibili/wbi.ts。
 */
import crypto from 'crypto';

const MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29,
  28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25,
  54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52
];

interface WbiKeys {
  imgKey: string;
  subKey: string;
  day: string;
}

let cachedKeys: WbiKeys | null = null;
/** 允许注入取 keys 的实现，避免 wbi 模块直接依赖 client（循环依赖） */
let keysFetcher: (() => Promise<{ imgKey: string; subKey: string }>) | null = null;

export function setWbiKeysFetcher(fetcher: () => Promise<{ imgKey: string; subKey: string }>): void {
  keysFetcher = fetcher;
}

const today = (): string => new Date().toISOString().slice(0, 10);

const md5 = (value: string): string => crypto.createHash('md5').update(value).digest('hex');

function getMixinKey(origin: string): string {
  return MIXIN_KEY_ENC_TAB.map((index) => origin[index])
    .join('')
    .slice(0, 32);
}

async function getKeys(): Promise<{ imgKey: string; subKey: string }> {
  if (cachedKeys && cachedKeys.day === today()) {
    return { imgKey: cachedKeys.imgKey, subKey: cachedKeys.subKey };
  }
  if (!keysFetcher) {
    throw new Error('wbi keys fetcher 未注册');
  }
  const keys = await keysFetcher();
  cachedKeys = { ...keys, day: today() };
  return keys;
}

/**
 * 生成带签名的 query string（含 wts 与 w_rid）
 */
export async function withWbi(params: Record<string, string | number>): Promise<string> {
  const { imgKey, subKey } = await getKeys();
  const mixinKey = getMixinKey(imgKey + subKey);
  const signed: Record<string, string | number> = { ...params, wts: Math.round(Date.now() / 1000) };

  const query = Object.keys(signed)
    .sort()
    .map((key) => {
      const value = String(signed[key]).replace(/[!'()*]/g, '');
      return `${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
    })
    .join('&');

  return `${query}&w_rid=${md5(query + mixinKey)}`;
}

/** 仅测试/调试用：清掉 keys 缓存 */
export function clearWbiKeyCache(): void {
  cachedKeys = null;
}
