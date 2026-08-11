// Shared, dependency-free time/pace formatters for the club module.
//
// WHY A STANDALONE MODULE: pace was rendered "4:60 /км" in the mini-app because the
// pace formatter floored the minutes first and *then* rounded the seconds part
// (Math.round(sec % 60) → 59.6 rounds to 60, carrying into a bogus ":60"). Every
// duration formatter in the codebase was already immune because it rounds the TOTAL
// seconds first and only then decomposes — but pace, being seconds-per-km, is the one
// value that is inherently fractional, so it was the one that hit the bug. The fix has
// to live in ONE place shared by client and server, so the next change can't drift
// between copies again. This file imports nothing (no DB, no server-only) so it is safe
// to import from a "use client" component and from server code alike.

/** Round-total-first: decompose only after rounding, so fractions never carry into ":60". */
function hms(totalSeconds: number): { h: number; m: number; s: number } {
  const t = Math.round(totalSeconds);
  return { h: Math.floor(t / 3600), m: Math.floor((t % 3600) / 60), s: t % 60 };
}

const pad = (n: number): string => String(n).padStart(2, "0");

/** seconds -> "H:MM:SS" (or "M:SS" under an hour); null for empty/non-finite/non-positive. */
export function formatDuration(sec: number | null): string | null {
  if (sec == null || !Number.isFinite(sec) || sec <= 0) {
    return null;
  }
  const { h, m, s } = hms(sec);
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** seconds-per-km -> "M:SS /км"; null for empty/non-finite/non-positive. */
export function formatPace(secPerKm: number | null): string | null {
  if (secPerKm == null || !Number.isFinite(secPerKm) || secPerKm <= 0) {
    return null;
  }
  const { h, m, s } = hms(secPerKm);
  // Pace is minutes:seconds even past 60 min/km (walking) — fold any hours into minutes.
  return `${h * 60 + m}:${pad(s)} /км`;
}
