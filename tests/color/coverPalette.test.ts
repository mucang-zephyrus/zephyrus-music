import { describe, expect, it } from 'vitest';

import {
  extractRepresentativeColorsFromPixels,
  resolveCoverPalette
} from '@/utils/coverPalette';

function pixels(...colors: Array<[number, number, number, number, number]>): Uint8ClampedArray {
  return new Uint8ClampedArray(colors.flatMap(([r, g, b, alpha, count]) =>
    Array.from({ length: count }, () => [r, g, b, alpha]).flat()
  ));
}

describe('cover palette', () => {
  it('uses population-weighted median cut and ignores transparent pixels', () => {
    const extracted = extractRepresentativeColorsFromPixels(
      pixels([230, 30, 35, 255, 40], [20, 70, 220, 255, 8], [0, 255, 0, 0, 200]),
      3
    );
    expect(extracted).toHaveLength(2);
    expect(extracted[0]).toMatch(/^#e/);
  });

  it('returns a stable tri-color palette and retains neutral gray covers', () => {
    const swatches = ['#d52d37', '#245acb', '#e3b322'];
    const first = resolveCoverPalette(swatches, 'song-1');
    expect(resolveCoverPalette(swatches, 'song-1')).toEqual(first);
    expect(first.colors).toHaveLength(3);
    const gray = resolveCoverPalette(['#777777', '#858585'], 'gray-cover', 0.99);
    expect(new Set(gray.colors).size).toBe(1);
  });

  it('selects supporting hues with visible separation', () => {
    const [primary, secondary, tertiary] = resolveCoverPalette(
      ['#d52d37', '#245acb', '#e3b322'],
      'cover'
    ).colors;
    expect(secondary).not.toBe(primary);
    expect(tertiary).not.toBe(primary);
  });
});
