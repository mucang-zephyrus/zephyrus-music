import { describe, expect, it } from 'vitest';

import { createPlayerStyleConfig, resolvePlayerStyleConfig } from '@/config/playerStyleConfig';
import { impactArtistCredit } from '@/utils/impactArtist';
import {
  buildImpactAccompaniment,
  buildImpactTimeline,
  buildImpactVocalRanges,
  impactFrame,
  impactSceneAt,
  impactShatters
} from '@/utils/impactTimeline';
import type { CloudInput } from '@/utils/wordCloud';
import { providerCloudInputs } from '@/utils/wordCloudInput';

const rangesFor = (inputs: CloudInput[], wholeLine = false) =>
  buildImpactVocalRanges(buildImpactTimeline(inputs, wholeLine), buildImpactAccompaniment(inputs));
const scene = (inputs: CloudInput[], time: number, artist = true, reduced = false) =>
  impactSceneAt(rangesFor(inputs), time, artist, reduced, 30);

describe('impact song cards', () => {
  it('splits a full intro, skips the artist for short or missing intros, and cuts on the first lyric', () => {
    const inputs = [{ text: '歌詞', begin: 4 }];
    expect(scene(inputs, 1)).toMatchObject({ phase: 'intro', card: 'title', opacity: 1 });
    expect(scene(inputs, 2)).toMatchObject({ phase: 'intro', card: 'artist' });
    expect(scene(inputs, 2).edgeLight).toBeGreaterThan(0);
    expect(scene(inputs, 2, true, true)).toMatchObject({ opacity: 1, edgeLight: 0 });
    expect(scene(inputs, 3, false).card).toBe('title');
    expect(scene(inputs, 4)).toMatchObject({ phase: 'vocals', card: null });
    expect(scene([{ text: '歌詞', begin: 1.8 }], 1.7).card).toBe('title');
    expect(scene([{ text: '歌詞', begin: 0 }], 0).card).toBeNull();
    expect(scene([{ text: 'untimed', begin: -1 }], 10)).toMatchObject({
      phase: 'instrumental',
      card: 'title'
    });
  });

  it('observes timed blank LRC markers and keeps holding a line with no ending marker', () => {
    const inputs = providerCloudInputs(
      [
        { text: 'First', startTime: 2000, trText: '' },
        { text: '', startTime: 4000, trText: '' },
        { text: 'Last', startTime: 6000, trText: '' }
      ],
      'lrc'
    );
    expect(impactFrame(buildImpactTimeline(inputs), 3.99)?.line.words).toEqual([]);
    expect(impactFrame(buildImpactTimeline(inputs), 4)).toBeNull();
    expect(scene(inputs, 4)).toMatchObject({ phase: 'interlude', card: 'title' });
    expect(scene(inputs, 6).card).toBeNull();
    expect(scene(inputs, 29).card).toBeNull();
    expect(scene([...inputs, { text: '', begin: 9 }], 9)).toMatchObject({
      phase: 'outro',
      card: 'title'
    });
  });

  it('honors line ends ahead of word ends and keeps word ends in whole-line mode', () => {
    const words = [{ text: 'Sing', begin: 1, end: 2 }];
    const inputs = [
      { text: 'Sing', begin: 1, end: 3, reliableEnd: true, words },
      { text: 'Again', begin: 5, words: [{ text: 'Again', begin: 5, end: 6 }] }
    ];
    const ranges = rangesFor(inputs);
    expect(ranges).toEqual([
      { begin: 1, end: 3 },
      { begin: 5, end: 6 }
    ]);
    expect(rangesFor(inputs, true)).toEqual(ranges);
    expect(scene(inputs, 2.5).card).toBeNull();
    expect(scene(inputs, 6)).toMatchObject({ phase: 'outro', card: 'title' });
    expect(impactShatters(buildImpactTimeline(inputs), 6, false)).toEqual([]);
    const clip = [{ text: 'Sing', begin: 1, end: 1.3, reliableEnd: true, words }];
    expect(scene(clip, 1.31).card).toBe('title');
    expect(impactShatters(buildImpactTimeline(clip), 1.31, false)).toHaveLength(1);
  });

  it('leaves short gaps empty and gives overlapping background and duet their full time', () => {
    const inputs = [
      { text: 'First', begin: 0, end: 3, reliableEnd: true },
      { text: 'Background', begin: 2, end: 4, reliableEnd: true, background: true },
      { text: 'Duet', begin: 3.8, end: 5, reliableEnd: true, duet: true },
      { text: 'Last', begin: 6.9, end: 8, reliableEnd: true }
    ];
    expect(scene(inputs, 4.5)).toMatchObject({ phase: 'vocals', card: null });
    expect(scene(inputs, 5.2)).toMatchObject({ phase: 'interlude', card: null });
    expect(scene(inputs, 8)).toMatchObject({ phase: 'outro', card: 'title' });
  });
});

describe('impact artist credit', () => {
  it.each([
    '犬儒乐队 Cynic',
    'Cynic 犬儒乐队',
    'Cynic（犬儒乐队）',
    '犬儒乐队 (Cynic)',
    '犬儒乐队Cynic',
    'Cynic犬儒乐队'
  ])('displays both names of %s and swaps their roles', (name) => {
    expect(impactArtistCredit([name], false)).toEqual({ main: '犬儒乐队', outline: 'Cynic' });
    expect(impactArtistCredit([name], true)).toEqual({ main: 'Cynic', outline: '犬儒乐队' });
  });
  it('splits an attached English name with spaces inside it', () => {
    expect(impactArtistCredit(['野肆乐队Reckless Abandon'], false)).toEqual({
      main: '野肆乐队',
      outline: 'Reckless Abandon'
    });
    expect(impactArtistCredit(['Reckless Abandon野肆乐队'], true)).toEqual({
      main: 'Reckless Abandon',
      outline: '野肆乐队'
    });
  });
  it('preserves unpaired names and collaboration order', () => {
    expect(
      impactArtistCredit(
        ['霜冻前夜', 'DJ 小可', '二手玫瑰 Second Hand Rose', 'A-Lin', '旅行团TheLifeJourney'],
        false
      )
    ).toEqual({
      main: '霜冻前夜 / DJ 小可 / 二手玫瑰 / A-Lin / 旅行团TheLifeJourney',
      outline: 'Second Hand Rose'
    });
  });
  it('keeps the swap and font preferences through config normalization and restores the default order', () => {
    expect(createPlayerStyleConfig('impact').impactSwapArtistLanguages).toBe(false);
    const saved = JSON.stringify({
      mode: 'custom',
      impactSwapArtistLanguages: true,
      builtinFontId: 'noto-serif-sc'
    });
    expect(resolvePlayerStyleConfig('impact', JSON.parse(saved))).toMatchObject({
      impactSwapArtistLanguages: true,
      builtinFontId: 'noto-serif-sc'
    });
  });
});
