#!/usr/bin/env node
// Reads foundry.config.yaml and outputs JSON to stdout.
// Used as a fallback when yq is not available.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const yaml = require("js-yaml");

const configPath = resolve(__dirname, "..", "foundry.config.yaml");
const raw = readFileSync(configPath, "utf8");
const config = yaml.load(raw);

// Validate required fields
if (!config?.sources || !Array.isArray(config.sources)) {
  console.error("Error: foundry.config.yaml must contain a 'sources' array");
  process.exit(1);
}

for (const [i, source] of config.sources.entries()) {
  const missing = [];
  if (!source.repo) missing.push("repo");
  if (!source.branch) missing.push("branch");
  if (!source.paths || !Array.isArray(source.paths) || source.paths.length === 0)
    missing.push("paths");
  if (missing.length > 0) {
    console.error(
      `Error: sources[${i}] is missing required fields: ${missing.join(", ")}`
    );
    process.exit(1);
  }
}

process.stdout.write(JSON.stringify(config));
