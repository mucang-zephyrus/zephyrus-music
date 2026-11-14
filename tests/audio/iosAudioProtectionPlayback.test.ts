import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const protection = vi.hoisted(() => ({ enabled: false, listeners: [] as Array<() => void> }));
vi.mock('@/services/iosAudioProtection', () => ({
  iosAudioProtection: {
    get enabled() {
      return protection.enabled;
    },
    subscribe: (listener: () => void) => protection.listeners.push(listener)
  }
}));
vi.mock('@/utils', () => ({ isElectron: false }));
vi.mock('@/services/androidNative', () => ({ isAndroidNative: () => false }));
vi.mock('@/services/climaxDetector', () => ({ climaxDetector: { disconnect: vi.fn() } }));
vi.mock('@/services/leadDetector', () => ({
  disconnectAnalysisNodes: vi.fn(),
  connectAnalysisNodes: vi.fn()
}));
vi.mock('@/services/drumDetector', () => ({ drumDetector: {} }));
vi.mock('@/services/localAudioPlayer', () => ({ LocalAudioPlayer: class {} }));
vi.mock('@/services/nativeAudioPlayer', () => ({ NativeAudioPlayer: class {} }));
vi.mock('@/services/audioAnalysisGate', () => ({
  isWebAnalysisPlatform: () => true,
  isAnalysisArmed: () => true,
  probeAnalysisCapability: vi.fn(),
  armHowlForAnalysis: vi.fn(),
  disarmHowlAudio: vi.fn()
}));
vi.mock('howler', () => ({
  Howl: class {
    volume = vi.fn();
    rate = vi.fn();
    seek = vi.fn(() => 12);
    duration = () => 200;
    playing = () => true;
    play = vi.fn();
    stop = vi.fn();
    unload = vi.fn();
    state = () => 'loaded';
    on = vi.fn();
    off = vi.fn();
    once = vi.fn();
  },
  Howler: { ctx: { state: 'suspended', resume: vi.fn(() => new Promise(() => {})) } }
}));

import { Howl, Howler } from 'howler';

import {
  armHowlForAnalysis,
  disarmHowlAudio,
  probeAnalysisCapability
} from '@/services/audioAnalysisGate';
import { audioService } from '@/services/audioService';

const service = audioService as any;
const track = { id: 1, name: 'test', ar: [{ name: 'artist' }], al: { name: 'album' } } as any;
let mediaSession: {
  metadata: unknown;
  playbackState: string;
  setActionHandler: ReturnType<typeof vi.fn>;
  setPositionState: ReturnType<typeof vi.fn>;
};

describe('iOS protection playback integration', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    protection.enabled = false;
    service.currentSound = null;
    service.currentTrack = null;
    service.pendingSound = null;
    service.gainNode = null;
    mediaSession = {
      metadata: { title: 'old' },
      playbackState: 'playing',
      setActionHandler: vi.fn(),
      setPositionState: vi.fn()
    };
    vi.stubGlobal('navigator', { mediaSession });
    vi.stubGlobal(
      'MediaMetadata',
      class {
        constructor(public data: unknown) {}
      }
    );
    localStorage.clear();
  });
  afterEach(() => {
    service.currentSound = null;
    service.forceResetOperationLock();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('clears all notification state immediately without reloading the current sound', () => {
    const sound = new Howl({ src: ['test.mp3'] });
    service.currentSound = sound;
    protection.enabled = true;
    protection.listeners.forEach((listener) => listener());
    expect(mediaSession.metadata).toBeNull();
    expect(mediaSession.playbackState).toBe('none');
    expect(mediaSession.setActionHandler).toHaveBeenCalledTimes(8);
    for (const call of mediaSession.setActionHandler.mock.calls) expect(call[1]).toBeNull();
    expect(mediaSession.setPositionState).toHaveBeenCalledWith();
    expect(sound.stop).not.toHaveBeenCalled();
    expect(sound.unload).not.toHaveBeenCalled();
    expect(sound.seek).not.toHaveBeenCalled();
  });

  it('blocks lyrics, time, rate and playback events from recreating media notifications', () => {
    protection.enabled = true;
    service.currentSound = new Howl({ src: ['test.mp3'] });
    service.currentTrack = track;
    service.updateMediaSessionMetadata(track);
    service.setMediaSessionLyricTitle('lyric');
    service.updateMediaSessionState(true);
    service.updateMediaSessionPositionState();
    service.setPlaybackRate(1.25);
    expect(mediaSession.metadata).toEqual({ title: 'old' });
    expect(mediaSession.setPositionState).not.toHaveBeenCalled();
  });

  it('routes even analysis-armed preloads into the direct playback branch', async () => {
    protection.enabled = true;
    const direct = vi.spyOn(service, '_setupEQHowlMobile').mockResolvedValue(undefined);
    const analyzed = vi.spyOn(service, '_setupEQHowlWebAnalyzed').mockResolvedValue(undefined);
    await service.setupEQ(new Howl({ src: ['test.mp3'] }));
    expect(direct).toHaveBeenCalledTimes(1);
    expect(analyzed).not.toHaveBeenCalled();
  });

  it('plays without waiting for a suspended AudioContext or probing cross-origin access', async () => {
    protection.enabled = true;
    const sound = await service.play('https://example.com/test.mp3', track, true, 12);
    expect(sound.play).toHaveBeenCalled();
    expect(sound.seek).toHaveBeenCalledWith(12);
    expect(Howler.ctx.resume).not.toHaveBeenCalled();
    expect(probeAnalysisCapability).not.toHaveBeenCalled();
    expect(mediaSession.setPositionState).not.toHaveBeenCalled();
  });

  it('restores actions, track metadata and position when disabled', () => {
    service.currentSound = new Howl({ src: ['test.mp3'] });
    service.currentTrack = track;
    protection.enabled = false;
    protection.listeners.forEach((listener) => listener());
    expect(mediaSession.setActionHandler).toHaveBeenCalledTimes(8);
    for (const call of mediaSession.setActionHandler.mock.calls)
      expect(call[1]).toBeTypeOf('function');
    expect(mediaSession.metadata).not.toBeNull();
    expect(mediaSession.playbackState).toBe('playing');
    expect(mediaSession.setPositionState).toHaveBeenCalledWith({
      duration: 200,
      playbackRate: service.getPlaybackRate(),
      position: 12
    });
  });

  it('does not re-arm a stream if protection was enabled during a pending CORS probe', async () => {
    (Howler.ctx as any).state = 'running';
    vi.mocked(probeAnalysisCapability).mockImplementationOnce(async () => {
      protection.enabled = true;
      return true;
    });
    try {
      await service.play('https://example.com/test.mp3', track, true);
      expect(armHowlForAnalysis).not.toHaveBeenCalled();
      expect(disarmHowlAudio).toHaveBeenCalled();
    } finally {
      (Howler.ctx as any).state = 'suspended';
    }
  });
});
