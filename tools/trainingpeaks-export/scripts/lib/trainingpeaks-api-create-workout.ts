import type { Page } from "playwright";

const TP_API_HOST = "https://tpapi.trainingpeaks.com";

export type ApiJsonResponse = {
  status: number;
  ok: boolean;
  body: unknown;
};

export function buildCreateWorkoutUrl(athleteId: number): string {
  return `${TP_API_HOST}/fitness/v6/athletes/${athleteId}/workouts`;
}

export function buildWorkoutByIdUrl(athleteId: number, workoutId: number): string {
  return `${TP_API_HOST}/fitness/v6/athletes/${athleteId}/workouts/${workoutId}`;
}

export function buildWorkoutsByDayRangeUrl(athleteId: number, dateIso: string): string {
  return `${TP_API_HOST}/fitness/v6/athletes/${athleteId}/workouts/${dateIso}/${dateIso}`;
}

export async function performApiJsonRequest(input: {
  page: Page;
  method: "GET" | "POST";
  endpoint: string;
  headers: Record<string, string>;
  body?: unknown;
}): Promise<ApiJsonResponse> {
  const response = await input.page.request.fetch(input.endpoint, {
    method: input.method,
    headers: input.headers,
    data: input.body,
    failOnStatusCode: false,
  });

  let parsedBody: unknown;
  try {
    parsedBody = await response.json();
  } catch {
    parsedBody = await response.text();
  }

  return {
    status: response.status(),
    ok: response.ok(),
    body: parsedBody,
  };
}

export function readWorkoutIdFromBody(body: unknown): number | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return null;
  }
  const asRecord = body as Record<string, unknown>;
  const raw = asRecord.workoutId;
  if (typeof raw === "number" && Number.isInteger(raw) && raw > 0) {
    return raw;
  }
  return null;
}
