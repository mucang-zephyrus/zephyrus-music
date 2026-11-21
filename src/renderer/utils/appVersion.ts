import config from '../../../package.json';

export const APP_VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : config.version;
export const TEST_SITE = 'https://mucang.xyz/zephyrus/webtest/';
export const isTestVersion = (version: string) => /^v?\d+\.\d+\.\d+-test\d+$/.test(version);
export const IS_TEST_BUILD = isTestVersion(APP_VERSION);
const testBuildCode = typeof __TEST_VERSION_CODE__ === 'number' ? __TEST_VERSION_CODE__ : 0;
const apkVersion = testBuildCode > 0 ? `${APP_VERSION}-${testBuildCode}` : APP_VERSION;
export const TEST_APK_URL = `${TEST_SITE}zephyrus-player-v${apkVersion}.apk`;
