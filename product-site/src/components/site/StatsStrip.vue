<script setup lang="ts">
import NumberTicker from '@/components/inspira/number-ticker/NumberTicker.vue';

const stats = [
  { value: 5, label: '歌词格式', detail: 'TTML 到 LRC 全覆盖', decimals: 0 },
  { value: 8, label: '播放样式', detail: '每样式独立保存设置', decimals: 0 },
  { value: 3, label: '运行端', detail: 'Android · Web · 桌面', decimals: 0 },
  { value: 33, label: '开源依赖致谢', detail: '全部许可见致谢页', decimals: 0 }
];
</script>

<template>
  <section class="stats hairline-t" aria-label="关键数字">
    <div class="site-shell stats-grid">
      <div
        v-for="(stat, index) in stats"
        :key="stat.label"
        v-reveal="{ delay: index * 80 }"
        class="stat"
      >
        <span class="stat-value">
          <NumberTicker :value="stat.value" :decimal-places="stat.decimals" :duration="1400" />
        </span>
        <span class="stat-label">{{ stat.label }}</span>
        <span class="stat-detail">{{ stat.detail }}</span>
      </div>
    </div>
  </section>
</template>

<style scoped>
.stats {
  padding: 64px 0;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 40px 24px;
}

@media (min-width: 860px) {
  .stats-grid {
    grid-template-columns: repeat(4, 1fr);
  }
}

.stat {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.stat-value {
  font-size: clamp(38px, 4.4vw, 52px);
  font-weight: 700;
  letter-spacing: -0.03em;
  color: var(--color-ink);
  line-height: 1;
}

.stat-label {
  margin-top: 8px;
  font-size: 14px;
  font-weight: 500;
  color: var(--color-ink-dim);
}

.stat-detail {
  font-size: 12px;
  color: var(--color-ink-faint);
}
</style>
