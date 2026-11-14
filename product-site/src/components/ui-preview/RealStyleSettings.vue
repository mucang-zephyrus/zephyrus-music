<script setup lang="ts">
/**
 * 软件内真实 UI 预览：播放器样式设置卡。
 * 复刻 MobilePlayerSettings 的按样式独立保存观感：舞台名 + 各设置行 + 开关。
 * 全部为 HTML/CSS 实时渲染，非截图。
 */
withDefaults(
  defineProps<{
    stageName?: string;
  }>(),
  {
    stageName: '舞台'
  }
);

const rows = [
  { label: '背景', value: '跟随封面' },
  { label: '歌词颜色', value: '#F2F4F8' },
  { label: '字体', value: '默认 · 半粗' },
  { label: '高潮特效', value: '逐字砸落', on: true }
];
</script>

<template>
  <div class="style-settings glass-soft" aria-label="播放器样式设置实时渲染预览">
    <div class="ss-head">
      <span class="ss-stage">{{ stageName }}</span>
      <span class="ss-reset">一键还原本舞台</span>
    </div>
    <div v-for="row in rows" :key="row.label" class="ss-row">
      <span class="ss-label">{{ row.label }}</span>
      <span class="ss-value">{{ row.value }}</span>
      <span
        v-if="row.on !== undefined"
        class="ss-switch"
        :class="{ on: row.on }"
        aria-hidden="true"
      ><i></i></span>
      <span v-else class="ss-switch ghost" aria-hidden="true"><i></i></span>
    </div>
  </div>
</template>

<style scoped>
.style-settings {
  width: 100%;
  padding: 14px 16px 8px;
  border-radius: 16px;
}

.ss-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 10px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.ss-stage {
  font-size: 13px;
  font-weight: 700;
  color: var(--color-ink);
  letter-spacing: 0.04em;
}

.ss-reset {
  font-size: 10.5px;
  color: var(--color-ink-faint);
}

.ss-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 0;
}

.ss-row + .ss-row {
  border-top: 1px solid rgba(255, 255, 255, 0.04);
}

.ss-label {
  flex: 1;
  font-size: 12px;
  color: var(--color-ink-dim);
}

.ss-value {
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--color-ink-faint);
}

.ss-switch {
  position: relative;
  flex: none;
  width: 30px;
  height: 17px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.12);
  transition: background 200ms ease;
}

.ss-switch i {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 13px;
  height: 13px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.85);
  transition: transform 200ms cubic-bezier(0.32, 0.72, 0, 1);
}

.ss-switch.on {
  background: var(--color-klein-bright);
}

.ss-switch.on i {
  transform: translate3d(13px, 0, 0);
  background: #fff;
}

.ss-switch.ghost {
  opacity: 0.35;
}
</style>
