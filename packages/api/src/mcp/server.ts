import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { Anvil } from '@claymore-dev/anvil';
import { registerSearchTool } from './tools/search.js';
import { registerAnnotationTools } from './tools/annotations.js';

/**
 * Creates and configures the MCP server for Foundry
 *
 * Available tools:
 * - search_docs: Public tool for searching documentation (no auth required)
 * - list_annotations: List annotations for a document (requires auth_token when FOUNDRY_WRITE_TOKEN is set)
 * - create_annotation: Create new annotation (requires auth_token when FOUNDRY_WRITE_TOKEN is set)
 * - resolve_annotation: Mark annotation as resolved (requires auth_token when FOUNDRY_WRITE_TOKEN is set)
 * - submit_review: Submit annotations as review batch (requires auth_token when FOUNDRY_WRITE_TOKEN is set)
 *
 * Authentication:
 * - If FOUNDRY_WRITE_TOKEN environment variable is not set, all tools are accessible (dev mode)
 * - If FOUNDRY_WRITE_TOKEN is set, annotation tools require auth_token parameter matching the env var
 * - Search tools are always public and do not require authentication
 */
export function createMcpServer(anvil: Anvil): Server {
  const server = new Server({
    name: 'foundry',
    version: '0.2.0',
  }, {
    capabilities: {
      tools: {}
    }
  });

  // Register the search_docs tool
  registerSearchTool(server, anvil);

  // Register annotation tool schemas (interface only — implementation in E4)
  registerAnnotationTools(server);

  return server;
}
