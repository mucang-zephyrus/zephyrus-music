import type { Directive } from 'vue';

/**
 * 滚动入场（替代 Inspira 的 BlurReveal，省 motion-v 依赖）：
 * IntersectionObserver 单例 + .is-revealed 类，CSS 完成模糊/位移过渡。
 * prefers-reduced-motion 下样式侧直接跳过动画。
 */
const observer =
  typeof IntersectionObserver !== 'undefined'
    ? new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) {
              entry.target.classList.add('is-revealed');
              observer?.unobserve(entry.target);
            }
          }
        },
        { threshold: 0.18, rootMargin: '0px 0px -6% 0px' }
      )
    : null;

export const reveal: Directive<HTMLElement, { delay?: number } | undefined> = {
  mounted(el, binding) {
    el.classList.add('reveal');
    if (binding.value?.delay) {
      el.style.transitionDelay = `${binding.value.delay}ms`;
    }
    if (observer) observer.observe(el);
    else el.classList.add('is-revealed');
  },
  unmounted(el) {
    observer?.unobserve(el);
  }
};
