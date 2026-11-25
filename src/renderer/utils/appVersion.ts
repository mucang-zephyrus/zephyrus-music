import { Capacitor } from '@capacitor/core';

import config from '../../../package.json';

export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : config.version;
export const TEST_SITE = 'https://mucang.xyz/zephyrus/webtest/';
const testOrigin = new URL(TEST_SITE).origin;
const testWebOrigins = new Set([testOrigin, 'https://www.mucang.xyz']);
export const testGatewayForOrigin = (origin: string) =>
  new URL('/zephyrus/api-test/', testWebOrigins.has(origin) ? origin : testOrigin).href;
export const isTestVersion = (version: string) => /^v?\d+\.\d+\.\d+-test\d+$/.test(version);
export const IS_TEST_BUILD = isTestVersion(APP_VERSION);
const testBuildCode = typeof __TEST_VERSION_CODE__ === 'number' ? __TEST_VERSION_CODE__ : 0;
// Published test Web builds may also be served through an alias or an embedded browser.
export const IS_WEB_TEST_SITE =
  typeof window !== 'undefined' &&
  !Capacitor.isNativePlatform() &&
  ((IS_TEST_BUILD && testBuildCode > 0) ||
    (testWebOrigins.has(window.location.origin) &&
      /^\/zephyrus\/webtest(?:\/|$)/.test(window.location.pathname)));
export const musicAccountStorageKey = (key: string) => (IS_WEB_TEST_SITE ? `webtest:${key}` : key);
export const platformAccountStorageKey = (kind: 'cookie' | 'user', platform: string) => {
  const key = `platform-${kind}-${platform}`;
  return platform === 'qq' || platform === 'kugou' ? musicAccountStorageKey(key) : key;
};
const apkVersion = testBuildCode > 0 ? `${APP_VERSION}-${testBuildCode}` : APP_VERSION;
export const TEST_APK_URL = `${TEST_SITE}zephyrus-player-v${apkVersion}.apk`;
