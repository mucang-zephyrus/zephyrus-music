<script setup lang="ts">
/**
 * 软件内真实 UI 预览：大字逐字歌词行。
 * 复刻 DefaultMobilePlayerV2 的逐字渲染观感：已唱词电光蓝填充、当前词呼吸、
 * 未唱词弱化，副行翻译弱化。animated 时按 4s 循环推进（CSS keyframes）。
 */
withDefaults(
  defineProps<{
    chars?: string[];
    sung?: number;
    sub?: string;
    size?: 'lg' | 'md';
    animated?: boolean;
    duration?: number;
  }>(),
  {
    chars: () => ['把', '风', '留', '在', '耳', '边'],
    sung: 2,
    sub: '直到下一句到来以前',
    size: 'md',
    animated: false,
    duration: 4
  }
);
</script>

<template>
  <div class="real-lyric" :class="[size === 'lg' ? 'is-lg' : '']">
    <div class="lyric-chars" aria-hidden="true">
      <span
        v-for="(char, index) in chars"
        :key="index"
        class="char"
        :class="{
          'is-sung': animated ? true : index < sung,
          'is-current': animated ? false : index === sung
        }"
        :style="
          animated
            ? { animationDuration: `${duration}s`, animationDelay: `${(index * duration) / chars.length}s` }
            : undefined
        "
      >
        {{ char }}
      </span>
    </div>
    <p v-if="sub" class="lyric-sub" aria-hidden="true">{{ sub }}</p>
  </div>
</template>

<style scoped>
.real-lyric {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

.lyric-chars {
  display: flex;
  align-items: baseline;
  gap: 0.06em;
  white-space: nowrap;
}

.char {
  color: rgba(168, 176, 194, 0.4);
  font-weight: 700;
  letter-spacing: 0.01em;
  transition: color 180ms ease;
}

.real-lyric.is-lg .char {
  font-size: clamp(28px, 4.2vw, 44px);
}

.char.is-sung,
.char.is-current {
  color: var(--color-ink);
}

.char.is-current {
  color: var(--color-electric);
}

/* animated：按字节拍点亮的循环（起始即"已唱"观感，随时间推进） */
.char.is-sung {
  background: linear-gradient(90deg, var(--color-electric) 0%, var(--color-electric) 100%);
  -webkit-background-clip: text;
  background-clip: text;
}

.real-lyric.is-lg.animated .char {
  animation: lyric-fill var(--fill-duration, 4s) linear infinite both;
}

@keyframes lyric-fill {
  0% {
    color: rgba(168, 176, 194, 0.4);
  }
  8% {
    color: var(--color-ink);
  }
  86% {
    color: var(--color-ink);
  }
  100% {
    color: rgba(168, 176, 194, 0.4);
  }
}

@media (prefers-reduced-motion: reduce) {
  .real-lyric.is-lg.animated .char {
    animation: none;
    color: var(--color-ink);
  }
}

.lyric-sub {
  overflow: hidden;
  font-size: 12px;
  color: var(--color-ink-faint);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.real-lyric.is-lg .lyric-sub {
  font-size: 14px;
}
</style>
