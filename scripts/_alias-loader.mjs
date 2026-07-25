import { pathToFileURL, fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { resolve as pr } from 'node:path';
const SRC = pathToFileURL(pr(process.cwd(), 'src') + '/').href;
const EXTS = ['.ts', '.tsx', '/index.ts', '/index.tsx', '.js', '.mjs'];
function tryExts(baseUrl) {
  for (const ext of EXTS) {
    const cand = baseUrl + ext;
    try { if (existsSync(fileURLToPath(cand))) return cand; } catch {}
  }
  return null;
}
export async function resolve(spec, ctx, next) {
  let baseUrl = null;
  if (spec.startsWith('@/')) baseUrl = SRC + spec.slice(2);
  else if ((spec.startsWith('./') || spec.startsWith('../')) && ctx.parentURL) {
    baseUrl = new URL(spec, ctx.parentURL).href;
  }
  if (baseUrl) {
    // already has an extension that exists?
    try { if (existsSync(fileURLToPath(baseUrl))) return next(spec, ctx); } catch {}
    const hit = tryExts(baseUrl);
    if (hit) return { url: hit, shortCircuit: true };
  }
  return next(spec, ctx);
}
