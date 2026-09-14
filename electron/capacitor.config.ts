import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.porter.cineroll',
  appName: 'CineRoll',
  webDir: 'public', // Keeps compatibility safe
  server: {
    url: 'http://192.168.86.75:3001', // Directs Electron to talk to your Next.js process
    cleartext: true
  }
};

export default config;
