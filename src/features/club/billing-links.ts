// T-Bank payment link for the club cabinet. The link itself lives in
// CLUB_TBANK_PAYMENT_URL (env / config), NEVER in code. The mini app opens it via
// Telegram.WebApp.openLink so the form loads in Telegram's in-app browser instead
// of throwing the student out to an external browser.
//
// If the configured URL contains the placeholder "{label}", the student's label
// (id or name) is substituted so the payment purpose can be reconciled against the
// bank statement. Otherwise the URL is returned as-is (a plain static link).
//
// NO payment fields, cards, or requisites are ever rendered inside the mini app —
// this only produces an outbound link to T-Bank's own hosted form.

export function buildClubTbankPayUrl(label?: string | null): string | null {
  const base = process.env.CLUB_TBANK_PAYMENT_URL;
  if (!base || !base.trim()) {
    return null;
  }
  if (base.includes("{label}")) {
    return base.replace("{label}", encodeURIComponent((label ?? "").trim()));
  }
  return base;
}
