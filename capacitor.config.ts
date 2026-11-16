import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.crownsync.app',
  appName: 'Crown Sync',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
};

export default config;
