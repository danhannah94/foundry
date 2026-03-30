/**
 * Remark plugin to transform mermaid fenced code blocks into
 * <pre class="mermaid"> elements for client-side rendering.
 *
 * Runs before Shiki so mermaid blocks are not syntax-highlighted.
 */
import { visit } from 'unist-util-visit';
import type { Root, Code } from 'mdast';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export default function remarkMermaid() {
  return (tree: Root) => {
    visit(tree, 'code', (node: Code, index, parent) => {
      if (node.lang !== 'mermaid' || index === undefined || !parent) return;

      (parent.children as unknown[])[index] = {
        type: 'html' as const,
        value: `<pre class="mermaid">${escapeHtml(node.value)}</pre>`,
      };
    });
  };
}
