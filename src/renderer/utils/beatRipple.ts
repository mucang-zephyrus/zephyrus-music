import tinycolor from 'tinycolor2';

// Wave shape and dot proportions ported from the supplied circular ripple demo.
export const RIPPLE_LIFE = 7;
export const RIPPLE_LIMIT = 7;
export interface BeatRipple {
  x: number;
  y: number;
  born: number;
  strength: number;
}
export interface RippleState {
  time: number;
  sequence: number;
  lastBeat: number;
  waves: BeatRipple[];
}
export function createRippleState(): RippleState {
  return { time: 0, sequence: 0, lastBeat: -Infinity, waves: [] };
}
/** Only called for real detector events. No periodic or pointer-generated waves. */
export function emitBeatRipple(state: RippleState, width: number, height: number, strong: boolean) {
  if (width <= 0 || height <= 0 || state.time - state.lastBeat < 0.14) return false;
  state.lastBeat = state.time;
  const seed = ++state.sequence;
  state.waves.push({
    x: width * (0.5 + Math.sin(seed * 2.39996) * 0.05),
    y: height * (0.5 + Math.cos(seed * 1.61803) * 0.05),
    born: state.time,
    strength: strong ? 1.15 : 0.75
  });
  if (state.waves.length > RIPPLE_LIMIT) state.waves.shift();
  return true;
}
/** A local animation clock: callers advance it only while visible and playing. */
export function advanceRipples(state: RippleState, seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return;
  state.time += Math.min(seconds, 0.1);
  state.waves = state.waves.filter((wave) => state.time - wave.born < RIPPLE_LIFE);
}
export function rippleAmplitude(x: number, y: number, state: RippleState) {
  let value = 0;
  for (const wave of state.waves) {
    const age = state.time - wave.born;
    if (age < 0 || age >= RIPPLE_LIFE) continue;
    const front = age * 110;
    const distance = Math.hypot(x - wave.x, y - wave.y);
    if (distance > front) continue;
    const q = distance / (front + 1e-4);
    const raw = Math.sin((front - distance) * 0.038);
    const shaped = Math.sign(raw) * Math.abs(raw) ** 0.72;
    // Ease both ends so retiring a wave cannot visibly cut a ring off.
    const attack = Math.min(1, age / 0.08);
    const release = Math.min(1, RIPPLE_LIFE - age);
    value += shaped * (1 - q * q) * Math.exp(-age * 0.32) * wave.strength * attack * release;
  }
  return Math.min(1, Math.abs(value) * 1.15);
}
export function rippleGrid(width: number, height: number, lowQuality = false) {
  const spacing = Math.max(
    width < 640 ? 18 : 24,
    Math.sqrt((width * height) / (lowQuality ? 3500 : 7000))
  );
  const columns = Math.ceil(width / spacing) + 1;
  const rows = Math.ceil(height / spacing) + 1;
  return {
    spacing,
    columns,
    rows,
    offsetX: (width - (columns - 1) * spacing) / 2,
    offsetY: (height - (rows - 1) * spacing) / 2
  };
}
/** Related hues drift slowly around the song color; neutral covers stay neutral. */
export function ripplePalette(theme: string, time: number) {
  const parsed = tinycolor(theme);
  const hsl = (parsed.isValid() ? parsed : tinycolor('#cbd5e1')).toHsl();
  return [-1, 0, 1].map((band) => {
    const color = tinycolor({
      h: hsl.h + Math.sin(time * 0.085 + band * 0.8) * 32 + band * 12,
      s: hsl.s < 0.08 ? 0 : Math.min(0.8, Math.max(0.35, hsl.s)),
      l: 0.67 + Math.sin(time * 0.06 + band) * 0.06
    }).toRgb();
    return { r: color.r, g: color.g, b: color.b };
  });
}
