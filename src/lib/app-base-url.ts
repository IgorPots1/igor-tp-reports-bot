/**
 * Resolves the absolute base URL of this deployment, used to build links that
 * must work outside the app (e.g. Telegram web_app buttons, which require an
 * absolute https URL — a relative path silently fails to open).
 *
 * Priority:
 *   1. NEXT_PUBLIC_BASE_URL  — explicit, what the code historically read
 *   2. APP_BASE_URL          — the name actually present in .env
 *   3. VERCEL_PROJECT_PRODUCTION_URL — stable prod host on Vercel
 *   4. VERCEL_BRANCH_URL     — stable per-branch preview host on Vercel
 *   5. VERCEL_URL            — per-deployment host on Vercel
 *
 * Vercel-provided vars come without a scheme, so https:// is prepended.
 * If nothing is configured, this throws instead of returning a relative URL.
 */

function toAbsoluteHttps(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  return `https://${trimmed}`;
}

export function resolveAppBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.NEXT_PUBLIC_BASE_URL?.trim() || env.APP_BASE_URL?.trim();
  const vercelHost =
    env.VERCEL_PROJECT_PRODUCTION_URL?.trim() ||
    env.VERCEL_BRANCH_URL?.trim() ||
    env.VERCEL_URL?.trim();

  const source = explicit || vercelHost;
  if (!source) {
    throw new Error(
      "App base URL is not configured: set NEXT_PUBLIC_BASE_URL or APP_BASE_URL " +
        "(or deploy on Vercel, which provides VERCEL_PROJECT_PRODUCTION_URL / VERCEL_BRANCH_URL / VERCEL_URL)."
    );
  }

  const url = toAbsoluteHttps(source);
  if (!/^https?:\/\/.+/.test(url)) {
    throw new Error(`Resolved app base URL is not absolute: "${url}".`);
  }
  return url;
}
