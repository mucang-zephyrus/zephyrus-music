import DotMatrixPlayer from '@/components/lyric/DotMatrixPlayer.vue';

import { registerStyle } from '../registry';

export default registerStyle({
  key: 'dotMatrix',
  label: '点阵',
  component: DotMatrixPlayer,
  overlayComponent: DotMatrixPlayer,
  isFullScreen: true,
  theme: 'light',
  showStyleSwitch: false
});
