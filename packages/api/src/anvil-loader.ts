/**
 * Dynamic Anvil loader — handles missing @claymore-dev/anvil gracefully.
 * Returns null if Anvil is not installed (e.g., Docker builds without it).
 *
 * Embedding provider configured via env vars:
 *   ANVIL_EMBEDDING_PROVIDER=openai|local (default: local)
 *   OPENAI_API_KEY=sk-... (required when provider=openai)
 *   ANVIL_EMBEDDING_MODEL=text-embedding-3-small (optional, provider-specific)
 */

export type AnvilInstance = Awaited<ReturnType<typeof import('@claymore-dev/anvil')['createAnvil']>>;

export async function loadAnvil(docsPath: string): Promise<AnvilInstance | null> {
  try {
    const { createAnvil } = await import('@claymore-dev/anvil');

    const provider = process.env.ANVIL_EMBEDDING_PROVIDER || 'local';
    const embeddingConfig: Record<string, string | undefined> = { provider };

    if (provider === 'openai') {
      embeddingConfig.apiKey = process.env.OPENAI_API_KEY;
      embeddingConfig.model = process.env.ANVIL_EMBEDDING_MODEL || 'text-embedding-3-small';
      console.log(`🔧 Initializing Anvil (OpenAI embeddings: ${embeddingConfig.model})...`);
    } else {
      if (process.env.ANVIL_EMBEDDING_MODEL) {
        embeddingConfig.model = process.env.ANVIL_EMBEDDING_MODEL;
      }
      console.log('🔧 Initializing Anvil (local embeddings)...');
    }

    const anvil = await createAnvil({ docsPath, embedding: embeddingConfig });
    console.log('✅ Anvil initialized successfully');
    return anvil;
  } catch (error: any) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND' || error?.code === 'MODULE_NOT_FOUND') {
      console.warn('⚠️ Anvil not installed — search disabled');
    } else {
      console.warn('⚠️ Anvil initialization failed — search disabled:', error?.message || error);
    }
    return null;
  }
}
