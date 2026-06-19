/**
 * Unit tests for:
 * 1. validateTelegramInitDataWithToken — valid HMAC passes, tampered data fails
 * 2. parseTelegramInitDataUser — extracts user id/name correctly
 * 3. snapParsedDatesToCalendarWeek reuse inside upload route (via direct import)
 */

import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

import {
  validateTelegramInitDataWithToken,
  parseTelegramInitDataUser,
} from "../src/features/telegram/validate-init-data";
import { snapParsedDatesToCalendarWeek } from "../src/features/nutrition/report-date-coverage";

// --- helpers ---

/** Build a valid Telegram initData string with a HMAC for the given botToken. */
function buildValidInitData(
  botToken: string,
  userId: number,
  firstName: string,
  authDate = 1700000000
): string {
  const userJson = JSON.stringify({ id: userId, first_name: firstName });
  const params = new URLSearchParams({
    auth_date: String(authDate),
    user: userJson,
  });

  const checkString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
  const hash = createHmac("sha256", secretKey).update(checkString).digest("hex");

  params.set("hash", hash);
  return params.toString();
}

// --- 1. initData validation ---

const TEST_TOKEN = "1234567890:ABCDEFGhijklmnopqrstuvwxyz_test_token";
const validInitData = buildValidInitData(TEST_TOKEN, 987654321, "Мария");

assert.ok(
  validateTelegramInitDataWithToken(validInitData, TEST_TOKEN),
  "valid HMAC must pass"
);

// Tampered: change user id in the data but keep the same hash
const tampered = validInitData.replace("987654321", "111111111");
assert.ok(
  !validateTelegramInitDataWithToken(tampered, TEST_TOKEN),
  "tampered data must fail"
);

// Wrong token
assert.ok(
  !validateTelegramInitDataWithToken(validInitData, "wrong_token"),
  "wrong bot token must fail"
);

// Missing hash
const noHash = new URLSearchParams(validInitData);
noHash.delete("hash");
assert.ok(
  !validateTelegramInitDataWithToken(noHash.toString(), TEST_TOKEN),
  "missing hash must fail"
);

// Empty string
assert.ok(
  !validateTelegramInitDataWithToken("", TEST_TOKEN),
  "empty initData must fail"
);

// --- 2. parseTelegramInitDataUser ---

const parsedUser = parseTelegramInitDataUser(validInitData);
assert.ok(parsedUser !== null, "user must be parsed from valid initData");
assert.equal(parsedUser!.id, 987654321, "user id must match");
assert.equal(parsedUser!.firstName, "Мария", "user first_name must match");

const noUserInitData = `auth_date=1700000000&hash=deadbeef`;
assert.equal(parseTelegramInitDataUser(noUserInitData), null, "no user field → null");

const badUserJson = `auth_date=1700000000&user=NOT_JSON&hash=x`;
assert.equal(parseTelegramInitDataUser(badUserJson), null, "malformed user JSON → null");

// --- 3. snapParsedDatesToCalendarWeek — same as upload route uses ---

// FatSecret PDF: Mon–Fri partial week → snaps to full Mon–Sun
assert.deepEqual(
  snapParsedDatesToCalendarWeek(["2026-06-15", "2026-06-16", "2026-06-17", "2026-06-18", "2026-06-19"]),
  { weekFrom: "2026-06-15", weekTo: "2026-06-21" },
  "5-day Mon–Fri → full Mon–Sun week"
);

// Full week unchanged
assert.deepEqual(
  snapParsedDatesToCalendarWeek([
    "2026-06-08", "2026-06-09", "2026-06-10", "2026-06-11",
    "2026-06-12", "2026-06-13", "2026-06-14",
  ]),
  { weekFrom: "2026-06-08", weekTo: "2026-06-14" },
  "full Mon–Sun PDF stays unchanged"
);

// Empty → no snapping (upload route sets needsManualWeek=true)
assert.equal(snapParsedDatesToCalendarWeek([]), null, "empty dates → null (triggers date-picker)");

// Single day → snaps to its week
assert.deepEqual(
  snapParsedDatesToCalendarWeek(["2026-06-18"]),
  { weekFrom: "2026-06-15", weekTo: "2026-06-21" },
  "single Thu → week 15–21"
);

console.log("PASS check-miniapp-init-data");
