import type { CloudInput } from './wordCloud';

export interface ImpactWord {
  text: string;
  begin: number;
  hit: number;
}

export interface ImpactLine {
  key: string;
  text: string;
  begin: number;
  end: number;
  words: ImpactWord[];
}

const hasImpactTime = (line: CloudInput) => Number.isFinite(line.begin) && line.begin >= 0;

export function impactText(text: string, uppercase: boolean) {
  return uppercase ? text.replace(/\p{Script=Latin}+/gu, (letters) => letters.toUpperCase()) : text;
}

function impactLineEnd(line: CloudInput, fallback: number) {
  if (line.reliableEnd && line.end != null && Number.isFinite(line.end) && line.end > line.begin)
    return line.end;
  const wordEnd = Math.max(
    line.begin,
    ...(line.words ?? [])
      .filter((word) => word.text.trim() && Number.isFinite(word.end) && word.end > word.begin)
      .map((word) => word.end)
  );
  return wordEnd > line.begin ? wordEnd : fallback;
}

export function buildImpactAccompaniment(inputs: readonly CloudInput[]) {
  const timed = inputs
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => hasImpactTime(line))
    .sort((a, b) => a.line.begin - b.line.begin);
  return timed
    .flatMap(({ line, index }) => {
      const field = line.background ? 'background' : line.duet ? 'duet' : undefined;
      const text = line.text.trim();
      if (!field || !text) return [];
      const next = timed.find((item) => item.line.begin > line.begin);
      const end = impactLineEnd(line, next?.line.begin ?? Infinity);
      return [{ key: `${field}:${index}`, field, text, begin: line.begin, end }];
    })
    .sort((a, b) => Number(a.field === 'duet') - Number(b.field === 'duet'));
}

export type ImpactAccompaniment = ReturnType<typeof buildImpactAccompaniment>;

export function impactAccompanimentAt(lines: ImpactAccompaniment, time: number) {
  return lines.filter((line) => line.begin <= time && time < line.end);
}

export function buildImpactTimeline(
  inputs: readonly CloudInput[],
  wholeLine = false
): ImpactLine[] {
  const lines = inputs
    .filter((line) => !line.background && !line.duet && hasImpactTime(line))
    .sort((a, b) => a.begin - b.begin);
  const markers = [...new Set(lines.map((line) => line.begin))];
  const followingMarkers = new Map(markers.map((begin, index) => [begin, markers[index + 1]]));
  return lines
    .filter((line) => line.text.trim())
    .map((line, index) => {
      const following = followingMarkers.get(line.begin) ?? Infinity;
      const end = Math.min(impactLineEnd(line, following), following);
      const words = (wholeLine ? [] : (line.words ?? []))
        .filter((word) => word.text.trim() && Number.isFinite(word.begin) && word.begin < end)
        .map((word) => ({ text: word.text.trim(), begin: Math.max(word.begin, line.begin) }))
        .sort((a, b) => a.begin - b.begin);
      return {
        key: `${index}:${line.begin}`,
        text: line.text.trim(),
        begin: line.begin,
        end,
        words: words.map((word, wordIndex) => ({
          ...word,
          hit:
            word.begin +
            Math.min(0.09, (Math.min(end, words[wordIndex + 1]?.begin ?? end) - word.begin) * 0.65)
        }))
      };
    });
}

function lastStarted<T>(entries: readonly T[], time: number, start: (entry: T) => number) {
  let left = 0;
  let right = entries.length;
  while (left < right) {
    const middle = (left + right) >>> 1;
    if (start(entries[middle]) <= time) left = middle + 1;
    else right = middle;
  }
  return left - 1;
}

interface VocalRange {
  begin: number;
  end: number;
}

export function buildImpactVocalRanges(
  timeline: readonly ImpactLine[],
  accompaniment: ImpactAccompaniment
) {
  const ranges: VocalRange[] = [];
  for (const { begin, end } of [...timeline, ...accompaniment].sort((a, b) => a.begin - b.begin)) {
    if (end <= begin) continue;
    const previous = ranges.at(-1);
    if (previous && begin <= previous.end) previous.end = Math.max(previous.end, end);
    else ranges.push({ begin, end });
  }
  return ranges;
}

export function impactSceneAt(
  ranges: readonly VocalRange[],
  time: number,
  hasArtist: boolean,
  reduced: boolean,
  duration: number
) {
  const index = lastStarted(ranges, time, (range) => range.begin);
  const previous = ranges[index];
  const next = ranges[index + 1];
  const still = { opacity: 1, edgeLight: 0 };
  if (previous && time < previous.end) return { phase: 'vocals', card: null, ...still } as const;
  if (!previous && next) {
    const midpoint = next.begin / 2;
    const twoCards = hasArtist && next.begin >= 2;
    const distance = Math.abs(time - midpoint);
    const blend = twoCards && !reduced ? 1 - clampUnit(distance / 0.22) : 0;
    return {
      phase: 'intro',
      card: twoCards && time >= midpoint ? 'artist' : 'title',
      opacity: 1 - 0.92 * blend,
      edgeLight: 0.32 * blend
    } as const;
  }
  if (previous && next) {
    const gap = next.begin - previous.end;
    if (gap < 2 - 1e-6) return { phase: 'interlude', card: null, ...still } as const;
    const distance = Math.min(time - previous.end, next.begin - time);
    return {
      phase: 'interlude',
      card: 'title',
      ...still,
      opacity: reduced ? 1 : 0.18 + 0.82 * clampUnit(distance / 0.22)
    } as const;
  }
  if (previous) {
    const remaining = duration - previous.end;
    const fade = remaining > 0 ? Math.min(remaining, 0.22) : 0.22;
    return {
      phase: 'outro',
      card: 'title',
      ...still,
      opacity: reduced ? 1 : 0.18 + 0.82 * clampUnit((time - previous.end) / fade)
    } as const;
  }
  return { phase: 'instrumental', card: 'title', ...still } as const;
}

export function impactFrame(lines: readonly ImpactLine[], time: number, reduced: boolean) {
  const index = lastStarted(lines, time, (line) => line.begin);
  const line = lines[index];
  if (!line?.text || time >= line.end) return null;
  const active = lastStarted(line.words, time, (word) => word.begin);
  const landed = lastStarted(line.words, time, (word) => (reduced ? word.begin : word.hit)) + 1;
  const last = line.words[landed - 1];
  const hitAge = last ? time - (reduced ? last.begin : last.hit) : Infinity;
  return { line, active, landed, hitAge, shattered: landed > 0 && landed === line.words.length };
}

export const SHARD_LIFETIME = 0.7;

export function impactShatters(lines: readonly ImpactLine[], time: number, reduced: boolean) {
  const shatters: { line: ImpactLine; age: number }[] = [];
  const latest = lastStarted(lines, time, (line) => line.begin);
  for (let index = latest; index >= 0; index--) {
    const line = lines[index];
    if (line.end <= time - SHARD_LIFETIME) break;
    const finalWord = line.words.at(-1);
    if (!line.text || !finalWord) continue;
    const age = time - (reduced ? finalWord.begin : finalWord.hit);
    if (age >= 0 && age < SHARD_LIFETIME) shatters.push({ line, age });
  }
  return shatters.reverse();
}

export function impactRandom(value: string) {
  let seed = 2166136261;
  for (let i = 0; i < value.length; i++) seed = Math.imul(seed ^ value.charCodeAt(i), 16777619);
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
    return (seed >>> 0) / 4294967296;
  };
}

export const clampUnit = (value: number) => Math.max(0, Math.min(1, value));

export type GlassPoint = readonly [number, number];

/** A perimeter fan with shared, jagged edges. Every sector uses the same crack as its neighbor. */
export function glassGeometry(width: number, height: number, seed: string) {
  const random = impactRandom(seed);
  const center: GlassPoint = [width / 2, height / 2];
  const perimeter: GlassPoint[] = [
    [0, 0],
    [width * (0.28 + random() * 0.14), 0],
    [width * (0.65 + random() * 0.1), 0],
    [width, 0],
    [width, height * (0.21 + random() * 0.15)],
    [width, height * (0.66 + random() * 0.15)],
    [width, height],
    [width * (0.65 + random() * 0.1), height],
    [width * (0.18 + random() * 0.14), height],
    [0, height],
    [0, height * (0.64 + random() * 0.13)],
    [0, height * (0.15 + random() * 0.17)]
  ];
  const cracks = perimeter.map(([x, y]) => [
    center,
    ...[0.12, 0.25, 0.44, 0.67, 0.85].map(
      (part): GlassPoint => [
        center[0] + (x - center[0]) * part + (random() - 0.5) * width * 0.057,
        center[1] + (y - center[1]) * part + (random() - 0.5) * height * 0.057
      ]
    ),
    [x, y] as GlassPoint
  ]);
  return {
    cracks,
    shards: cracks.map((edge, index) => [
      ...edge,
      ...cracks[(index + 1) % cracks.length].slice(1).reverse()
    ])
  };
}
