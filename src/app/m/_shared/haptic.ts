// Telegram WebView haptic — one line's worth of "feels instant" even when the server round
// trip takes half a second. Lives here (the primitive), not per-screen, per the наряд.

type TelegramHaptic = {
  impactOccurred?: (style: "light" | "medium" | "heavy" | "rigid" | "soft") => void;
  notificationOccurred?: (type: "error" | "success" | "warning") => void;
};

function getHaptic(): TelegramHaptic | undefined {
  return (globalThis as unknown as { Telegram?: { WebApp?: { HapticFeedback?: TelegramHaptic } } }).Telegram?.WebApp
    ?.HapticFeedback;
}

export function triggerHaptic(kind: "impact" | "success" | "error"): void {
  const hf = getHaptic();
  if (!hf) return; // no-op outside Telegram (dev browser, older clients)
  try {
    if (kind === "impact") hf.impactOccurred?.("light");
    else hf.notificationOccurred?.(kind);
  } catch {
    /* unsupported on some older Telegram clients */
  }
}
