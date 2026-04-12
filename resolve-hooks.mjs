/**
 * Custom resolve hook for Node.js ESM loader.
 *
 * Fixes "Directory import ... is not supported" errors from packages
 * like @meteora-ag/dlmm that import CJS directory paths without
 * /index.js. Node 22+ no longer supports --experimental-specifier-resolution=node,
 * so we handle it here.
 */
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (error?.code === "ERR_UNSUPPORTED_DIR_IMPORT") {
      // Retry with /index.js appended
      for (const ext of ["/index.js", "/index.cjs", "/index.mjs"]) {
        try {
          return await nextResolve(specifier + ext, context);
        } catch {
          // try next extension
        }
      }
    }
    throw error;
  }
}
