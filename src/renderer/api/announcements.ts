/**
 * 公告数据（server-music/announcements.json）
 * 每次启动拉取一次：?t= 时间戳 + no-cache 绕过启发式缓存；失败回退内存缓存。
 */

import archive from '../../../server/announcements.json';

const API_BASE = 'https://www.mucang.xyz';
const ANNOUNCEMENTS_JSON_URL = `${API_BASE}/server-music/announcements.json`;

export interface AnnouncementAction {
  /**
   * - 手机端先尝试 `appUrl`（如 orpheus 深链唤起网易云 App），失败回退 web 网页；
   * - 桌面端直接新开 `web` 网页（type='album'+id 时按网易云 web 专辑页拼链接）。
   */
  type: string;
  id?: number | string;
  url?: string;
  /** 手机端唤起 App 用的深链（缺省按 orpheus://album/<id> 拼） */
  appUrl?: string;
}

export interface Announcement {
  id: string | number;
  title: string;
  body: string;
  /** 公告日期（YYYY-MM-DD），卡片上展示 */
  date?: string;
  buttonText?: string;
  action?: AnnouncementAction;
}

export const announcementArchive: Announcement[] = archive;
let cachedList: Announcement[] | null = null;
export const cachedAnnouncements = () => cachedList ?? announcementArchive;

export async function fetchAnnouncements(): Promise<Announcement[]> {
  if (cachedList) return cachedList;
  try {
    const res = await fetch(`${ANNOUNCEMENTS_JSON_URL}?t=${Date.now()}`, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as Announcement[];
    cachedList = Array.isArray(data)
      ? data.filter(({ id }) => id !== 'announce-20261112-netease-api')
      : [];
  } catch (error) {
    console.error('[Announcements] 拉取失败：', error);
    return cachedAnnouncements();
  }
  return cachedList;
}
