import { readonly, ref } from 'vue';

import { iosAudioProtection, isIosWeb } from '@/services/iosAudioProtection';

const enabled = ref(iosAudioProtection.enabled);
const confirmationVisible = ref(false);
const error = ref('');

iosAudioProtection.subscribe(() => {
  enabled.value = iosAudioProtection.enabled;
});

export function useIosAudioProtection() {
  function requestChange(value: boolean) {
    error.value = '';
    if (value) confirmationVisible.value = true;
    else setEnabled(false);
  }

  function setEnabled(value: boolean) {
    try {
      iosAudioProtection.setEnabled(value);
      confirmationVisible.value = false;
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '切换失败，请重试。';
    }
  }

  return {
    isIos: isIosWeb(),
    available: iosAudioProtection.available,
    enabled: readonly(enabled),
    confirmationVisible: readonly(confirmationVisible),
    error: readonly(error),
    requestChange,
    confirm: () => setEnabled(true),
    cancel: () => {
      confirmationVisible.value = false;
      // 首次拒绝后不在每次启动重复询问，设置页可以再次开启。
      if (!iosAudioProtection.hasDecision) setEnabled(false);
    }
  };
}
