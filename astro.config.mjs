import { defineConfig } from 'astro/config';
import node from '@astrojs/node';

export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  build: { inlineStylesheets: 'never' },
  server: { host: '127.0.0.1' },
});