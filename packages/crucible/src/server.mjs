import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { createSession } from './session.mjs';
import * as navigateTool from './tools/navigate.mjs';
import * as screenshotTool from './tools/screenshot-page.mjs';
import * as compareTool from './tools/compare-screenshots.mjs';
import * as approveTool from './tools/approve-baseline.mjs';
import * as listBaselinesTool from './tools/list-baselines.mjs';
import * as runScriptTool from './tools/run-script.mjs';
import * as clickTool from './tools/click.mjs';

const TOOLS = [navigateTool, screenshotTool, compareTool, approveTool, listBaselinesTool, runScriptTool, clickTool];

export function createCrucibleServer({ session } = {}) {
  const sess = session || createSession();

  const mcp = new McpServer(
    { name: 'crucible', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );

  for (const tool of TOOLS) {
    mcp.registerTool(tool.name, tool.config, tool.createHandler(sess));
  }

  async function shutdown() {
    try { await mcp.close(); } catch {}
    await sess.shutdown();
  }

  return { mcp, session: sess, shutdown };
}

export async function startStdioServer() {
  const { mcp, shutdown } = createCrucibleServer();

  const onExit = async () => {
    await shutdown();
    process.exit(0);
  };
  process.on('SIGINT', onExit);
  process.on('SIGTERM', onExit);

  const transport = new StdioServerTransport();
  await mcp.connect(transport);
  return { mcp, shutdown };
}
