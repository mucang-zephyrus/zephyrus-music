<script setup lang="ts">
import RealLyricLine from '@/components/ui-preview/RealLyricLine.vue';
</script>

<template>
  <section id="lyrics" class="engine hairline-t">
    <div class="site-shell engine-grid">
      <div v-reveal>
        <h2 class="section-title">一行歌词，<br />拆到每个字。</h2>
        <p class="section-body">
          主唱、背景词与对唱在同一条播放时钟里推进，每个字有自己的开始时刻。翻译和罗马音各占一行，跟随主行。
        </p>
        <a class="text-link" href="https://mucang.xyz/zephyrus/docs/features/scrolling-lyrics">
          了解逐字渲染 <span aria-hidden="true">↗</span>
        </a>
      </div>

      <div v-reveal="{ delay: 120 }" class="engine-stage ui-stage" aria-label="逐字歌词时序示意">
        <div class="engine-meta"><span>00:42.180</span><span>TTML · 4 VOICES</span></div>
        <RealLyricLine
          size="lg"
          animated
          :duration="5"
          :chars="['把', '风', '留', '在', '耳', '边']"
          sub="直到下一句到来以前"
        />
        <div class="engine-timeline" aria-hidden="true">
          <i class="tick sung"></i>
          <i class="tick sung"></i>
          <i class="tick current"></i>
          <i class="tick"></i>
          <i class="tick"></i>
          <i class="tick"></i>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.engine {
  padding: 88px 0 96px;
}

.engine-grid {
  display: grid;
  gap: 48px;
  align-items: center;
  grid-template-columns: 1fr;
}

@media (min-width: 980px) {
  .engine-grid {
    grid-template-columns: 5fr 6fr;
  }
}

.engine-stage {
  padding: 26px 28px 30px;
}

.engine-meta {
  display: flex;
  justify-content: space-between;
  margin-bottom: 30px;
  font-family: var(--font-mono);
  font-size: 10.5px;
  letter-spacing: 0.1em;
  color: var(--color-ink-faint);
}

.engine-timeline {
  display: flex;
  gap: 6px;
  margin-top: 34px;
}

.tick {
  flex: 1;
  height: 3px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.1);
}

.tick.sung {
  background: var(--color-klein-bright);
}

.tick.current {
  background: var(--color-electric);
  box-shadow: 0 0 12px rgba(77, 125, 255, 0.7);
}
</style>
