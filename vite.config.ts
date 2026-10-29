import { sveltekit } from '@sveltejs/kit/vite';
import adapter from '@sveltejs/adapter-node';
import { defineConfig } from 'vitest/config';
export default defineConfig({
  plugins: [
    sveltekit({
      adapter: adapter(),
      csp: {
        mode: 'auto',
        directives: {
          'default-src': ['self'],
          'script-src': ['self'],
          'style-src': ['self', 'unsafe-inline'],
          'img-src': ['self', 'data:'],
          'connect-src': ['self'],
          'frame-ancestors': ['none'],
          'form-action': ['self'],
          'base-uri': ['none'],
        },
      },
    }),
  ],
  test: { include: ['tests/**/*.test.ts'], fileParallelism: false, pool: 'forks' },
});
