import type { SongResult } from '@/types/music';

export interface PlaybackSample {
  sound: object;
  songId: number;
  position: number;
  duration: number;
  playing: boolean;
  rate: number;
  now: number;
}

export interface PlaybackReport {
  id: number;
  time: number;
  total: number;
}

export function neteaseReportSongId(song: SongResult | null): number | null {
  if (!song || (song.platform && song.platform !== 'netease') || song.program) return null;
  if (song.playMusicUrl && /^(local|blob|file|data):/i.test(song.playMusicUrl)) return null;
  const track = song as SongResult & { pc?: unknown; simpleSong?: unknown };
  if (track.pc || track.simpleSong || song.song?.pc || song.song?.simpleSong) return null;
  if (!/^\d+$/.test(String(song.id))) return null;
  const id = Number(song.id);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export class NeteaseListenTracker {
  private last: PlaybackSample | null = null;
  private listened = 0;
  private mediaPlayed = 0;

  constructor(private readonly report: (report: PlaybackReport) => void) {}

  sample(next: PlaybackSample | null, discontinuity = false) {
    const previous = this.last;
    if (!previous && !next?.playing) return;

    // A replacement at the current playhead (such as quality change or recovery) keeps the round.
    const continued =
      next &&
      previous &&
      next.songId === previous.songId &&
      next.position > 1 &&
      Math.abs(next.position - previous.position) <= 3;
    const restarted = next && previous && next.position <= 1 && previous.position > 1;
    if (
      previous &&
      (!next ||
        next.songId !== previous.songId ||
        (next.sound !== previous.sound && !continued) ||
        restarted)
    ) {
      this.finish();
    } else if (previous && next && previous.sound === next.sound && !discontinuity) {
      const wall = (next.now - previous.now) / 1000;
      const advanced = next.position - previous.position;
      const rate = previous.rate;
      // Ignore stalls, unobserved background time, and jumps outside a small sampling tolerance.
      if (
        previous.playing &&
        rate > 0 &&
        wall > 0 &&
        wall <= 3 &&
        advanced > 0 &&
        advanced <= wall * rate + 0.15
      ) {
        this.listened += advanced / rate;
        this.mediaPlayed += advanced;
      }
    }
    if (this.last || next?.playing) this.last = next;
  }

  finish() {
    const last = this.last;
    const time = Math.floor(this.mediaPlayed + 1e-6);
    const eligible = this.listened + 1e-6 >= 30;
    this.reset();
    if (!last || !eligible || time < 1 || !Number.isFinite(last.duration) || last.duration <= 0)
      return;
    const total = Math.ceil(last.duration);
    this.report({ id: last.songId, time: Math.min(time, total), total });
  }

  reset() {
    this.last = null;
    this.listened = 0;
    this.mediaPlayed = 0;
  }
}

export class NeteaseReportGate {
  private attempts: number[] = [];
  private inFlight = false;

  async submit(now: number, send: () => Promise<unknown>) {
    this.attempts = this.attempts.filter((attempt) => now - attempt < 3_600_000);
    const lastAttempt = this.attempts.at(-1);
    if (
      this.inFlight ||
      this.attempts.length >= 60 ||
      (lastAttempt !== undefined && now - lastAttempt < 5000)
    )
      return;
    this.inFlight = true;
    this.attempts.push(now);
    try {
      await send();
    } catch {
      // Never retry a write that the upstream may already have received.
    } finally {
      this.inFlight = false;
    }
  }
}
