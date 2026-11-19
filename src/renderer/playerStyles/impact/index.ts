import ImpactPlayer from '@/components/lyric/ImpactPlayer.vue';

import { registerStyle } from '../registry';

export default registerStyle({
  key: 'impact',
  label: '冲击',
  component: ImpactPlayer,
  overlayComponent: ImpactPlayer,
  isFullScreen: true,
  theme: 'dark',
  showStyleSwitch: false
});
