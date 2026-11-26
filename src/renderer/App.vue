<template>
  <div class="app-container h-full w-full" :class="{ mobile: isMobile }">
    <n-config-provider
      :theme="theme === 'dark' ? darkTheme : lightTheme"
      :theme-overrides="themeOverrides"
    >
      <n-dialog-provider>
        <n-message-provider>
          <router-view></router-view>
          <lyric-merge-feedback-panel />
          <traffic-warning-drawer></traffic-warning-drawer>
          <disclaimer-modal></disclaimer-modal>
          <shared-song-card ref="sharedSongCardRef"></shared-song-card>
          <share-link-import />
          <listen-together-invite-modal ref="listenTogetherInviteRef" />
          <mobile-update-modal />
          <onboarding-overlay ref="onboardingRef" />
          <ios-audio-protection-prompt />
          <test-version-notice v-if="IS_TEST_BUILD && !startupSplashVisible" />
          <splash-screen v-if="startupSplashVisible" @finish="startupSplashVisible = false" />
        </n-message-provider>
      </n-dialog-provider>
    </n-config-provider>
  </div>
</template>

<script setup lang="ts">
import { darkTheme, lightTheme } from 'naive-ui';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, watchEffect } from 'vue';
import { useI18n } from 'vue-i18n';
import { useRouter } from 'vue-router';

import DisclaimerModal from '@/components/common/DisclaimerModal.vue';
import IosAudioProtectionPrompt from '@/components/common/IosAudioProtectionPrompt.vue';
import ListenTogetherInviteModal from '@/components/common/ListenTogetherInviteModal.vue';
import MobileUpdateModal from '@/components/common/MobileUpdateModal.vue';
import OnboardingOverlay from '@/components/common/OnboardingOverlay.vue';
import SharedSongCard from '@/components/common/SharedSongCard.vue';
import ShareLinkImport from '@/components/common/ShareLinkImport.vue';
import TestVersionNotice from '@/components/common/TestVersionNotice.vue';
import LyricMergeFeedbackPanel from '@/components/lyric/LyricMergeFeedbackPanel.vue';
import SplashScreen from '@/components/splash/SplashScreen.vue';
import TrafficWarningDrawer from '@/components/TrafficWarningDrawer.vue';
import { setSmartAudioInstance, useSmartAudio } from '@/composables/useSmartAudio';
import { registerBuiltinFeatures } from '@/features/register';
import { isBareMobileLaunch } from '@/router/mobileStartup';
import { registerExternalAudioHandler } from '@/services/externalAudio';
import { useBackgroundHealthStore } from '@/store/modules/backgroundHealth';
import { usePlatformAccountsStore } from '@/store/modules/platformAccounts';
import { usePlayerStore } from '@/store/modules/player';
import { usePlayerCoreStore } from '@/store/modules/playerCore';
import { useSettingsStore } from '@/store/modules/settings';
import { useUserStore } from '@/store/modules/user';
import { IS_TEST_BUILD } from '@/utils/appVersion';
import { checkLoginStatus } from '@/utils/auth';

import { initAudioListeners, initMusicHook } from './hooks/MusicHook';
import { initCoverColor, refreshCoverTokens, useCoverColor } from './hooks/useCoverColor';
import { initNativeBridge, injectSafeAreaInsets, isAndroidNative } from './services/androidNative';
import { audioService } from './services/audioService';
import { listenTogetherService } from './services/listenTogetherService';
import { initLxMusicRunner } from './services/LxMusicSourceRunner';
import { setupMediaSessionLyric } from './services/mediaSessionLyric';
import { startNeteasePlaybackReporter } from './services/neteasePlaybackReporter';
import { useStyleEngineStore } from './store/modules/styleEngine';
import { isMobile } from './utils';
import { setListenTogetherInviteRef, setSharedSongCardRef } from './utils/deepLink';
import { showBottomToast } from './utils/shortcutToast';

const { locale, t } = useI18n();
const settingsStore = useSettingsStore();
const playerStore = usePlayerStore();
const playerCoreStore = usePlayerCoreStore();
const userStore = useUserStore();
const accountStore = usePlatformAccountsStore();
const backgroundHealthStore = useBackgroundHealthStore();
const router = useRouter();
const { primaryColor } = useCoverColor();
const styleEngine = useStyleEngineStore();
const onboardingRef = ref();
const startupSplashVisible = ref(isAndroidNative());

watch(
  () => accountStore.activeAccount,
  (account) => {
    if (!account) return;
    userStore.setUser({
      userId: Number(account.userId) || 0,
      nickname: account.nickname,
      avatarUrl: account.avatarUrl,
      vipType: account.vip ? 11 : 0
    });
    userStore.setLoginType(account.loginMethod);
  },
  { immediate: true }
);

// SharedSongCard 组件引用
const sharedSongCardRef = ref();

// ListenTogetherInviteModal 组件引用
const listenTogetherInviteRef = ref();

// naive-ui 主题覆盖：组件强调色跟随封面取色
const themeOverrides = computed(() => {
  const pc = primaryColor.value || '#888888';
  return {
    common: {
      primaryColor: pc,
      primaryColorHover: pc,
      primaryColorPressed: pc,
      primaryColorSuppl: pc,
      infoColor: pc,
      successColor: pc,
      warningColor: pc,
      errorColor: '#e53e3e'
    },
    Switch: {
      railColorActive: pc,
      loadingColor: pc,
      boxShadowFocus: `0 0 0 2px ${pc}33`
    },
    Button: {
      color: pc,
      colorHover: pc,
      colorFocus: pc,
      textColor: '#fff',
      textColorHover: '#fff',
      textColorFocus: '#fff'
    },
    Radio: {
      colorActive: 'transparent',
      dotColorActive: pc,
      boxShadowActive: `inset 0 0 0 1px ${pc}`,
      boxShadowFocus: `inset 0 0 0 1px ${pc}`,
      boxShadowHover: `inset 0 0 0 1px ${pc}`
    },
    RadioButton: {
      colorActive: pc,
      textColorActive: '#fff'
    },
    Tag: {
      colorSuccess: pc,
      textColorSuccess: '#fff',
      borderSuccess: pc
    },
    Input: {
      color: 'transparent',
      colorFocus: 'transparent',
      border: `1px solid #d9d9d9`,
      borderHover: `1px solid ${pc}`,
      borderFocus: `1px solid ${pc}`,
      borderDisabled: '1px solid #e0e0e0',
      boxShadowFocus: `0 0 0 1px ${pc}`,
      textColor: '#333',
      placeholderColor: '#999'
    },
    Dropdown: {
      optionColorActive: `${pc}15`,
      optionColorActiveHover: `${pc}20`,
      optionTextColorActive: pc
    },
    Menu: {
      colorActive: pc,
      itemTextColorActive: pc,
      itemIconColorActive: pc
    },
    Select: {
      peers: {
        InternalSelectMenu: {
          optionColorActive: `${pc}15`,
          optionColorActiveHover: `${pc}20`,
          optionTextColorActive: pc
        },
        Selection: {
          border: `1px solid #d9d9d9`,
          borderHover: `1px solid ${pc}`,
          borderActive: `1px solid ${pc}`,
          borderFocus: `1px solid ${pc}`,
          boxShadowFocus: `0 0 0 1px ${pc}`,
          boxShadowActive: `0 0 0 1px ${pc}`
        }
      }
    },
    Slider: {
      fillColor: pc,
      fillColorHover: pc,
      handleColor: pc,
      dotColor: pc,
      dotColorActive: pc,
      dotColorModal: pc,
      dotColorPopover: pc,
      indicatorColor: pc,
      indicatorTextColor: '#fff'
    },
    Checkbox: {
      colorChecked: pc,
      borderChecked: pc,
      boxShadowChecked: `inset 0 0 0 1px ${pc}`
    },
    Spin: {
      color: pc
    }
  };
});

// 监听语言变化
watch(
  () => settingsStore.setData.language,
  (newLanguage) => {
    if (newLanguage && newLanguage !== locale.value) {
      locale.value = newLanguage;
    }
  },
  { immediate: true }
);

const theme = computed(() => {
  return settingsStore.theme;
});

// 监听主题变化，刷新封面取色设计令牌
watch(theme, () => {
  refreshCoverTokens();
});

// 监听字体变化并应用
watch(
  () => [settingsStore.setData.fontFamily, settingsStore.setData.fontScope],
  ([newFont, fontScope]) => {
    const appElement = document.body;
    if (newFont && fontScope === 'global') {
      appElement.style.fontFamily = newFont;
    } else {
      appElement.style.fontFamily = '';
    }
  }
);

const handleSetLanguage = (value: string) => {
  if (value) {
    locale.value = value;
  }
};

// 挂载智能混音引擎：触发 AudioScheduler / BPM Worker / 硬件评估初始化，
// 并注册为全局单例供 audioService.crossfadeToNext 在过渡时调用三级策略。
const smartAudio = useSmartAudio();
let smartAudioRegistered = false;

settingsStore.initializeSettings();
settingsStore.initializeTheme();

function initializeAccount() {
  const loginInfo = checkLoginStatus();
  if (loginInfo.isLoggedIn) {
    if (loginInfo.user && !userStore.user) {
      userStore.setUser(loginInfo.user);
    }
    if (loginInfo.loginType && !userStore.loginType) {
      userStore.setLoginType(loginInfo.loginType);
    }
    // 异步加载歌单、专辑、收藏列表（不阻塞渲染）
    userStore.initializeUser().catch((err) => {
      console.error('[App] 初始化用户数据失败:', err);
    });
  }
}

handleSetLanguage(settingsStore.setData.language);

// 提前注入 safe-area CSS 变量（在 Vue 首次渲染前），避免顶栏底栏上下跳动
if (isAndroidNative()) {
  injectSafeAreaInsets();
}

let focusTrapObserver: MutationObserver | null = null;

watchEffect(() => setSharedSongCardRef(sharedSongCardRef.value || null));
watchEffect(() => setListenTogetherInviteRef(listenTogetherInviteRef.value || null));

let started = false;
function openLocalMusic() {
  void router.push('/local-music');
}

async function startApp() {
  if (started) return;
  started = true;
  setSmartAudioInstance(smartAudio);
  smartAudioRegistered = true;
  initializeAccount();
  // 启动保险丝降档提示（上次会话背景引擎崩溃）
  if (backgroundHealthStore.startupDegraded) {
    showBottomToast(t('player.backgroundDegradedStartup'));
  }

  playerStore.setIsPlay(false);

  // 初始化一起听同步服务（幂等）：注册 seek/暂停/切歌插桩
  listenTogetherService.init();

  // 修复 vueuc FocusTrap 哨兵元素的 aria-hidden 警告
  focusTrapObserver = new MutationObserver(() => {
    document.querySelectorAll('[aria-hidden="true"][tabindex="0"]').forEach((el) => {
      el.setAttribute('tabindex', '-1');
    });
  });
  focusTrapObserver.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['tabindex', 'aria-hidden']
  });
  document.querySelectorAll('[aria-hidden="true"][tabindex="0"]').forEach((el) => {
    el.setAttribute('tabindex', '-1');
  });

  // 注册内置功能
  registerBuiltinFeatures();

  // 检查网络状态，离线时自动跳转到本地音乐页面
  if (!navigator.onLine) {
    router.push('/local-music');
  }

  // 监听网络状态变化，断网时跳转到本地音乐页面
  window.addEventListener('offline', openLocalMusic);

  // 初始化 MusicHook，注入 playerStore
  initMusicHook(playerStore);
  // 初始化封面取色（替换全局绿色主色）
  initCoverColor();
  // 初始化播放状态
  await playerStore.initializePlayState();
  registerExternalAudioHandler();

  // 初始化音频设备变化监听器
  playerCoreStore.initAudioDeviceListener();

  // 初始化落雪音源（如果有激活的音源）
  const activeLxApiId = settingsStore.setData?.activeLxMusicApiId;
  if (activeLxApiId) {
    const lxMusicScripts = settingsStore.setData?.lxMusicScripts || [];
    const activeScript = lxMusicScripts.find((script: any) => script.id === activeLxApiId);
    if (activeScript && activeScript.script) {
      try {
        await initLxMusicRunner(activeScript.script);
      } catch (error) {
        console.error('[App] 初始化落雪音源失败:', error);
      }
    }
  }

  // 如果有正在播放的音乐，则初始化音频监听器
  if (playerStore.playMusic && playerStore.playMusic.id) {
    // 使用 nextTick 确保 DOM 更新后再初始化
    await nextTick();
    initAudioListeners();
  }

  audioService.releaseOperationLock();

  // 初始化样式引擎（启动鼓点/高潮检测器）
  styleEngine.init();

  // 首次使用展示新手引导;仅裸启动(直接访问根路径)时弹出,
  // 通过分享链接直达歌单等二级页时不遮挡目标内容
  if (isBareMobileLaunch(window.location.hash)) {
    nextTick(() => onboardingRef.value?.show());
  }

  // 初始化 Android 原生桥接（状态栏、媒体通知、返回手势、安全区域）
  // 必须在 store 初始化后调用，内部会 watch playerStore 和 settingsStore
  if (isAndroidNative()) {
    initNativeBridge();
  }

  // 控制中心歌词(网易云式):媒体会话标题实时替换为当前歌词行(iOS/桌面浏览器)
  setupMediaSessionLyric();
}

let stopNeteasePlaybackReporter: (() => void) | undefined;
onMounted(() => {
  stopNeteasePlaybackReporter = startNeteasePlaybackReporter();
  void startApp();
});

onBeforeUnmount(() => {
  stopNeteasePlaybackReporter?.();
  window.removeEventListener('offline', openLocalMusic);
  styleEngine.dispose();
  focusTrapObserver?.disconnect();
  if (smartAudioRegistered) {
    smartAudio.dispose();
  }
});
</script>

<style lang="scss" scoped>
.app-container {
  user-select: none;
}

.mobile {
  .text-base {
    font-size: 14px !important;
  }
}

.html:has(.mobile) {
  font-size: 14px;
}
</style>
