import { describe, expect, it } from 'vitest';

import { createPlayerStyleConfig, resolvePlayerStyleConfig } from '@/config/playerStyleConfig';
import {
  advanceRipples,
  createRippleState,
  emitBeatRipple,
  RIPPLE_LIFE,
  RIPPLE_LIMIT,
  rippleAmplitude,
  rippleGrid,
  ripplePalette
} from '@/utils/beatRipple';

function advance(state: ReturnType<typeof createRippleState>, seconds: number) {
  for (let i = 0; i < Math.round(seconds * 100); i++) advanceRipples(state, 0.01);
}

describe('drum-triggered circular dot ripples', () => {
  it('never produces waves without an actual beat event', () => {
    const state = createRippleState();
    advance(state, 20);
    expect(state.waves).toEqual([]);
    expect(rippleAmplitude(400, 300, state)).toBe(0);
  });
  it('uses a small center offset and gives strong beats a larger amplitude', () => {
    const weak = createRippleState(),
      strong = createRippleState();
    expect(emitBeatRipple(weak, 800, 600, false)).toBe(true);
    emitBeatRipple(strong, 800, 600, true);
    expect(weak.waves[0].x).toBeGreaterThanOrEqual(360);
    expect(weak.waves[0].x).toBeLessThanOrEqual(440);
    expect(weak.waves[0].y).toBeGreaterThanOrEqual(270);
    expect(weak.waves[0].y).toBeLessThanOrEqual(330);
    advance(weak, 0.3);
    advance(strong, 0.3);
    const { x, y } = weak.waves[0];
    expect(rippleAmplitude(x, y, strong)).toBeGreaterThan(rippleAmplitude(x, y, weak));
  });
  it('preserves the original circular wavefront speed and shaped waveform', () => {
    const state = createRippleState();
    emitBeatRipple(state, 800, 600, true);
    advance(state, 1);
    const { x, y, strength } = state.waves[0];
    expect(rippleAmplitude(x + 111, y, state)).toBe(0);
    expect(rippleAmplitude(x + 60, y, state)).toBeCloseTo(rippleAmplitude(x, y + 60, state));
    const raw = Math.sin((110 - 60) * 0.038);
    const expected =
      Math.abs(
        Math.sign(raw) *
          Math.abs(raw) ** 0.72 *
          (1 - (60 / 110.0001) ** 2) *
          Math.exp(-0.32) *
          strength
      ) * 1.15;
    expect(rippleAmplitude(x + 60, y, state)).toBeCloseTo(Math.min(1, expected));
  });
  it('smoothly retires waves and removes expired history', () => {
    const state = createRippleState();
    emitBeatRipple(state, 800, 600, true);
    advance(state, RIPPLE_LIFE - 0.01);
    const { x, y } = state.waves[0];
    expect(rippleAmplitude(x, y, state)).toBeLessThan(0.01);
    advance(state, 0.02);
    expect(state.waves).toEqual([]);
  });
  it('debounces duplicate hits and caps simultaneous wave work', () => {
    const state = createRippleState();
    expect(emitBeatRipple(state, 0, 600, true)).toBe(false);
    emitBeatRipple(state, 800, 600, true);
    expect(emitBeatRipple(state, 800, 600, true)).toBe(false);
    for (let i = 0; i < 20; i++) {
      advance(state, 0.2);
      emitBeatRipple(state, 800, 600, i % 2 === 0);
    }
    expect(state.waves.length).toBe(RIPPLE_LIMIT);
    expect(state.waves[0].born).toBeGreaterThan(0);
    expect(rippleAmplitude(400, 300, state)).toBeGreaterThanOrEqual(0);
    expect(rippleAmplitude(400, 300, state)).toBeLessThanOrEqual(1);
  });
  it('does not fast-forward animation across a backgrounded frame', () => {
    const state = createRippleState();
    advanceRipples(state, 100);
    expect(state.time).toBe(0.1);
    advanceRipples(state, NaN);
    advanceRipples(state, -1);
    expect(state.time).toBe(0.1);
    expect(createRippleState().waves).toEqual([]);
  });
  it.each([
    [390, 844],
    [1440, 900],
    [3840, 2160]
  ])('keeps a centered bounded lattice at %dx%d', (width, height) => {
    const grid = rippleGrid(width, height);
    expect(grid.columns * grid.rows).toBeLessThan(7400);
    expect(grid.offsetX + ((grid.columns - 1) * grid.spacing) / 2).toBeCloseTo(width / 2);
    expect(grid.offsetY + ((grid.rows - 1) * grid.spacing) / 2).toBeCloseTo(height / 2);
    const low = rippleGrid(width, height, true);
    expect(low.columns * low.rows).toBeLessThan(3900);
  });
});

describe('ripple palette and saved preset', () => {
  it('changes related colors slowly and respects a neutral theme', () => {
    const a = ripplePalette('#b53e86', 0),
      b = ripplePalette('#b53e86', 10);
    expect(a).not.toEqual(b);
    const next = ripplePalette('#b53e86', 0.01);
    for (let i = 0; i < a.length; i++)
      for (const key of ['r', 'g', 'b'] as const)
        expect(Math.abs(next[i][key] - a[i][key])).toBeLessThanOrEqual(1);
    for (const color of ripplePalette('#777777', 30)) expect(color.r).toBe(color.g);
    for (const color of ripplePalette('invalid', 0))
      for (const value of Object.values(color)) expect(Number.isFinite(value)).toBe(true);
    expect(ripplePalette('#2f83d7', 0)).not.toEqual(a);
  });
  it('persists the optional preset without changing other style defaults', () => {
    const saved = JSON.parse(JSON.stringify({ mode: 'custom', cloudBackground: 'ripple' }));
    expect(resolvePlayerStyleConfig('wordCloud', saved).cloudBackground).toBe('ripple');
    expect(createPlayerStyleConfig('wordCloud').cloudBackground).toBe('cover');
    expect(createPlayerStyleConfig('dotMatrix')).not.toHaveProperty('cloudBackground');
  });
});
