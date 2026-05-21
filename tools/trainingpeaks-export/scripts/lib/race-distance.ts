export const ALL_DISTANCE_KEYS = ["5k", "10k", "half", "marathon"] as const;
export type DistanceKey = (typeof ALL_DISTANCE_KEYS)[number];

export type DistancePreset = {
  label: string;
  target_km: number;
  min_km: number;
  max_km: number;
};

export const DISTANCE_PRESETS: Record<DistanceKey, DistancePreset> = {
  "5k": { label: "5 км", target_km: 5, min_km: 4.6, max_km: 5.6 },
  "10k": { label: "10 км", target_km: 10, min_km: 9.6, max_km: 10.6 },
  half: { label: "21.1 км", target_km: 21.0975, min_km: 20.5, max_km: 22.5 },
  marathon: { label: "42.2 км", target_km: 42.195, min_km: 41.0, max_km: 43.0 },
};

export function isDistanceKey(value: string): value is DistanceKey {
  return (ALL_DISTANCE_KEYS as readonly string[]).includes(value);
}

export function formatPaceText(paceMinPerKm: number): string {
  const totalSec = Math.round(paceMinPerKm * 60);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${String(sec).padStart(2, "0")}/км`;
}

export function formatDurationText(durationMin: number): string {
  const totalSec = Math.round(durationMin * 60);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function formatDurationFromSeconds(totalSec: number): string {
  const rounded = Math.max(0, Math.round(totalSec));
  const h = Math.floor(rounded / 3600);
  const m = Math.floor((rounded % 3600) / 60);
  const s = rounded % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function parseDurationToSeconds(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const hms = trimmed.match(/^(?:(\d+):)?(\d+):(\d+)$/);
  if (hms) {
    const hours = hms[1] ? Number(hms[1]) : 0;
    const minutes = Number(hms[2]);
    const seconds = Number(hms[3]);
    if ([hours, minutes, seconds].every((part) => Number.isFinite(part))) {
      return hours * 3600 + minutes * 60 + seconds;
    }
  }

  const ms = trimmed.match(/^(\d+):(\d+)$/);
  if (ms) {
    const minutes = Number(ms[1]);
    const seconds = Number(ms[2]);
    if (Number.isFinite(minutes) && Number.isFinite(seconds)) {
      return minutes * 60 + seconds;
    }
  }

  return null;
}

export function paceMinPerKmToSeconds(paceMinPerKm: number, distanceKm: number): number {
  return Math.round(paceMinPerKm * 60 * distanceKm);
}
