/**
 * Unit tests for resolveAppBaseUrl:
 *  - NEXT_PUBLIC_BASE_URL wins and is returned as-is (trailing slash stripped)
 *  - APP_BASE_URL used when NEXT_PUBLIC_BASE_URL absent
 *  - VERCEL_* hosts (no scheme) become absolute https
 *  - priority order among the Vercel vars
 *  - nothing configured → throws (never a relative URL)
 *  - the produced mini-app button URL is absolute
 */

import assert from "node:assert/strict";

import { resolveAppBaseUrl } from "../src/lib/app-base-url";

// 1. NEXT_PUBLIC_BASE_URL wins, trailing slash stripped.
assert.equal(
  resolveAppBaseUrl({ NEXT_PUBLIC_BASE_URL: "https://igorp.run/", APP_BASE_URL: "https://other" } as NodeJS.ProcessEnv),
  "https://igorp.run",
  "NEXT_PUBLIC_BASE_URL must win and lose trailing slash"
);

// 2. APP_BASE_URL used when NEXT_PUBLIC_BASE_URL absent.
assert.equal(
  resolveAppBaseUrl({ APP_BASE_URL: "https://app.example" } as NodeJS.ProcessEnv),
  "https://app.example",
  "APP_BASE_URL fallback"
);

// 3. Only VERCEL_BRANCH_URL set (no scheme) → absolute https.
assert.equal(
  resolveAppBaseUrl({ VERCEL_BRANCH_URL: "app-git-task10d.vercel.app" } as NodeJS.ProcessEnv),
  "https://app-git-task10d.vercel.app",
  "VERCEL_BRANCH_URL must become absolute https"
);

// 4. Priority: PRODUCTION_URL > BRANCH_URL > URL.
assert.equal(
  resolveAppBaseUrl({
    VERCEL_PROJECT_PRODUCTION_URL: "prod.vercel.app",
    VERCEL_BRANCH_URL: "branch.vercel.app",
    VERCEL_URL: "deploy.vercel.app",
  } as NodeJS.ProcessEnv),
  "https://prod.vercel.app",
  "production url has priority"
);
assert.equal(
  resolveAppBaseUrl({
    VERCEL_BRANCH_URL: "branch.vercel.app",
    VERCEL_URL: "deploy.vercel.app",
  } as NodeJS.ProcessEnv),
  "https://branch.vercel.app",
  "branch url beats deploy url"
);

// 5. Explicit env beats Vercel vars.
assert.equal(
  resolveAppBaseUrl({
    NEXT_PUBLIC_BASE_URL: "https://igorp.run",
    VERCEL_BRANCH_URL: "branch.vercel.app",
  } as NodeJS.ProcessEnv),
  "https://igorp.run",
  "explicit env beats Vercel-provided host"
);

// 6. Nothing configured → throws (never relative).
assert.throws(
  () => resolveAppBaseUrl({} as NodeJS.ProcessEnv),
  /not configured/,
  "missing config must throw, not return a relative URL"
);

// 7. The mini-app button URL is absolute https.
const base = resolveAppBaseUrl({ VERCEL_BRANCH_URL: "app-git-task10d.vercel.app" } as NodeJS.ProcessEnv);
const query = new URLSearchParams({ sid: "S1", sig: "abc123" });
const buttonUrl = `${base}/m/n?${query.toString()}`;
assert.ok(/^https:\/\/.+\/m\/n\?sid=S1&sig=abc123$/.test(buttonUrl), "button URL must be absolute https");

console.log("PASS check-app-base-url");
