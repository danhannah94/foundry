import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { registerSearchTool } from './tools/search.js';
import { registerAnnotationTools } from './tools/annotations.js';
import { registerReviewTools } from './tools/review-tools.js';
import { registerNavTools } from './tools/nav-tools.js';

/**
 * Creates and configures the MCP server for Foundry.
 * All tools communicate via HTTP API (no direct DB or Anvil dependency).
 *
 * Available tools:
 * - search_docs: Semantic search (delegates auth filtering to HTTP API)
 * - list_annotations: List annotations for a document
 * - create_annotation: Create new annotation
 * - resolve_annotation: Mark annotation as resolved
 * - submit_review: Submit annotations as review batch
 * - list_reviews: List reviews for a document
 * - get_review: Get a review by ID with annotations
 * - list_pages: List pages from nav tree
 */
export function createMcpServer(): Server {
  const server = new Server({
    name: 'foundry',
    version: '0.2.0',
  }, {
    capabilities: {
      tools: {}
    }
  });

  // Register the search_docs tool
  registerSearchTool(server);

  // Register annotation tools
  registerAnnotationTools(server);

  // Register review tools
  registerReviewTools(server);

  // Register nav tools
  registerNavTools(server);

  return server;
}
