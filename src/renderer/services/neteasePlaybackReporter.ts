import { watch } from 'vue';

import { usePlatformAccountsStore } from '@/store/modules/platformAccounts';
import { useSettingsStore } from '@/store/modules/settings';
import { useUserStore } from '@/store/modules/user';

import { audioService } from './audioService';
import {
  NeteaseListenTracker,
  NeteaseReportGate,
  neteaseReportSongId
} from './neteaseListenTracker';
import { sendNeteasePlaybackReport } from './neteasePlaybackRequest';

export function useNeteaseReportAccount() {
  const accounts = usePlatformAccountsStore();
  const user = useUserStore();
  return () => {
    const active = accounts.activeAccount;
    if (active && active.platform !== 'netease') return null;
    const id = active?.userId ?? user.user?.userId;
    const login = active?.loginMethod ?? user.loginType;
    const cookie = active ? active.cookie : localStorage.getItem('token');
    const token = cookie?.match(/(?:^|;\s*)MUSIC_U\s*=\s*([^;\s]+)/)?.[1];
    if (
      !Number.isSafeInteger(Number(id)) ||
      Number(id) <= 0 ||
      !login ||
      login === 'uid' ||
      !token
    ) {
      return null;
    }
    return { id: String(id), cookie: `MUSIC_U=${token}` };
  };
}

export function startNeteasePlaybackReporter() {
  const settings = useSettingsStore();
  const account = useNeteaseReportAccount();
  const enabledAccount = () => (settings.setData.neteasePlaybackReport ? account() : null);
  let current: ReturnType<typeof account> = null;
  let timer: number | undefined;
  const gate = new NeteaseReportGate();
  const tracker = new NeteaseListenTracker((report) => {
    const latest = enabledAccount();
    if (!latest || latest.id !== current?.id || latest.cookie !== current.cookie) return;
    void gate.submit(performance.now(), () => sendNeteasePlaybackReport(report, latest.cookie));
  });

  const sample = (discontinuity = false, ended = false) => {
    if (!current) return;
    const sound = audioService.getCurrentSound();
    const songId = neteaseReportSongId(audioService.getCurrentTrack());
    const position = audioService.getCurrentPosition();
    if (!sound || !songId || position === null) {
      tracker.sample(null);
      return;
    }
    try {
      const duration = sound.duration();
      tracker.sample(
        {
          sound,
          songId,
          duration,
          position: ended && Number.isFinite(duration) && duration > 0 ? duration : position,
          playing: !ended && sound.playing() && !audioService.isLoading(),
          rate: audioService.getPlaybackRate(),
          now: performance.now()
        },
        discontinuity
      );
    } catch {
      // An audio instance can be disposed while sampling. Preserve player event handling.
      tracker.sample(null);
    }
  };
  const update = () => sample();
  const seeked = () => sample(true);
  const ended = () => {
    sample(false, true);
    tracker.finish();
  };
  const refresh = () => {
    const next = enabledAccount();
    if (next?.id === current?.id && next?.cookie === current?.cookie) return;
    tracker.reset();
    window.clearInterval(timer);
    current = next;
    if (current) {
      update();
      timer = window.setInterval(update, 250);
    }
  };
  const stopWatch = watch(enabledAccount, refresh, { immediate: true, flush: 'sync' });
  window.addEventListener('storage', refresh);
  audioService.on('play', update);
  audioService.on('pause', update);
  audioService.on('seek_start', update);
  audioService.on('seek', seeked);
  audioService.on('playback-report-sample', update);
  audioService.on('playback-report-end', ended);
  return () => {
    stopWatch();
    window.clearInterval(timer);
    window.removeEventListener('storage', refresh);
    audioService.off('play', update);
    audioService.off('pause', update);
    audioService.off('seek_start', update);
    audioService.off('seek', seeked);
    audioService.off('playback-report-sample', update);
    audioService.off('playback-report-end', ended);
    tracker.reset();
  };
}
