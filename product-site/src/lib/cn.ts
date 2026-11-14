import { clsx, type ClassValue } from 'clsx';

/**
 * 轻量 class 组合（替代 @inspira-ui/plugins 的 cn）：
 * 官网组件的类组合不涉及 Tailwind 冲突合并，clsx 足够，省一个依赖。
 */
export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}
