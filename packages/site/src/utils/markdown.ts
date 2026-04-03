import fs from 'node:fs';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeStringify from 'rehype-stringify';
import rehypeRaw from 'rehype-raw';
import rehypeSlug from 'rehype-slug';
import rehypeAutolinkHeadings from 'rehype-autolink-headings';
import rehypeShiki from '@shikijs/rehype';
import matter from 'gray-matter';
import remarkAdmonitions from '../plugins/remark-admonitions.ts';
import remarkMermaid from '../plugins/remark-mermaid.ts';

let processor: ReturnType<typeof unified> | null = null;

async function getProcessor() {
  if (processor) return processor;

  processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMermaid)
    .use(remarkAdmonitions)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(rehypeSlug)
    .use(rehypeAutolinkHeadings, {
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
    })
    .use(rehypeShiki, {
      themes: {
        light: 'github-light',
        dark: 'github-dark',
      },
    })
    .use(rehypeStringify);

  return processor;
}

export async function renderMarkdown(filePath: string): Promise<{ html: string; frontmatter: Record<string, any> }> {
  const raw = fs.readFileSync(filePath, 'utf-8');
  const { content, data: frontmatter } = matter(raw);

  const proc = await getProcessor();
  const result = await proc.process(content);

  return {
    html: String(result),
    frontmatter,
  };
}
