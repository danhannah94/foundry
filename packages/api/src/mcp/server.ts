import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import type { Anvil } from '@claymore-dev/anvil';
import { registerSearchTool } from './tools/search.js';

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

  return server;
}