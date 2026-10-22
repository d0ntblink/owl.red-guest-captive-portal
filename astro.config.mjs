import { defineConfig } from 'astro/config';
import node from '@astrojs/node';

export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  build: { inlineStylesheets: 'never' },
  security: {
    allowedDomains: [
      { protocol: 'https', hostname: 'guest.owl.red' },
      { protocol: 'http', hostname: '127.0.0.1' },
      { protocol: 'http', hostname: 'localhost' },
    ],
  },
  server: { host: '127.0.0.1' },
});