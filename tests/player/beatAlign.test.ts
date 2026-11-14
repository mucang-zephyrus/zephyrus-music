import { describe, expect, it } from 'vitest';

import { calculateBeatAlignedTransition } from '@/utils/audio/beatAlign';

/** 最小 AudioContext/GainNode 替身：只提供曲线调度用到的成员 */
function makeFake() {
  const calls: Array<{ kind: string; time: number; value?: number }> = [];
  const gain = {
    gain: {
      setValueAtTime: (value: number, time: number) => calls.push({ kind: 'set', time, value }),
      linearRampToValueAtTime: (value: number, time: number) =>
        calls.push({ kind: 'ramp', time, value }),
      setValueCurveAtTime: () => calls.push({ kind: 'curve', time: -1 }),
      cancelScheduledValues: () => calls.push({ kind: 'cancel', time: -1 }),
      setTargetAtTime: () => calls.push({ kind: 'target', time: -1 })
    }
  } as unknown as GainNode;
  const ctx = { currentTime: 100 } as AudioContext;
  return { calls, gain, ctx };
}

const BASE = {
  bpm: 120, // 1 拍 0.5s，乐句 8s
  beatOffset: 0,
  gainOut: null as unknown as GainNode,
  gainIn: null as unknown as GainNode,
  defaultDuration: 8,
  volumeScale: 1
};

describe('calculateBeatAlignedTransition（Level 2 真延迟）', () => {
  it('距乐句边界 1.5s 且可容纳 4 拍窗口 → 延迟到边界起播', () => {
    const { gain, ctx } = makeFake();
    // 当前 200s = 第 400 拍（乐句边界），下一边界 204s → timeToPhrase = 4s？
    // 取 currentTime=202.5：elapsed=405，下一边界 408 拍=204s → timeToPhrase=1.5s
    const result = calculateBeatAlignedTransition({
      ...BASE,
      currentTime: 206.5,
      remainingTime: 6,
      ctx,
      gainOut: gain,
      gainIn: gain
    });

    expect(result.delaySec).toBeCloseTo(1.5, 5);
    expect(result.startTime).toBeCloseTo(101.5, 5);
    expect(result.duration).toBeCloseTo(2, 5);
    expect(result.level).toBe(2);
  });

  it('边界太远（等待超过上限）→ 立即等功率，长度取 4 拍与剩余的较小值', () => {
    const { gain, ctx } = makeFake();
    // currentTime=200.5 → timeToPhrase=7.5s > 2.5s 上限
    const result = calculateBeatAlignedTransition({
      ...BASE,
      currentTime: 200.5,
      remainingTime: 10,
      ctx,
      gainOut: gain,
      gainIn: gain
    });

    expect(result.delaySec).toBe(0);
    expect(result.startTime).toBeCloseTo(100, 5);
    expect(result.duration).toBeCloseTo(2, 5);
  });

  it('剩余时间不足 4 拍 → 降级等功率，长度为剩余的 80%', () => {
    const { gain, ctx } = makeFake();
    const result = calculateBeatAlignedTransition({
      ...BASE,
      currentTime: 205,
      remainingTime: 1.5,
      ctx,
      gainOut: gain,
      gainIn: gain
    });

    expect(result.delaySec).toBe(0);
    expect(result.level).toBe(1);
    expect(result.duration).toBeCloseTo(1.275, 5);
  });

  it('对齐后放不完 4 拍 → 放弃延迟，立即开始', () => {
    const { gain, ctx } = makeFake();
    // timeToPhrase=2s（≤上限），但对齐后剩余 5.5-2=3.5s ≥ 窗口 2s？
    // 构造 timeToPhrase=2.4s、remaining=3.9s：2.4+2=4.4 > 3.9-0.25 → 放弃延迟
    const result = calculateBeatAlignedTransition({
      ...BASE,
      currentTime: 207.6, // elapsed=415.2 → 下一乐句边界 416 拍=208s → timeToPhrase=0.4
      remainingTime: 3.9,
      ctx,
      gainOut: gain,
      gainIn: gain
    });

    // 0.4s 边界：0.4+2=2.4 ≤ 3.65 → 应该走对齐
    expect(result.delaySec).toBeCloseTo(0.4, 5);
  });
});
