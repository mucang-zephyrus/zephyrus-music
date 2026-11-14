<script setup lang="ts">
import Marquee from '@/components/inspira/marquee/Marquee.vue';

const styles = ['默认', '舞台', '诡谲', '狂热', '陈旧', '雨夜', '星盘', '烟雾'];
</script>

<template>
  <section id="styles" class="styles hairline-t">
    <div class="site-shell">
      <div v-reveal class="styles-head">
        <h2 class="section-title">一首歌，不止一种舞台。</h2>
        <p class="section-body">
          背景、歌词颜色、歌曲主题色、字体、字重与高潮效果按播放器样式独立保存。一键还原只作用于当前样式。
        </p>
      </div>
    </div>

    <div v-reveal="{ delay: 120 }" class="styles-marquee" aria-hidden="true">
      <div class="marquee-mask">
        <Marquee :repeat="4" pause-on-hover class="styles-track">
          <span v-for="name in styles" :key="name" class="style-pill">{{ name }}</span>
        </Marquee>
      </div>
    </div>
  </section>
</template>

<style scoped>
.styles {
  padding: 96px 0 88px;
  overflow: hidden;
}

.styles-head {
  max-width: 640px;
}

.styles-marquee {
  margin-top: 48px;
}

/* 两端渐隐，让跑马灯收进页面而不是切边 */
.marquee-mask {
  mask-image: linear-gradient(90deg, transparent, #000 12%, #000 88%, transparent);
  -webkit-mask-image: linear-gradient(90deg, transparent, #000 12%, #000 88%, transparent);
}

.styles-track {
  --duration: 36s;
  --gap: 14px;
}

.style-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 148px;
  padding: 22px 30px;
  border-radius: var(--radius-card);
  border: 1px solid rgba(148, 160, 196, 0.18);
  background:
    radial-gradient(120% 140% at 50% 0%, rgba(10, 20, 48, 0.85) 0%, rgba(11, 14, 22, 0.9) 70%);
  font-size: 17px;
  font-weight: 600;
  letter-spacing: 0.06em;
  color: var(--color-ink-dim);
  transition: color 240ms ease, border-color 240ms ease;
}

.style-pill:hover {
  color: var(--color-ink);
  border-color: rgba(77, 125, 255, 0.45);
}
</style>
