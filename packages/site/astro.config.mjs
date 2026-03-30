import { defineConfig } from 'astro/config';
import react from '@astrojs/react';

export default defineConfig({
  integrations: [react()],
  // Content lives in content/ directory, populated by build script
  // GitHub Pages base path — update if deploying to subpath
  // base: '/foundry',
});
