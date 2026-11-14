<template>
  <div v-if="isIos" class="ios-audio-protection flex items-center justify-between gap-4">
    <div class="min-w-0">
      <div class="text-sm font-medium">iOS 防打断模式</div>
      <p class="text-xs opacity-60 mt-1 leading-relaxed">
        {{
          available
            ? '减少其他应用抢占音频。开启后媒体通知、锁屏播放控制和音频可视化不可用。'
            : '当前系统不支持，请升级 iOS 后重试。'
        }}
      </p>
      <p v-if="error && !confirmationVisible" role="alert" class="text-xs text-red-400 mt-1">
        {{ error }}
      </p>
    </div>
    <n-switch
      :value="enabled"
      :disabled="!available"
      aria-label="iOS 防打断模式"
      @update:value="requestChange"
    />
  </div>
</template>

<script setup lang="ts">
import { useIosAudioProtection } from '@/composables/useIosAudioProtection';

const { isIos, available, enabled, confirmationVisible, error, requestChange } =
  useIosAudioProtection();
</script>
