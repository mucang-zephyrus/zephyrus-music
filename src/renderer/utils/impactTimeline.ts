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

export function buildImpactAccompaniment(inputs: readonly CloudInput[]) {
  const fields = ['background', 'duet'] as const;
  return fields
    .flatMap((field) => {
      const lines = inputs
        .map((line, index) => ({ line, index }))
        .filter(({ line }) => line[field] && hasImpactTime(line))
        .sort((a, b) => a.line.begin - b.line.begin);
      return lines.map(({ line, index }, position) => {
        const wordEnd = Math.max(line.begin, ...(line.words ?? []).map((word) => word.end));
        const next = lines.slice(position + 1).find((item) => item.line.begin > line.begin);
        const end =
          line.reliableEnd && line.end != null && line.end > line.begin
            ? line.end
            : wordEnd > line.begin
              ? wordEnd
              : (next?.line.begin ?? Infinity);
        return { key: `${field}:${index}`, field, text: line.text.trim(), begin: line.begin, end };
      });
    })
    .filter((line) => line.text);
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
  return lines.map((line, index) => {
    const following = lines[index + 1]?.begin ?? Infinity;
    const end =
      line.reliableEnd && line.end != null && line.end > line.begin
        ? Math.min(line.end, following)
        : following;
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
