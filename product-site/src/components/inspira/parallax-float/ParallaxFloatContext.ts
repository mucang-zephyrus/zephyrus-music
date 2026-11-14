import type { InjectionKey } from 'vue';

/**
 * Inspira UI ParallaxFloat 的上下文（拷贝自 unovue/inspira-ui，MIT）。
 * 仅调整：cn 导入指向本地实现。
 */
export interface ParallaxFloatContext {
  registerElement: (element: HTMLElement, depth?: number) => void;
  updateElement: (element: HTMLElement, depth?: number) => void;
  unregisterElement: (element: HTMLElement) => void;
}

export const PARALLAX_FLOAT_KEY: InjectionKey<ParallaxFloatContext> = Symbol(
  'parallax-float-key'
) as InjectionKey<ParallaxFloatContext>;
