import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, nextTick, ref } from 'vue';

import { useMeasuredLyricMount } from '@/composables/useMeasuredLyricMount';

describe('scrolling lyric viewport lifecycle', () => {
  let frames: Map<number, FrameRequestCallback>;
  let nextFrame: number;
  let observers: Array<{ notify: () => void; disconnect: ReturnType<typeof vi.fn> }>;
  const scopes: ReturnType<typeof effectScope>[] = [];
  const paint = async () => {
    await nextTick();
    const callbacks = [...frames.values()];
    frames.clear();
    callbacks.forEach((callback) => callback(performance.now()));
    await nextTick();
  };
  const createViewport = (initiallyVisible = true, initiallyMeasured = true) => {
    const ready = ref(initiallyVisible);
    let measured = initiallyMeasured;
    const element = document.createElement('div');
    vi.spyOn(element, 'getBoundingClientRect').mockImplementation(
      () => new DOMRect(0, 0, measured ? 700 : 0, measured ? 700 : 0)
    );
    const root = ref<HTMLElement | null>(element);
    const scope = effectScope();
    scopes.push(scope);
    const mount = scope.run(() => useMeasuredLyricMount(() => ready.value, root))!;
    return { ...mount, ready, root, scope, setMeasured: (value: boolean) => (measured = value) };
  };

  beforeEach(() => {
    frames = new Map();
    nextFrame = 0;
    observers = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.set(++nextFrame, callback);
      return nextFrame;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
    vi.stubGlobal(
      'ResizeObserver',
      class {
        disconnect = vi.fn();
        observe = vi.fn();
        unobserve = vi.fn();
        constructor(notify: () => void) {
          observers.push({ notify, disconnect: this.disconnect });
        }
      }
    );
  });
  afterEach(() => {
    scopes.splice(0).forEach((scope) => scope.stop());
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('never constructs a player while the cover hides the lyrics', async () => {
    const view = createViewport(false, false);
    await paint();
    expect(view.mounted.value).toBe(false);
    expect(view.pending.value).toBe(false);
    expect(observers).toHaveLength(0);
  });

  it('releases the old viewport on every return to cover and mounts fresh on re-entry', async () => {
    const view = createViewport();
    for (let cycle = 0; cycle < 8; cycle++) {
      await paint();
      expect(view.mounted.value).toBe(true);
      expect(view.pending.value).toBe(false);
      view.ready.value = false;
      view.setMeasured(false);
      await nextTick();
      expect(view.mounted.value).toBe(false);
      expect(frames.size).toBe(0);
      expect(observers.at(-1)?.disconnect).toHaveBeenCalled();
      view.setMeasured(true);
      view.ready.value = true;
    }
    await paint();
    expect(view.mounted.value).toBe(true);
  });

  it('waits for nonzero size after activation without polling while an ancestor stays hidden', async () => {
    const view = createViewport(true, false);
    await paint();
    expect(view.pending.value).toBe(true);
    expect(view.mounted.value).toBe(false);
    expect(frames.size).toBe(0);
    view.setMeasured(true);
    observers.at(-1)!.notify();
    await paint();
    expect(view.mounted.value).toBe(true);
    expect(observers.at(-1)?.disconnect).toHaveBeenCalled();
  });

  it('cancels a pending mount when the user immediately closes or the component unmounts', async () => {
    const view = createViewport();
    expect(frames.size).toBe(1);
    const staleObserver = observers.at(-1)!;
    view.ready.value = false;
    await paint();
    staleObserver.notify();
    expect(view.mounted.value).toBe(false);
    expect(frames.size).toBe(0);
    view.ready.value = true;
    await nextTick();
    expect(frames.size).toBe(1);
    view.scope.stop();
    await paint();
    expect(view.mounted.value).toBe(false);
    expect(frames.size).toBe(0);
    expect(observers.at(-1)?.disconnect).toHaveBeenCalled();
  });

  it('waits for the actual DOM root and replaces it without keeping the old observer', async () => {
    const view = createViewport();
    view.root.value = null;
    await paint();
    expect(view.mounted.value).toBe(false);
    const element = document.createElement('div');
    vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 400, 800));
    view.root.value = element;
    await paint();
    expect(view.mounted.value).toBe(true);
  });
});
