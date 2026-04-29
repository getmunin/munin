/**
 * Nest DI token for the global AssetStorage instance. Lives in its own
 * file so the StaticAssetsController can import it without forming a
 * circular dependency with storage.module.ts.
 */
export const STORAGE = Symbol('AssetStorage');
