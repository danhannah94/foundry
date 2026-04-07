#!/usr/bin/env node

import { importFromRepo } from './import.js';

function printUsage(): void {
  console.log(`
Usage: foundry import --repo <url> [--branch <branch>] [--prefix <prefix>] [--content-dir <dir>] [--db-path <path>]

Options:
  --repo         Repository URL (required)
  --branch       Git branch (default: main)
  --prefix       Source prefix to strip (default: docs/)
  --content-dir  Target content directory (default: CONTENT_DIR env or /data/docs/)
  --db-path      SQLite database path (default: FOUNDRY_DB_PATH env or ./foundry.db)
`);
}

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--') && i + 1 < argv.length) {
      const key = argv[i].slice(2);
      args[key] = argv[i + 1];
      i++;
    }
  }
  return args;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  // First positional arg should be the command
  const command = argv[0];
  if (command !== 'import') {
    if (command === '--help' || command === '-h' || !command) {
      printUsage();
      process.exit(0);
    }
    console.error(`Unknown command: ${command}`);
    printUsage();
    process.exit(1);
  }

  const args = parseArgs(argv.slice(1));

  if (!args.repo) {
    console.error('Error: --repo is required');
    printUsage();
    process.exit(1);
  }

  const contentDir = args['content-dir'] || process.env.CONTENT_DIR || '/data/docs/';
  const dbPath = args['db-path'] || process.env.FOUNDRY_DB_PATH || './foundry.db';

  console.log(`Importing from ${args.repo} (branch: ${args.branch || 'main'}, prefix: ${args.prefix || 'docs/'})...`);
  console.log(`Content dir: ${contentDir}`);
  console.log(`Database: ${dbPath}`);

  try {
    const result = await importFromRepo({
      repoUrl: args.repo,
      branch: args.branch,
      prefix: args.prefix,
      contentDir,
      dbPath,
    });

    console.log(`\nImport complete:`);
    console.log(`  Files imported:    ${result.filesImported}`);
    console.log(`  docs_meta updated: ${result.docsMetaUpdated}`);
    console.log(`  Duration:          ${result.duration_ms}ms`);
  } catch (error: any) {
    console.error(`\nImport failed: ${error.message}`);
    process.exit(1);
  }
}

main();
