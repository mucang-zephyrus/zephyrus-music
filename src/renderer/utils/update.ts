import { useDateFormat } from '@vueuse/core';
import axios from 'axios';

import { isAndroidNative } from '@/services/androidNative';
import { APP_VERSION, isTestVersion, TEST_SITE } from '@/utils/appVersion';

interface ReleaseInfo {
  tag_name: string;
  body: string;
  published_at: string;
  html_url: string;
  assets: Array<{
    browser_download_url: string;
    name: string;
    size: number;
  }>;
}

export interface UpdateResult {
  hasUpdate: boolean;
  latestVersion: string;
  currentVersion: string;
  releaseInfo: {
    tag_name: string;
    body: string;
    html_url: string;
    assets: Array<{
      browser_download_url: string;
      name: string;
      size?: number;
    }>;
  } | null;
}

// 本地签名产物发布到自有服务器；更新链路不再依赖 GitHub 账号或代理。
const SERVER_RELEASE_INFO_URL = 'https://mucang.xyz/zephyrus/apks/latest.json';

export const getLatestReleaseInfo = async (version = APP_VERSION): Promise<ReleaseInfo | null> => {
  const test = isTestVersion(version);
  const manifestUrl = test ? `${TEST_SITE}latest.json` : SERVER_RELEASE_INFO_URL;
  const assetPath = test ? '/zephyrus/webtest/' : '/zephyrus/apks/';
  try {
    const { data } = await axios.get<ReleaseInfo>(manifestUrl, {
      timeout: 8000,
      params: { t: Date.now() }
    });
    if (
      typeof data?.tag_name !== 'string' ||
      !(test ? isTestVersion(data.tag_name) : /^v?\d+\.\d+\.\d+$/.test(data.tag_name)) ||
      !Array.isArray(data.assets) ||
      !data.assets.some((asset) => asset.name?.endsWith('.apk'))
    ) {
      return null;
    }
    return {
      ...data,
      body: typeof data.body === 'string' ? data.body : '',
      html_url: test ? TEST_SITE : 'https://mucang.xyz/zephyrus/',
      assets: data.assets.filter((asset) => {
        try {
          const url = new URL(asset.browser_download_url);
          return (
            asset.name?.endsWith('.apk') &&
            url.protocol === 'https:' &&
            (url.hostname === 'mucang.xyz' || (!test && url.hostname === 'www.mucang.xyz')) &&
            url.pathname.startsWith(assetPath)
          );
        } catch {
          return false;
        }
      })
    };
  } catch (error) {
    console.error('获取服务器更新信息失败:', error);
    return null;
  }
};

/**
 * 格式化时间
 */
export const formatDate = (dateStr: string): string => {
  return useDateFormat(new Date(dateStr), 'YYYY-MM-DD HH:mm').value;
};

/**
 * 比较两个版本号
 * @param v1 版本号1
 * @param v2 版本号2
 * @returns 如果v1大于v2返回1，如果v1小于v2返回-1，如果相等返回0
 */
export const compareVersions = (v1: string, v2: string): number => {
  // 兼容 1.1.3-beta 这类预发布后缀：数字段取前缀数值，后缀仅在数字相同时参与比较
  const parse = (value: string): number[] =>
    String(value)
      .replace(/^v/i, '')
      .split('.')
      .map((part) => {
        const match = part.match(/^\d+/);
        return match ? Number(match[0]) : 0;
      });
  const v1Parts = parse(v1);
  const v2Parts = parse(v2);

  for (let i = 0; i < Math.max(v1Parts.length, v2Parts.length); i++) {
    const v1Part = v1Parts[i] || 0;
    const v2Part = v2Parts[i] || 0;

    if (v1Part > v2Part) return 1;
    if (v1Part < v2Part) return -1;
  }

  // 数字相同：预发布后缀（-beta/-rc 等）小于正式版
  const v1Suffix = String(v1).replace(/^v?[\d.]+/, '');
  const v2Suffix = String(v2).replace(/^v?[\d.]+/, '');
  if (!v1Suffix && v2Suffix) return 1;
  if (v1Suffix && !v2Suffix) return -1;
  const test1 = /^-test(\d+)$/.exec(v1Suffix);
  const test2 = /^-test(\d+)$/.exec(v2Suffix);
  if (test1 && test2) return Math.sign(Number(test1[1]) - Number(test2[1]));
  return 0;
};

/**
 * 检查更新
 */
export const checkUpdate = async (
  currentVersion: string = APP_VERSION
): Promise<UpdateResult | null> => {
  if (isTestVersion(currentVersion) && !isAndroidNative()) return null;
  try {
    const releaseInfo = await getLatestReleaseInfo(currentVersion);
    if (!releaseInfo || releaseInfo.assets.length === 0) {
      return null;
    }

    const latestVersion = releaseInfo.tag_name.replace('v', '');
    // 比较版本号，只有当新版本大于当前版本时才返回更新信息
    if (compareVersions(latestVersion, currentVersion) <= 0) {
      return null;
    }

    return {
      hasUpdate: true,
      latestVersion,
      currentVersion,
      releaseInfo: {
        tag_name: latestVersion,
        body: releaseInfo.body,
        html_url: releaseInfo.html_url,
        assets: releaseInfo.assets.map((asset) => ({
          browser_download_url: asset.browser_download_url,
          name: asset.name,
          size: asset.size
        }))
      }
    };
  } catch (error) {
    console.error('检查更新失败:', error);
    return null;
  }
};
