<script setup lang="ts">
/**
 * 软件内真实 UI 预览：迷你播放器（DefaultMobilePlayerV2 的布局复刻）。
 * 全面磨砂（用户定）：玻璃底；封面用灰阶渐变，蓝只出现在交互元素上。
 */
import { PhCaretDown, PhHeart, PhPause, PhPlaylist, PhShuffle, PhSkipBack, PhSkipForward } from '@phosphor-icons/vue';

import RealLyricLine from './RealLyricLine.vue';
</script>

<template>
  <div class="player-frame glass" aria-label="Zephyrus 播放界面实时渲染预览">
    <div class="pf-status"><span>22:16</span><span>5G&ensp;87%</span></div>

    <div class="pf-topbar">
      <PhCaretDown class="pf-dim" :size="14" weight="bold" />
      <span class="pf-cover" aria-hidden="true"></span>
      <span class="pf-title"><b>风潮</b><small>逐字舞台 · TTML</small></span>
      <PhHeart class="pf-heart" :size="14" weight="fill" />
    </div>

    <div class="pf-lyric">
      <RealLyricLine :chars="['把', '风', '留', '在', '耳', '边']" size="lg" animated :duration="5" />
    </div>

    <div class="pf-progress" aria-hidden="true"><i></i></div>
    <div class="pf-time" aria-hidden="true"><span>00:42</span><span>03:27</span></div>

    <div class="pf-controls" aria-hidden="true">
      <PhShuffle :size="15" class="pf-dim" />
      <PhSkipBack :size="19" weight="fill" />
      <span class="pf-play"><PhPause :size="16" weight="fill" /></span>
      <PhSkipForward :size="19" weight="fill" />
      <PhPlaylist :size="15" class="pf-dim" />
    </div>
  </div>
</template>

<style scoped>
.player-frame {
  width: 100%;
  padding: 12px 16px 18px;
  border-radius: 26px;
  backdrop-filter: blur(20px) saturate(140%);
  -webkit-backdrop-filter: blur(20px) saturate(140%);
}

.pf-status {
  display: flex;
  justify-content: space-between;
  padding: 0 2px;
  font-family: var(--font-mono);
  font-size: 9.5px;
  color: var(--color-ink-faint);
  letter-spacing: 0.04em;
}

.pf-topbar {
  display: flex;
  align-items: center;
  gap: 9px;
  margin-top: 14px;
}

.pf-dim {
  color: var(--color-ink-faint);
  flex: none;
}

.pf-cover {
  flex: none;
  width: 26px;
  height: 26px;
  border-radius: 8px;
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.22) 0%, rgba(255, 255, 255, 0.06) 100%);
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.pf-title {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
  gap: 1px;
  line-height: 1.2;
}

.pf-title b {
  font-size: 12px;
  color: var(--color-ink);
}

.pf-title small {
  font-size: 10px;
  color: var(--color-ink-faint);
}

.pf-heart {
  color: var(--color-electric);
  flex: none;
}

.pf-lyric {
  margin-top: 34px;
  padding: 0 2px;
}

.pf-progress {
  margin-top: 30px;
  height: 3px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.12);
  overflow: hidden;
}

.pf-progress i {
  display: block;
  width: 32%;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, var(--color-klein-bright), var(--color-electric));
}

.pf-time {
  display: flex;
  justify-content: space-between;
  margin-top: 6px;
  font-family: var(--font-mono);
  font-size: 9px;
  color: var(--color-ink-faint);
}

.pf-controls {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 14px;
  padding: 0 6px;
  color: var(--color-ink);
}

.pf-play {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  border-radius: 999px;
  background: var(--color-klein-bright);
  color: #fff;
  box-shadow: 0 10px 26px rgba(29, 73, 216, 0.45);
}
</style>
