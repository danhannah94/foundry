import { Router, Request, Response } from 'express';
import type { Anvil } from '@claymore-dev/anvil';
import { getAccessLevel } from '../access.js';
import { requireAuth } from '../middleware/auth.js';

interface DocumentListItem {
  path: string;
  title: string;
  lastModified: string;
  chunkCount: number;
}

interface DocumentSection {
  heading: string;
  level: number;
  charCount: number;
  content: string;
}

interface DocumentDetail {
  path: string;
  title: string;
  lastModified: string;
  sections: DocumentSection[];
}

/**
 * Creates the docs router
 */
export function createDocsRouter(anvil: Anvil): Router {
  const router = Router();

  // GET /docs - List all indexed documents
  router.get('/docs', async (req: Request, res: Response<DocumentListItem[]>) => {
    try {
      const { pages } = await anvil.listPages();

      const documents: DocumentListItem[] = pages.map(page => ({
        path: page.file_path,
        title: page.title,
        lastModified: page.last_modified,
        chunkCount: page.chunk_count,
      }));

      res.json(documents);
    } catch (error) {
      console.error('Error listing documents:', error);
      res.status(500).json({
        error: 'Failed to list documents',
      } as any);
    }
  });

  // GET /docs/:path(*)/sections/:heading(*) - Get a specific section from a document
  router.get('/docs/:path(*)/sections/:heading(*)', async (req, res) => {
    try {
      const section = await anvil.getSection(req.params.path, req.params.heading);
      if (!section) return res.status(404).json({ error: 'Section not found' });
      res.json(section);
    } catch (error) {
      console.error('Error fetching section:', error);
      res.status(500).json({ error: 'Failed to fetch section' });
    }
  });

  // GET /docs/:path(*) - Get single document with section structure
  router.get('/docs/:path(*)', async (req: Request, res: Response<DocumentDetail>) => {
    try {
      const path = req.params.path;

      // Check access level for this document path
      const level = getAccessLevel(path);
      if (level === 'private') {
        // Check auth using the same middleware logic
        try {
          await new Promise<void>((resolve, reject) => {
            requireAuth(req, res, (err?: any) => {
              if (err) reject(err);
              else resolve();
            });
          });
        } catch (authError) {
          return res.status(401).json({
            error: 'Authentication required for private content',
          } as any);
        }
      }

      const page = await anvil.getPage(path);

      if (!page) {
        return res.status(404).json({
          error: 'Document not found',
        } as any);
      }

      // Extract sections from chunks, aggregating content by heading
      const sectionMap = new Map<string, DocumentSection>();
      const sortedChunks = [...page.chunks].sort((a, b) => a.ordinal - b.ordinal);

      for (const chunk of sortedChunks) {
        if (!chunk.heading_path) continue;
        const existing = sectionMap.get(chunk.heading_path);
        if (existing) {
          existing.content += '\n' + chunk.content;
          existing.charCount += chunk.char_count;
        } else {
          sectionMap.set(chunk.heading_path, {
            heading: chunk.heading_path,
            level: chunk.heading_level,
            charCount: chunk.char_count,
            content: chunk.content,
          });
        }
      }
      const sections = Array.from(sectionMap.values());

      const document: DocumentDetail = {
        path: page.file_path,
        title: page.title,
        lastModified: page.last_modified,
        sections,
      };

      res.json(document);
    } catch (error) {
      console.error('Error fetching document:', error);
      res.status(500).json({
        error: 'Failed to fetch document',
      } as any);
    }
  });

  return router;
}