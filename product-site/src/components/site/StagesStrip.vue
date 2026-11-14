<script setup lang="ts">
import Marquee from '@/components/inspira/marquee/Marquee.vue';

const stages = ['默认', '舞台', '诡谲', '狂热', '陈旧', '雨夜', '星盘', '烟雾'];
</script>

<template>
  <!-- 八种舞台：主叙事第一落点，紧贴 hero，无标题直入跑马灯 -->
  <section class="stages" aria-label="八种播放器舞台">
    <div class="marquee-mask">
      <Marquee :repeat="4" pause-on-hover class="stages-track">
        <span v-for="name in stages" :key="name" class="stage-pill glass-soft">{{ name }}</span>
      </Marquee>
    </div>
  </section>
</template>

<style scoped>
.stages {
  padding: 8px 0 28px;
  overflow: hidden;
}

/* 两端渐隐 */
.marquee-mask {
  mask-image: linear-gradient(90deg, transparent, #000 12%, #000 88%, transparent);
  -webkit-mask-image: linear-gradient(90deg, transparent, #000 12%, #000 88%, transparent);
}

.stages-track {
  --duration: 38s;
  --gap: 14px;
}

.stage-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 152px;
  padding: 20px 30px;
  border-radius: var(--radius-card);
  backdrop-filter: blur(14px) saturate(135%);
  -webkit-backdrop-filter: blur(14px) saturate(135%);
  font-size: 17px;
  font-weight: 600;
  letter-spacing: 0.08em;
  color: var(--color-ink-dim);
  transition: color 240ms ease, border-color 240ms ease;
}

.stage-pill:hover {
  color: var(--color-ink);
  border-color: rgba(77, 125, 255, 0.45);
}
</style>
