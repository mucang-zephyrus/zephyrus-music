import { describe, expect, it } from 'vitest';

import {
  DOCK_COLLAPSE_THRESHOLD,
  initialMobileDockState,
  type MobileDockState,
  nextDockMode} from '@/composables/useMobileDockState';

describe('nextDockMode', () => {
  it('starts expanded at the top and collapses only after scrolling past the threshold', () => {
    let state = initialMobileDockState();
    expect(state.mode).toBe('expanded');

    state = nextDockMode(state, { type: 'scrollDown', scrollTop: DOCK_COLLAPSE_THRESHOLD - 1 });
    expect(state.mode).toBe('expanded');

    state = nextDockMode(state, { type: 'scrollDown', scrollTop: DOCK_COLLAPSE_THRESHOLD + 40 });
    expect(state.mode).toBe('collapsed');
    expect(state.atTop).toBe(false);
  });

  it('returns to expanded when scrolled back to the top', () => {
    const collapsed: MobileDockState = { mode: 'collapsed', preSearchMode: 'expanded', atTop: false };

    const state = nextDockMode(collapsed, { type: 'atTop', scrollTop: 0 });
    expect(state.mode).toBe('expanded');
    expect(state.atTop).toBe(true);
  });

  it('expands from the left circle even when not at the top', () => {
    const collapsed: MobileDockState = { mode: 'collapsed', preSearchMode: 'expanded', atTop: false };

    expect(nextDockMode(collapsed, { type: 'expand' }).mode).toBe('expanded');
  });

  it('remembers the previous mode across search enter/exit', () => {
    const collapsed: MobileDockState = { mode: 'collapsed', preSearchMode: 'expanded', atTop: false };

    const searching = nextDockMode(collapsed, { type: 'enterSearch' });
    expect(searching.mode).toBe('search');
    expect(searching.preSearchMode).toBe('collapsed');

    expect(nextDockMode(searching, { type: 'exitSearch' }).mode).toBe('collapsed');
  });

  it('keeps search mode through scroll events and atTop', () => {
    const searching: MobileDockState = { mode: 'search', preSearchMode: 'expanded', atTop: false };

    expect(nextDockMode(searching, { type: 'scrollDown', scrollTop: 900 }).mode).toBe('search');
    const atTop = nextDockMode(searching, { type: 'atTop', scrollTop: 0 });
    expect(atTop.mode).toBe('search');
    expect(atTop.atTop).toBe(true);
  });

  it('ignores no-op events', () => {
    const expanded: MobileDockState = { mode: 'expanded', preSearchMode: 'expanded', atTop: true };

    expect(nextDockMode(expanded, { type: 'expand' })).toBe(expanded);
    expect(nextDockMode(expanded, { type: 'exitSearch' })).toBe(expanded);
    expect(
      nextDockMode({ ...expanded, mode: 'search' }, { type: 'enterSearch' }).preSearchMode
    ).toBe('expanded');
  });
});
