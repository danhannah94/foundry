import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import yaml from "js-yaml";

interface FoundryConfig {
  sources?: Array<{
    repo: string;
    branch: string;
    paths: string[];
    access: string;
  }>;
}

/**
 * Generate .access.json from foundry.config.yaml
 * Writes the file to contentDir (where Astro + nav.ts read it)
 *
 * IMPORTANT: Config paths have "docs/" prefix (repo-relative),
 * but content is served from the docs/ subdirectory, so we strip "docs/" prefix
 * to get paths relative to CONTENT_DIR.
 */
export function generateAccessMap(configPath: string, contentDir: string): Record<string, string> {
  const raw = readFileSync(configPath, "utf-8");
  const config = yaml.load(raw) as FoundryConfig;

  const accessMap: Record<string, string> = {};

  if (config?.sources) {
    for (const source of config.sources) {
      for (const p of source.paths) {
        // Strip leading "docs/" prefix since CONTENT_DIR already points inside docs/
        const contentRelative = p.replace(/^docs\//, "");
        accessMap[contentRelative] = source.access;
      }
    }
  }

  const outputPath = join(contentDir, ".access.json");
  writeFileSync(outputPath, JSON.stringify(accessMap, null, 2));
  console.log(`✅ Generated .access.json at ${outputPath}:`, accessMap);

  return accessMap;
}
