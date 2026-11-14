import tinycolor from 'tinycolor2';

interface WeightedColor {
  r: number;
  g: number;
  b: number;
  weight: number;
}
interface ColorBucket {
  colors: WeightedColor[];
  weight: number;
}
export interface CoverPalette {
  colors: [string, string, string];
  representativeColors: string[];
}

const QUANTIZATION_SHIFT = 4;
const MIN_ALPHA = 128;

function channelRange(colors: WeightedColor[], channel: 'r' | 'g' | 'b') {
  let min = 255, max = 0;
  for (const color of colors) {
    min = Math.min(min, color[channel]);
    max = Math.max(max, color[channel]);
  }
  return max - min;
}

function splitBucket(bucket: ColorBucket): [ColorBucket, ColorBucket] | null {
  if (bucket.colors.length < 2) return null;
  const ranges = {
    r: channelRange(bucket.colors, 'r'),
    g: channelRange(bucket.colors, 'g'),
    b: channelRange(bucket.colors, 'b')
  };
  const channel = (['r', 'g', 'b'] as const).reduce((widest, candidate) =>
    ranges[candidate] > ranges[widest] ? candidate : widest
  );
  const sorted = [...bucket.colors].sort((a, b) => a[channel] - b[channel]);
  const midpoint = bucket.weight / 2;
  let accumulated = 0, splitAt = 1;
  for (let i = 0; i < sorted.length - 1; i++) {
    accumulated += sorted[i].weight;
    splitAt = i + 1;
    if (accumulated >= midpoint) break;
  }
  const left = sorted.slice(0, splitAt), right = sorted.slice(splitAt);
  return [
    { colors: left, weight: left.reduce((sum, color) => sum + color.weight, 0) },
    { colors: right, weight: right.reduce((sum, color) => sum + color.weight, 0) }
  ];
}

function averageBucket(bucket: ColorBucket): WeightedColor {
  const totals = bucket.colors.reduce(
    (sum, color) => ({
      r: sum.r + color.r * color.weight,
      g: sum.g + color.g * color.weight,
      b: sum.b + color.b * color.weight
    }),
    { r: 0, g: 0, b: 0 }
  );
  return {
    r: Math.round(totals.r / bucket.weight),
    g: Math.round(totals.g / bucket.weight),
    b: Math.round(totals.b / bucket.weight),
    weight: bucket.weight
  };
}

function colorHex({ r, g, b }: WeightedColor) {
  return `#${[r, g, b].map((value) => value.toString(16).padStart(2, '0')).join('')}`;
}

/** Folia-style population-weighted median-cut palette from RGBA pixels. */
export function extractRepresentativeColorsFromPixels(
  pixels: Uint8ClampedArray | Uint8Array,
  count = 5
): string[] {
  if (count <= 0) return [];
  const histogram = new Map<number, WeightedColor>();
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    if (pixels[i + 3] < MIN_ALPHA) continue;
    const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
    const key = ((r >> QUANTIZATION_SHIFT) << 8) | ((g >> QUANTIZATION_SHIFT) << 4) | (b >> QUANTIZATION_SHIFT);
    const existing = histogram.get(key);
    if (existing) {
      existing.r += r; existing.g += g; existing.b += b; existing.weight++;
    } else histogram.set(key, { r, g, b, weight: 1 });
  }
  const colors = [...histogram.values()].map((color) => ({
    r: Math.round(color.r / color.weight),
    g: Math.round(color.g / color.weight),
    b: Math.round(color.b / color.weight),
    weight: color.weight
  }));
  if (!colors.length) return [];
  const buckets: ColorBucket[] = [{
    colors,
    weight: colors.reduce((sum, color) => sum + color.weight, 0)
  }];
  while (buckets.length < Math.min(count, colors.length)) {
    let target = -1, bestScore = -1;
    for (let i = 0; i < buckets.length; i++) {
      const bucket = buckets[i];
      if (bucket.colors.length < 2) continue;
      const range = Math.max(...(['r', 'g', 'b'] as const).map((channel) => channelRange(bucket.colors, channel)));
      const score = range * Math.sqrt(bucket.weight);
      if (score > bestScore) { bestScore = score; target = i; }
    }
    if (target < 0) break;
    const split = splitBucket(buckets[target]);
    if (!split) break;
    buckets.splice(target, 1, ...split);
  }
  return buckets.map(averageBucket).sort((a, b) => b.weight - a.weight).map(colorHex);
}

function hashSeed(value: string) {
  let seed = 2166136261;
  for (let i = 0; i < value.length; i++) seed = Math.imul(seed ^ value.charCodeAt(i), 16777619);
  return seed >>> 0;
}
function seededRandom(value: string) {
  let state = hashSeed(value) || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}
function hueDistance(a: number, b: number) {
  const delta = Math.abs(a - b) % 360;
  return Math.min(delta, 360 - delta);
}
function normalizeHue(hue: number) { return ((hue % 360) + 360) % 360; }

/** Selects Folia-style base/support hues and makes a stable three-stop renderer palette. */
export function resolveCoverPalette(
  representativeColors: string[],
  seed: string,
  grayRatio = 0
): CoverPalette {
  const parsed = representativeColors
    .map((hex) => ({ hex, ...tinycolor(hex).toHsl() }))
    .filter((color) => tinycolor(color.hex).isValid());
  if (!parsed.length) {
    return { colors: ['#888888', '#888888', '#888888'], representativeColors: [] };
  }
  if (grayRatio > 0.95) {
    const neutral = parsed[0].hex;
    return { colors: [neutral, neutral, neutral], representativeColors };
  }
  const random = seededRandom(seed);
  const score = (color: (typeof parsed)[number]) =>
    color.s * Math.max(0, 1 - Math.abs(color.l - 0.5) * 1.2);
  const base = parsed.reduce((best, color) => score(color) > score(best) ? color : best);
  const support = parsed.find((color) => {
    const distance = hueDistance(color.h, base.h);
    return color.s >= 0.15 && distance >= 25 && distance <= 160;
  });
  let scheme: 'analogous' | 'complementary' | 'split' | 'triadic' | 'duotone' | 'monochrome';
  if (support && random() < 0.65) scheme = 'duotone';
  else {
    const options = [
      ['analogous', 3], ['complementary', 2], ['split', 2], ['triadic', 1.5],
      ['monochrome', base.s < 0.18 ? 2.5 : 0]
    ] as const;
    let cursor = random() * options.reduce((sum, option) => sum + option[1], 0);
    scheme = options.find((option) => (cursor -= option[1]) <= 0)?.[0] || 'analogous';
  }
  const sign = random() < 0.5 ? -1 : 1;
  let accentHue = base.h;
  if (scheme === 'duotone') accentHue = support?.h ?? base.h;
  else if (scheme === 'analogous') accentHue += sign * (20 + random() * 15);
  else if (scheme === 'complementary') accentHue += 150 + random() * 30;
  else if (scheme === 'split') accentHue += sign < 0 ? 150 : 210;
  else if (scheme === 'triadic') accentHue += sign * 120;
  if (scheme !== 'monochrome') accentHue += (random() - 0.5) * 16;
  const thirdHue = scheme === 'triadic' ? base.h - sign * 120 : base.h + (accentHue - base.h) * 0.52;
  const color = (h: number, s: number, l: number) => tinycolor({
    h: normalizeHue(h), s, l
  }).toHexString();
  const primary = base.s < 0.08 ? base.hex : color(base.h, base.s, base.l);
  const second = base.s < 0.08 ? primary : color(accentHue, Math.max(0.2, base.s * 0.88), Math.min(0.66, Math.max(0.38, base.l)));
  const third = base.s < 0.08 ? primary : color(thirdHue, Math.max(0.18, base.s * 0.72), Math.min(0.68, Math.max(0.4, base.l * 0.92)));
  return { colors: [primary, second, third], representativeColors };
}
