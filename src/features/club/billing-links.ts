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

function applyLabel(base: string | null | undefined, label?: string | null): string | null {
  if (!base || !base.trim()) {
    return null;
  }
  if (base.includes("{label}")) {
    return base.replace("{label}", encodeURIComponent((label ?? "").trim()));
  }
  return base;
}

export function buildClubTbankPayUrl(label?: string | null): string | null {
  return applyLabel(process.env.CLUB_TBANK_PAYMENT_URL, label);
}

/**
 * F1 (scenario S2) — the pay link is DERIVED from the billing method on the fly, never stored:
 *   tbank_link_a / _b / _c → the corresponding SHARED T-Bank link, from env
 *     (CLUB_TBANK_PAYMENT_URL_A/_B/_C; _A falls back to the legacy CLUB_TBANK_PAYMENT_URL).
 *   manual_eur / manual_other → the student's BESPOKE payment_url (the only case that still needs the
 *     stored column): a EUR/other arrangement can never be one of the three shared T-Bank links, so its
 *     hand-entered link is authoritative.
 * A tbank_* client always resolves to its shared link regardless of any stale stored value; a manual
 * client always uses the stored link. Returns null → the mini app hides the «Оплатить» button.
 */
export function clubPayUrlForMethod(method: string | null | undefined, manualUrl: string | null, label?: string | null): string | null {
  switch (method) {
    case "tbank_link_a":
      return applyLabel(process.env.CLUB_TBANK_PAYMENT_URL_A ?? process.env.CLUB_TBANK_PAYMENT_URL, label);
    case "tbank_link_b":
      return applyLabel(process.env.CLUB_TBANK_PAYMENT_URL_B, label);
    case "tbank_link_c":
      return applyLabel(process.env.CLUB_TBANK_PAYMENT_URL_C, label);
    case "manual_eur":
    case "manual_other":
    default:
      return (manualUrl ?? "").trim() || null;
  }
}
