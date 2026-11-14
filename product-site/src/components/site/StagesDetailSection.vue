<script setup lang="ts">
import RealStyleSettings from '@/components/ui-preview/RealStyleSettings.vue';
</script>

<template>
  <!-- 舞台详解：主叙事展开（文字左 / 真实设置卡右） -->
  <section id="stages" class="stages-detail hairline-t">
    <div class="site-shell stages-grid">
      <div v-reveal>
        <h2 class="section-title">每种舞台，<br />保存一套完整的外观。</h2>
        <p class="section-body">
          背景、歌词颜色、主题色、字体、字重与高潮特效按舞台独立保存。切换舞台互不影响，一键还原只作用于当前舞台。
        </p>
        <a class="text-link" href="https://mucang.xyz/zephyrus/docs/features/custom-effects">
          查看舞台设置 <span aria-hidden="true">↗</span>
        </a>
      </div>

      <div v-reveal="{ delay: 120 }" class="settings-stage">
        <RealStyleSettings stage-name="舞台" />
        <p class="stage-note">设置按样式独立保存 · 实时渲染</p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.stages-detail {
  padding: 88px 0 96px;
}

.stages-grid {
  display: grid;
  gap: 48px;
  align-items: center;
  grid-template-columns: 1fr;
}

@media (min-width: 980px) {
  .stages-grid {
    grid-template-columns: 5fr 6fr;
  }
}

.settings-stage {
  max-width: 380px;
  margin-inline: auto;
  width: 100%;
}

.stage-note {
  margin-top: 14px;
  text-align: center;
  font-family: var(--font-mono);
  font-size: 10.5px;
  letter-spacing: 0.12em;
  color: var(--color-ink-faint);
}
</style>
