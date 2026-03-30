import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import rehypeSlug from 'rehype-slug';
import rehypeAutolinkHeadings from 'rehype-autolink-headings';
import remarkAdmonitions from './src/plugins/remark-admonitions.ts';
import remarkMermaid from './src/plugins/remark-mermaid.ts';

console.error('>>> remarkAdmonitions type:', typeof remarkAdmonitions, remarkAdmonitions?.name);
console.error('>>> remarkMermaid type:', typeof remarkMermaid, remarkMermaid?.name);
console.error('>>> remarkAdmonitions keys:', remarkAdmonitions ? Object.keys(remarkAdmonitions) : 'null');

export default defineConfig({
  integrations: [react()],

  markdown: {
    remarkPlugins: [remarkMermaid, remarkAdmonitions],
    rehypePlugins: [
      rehypeSlug,
      [
        rehypeAutolinkHeadings,
        {
          behavior: 'append',
          properties: {
            className: ['heading-anchor'],
            ariaHidden: 'true',
            tabIndex: -1,
          },
          content: {
            type: 'text',
            value: '#',
          },
        },
      ],
    ],
    shikiConfig: {
      themes: {
        light: 'github-light',
        dark: 'github-dark',
      },
    },
  },

  // Content lives in content/ directory, populated by build script
  // GitHub Pages base path — update if deploying to subpath
  // base: '/foundry',
});
