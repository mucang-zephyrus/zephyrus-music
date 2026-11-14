import { computed, readonly, shallowRef } from 'vue';

interface CoverGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
  radius: number;
}

interface CoverValues extends CoverGeometry {
  shadowProgress: number;
}

interface CoverLayer extends CoverValues {
  src: string;
  sourceShadow: string;
  targetShadow: string;
}

interface CoverJourney {
  id: number;
  sourceRoute: string;
  targetRoute: string;
  source: HTMLElement;
  sourceShadow: string;
  returning: boolean;
}

const layer = shallowRef<CoverLayer | null>(null);
const active = computed(() => layer.value !== null);
const hidden = new Map<HTMLElement, string>();
let journey: CoverJourney | null = null;
let serial = 0;
let frame = 0;
let deadline: ReturnType<typeof setTimeout> | undefined;
let destination: HTMLElement | null = null;
let target: CoverValues | null = null;
let previousTime = 0;
const axes = ['x', 'y', 'width', 'height', 'radius'] as const;
const animatedKeys = [...axes, 'shadowProgress'] as const;
const speed: CoverValues = { x: 0, y: 0, width: 0, height: 0, radius: 0, shadowProgress: 0 };
const response = 18;

function coverSurface(element: HTMLElement): HTMLElement {
  // Flip cards put the visible material on their front face, ordinary cards on
  // the image or its immediate wrapper. Never capture an entire row's shadow.
  const front = element.querySelector<HTMLElement>('.album-cover-front');
  if (front) return front;
  const parent = element.parentElement;
  if (parent && getComputedStyle(parent).boxShadow !== 'none') {
    const rect = element.getBoundingClientRect();
    const outer = parent.getBoundingClientRect();
    if (Math.abs(rect.x - outer.x) < 1 && Math.abs(rect.y - outer.y) < 1 &&
      Math.abs(rect.width - outer.width) < 1 && Math.abs(rect.height - outer.height) < 1) return parent;
  }
  return element;
}

function shadow(element: HTMLElement) {
  return getComputedStyle(coverSurface(element)).boxShadow || 'none';
}

function geometry(element: HTMLElement): CoverGeometry | null {
  if (!element.isConnected) return null;
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;
  // A card which is no longer visible must not become a stale return destination.
  if (rect.bottom <= 0 || rect.top >= window.innerHeight || rect.right <= 0 || rect.left >= window.innerWidth) {
    return null;
  }
  const style = getComputedStyle(element);
  const parentRadius = element.parentElement ? getComputedStyle(element.parentElement).borderRadius : '';
  return {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    radius: parseFloat(style.borderRadius) || parseFloat(parentRadius) || 0
  };
}

function hide(element: HTMLElement) {
  if (!hidden.has(element)) hidden.set(element, element.style.visibility);
  element.style.visibility = 'hidden';
}

function finish() {
  cancelAnimationFrame(frame);
  frame = 0;
  clearTimeout(deadline);
  deadline = undefined;
  hidden.forEach((visibility, element) => {
    element.style.visibility = visibility;
  });
  hidden.clear();
  layer.value = null;
  target = null;
  destination = null;
  animatedKeys.forEach((axis) => { speed[axis] = 0; });
  if (journey?.returning) journey = null;
}

function reducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function armDeadline() {
  clearTimeout(deadline);
  deadline = setTimeout(finish, 1800);
}

function tick(now: number) {
  frame = 0;
  const current = layer.value;
  if (!current || !target) return;
  if (reducedMotion() || !destination?.isConnected) {
    finish();
    return;
  }
  // This analytic spring remains stable over long frames. Capping elapsed time
  // stretches the curve on slower devices and makes the final approach linger.
  const dt = Math.max(0, (now - previousTime) / 1000);
  previousTime = now;
  const next = { ...current };
  const decay = Math.exp(-response * dt);
  let settled = true;
  // Critically damped motion keeps position and velocity when the user goes back mid-flight.
  for (const axis of animatedKeys) {
    const offset = current[axis] - target[axis];
    const impulse = speed[axis] + response * offset;
    next[axis] = target[axis] + (offset + impulse * dt) * decay;
    speed[axis] = (speed[axis] - response * impulse * dt) * decay;
    const positionThreshold = axis === 'shadowProgress' ? 0.002 : 0.5;
    const velocityThreshold = axis === 'shadowProgress' ? 0.03 : 12;
    if (Math.abs(next[axis] - target[axis]) > positionThreshold || Math.abs(speed[axis]) > velocityThreshold) settled = false;
  }
  layer.value = next;
  if (settled) finish();
  else frame = requestAnimationFrame(tick);
}

export function cancelSharedCoverTransition(id?: number | null) {
  if (id != null && journey?.id !== id) return;
  finish();
  journey = null;
}

/** Capture before navigation; route identity distinguishes repeated copies of the same album art. */
export function beginSharedCoverNavigation(options: {
  source: HTMLElement | null;
  sourceRoute: string;
  targetRoute: string;
  src: string;
}): number | null {
  cancelSharedCoverTransition();
  if (!options.source || !options.src || reducedMotion()) return null;
  const start = geometry(options.source);
  if (!start) return null;
  const sourceShadow = shadow(options.source);
  journey = { ...options, source: options.source, sourceShadow, id: ++serial, returning: false };
  layer.value = { ...start, src: options.src, sourceShadow, targetShadow: sourceShadow, shadowProgress: 0 };
  hide(coverSurface(options.source));
  armDeadline();
  return journey.id;
}

/** Called by the destination's route-leave guard, before Vue detaches its cover. */
export function beginSharedCoverReturn(fromRoute: string, toRoute: string, cover: HTMLElement | null) {
  if (!journey || journey.targetRoute !== fromRoute || journey.sourceRoute !== toRoute) return false;
  const start = cover && geometry(cover);
  if (reducedMotion() || (!layer.value && !start)) {
    cancelSharedCoverTransition();
    return false;
  }
  cancelAnimationFrame(frame);
  frame = 0;
  journey.returning = true;
  if (!layer.value && start) {
    const image = cover instanceof HTMLImageElement ? cover : cover?.querySelector('img');
    const src = image?.currentSrc || image?.src || '';
    if (!src) {
      cancelSharedCoverTransition();
      return false;
    }
    layer.value = {
      ...start, src, sourceShadow: journey.sourceShadow,
      targetShadow: shadow(cover!), shadowProgress: 1
    };
  }
  if (cover) hide(coverSurface(cover));
  if (cover) hide(cover);
  target = null;
  destination = null;
  armDeadline();
  return true;
}

/** Resolve after the page is mounted/activated. A late API response may replace img with a flip card. */
export function resolveSharedCoverTarget(route: string, element?: HTMLElement | null): boolean {
  if (!journey || !layer.value) return false;
  const expectedRoute = journey.returning ? journey.sourceRoute : journey.targetRoute;
  if (route !== expectedRoute) return false;
  const cover = element ?? (journey.returning ? journey.source : null);
  const end = cover && geometry(cover);
  if (!cover || !end) {
    // Wait for an asynchronously mounted hero; a missing return card has no reliable landing point.
    if (journey.returning) cancelSharedCoverTransition();
    return false;
  }
  hide(coverSurface(cover));
  hide(cover);
  destination = cover;
  if (journey.returning) {
    layer.value = { ...layer.value, sourceShadow: shadow(cover) };
  } else {
    layer.value = { ...layer.value, targetShadow: shadow(cover) };
  }
  target = { ...end, shadowProgress: journey.returning ? 0 : 1 };
  if (!frame) {
    previousTime = performance.now();
    frame = requestAnimationFrame(tick);
  }
  return true;
}

export function useSharedCoverTransition() {
  return {
    layer: readonly(layer),
    active,
    navigationFailed(route: string) {
      // Forward failures are cancelled by their journey ID at the caller; an older
      // cancelled navigation must not tear down a newer cover flight.
      if (journey?.returning && journey.sourceRoute === route) cancelSharedCoverTransition();
    },
    routeChanged(route: string) {
      if (!journey) return;
      const expectedRoute = journey.returning ? journey.sourceRoute : journey.targetRoute;
      if (route !== expectedRoute) cancelSharedCoverTransition();
    }
  };
}
