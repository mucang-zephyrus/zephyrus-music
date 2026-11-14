import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IosAudioProtection, isIosWeb } from '@/services/iosAudioProtection';

function mockIos(session: object | undefined = { type: 'auto' }) {
  vi.stubGlobal('navigator', {
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',
    platform: 'iPhone',
    maxTouchPoints: 5,
    audioSession: session
  });
  return session as { type: string };
}

describe('iOS audio protection policy', () => {
  beforeEach(() => {
    localStorage.clear();
    mockIos();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    localStorage.clear();
    delete (window as any).Capacitor;
  });

  it('detects iPad desktop UA while excluding actual Macs and native shells', () => {
    vi.stubGlobal('navigator', { userAgent: 'Macintosh', platform: 'MacIntel', maxTouchPoints: 5 });
    expect(isIosWeb()).toBe(true);
    (window as any).Capacitor = { isNativePlatform: () => false };
    expect(isIosWeb()).toBe(true);
    (window as any).Capacitor = { isNativePlatform: () => true };
    expect(isIosWeb()).toBe(false);
    delete (window as any).Capacitor;
    vi.stubGlobal('navigator', { userAgent: 'Macintosh', platform: 'MacIntel', maxTouchPoints: 0 });
    expect(isIosWeb()).toBe(false);
  });

  it('does not change audio focus before consent', () => {
    const session = mockIos();
    const policy = new IosAudioProtection();
    expect(policy.available).toBe(true);
    expect(policy.hasDecision).toBe(false);
    expect(policy.enabled).toBe(false);
    expect(session.type).toBe('auto');
  });

  it('enables ambient on confirmation and restores the previous session type on disable', () => {
    const session = mockIos({ type: 'playback' });
    const policy = new IosAudioProtection();
    const onChange = vi.fn();
    policy.subscribe(onChange);
    policy.setEnabled(true);
    expect(session.type).toBe('ambient');
    expect(policy.enabled).toBe(true);
    expect(localStorage.getItem('ios-audio-protection')).toBe('enabled');
    policy.setEnabled(false);
    expect(session.type).toBe('playback');
    expect(policy.enabled).toBe(false);
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('restores confirmed choice before audio initialization on a new page', () => {
    localStorage.setItem('ios-audio-protection', 'enabled');
    const session = mockIos();
    const policy = new IosAudioProtection();
    expect(session.type).toBe('ambient');
    expect(policy.enabled).toBe(true);
    expect(policy.hasDecision).toBe(true);
  });

  it('remembers cancellation without changing the audio session', () => {
    const session = mockIos();
    new IosAudioProtection().setEnabled(false);
    const policy = new IosAudioProtection();
    expect(policy.hasDecision).toBe(true);
    expect(policy.enabled).toBe(false);
    expect(session.type).toBe('auto');
  });

  it('does not apply an iOS preference to other platforms', () => {
    localStorage.setItem('ios-audio-protection', 'enabled');
    vi.stubGlobal('navigator', {
      userAgent: 'Windows',
      platform: 'Win32',
      audioSession: { type: 'auto' }
    });
    const policy = new IosAudioProtection();
    expect(policy.enabled).toBe(false);
    expect(policy.available).toBe(false);
    expect(() => policy.setEnabled(true)).toThrow();
  });

  it('does not claim protection on an unsupported system', () => {
    mockIos(undefined);
    // Passing undefined uses the helper default, so remove the capability explicitly.
    delete (navigator as any).audioSession;
    const policy = new IosAudioProtection();
    expect(policy.available).toBe(false);
    expect(() => policy.setEnabled(true)).toThrow('不支持');
    expect(policy.enabled).toBe(false);
    expect(policy.hasDecision).toBe(false);
  });

  it('retains the decision and media policy when the system rejects a change', () => {
    mockIos({
      get type() {
        return 'auto';
      },
      set type(_value) {
        throw new Error('denied');
      }
    });
    const policy = new IosAudioProtection();
    const listener = vi.fn();
    policy.subscribe(listener);
    expect(() => policy.setEnabled(true)).toThrow('denied');
    expect(policy.enabled).toBe(false);
    expect(localStorage.getItem('ios-audio-protection')).toBeNull();
    expect(listener).not.toHaveBeenCalled();
  });

  it('rejects a silently ignored ambient assignment', () => {
    mockIos({
      get type() {
        return 'auto';
      },
      set type(_value) {}
    });
    const policy = new IosAudioProtection();
    expect(() => policy.setEnabled(true)).toThrow('未能启用');
    expect(policy.enabled).toBe(false);
  });

  it('keeps the session usable when storage is unavailable', () => {
    const policy = new IosAudioProtection();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(() => policy.setEnabled(true)).not.toThrow();
    expect(policy.enabled).toBe(true);
    expect(policy.hasDecision).toBe(true);
  });
});
