import { describe, expect, it } from 'vitest';

import { computeEtherTheme, ETHER_GRAY_THEME, GRAY_COVER_THRESHOLD } from '@/utils/etherTheme';

const isNeutral = ([r, g, b]: [number, number, number]) =>
  Math.abs(r - g) < 1e-6 && Math.abs(g - b) < 1e-6;

describe('computeEtherTheme', () => {
  it('黑白灰占比 > 95% 时直接给中性灰度墨（犬儒乐队《皮囊》）', () => {
    // 《皮囊》封面实测 grayRatio = 1.0，平均色 rgb(133,133,133)；
    // 上游去灰后主题色是 #857f7f 这种带红相的灰，不能拿它的色相造墨。
    const theme = computeEtherTheme({
      color: '#857f7f',
      rawColor: 'rgb(133, 133, 133)',
      grayRatio: 1
    });
    expect(theme).toBe(ETHER_GRAY_THEME);
    for (const ink of [theme!.inkDark, theme!.inkLight, theme!.inkHot, theme!.bg, theme!.flash]) {
      expect(isNeutral(ink)).toBe(true);
    }
  });

  it('阈值是严格大于 0.95：恰好 95% 不走灰度分支', () => {
    expect(
      computeEtherTheme({ color: '#857f7f', rawColor: 'rgb(133, 133, 133)', grayRatio: GRAY_COVER_THRESHOLD })
    ).toBeNull();
    expect(
      computeEtherTheme({ color: '#857f7f', rawColor: 'rgb(133, 133, 133)', grayRatio: 0.96 })
    ).toBe(ETHER_GRAY_THEME);
  });

  it('低饱和但有色相的封面保留色相（犬儒乐队《心房》）', () => {
    // 《心房》实测 grayRatio = 0.136，平均色 rgb(97,108,104)，色相 158°
    const theme = computeEtherTheme({
      color: '#65726d',
      rawColor: 'rgb(97, 108, 104)',
      grayRatio: 0.136
    });
    expect(theme).not.toBeNull();
    expect(theme).not.toBe(ETHER_GRAY_THEME);
    const [r, g, b] = theme!.inkHot;
    expect(g).toBeGreaterThan(r);
    expect(g).toBeGreaterThan(b);
  });

  it('饱和度足够的彩色封面直接用自身色相', () => {
    const theme = computeEtherTheme({ color: '#c0392b', grayRatio: 0.1 });
    expect(theme).not.toBeNull();
    const [r, g, b] = theme!.inkHot;
    expect(r).toBeGreaterThan(g);
    expect(r).toBeGreaterThan(b);
  });

  it('真灰但没有灰度占比数据时仍回退暖墨（保持旧行为）', () => {
    expect(computeEtherTheme({ color: '#857f7f', rawColor: 'rgb(133,133,133)' })).toBeNull();
    expect(computeEtherTheme({ color: '', grayRatio: 0 })).toBeNull();
  });

  it('灰度主题不随色相输入变化', () => {
    const green = computeEtherTheme({ color: '#65726d', rawColor: 'rgb(97,108,104)', grayRatio: 0.99 });
    const blue = computeEtherTheme({ color: '#2b3f7a', rawColor: 'rgb(43,63,122)', grayRatio: 0.99 });
    expect(green).toEqual(blue);
    expect(green).toEqual(ETHER_GRAY_THEME);
  });
});
