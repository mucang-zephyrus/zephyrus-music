<script setup lang="ts">
import type { HTMLAttributes } from 'vue';
import { onBeforeUnmount, onMounted, provide, ref } from 'vue';

import { cn } from '@/lib/cn';
import { PARALLAX_FLOAT_KEY, type ParallaxFloatContext } from './ParallaxFloatContext';

interface Props {
  class?: HTMLAttributes['class'];
  sensitivity?: number;
  easingFactor?: number;
}

const props = withDefaults(defineProps<Props>(), {
  sensitivity: 1,
  easingFactor: 0.05
});

const containerRef = ref<HTMLElement | null>(null);
const mousePosition = { x: 0, y: 0 };
const elements = new Map<
  HTMLElement,
  { depth: number; currentPosition: { x: number; y: number } }
>();

const context: ParallaxFloatContext = {
  registerElement(element, depth) {
    elements.set(element, {
      depth: depth ?? 0.01,
      currentPosition: { x: 0, y: 0 }
    });
  },
  updateElement(element, depth) {
    const data = elements.get(element);
    if (data) data.depth = depth ?? 0.01;
  },
  unregisterElement(element) {
    elements.delete(element);
  }
};

provide(PARALLAX_FLOAT_KEY, context);

let animationFrame = 0;

// ── 手机陀螺仪视差：以自然握持角为基准，gamma 左右 / beta 前后驱动 ──
// iOS 13+ 的 DeviceOrientationEvent.requestPermission 必须在用户手势里调用，
// 所以在首次触摸时请求；拒绝或不支持时回退触摸视差，互不打架（桌面无陀螺仪事件）
let gyroEnabled = false;
let gyroNeutralBeta: number | null = null;

const prefersReducedMotion = () =>
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

function handleOrientation(event: DeviceOrientationEvent) {
  const container = containerRef.value;
  if (!container || event.gamma == null || event.beta == null) return;
  const rect = container.getBoundingClientRect();
  const maxTilt = 22;
  const gamma = Math.max(-maxTilt, Math.min(maxTilt, event.gamma));
  if (gyroNeutralBeta === null) {
    // 首次读数即"自然握持角"，夹在常见 20°..60° 之间做零点
    gyroNeutralBeta = Math.min(60, Math.max(20, event.beta));
  }
  const dBeta = Math.max(-maxTilt, Math.min(maxTilt, event.beta - gyroNeutralBeta));
  mousePosition.x = rect.width / 2 + (gamma / maxTilt) * (rect.width / 2);
  mousePosition.y = rect.height / 2 + (dBeta / maxTilt) * (rect.height / 2);
}

async function enableGyro(): Promise<void> {
  if (gyroEnabled || prefersReducedMotion()) return;
  const ctor = (
    window as unknown as {
      DeviceOrientationEvent?: {
        new (): DeviceOrientationEvent;
        requestPermission?: () => Promise<"granted" | "denied">;
      };
    }
  ).DeviceOrientationEvent;
  if (!ctor) return;
  try {
    if (typeof ctor.requestPermission === "function") {
      const state = await ctor.requestPermission();
      if (state !== "granted") return;
    }
    window.addEventListener("deviceorientation", handleOrientation, { passive: true });
    gyroEnabled = true;
  } catch {
    /* 授权失败/不支持：静默回退触摸视差 */
  }
}

function handleFirstGesture() {
  void enableGyro();
}

function updateMousePosition(clientX: number, clientY: number) {
  const container = containerRef.value;
  if (!container) return;

  const rect = container.getBoundingClientRect();
  mousePosition.x = clientX - rect.left;
  mousePosition.y = clientY - rect.top;
}

function handleMouseMove(event: MouseEvent) {
  updateMousePosition(event.clientX, event.clientY);
}

function handleTouchMove(event: TouchEvent) {
  const touch = event.touches[0];
  if (touch) updateMousePosition(touch.clientX, touch.clientY);
}

function animate() {
  elements.forEach((data, element) => {
    const strength = (data.depth * props.sensitivity) / 20;
    const targetX = mousePosition.x * strength;
    const targetY = mousePosition.y * strength;
    const easingFactor = Math.min(Math.max(props.easingFactor, 0), 1);

    data.currentPosition.x += (targetX - data.currentPosition.x) * easingFactor;
    data.currentPosition.y += (targetY - data.currentPosition.y) * easingFactor;

    element.style.transform = `translate3d(${data.currentPosition.x}px, ${data.currentPosition.y}px, 0)`;
  });

  animationFrame = window.requestAnimationFrame(animate);
}

onMounted(() => {
  window.addEventListener("mousemove", handleMouseMove, { passive: true });
  window.addEventListener("touchmove", handleTouchMove, { passive: true });
  // 陀螺仪授权挂在一次性手势上（触摸/点击任意处），iOS 合规
  window.addEventListener("touchend", handleFirstGesture, { once: true, passive: true });
  window.addEventListener("click", handleFirstGesture, { once: true });
  animationFrame = window.requestAnimationFrame(animate);
});

onBeforeUnmount(() => {
  window.removeEventListener("mousemove", handleMouseMove);
  window.removeEventListener("touchmove", handleTouchMove);
  window.removeEventListener("touchend", handleFirstGesture);
  window.removeEventListener("click", handleFirstGesture);
  if (gyroEnabled) {
    window.removeEventListener("deviceorientation", handleOrientation);
    gyroEnabled = false;
  }
  gyroNeutralBeta = null;
  window.cancelAnimationFrame(animationFrame);
  elements.clear();
});
</script>

<template>
  <div
    ref="containerRef"
    :class="cn('absolute top-0 left-0 h-full w-full', props.class)"
  >
    <slot />
  </div>
</template>
