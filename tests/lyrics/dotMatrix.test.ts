import { describe, expect, it } from 'vitest';

import { createPlayerStyleConfig, resolvePlayerStyleConfig } from '@/config/playerStyleConfig';
import {
  buildMatrixLines,
  buildMatrixMask,
  createMatrixGrid,
  createReadableMatrixGrid,
  matrixCell,
  matrixEnvelope,
  matrixFallRows,
  matrixField,
  matrixLyricTargets,
  matrixPlayback,
  type MatrixRaster,
  stepMatrixLevel
} from '@/utils/dotMatrix';
import { MATRIX_FONT_SIZES, matrixFontFace } from '@/utils/dotMatrixFont';
import type { CloudInput } from '@/utils/wordCloud';
import { providerCloudInputs } from '@/utils/wordCloudInput';

const segment = (text: string) => [{ word: text, tag: 'x' }];
const raster: MatrixRaster = {
  measure: (text, size) => Array.from(text).length * size,
  pixels: (_text, _size, width) => Array.from({ length: width - 4 }, (_, x) => ({ x: x + 2, y: 3 }))
};
const timed: CloudInput = {
  text: '形状',
  begin: 2,
  words: [
    { text: '形', begin: 2, end: 2.4 },
    { text: '状', begin: 2.5, end: 3 }
  ]
};

describe('dot matrix lyric projection', () => {
  it('keeps source data, punctuation, spaces and real timing intact', () => {
    const original = JSON.stringify(timed);
    const lines = buildMatrixLines([timed], segment);
    expect(lines[0].tokens[0].begin).toBe(2);
    expect(lines[0].end).toBe(3);
    expect(lines[0].timed).toBe(true);
    expect(JSON.stringify(timed)).toBe(original);
    expect(buildMatrixLines([timed], segment)).toEqual(lines);
    const text = 'Hello,  世界！';
    const line = buildMatrixLines([{ text, begin: 0 }], () => [
      { word: 'Hello', tag: 'x' },
      { word: '世界', tag: 'x' }
    ])[0];
    expect(line.tokens.map((token) => token.text).join('')).toBe(text);
  });
  it('lights the entire segmented word on its real start, not estimated character times', () => {
    const grid = createMatrixGrid(400, 300, 8);
    const mask = buildMatrixMask(grid, buildMatrixLines([timed], segment), 12, raster);
    expect(mask.dots.length).toBeGreaterThan(0);
    expect([...matrixLyricTargets(mask, grid, 1.99, false, false)].some(Boolean)).toBe(false);
    const during = matrixLyricTargets(mask, grid, 2.08, false, false);
    for (const dot of mask.dots) expect(during[dot.index]).toBeCloseTo(0.5);
    const complete = matrixLyricTargets(mask, grid, 2.2, false, false);
    for (const dot of mask.dots) expect(complete[dot.index]).toBe(1);
  });
  it('ordinary LRC displays the full sentence without artificial word timing', () => {
    const lines = buildMatrixLines([{ text: '让每一拍都有形状', begin: 2, end: 20 }], segment);
    expect(lines[0].timed).toBe(false);
    expect(lines[0].explicitEnd).toBe(false);
    const grid = createMatrixGrid(400, 300, 8);
    const mask = buildMatrixMask(grid, lines, 12, raster);
    const targets = matrixLyricTargets(mask, grid, 2, true, false);
    for (const dot of mask.dots) expect(targets[dot.index]).toBe(1);
  });
  it('rejects mismatched or invalid word timing and falls back to a full line', () => {
    expect(buildMatrixLines([{ ...timed, text: '其他文字' }])[0].timed).toBe(false);
    expect(
      buildMatrixLines([{ ...timed, words: [{ text: '形状', begin: 2, end: 1 }] }])[0].timed
    ).toBe(false);
  });
  it('reuses display inputs, official auxiliary tracks and millisecond conversion', () => {
    const inputs = providerCloudInputs(
      [
        {
          text: '形状',
          startTime: 2000,
          duration: 1000,
          hasWordByWord: true,
          words: [{ text: '形状', startTime: 2000, duration: 1000 }],
          trText: 'Shape',
          romaText: 'xing zhuang'
        }
      ],
      'yrc'
    );
    const line = buildMatrixLines(inputs)[0];
    expect(line.begin).toBe(2);
    expect(line.end).toBe(3);
    expect(line.translation).toBe('Shape');
    expect(line.roman).toBe('xing zhuang');
  });
});

describe('dot matrix phases', () => {
  it('handles intro, real vocal gaps, background vocals, outro and backward seeks', () => {
    const lines = buildMatrixLines([
      timed,
      { text: '和声', begin: 3, end: 4, reliableEnd: true, background: true },
      { text: '下一句', begin: 10, end: 12, reliableEnd: true }
    ]);
    expect(matrixPlayback(lines, 1).phase).toBe('intro');
    expect(matrixPlayback(lines, 2.2).lines[0].text).toBe('形状');
    expect(matrixPlayback(lines, 3.5).lines[0].text).toBe('和声');
    expect(matrixPlayback(lines, 5).phase).toBe('interlude');
    expect(matrixPlayback(lines, 12).phase).toBe('outro');
    expect(matrixPlayback(lines, 2.5).lines[0].text).toBe('形状');
  });
  it('never treats parser-filled LRC duration as a real vocal end', () => {
    const lines = buildMatrixLines([
      { text: '长句', begin: 2, end: 5 },
      { text: '下句', begin: 24 }
    ]);
    expect(matrixPlayback(lines, 20).phase).toBe('singing');
    expect(matrixPlayback(lines, 20).lines[0].text).toBe('长句');
  });
  it('uses explicit blank timestamps for LRC interludes', () => {
    const lines = buildMatrixLines([
      { text: '前句', begin: 2 },
      { text: '', begin: 5 },
      { text: '后句', begin: 20 }
    ]);
    expect(matrixPlayback(lines, 6).phase).toBe('interlude');
    expect(matrixPlayback(lines, 20).lines[0].text).toBe('后句');
  });
  it('preserves simultaneous vocals and prioritizes the main singer', () => {
    const lines = buildMatrixLines(
      ['a', 'b', 'c'].map((text, i) => ({
        text,
        begin: 2,
        end: 4,
        reliableEnd: true,
        primary: i === 2
      }))
    );
    expect(matrixPlayback(lines, 3).lines.map((line) => line.text)).toEqual(['c', 'a']);
  });
  it('shows untimed lyrics statically and handles an empty source', () => {
    expect(matrixPlayback(buildMatrixLines([{ text: '静态歌词', begin: -1 }]), 50).phase).toBe(
      'static'
    );
    expect(matrixPlayback([], 0).lines).toEqual([]);
  });
});

describe('one fixed lattice for glyphs, falling and effects', () => {
  it.each([
    [1280, 800],
    [390, 844],
    [844, 390],
    [3840, 2160]
  ])('maps all lit points to background centers at %dx%d', (width, height) => {
    const grid = createMatrixGrid(width, height, 8);
    const lines = buildMatrixLines([{ text: '让每一拍都有形状', begin: 0 }], segment);
    const mask = buildMatrixMask(grid, lines, 22, raster);
    expect(buildMatrixMask(grid, lines, 22, raster)).toEqual(mask);
    expect(new Set(mask.dots.map((dot) => dot.index)).size).toBe(mask.dots.length);
    for (const dot of mask.dots) {
      expect(Number.isInteger(dot.index)).toBe(true);
      expect(dot.index).toBeLessThan(grid.columns * grid.rows);
      const center = matrixCell(
        grid,
        dot.index % grid.columns,
        Math.floor(dot.index / grid.columns)
      );
      expect(center.x / grid.step - 0.5).toBeCloseTo(Math.round(center.x / grid.step - 0.5));
      expect(center.y / grid.step - 0.5).toBeCloseTo(Math.round(center.y / grid.step - 0.5));
    }
  });
  it('falling illuminates whole grid rows and never changes the columns', () => {
    const grid = createMatrixGrid(400, 300, 8),
      lines = buildMatrixLines([timed], segment);
    const mask = buildMatrixMask(grid, lines, 12, raster);
    for (const age of [0.01, 0.08, 0.2, 0.28, 0.46]) {
      expect(Number.isInteger(matrixFallRows(age, false, true))).toBe(true);
      const target = matrixLyricTargets(mask, grid, 2 + age, true, false);
      const lit = [...target.entries()]
        .filter(([, value]) => value > 0)
        .map(([index]) => index % grid.columns);
      expect(lit.sort()).toEqual(mask.dots.map((dot) => dot.index % grid.columns).sort());
    }
    expect(matrixFallRows(0.08, true, true)).toBe(0);
    expect(matrixFallRows(0.08, false, false)).toBe(0);
  });
  it('wraps long lyrics inside the physical grid', () => {
    const grid = createMatrixGrid(390, 844, 8);
    const mask = buildMatrixMask(
      grid,
      buildMatrixLines([{ text: '这是很长的一句歌词'.repeat(10), begin: 0 }], segment),
      22,
      raster
    );
    expect(mask.bounds.left).toBeGreaterThanOrEqual(0);
    expect(mask.bounds.right).toBeLessThan(grid.columns);
    expect(mask.bounds.bottom).toBeLessThan(grid.rows);
  });
  it('keeps the final words of a dense sentence visible on phones', () => {
    const text = '这是很长的一句歌词'.repeat(10);
    const line = buildMatrixLines([{ text, begin: 0 }], (value) =>
      Array.from(value).map((word) => ({ word, tag: 'x' }))
    )[0];
    const grid = createMatrixGrid(390, 844, 8);
    const mask = buildMatrixMask(grid, [line], 22, raster);
    expect(new Set(mask.dots.map((dot) => dot.token)).size).toBe(line.tokens.length);
    expect(mask.bounds.bottom).toBeLessThan(grid.rows);
  });
  it('keeps diagonal sweeps at 45 degrees in wide viewports', () => {
    const grid = createMatrixGrid(1280, 720, 8);
    expect(matrixField('sweep', 30, 20, grid, 2)).toBeCloseTo(
      matrixField('sweep', 31, 19, grid, 2)
    );
  });
  it('colors ease continuously and smoothly reverse their current values', () => {
    expect(matrixEnvelope(0)).toBe(0);
    expect(matrixEnvelope(0.16)).toBe(1);
    expect(matrixEnvelope(0.58)).toBe(0);
    expect(matrixEnvelope(0.15999)).toBeCloseTo(matrixEnvelope(0.16001), 5);
    const value = stepMatrixLevel(0, 1, 1 / 60);
    expect(value).toBeGreaterThan(0);
    expect(value).toBeLessThan(1);
    const reversed = stepMatrixLevel(value, 0, 1 / 60);
    expect(reversed).toBeGreaterThan(0);
    expect(reversed).toBeLessThan(value);
    expect(stepMatrixLevel(value, 1, 0)).toBe(value);
  });
});

describe('dot matrix settings', () => {
  it('defaults to white, neutral dots and independent settings', () => {
    const config = createPlayerStyleConfig('dotMatrix');
    expect(config.solidColor).toBe('#ffffff');
    expect(config.dotShape).toBe('dot');
    expect(config.dotSpacing).toBe(8);
    expect(config.climaxUseThemeColor).toBe(false);
    expect(createPlayerStyleConfig('wordCloud')).not.toHaveProperty('dotSpacing');
  });
  it('sanitizes settings and preserves an explicitly disabled word drop', () => {
    const config = resolvePlayerStyleConfig('dotMatrix', {
      mode: 'custom',
      dotSpacing: 100,
      dotClimax: 'bogus' as never,
      effectWordDrop: false
    });
    expect(config.dotSpacing).toBe(14);
    expect(config.dotClimax).toBe('auto');
    expect(config.effectWordDrop).toBe(false);
  });
});

describe('native pixel font readability', () => {
  it('uses native outlines and integer scaling, including background vocals', () => {
    const seen = new Set<number>();
    const pixelRaster: MatrixRaster = {
      sizes: MATRIX_FONT_SIZES,
      measure: (text, size) => {
        seen.add(size);
        return Array.from(text).length * (size + 1);
      },
      pixels: raster.pixels
    };
    const lines = buildMatrixLines([
      { text: '让每一拍都有形状', begin: 0 },
      { text: '和声', begin: 0, end: 10, reliableEnd: true, background: true }
    ], segment);
    const mask = buildMatrixMask(createMatrixGrid(1280, 800, 8), lines, 22, pixelRaster);
    expect(mask.fits).toBe(true);
    for (const size of seen) expect(MATRIX_FONT_SIZES).toContain(size);
    expect(matrixFontFace(24)).toContain('12');
    expect(matrixFontFace(20)).toContain('10');
    expect(matrixFontFace(16)).toContain('8');
  });

  it.each([[390, 844], [844, 390]])(
    'fits dense lyrics without shrinking below native size at %dx%d',
    (width, height) => {
      const text = '这是很长的一句歌词'.repeat(10);
      const lines = buildMatrixLines([
        { text: '短句', begin: 0 },
        { text, begin: 10 }
      ], value => Array.from(value).map(word => ({ word, tag: 'x' })));
      const pixelRaster: MatrixRaster = {
        ...raster,
        sizes: MATRIX_FONT_SIZES,
        measure: (value, size) => Array.from(value).length * (size + 1)
      };
      const grid = createReadableMatrixGrid(width, height, 8, lines, pixelRaster);
      const mask = buildMatrixMask(grid, [lines[1]], 22, pixelRaster);
      expect(mask.fits).toBe(true);
      expect(mask.bounds.bottom).toBeLessThan(grid.rows);
      expect(new Set(mask.dots.map(dot => dot.token)).size).toBe(lines[1].tokens.length);
      expect(createReadableMatrixGrid(width, height, 8, lines, pixelRaster)).toEqual(grid);
    }
  );
});
