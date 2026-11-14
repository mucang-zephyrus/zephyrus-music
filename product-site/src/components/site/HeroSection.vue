<script setup lang="ts">
/**
 * Hero：非对称分栏。主叙事「八种舞台」：
 * 标题 "Zephyrus. Every song, a gentle wind."，右舞台以真实组件做光标/陀螺仪视差。
 * 渐变灰化（用户定）：灰阶洗 + 一处深蓝洗；悬浮件全面磨砂。
 * 入场编排走 GSAP timeline（labels + defaults，见 gsap-timeline 技能），
 * prefers-reduced-motion 下不建时间轴，元素保持原位。
 */
import gsap from 'gsap';
import { onBeforeUnmount, onMounted } from 'vue';

import { ParallaxFloat, ParallaxFloatElement } from '@/components/inspira/parallax-float';
import RealLyricLine from '@/components/ui-preview/RealLyricLine.vue';
import RealPlayerFrame from '@/components/ui-preview/RealPlayerFrame.vue';
import RealStatusBarPill from '@/components/ui-preview/RealStatusBarPill.vue';

const stages = ['默认', '舞台', '诡谲', '狂热', '陈旧', '雨夜', '星盘', '烟雾'];

let intro: gsap.core.Timeline | null = null;

onMounted(() => {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  intro = gsap.timeline({ defaults: { duration: 0.7, ease: 'power3.out' } });
  intro
    .addLabel('copy', 0.1)
    .from('.hero-copy .eyebrow', { opacity: 0, y: 14 }, 'copy')
    .from('.hero-copy h1', { opacity: 0, y: 26 }, 'copy+=0.08')
    .from('.hero-statement', { opacity: 0, y: 18 }, 'copy+=0.32')
    .from('.hero-actions', { opacity: 0, y: 16 }, 'copy+=0.46')
    .addLabel('stage', 0.3)
    .from('.hero-stage', { opacity: 0, y: 30, scale: 0.985 }, 'stage');
});

onBeforeUnmount(() => {
  intro?.kill();
  intro = null;
});
</script>

<template>
  <section id="top" class="hero" aria-labelledby="hero-title">
    <div class="hero-wash" aria-hidden="true"></div>
    <div class="site-shell hero-grid">
      <div class="hero-copy">
        <p class="eyebrow">ANDROID · WORD-TIMED LYRICS</p>
        <h1 id="hero-title">
          Zephyrus.<br />Every song,<br />a gentle wind.
        </h1>
        <p class="hero-statement">
          八种播放舞台，一条逐字时间轴。Android 原生状态栏歌词与歌词 AI 都包含在内。
        </p>
        <div class="hero-actions">
          <a class="btn-primary" href="https://mucang.xyz/zephyrus/apks/zephyrus-player-latest.apk">
            下载 Android APK
          </a>
          <a class="btn-ghost" href="https://www.mucang.xyz/zephyrus/web/">打开 Web 版</a>
        </div>
      </div>

      <div class="hero-stage" aria-label="Zephyrus 播放界面实时渲染预览">
        <div class="stage-glow" aria-hidden="true"></div>
        <ParallaxFloat :sensitivity="1.1" :easing-factor="0.06">
          <!-- 深景：灰阶光环 -->
          <ParallaxFloatElement :depth="0.45" class="float-ring" aria-hidden="true">
            <div class="ring"></div>
          </ParallaxFloatElement>

          <!-- 中央：真实迷你播放器（HTML/CSS 实时渲染） -->
          <ParallaxFloatElement :depth="0.6" class="float-player">
            <RealPlayerFrame />
          </ParallaxFloatElement>

          <!-- 近景：舞台名胶囊（主叙事呼应） -->
          <ParallaxFloatElement :depth="1.7" class="float-stage">
            <div class="stage-chip glass-soft"><b>舞台</b><span>STAGE</span></div>
          </ParallaxFloatElement>

          <!-- 近景：状态栏歌词胶囊 -->
          <ParallaxFloatElement :depth="1.4" class="float-pill">
            <RealStatusBarPill sung-text="把风" current-text="留" rest-text="在耳边" />
          </ParallaxFloatElement>

          <!-- 近景：逐字歌词卡 -->
          <ParallaxFloatElement :depth="1.9" class="float-lyric">
            <div class="mini-card glass-soft">
              <div class="mini-card-meta"><span>00:42.180</span><span>TTML · WORD</span></div>
              <RealLyricLine :chars="['把', '风', '留', '在', '耳', '边']" :sung="3" sub="让潮声退后" />
            </div>
          </ParallaxFloatElement>
        </ParallaxFloat>
      </div>
    </div>
  </section>
</template>

<style scoped>
.hero {
  position: relative;
  min-height: 100dvh;
  display: flex;
  align-items: center;
  padding-top: 96px;
  padding-bottom: 24px;
  overflow: hidden;
}

/* 灰阶洗 + 一处深蓝洗（用户定：灰主蓝点） */
.hero-wash {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    radial-gradient(56% 48% at 76% 34%, rgba(0, 47, 167, 0.12) 0%, transparent 66%),
    radial-gradient(70% 60% at 20% 10%, rgba(255, 255, 255, 0.05) 0%, transparent 60%),
    radial-gradient(60% 55% at 14% 88%, rgba(255, 255, 255, 0.035) 0%, transparent 65%);
}

.hero-grid {
  display: grid;
  gap: 40px;
  align-items: center;
  grid-template-columns: 1fr;
  position: relative;
}

@media (min-width: 980px) {
  .hero-grid {
    grid-template-columns: 5fr 6fr;
    gap: 32px;
  }
}

.hero-copy {
  max-width: 560px;
}

.eyebrow {
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.22em;
  color: var(--color-electric);
}

h1 {
  margin-top: 18px;
  font-size: clamp(40px, 5.6vw, 66px);
  font-weight: 700;
  letter-spacing: -0.035em;
  line-height: 1.08;
  color: var(--color-ink);
}

.hero-statement {
  margin-top: 22px;
  max-width: 44ch;
  font-size: 15.5px;
  line-height: 1.85;
  color: var(--color-ink-dim);
}

.hero-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 32px;
}

/* ---------- 视差舞台 ---------- */
.hero-stage {
  position: relative;
  height: 520px;
}

@media (min-width: 980px) {
  .hero-stage {
    height: 620px;
  }
}

/* 磨砂舞台底：灰阶渐变玻璃 */
.stage-glow {
  position: absolute;
  inset: 5% 4%;
  border-radius: 32px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.05) 0%, rgba(255, 255, 255, 0.015) 100%);
  border: 1px solid rgba(255, 255, 255, 0.07);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
}

/* 悬浮层定位：不依赖 transform（ParallaxFloatElement 会接管 transform） */
.float-ring {
  inset: 10% 14%;
}

.ring {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.09);
  background: radial-gradient(closest-side, rgba(255, 255, 255, 0.035) 0%, transparent 82%);
}

.float-player {
  left: calc(50% - 132px);
  top: 48px;
  width: 264px;
}

.float-stage {
  left: 3%;
  top: 13%;
}

.stage-chip {
  display: inline-flex;
  align-items: baseline;
  gap: 8px;
  padding: 9px 16px;
  border-radius: 999px;
  backdrop-filter: blur(14px) saturate(135%);
  -webkit-backdrop-filter: blur(14px) saturate(135%);
}

.stage-chip b {
  font-size: 14px;
  color: var(--color-ink);
  letter-spacing: 0.1em;
}

.stage-chip span {
  font-family: var(--font-mono);
  font-size: 9px;
  letter-spacing: 0.16em;
  color: var(--color-ink-faint);
}

.float-pill {
  left: 6%;
  bottom: 12%;
}

.float-lyric {
  right: 1%;
  top: 52%;
  width: 218px;
}

.mini-card {
  padding: 12px 14px;
  border-radius: 14px;
  backdrop-filter: blur(14px) saturate(135%);
  -webkit-backdrop-filter: blur(14px) saturate(135%);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06), 0 24px 60px rgba(0, 0, 0, 0.4);
}

.mini-card-meta {
  display: flex;
  justify-content: space-between;
  margin-bottom: 8px;
  font-family: var(--font-mono);
  font-size: 9px;
  letter-spacing: 0.08em;
  color: var(--color-ink-faint);
}

/* 移动端：舞台收窄，近景卡收进边界内 */
@media (max-width: 979px) {
  .hero {
    padding-top: 108px;
  }

  .hero-stage {
    height: 500px;
  }

  .float-player {
    left: calc(50% - 122px);
    width: 244px;
    top: 40px;
  }

  .float-lyric {
    right: 0;
    width: 190px;
  }
}
</style>
