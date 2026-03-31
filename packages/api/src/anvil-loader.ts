/**
 * Dynamic Anvil loader — handles missing @claymore-dev/anvil gracefully.
 * Returns null if Anvil is not installed (e.g., Docker builds without it).
 */

export type AnvilInstance = Awaited<ReturnType<typeof import('@claymore-dev/anvil')['createAnvil']>>;

export async function loadAnvil(docsPath: string): Promise<AnvilInstance | null> {
  try {
    const { createAnvil } = await import('@claymore-dev/anvil');
    console.log('🔧 Initializing Anvil...');
    const anvil = await createAnvil({ docsPath });
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
