export const TRAININGPEAKS_NO_CONTACT_ALERT_DAYS = 3;

export type TrainingPeaksContactDisplay = {
  lastContactAt: string | null;
  daysWithoutContact: number | null;
  hasNoContactAlert: boolean;
};

export function buildTrainingPeaksContactDisplay(
  input: { lastCoachTouchAt: string | null | undefined },
  nowMs: number = Date.now()
): TrainingPeaksContactDisplay {
  const lastContactAt = input.lastCoachTouchAt ?? null;
  if (!lastContactAt) {
    return {
      lastContactAt: null,
      daysWithoutContact: null,
      hasNoContactAlert: false,
    };
  }

  const lastContactMs = Date.parse(lastContactAt);
  if (!Number.isFinite(lastContactMs)) {
    return {
      lastContactAt: null,
      daysWithoutContact: null,
      hasNoContactAlert: false,
    };
  }

  const daysWithoutContact = Math.max(0, Math.floor((nowMs - lastContactMs) / (24 * 60 * 60 * 1000)));
  return {
    lastContactAt,
    daysWithoutContact,
    hasNoContactAlert: daysWithoutContact >= TRAININGPEAKS_NO_CONTACT_ALERT_DAYS,
  };
}
