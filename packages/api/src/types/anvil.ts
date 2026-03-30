// Temporary stub types for @claymore-dev/anvil until the package is available
//
// TO REPLACE WITH REAL ANVIL:
// 1. Install: npm install @claymore-dev/anvil
// 2. Or for local dev: "@claymore-dev/anvil": "file:../../anvil" in package.json
// 3. Replace imports in index.ts and routes/health.ts:
//    - from: import { createAnvil } from './types/anvil.js';
//    - to:   import { createAnvil } from '@claymore-dev/anvil';
// 4. Remove this stub file

export interface AnvilStatus {
  totalPages: number;
  totalChunks: number;
  lastIndexed: string | null;
}

export interface AnvilInstance {
  getStatus(): Promise<AnvilStatus>;
}

export interface AnvilOptions {
  docsPath: string;
}

// Stub implementation for createAnvil
export function createAnvil(options: AnvilOptions): AnvilInstance {
  console.warn('Using stub Anvil implementation - replace with real @claymore-dev/anvil when available');

  return {
    async getStatus(): Promise<AnvilStatus> {
      return {
        totalPages: 0,
        totalChunks: 0,
        lastIndexed: null,
      };
    },
  };
}