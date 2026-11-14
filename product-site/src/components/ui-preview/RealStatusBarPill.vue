<script setup lang="ts">
/**
 * 软件内真实 UI 预览：Android 状态栏歌词胶囊。
 * 复刻原生悬浮窗形态：小封面 + 已唱（电光蓝）/当前/未唱 逐字填充。
 */
withDefaults(
  defineProps<{
    sungText?: string;
    currentText?: string;
    restText?: string;
  }>(),
  {
    sungText: '让歌词',
    currentText: '留',
    restText: '在屏幕边缘'
  }
);
</script>

<template>
  <div class="status-pill" aria-hidden="true">
    <span class="pill-cover"></span>
    <span class="pill-words">
      <b class="is-sung">{{ sungText }}</b>
      <b class="is-current">{{ currentText }}</b>
      <span class="is-rest">{{ restText }}</span>
    </span>
  </div>
</template>

<style scoped>
.status-pill {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  max-width: 100%;
  padding: 7px 12px 7px 8px;
  border-radius: 999px;
  background: rgba(10, 12, 16, 0.55);
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.07),
    0 10px 30px rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(12px) saturate(140%);
  -webkit-backdrop-filter: blur(12px) saturate(140%);
}

.pill-cover {
  flex: none;
  width: 18px;
  height: 18px;
  border-radius: 5px;
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.22) 0%, rgba(255, 255, 255, 0.06) 100%);
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.pill-words {
  display: inline-flex;
  align-items: baseline;
  gap: 0;
  overflow: hidden;
  font-size: 12.5px;
  font-weight: 600;
  letter-spacing: 0.02em;
  white-space: nowrap;
}

.pill-words b {
  font-weight: 700;
}

.is-sung {
  color: var(--color-electric);
}

.is-current {
  color: #dfe8ff;
  animation: pill-breath 2.4s ease-in-out infinite;
}

.is-rest {
  color: rgba(168, 176, 194, 0.55);
}

@keyframes pill-breath {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.55;
  }
}

@media (prefers-reduced-motion: reduce) {
  .is-current {
    animation: none;
  }
}
</style>
