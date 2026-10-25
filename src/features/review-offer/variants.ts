// Paid Strava breakdown, price test for @runnigor (US audience), started 25.10.2026.
// Same product on both pages, only the price differs. Codeword REVIEW -> /review/a,
// CHECK -> /review/b. The WhatsApp message carries the variant so Igor sees which page
// (and which price) a buyer came from. Payment itself happens after the chat (payment link).

export type ReviewVariant = "a" | "b";

export const REVIEW_PRICES: Record<ReviewVariant, number> = { a: 5, b: 10 };

export const COACH_WHATSAPP = "79157317090";

export function reviewWhatsappHref(variant: ReviewVariant): string {
  const price = REVIEW_PRICES[variant];
  const text = `Hi Igor! I'd like the Strava breakdown for $${price} (${variant.toUpperCase()})`;
  return `https://wa.me/${COACH_WHATSAPP}?text=${encodeURIComponent(text)}`;
}
