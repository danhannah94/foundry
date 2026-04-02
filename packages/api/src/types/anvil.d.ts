/**
 * Fallback type declaration for @claymore-dev/anvil.
 * Used when the package is not installed (e.g., Docker builds).
 * When Anvil IS installed, the real types from the package take precedence.
 */
declare module '@claymore-dev/anvil' {
  export interface Anvil {
    search(query: string, options?: any): Promise<any[]>;
    getStatus(): Promise<any>;
    getPage(path: string): Promise<any>;
    getSection(path: string, heading: string): Promise<any>;
    listPages(): Promise<{ pages: any[] }>;
    index(): Promise<any>;
    reindexFiles(files: string[]): Promise<any>;
  }
  
  export function createAnvil(options: { docsPath: string }): Promise<Anvil>;
}
