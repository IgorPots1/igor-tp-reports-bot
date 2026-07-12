import { chromium } from "playwright";

import { profileDir } from "./lib/paths.ts";
import { captureSessionAuth } from "./lib/trainingpeaks-api-move.ts";

/**
 * Read-only sanity check for PR1 task 3: confirm that the API executor can obtain a
 * TrainingPeaks bearer token from the existing persistent Playwright profile
 * (tools/trainingpeaks-export/.playwright-profile/trainingpeaks) instead of a raw
 * TP_AUTH_COOKIE env var. Never prints the token/cookie value — only booleans/lengths.
 *
 * GET-only. No mutation. Safe to run against any athleteId (defaults to the safe
 * test athlete) since it performs no writes.
 *
 * PR1 RESULT (2026-07-12): PASS, empirically confirmed against the real logged-in
 * profile. `context.cookies()` returned the actual cleartext `Production_tpAuth`
 * value (1797 chars, expires ~2026-08-11 -- ~30-day TTL, same as a manually
 * copied cookie). The sniffed live Authorization bearer authorized a real GET
 * /users/v3/user call (HTTP 200). CAVEAT (also confirmed empirically): the
 * profile is local to the checkout path -- a fresh worktree at a different path
 * has its own empty, unauthenticated profile (0 cookies of interest). See
 * docs/tp-api-capability-matrix.md §D for the full verdict and design
 * recommendation (snapshot-export, not live concurrent profile access).
 */

const DEFAULT_ATHLETE_ID = 3102415;
const API_HOST = "https://tpapi.trainingpeaks.com";

async function main(): Promise<void> {
  const athleteId = Number(process.argv[2] ?? DEFAULT_ATHLETE_ID);
  console.log(`profileDir: ${profileDir}`);
  console.log(`athleteId: ${athleteId}`);

  const context = await chromium.launchPersistentContext(profileDir, {
    headless: true,
    viewport: null,
  });

  try {
    const page = context.pages()[0] ?? (await context.newPage());

    const capturedAuth = await captureSessionAuth({ context, page, athleteId });
    console.log(`authorization_header_captured: ${Boolean(capturedAuth.authorizationHeader)}`);
    console.log(`authorization_header_length: ${capturedAuth.authorizationHeader?.length ?? 0}`);

    const cookies = await context.cookies([
      "https://app.trainingpeaks.com",
      "https://tpapi.trainingpeaks.com",
    ]);
    const tpAuthCookie = cookies.find((c) => c.name === "Production_tpAuth");
    console.log(`production_tpauth_cookie_present: ${Boolean(tpAuthCookie)}`);
    console.log(`production_tpauth_cookie_length: ${tpAuthCookie?.value.length ?? 0}`);
    console.log(`production_tpauth_cookie_expires: ${tpAuthCookie?.expires ?? "n/a"}`);
    console.log(`total_cookies_in_scope: ${cookies.length}`);

    if (!capturedAuth.authorizationHeader) {
      console.log("verdict: FAIL — no Authorization header observed from profile session.");
      return;
    }

    // Read-only confirmation call using the profile-derived bearer.
    const response = await page.request.fetch(`${API_HOST}/users/v3/user`, {
      method: "GET",
      headers: {
        accept: "application/json, text/javascript, */*; q=0.01",
        authorization: capturedAuth.authorizationHeader,
      },
      failOnStatusCode: false,
    });
    console.log(`GET /users/v3/user status: ${response.status()}`);
    console.log(`verdict: ${response.ok() ? "PASS — profile-derived auth works, no raw cookie needed" : "FAIL — profile auth did not authorize a read call"}`);
  } finally {
    await context.close().catch(() => {});
  }
}

main().catch((error: unknown) => {
  console.error("tp-probe-auth-from-profile failed.");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
