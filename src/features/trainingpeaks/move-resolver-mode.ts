/**
 * Which mechanism executes a TrainingPeaks move: the HTTP resolver (no browser) or the old DOM path.
 *
 * This setting used to fail SILENTLY in the two ways that matter:
 *   - unset            → defaulted to "shadow" (the slow browser path) with no log line at all;
 *   - typo'd           → e.g. "live-primary" also degraded to "shadow", again without a word.
 * Either way production quietly reverts to the browser path and keeps running green. That is the
 * kind of regression you notice weeks later, by feel.
 *
 * So the fallback stays (never crash a move over a config string), but it is now LOUD: the caller
 * gets a `status` it can log and alert on. The value itself belongs in the launchd plist — it is a
 * property of the service, not a stray flag in a dotfile.
 */

export type MoveResolverMode = "shadow" | "live_primary" | "off";

export type MoveResolverModeStatus = "explicit" | "unset" | "unrecognized";

export type MoveResolverModeResolution = {
  /** Effective mode. On anything unrecognized this is "shadow" — safe, slow, and now announced. */
  mode: MoveResolverMode;
  /** What the env var actually held, trimmed. null when unset. */
  raw: string | null;
  status: MoveResolverModeStatus;
};

export const MOVE_RESOLVER_MODE_ENV = "TP_MOVE_RESOLVER_MODE";
export const MOVE_RESOLVER_MODES: readonly MoveResolverMode[] = ["shadow", "live_primary", "off"];

/** The mode production is expected to run in. Used only to phrase the warning, never to override. */
const EXPECTED_PRODUCTION_MODE: MoveResolverMode = "live_primary";

export function classifyMoveResolverMode(
  rawValue: string | null | undefined
): MoveResolverModeResolution {
  const raw = rawValue?.trim() ?? "";
  if (!raw) {
    return { mode: "shadow", raw: null, status: "unset" };
  }

  const normalized = raw.toLowerCase();
  if ((MOVE_RESOLVER_MODES as readonly string[]).includes(normalized)) {
    return { mode: normalized as MoveResolverMode, raw, status: "explicit" };
  }

  return { mode: "shadow", raw, status: "unrecognized" };
}

/**
 * Operator-facing warning. Returns null when the mode was set explicitly — i.e. silence means
 * "configured on purpose", and any noise here means "your config is not doing what you think".
 */
export function formatMoveResolverModeWarning(
  resolution: MoveResolverModeResolution
): string | null {
  if (resolution.status === "explicit") {
    return null;
  }

  const consequence =
    "Переносы пойдут МЕДЛЕННЫМ браузерным путём (DOM), а не по HTTP.";
  const allowed = `Допустимые значения: ${MOVE_RESOLVER_MODES.join(", ")}.`;
  const where = `Задаётся в launchd-плисте (EnvironmentVariables → ${MOVE_RESOLVER_MODE_ENV}).`;

  if (resolution.status === "unrecognized") {
    return [
      `⚠️ TrainingPeaks: неизвестный режим ${MOVE_RESOLVER_MODE_ENV}="${resolution.raw}" — откатываюсь на shadow.`,
      consequence,
      allowed,
      where,
    ].join("\n");
  }

  return [
    `⚠️ TrainingPeaks: ${MOVE_RESOLVER_MODE_ENV} не задан — откатываюсь на shadow.`,
    consequence,
    `Ожидалось ${EXPECTED_PRODUCTION_MODE}. ${where}`,
  ].join("\n");
}
