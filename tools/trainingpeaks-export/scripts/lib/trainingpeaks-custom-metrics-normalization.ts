export type TrainingPeaksCustomMetricsRawResponse = TrainingPeaksCustomMetricsRawDay[];

export type TrainingPeaksCustomMetricsRawDay = {
  id?: unknown;
  athleteId?: unknown;
  timeStamp?: unknown;
  details?: unknown;
  [key: string]: unknown;
};

export type TrainingPeaksCustomMetricsRawDetail = {
  parentId?: unknown;
  type?: unknown;
  value?: unknown;
  isPotentiallyNegative?: unknown;
  uploadClient?: unknown;
  label?: unknown;
  time?: unknown;
  modifiedTime?: unknown;
  [key: string]: unknown;
};

export type NormalizedTrainingPeaksCustomMetric = {
  trainingPeaksAthleteId: number;
  metricTimestamp: string;
  metricDate: string;
  metricTypeId: number;
  metricKey: string;
  metricLabel: string | null;
  rawValueText: string | null;
  valueNumeric: number | null;
  valueMinNumeric: number | null;
  valueMaxNumeric: number | null;
  valueAvgNumeric: number | null;
  unit: string | null;
  uploadClient: string | null;
  sourceSnapshot: unknown;
  normalizationWarnings: string[];
};

const METRIC_KEY_BY_TYPE_ID: Record<number, string> = {
  60: "hrv",
  6: "sleep_hours",
  46: "deep_sleep_hours",
  48: "light_sleep_hours",
  47: "rem_sleep_hours",
  50: "awake_hours",
  64: "body_battery",
  62: "stress_level",
  5: "pulse",
  9: "weight_kg",
};

const UNIT_BY_TYPE_ID: Record<number, string | null> = {
  60: "ms",
  6: "hours",
  46: "hours",
  48: "hours",
  47: "hours",
  50: "hours",
  64: "score",
  62: "score",
  5: "bpm",
  9: "kg",
};

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (!/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(trimmed)) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toPositiveInteger(value: unknown): number | null {
  const numeric = toFiniteNumber(value);
  if (numeric === null) return null;
  if (!Number.isInteger(numeric) || numeric <= 0) return null;
  return numeric;
}

function toSafeString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseIsoTimestamp(value: unknown): { metricTimestamp: string; metricDate: string } | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = new Date(trimmed);
  if (!Number.isFinite(parsed.getTime())) return null;
  const metricTimestamp = parsed.toISOString();
  const metricDate = metricTimestamp.slice(0, 10);
  return { metricTimestamp, metricDate };
}

function inferMetricKey(metricTypeId: number): string {
  return METRIC_KEY_BY_TYPE_ID[metricTypeId] ?? `custom_metric_${metricTypeId}`;
}

function inferMetricUnit(metricTypeId: number): string | null {
  return UNIT_BY_TYPE_ID[metricTypeId] ?? null;
}

function valueToRawText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function extractNumberByKeys(record: Record<string, unknown>, keys: string[]): number | null {
  const entries = Object.entries(record);
  for (const [key, value] of entries) {
    const lowered = key.toLowerCase();
    if (keys.some((token) => lowered === token || lowered.includes(token))) {
      const parsed = toFiniteNumber(value);
      if (parsed !== null) return parsed;
    }
  }
  return null;
}

function parseValueShape(value: unknown, warnings: string[]): {
  rawValueText: string | null;
  valueNumeric: number | null;
  valueMinNumeric: number | null;
  valueMaxNumeric: number | null;
  valueAvgNumeric: number | null;
  hadAggregateArray: boolean;
} {
  const rawValueText = valueToRawText(value);
  let valueNumeric: number | null = null;
  let valueMinNumeric: number | null = null;
  let valueMaxNumeric: number | null = null;
  let valueAvgNumeric: number | null = null;
  let hadAggregateArray = false;

  const directNumeric = toFiniteNumber(value);
  if (directNumeric !== null) {
    valueNumeric = directNumeric;
    return { rawValueText, valueNumeric, valueMinNumeric, valueMaxNumeric, valueAvgNumeric, hadAggregateArray };
  }

  if (Array.isArray(value)) {
    hadAggregateArray = true;
    const numericItems = value.map((item) => toFiniteNumber(item)).filter((n): n is number => n !== null);
    if (numericItems.length === value.length && numericItems.length > 0) {
      if (numericItems.length === 1) {
        valueNumeric = numericItems[0];
      } else {
        valueMinNumeric = Math.min(...numericItems);
        valueMaxNumeric = Math.max(...numericItems);
        valueAvgNumeric = numericItems.reduce((sum, item) => sum + item, 0) / numericItems.length;
      }
    } else if (value.length > 0 && value.every((item) => item && typeof item === "object" && !Array.isArray(item))) {
      let minFound: number | null = null;
      let maxFound: number | null = null;
      let avgFound: number | null = null;
      for (const item of value as Record<string, unknown>[]) {
        minFound ??= extractNumberByKeys(item, ["min", "minimum", "low"]);
        maxFound ??= extractNumberByKeys(item, ["max", "maximum", "high"]);
        avgFound ??= extractNumberByKeys(item, ["avg", "mean", "average"]);
      }
      valueMinNumeric = minFound;
      valueMaxNumeric = maxFound;
      valueAvgNumeric = avgFound;
      if (valueMinNumeric === null && valueMaxNumeric === null && valueAvgNumeric === null) {
        warnings.push("Array value detected but aggregate keys were not recognizable.");
      }
    } else {
      warnings.push("Array value detected with mixed/non-numeric items.");
    }
    return { rawValueText, valueNumeric, valueMinNumeric, valueMaxNumeric, valueAvgNumeric, hadAggregateArray };
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    valueMinNumeric = extractNumberByKeys(record, ["min", "minimum", "low"]);
    valueMaxNumeric = extractNumberByKeys(record, ["max", "maximum", "high"]);
    valueAvgNumeric = extractNumberByKeys(record, ["avg", "mean", "average"]);
    valueNumeric = extractNumberByKeys(record, ["value", "val"]);
    if (valueNumeric === null && valueMinNumeric === null && valueMaxNumeric === null && valueAvgNumeric === null) {
      warnings.push("Object value detected but no recognizable numeric fields were found.");
    }
    return { rawValueText, valueNumeric, valueMinNumeric, valueMaxNumeric, valueAvgNumeric, hadAggregateArray };
  }

  if (value !== null && value !== undefined) {
    warnings.push(`Unsupported value type "${typeof value}" for numeric extraction.`);
  }

  return { rawValueText, valueNumeric, valueMinNumeric, valueMaxNumeric, valueAvgNumeric, hadAggregateArray };
}

export function normalizeTrainingPeaksCustomMetricsPayload(payload: unknown): NormalizedTrainingPeaksCustomMetric[] {
  const output: NormalizedTrainingPeaksCustomMetric[] = [];
  if (!Array.isArray(payload)) {
    return output;
  }

  for (const day of payload) {
    if (!day || typeof day !== "object") {
      continue;
    }
    const dayObject = day as TrainingPeaksCustomMetricsRawDay;
    const athleteId = toPositiveInteger(dayObject.athleteId);
    const dayTimestamp = parseIsoTimestamp(dayObject.timeStamp);
    const details = Array.isArray(dayObject.details) ? dayObject.details : [];
    for (const detail of details) {
      if (!detail || typeof detail !== "object") {
        continue;
      }
      const warnings: string[] = [];
      const detailObject = detail as TrainingPeaksCustomMetricsRawDetail;
      const metricTypeId = toPositiveInteger(detailObject.type);
      const detailTimestamp = parseIsoTimestamp(detailObject.time) ?? parseIsoTimestamp(dayObject.timeStamp);

      if (athleteId === null) {
        warnings.push("Missing or invalid athleteId on day item.");
      }
      if (!dayTimestamp) {
        warnings.push("Missing or invalid day-level timeStamp.");
      }
      if (metricTypeId === null) {
        warnings.push("Missing or invalid detail metric type.");
      }
      if (!detailTimestamp) {
        warnings.push("Missing or invalid metric timestamp.");
      }
      if (athleteId === null || metricTypeId === null || !detailTimestamp) {
        continue;
      }

      const parsedValue = parseValueShape(detailObject.value, warnings);
      output.push({
        trainingPeaksAthleteId: athleteId,
        metricTimestamp: detailTimestamp.metricTimestamp,
        metricDate: detailTimestamp.metricDate,
        metricTypeId,
        metricKey: inferMetricKey(metricTypeId),
        metricLabel: toSafeString(detailObject.label),
        rawValueText: parsedValue.rawValueText,
        valueNumeric: parsedValue.valueNumeric,
        valueMinNumeric: parsedValue.valueMinNumeric,
        valueMaxNumeric: parsedValue.valueMaxNumeric,
        valueAvgNumeric: parsedValue.valueAvgNumeric,
        unit: inferMetricUnit(metricTypeId),
        uploadClient: toSafeString(detailObject.uploadClient),
        sourceSnapshot: detailObject,
        normalizationWarnings: warnings,
      });
    }
  }

  return output;
}
