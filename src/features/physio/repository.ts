import { createSupabaseServerClient, withSupabaseNetworkRetry } from "@/features/supabase/server";
import { fetchAllRows } from "@/features/supabase/paginate";

/** Форма страницы, которую ждёт fetchAllRows от построителя запроса Supabase. */
type SupabasePage = Promise<{
  data: Record<string, unknown>[] | null;
  error: { message: string } | null;
}>;

/**
 * Доступ к витринам движка физиологии (миграции с префиксом physio_).
 *
 * Расчёт живёт в базе: physio_refresh_all() пересчитывает кривые максимальных
 * усилий, профили критической скорости, durability, готовность, нагрузку и радар.
 * Здесь только чтение готовых витрин.
 */

export type PhysioAlert = {
  code: string;
  severity: 1 | 2 | 3;
  title: string;
  headline: string | null;
  term: string | null;
  means: string | null;
  todo: string | null;
  explained: boolean;
  payload: Record<string, unknown> | null;
};

export type PhysioContextItem = {
  kind: "health" | "schedule" | "goal" | "mood" | "nutrition" | "other";
  type: string;
  text: string;
  when: string;
  source: "memory" | "signal" | "nutrition";
};

export type PhysioCurvePoint = {
  bucket: string;
  t: number;
  d: number;
  speed: number;
  pace_s_km: number;
  hr: number | null;
  date: string;
  workout_id: number | null;
};

export type PhysioPrediction = {
  distance_m: number;
  seconds: number;
  time: string;
  pace_s_km: number;
  method: string;
};

export type PhysioZone = {
  from_pace_s_km: number | null;
  to_pace_s_km: number | null;
};

export type ReadinessState = "green" | "amber" | "red" | "partial" | "no_data";
export type DurabilityGrade = "strong" | "ok" | "weak" | "unknown";
export type ProfileQuality = "high" | "medium" | "low";

export type PhysioRadarRow = {
  studentId: string;
  studentName: string;
  alertDate: string;
  maxSeverity: 1 | 2 | 3;
  alerts: number;
  fullyExplained: boolean;
  alertsJson: PhysioAlert[];
  contextJson: PhysioContextItem[];
  contextItems: number;
  hasActiveHealthProblem: boolean;
  hasPauseOrUnavailable: boolean;
  returningAfterIssue: boolean;
  tracksNutrition: boolean;
  readinessScore: number | null;
  readinessState: ReadinessState | null;
  hrvState: string | null;
  ctl: number | null;
  atl: number | null;
  tsb: number | null;
  acwrUncoupled: number | null;
  monotony: number | null;
  csPaceSecPerKm: number | null;
  dPrimeM: number | null;
  vdot: number | null;
  durabilityIndex: number | null;
  durabilityGrade: DurabilityGrade | null;
  quality: ProfileQuality | null;
  dataVerdict: string | null;
};

export type PhysioAthleteRow = {
  studentId: string;
  studentName: string;
  sex: string | null;
  csMps: number | null;
  csPaceSecPerKm: number | null;
  dPrimeM: number | null;
  modelR2: number | null;
  nPoints: number | null;
  quality: ProfileQuality | null;
  qualityReasons: string[] | null;
  points: PhysioCurvePoint[] | null;
  zones: Record<string, PhysioZone> | null;
  predictions: Record<string, PhysioPrediction> | null;
  vdot: number | null;
  lthr: number | null;
  maxHr: number | null;
  durabilityIndex: number | null;
  durabilityGrade: DurabilityGrade | null;
  durabilitySamples: number | null;
  windowFrom: string | null;
  windowTo: string | null;
  readinessScore: number | null;
  readinessState: ReadinessState | null;
  hrvState: string | null;
  rhrDelta: number | null;
  sleepDebt3d: number | null;
  drivers: string[] | null;
  ctl: number | null;
  atl: number | null;
  tsb: number | null;
  acwrUncoupled: number | null;
  monotony: number | null;
  hasActiveHealthProblem: boolean;
  tracksNutrition: boolean;
  dataVerdict: string | null;
  hrvDays30: number | null;
  sleepDays30: number | null;
  lastHealthDate: string | null;
  runs30: number | null;
  contextJson: PhysioContextItem[];
  openAlerts: number | null;
};

export type PhysioDataHealthRow = {
  studentId: string;
  studentName: string;
  hrvDays30: number;
  sleepDays30: number;
  rhrDays30: number;
  weightDays90: number;
  lastHealthDate: string | null;
  runs30: number;
  laps30: number;
  lastScanStatus: string | null;
  lastScanError: string | null;
  verdict: string;
};

export type PhysioGlossaryRow = {
  code: string;
  kind: "alert" | "metric";
  plainName: string;
  term: string | null;
  whatItMeans: string;
  whatToDo: string | null;
  sortOrder: number;
};

export type PhysioGroupSummary = {
  athletes: number;
  profilesHigh: number;
  profilesTotal: number;
  alertDate: string | null;
  needAttention: number;
  explained: number;
  urgentToday: number;
  sickOrPaused: number;
  dataOk: number;
  dataBroken: number;
  durability: Record<string, number>;
  medianEfDeclinePct: number | null;
  durabilitySamples: number;
  effortPoints: number;
  lastRun: { finished_at: string | null; status: string; stats: Record<string, number> } | null;
};

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export async function getPhysioGroupSummary(): Promise<PhysioGroupSummary | null> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase.rpc("physio_group_summary");

  if (error) {
    throw new Error(`Failed to load physio group summary: ${error.message}`);
  }
  if (!data) {
    return null;
  }

  const raw = data as Record<string, unknown>;
  return {
    athletes: Number(raw.athletes ?? 0),
    profilesHigh: Number(raw.profiles_high ?? 0),
    profilesTotal: Number(raw.profiles_total ?? 0),
    alertDate: (raw.alert_date as string) ?? null,
    needAttention: Number(raw.need_attention ?? 0),
    explained: Number(raw.explained ?? 0),
    urgentToday: Number(raw.urgent_today ?? 0),
    sickOrPaused: Number(raw.sick_or_paused ?? 0),
    dataOk: Number(raw.data_ok ?? 0),
    dataBroken: Number(raw.data_broken ?? 0),
    durability: (raw.durability as Record<string, number>) ?? {},
    medianEfDeclinePct: raw.median_ef_decline_pct === null || raw.median_ef_decline_pct === undefined
      ? null
      : Number(raw.median_ef_decline_pct),
    durabilitySamples: Number(raw.durability_samples ?? 0),
    effortPoints: Number(raw.effort_points ?? 0),
    lastRun: (raw.last_run as PhysioGroupSummary["lastRun"]) ?? null,
  };
}

export async function listPhysioRadar(): Promise<PhysioRadarRow[]> {
  const supabase = createSupabaseServerClient();
  const data = await fetchAllRows<Record<string, unknown>>(
    (from, to) =>
      withSupabaseNetworkRetry(() =>
        supabase
          .from("physio_coach_radar")
          .select("*")
          .order("fully_explained", { ascending: true })
          .order("max_severity", { ascending: false })
          .order("student_name", { ascending: true })
          .order("student_id", { ascending: true })
          .range(from, to)
      ) as SupabasePage,
    { label: "physio_coach_radar" }
  );

  return data.map((row: Record<string, unknown>) => ({
    studentId: row.student_id as string,
    studentName: row.student_name as string,
    alertDate: row.alert_date as string,
    maxSeverity: Number(row.max_severity ?? 1) as 1 | 2 | 3,
    alerts: Number(row.alerts ?? 0),
    fullyExplained: Boolean(row.fully_explained),
    alertsJson: asArray<PhysioAlert>(row.alerts_json),
    contextJson: asArray<PhysioContextItem>(row.context_json),
    contextItems: Number(row.context_items ?? 0),
    hasActiveHealthProblem: Boolean(row.has_active_health_problem),
    hasPauseOrUnavailable: Boolean(row.has_pause_or_unavailable),
    returningAfterIssue: Boolean(row.returning_after_issue),
    tracksNutrition: Boolean(row.tracks_nutrition),
    readinessScore: row.readiness_score === null ? null : Number(row.readiness_score),
    readinessState: (row.readiness_state as ReadinessState) ?? null,
    hrvState: (row.hrv_state as string) ?? null,
    ctl: row.ctl === null ? null : Number(row.ctl),
    atl: row.atl === null ? null : Number(row.atl),
    tsb: row.tsb === null ? null : Number(row.tsb),
    acwrUncoupled: row.acwr_uncoupled === null ? null : Number(row.acwr_uncoupled),
    monotony: row.monotony === null ? null : Number(row.monotony),
    csPaceSecPerKm: row.cs_pace_sec_per_km === null ? null : Number(row.cs_pace_sec_per_km),
    dPrimeM: row.d_prime_m === null ? null : Number(row.d_prime_m),
    vdot: row.vdot === null ? null : Number(row.vdot),
    durabilityIndex: row.durability_index === null ? null : Number(row.durability_index),
    durabilityGrade: (row.durability_grade as DurabilityGrade) ?? null,
    quality: (row.quality as ProfileQuality) ?? null,
    dataVerdict: (row.data_verdict as string) ?? null,
  }));
}

export async function listPhysioAthletes(): Promise<PhysioAthleteRow[]> {
  const supabase = createSupabaseServerClient();
  const data = await fetchAllRows<Record<string, unknown>>(
    (from, to) =>
      withSupabaseNetworkRetry(() =>
        supabase
          .from("physio_athlete_overview")
          .select("*")
          .order("student_name", { ascending: true })
          .order("student_id", { ascending: true })
          .range(from, to)
      ) as SupabasePage,
    { label: "physio_athlete_overview" }
  );

  return data.map((row: Record<string, unknown>) => ({
    studentId: row.student_id as string,
    studentName: row.student_name as string,
    sex: (row.sex as string) ?? null,
    csMps: row.cs_mps === null ? null : Number(row.cs_mps),
    csPaceSecPerKm: row.cs_pace_sec_per_km === null ? null : Number(row.cs_pace_sec_per_km),
    dPrimeM: row.d_prime_m === null ? null : Number(row.d_prime_m),
    modelR2: row.model_r2 === null ? null : Number(row.model_r2),
    nPoints: row.n_points === null ? null : Number(row.n_points),
    quality: (row.quality as ProfileQuality) ?? null,
    qualityReasons: asArray<string>(row.quality_reasons),
    points: asArray<PhysioCurvePoint>(row.points),
    zones: (row.zones as Record<string, PhysioZone>) ?? null,
    predictions: (row.predictions as Record<string, PhysioPrediction>) ?? null,
    vdot: row.vdot === null ? null : Number(row.vdot),
    lthr: row.lthr === null ? null : Number(row.lthr),
    maxHr: row.max_hr === null ? null : Number(row.max_hr),
    durabilityIndex: row.durability_index === null ? null : Number(row.durability_index),
    durabilityGrade: (row.durability_grade as DurabilityGrade) ?? null,
    durabilitySamples: row.durability_samples === null ? null : Number(row.durability_samples),
    windowFrom: (row.window_from as string) ?? null,
    windowTo: (row.window_to as string) ?? null,
    readinessScore: row.readiness_score === null ? null : Number(row.readiness_score),
    readinessState: (row.readiness_state as ReadinessState) ?? null,
    hrvState: (row.hrv_state as string) ?? null,
    rhrDelta: row.rhr_delta === null ? null : Number(row.rhr_delta),
    sleepDebt3d: row.sleep_debt_3d === null ? null : Number(row.sleep_debt_3d),
    drivers: asArray<string>(row.drivers),
    ctl: row.ctl === null ? null : Number(row.ctl),
    atl: row.atl === null ? null : Number(row.atl),
    tsb: row.tsb === null ? null : Number(row.tsb),
    acwrUncoupled: row.acwr_uncoupled === null ? null : Number(row.acwr_uncoupled),
    monotony: row.monotony === null ? null : Number(row.monotony),
    hasActiveHealthProblem: Boolean(row.has_active_health_problem),
    tracksNutrition: Boolean(row.tracks_nutrition),
    dataVerdict: (row.data_verdict as string) ?? null,
    hrvDays30: row.hrv_days_30 === null ? null : Number(row.hrv_days_30),
    sleepDays30: row.sleep_days_30 === null ? null : Number(row.sleep_days_30),
    lastHealthDate: (row.last_health_date as string) ?? null,
    runs30: row.runs_30 === null ? null : Number(row.runs_30),
    contextJson: asArray<PhysioContextItem>(row.context_json),
    openAlerts: row.open_alerts === null ? null : Number(row.open_alerts),
  }));
}

export async function listPhysioDataHealth(): Promise<PhysioDataHealthRow[]> {
  const supabase = createSupabaseServerClient();
  const data = await fetchAllRows<Record<string, unknown>>(
    (from, to) =>
      withSupabaseNetworkRetry(() =>
        supabase
          .from("physio_data_health")
          .select("*")
          .order("runs_30", { ascending: false })
          .order("student_id", { ascending: true })
          .range(from, to)
      ) as SupabasePage,
    { label: "physio_data_health" }
  );

  return data.map((row: Record<string, unknown>) => ({
    studentId: row.student_id as string,
    studentName: row.student_name as string,
    hrvDays30: Number(row.hrv_days_30 ?? 0),
    sleepDays30: Number(row.sleep_days_30 ?? 0),
    rhrDays30: Number(row.rhr_days_30 ?? 0),
    weightDays90: Number(row.weight_days_90 ?? 0),
    lastHealthDate: (row.last_health_date as string) ?? null,
    runs30: Number(row.runs_30 ?? 0),
    laps30: Number(row.laps_30 ?? 0),
    lastScanStatus: (row.last_scan_status as string) ?? null,
    lastScanError: (row.last_scan_error as string) ?? null,
    verdict: row.verdict as string,
  }));
}

export async function listPhysioGlossary(): Promise<PhysioGlossaryRow[]> {
  const supabase = createSupabaseServerClient();
  const data = await fetchAllRows<Record<string, unknown>>(
    (from, to) =>
      withSupabaseNetworkRetry(() =>
        supabase
          .from("physio_glossary")
          .select("*")
          .order("kind", { ascending: false })
          .order("sort_order", { ascending: true })
          .order("code", { ascending: true })
          .range(from, to)
      ) as SupabasePage,
    { label: "physio_glossary" }
  );

  return data.map((row: Record<string, unknown>) => ({
    code: row.code as string,
    kind: row.kind as "alert" | "metric",
    plainName: row.plain_name as string,
    term: (row.term as string) ?? null,
    whatItMeans: row.what_it_means as string,
    whatToDo: (row.what_to_do as string) ?? null,
    sortOrder: Number(row.sort_order ?? 100),
  }));
}

/** Полный пересчёт движка. Идёт около 40 секунд. */
export async function refreshPhysioEngine(): Promise<Record<string, number>> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase.rpc("physio_refresh_all", {
    p_window_days: 180,
    p_days: 400,
  });

  if (error) {
    throw new Error(`Failed to refresh physio engine: ${error.message}`);
  }

  return (data as Record<string, number>) ?? {};
}
