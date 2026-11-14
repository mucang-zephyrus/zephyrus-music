import type { LyricPlayer } from '@applemusic-like-lyrics/core';

/**
 * AMLL 0.6 的 Resize 排版仍会给行位置设置弹簧目标。宿主已经在逐帧改变
 * 容器尺寸时，使用连续拖动排版策略同步行位置，避免再叠加一条滞后的动画。
 * 只适配当前实例的 Resize；播放推进、跳转、滚动仍使用原来的排版策略。
 */
export function followAmllLayout(player: Pick<LyricPlayer, 'calcLayout' | 'update'>) {
  const original = player.calcLayout;
  let following = false;
  let releaseFrame = 0;
  const layout: typeof original = function (this: typeof player, reason) {
    const followResize = following && reason === 'resize';
    original.call(this, followResize ? 'continuous-scroll' : reason);
    // ResizeObserver 在本帧 RAF 之后运行。直接提交位置，避免容器已经扩展，
    // 歌词行却等到下一帧才绘制；不推进歌词时间或额外模拟一个动画步长。
    if (followResize) this.update(0);
  };
  player.calcLayout = layout;

  const cancelRelease = () => {
    if (releaseFrame) cancelAnimationFrame(releaseFrame);
    releaseFrame = 0;
  };

  return {
    setFollowing(value: boolean) {
      cancelRelease();
      if (value) {
        following = true;
      } else if (following) {
        // Vue 落定后的最后一次 ResizeObserver 通知仍需同步布局。跨两个绘制帧
        // 再释放，防止最后一帧重新启动弹簧；新手势可立即取消这次释放。
        releaseFrame = requestAnimationFrame(() => {
          releaseFrame = requestAnimationFrame(() => {
            releaseFrame = 0;
            following = false;
          });
        });
      }
    },
    dispose() {
      cancelRelease();
      if (player.calcLayout === layout) player.calcLayout = original;
    }
  };
}
