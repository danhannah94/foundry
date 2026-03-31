import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerAnnotationTools } from './tools/annotations.js';

/**
 * Create and configure the MCP server for Foundry
 */
export function createMcpServer(): Server {
  const server = new Server(
    {
      name: 'foundry-mcp-server',
      version: '0.1.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Register annotation tools
  registerAnnotationTools(server);

  return server;
}

/**
 * Start the MCP server with stdio transport
 */
export async function startMcpServer(): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();

  await server.connect(transport);
}