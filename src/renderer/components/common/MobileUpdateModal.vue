<template>
  <Teleport to="body">
    <Transition name="update-modal">
      <div v-if="showModal" class="update-backdrop">
        <section
          class="update-sheet"
          role="dialog"
          aria-modal="true"
          aria-labelledby="update-title"
        >
          <div class="px-6 pt-6 pb-5">
            <div class="flex items-center gap-4">
              <div
                class="w-20 h-20 rounded-2xl overflow-hidden shadow-lg flex-shrink-0 ring-2 ring-[var(--accent-color)]/20"
              >
                <img
                  src="@/assets/icon_512.png"
                  alt="App Icon"
                  class="w-full h-full object-cover"
                />
              </div>
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 mb-2">
                  <span class="update-version-pill">
                    {{ t('comp.update.title') }}
                  </span>
                </div>
                <h2 id="update-title" class="text-2xl font-bold update-sheet-title truncate">
                  v{{ latestVersion }}
                </h2>
                <p class="text-sm update-sheet-subtitle mt-1">
                  {{ t('comp.update.currentVersion') }}: v{{ currentVersion }}
                </p>
              </div>
            </div>
          </div>

          <div class="mx-6 mb-3 update-testers" v-if="testers.length">
            <tester-credits
              :testers="testers"
              :expanded="showTesters"
              @expand="showTesters = true"
            />
            <button
              v-if="showTesters"
              type="button"
              class="credits-back"
              @click="showTesters = false"
            >
              返回更新公告
            </button>
          </div>
          <div v-if="!showTesters" class="mx-6 mb-5 overflow-y-auto rounded-2xl update-sheet-notes">
            <div
              class="p-5 text-sm leading-relaxed update-sheet-notes-text"
              v-html="parsedReleaseNotes"
            ></div>
          </div>

          <!-- 下载进度 -->
          <div v-if="downloadState === 'downloading'" class="px-6 pb-4">
            <div class="flex justify-between text-xs update-sheet-subtitle mb-2">
              <span>{{ t('comp.update.downloading') }}</span>
              <span>{{ downloadProgressText }}</span>
            </div>
            <div class="h-2 rounded-full update-sheet-track overflow-hidden">
              <div
                class="h-full rounded-full transition-all duration-200 update-progress-fill"
                :style="{ width: `${Math.round(downloadProgress * 100)}%` }"
              ></div>
            </div>
            <p class="mt-1.5 text-xs update-sheet-subtitle">{{ downloadSpeedText }}</p>
          </div>
          <p v-else-if="downloadState === 'error'" class="px-6 pb-4 text-xs text-red-500">
            {{ t('comp.update.downloadFailed') }}：{{ downloadError }}
          </p>

          <div class="px-6 pb-6 flex gap-3">
            <button
              @click="handleLater"
              :disabled="downloadState === 'downloading'"
              class="update-btn-secondary"
            >
              {{ t('comp.update.noThanks') }}
            </button>
            <button @click="handlePrimaryAction" class="update-btn-primary">
              <span class="flex items-center justify-center gap-2">
                <i
                  :class="
                    downloadState === 'ready'
                      ? 'ri-check-double-line text-lg'
                      : 'ri-download-2-line text-lg'
                  "
                ></i>
                {{
                  downloadState === 'downloading'
                    ? t('comp.update.backgroundDownload')
                    : downloadState === 'ready'
                      ? t('comp.update.installNow')
                      : t('comp.update.nowUpdate')
                }}
              </span>
            </button>
          </div>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { useMessage } from 'naive-ui';
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';

import { fetchTesterCredits, type TesterCredit } from '@/api/testerCredits';
import TesterCredits from '@/components/common/TesterCredits.vue';
import { closeUpdateModal, openUpdateModal, updateModalState } from '@/composables/useUpdateModal';
import {
  getApkDownloadState,
  installApkFromCache,
  isAndroidNative,
  startApkDownload
} from '@/services/androidNative';
import { APP_VERSION, IS_TEST_BUILD } from '@/utils/appVersion';
import { renderReleaseNotes } from '@/utils/releaseNotes';
import { checkUpdate, type UpdateResult } from '@/utils/update';

const { t } = useI18n();
const message = useMessage();

const REMIND_LATER_KEY = 'update_remind_later_timestamp';
const APK_READY_KEY = 'apk_update_ready';
const SERVER_DOWNLOAD_URL = 'https://mucang.xyz/zephyrus/apks/zephyrus-player-latest.apk';

const showModal = computed(() => updateModalState.value.show);
const updateInfo = computed<UpdateResult | null>(() => updateModalState.value.info);
const latestVersion = computed(() => updateInfo.value?.latestVersion || '');
const currentVersion = computed(() => updateInfo.value?.currentVersion || APP_VERSION);

const downloadState = ref<'idle' | 'downloading' | 'ready' | 'error'>('idle');
const downloadProgress = ref(0);
const downloadError = ref('');
const downloadSpeed = ref(0);
const downloadElapsed = ref(0);
const downloadMode = ref<'foreground' | 'background'>('foreground');

const totalSize = computed(() => Number(updateInfo.value?.releaseInfo?.assets?.[0]?.size) || 0);
const downloadProgressText = computed(() => {
  if (totalSize.value > 0 && downloadProgress.value > 0) {
    const doneMB = ((totalSize.value * downloadProgress.value) / 1024 / 1024).toFixed(1);
    const totalMB = (totalSize.value / 1024 / 1024).toFixed(1);
    return `${Math.round(downloadProgress.value * 100)}% (${doneMB}/${totalMB} MB)`;
  }
  return `${Math.round(downloadProgress.value * 100)}%`;
});
const downloadSpeedText = computed(() => {
  if (downloadSpeed.value > 0) {
    return `速度 ${downloadSpeed.value.toFixed(1)} MB/s · 已用 ${Math.round(downloadElapsed.value)}s`;
  }
  return '';
});

const parsedReleaseNotes = computed(() =>
  renderReleaseNotes(updateInfo.value?.releaseInfo?.body || '')
);
const testers = ref<TesterCredit[]>([]);
const showTesters = ref(false);
watch([showModal, latestVersion], async ([visible, version], _, onCleanup) => {
  showTesters.value = false;
  testers.value = [];
  if (!visible || !version || IS_TEST_BUILD) return;
  let current = true;
  onCleanup(() => {
    current = false;
  });
  const list = await fetchTesterCredits(version);
  if (current) testers.value = list;
});

const shouldShowReminder = (): boolean => {
  const savedTime = parseInt(localStorage.getItem(REMIND_LATER_KEY) || '', 10);
  return !savedTime || Date.now() - savedTime >= 24 * 60 * 60 * 1000;
};

const handleLater = () => {
  localStorage.setItem(REMIND_LATER_KEY, Date.now().toString());
  // 下载中点击“稍后安装”：转为后台下载，完成后仍可安装
  if (downloadState.value === 'downloading') {
    downloadMode.value = 'background';
  } else {
    clearDownloadTimer();
  }
  closeUpdateModal();
};

let downloadTimer: number | null = null;
let downloadStartedAt = 0;

const clearDownloadTimer = () => {
  if (downloadTimer) {
    window.clearInterval(downloadTimer);
    downloadTimer = null;
  }
};

const installDownloadedApk = () => {
  installApkFromCache('zephyrus-update.apk');
  closeUpdateModal();
};

/**
 * 启动原生下载并轮询进度；前台模式完成后自动安装，后台模式完成后记录就绪
 */
const startDownload = (url: string) => {
  downloadState.value = 'downloading';
  downloadProgress.value = 0;
  downloadError.value = '';
  downloadSpeed.value = 0;
  downloadElapsed.value = 0;
  downloadStartedAt = Date.now();
  startApkDownload(url, totalSize.value);

  clearDownloadTimer();
  downloadTimer = window.setInterval(() => {
    const state = getApkDownloadState();
    if (!state) return;

    const expected = state.expected || totalSize.value;
    if (state.error) {
      clearDownloadTimer();
      if (downloadMode.value === 'background') {
        message.error(state.message || t('comp.update.downloadFailed'));
      } else {
        downloadState.value = 'error';
        downloadError.value = state.message || t('comp.update.downloadFailed');
      }
      return;
    }
    if (state.done) {
      clearDownloadTimer();
      downloadProgress.value = 1;
      if (downloadMode.value === 'background') {
        localStorage.setItem(APK_READY_KEY, updateInfo.value?.latestVersion || '1');
        message.success(t('comp.update.backgroundDone'));
      } else {
        downloadState.value = 'ready';
        installDownloadedApk();
      }
      return;
    }

    downloadProgress.value = expected > 0 ? Math.min(1, state.bytes / expected) : 0;
    const elapsed = (Date.now() - downloadStartedAt) / 1000;
    downloadElapsed.value = elapsed;
    if (elapsed > 0) downloadSpeed.value = state.bytes / 1024 / 1024 / elapsed;
  }, 400);
};

const getDownloadUrl = () =>
  updateInfo.value?.releaseInfo?.assets?.[0]?.browser_download_url || SERVER_DOWNLOAD_URL;

/**
 * 主按钮：未下载时「立即更新」（前台下载并显示进度）；
 * 下载中变为「后台下载」，点击后转入后台（关闭弹窗，下载继续）；
 * 下载就绪后变为「立即安装」，点击唤起安装器。
 */
const handlePrimaryAction = () => {
  localStorage.removeItem(REMIND_LATER_KEY);
  if (!isAndroidNative()) {
    window.open(getDownloadUrl(), '_blank');
    closeUpdateModal();
    return;
  }
  // 下载已完成：直接安装
  if (downloadState.value === 'ready') {
    localStorage.removeItem(APK_READY_KEY);
    installDownloadedApk();
    return;
  }
  // 下载中：切换为后台下载
  if (downloadState.value === 'downloading') {
    downloadMode.value = 'background';
    closeUpdateModal();
    message.success(t('comp.update.backgroundStart'));
    return;
  }
  // 首次点击：前台下载，按钮随即变为「后台下载」
  downloadMode.value = 'foreground';
  startDownload(getDownloadUrl());
};

const checkForUpdates = async () => {
  if (!shouldShowReminder()) return;
  try {
    const result = await checkUpdate(APP_VERSION);
    if (result?.hasUpdate) {
      downloadState.value = 'idle';
      downloadProgress.value = 0;
      // 后台下载已完成且版本一致：直接进入“立即安装”
      if (localStorage.getItem(APK_READY_KEY) === result.latestVersion) {
        downloadState.value = 'ready';
      }
      openUpdateModal(result);
    }
  } catch (error) {
    console.error('检查更新失败:', error);
  }
};

onMounted(() => {
  setTimeout(() => {
    checkForUpdates();
  }, 2000);
});

onUnmounted(() => {
  clearDownloadTimer();
});
</script>

<style scoped>
.update-backdrop {
  position: fixed;
  inset: 0;
  z-index: 999999;
  display: grid;
  place-items: center;
  padding: max(16px, var(--safe-area-inset-top, 0px)) max(16px, var(--safe-area-inset-right, 0px))
    max(16px, var(--safe-area-inset-bottom, 0px)) max(16px, var(--safe-area-inset-left, 0px));
  background: #0008;
}
.update-sheet {
  width: min(100%, 34rem);
  max-height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: auto;
  color: var(--floating-text);
  background: var(--floating-surface);
  border: 1px solid var(--floating-line);
  border-radius: 28px;
  box-shadow: 0 16px 48px #0004;
}
.update-sheet > :not(.update-sheet-notes, .update-testers) {
  flex-shrink: 0;
}
.update-sheet-title {
  color: var(--floating-text);
}
.update-sheet-subtitle {
  color: var(--floating-muted);
}
.update-testers {
  overflow: auto;
}
.credits-back {
  margin-top: 12px;
  color: var(--floating-muted);
}

.update-version-pill {
  padding: 4px 12px;
  font-size: 12px;
  font-weight: 600;
  color: #1a1a1c;
  background: var(--accent-color, #d4a056);
  border-radius: 999px;
}

.update-sheet-notes {
  background: var(--floating-inset);
  min-height: min(6rem, 22dvh);
}

.update-sheet-notes-text {
  color: var(--floating-text);
}

.update-sheet-track {
  background: var(--floating-inset);
}

.update-progress-fill {
  background: var(--accent-color, #d4a056);
}

.update-btn-secondary,
.update-btn-primary {
  flex: 1;
  padding: 16px;
  border: none;
  border-radius: 999px;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition:
    transform 0.15s ease,
    opacity 0.2s ease;
}

.update-btn-secondary {
  color: var(--floating-text);
  background: var(--floating-control);
}

.update-btn-secondary:disabled {
  opacity: 0.5;
}

.update-btn-primary {
  color: #1a1a1c;
  background: var(--accent-color, #d4a056);
}

.update-btn-primary:disabled {
  opacity: 0.6;
}

.update-btn-secondary:active,
.update-btn-primary:active {
  transform: scale(0.98);
}

.update-modal-enter-active,
.update-modal-leave-active {
  transition: opacity 0.3s ease;
}

.update-modal-enter-from,
.update-modal-leave-to {
  opacity: 0;
}

.update-modal-enter-active .update-sheet,
.update-modal-leave-active .update-sheet {
  transition: transform 0.35s cubic-bezier(0.22, 1, 0.36, 1);
}

.update-modal-enter-from .update-sheet,
.update-modal-leave-to .update-sheet {
  transform: translateY(12px) scale(0.98);
}
@media (prefers-reduced-motion: reduce) {
  .update-modal-enter-active,
  .update-modal-leave-active,
  .update-modal-enter-active .update-sheet,
  .update-modal-leave-active .update-sheet {
    transition: none;
  }
}
</style>
