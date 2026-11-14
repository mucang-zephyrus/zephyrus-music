import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  beginSharedCoverNavigation,
  beginSharedCoverReturn,
  cancelSharedCoverTransition,
  resolveSharedCoverTarget,
  useSharedCoverTransition
} from '../../src/renderer/composables/useSharedCoverTransition';

const SOURCE = '/artist/detail/10';
const TARGET = '/music-list/111?type=album';
const shared = useSharedCoverTransition();
let reduce = false;

function cover(x: number, y: number, size: number) {
  const image = document.createElement('img');
  image.src = 'https://example.test/cover.png';
  image.style.borderRadius = '16px';
  image.getBoundingClientRect = () => new DOMRect(x, y, size, size);
  document.body.append(image);
  return image;
}

function open(source: HTMLElement, targetRoute = TARGET) {
  return beginSharedCoverNavigation({ source, sourceRoute: SOURCE, targetRoute, src: 'https://example.test/cover.png' });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  reduce = false;
  vi.stubGlobal('matchMedia', () => ({ matches: reduce }));
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 16));
  vi.stubGlobal('cancelAnimationFrame', (handle: number) => clearTimeout(handle));
});

afterEach(() => {
  cancelSharedCoverTransition();
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('shared cover route transitions', () => {
  it('spreads motion across the opening and hands off without a long subpixel tail', () => {
    const source = cover(25, 400, 96);
    const hero = cover(180, 80, 300);
    open(source);
    resolveSharedCoverTarget(TARGET, hero);
    vi.advanceTimersByTime(80);
    const earlyProgress = (shared.layer.value!.x - 25) / 155;
    expect(earlyProgress).toBeGreaterThan(0.4);
    expect(earlyProgress).toBeLessThan(0.46);
    vi.advanceTimersByTime(80);
    const middleProgress = (shared.layer.value!.x - 25) / 155;
    expect(middleProgress).toBeGreaterThan(0.75);
    expect(middleProgress).toBeLessThan(0.8);
    vi.advanceTimersByTime(304);
    expect(shared.active.value).toBe(true);
    expect(Math.abs(shared.layer.value!.y - 80)).toBeLessThan(1);
    vi.advanceTimersByTime(48);
    expect(shared.active.value).toBe(false);
  });

  it('uses actual elapsed time after a long frame instead of slowing the curve', () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback));
    const source = cover(25, 400, 96);
    const hero = cover(180, 80, 300);
    open(source);
    resolveSharedCoverTarget(TARGET, hero);
    vi.advanceTimersByTime(200);
    frames.shift()!(performance.now());
    const progress = (shared.layer.value!.x - 25) / 155;
    expect(progress).toBeGreaterThan(0.87);
    expect(progress).toBeLessThan(0.88);
    expect(shared.layer.value!.shadowProgress).toBeCloseTo(progress);
  });

  it('carries shadow continuously through flight, reversal and a completed return', () => {
    const source = cover(25, 400, 96);
    source.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.1)';
    const hero = cover(180, 80, 300);
    hero.style.boxShadow = '0 18px 44px rgba(0, 0, 0, 0.35)';
    open(source);
    expect(shared.layer.value!.sourceShadow).toBe(getComputedStyle(source).boxShadow);
    expect(shared.layer.value!.shadowProgress).toBe(0);
    resolveSharedCoverTarget(TARGET, hero);
    expect(shared.layer.value!.targetShadow).toBe(getComputedStyle(hero).boxShadow);
    vi.advanceTimersByTime(96);
    const beforeReturn = { ...shared.layer.value };
    expect(beforeReturn.shadowProgress).toBeGreaterThan(0);
    expect(beforeReturn.shadowProgress).toBeLessThan(1);
    beginSharedCoverReturn(TARGET, SOURCE, hero);
    resolveSharedCoverTarget(SOURCE);
    expect(shared.layer.value).toEqual(beforeReturn);
    vi.advanceTimersByTime(1000);
    expect(shared.active.value).toBe(false);

    open(source);
    resolveSharedCoverTarget(TARGET, hero);
    vi.advanceTimersByTime(1000);
    beginSharedCoverReturn(TARGET, SOURCE, hero);
    expect(shared.layer.value!.shadowProgress).toBe(1);
    expect(shared.layer.value!.targetShadow).toBe(getComputedStyle(hero).boxShadow);
    resolveSharedCoverTarget(SOURCE);
    vi.advanceTimersByTime(96);
    expect(shared.layer.value!.shadowProgress).toBeLessThan(1);
    expect(shared.layer.value!.shadowProgress).toBeGreaterThan(0);
    vi.advanceTimersByTime(1000);
    expect(source.style.visibility).toBe('');
  });

  it('captures wrapper and flip-face shadows and restores their original visibility', () => {
    const source = cover(25, 400, 96);
    const wrapper = document.createElement('div');
    wrapper.getBoundingClientRect = source.getBoundingClientRect;
    wrapper.style.boxShadow = '0 4px 8px rgba(0, 0, 0, 0.2)';
    document.body.append(wrapper);
    wrapper.append(source);
    const hero = cover(180, 80, 300);
    const face = document.createElement('div');
    face.className = 'album-cover-front';
    face.style.boxShadow = '0 18px 44px rgba(0, 0, 0, 0.35)';
    hero.append(face);
    open(source);
    expect(shared.layer.value!.sourceShadow).toBe(getComputedStyle(wrapper).boxShadow);
    expect(wrapper.style.visibility).toBe('hidden');
    resolveSharedCoverTarget(TARGET, hero);
    expect(shared.layer.value!.targetShadow).toBe(getComputedStyle(face).boxShadow);
    expect(face.style.visibility).toBe('hidden');
    cancelSharedCoverTransition();
    expect(wrapper.style.visibility).toBe('');
    expect(face.style.visibility).toBe('');
    expect(hero.style.visibility).toBe('');
  });

  it('hands off to the hero, restores both covers, and returns to the same source', () => {
    const source = cover(25, 400, 96);
    const hero = cover(180, 80, 300);
    open(source);
    expect(source.style.visibility).toBe('hidden');
    expect(resolveSharedCoverTarget('/music-list/222?type=album', hero)).toBe(false);
    expect(hero.style.visibility).toBe('');
    expect(resolveSharedCoverTarget(TARGET, hero)).toBe(true);
    expect(hero.style.visibility).toBe('hidden');
    vi.advanceTimersByTime(160);
    expect(shared.layer.value?.x).toBeGreaterThan(25);
    expect(shared.layer.value?.x).toBeLessThan(180);
    vi.advanceTimersByTime(900);
    expect(shared.active.value).toBe(false);
    expect(source.style.visibility).toBe('');
    expect(hero.style.visibility).toBe('');
    expect(beginSharedCoverReturn(TARGET, SOURCE, hero)).toBe(true);
    expect(shared.layer.value?.x).toBe(180);
    expect(resolveSharedCoverTarget(SOURCE)).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(shared.active.value).toBe(false);
    expect(beginSharedCoverReturn(TARGET, SOURCE, hero)).toBe(false);
  });

  it('reverses from the presented position without jumping back to the hero', () => {
    const source = cover(25, 400, 96);
    const hero = cover(180, 80, 300);
    open(source);
    resolveSharedCoverTarget(TARGET, hero);
    vi.advanceTimersByTime(96);
    const current = { ...shared.layer.value };
    beginSharedCoverReturn(TARGET, SOURCE, hero);
    expect(shared.layer.value).toEqual(current);
    resolveSharedCoverTarget(SOURCE);
    vi.advanceTimersByTime(16);
    expect(Math.abs(shared.layer.value!.x - current.x!)).toBeLessThan(20);
    vi.advanceTimersByTime(1000);
    expect(shared.active.value).toBe(false);
    expect(source.style.visibility).toBe('');
  });

  it('hides the replacement flip card when a description arrives during flight', () => {
    const source = cover(20, 350, 100);
    const original = cover(160, 80, 300);
    open(source);
    resolveSharedCoverTarget(TARGET, original);
    vi.advanceTimersByTime(64);
    original.remove();
    const replacement = cover(160, 80, 300);
    resolveSharedCoverTarget(TARGET, replacement);
    expect(replacement.style.visibility).toBe('hidden');
    vi.advanceTimersByTime(1000);
    expect(replacement.style.visibility).toBe('');
    expect(original.style.visibility).toBe('');
    expect(shared.active.value).toBe(false);
  });

  it('isolates an interrupted navigation even when both entries use the same image', () => {
    const first = cover(20, 350, 100);
    const second = cover(200, 350, 100);
    const oldId = open(first);
    const newId = open(second, '/music-list/222?type=album');
    expect(newId).not.toBe(oldId);
    expect(first.style.visibility).toBe('');
    cancelSharedCoverTransition(oldId);
    shared.navigationFailed(TARGET);
    expect(shared.active.value).toBe(true);
    expect(shared.layer.value?.x).toBe(200);
    expect(resolveSharedCoverTarget(TARGET, first)).toBe(false);
    shared.routeChanged('/set/playback');
    expect(shared.active.value).toBe(false);
    expect(second.style.visibility).toBe('');
  });

  it('restores original inline visibility if the hero never mounts', () => {
    const source = cover(20, 350, 100);
    source.style.visibility = 'visible';
    open(source);
    vi.advanceTimersByTime(1800);
    expect(shared.active.value).toBe(false);
    expect(source.style.visibility).toBe('visible');
  });

  it('falls back when the source is missing, outside the viewport, or motion is reduced', () => {
    const source = cover(20, 350, 100);
    reduce = true;
    expect(open(source)).toBeNull();
    expect(source.style.visibility).toBe('');
    reduce = false;
    source.remove();
    expect(open(source)).toBeNull();
    expect(open(cover(-500, 350, 100))).toBeNull();
    expect(shared.active.value).toBe(false);
  });

  it('does not fly back to an unmounted or offscreen card', () => {
    const source = cover(20, 350, 100);
    const hero = cover(160, 80, 300);
    open(source);
    resolveSharedCoverTarget(TARGET, hero);
    vi.advanceTimersByTime(1000);
    source.remove();
    beginSharedCoverReturn(TARGET, SOURCE, hero);
    expect(resolveSharedCoverTarget(SOURCE)).toBe(false);
    expect(shared.active.value).toBe(false);
    expect(hero.style.visibility).toBe('');
  });

  it('ends cleanly if reduced motion is enabled while moving', () => {
    const source = cover(20, 350, 100);
    const hero = cover(160, 80, 300);
    open(source);
    resolveSharedCoverTarget(TARGET, hero);
    reduce = true;
    vi.advanceTimersByTime(16);
    expect(shared.active.value).toBe(false);
    expect(hero.style.visibility).toBe('');
  });

  it('restores the current page when a return navigation is rejected', () => {
    const source = cover(20, 350, 100);
    const hero = cover(160, 80, 300);
    open(source);
    resolveSharedCoverTarget(TARGET, hero);
    vi.advanceTimersByTime(1000);
    beginSharedCoverReturn(TARGET, SOURCE, hero);
    shared.navigationFailed(SOURCE);
    expect(shared.active.value).toBe(false);
    expect(hero.style.visibility).toBe('');
  });
});
