<script setup lang="ts">
import CardSpotlight from '@/components/inspira/card-spotlight/CardSpotlight.vue';

const wordTimed = [
  { name: 'Zephyrus TTML', detail: '逐字 · 背景 · 对唱', own: true },
  { name: 'AMLL TTML', detail: '逐字 · 背景 · 对唱' },
  { name: '网易云 YRC', detail: '逐字 · 翻译 · 罗马音' },
  { name: 'QQ QRC', detail: '逐字 · 翻译 · 罗马音' }
];
</script>

<template>
  <section class="source hairline-t">
    <div class="site-shell">
      <div v-reveal class="source-head">
        <h2 class="section-title">五种歌词格式，<br />自动择优。</h2>
        <p class="section-body">
          接口歌词先播放；优先级更高的 TTML 到达后，在下一行边界接管，不中断当前行。TTML 缺失时回退到行级 LRC。
        </p>
      </div>

      <div class="source-grid">
        <CardSpotlight
          v-for="(item, index) in wordTimed"
          :key="item.name"
          v-reveal="{ delay: index * 70 }"
          class="source-card glass-soft"
          :slot-class="'source-slot'"
        >
          <span class="source-rank">0{{ index + 1 }}</span>
          <span class="source-name">
            {{ item.name }}
            <small v-if="item.own" class="source-own">自有格式</small>
          </span>
          <span class="source-detail">{{ item.detail }}</span>
        </CardSpotlight>

        <div v-reveal="{ delay: 300 }" class="source-fallback">
          <span class="source-rank">05</span>
          <span class="source-name">普通 LRC</span>
          <span class="source-detail">稳定行级回退，不挑剔任何来源</span>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.source {
  padding: 96px 0;
}

.source-head {
  max-width: 640px;
}

.source-grid {
  display: grid;
  gap: 14px;
  margin-top: 48px;
  grid-template-columns: repeat(2, 1fr);
}

@media (min-width: 980px) {
  .source-grid {
    grid-template-columns: repeat(4, 1fr);
  }
}

.source-card {
  min-height: 148px;
  backdrop-filter: blur(14px) saturate(135%);
  -webkit-backdrop-filter: blur(14px) saturate(135%);
}

.source-slot {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 6px;
  padding: 20px;
  width: 100%;
}

.source-rank {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--color-electric);
  letter-spacing: 0.1em;
}

.source-name {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 16px;
  font-weight: 600;
  color: var(--color-ink);
}

.source-own {
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid rgba(77, 125, 255, 0.4);
  font-size: 10.5px;
  font-weight: 500;
  color: var(--color-electric);
}

.source-detail {
  font-size: 12.5px;
  color: var(--color-ink-faint);
}

/* 行级回退：整行横贯，与四张卡拉开层级 */
.source-fallback {
  grid-column: 1 / -1;
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 10px 18px;
  padding: 20px;
  border-radius: var(--radius-card);
  border: 1px dashed rgba(255, 255, 255, 0.14);
  background: rgba(255, 255, 255, 0.02);
}
</style>
