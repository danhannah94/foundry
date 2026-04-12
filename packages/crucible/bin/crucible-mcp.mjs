#!/usr/bin/env node
import { startStdioServer } from '../src/server.mjs';

startStdioServer().catch((err) => {
  console.error('[crucible] fatal:', err);
  process.exit(1);
});
