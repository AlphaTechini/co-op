import adapter from '@sveltejs/adapter-vercel';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

// SvelteKit 3 reads its configuration from the plugin call, not from svelte.config.js.
export default defineConfig({
  plugins: [sveltekit({
      adapter: adapter(),
      // read PUBLIC_* from the repo-level .env shared with the server
      env: { dir: '..' }
    })],
  test: { include: ['src/**/*.test.ts'], environment: 'node' }
});
