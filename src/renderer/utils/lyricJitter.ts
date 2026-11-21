export const LYRIC_JITTER_INTERVAL_MS = 90;

export function lyricBeatSpike(strong: boolean, kickEnergy: number) {
  return (strong ? 0.5 : 0.28) * (0.6 + kickEnergy * 0.4);
}

export function sampleLyricJitter(
  base: number,
  frameAmplitude: number,
  climax: boolean,
  beatSpike: number,
  random = Math.random
) {
  if (base <= 0.02) return { x: 0, y: 0 };
  const amplitude = base * frameAmplitude * (climax ? 2.2 : 1) + beatSpike * 1.2;
  return { x: (random() * 2 - 1) * amplitude, y: (random() * 2 - 1) * amplitude };
}
