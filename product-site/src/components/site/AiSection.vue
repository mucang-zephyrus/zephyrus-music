<script setup lang="ts">
const signals = ['STREAMING', 'MARKDOWN', 'DAILY CREDITS'];
</script>

<template>
  <section class="ai hairline-t">
    <div class="site-shell ai-grid">
      <div v-reveal class="ai-stage ui-stage" aria-label="歌词 AI 分析流式输出示意">
        <div class="ai-meta"><span>隐喻分析 · GLM</span><span>STREAMING</span></div>
        <p class="ai-line">
          <b>“风留在耳边”</b>
          <span class="ai-cursor" aria-hidden="true"></span>
        </p>
        <p class="ai-body dim">
          以风为信使的告别叙事：把说不出口的话托付给持续存在的自然物，距离感由听觉承担。
        </p>
        <p class="ai-body">
          副歌的“潮声退后”与主歌形成对位，退场的声部仍保留在时间轴上。
        </p>
      </div>

      <div v-reveal="{ delay: 120 }">
        <h2 class="section-title">歌词隐喻与叙事，<br />流式分析。</h2>
        <p class="section-body">
          在播放界面选择模型后，隐喻、叙事和修辞分析以流式文本输出。每日积分、倍率和隐私提示放在同一处，分析文本可复制为纯文本。
        </p>
        <div class="ai-signals">
          <span v-for="signal in signals" :key="signal">{{ signal }}</span>
        </div>
        <a class="text-link" href="https://mucang.xyz/zephyrus/docs/features/ai-lyric-analysis">
          了解歌词 AI <span aria-hidden="true">↗</span>
        </a>
      </div>
    </div>
  </section>
</template>

<style scoped>
.ai {
  padding: 96px 0;
}

.ai-grid {
  display: grid;
  gap: 48px;
  align-items: center;
  grid-template-columns: 1fr;
}

@media (min-width: 980px) {
  .ai-grid {
    grid-template-columns: 6fr 5fr;
  }
}

.ai-stage {
  padding: 24px 26px 28px;
}

.ai-meta {
  display: flex;
  justify-content: space-between;
  margin-bottom: 22px;
  font-family: var(--font-mono);
  font-size: 10.5px;
  letter-spacing: 0.1em;
  color: var(--color-ink-faint);
}

.ai-line {
  font-size: 19px;
  font-weight: 600;
  color: var(--color-ink);
}

.ai-cursor {
  display: inline-block;
  width: 8px;
  height: 1.05em;
  margin-left: 6px;
  vertical-align: text-bottom;
  background: var(--color-electric);
  animation: ai-cursor 1.1s steps(2) infinite;
}

@keyframes ai-cursor {
  50% {
    opacity: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .ai-cursor {
    animation: none;
  }
}

.ai-body {
  margin-top: 16px;
  max-width: 58ch;
  font-size: 13.5px;
  line-height: 1.8;
  color: var(--color-ink-dim);
}

.ai-body.dim {
  color: var(--color-ink-faint);
}

.ai-signals {
  display: flex;
  gap: 18px;
  margin-top: 26px;
  font-family: var(--font-mono);
  font-size: 10.5px;
  letter-spacing: 0.14em;
  color: var(--color-ink-faint);
}

.text-link {
  margin-top: 22px;
}
</style>
