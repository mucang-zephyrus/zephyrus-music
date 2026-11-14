<script setup lang="ts">
import RealStatusBarPill from '@/components/ui-preview/RealStatusBarPill.vue';
</script>

<template>
  <section id="android" class="statusbar hairline-t">
    <div class="site-shell statusbar-grid">
      <div v-reveal>
        <h2 class="section-title">状态栏歌词，<br />原生悬浮窗渲染。</h2>
        <p class="section-body">
          不是截图，也不是播放器内的模拟：歌词挂在系统状态栏上逐字推进。位置、字体、字重，以及已唱、当前、未唱、表面四类颜色都可独立配置。
        </p>
        <a class="text-link" href="https://mucang.xyz/zephyrus/docs/features/status-bar-lyrics">
          配置状态栏歌词 <span aria-hidden="true">↗</span>
        </a>
      </div>

      <div v-reveal="{ delay: 120 }" class="status-stage" aria-label="Android 状态栏歌词预览">
        <div class="phone-strip">
          <div class="strip-icons" aria-hidden="true">
            <span class="icon-dot"></span>
            <span class="icon-dot"></span>
            <span class="icon-battery"></span>
          </div>
          <RealStatusBarPill sung-text="把风" current-text="留" rest-text="在耳边" />
          <div class="strip-clock" aria-hidden="true">22:16</div>
        </div>
        <div class="stage-note">原生悬浮窗 · 逐字进度 · 独立配色</div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.statusbar {
  padding: 96px 0;
}

.statusbar-grid {
  display: grid;
  gap: 48px;
  align-items: center;
  grid-template-columns: 1fr;
}

@media (min-width: 980px) {
  .statusbar-grid {
    grid-template-columns: 5fr 6fr;
  }
}

.status-stage {
  position: relative;
  padding: 44px 36px;
  border-radius: var(--radius-panel);
  border: 1px solid var(--color-line);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.04) 0%, rgba(255, 255, 255, 0.012) 100%);
  backdrop-filter: blur(16px) saturate(135%);
  -webkit-backdrop-filter: blur(16px) saturate(135%);
  overflow: hidden;
}

/* 状态栏条：左图标区 / 中歌词胶囊 / 右时钟 */
.phone-strip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
}

.strip-icons {
  display: flex;
  align-items: center;
  gap: 5px;
}

.icon-dot {
  width: 9px;
  height: 9px;
  border-radius: 3px;
  background: rgba(168, 176, 194, 0.5);
}

.icon-dot + .icon-dot {
  border-radius: 999px;
  width: 12px;
  height: 8px;
}

.icon-battery {
  width: 20px;
  height: 10px;
  border-radius: 3px;
  border: 1px solid rgba(168, 176, 194, 0.5);
  background: linear-gradient(90deg, rgba(168, 176, 194, 0.5) 0 78%, transparent 78%);
}

.strip-clock {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--color-ink-dim);
}

.stage-note {
  margin-top: 30px;
  font-family: var(--font-mono);
  font-size: 10.5px;
  letter-spacing: 0.12em;
  color: var(--color-ink-faint);
}
</style>
