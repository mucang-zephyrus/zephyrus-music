import tinycolor from 'tinycolor2';
import { describe, expect, it } from 'vitest';

import { createPlayerStyleConfig, resolvePlayerStyleConfig } from '@/config/playerStyleConfig';
import type { TtmlLyric } from '@/services/ttmlParser';
import { isMobilePlayerStyleKey } from '@/types/playerStyle';
import { exportStyleVideo, type StyleVideoExportInput } from '@/utils/videoEngine';
import { getSkin } from '@/utils/videoRenderers/skins';
import {
  activeCloudLines,
  buildCloudLayout,
  cloudCameraTarget,
  type CloudInput,
  cloudOpacity,
  type CloudOptions,
  cloudOverlap,
  cloudPalette,
  cloudPhase,
  cloudPoint,
  cloudReadingPoint,
  estimateCloudDuration,
  fitCloudLayoutToViewport,
  mapCloudTiming,
  segmentCloudText,
  stepCloudCamera
} from '@/utils/wordCloud';
import { createCloudMotion, stepCloudMotion } from '@/utils/wordCloudCamera';
import { providerCloudInputs, ttmlCloudInputs } from '@/utils/wordCloudInput';
import { migrateWordCloudSettings } from '@/utils/wordCloudMigration';

const options: CloudOptions = { scale: 1, spacing: 1, vertical: 0.3 };
const measure = (text: string, size: number) => Array.from(text).length * size * 0.6;
const build = (lines: CloudInput[], opts = options) =>
  buildCloudLayout(lines, 'song:1', opts, measure);
const view = { x: 20, y: 80, width: 650, height: 420 };
const singing = { kind: 'singing' as const, next: -1 };
const zeroVelocity = { x: 0, y: 0, scale: 0, angle: 0 };

describe('word cloud display projection', () => {
  it.each(['明天，世界！  hello\nagain', 'A🙂 é Привет العربية', '同一句 同一句', ''])(
    'preserves text and UTF-16 offsets: %s',
    (text) => {
      const segments = segmentCloudText(text);
      expect(segments.map((s) => s.text).join('')).toBe(text);
      for (const part of segments)
        expect(text.slice(part.offset, part.offset + part.text.length)).toBe(part.text);
    }
  );
  it('restores tokenizer-omitted punctuation and spaces without invented POS', () => {
    const segments = segmentCloudText('明天， 世界', () => [
      { word: '明天', tag: 'n' },
      { word: '世界', tag: 'n' }
    ]);
    expect(segments.map((s) => s.text).join('')).toBe('明天， 世界');
    expect(segments[1]).toEqual({ text: '， ', offset: 2, tag: 'x' });
    expect(
      segmentCloudText('hello', () => {
        throw Error('unavailable');
      }).every((s) => s.tag === 'x')
    ).toBe(true);
  });
  it('maps multiple original time slices to one lexical word without distributing time', () => {
    const input = {
      text: '明天',
      begin: 2,
      words: [
        { text: '明', begin: 2, end: 2.2 },
        { text: '天', begin: 2.5, end: 3 }
      ]
    };
    const layout = buildCloudLayout([input], 'song', options, measure, () => [
      { word: '明天', tag: 'n' }
    ]);
    expect(layout.lines[0].tokens[0].slices).toEqual([
      { text: '明', offset: 0, begin: 2, end: 2.2 },
      { text: '天', offset: 1, begin: 2.5, end: 3 }
    ]);
  });
  it('falls back to line timing on unmatched text, zero duration or malformed timing', () => {
    for (const words of [
      [{ text: 'wrong', begin: 1, end: 2 }],
      [{ text: 'word', begin: 1, end: 1 }],
      [{ text: 'word', begin: NaN, end: 2 }]
    ]) {
      expect(mapCloudTiming({ text: 'word', begin: 1, words })).toBeNull();
      expect(build([{ text: 'word', begin: 1, words }]).lines[0].timedWords).toBe(false);
    }
  });
  it('accepts whitespace separators with no vocal duration', () => {
    expect(
      mapCloudTiming({
        text: 'a b',
        begin: 0,
        words: [
          { text: 'a', begin: 0, end: 1 },
          { text: ' ', begin: 1, end: 1 },
          { text: 'b', begin: 1, end: 2 }
        ]
      })
    ).toEqual([
      { text: 'a', offset: 0, begin: 0, end: 1 },
      { text: 'b', offset: 2, begin: 1, end: 2 }
    ]);
  });
  it('converts provider milliseconds once, retaining merged auxiliary text and original data', () => {
    const lines = [
      {
        text: '明天',
        startTime: 2500,
        duration: 1000,
        trText: 'tomorrow',
        romaText: 'ming tian',
        hasWordByWord: true,
        words: [
          { text: '明', startTime: 2500, duration: 200 },
          { text: '天', startTime: 2800, duration: 700 }
        ]
      }
    ];
    const before = structuredClone(lines);
    expect(providerCloudInputs(lines, 'yrc')[0]).toMatchObject({
      begin: 2.5,
      end: 3.5,
      translation: 'tomorrow',
      roman: 'ming tian',
      words: [
        { text: '明', begin: 2.5, end: 2.7 },
        { text: '天', begin: 2.8, end: 3.5 }
      ]
    });
    expect(lines).toEqual(before);
  });
  it('ignores parser-filled LRC duration and hidden credits but recognizes empty timestamp boundaries', () => {
    const lines = [
      { text: 'one', trText: '', startTime: 1000, duration: 49000 },
      { text: 'credit', trText: '', startTime: 2000, creditHidden: true },
      { text: '', trText: '', startTime: 8000 },
      { text: 'two', trText: '', startTime: 50000 }
    ];
    expect(providerCloudInputs(lines, 'lrc')[0]).toMatchObject({
      begin: 1,
      end: 8,
      reliableEnd: true
    });
    const ordinary = providerCloudInputs([lines[0], lines[3]], 'lrc')[0];
    expect(ordinary.end).toBeUndefined();
    expect(ordinary.reliableEnd).toBe(false);
    expect(
      providerCloudInputs([{ text: 'untimed', trText: '', startTime: -1 }], 'none')[0].begin
    ).toBe(-1);
  });
  it('preserves duet agents, TTML backing vocals and exact seconds', () => {
    const line = {
      text: 'main',
      begin: 2,
      end: 5,
      words: [{ text: 'main', begin: 2, end: 5 }],
      agent: 'a',
      translations: [{ text: '译文', role: 'translation' as const }],
      romanizations: [],
      isBackground: false,
      background: [
        {
          text: 'echo',
          begin: 3,
          end: 4,
          words: [{ text: 'echo', begin: 3, end: 4 }],
          translations: [],
          romanizations: []
        }
      ]
    };
    const lyric: TtmlLyric = {
      lines: [line, { ...line, agent: 'b', isBackground: true, background: [] }],
      duration: 5,
      timingMode: 'word',
      primaryAgent: 'a',
      agents: [],
      parts: [],
      meta: {}
    };
    const before = structuredClone(lyric),
      result = ttmlCloudInputs(lyric);
    expect(result).toHaveLength(3);
    expect(result[1]).toMatchObject({ background: true, parent: 0, begin: 3 });
    expect(result[2].background).toBeUndefined();
    expect(result[2].primary).toBe(false);
    const layout = build(result);
    expect(activeCloudLines(layout, 3.5).map((l) => l.text)).toEqual(['main', 'main']);
    const target = cloudCameraTarget(layout, 3.5, view, true, singing);
    expect(target.angle).toBe(-layout.lines[0].angle);
    expect(target).toEqual(
      cloudCameraTarget({ ...layout, lines: [layout.lines[0]] }, 3.5, view, true, singing)
    );
    expect(lyric).toEqual(before);
  });
});

describe('fixed word cloud layout', () => {
  it('keeps theme shades readable against the brightest washed background', () => {
    for (const theme of ['#ffffff', '#777777', '#0000ff', '#ff0000', '#00ff00']) {
      const palette = cloudPalette(theme);
      expect(palette).toHaveLength(12);
      for (const color of palette)
        expect(tinycolor.readability(color, '#565a60')).toBeGreaterThanOrEqual(4.5);
      if (theme === '#777777')
        expect(palette.every((color) => tinycolor(color).toHsl().s === 0)).toBe(true);
    }
  });
  const inputs = Array.from({ length: 120 }, (_, i) => ({
    text: `Repeat the same sentence ${i % 3}`,
    begin: i * 3
  }));
  it('is deterministic, retains repeated sentences and never mutates input', () => {
    const before = structuredClone(inputs),
      layout = build(inputs);
    expect(build(inputs)).toEqual(layout);
    expect(layout.lines).toHaveLength(inputs.length);
    expect(new Set(layout.lines.map((l) => l.id)).size).toBe(inputs.length);
    expect(inputs).toEqual(before);
  });
  it.each([0, 0.3, 0.6])(
    'packs horizontal/vertical rectangles without overlap, ratio %s',
    (vertical) => {
      const layout = build(inputs, { ...options, vertical });
      for (let i = 0; i < layout.lines.length; i++)
        for (let j = i + 1; j < layout.lines.length; j++) {
          expect(cloudOverlap(layout.lines[i].rect, layout.lines[j].rect, 15.9)).toBe(false);
        }
      expect(layout.lines.some((l) => l.angle === 0)).toBe(true);
      if (vertical) expect(layout.lines.some((l) => l.angle !== 0)).toBe(true);
    }
  );
  it('wraps long single tokens inside a sentence block', () => {
    const line = build([{ text: '长'.repeat(400), begin: 1 }]).lines[0];
    expect(line.localWidth).toBeLessThanOrEqual(560);
    expect(line.localHeight).toBeGreaterThan(100);
    expect(line.tokens.map((t) => t.text).join('')).toBe('长'.repeat(400));
  });
  it('handles a long song without overlaps or allocating a full-song bitmap', () => {
    const input = Array.from({ length: 1000 }, (_, i) => ({
      text: `Line ${i} repeats forever`,
      begin: i * 3
    }));
    const layout = build(input);
    expect(layout.lines).toHaveLength(1000);
    expect(Number.isFinite(layout.bounds.width * layout.bounds.height)).toBe(true);
    // Article columns share x for hundreds of distant rows. Sweep by y so this
    // still checks every potential collision without quadratic assertions.
    const sorted = [...layout.lines].sort((a, b) => a.rect.y - b.rect.y);
    for (let i = 0; i < sorted.length; i++) {
      for (
        let j = i + 1;
        j < sorted.length && sorted[j].rect.y < sorted[i].rect.y + sorted[i].rect.height;
        j++
      ) {
        expect(cloudOverlap(sorted[i].rect, sorted[j].rect)).toBe(false);
      }
    }
  });
  it('uses a uniform size regardless of POS and keeps theme shade variation', () => {
    const input = [{ text: 'noun verb adj', begin: 0 }];
    const segment = () => [
      { word: 'noun', tag: 'n' },
      { word: 'verb', tag: 'v' },
      { word: 'adj', tag: 'a' }
    ];
    const line = buildCloudLayout(input, 'a', options, measure, segment).lines[0];
    expect(new Set(line.tokens.map((t) => t.size))).toEqual(new Set([32]));
    expect(new Set(line.tokens.map((t) => t.shade)).size).toBeGreaterThan(1);
    expect(buildCloudLayout(input, 'a', options, measure, segment).lines[0]).toEqual(line);
  });
  it('places small backing vocals near their parent with consistent orientation', () => {
    const layout = build([
      { text: 'parent', begin: 0 },
      { text: 'echo', begin: 1, background: true, parent: 0 }
    ]);
    expect(layout.lines[1].angle).toBe(layout.lines[0].angle);
    expect(layout.lines[1].tokens[0].size).toBeLessThan(layout.lines[0].tokens[0].size);
    const a = layout.lines[0].rect,
      b = layout.lines[1].rect;
    expect(
      Math.min(Math.abs(a.x + a.width - b.x), Math.abs(a.y + a.height - b.y))
    ).toBeLessThanOrEqual(16.01);
  });
});

describe('physical screen word cloud bounds', () => {
  const source = Array.from({ length: 45 }, (_, i) => ({
    text: `明天 向着 世界出发 ${i % 3}`,
    begin: i * 4,
    words: undefined
  }));
  it.each([
    [1440, 1000],
    [390, 844],
    [844, 390],
    [620, 420]
  ])(
    'touches all four viewport edges at %s × %s with unchanged glyphs and timing',
    (width, height) => {
      const base = build(source),
        before = structuredClone(base);
      const projected = fitCloudLayoutToViewport(base, width, height);
      const target = cloudCameraTarget(projected, 0, { x: 0, y: 0, width, height }, false, singing);
      const b = projected.bounds;
      expect((b.x - target.x) * target.scale + width / 2).toBeCloseTo(0, 7);
      expect((b.y - target.y) * target.scale + height / 2).toBeCloseTo(0, 7);
      expect((b.x + b.width - target.x) * target.scale + width / 2).toBeCloseTo(width, 7);
      expect((b.y + b.height - target.y) * target.scale + height / 2).toBeCloseTo(height, 7);
      for (let i = 0; i < projected.lines.length; i++) {
        const { rect, ...line } = projected.lines[i];
        const { rect: oldRect, ...oldLine } = base.lines[i];
        expect(line).toEqual(oldLine);
        expect([rect.width, rect.height]).toEqual([oldRect.width, oldRect.height]);
        for (let j = i + 1; j < projected.lines.length; j++)
          expect(cloudOverlap(rect, projected.lines[j].rect, 15.9)).toBe(false);
      }
      expect(base).toEqual(before);
      expect(fitCloudLayoutToViewport(base, width, height)).toEqual(projected);
    }
  );
  it.each(['x', 'y'] as const)('expands coincident %s centers without overlap', (axis) => {
    const base = build(source.slice(0, 4));
    base.lines.forEach((line, i) => {
      line.rect =
        axis === 'x'
          ? { x: -(20 + i * 10) / 2, y: i * 100, width: 20 + i * 10, height: 50 }
          : { y: -(20 + i * 10) / 2, x: i * 100, height: 20 + i * 10, width: 50 };
    });
    const result = fitCloudLayoutToViewport(
      base,
      axis === 'x' ? 1000 : 200,
      axis === 'x' ? 200 : 1000
    );
    expect(result.bounds.width / result.bounds.height).toBeCloseTo(axis === 'x' ? 5 : 0.2, 8);
    for (let i = 0; i < result.lines.length; i++)
      for (let j = i + 1; j < result.lines.length; j++)
        expect(cloudOverlap(result.lines[i].rect, result.lines[j].rect)).toBe(false);
  });
  it('does not accumulate projection changes on portrait/landscape rotation', () => {
    const base = build(source);
    const portrait = fitCloudLayoutToViewport(base, 390, 844);
    fitCloudLayoutToViewport(base, 844, 390);
    expect(fitCloudLayoutToViewport(base, 390, 844)).toEqual(portrait);
  });
  it('trims actual ink instead of treating spaces and font leading as visible edges', () => {
    const result = buildCloudLayout(
      [{ text: ' word ', begin: 0 }],
      'ink',
      { ...options, vertical: 0 },
      measure,
      undefined,
      (text, size) => ({
        x: -2,
        y: 5,
        width: text.trim() ? measure(text, size) + 3 : 0,
        height: text.trim() ? size * 0.8 : 0
      })
    );
    const line = result.lines[0],
      word = line.tokens.find((t) => t.text.trim())!;
    expect(word.x + word.ink!.x).toBe(0);
    expect(word.y + word.ink!.y).toBe(0);
    expect(line.localWidth).toBeCloseTo(word.ink!.width, 10);
    expect(line.localHeight).toBeCloseTo(word.ink!.height, 10);
    expect(result.bounds).toEqual(line.rect);
  });
  it('keeps empty, zero viewport and indivisible single glyph layouts finite and proportional', () => {
    const empty = build([]),
      single = build([{ text: '字', begin: -1 }]);
    expect(fitCloudLayoutToViewport(empty, 390, 844)).toEqual(empty);
    expect(fitCloudLayoutToViewport(single, 0, 0)).toEqual(single);
    const result = fitCloudLayoutToViewport(single, 390, 844);
    expect(result.lines[0].tokens).toEqual(single.lines[0].tokens);
    expect(Number.isFinite(cloudCameraTarget(result, 0, view, false, singing).scale)).toBe(true);
  });
});

it.each([0, 1])(
  'fills a single multi-word sentence without stretching text, orientation %s',
  (vertical) => {
    const base = build([{ text: 'one two three four', begin: -1 }], { ...options, vertical });
    const before = structuredClone(base);
    const projected = fitCloudLayoutToViewport(base, 390, 844);
    expect(projected.bounds.width / projected.bounds.height).toBeCloseTo(390 / 844, 8);
    expect(projected.lines[0].tokens.map((word) => [word.text, word.size, word.slices])).toEqual(
      base.lines[0].tokens.map((word) => [word.text, word.size, word.slices])
    );
    expect(base).toEqual(before);
  }
);

describe('time-driven reveal and vocal phases', () => {
  const exact = build([
    { text: 'one', begin: 6, end: 8, reliableEnd: true },
    { text: 'two', begin: 20, end: 22, reliableEnd: true }
  ]);
  it('reveals lines and original word slices only according to playback time, including reverse seek', () => {
    const line = exact.lines[0];
    expect(cloudOpacity(line, undefined, 5.9, false)).toBe(0);
    expect(cloudOpacity(line, undefined, 6.16, false)).toBeCloseTo(0.5);
    expect(cloudOpacity(line, undefined, 7, false)).toBe(1);
    expect(cloudOpacity(line, undefined, 5, false)).toBe(0);
    const timed = build([
      {
        text: 'ab',
        begin: 1,
        words: [
          { text: 'a', begin: 1, end: 1.04 },
          { text: 'b', begin: 2, end: 3 }
        ]
      }
    ]).lines[0];
    expect(cloudOpacity(timed, mapCloudTiming(timed)![0], 1.02, false)).toBeCloseTo(0.5);
    expect(cloudOpacity(timed, mapCloudTiming(timed)![1], 2.18, false)).toBeCloseTo(1);
  });
  it('uses exact vocal ends for intro/interlude/outro and starts recovery 500ms early', () => {
    expect(cloudPhase(exact, 0, 25, false).kind).toBe('intro');
    expect(cloudPhase(exact, 5.5, 25, false).kind).toBe('singing');
    expect(cloudPhase(exact, 8, 25, false).kind).toBe('interlude');
    expect(cloudPhase(exact, 19.5, 25, false).kind).toBe('singing');
    expect(cloudPhase(exact, 22, 25, false).kind).toBe('outro');
  });
  it('waits for overlapping main and background vocals to finish', () => {
    const layout = build([
      { text: 'main', begin: 1, end: 3, reliableEnd: true },
      { text: 'echo', begin: 2, end: 9, reliableEnd: true, background: true, parent: 0 },
      { text: 'next', begin: 15, end: 16, reliableEnd: true }
    ]);
    expect(cloudPhase(layout, 7, 25, true).kind).toBe('singing');
    expect(cloudPhase(layout, 9, 25, true).kind).toBe('interlude');
  });
  it('requires a 12-second LRC start gap, 5-second remainder and optional estimation', () => {
    const layout = build([
      { text: '短句', begin: 0 },
      { text: 'next', begin: 12 }
    ]);
    expect(cloudPhase(layout, 7, 30, true).kind).toBe('interlude');
    expect(cloudPhase(layout, 7, 30, false).kind).toBe('singing');
    const short = build([
      { text: '短句', begin: 0 },
      { text: 'next', begin: 11 }
    ]);
    expect(cloudPhase(short, 7, 30, true).kind).toBe('singing');
    expect(estimateCloudDuration('hi')).toBe(6);
    expect(estimateCloudDuration('长'.repeat(100))).toBe(24);
  });
  it('starts the overview halfway through the inferred last line when estimation is enabled', () => {
    const layout = build([{ text: 'last', begin: 0 }]);
    expect(cloudPhase(layout, 7, 14, true).kind).toBe('outro');
    expect(cloudPhase(layout, 2.9, 0, true).kind).toBe('singing');
    expect(cloudPhase(layout, 3, 0, true).kind).toBe('outro');
    expect(cloudPhase(layout, 7, 20, false).kind).toBe('singing');
  });
  it('never creates overlaps from estimated duration and displays untimed text statically', () => {
    const layout = build([
      { text: 'one', begin: 0 },
      { text: 'two', begin: 2 }
    ]);
    expect(activeCloudLines(layout, 3).map((l) => l.text)).toEqual(['two']);
    const staticLayout = build([{ text: 'static', begin: -1 }]);
    expect(cloudPhase(staticLayout, 500, 100, true).kind).toBe('static');
    expect(cloudOpacity(staticLayout.lines[0], undefined, 0, true)).toBe(1);
  });
});

describe('interruptible camera', () => {
  const layout = build([
    { text: 'one two three four', begin: 0, end: 10, reliableEnd: true },
    { text: 'next sentence', begin: 20, end: 25, reliableEnd: true }
  ]);
  it('follows sentence reading paths without changing the layout', () => {
    const before = structuredClone(layout);
    const start = cloudCameraTarget(layout, 0, view, true, singing);
    const end = cloudCameraTarget(layout, 9, view, true, singing);
    expect(Math.hypot(start.x - end.x, start.y - end.y)).toBeGreaterThan(50);
    expect(layout).toEqual(before);
  });
  it('follows timed lexical groups and keeps a bounded zoom', () => {
    const timed = build([
      {
        text: 'a b',
        begin: 0,
        words: [
          { text: 'a', begin: 0, end: 1 },
          { text: ' b', begin: 1, end: 2 }
        ]
      }
    ]);
    expect(cloudCameraTarget(timed, 0.5, view, true, singing)).not.toEqual(
      cloudCameraTarget(timed, 1.5, view, true, singing)
    );
    expect(cloudCameraTarget(timed, 0.5, view, true, singing).scale).toBeLessThanOrEqual(2);
  });
  it('fits simultaneous singers if no primary exists; backing vocals do not drive it', () => {
    const duet = build([
      { text: 'first', begin: 0, end: 3, reliableEnd: true },
      { text: 'second', begin: 0, end: 4, reliableEnd: true }
    ]);
    const target = cloudCameraTarget(duet, 1, view, true, singing);
    for (const line of duet.lines)
      expect(Math.abs(line.rect.x + line.rect.width / 2 - target.x) * target.scale).toBeLessThan(
        view.width / 2
      );
    expect(target.angle).toBe(0);
  });
  it('holds the previous line during interludes and retreats in the last line', () => {
    expect(cloudCameraTarget(layout, 15, view, true, { kind: 'interlude', next: 20 })).toEqual(
      cloudCameraTarget(layout, 10, view, true, singing)
    );
    expect(cloudCameraTarget(layout, 19.6, view, true, singing)).toEqual(
      cloudCameraTarget(layout, 10, view, true, singing)
    );
    expect(cloudCameraTarget(layout, 23, view, true, cloudPhase(layout, 23, 30, true))).toEqual(
      cloudCameraTarget(layout, 23, view, false, singing)
    );
  });
  it('uses static whole-sentence framing in reduced motion', () => {
    expect(cloudCameraTarget(layout, 1, view, true, singing, true)).toEqual(
      cloudCameraTarget(layout, 8, view, true, singing, true)
    );
    const line = layout.lines[0],
      p = cloudPoint(line, line.localWidth / 2, line.localHeight / 2);
    expect(cloudCameraTarget(layout, 1, view, true, singing, true)).toMatchObject(p);
  });
  it('rotates along the shortest path and retains motion through target interruption', () => {
    const current = { x: 0, y: 0, scale: 1, angle: Math.PI - 0.01 };
    const target = { x: 100, y: 20, scale: 2, angle: -Math.PI + 0.01 };
    const step = stepCloudCamera(current, zeroVelocity, target, 0.016);
    expect(Math.abs(step.camera.angle - current.angle)).toBeLessThan(0.02);
    const reversed = stepCloudCamera(step.camera, step.velocity, { ...current, x: -100 }, 0);
    expect(reversed.camera).toEqual(step.camera);
    expect(reversed.velocity).toEqual(step.velocity);
    let state = step;
    for (let i = 0; i < 120; i++)
      state = stepCloudCamera(state.camera, state.velocity, target, 1 / 60);
    expect(state.settled).toBe(true);
    expect(state.camera.x).toBeCloseTo(100);
  });
  it('keeps readable zoom on different viewport sizes without repacking', () => {
    const before = structuredClone(layout);
    const wide = cloudCameraTarget(layout, 5, view, true, singing);
    const compact = cloudCameraTarget(layout, 5, { ...view, height: 100 }, true, singing);
    expect(compact.scale).toBeLessThanOrEqual(wide.scale);
    expect(layout).toEqual(before);
  });
});

describe('Fume-inspired camera motion', () => {
  const overview = { x: 0, y: 0, scale: 0.2, angle: 0 };
  const target = { x: 0, y: 0, scale: 2, angle: 0 };
  const input = {
    target,
    overview,
    view,
    source: '0',
    time: 0,
    dt: 1 / 60,
    speed: 1,
    floating: false,
    reduced: false
  };
  it('tracks progress inside the original timed word without inventing glyph times', () => {
    const line = buildCloudLayout(
      [
        {
          text: '明天',
          begin: 1,
          words: [{ text: '明天', begin: 1, end: 3 }]
        }
      ],
      'timed',
      { ...options, vertical: 0 },
      measure
    ).lines[0];
    const a = cloudReadingPoint(line, 1.25),
      b = cloudReadingPoint(line, 2),
      c = cloudReadingPoint(line, 2.75);
    expect(a.x).toBeLessThan(b.x);
    expect(b.x).toBeLessThan(c.x);
    expect(
      line.tokens
        .flatMap((word) => word.slices)
        .every((slice) => slice.begin === 1 && slice.end === 3)
    ).toBe(true);
    expect(cloudReadingPoint(line, 4)).toEqual(cloudReadingPoint(line, 3));
  });
  it('blends around wrapped reading boundaries instead of jumping to the next row', () => {
    const line = build([{ text: 'word '.repeat(40), begin: 0, end: 20, reliableEnd: true }], {
      ...options,
      vertical: 0
    }).lines[0];
    let previous = cloudReadingPoint(line, 0),
      maxDistance = 0;
    for (let t = 0.01; t <= 20; t += 0.01) {
      const next = cloudReadingPoint(line, t);
      maxDistance = Math.max(maxDistance, Math.hypot(next.x - previous.x, next.y - previous.y));
      previous = next;
    }
    expect(maxDistance).toBeLessThan(80);
  });
  it('does not retreat before the midpoint of the final overlapping vocal group', () => {
    const layout = build([
      { text: 'lead', begin: 10, end: 14, reliableEnd: true },
      { text: 'harmony', begin: 12, end: 20, reliableEnd: true, background: true, parent: 0 }
    ]);
    expect(cloudPhase(layout, 14.9, 25, false).kind).toBe('singing');
    expect(cloudPhase(layout, 15, 25, false).kind).toBe('outro');
  });
  it('uses a zoomed-out flight for distant lines and settles exactly at the destination', () => {
    let state = stepCloudMotion(createCloudMotion(), input);
    const distant = {
      ...input,
      target: { x: 3000, y: 1800, scale: 2, angle: Math.PI / 2 },
      source: '1',
      time: 1
    };
    state = stepCloudMotion(state, distant);
    expect(state.flight?.waypoint).toBeDefined();
    let minimumScale = state.camera.scale;
    for (let i = 0; i < 180; i++) {
      state = stepCloudMotion(state, distant);
      minimumScale = Math.min(minimumScale, state.camera.scale);
    }
    expect(minimumScale).toBeLessThan(1.8);
    expect(state.settled).toBe(true);
    expect(state.camera).toEqual(distant.target);
  });
  it('continues from the current position and velocity when a flight is interrupted', () => {
    let state = stepCloudMotion(createCloudMotion(), input);
    const distant = { ...input, target: { ...target, x: 3000 }, source: '1', time: 1 };
    for (let i = 0; i < 12; i++) state = stepCloudMotion(state, distant);
    const interrupted = stepCloudMotion(state, {
      ...input,
      target: { ...target, x: -3000 },
      source: '2',
      dt: 0
    });
    expect(interrupted.camera).toEqual(state.camera);
    expect(interrupted.velocity).toEqual(state.velocity);
    expect(interrupted.flight?.from).toEqual(state.camera);
  });
  it('freezes idle drift at paused playback time and disables it for overview/reduced motion', () => {
    const floating = { ...input, floating: true, time: 10 };
    let state = stepCloudMotion(createCloudMotion(), floating);
    const paused = state.camera;
    for (let i = 0; i < 100; i++) state = stepCloudMotion(state, floating);
    expect(state.camera).toEqual(paused);
    expect(state.settled).toBe(true);
    expect(stepCloudMotion(state, { ...floating, time: 11 }).camera).not.toEqual(paused);
    const reduced = stepCloudMotion(state, { ...floating, reduced: true });
    expect(reduced.camera).toEqual(target);
    expect(reduced.flight).toBeUndefined();
    state = stepCloudMotion(state, { ...input, source: 'overview', target: overview, time: 12 });
    for (let i = 0; i < 180; i++)
      state = stepCloudMotion(state, { ...input, source: 'overview', target: overview, time: 12 });
    expect(state.camera).toEqual(overview);
  });
  it('ignores retired POS/size-contrast settings when restoring saved configuration', () => {
    const restored = resolvePlayerStyleConfig('wordCloud', {
      cloudEmphasize: true,
      cloudContrast: 2
    });
    expect(restored).not.toHaveProperty('cloudEmphasize');
    expect(restored).not.toHaveProperty('cloudContrast');
  });
});

describe('configuration migration and export', () => {
  it('migrates only compatible appearance settings, once, without mutating saved state', () => {
    const saved = {
      playerStyle: 'frenzy',
      styleCustomConfig: {
        frenzy: {
          mode: 'custom',
          fontWeight: 800,
          customFontFamily: 'custom',
          giantSize: 90,
          frenzyNormalMainColor: '#f00',
          effectCrt: true
        }
      }
    };
    const before = structuredClone(saved),
      next = migrateWordCloudSettings(saved);
    expect(next.playerStyle).toBe('wordCloud');
    expect((next.styleCustomConfig as Record<string, unknown>).wordCloud).toEqual({
      mode: 'custom',
      fontWeight: 800,
      customFontFamily: 'custom'
    });
    expect(migrateWordCloudSettings(next)).toEqual(next);
    expect(saved).toEqual(before);
    const reset = {
      ...next,
      styleCustomConfig: {
        ...next.styleCustomConfig,
        wordCloud: createPlayerStyleConfig('wordCloud')
      }
    };
    expect(migrateWordCloudSettings(reset).styleCustomConfig.wordCloud.fontWeight).toBe(600);
  });
  it('clamps the new settings and isolates them from other styles', () => {
    const defaults = createPlayerStyleConfig('wordCloud');
    expect(defaults).toMatchObject({
      cloudFocus: true,
      cloudEstimate: true,
      cloudBackground: 'cover',
      cloudScale: 1,
      cloudVertical: 0.3
    });
    expect(
      resolvePlayerStyleConfig('wordCloud', {
        cloudScale: 9,
        cloudVertical: -1,
        cloudCameraSpeed: 0.1,
        cloudContrast: 0,
        cloudBackground: 'invalid' as never
      })
    ).toMatchObject({
      cloudScale: 1.8,
      cloudVertical: 0,
      cloudCameraSpeed: 0.5,
      cloudBackground: 'cover'
    });
    expect(createPlayerStyleConfig('stage').cloudScale).toBeUndefined();
    expect(isMobilePlayerStyleKey('wordCloud')).toBe(true);
    expect(isMobilePlayerStyleKey('frenzy')).toBe(false);
  });
  it('blocks video at the service and skin registry before allocating export resources', async () => {
    expect(() => getSkin('wordCloud')).toThrow('词云样式暂不支持视频导出');
    await expect(
      exportStyleVideo({ styleKey: 'wordCloud' } as StyleVideoExportInput)
    ).rejects.toThrow('词云样式暂不支持视频导出');
  });
});
