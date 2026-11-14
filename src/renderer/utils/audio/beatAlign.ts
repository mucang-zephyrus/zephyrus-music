/**
 * beatAlign.ts — Level 2: BPM 节拍对齐过渡
 *
 * 根据 BPM 计算过渡窗口长度，将过渡起始点对齐到最近的乐句边界。
 *
 *   过渡窗口 = (60 / bpm) * 4  →  4 个拍
 *   乐句边界 = 每 16 个拍（4 小节 4/4）
 */

import { applyEqualPowerCrossfade } from './crossfade';

export interface BeatAlignOptions {
  bpm: number;
  beatOffset: number;     // 第一拍时间偏移（秒）
  currentTime: number;    // 当前播放时间（秒）
  remainingTime: number;  // 剩余播放时间（秒）
  ctx: AudioContext;
  gainOut: GainNode;
  gainIn: GainNode;
  defaultDuration: number; // 默认过渡时长（秒），降级时使用
  volumeScale?: number;    // 音量缩放，透传给 applyEqualPowerCrossfade
  /** 延迟起播上限（秒）：进场曲在边界前保持静默，超过则放弃对齐，默认 2.5 */
  maxDelaySec?: number;
}

export interface BeatAlignResult {
  startTime: number;      // 过渡开始时间（AudioContext.currentTime，可能在未来）
  duration: number;       // 过渡时长
  reason: string;         // 说明
  level: 1 | 2;            // 实际使用的等级（可能降级为 1）
  /** 进场曲延后起播的秒数（0 = 立即）。调用方负责在这个时刻之后才 play() */
  delaySec: number;
}

/**
 * 计算节拍对齐的过渡参数
 */
export function calculateBeatAlignedTransition(opts: BeatAlignOptions): BeatAlignResult {
  const { bpm, beatOffset, currentTime, remainingTime, ctx, gainOut, gainIn, defaultDuration } = opts;
  const volumeScale = opts.volumeScale ?? 1;
  /** 延迟起播上限：进场曲「加载完但不出声」的窗口超过它就放弃对齐 */
  const maxDelaySec = opts.maxDelaySec ?? 2.5;

  const now = ctx.currentTime;
  const immediate = (duration: number, reason: string): BeatAlignResult => {
    applyEqualPowerCrossfade(ctx, gainOut, gainIn, now, duration, volumeScale);
    return { startTime: now, duration, reason, level: 1, delaySec: 0 };
  };

  // 检查 BPM 有效性
  if (!bpm || bpm < 50 || bpm > 250) {
    return immediate(defaultDuration, 'BPM 无效，降级为等功率过渡');
  }

  const beatDuration = 60 / bpm; // 单拍时长（秒）
  const transitionWindow = beatDuration * 4; // 4 拍过渡窗口

  // 剩余时间不足以完成 4 拍窗口：缩短到剩余的 85%，但不超过窗口本身
  if (remainingTime < transitionWindow) {
    return immediate(
      Math.min(transitionWindow, Math.max(0.5, remainingTime * 0.85)),
      `剩余时间不足 4 拍（${remainingTime.toFixed(1)}s < ${transitionWindow.toFixed(1)}s），降级为等功率`
    );
  }

  // 乐句边界：每 16 拍（4 小节 4/4）
  const phraseBeats = 16;
  const phraseDuration = beatDuration * phraseBeats;
  const elapsedBeats = Math.floor((currentTime - beatOffset) / beatDuration);
  const currentPhrase = Math.floor(elapsedBeats / phraseBeats);
  const nextPhraseTime = beatOffset + (currentPhrase + 1) * phraseDuration;
  const timeToPhrase = nextPhraseTime - currentTime;

  /** 对齐到乐句边界：出场曲放到边界为止，进场曲在边界上起播 */
  const alignToPhrase = (): BeatAlignResult => {
    if (
      timeToPhrase > 0 &&
      timeToPhrase <= maxDelaySec &&
      timeToPhrase + transitionWindow <= remainingTime - 0.25
    ) {
      applyEqualPowerCrossfade(ctx, gainOut, gainIn, now + timeToPhrase, transitionWindow, volumeScale);
      return {
        startTime: now + timeToPhrase,
        duration: transitionWindow,
        reason: `BPM=${bpm}，对齐乐句边界（${timeToPhrase.toFixed(1)}s 后起播），过渡 ${transitionWindow.toFixed(1)}s（4 拍）`,
        level: 2,
        delaySec: timeToPhrase
      };
    }
    // 边界太远（等待超过上限）或对齐后放不完：立即开始，长度取 4 拍与剩余的较小值
    const duration = Math.min(transitionWindow, remainingTime * 0.8);
    applyEqualPowerCrossfade(ctx, gainOut, gainIn, now, duration, volumeScale);
    return {
      startTime: now,
      duration,
      reason: `BPM=${bpm}，乐句边界不可达（${timeToPhrase.toFixed(1)}s），立即等功率 ${duration.toFixed(1)}s`,
      level: 2,
      delaySec: 0
    };
  };

  // 距乐句边界不足半个乐句 → 对齐；否则在剩余时间前 4 拍处开始（同样走延迟起播）
  if (timeToPhrase > 0 && timeToPhrase < phraseDuration * 0.5) {
    return alignToPhrase();
  }

  const transitionStartOffset = remainingTime - transitionWindow;
  if (transitionStartOffset > 0 && transitionStartOffset <= maxDelaySec) {
    applyEqualPowerCrossfade(ctx, gainOut, gainIn, now + transitionStartOffset, transitionWindow, volumeScale);
    return {
      startTime: now + transitionStartOffset,
      duration: transitionWindow,
      reason: `BPM=${bpm}，歌曲结束前 ${transitionWindow.toFixed(1)}s（${transitionStartOffset.toFixed(1)}s 后）开始过渡（4 拍）`,
      level: 2,
      delaySec: transitionStartOffset
    };
  }
  return alignToPhrase();
}
