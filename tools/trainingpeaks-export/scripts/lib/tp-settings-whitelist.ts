/**
 * Explicit WHITELIST for persisting TrainingPeaks athlete settings.
 *
 * GET /fitness/v1/athletes/{id}/settings returns real PII and secrets next to the
 * zones — email, firstName/lastName, and iCalendarKeys (a WORKING calendar access
 * key). So NOTHING outside this whitelist is ever written to disk or the database.
 *
 * Whitelist, NOT blacklist: a key is persisted only if it POSITIVELY matches one of
 * these patterns. Patterns are chosen to catch zone/threshold data while excluding
 * lookalikes — `/zones$/i` matches "heartRateZones" but NOT "timeZone" (singular,
 * suffix "one" not "ones"), and nothing here matches email / *Name / iCalendarKeys
 * / any *Key. Anything not matched is dropped, so a new/unknown sensitive field can
 * never leak by default — the failure mode is "we stored less", never "we leaked".
 */
export const TP_SETTINGS_WHITELIST: RegExp[] = [
  /zones$/i, //            heartRateZones, powerZones, speedZones, paceZones, …
  /^ftp$/i,
  /^lthr$/i,
  /threshold/i, //         thresholdPace, thresholdHeartRate, thresholdPower, …
  /^maxhr$/i,
  /^resthr$/i,
  /^maxHeartRate$/i,
  /^restingHeartRate$/i,
  /^athleteId$/i, //       structural id, already public in our system (not PII/secret)
];

/** A copy of `settings` containing ONLY whitelisted keys; every other key is dropped. */
export function pickWhitelistedSettings(settings: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(settings)) {
    if (TP_SETTINGS_WHITELIST.some((re) => re.test(key))) out[key] = value;
  }
  return out;
}

/** Sorted whitelisted key names — for structure/outlier reporting (names only, never values). */
export function whitelistedKeySignature(settings: Record<string, unknown>): string {
  return Object.keys(pickWhitelistedSettings(settings)).sort().join(",");
}
