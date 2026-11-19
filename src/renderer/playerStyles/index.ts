// 导入所有模式（触发自注册）
import './default';
import './stage';
import './starChart';
import './wordCloud';
import './dotMatrix';
import './impact';
import './smoke';
import './error';

// 导出注册表 API
export type { PlayerStyleDefinition, SettingItem } from './registry';
export { getAllStyles, getStyle } from './registry';

// 导出自定义函数
export { useStyleContext } from './useStyleContext';
