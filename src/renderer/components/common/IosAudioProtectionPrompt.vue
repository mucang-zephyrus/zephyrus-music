<template>
  <glass-confirm-dialog
    :visible="confirmationVisible"
    title="开启 iOS 防打断模式"
    :message="
      error || '开启该功能会导致媒体通知失效。开启后音频将会随着 iPhone 静音而无声，是否继续？'
    "
    confirm-text="继续开启"
    cancel-text="取消"
    @confirm="confirm"
    @cancel="cancel"
  />
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue';

import GlassConfirmDialog from '@/components/common/GlassConfirmDialog.vue';
import { useIosAudioProtection } from '@/composables/useIosAudioProtection';
import { iosAudioProtection } from '@/services/iosAudioProtection';

const { available, confirmationVisible, error, requestChange, confirm, cancel } =
  useIosAudioProtection();
let startupTimer: ReturnType<typeof setInterval> | undefined;

function checkStartup() {
  if (iosAudioProtection.hasDecision) {
    clearInterval(startupTimer);
    return;
  }
  // 等待新用户完成引导与协议，避免两个确认框同时出现。
  if (
    localStorage.getItem('onboarding-completed') &&
    localStorage.getItem('disclaimer_agreed_timestamp')
  ) {
    clearInterval(startupTimer);
    requestChange(true);
  }
}

onMounted(() => {
  if (!available || iosAudioProtection.hasDecision) return;
  startupTimer = setInterval(checkStartup, 1000);
  checkStartup();
});
onBeforeUnmount(() => clearInterval(startupTimer));
</script>
