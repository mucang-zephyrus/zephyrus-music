import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.zephyrus.player',
  appName: 'Zephyrus Music',
  webDir: 'src/renderer/dist',
  server: {
    androidScheme: 'https'
  },
  android: {
    allowMixedContent: true
  },
  plugins: {
    CapacitorHttp: {
      enabled: true
    },
    SystemBars: {
      insetsHandling: 'disable'
    }
  }
};

export default config;
