/**
 * Postinstall patch: fix ESM directory imports in @meteora-ag/dlmm.
 *
 * The dlmm package imports @coral-xyz/anchor internal paths as directories
 * (e.g. ".../utils/bytes" instead of ".../utils/bytes/index.js"), which is
 * valid in CJS but illegal in ESM. This script patches the built .mjs files
 * to append /index.js where needed.
 *
 * Runs automatically after `npm install` via the postinstall script.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";

const DLMM_DIST = "node_modules/@meteora-ag/dlmm/dist";

// Pattern: import from "@coral-xyz/anchor/dist/cjs/..." directory paths
// These are missing /index.js at the end
const DIR_IMPORT_PATTERN =
  /(from\s+["'])(@coral-xyz\/anchor\/dist\/cjs\/[^"']+?\/(?:bytes|utf8|hex|bs58))(?=["'])/g;

let totalPatches = 0;

function patchFile(filePath) {
  if (!existsSync(filePath)) return;
  const original = readFileSync(filePath, "utf8");
  const patched = original.replace(DIR_IMPORT_PATTERN, (match, prefix, importPath) => {
    totalPatches++;
    return `${prefix}${importPath}/index.js`;
  });
  if (patched !== original) {
    writeFileSync(filePath, patched, "utf8");
    console.log(`[fix-esm-imports] Patched: ${filePath}`);
  }
}

if (existsSync(DLMM_DIST)) {
  // Patch all .mjs files in the dist folder
  const files = readdirSync(DLMM_DIST).filter((f) => f.endsWith(".mjs") || f.endsWith(".js"));
  for (const file of files) {
    patchFile(join(DLMM_DIST, file));
  }
  console.log(`[fix-esm-imports] Done — ${totalPatches} import(s) patched`);
} else {
  console.log("[fix-esm-imports] @meteora-ag/dlmm not found, skipping");
}
