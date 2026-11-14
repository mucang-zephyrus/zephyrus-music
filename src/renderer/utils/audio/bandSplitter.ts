/**
 * bandSplitter.ts — Level 3: 时频域智能拼接
 *
 * 使用 BiquadFilterNode 将音频拆分为 3 个频段，
 * 对每个频段独立控制淡出曲线：
 *   低频 (20-250Hz)：晚淡出（保留节奏感）
 *   中频 (250-4000Hz)：早淡出（避免人声打架）
 *   高频 (4000-20000Hz)：中等淡出（平滑过渡）
 *
 * 使用 setTargetAtTime 实现指数衰减，比线性更自然。
 */

// 频段定义
export const BAND_SPLITPOINTS = {
  lowMid: 250, // 低频/中频分界
  midHigh: 4000 // 中频/高频分界
};

// 各频段淡出时机（0~1，相对于过渡时长的比例）
/** 低频平台段：过渡前 55% 两曲低频各自保持，之后才换手 */
export const BASS_SWAP_START = 0.55;

/** 频段分裂器：为指定 source 创建 3 路滤波器链 */
export interface BandSplitChain {
  low: {
    filter: BiquadFilterNode;
    gain: GainNode;
  };
  mid: {
    filter: BiquadFilterNode;
    gain: GainNode;
  };
  high: {
    filter: BiquadFilterNode;
    gain: GainNode;
  };
  /** 输出节点：连接到 masterGain */
  output: GainNode;
}

/**
 * 为一个 source 创建三频段分裂链
 *
 * source → lowpass(250) → gain_low ─┐
 * source → bandpass(250-4k) → gain_mid ├→ output → masterGain
 * source → highpass(4k) → gain_high ─┘
 *
 * @param ctx AudioContext
 * @param source 输入节点（AudioBufferSourceNode 或 GainNode）
 * @returns 分裂链描述
 */
export function createBandSplitChain(ctx: AudioContext, source: AudioNode): BandSplitChain {
  // 低频：lowpass 250Hz
  const lowFilter = ctx.createBiquadFilter();
  lowFilter.type = 'lowpass';
  lowFilter.frequency.value = BAND_SPLITPOINTS.lowMid;
  lowFilter.Q.value = 0.7;

  // 中频：bandpass 250~4000Hz（用 lowpass + highpass 串联实现，因为 BiquadFilter 的 bandpass 模式 Q 值不够灵活）
  // 实际上用 lowpass(4000) → highpass(250) 串联
  const midFilterLow = ctx.createBiquadFilter();
  midFilterLow.type = 'lowpass';
  midFilterLow.frequency.value = BAND_SPLITPOINTS.midHigh;
  midFilterLow.Q.value = 0.7;

  const midFilterHigh = ctx.createBiquadFilter();
  midFilterHigh.type = 'highpass';
  midFilterHigh.frequency.value = BAND_SPLITPOINTS.lowMid;
  midFilterHigh.Q.value = 0.7;

  // 高频：highpass 4000Hz
  const highFilter = ctx.createBiquadFilter();
  highFilter.type = 'highpass';
  highFilter.frequency.value = BAND_SPLITPOINTS.midHigh;
  highFilter.Q.value = 0.7;

  // 各频段独立 Gain
  const lowGain = ctx.createGain();
  const midGain = ctx.createGain();
  const highGain = ctx.createGain();

  // 输出混合
  const output = ctx.createGain();

  // 连接
  // 低频链
  source.connect(lowFilter);
  lowFilter.connect(lowGain);
  lowGain.connect(output);

  // 中频链（串联两个滤波器）
  source.connect(midFilterLow);
  midFilterLow.connect(midFilterHigh);
  midFilterHigh.connect(midGain);
  midGain.connect(output);

  // 高频链
  source.connect(highFilter);
  highFilter.connect(highGain);
  highGain.connect(output);

  return {
    low: { filter: lowFilter, gain: lowGain },
    mid: { filter: midFilterHigh, gain: midGain }, // 返回最后一个滤波器作为代表
    high: { filter: highFilter, gain: highGain },
    output
  };
}

/**
 * 拆除频段分裂链（过渡结束后调用）
 */
export function destroyBandSplitChain(
  source: AudioNode,
  chain: BandSplitChain,
  masterGain: GainNode
): void {
  try {
    // 先断开各频段到 output 的连接
    chain.low.gain.disconnect();
    chain.mid.gain.disconnect();
    chain.high.gain.disconnect();

    // 断开 source 到各滤波器的连接
    chain.low.filter.disconnect();
    chain.mid.filter.disconnect();
    chain.high.filter.disconnect();

    // 断开 output
    chain.output.disconnect();

    // 重新直接连接 source → masterGain
    source.connect(masterGain);
  } catch {
    // 忽略断连错误
  }
}

/**
 * 应用三频段独立淡出/淡入曲线
 *
 * 使用 setTargetAtTime 实现指数衰减，比线性更自然。
 * tau = 时间常数，约等于 -60dB 衰减所需时间的 1/6
 *
 * 注意：调用方应在调用前把 gainOut / gainIn 的 .gain 设为 1（_passthrough），
 * 把音量缩放完全交给频段 gain，避免与外层 EQ gainNode 的用户音量相乘导致双重缩放。
 *
 * 曲线形状（借鉴 DJ 的 bass swap，见 Folia automix §6.5）：
 * - 中/高频：全程等功率余弦（out = cos、in = sin），用分段线性逼近——
 *   不用 `setValueCurveAtTime`，因为运行中的曲线无法被 `cancelScheduledValues` 取消，
 *   用户在过渡中途暂停/切歌时会抛 NotSupportedError。
 * - 低频：前 55% 保持原音量不动（平台段），之后才与进场曲换手。
 *   「淡化」的听感签名是出场曲从头滑到底；「混音」的签名是出场曲一直在、然后走掉。
 *   平台段两曲等强、全频谱只有一个低音，这正是那个 DJ 动作，也是它不糊的原因。
 *
 * @param ctx AudioContext
 * @param chainOut 淡出歌曲的分裂链
 * @param chainIn 淡入歌曲的分裂链
 * @param startTime 过渡开始时间（AudioContext.currentTime）
 * @param duration 过渡时长（秒）
 * @param volumeScale 音量缩放（0~1），各频段起始/目标值会乘以该系数
 */
export function applyBandSplitCrossfade(
  _ctx: AudioContext,
  chainOut: BandSplitChain,
  chainIn: BandSplitChain,
  startTime: number,
  duration: number,
  volumeScale: number = 1
): void {
  const v = Math.max(0, Math.min(1, volumeScale));
  const swapStart = startTime + duration * BASS_SWAP_START;

  // === 低频：平台 + 换手 ===
  chainOut.low.gain.gain.setValueAtTime(v, startTime);
  chainOut.low.gain.gain.linearRampToValueAtTime(v, swapStart);
  chainOut.low.gain.gain.linearRampToValueAtTime(0, startTime + duration);

  chainIn.low.gain.gain.setValueAtTime(0, startTime);
  chainIn.low.gain.gain.linearRampToValueAtTime(0, swapStart);
  chainIn.low.gain.gain.linearRampToValueAtTime(v, startTime + duration);

  // === 中/高频：全程等功率 ===
  scheduleEqualPower(chainOut.mid.gain.gain, v, startTime, duration, 'out');
  scheduleEqualPower(chainOut.high.gain.gain, v, startTime, duration, 'out');
  scheduleEqualPower(chainIn.mid.gain.gain, v, startTime, duration, 'in');
  scheduleEqualPower(chainIn.high.gain.gain, v, startTime, duration, 'in');
}

/** 等功率余弦的分段线性逼近：10 段的最大偏差 <1%，且随时可被 cancelScheduledValues 中断 */
function scheduleEqualPower(
  param: AudioParam,
  v: number,
  startTime: number,
  duration: number,
  direction: 'out' | 'in'
): void {
  const steps = 10;
  param.setValueAtTime(direction === 'out' ? v : 0, startTime);
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const shaped = direction === 'out' ? Math.cos((t * Math.PI) / 2) : Math.sin((t * Math.PI) / 2);
    param.linearRampToValueAtTime(shaped * v, startTime + t * duration);
  }
}
