/** Fume-inspired reading flights, adapted to Zephyrus' interruptible camera spring.
 * Reference: chthollyphile/folia-major, fumeCamera{,Step}.ts at 4a545c9.
 * All animation state is small; no text layout or playback data is changed here.
 */
import { clampCloud, type CloudCamera, type CloudRect, stepCloudCamera } from './wordCloud';

export interface CloudMotion {
  camera: CloudCamera;
  velocity: CloudCamera;
  source: string;
  time: number;
  flight?: {
    from: CloudCamera;
    waypoint?: CloudCamera;
    elapsed: number;
    duration: number;
  };
  initialized: boolean;
  settled: boolean;
}
export const createCloudMotion = (): CloudMotion => ({
  camera: { x: 0, y: 0, scale: 1, angle: 0 },
  velocity: { x: 0, y: 0, scale: 0, angle: 0 },
  source: '',
  time: 0,
  initialized: false,
  settled: true
});
const smooth = (x: number) => (x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2);
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const angleTo = (from: number, to: number) =>
  from + Math.atan2(Math.sin(to - from), Math.cos(to - from));

export function stepCloudMotion(
  state: CloudMotion,
  input: {
    target: CloudCamera;
    overview: CloudCamera;
    view: CloudRect;
    source: string;
    time: number;
    dt: number;
    speed: number;
    floating: boolean;
    reduced: boolean;
  }
): CloudMotion {
  const { view, source, time, dt, speed, overview } = input;
  const target = { ...input.target };
  if (input.floating && !input.reduced) {
    const phase = (time / 7) * Math.PI * 2;
    target.x -= (Math.sin(phase * 0.74 + 0.8) * 18 * 0.34) / target.scale;
    target.y -= (Math.sin(phase) * 18 + Math.sin(phase * 0.5 + 1.1) * 3.96) / target.scale;
    target.scale *= 1 + Math.sin(phase + 0.9) * 0.011;
  }
  if (!state.initialized || input.reduced)
    return {
      ...createCloudMotion(),
      initialized: true,
      camera: target,
      time,
      source
    };
  let flight = state.flight && { ...state.flight, elapsed: state.flight.elapsed + dt };
  const seek = Math.abs(time - state.time) > Math.max(0.75, dt * 2);
  if (source !== state.source || seek) {
    const side = Math.max(1, Math.min(view.width, view.height));
    const distance =
      Math.hypot(target.x - state.camera.x, target.y - state.camera.y) *
      Math.max(state.camera.scale, target.scale);
    const screens = distance / side;
    let duration = (source === 'overview' ? clampCloud(side / 1500, 0.38, 0.58) : 0.09) / speed;
    let waypoint: CloudCamera | undefined;
    if (source !== 'overview' && screens >= 2.75) {
      const strength = clampCloud((screens - 2.75) / 3.4);
      const bias = mix(0.18, 0.42, strength);
      const scale = Math.max(state.camera.scale, target.scale);
      waypoint = {
        x: mix((state.camera.x + target.x) / 2, overview.x, bias),
        y: mix((state.camera.y + target.y) / 2, overview.y, bias),
        scale: Math.min(scale * 0.92, Math.max(scale * mix(0.62, 0.4, strength), overview.scale)),
        angle: angleTo(state.camera.angle, target.angle)
      };
      duration = clampCloud(0.26 + (screens / 5.5) * 0.28, 0.3, 0.68) / speed;
    }
    flight =
      screens >= 0.42 || source === 'overview'
        ? { from: { ...state.camera }, elapsed: 0, duration, waypoint }
        : undefined;
  }
  let goal = target;
  if (flight && flight.elapsed < flight.duration) {
    const progress = smooth(clampCloud(flight.elapsed / flight.duration));
    goal = {
      ...target,
      angle: mix(flight.from.angle, angleTo(flight.from.angle, target.angle), progress)
    };
    if (flight.waypoint) {
      for (const key of ['x', 'y'] as const)
        goal[key] =
          (1 - progress) ** 2 * flight.from[key] +
          2 * (1 - progress) * progress * flight.waypoint[key] +
          progress ** 2 * target[key];
      goal.scale =
        progress < 0.4
          ? mix(flight.from.scale, flight.waypoint.scale, smooth(progress / 0.4))
          : mix(flight.waypoint.scale, target.scale, smooth((progress - 0.4) / 0.6));
    } else {
      for (const key of ['x', 'y', 'scale'] as const)
        goal[key] = mix(flight.from[key], target[key], progress);
    }
  } else flight = undefined;
  const step = stepCloudCamera(state.camera, state.velocity, goal, dt, speed);
  const settled = step.settled && !flight;
  return {
    camera: settled ? target : step.camera,
    velocity: settled ? createCloudMotion().velocity : step.velocity,
    source,
    time,
    flight,
    settled,
    initialized: true
  };
}
