#!/usr/bin/env node
/**
 * Foundry MCP Server — stdio transport entry point.
 *
 * Runs as a local child process (spawned by mcporter or any MCP client).
 * All tool calls go through http-client.ts → HTTPS → deployed Foundry API.
 *
 * Environment variables:
 *   FOUNDRY_API_URL    — Base URL of the Foundry API (default: http://localhost:3001)
 *   FOUNDRY_WRITE_TOKEN — Bearer token for write operations
 *
 * Usage:
 *   node dist/mcp/stdio.js
 *
 * mcporter config:
 *   {
 *     "command": "node",
 *     "args": ["packages/api/dist/mcp/stdio.js"],
 *     "env": {
 *       "FOUNDRY_API_URL": "https://foundry-claymore.fly.dev",
 *       "FOUNDRY_WRITE_TOKEN": "your-token"
 *     }
 *   }
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpServer } from './server.js';

async function main(): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();

  await server.connect(transport);

  // Clean shutdown on SIGINT/SIGTERM
  process.on('SIGINT', async () => {
    await server.close();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await server.close();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error('Foundry MCP stdio server failed:', error);
  process.exit(1);
});
