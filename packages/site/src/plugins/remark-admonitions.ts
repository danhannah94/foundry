/**
 * Remark plugin to transform MkDocs-style admonitions into HTML.
 *
 * Supports: !!! note, !!! warning, !!! tip, !!! danger, !!! info
 * With optional title: !!! note "Custom Title"
 */
import { visit } from 'unist-util-visit';
import type { Root, Paragraph, Text } from 'mdast';

const VALID_TYPES = new Set(['note', 'warning', 'tip', 'danger', 'info']);

export default function remarkAdmonitions() {
  return (tree: Root) => {
    const transforms: Array<{
      index: number;
      parent: { children: Array<unknown> };
      type: string;
      title: string;
      node: Paragraph;
      rest: string | undefined;
    }> = [];

    visit(tree, 'paragraph', (node: Paragraph, index, parent) => {
      if (index === undefined || !parent) return;
      const first = node.children[0];
      if (!first || first.type !== 'text') return;

      const text = (first as Text).value;
      if (!text.startsWith('!!!')) return;

      // Parse: "!!! type" or '!!! type "title"' possibly followed by \n content
      const lines = text.split('\n');
      const headerLine = lines[0];
      const contentLines = lines.slice(1);

      // Extract type from header
      const headerMatch = headerLine.match(/^!!!\s+(\w+)/);
      if (!headerMatch) return;
      const rawType = headerMatch[1];
      if (!VALID_TYPES.has(rawType)) return;

      // Extract optional title — match content between any kind of quotes
      let rawTitle: string | undefined;
      const afterType = headerLine.slice(headerMatch[0].length).trim();
      if (afterType.length > 0) {
        rawTitle = afterType.replace(/^["'\u201c\u201d\u2018\u2019]+/, '')
                            .replace(/["'\u201c\u201d\u2018\u2019]+$/, '');
      }

      const title = rawTitle || rawType.charAt(0).toUpperCase() + rawType.slice(1);
      const rest = contentLines.length > 0 ? contentLines.join('\n') : undefined;

      transforms.push({
        index,
        parent: parent as { children: Array<unknown> },
        type: rawType,
        title,
        node,
        rest,
      });
    });

    // Apply in reverse so earlier indices stay valid.
    for (let i = transforms.length - 1; i >= 0; i--) {
      const { index, parent, type, title, node, rest } = transforms[i];

      const open = {
        type: 'html' as const,
        value: `<div class="admonition admonition-${type}"><div class="admonition-title">${title}</div><div class="admonition-content">`,
      };
      const close = {
        type: 'html' as const,
        value: `</div></div>`,
      };

      const first = node.children[0] as Text;
      let hasContent = false;

      if (rest && rest.trim()) {
        first.value = rest.replace(/^ {1,4}/gm, '');
        hasContent = true;
      } else if (node.children.length > 1) {
        node.children.shift();
        hasContent = true;
      }

      if (hasContent) {
        parent.children.splice(index, 1, open, node, close);
      } else {
        parent.children.splice(index, 1, open, close);
      }
    }
  };
}
