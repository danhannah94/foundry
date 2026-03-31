import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { Anvil } from '@claymore-dev/anvil';
import { registerSearchTool } from './tools/search.js';
import { registerAnnotationTools } from './tools/annotations.js';

/**
 * Creates and configures the MCP server for Foundry
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
