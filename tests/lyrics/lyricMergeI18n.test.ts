import { expect, it } from 'vitest';

import en from '../../src/i18n/lang/en-US/comp';
import ja from '../../src/i18n/lang/ja-JP/comp';
import ko from '../../src/i18n/lang/ko-KR/comp';
import cn from '../../src/i18n/lang/zh-CN/comp';
import tw from '../../src/i18n/lang/zh-Hant/comp';

it('provides every smart-merge message in all five languages', () => {
  const expected = Object.keys(cn.smartLyricMerge).sort();
  for (const locale of [en, ja, ko, tw]) {
    expect(Object.keys(locale.smartLyricMerge).sort()).toEqual(expected);
    expect(Object.values(locale.smartLyricMerge).every(value => value.trim().length > 0)).toBe(true);
  }
  expect(cn.smartLyricMerge.notice).toBe('该歌词运用了智能翻译合并算法，如有错误，点此处反馈');
});
