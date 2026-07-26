/**
 * Regression guard for the SHARED Telegram initData validator.
 *
 * WHY THIS EXISTS: a club-scoped fix (params.delete("signature")) was applied to the
 * shared validateTelegramInitDataWithToken and silently broke /m/desk AND /m/n auth —
 * it surfaced only when a human opened the desk. This smoke validates initData for all
 * THREE surfaces against fixed, canonically-signed examples, so any future change to
 * the shared validator that regresses desk/n (or the club) fails a check BEFORE deploy.
 *
 * Real Telegram clients used here include `signature` INSIDE the HMAC data-check-string
 * (proven empirically: removing it broke desk/n). desk & /m/n MUST accept that form.
 *
 * Run: npm run check-initdata-auth   (no network, no DB, no secrets — fake tokens).
 */
import { createHmac } from "node:crypto";

// Fake, non-secret tokens. Set BEFORE importing the validators is unnecessary (they read
// process.env at call time), but we set them up-front for clarity.
const MAIN_TOKEN = "111111111:AA_desk_and_n_bot_fake";
const CLUB_TOKEN = "222222222:AA_club_bot_fake";
process.env.TELEGRAM_BOT_TOKEN = MAIN_TOKEN;
process.env.CLUB_TELEGRAM_BOT_TOKEN = CLUB_TOKEN;

const { validateTelegramInitData, validateClubInitDataVerbose } = await import(
  "@/features/telegram/validate-init-data"
);

/** Sign initData exactly like Telegram: sorted key=value, "\n" separator. */
function sign(token: string, fields: Record<string, string>, signatureInHash: boolean): string {
  const keys = Object.keys(fields).filter((k) => signatureInHash || k !== "signature");
  const cs = keys.sort().map((k) => `${k}=${fields[k]}`).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(token).digest();
  const hash = createHmac("sha256", secret).update(cs).digest("hex");
  return new URLSearchParams({ ...fields, hash }).toString();
}

const base = {
  auth_date: "1700000000",
  query_id: "AAExampleQueryId",
  user: JSON.stringify({ id: 42, first_name: "Test" }),
};

let pass = 0;
let fail = 0;
function check(name: string, got: boolean, want: boolean) {
  if (got === want) {
    pass++;
    console.log(`PASS  ${name}`);
  } else {
    fail++;
    console.log(`FAIL  ${name}  got=${got} want=${want}`);
  }
}

// --- /m/desk + /m/n (shared validator, MAIN token) --------------------------
// The real-client form: signature is part of the hash. MUST validate.
const deskReal = sign(MAIN_TOKEN, { ...base, signature: "ed25519_x" }, true);
check("desk/n: real client (signature-in-hash) accepted", validateTelegramInitData(deskReal), true);
// Old client with no signature field at all. MUST validate.
const deskOld = sign(MAIN_TOKEN, { ...base }, false);
check("desk/n: old client (no signature) accepted", validateTelegramInitData(deskOld), true);
// Wrong token / tampered → rejected.
check("desk/n: wrong-token initData rejected", validateTelegramInitData(sign(CLUB_TOKEN, base, false)), false);

// --- /m/club (CLUB token, both variants via fallback) -----------------------
const clubSigIn = sign(CLUB_TOKEN, { ...base, signature: "ed25519_y" }, true);
const r1 = validateClubInitDataVerbose(clubSigIn);
check("club: signature-in-hash accepted", r1.ok, true);
check("club: signature-in-hash variant=with_signature", r1.variant === "with_signature", true);

const clubSigOut = sign(CLUB_TOKEN, { ...base, signature: "ed25519_y" }, false);
const r2 = validateClubInitDataVerbose(clubSigOut);
check("club: signature-excluded accepted (fallback)", r2.ok, true);
check("club: signature-excluded variant=without_signature", r2.variant === "without_signature", true);

check("club: wrong-token initData rejected", validateClubInitDataVerbose(sign(MAIN_TOKEN, base, false)).ok, false);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
