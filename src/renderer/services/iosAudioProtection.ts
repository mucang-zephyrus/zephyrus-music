import { isIosSafari } from '@/utils/platform';

const STORAGE_KEY = 'ios-audio-protection';

type AudioSessionType =
  | 'auto'
  | 'playback'
  | 'ambient'
  | 'transient'
  | 'transient-solo'
  | 'play-and-record';
type AudioSession = { type: AudioSessionType };

function getAudioSession(): AudioSession | undefined {
  return (navigator as Navigator & { audioSession?: AudioSession }).audioSession;
}

/** iPad 的桌面 UA 也包括在内；原生壳由自己的音频会话管理。 */
export function isIosWeb(): boolean {
  if (!isIosSafari() || typeof window === 'undefined') return false;
  const host = window as Window & {
    electron?: unknown;
    AndroidNative?: unknown;
    Capacitor?: { isNativePlatform?: () => boolean };
  };
  return !host.electron && !host.AndroidNative && host.Capacitor?.isNativePlatform?.() !== true;
}

/**
 * ambient 是可混音的非独占会话。单独清空 MediaSession 不会改变系统音频焦点。
 * 此策略复用 HTMLAudioElement 直通分支，不把出声元素接入 Web Audio。
 * 只能减少其他播放会话的抢占，系统中断和后台回收仍由 iOS 决定。
 */
export class IosAudioProtection {
  private active = false;
  private decision: boolean | null = null;
  private previousType: AudioSessionType = 'auto';
  private listeners = new Set<() => void>();

  constructor() {
    if (!isIosWeb()) return;
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      this.decision = stored === 'enabled' ? true : stored === 'disabled' ? false : null;
    } catch {
      // 存储不可用时保留本次会话的选择。
    }
    if (this.decision && this.available) {
      try {
        this.apply(true);
      } catch {
        // 不把未成功设置的模式报告为已开启，用户可在设置页重试。
      }
    }
  }

  get available(): boolean {
    return isIosWeb() && typeof getAudioSession()?.type === 'string';
  }

  get enabled(): boolean {
    return this.active;
  }

  get hasDecision(): boolean {
    return this.decision !== null;
  }

  /** 启用调用只允许来自确认按钮，或先前已确认的持久化选择。 */
  setEnabled(enabled: boolean): void {
    this.apply(enabled);
    this.decision = enabled;
    try {
      localStorage.setItem(STORAGE_KEY, enabled ? 'enabled' : 'disabled');
    } catch {
      // 当前会话仍然生效。
    }
    this.listeners.forEach((listener) => listener());
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private apply(enabled: boolean): void {
    if (enabled === this.active) return;
    if (!this.available) throw new Error('当前系统不支持 iOS 防打断模式，请升级系统后重试。');
    const session = getAudioSession()!;
    if (enabled) {
      const previous = session.type;
      session.type = 'ambient';
      if (session.type !== 'ambient') throw new Error('系统未能启用防打断模式，请重试。');
      this.previousType = previous;
    } else {
      session.type = this.previousType;
      if (session.type !== this.previousType) throw new Error('系统未能关闭防打断模式，请重试。');
    }
    this.active = enabled;
  }
}

export const iosAudioProtection = new IosAudioProtection();
