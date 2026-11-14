import WordCloudPlayer from '@/components/lyric/WordCloudPlayer.vue';

import { registerStyle } from '../registry';
export default registerStyle({
  key: 'wordCloud',
  label: '词云',
  component: WordCloudPlayer,
  overlayComponent: WordCloudPlayer,
  isFullScreen: true,
  theme: 'dark',
  showStyleSwitch: false
});
