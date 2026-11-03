import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

// SvelteKit 3 reads its configuration from the plugin call, not from svelte.config.js.
// `fallback` makes every unknown path (and /pool?id=N on hosts without rewrites) boot the SPA.
export default defineConfig({
  plugins: [sveltekit({
      adapter: adapter({ fallback: '200.html' }),
      // read PUBLIC_* from the repo-level .env shared with the server
      env: { dir: '..' }
    })],
  test: { include: ['src/**/*.test.ts'], environment: 'node' }
});
