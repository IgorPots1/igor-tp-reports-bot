export type GenericParsedEvent = {
  event_id: string | null;
  event_date: string;
  event_name: string | null;
  event_distance_km: number | null;
  sport_type: string | null;
};

export type DistanceWindowLike = {
  target_km: number;
};

export type SameDayEventMatch = {
  same_day_event: boolean;
  event_name: string | null;
  event_date: string | null;
  event_distance_km: number | null;
  event_id: string | null;
  event_source: "events_api" | null;
  event_match_reason: string[];
  event_confidence: number;
};

export function hasSameDayNamedEvent<Event extends GenericParsedEvent>(
  date: string,
  eventsByDate: Map<string, Event[]>,
): boolean {
  const sameDayEvents = eventsByDate.get(date) ?? [];
  return sameDayEvents.some((event) => Boolean(event.event_name?.trim()));
}

export function scoreEventForCandidate<Event extends GenericParsedEvent>(input: {
  event: Event;
  target_km: number;
  matchesDistanceKeyword: (blob: string) => boolean;
  matchesRaceKeyword: (blob: string) => boolean;
}): {
  score: number;
  reasons: string[];
} {
  const { event } = input;
  const reasons: string[] = [];
  let score = 0;

  if (event.event_distance_km !== null) {
    const deltaKm = Math.abs(event.event_distance_km - input.target_km);
    const proximityScore = Math.max(0, 40 - deltaKm * 8);
    score += proximityScore;
    reasons.push(`event_distance_delta_km=${deltaKm.toFixed(2)}`);
  }

  const blob = `${event.event_name ?? ""} ${event.sport_type ?? ""}`.toLowerCase();
  if (input.matchesDistanceKeyword(blob)) {
    score += 25;
    reasons.push("title_distance_keyword");
  }
  if (input.matchesRaceKeyword(blob)) {
    score += 15;
    reasons.push("race_or_start_keywords");
  }
  if (/road\s*run|roadrunning|running/i.test(event.sport_type ?? "")) {
    score += 8;
    reasons.push("running_sport_type");
  }

  return { score, reasons };
}

export function matchSameDayEvent<Event extends GenericParsedEvent>(input: {
  workoutDate: string;
  eventsByDate: Map<string, Event[]>;
  scoreEvent: (event: Event) => { score: number; reasons: string[] };
}): SameDayEventMatch {
  const sameDayEvents = input.eventsByDate.get(input.workoutDate) ?? [];
  if (!sameDayEvents.length) {
    return {
      same_day_event: false,
      event_name: null,
      event_date: null,
      event_distance_km: null,
      event_id: null,
      event_source: null,
      event_match_reason: [],
      event_confidence: 0,
    };
  }

  let best: { event: Event; score: number; reasons: string[] } | null = null;
  for (const event of sameDayEvents) {
    const scored = input.scoreEvent(event);
    if (!best || scored.score > best.score) {
      best = { event, score: scored.score, reasons: scored.reasons };
    }
  }

  if (!best || best.score <= 0) {
    return {
      same_day_event: true,
      event_name: sameDayEvents[0]?.event_name ?? null,
      event_date: input.workoutDate,
      event_distance_km: sameDayEvents[0]?.event_distance_km ?? null,
      event_id: sameDayEvents[0]?.event_id ?? null,
      event_source: "events_api",
      event_match_reason: ["same_day_event_weak_match"],
      event_confidence: 0.35,
    };
  }

  const confidence = Math.min(0.99, Number((0.45 + best.score / 100).toFixed(2)));
  return {
    same_day_event: true,
    event_name: best.event.event_name,
    event_date: best.event.event_date,
    event_distance_km: best.event.event_distance_km,
    event_id: best.event.event_id,
    event_source: "events_api",
    event_match_reason: ["same_day_event", ...best.reasons],
    event_confidence: confidence,
  };
}
