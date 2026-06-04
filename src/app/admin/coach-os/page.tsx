import Link from "next/link";

import { formatIsoDate, getSingleSearchParam } from "@/app/admin/lib";
import {
  listCoachReviewRules,
  listWorkoutTemplateFamilies,
  listWorkoutTemplateGuardrails,
  listWorkoutTemplatePresetsDetailed,
  listWorkoutTemplateVariants,
} from "@/features/trainingpeaks/workout-template-catalog";
import { listCurrentAthleteTrainingBaselinesWithStudentNames } from "@/features/trainingpeaks/athlete-training-baselines";

type CoachOsPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

type PresetListRow = Awaited<ReturnType<typeof listWorkoutTemplatePresetsDetailed>>[number];
type GuardrailRow = Awaited<ReturnType<typeof listWorkoutTemplateGuardrails>>[number];
type CoachReviewRuleRow = Awaited<ReturnType<typeof listCoachReviewRules>>[number];
type BaselineRow = Awaited<ReturnType<typeof listCurrentAthleteTrainingBaselinesWithStudentNames>>[number];

const TIER_SORT_ORDER = {
  core: 0,
  advanced: 1,
  extended: 2,
  expansion: 3,
} as const;

function asText(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function formatNumber(value: unknown, suffix?: string): string {
  const numeric = asNumber(value);
  if (numeric === null) {
    return "—";
  }

  const formatted = new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: Number.isInteger(numeric) ? 0 : 1,
    maximumFractionDigits: Number.isInteger(numeric) ? 0 : 1,
  }).format(numeric);

  return suffix ? `${formatted} ${suffix}` : formatted;
}

function formatBooleanText(value: boolean): string {
  return value ? "Да" : "Нет";
}

function getBooleanBadgeClass(value: boolean): string {
  return value ? "admin-badge admin-badge-success" : "admin-badge admin-badge-muted";
}

function getSeverityBadgeClass(severity: string): string {
  switch (severity) {
    case "hard_block":
      return "admin-badge admin-badge-danger";
    case "coach_review":
      return "admin-badge admin-badge-warning";
    default:
      return "admin-badge admin-badge-accent";
  }
}

function getConfidenceBadgeClass(confidence: BaselineRow["confidence"]): string {
  switch (confidence) {
    case "high":
      return "admin-badge admin-badge-success";
    case "medium":
      return "admin-badge admin-badge-accent";
    default:
      return "admin-badge admin-badge-warning";
  }
}

function getFamilyCodeFromVariant(
  value:
    | { family_code?: string | null; display_name_ru?: string | null }
    | Array<{ family_code?: string | null; display_name_ru?: string | null }>
    | null
    | undefined
): string | null {
  const item = Array.isArray(value) ? value[0] : value;
  return asText(item?.family_code);
}

function getFamilyLabelFromVariant(
  value:
    | { family_code?: string | null; display_name_ru?: string | null }
    | Array<{ family_code?: string | null; display_name_ru?: string | null }>
    | null
    | undefined
): string | null {
  const item = Array.isArray(value) ? value[0] : value;
  return asText(item?.display_name_ru);
}

function getVariantDetails(preset: PresetListRow): {
  variantCode: string;
  variantLabel: string | null;
  intensityIntent: string | null;
  familyCode: string;
  familyLabel: string | null;
} {
  const variant = Array.isArray(preset.workout_template_variants)
    ? preset.workout_template_variants[0]
    : preset.workout_template_variants;
  const family = variant?.workout_template_families;

  return {
    variantCode: asText(variant?.variant_code) ?? "—",
    variantLabel: asText(variant?.display_name_ru),
    intensityIntent: asText(variant?.intensity_intent),
    familyCode: getFamilyCodeFromVariant(family) ?? "—",
    familyLabel: getFamilyLabelFromVariant(family),
  };
}

function getPresetParameters(
  preset: PresetListRow
):
  | {
      reps?: unknown;
      work_duration_min?: unknown;
      work_duration_sec?: unknown;
      work_distance_km?: unknown;
      work_unit?: unknown;
      distance_unit?: unknown;
      recovery_duration_min?: unknown;
      recovery_duration_sec?: unknown;
      recovery_unit?: unknown;
      recovery_type?: unknown;
      target_mode?: unknown;
      run_duration_min?: unknown;
      walk_duration_min?: unknown;
    }
  | null {
  const params = Array.isArray(preset.workout_template_preset_parameters)
    ? preset.workout_template_preset_parameters[0]
    : preset.workout_template_preset_parameters;

  return params ?? null;
}

function getJoinedRefLabel(
  value: { ref_code?: string | null; display_name_ru?: string | null } | Array<{ ref_code?: string | null; display_name_ru?: string | null }> | null | undefined
): string {
  const item = Array.isArray(value) ? value[0] : value;
  return asText(item?.display_name_ru) ?? asText(item?.ref_code) ?? "—";
}

function formatWorkValue(preset: PresetListRow): string {
  const params = getPresetParameters(preset);
  if (!params) {
    return "—";
  }

  const workDistanceKm = asNumber(params.work_distance_km);
  if (workDistanceKm !== null) {
    return `${formatNumber(workDistanceKm, "км")}`;
  }

  const workDurationMin = asNumber(params.work_duration_min);
  if (workDurationMin !== null) {
    return `${formatNumber(workDurationMin, "мин")}`;
  }

  const workDurationSec = asNumber(params.work_duration_sec);
  if (workDurationSec !== null) {
    return `${formatNumber(workDurationSec, "сек")}`;
  }

  const runDurationMin = asNumber(params.run_duration_min);
  const walkDurationMin = asNumber(params.walk_duration_min);
  if (runDurationMin !== null || walkDurationMin !== null) {
    return `${runDurationMin !== null ? formatNumber(runDurationMin, "мин бег") : "—"} / ${
      walkDurationMin !== null ? formatNumber(walkDurationMin, "мин шаг") : "—"
    }`;
  }

  return "—";
}

function formatRecoveryValue(preset: PresetListRow): string {
  const params = getPresetParameters(preset);
  if (!params) {
    return "—";
  }

  const recoveryDurationMin = asNumber(params.recovery_duration_min);
  const recoveryDurationSec = asNumber(params.recovery_duration_sec);
  const recoveryType = asText(params.recovery_type);

  if (recoveryDurationMin !== null) {
    return `${formatNumber(recoveryDurationMin, "мин")}${recoveryType ? ` · ${recoveryType}` : ""}`;
  }

  if (recoveryDurationSec !== null) {
    return `${formatNumber(recoveryDurationSec, "сек")}${recoveryType ? ` · ${recoveryType}` : ""}`;
  }

  const walkDurationMin = asNumber(params.walk_duration_min);
  if (walkDurationMin !== null) {
    return `${formatNumber(walkDurationMin, "мин шаг")}`;
  }

  return recoveryType ?? "—";
}

function formatAppliesTo(row: GuardrailRow | CoachReviewRuleRow): string {
  const parts: string[] = [];

  if (row.applies_to_family_codes.length > 0) {
    parts.push(`family: ${row.applies_to_family_codes.join(", ")}`);
  }
  if (row.applies_to_variant_codes.length > 0) {
    parts.push(`variant: ${row.applies_to_variant_codes.join(", ")}`);
  }
  if (row.applies_to_preset_codes.length > 0) {
    parts.push(`preset: ${row.applies_to_preset_codes.join(", ")}`);
  }
  if (row.applies_to_intensity_intents.length > 0) {
    parts.push(`intent: ${row.applies_to_intensity_intents.join(", ")}`);
  }
  if ("applies_to_context_flags" in row && row.applies_to_context_flags.length > 0) {
    parts.push(`flags: ${row.applies_to_context_flags.join(", ")}`);
  }

  return parts.length > 0 ? parts.join(" | ") : "all";
}

function formatThresholdValue(value: unknown): string {
  const numeric = asNumber(value);
  if (numeric === null) {
    return "—";
  }

  return new Intl.NumberFormat("ru-RU", {
    minimumFractionDigits: Number.isInteger(numeric) ? 0 : 1,
    maximumFractionDigits: Number.isInteger(numeric) ? 0 : 1,
  }).format(numeric);
}

function buildHref(
  params: URLSearchParams,
  hash?: "catalog" | "presets" | "guardrails" | "baselines"
): string {
  const query = params.toString();
  const base = `/admin/coach-os${query ? `?${query}` : ""}`;
  return hash ? `${base}#${hash}` : base;
}

function withParam(
  source: URLSearchParams,
  key: string,
  value: string | null | undefined
): URLSearchParams {
  const next = new URLSearchParams(source);
  if (!value || value === "all" || value.length === 0) {
    next.delete(key);
  } else {
    next.set(key, value);
  }
  return next;
}

function getBaselinePriority(row: BaselineRow): number {
  const flags = new Set(row.context_flags);

  if (flags.has("insufficient_data")) {
    return 0;
  }
  if (row.needs_review || flags.has("manual_review")) {
    return 1;
  }
  if (row.confidence === "low" || flags.has("low_confidence")) {
    return 2;
  }
  if (row.confidence === "medium") {
    return 3;
  }
  return 4;
}

function formatContextFlags(flags: string[]): string {
  return flags.length > 0 ? flags.join(", ") : "—";
}

function isPresetVisible(
  preset: PresetListRow,
  filters: {
    family: string;
    tier: string;
    coachOnly: string;
    query: string;
  }
): boolean {
  const variant = getVariantDetails(preset);
  const normalizedQuery = filters.query.trim().toLowerCase();

  if (filters.family !== "all" && variant.familyCode !== filters.family) {
    return false;
  }

  if (filters.tier !== "all" && preset.tier !== filters.tier) {
    return false;
  }

  if (filters.coachOnly === "yes" && !preset.coach_only) {
    return false;
  }

  if (filters.coachOnly === "no" && preset.coach_only) {
    return false;
  }

  if (!normalizedQuery) {
    return true;
  }

  return [
    preset.preset_code,
    preset.display_name_ru,
    variant.familyCode,
    variant.familyLabel,
    variant.variantCode,
    variant.variantLabel,
  ]
    .map((value) => value?.toLowerCase() ?? "")
    .some((value) => value.includes(normalizedQuery));
}

export default async function CoachOsAdminPage({ searchParams }: CoachOsPageProps) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const family = getSingleSearchParam(resolvedSearchParams.family) ?? "all";
  const tier = getSingleSearchParam(resolvedSearchParams.tier) ?? "all";
  const coachOnly = getSingleSearchParam(resolvedSearchParams.coachOnly) ?? "all";
  const query = getSingleSearchParam(resolvedSearchParams.q) ?? "";
  const show = getSingleSearchParam(resolvedSearchParams.show) ?? "review";

  const [families, variants, presets, guardrails, coachReviewRules, baselines] = await Promise.all([
    listWorkoutTemplateFamilies(),
    listWorkoutTemplateVariants(),
    listWorkoutTemplatePresetsDetailed(),
    listWorkoutTemplateGuardrails(),
    listCoachReviewRules(),
    listCurrentAthleteTrainingBaselinesWithStudentNames(),
  ]);

  const presetFilters = { family, tier, coachOnly, query };
  const familySortOrder = new Map(families.map((item) => [item.family_code, item.sort_order]));
  const variantSortOrder = new Map(
    variants.map((item) => [`${getFamilyCodeFromVariant(item.workout_template_families) ?? ""}:${item.variant_code}`, item.sort_order])
  );

  const filteredPresets = presets
    .filter((preset) => isPresetVisible(preset, presetFilters))
    .sort((left, right) => {
      const leftVariant = getVariantDetails(left);
      const rightVariant = getVariantDetails(right);
      const familyOrderDiff =
        (familySortOrder.get(leftVariant.familyCode) ?? Number.MAX_SAFE_INTEGER) -
        (familySortOrder.get(rightVariant.familyCode) ?? Number.MAX_SAFE_INTEGER);
      if (familyOrderDiff !== 0) {
        return familyOrderDiff;
      }

      const variantOrderDiff =
        (variantSortOrder.get(`${leftVariant.familyCode}:${leftVariant.variantCode}`) ?? Number.MAX_SAFE_INTEGER) -
        (variantSortOrder.get(`${rightVariant.familyCode}:${rightVariant.variantCode}`) ?? Number.MAX_SAFE_INTEGER);
      if (variantOrderDiff !== 0) {
        return variantOrderDiff;
      }

      const tierDiff =
        TIER_SORT_ORDER[left.tier as keyof typeof TIER_SORT_ORDER] -
        TIER_SORT_ORDER[right.tier as keyof typeof TIER_SORT_ORDER];
      if (tierDiff !== 0) {
        return tierDiff;
      }

      if (left.sort_order !== right.sort_order) {
        return left.sort_order - right.sort_order;
      }

      return left.preset_code.localeCompare(right.preset_code);
    });

  const allPresetCount = presets.length;
  const enabledPresets = presets.filter((preset) => preset.enabled_by_default).length;
  const disabledPresets = allPresetCount - enabledPresets;
  const coachOnlyPresets = presets.filter((preset) => preset.coach_only).length;
  const tierCounts = presets.reduce<Record<string, number>>((acc, preset) => {
    acc[preset.tier] = (acc[preset.tier] ?? 0) + 1;
    return acc;
  }, {});
  const variantDetails = presets.map((preset) => ({
    ...getVariantDetails(preset),
    preset,
  }));
  const vo2ExpansionCount = variantDetails.filter((item) => item.variantCode === "vo2_expansion").length;
  const raceSpecificCount = variantDetails.filter((item) => item.familyCode === "race_specific").length;
  const beginnerRunWalkCount = variantDetails.filter((item) => item.familyCode === "beginner_run_walk").length;

  const protectedThresholdPresetCodes = ["thr_5x4", "thr_4x5", "thr_8x4", "thr_6x5", "thr_6x6", "thr_4x9", "thr_5x7"];
  const protectedThresholdOk = protectedThresholdPresetCodes.every((presetCode) => {
    const preset = presets.find((item) => item.preset_code === presetCode);
    const details = preset ? getVariantDetails(preset) : null;
    return Boolean(
      preset &&
        details &&
        details.familyCode === "intervals" &&
        details.variantCode === "controlled_threshold" &&
        details.intensityIntent === "controlled_threshold"
    );
  });
  const vo2ExpansionDefaultsOk = presets
    .filter((preset) => getVariantDetails(preset).variantCode === "vo2_expansion")
    .every((preset) => preset.coach_only && !preset.enabled_by_default);
  const tenKThreeByThree = presets.find((preset) => preset.preset_code === "race_10k_3x3km");
  const tenKThreeByThreeParams = tenKThreeByThree ? getPresetParameters(tenKThreeByThree) : null;
  const tenKThreeByThreeOk = Boolean(
    tenKThreeByThree &&
      getVariantDetails(tenKThreeByThree).familyCode === "race_specific" &&
      tenKThreeByThree.source === "manual" &&
      tenKThreeByThree.observed_count === 0 &&
      asNumber(tenKThreeByThreeParams?.work_distance_km) === 3 &&
      asText(tenKThreeByThreeParams?.distance_unit) === "km"
  );
  const recoveryFamilyMissing = !families.some((item) => item.family_code === "recovery");
  const qualityFamilyCodes = new Set([
    "steady_tempo",
    "intervals",
    "race_specific",
    "pre_race",
    "race_week",
    "optional_development",
  ]);
  const qualityReviewOk = presets
    .filter((preset) => qualityFamilyCodes.has(getVariantDetails(preset).familyCode))
    .every((preset) => preset.coach_review_required);

  const invariantRows = [
    {
      label: "Protected threshold presets stay controlled threshold",
      detail: protectedThresholdPresetCodes.join(", "),
      ok: protectedThresholdOk,
    },
    {
      label: "VO2 expansion presets are disabled by default and coach-only",
      detail: "variant=vo2_expansion",
      ok: vo2ExpansionDefaultsOk,
    },
    {
      label: "3x3 km stays manual, kilometer-based, observed_count=0",
      detail: "race_10k_3x3km",
      ok: tenKThreeByThreeOk,
    },
    {
      label: "Recovery family is absent from Coach OS catalog",
      detail: "family=recovery",
      ok: recoveryFamilyMissing,
    },
    {
      label: "All quality presets require coach review",
      detail: "steady_tempo, intervals, race_specific, pre_race, race_week, optional_development",
      ok: qualityReviewOk,
    },
  ];

  const baselineSummary = baselines.reduce(
    (acc, row) => {
      acc.current += 1;
      acc[row.confidence] += 1;
      if (row.needs_review) {
        acc.needsReview += 1;
      }
      if (row.context_flags.includes("insufficient_data")) {
        acc.insufficientData += 1;
      }
      if (row.context_flags.includes("manual_review")) {
        acc.manualReview += 1;
      }
      if (row.context_flags.includes("low_confidence")) {
        acc.lowConfidenceFlag += 1;
      }
      return acc;
    },
    {
      current: 0,
      high: 0,
      medium: 0,
      low: 0,
      needsReview: 0,
      insufficientData: 0,
      manualReview: 0,
      lowConfidenceFlag: 0,
    }
  );

  const baselineRowsSorted = [...baselines].sort((left, right) => {
    const priorityDiff = getBaselinePriority(left) - getBaselinePriority(right);
    if (priorityDiff !== 0) {
      return priorityDiff;
    }

    return (left.student_name ?? left.student_id).localeCompare(right.student_name ?? right.student_id, "ru");
  });

  const baselineRowsVisible =
    show === "all"
      ? baselineRowsSorted
      : baselineRowsSorted.filter((row) => {
          const flags = new Set(row.context_flags);
          return (
            row.needs_review ||
            row.confidence === "low" ||
            flags.has("insufficient_data") ||
            flags.has("manual_review") ||
            flags.has("low_confidence")
          );
        });
  const hiddenBaselineCount = baselines.length - baselineRowsVisible.length;

  const baseParams = new URLSearchParams();
  if (family !== "all") {
    baseParams.set("family", family);
  }
  if (tier !== "all") {
    baseParams.set("tier", tier);
  }
  if (coachOnly !== "all") {
    baseParams.set("coachOnly", coachOnly);
  }
  if (query.trim().length > 0) {
    baseParams.set("q", query.trim());
  }
  if (show === "all") {
    baseParams.set("show", "all");
  }

  const resetPresetParams = new URLSearchParams(baseParams);
  resetPresetParams.delete("family");
  resetPresetParams.delete("tier");
  resetPresetParams.delete("coachOnly");
  resetPresetParams.delete("q");

  return (
    <section className="admin-section">
      <div className="admin-section-header">
        <div>
          <h2>Coach OS</h2>
          <p className="admin-muted">
            Каталог шаблонов, правила безопасности и baseline учеников для будущего планирования.
          </p>
        </div>
        <span className="admin-badge admin-badge-outline">Read-only · без изменений в TrainingPeaks</span>
      </div>

      <div className="admin-card">
        <div className="admin-table-primary">
          <p className="admin-muted">
            Страница работает как единый read-only overview под `/admin`: все данные загружаются на сервере, фильтры
            и режимы живут в URL, а разделы используют стабильные якоря для естественного browser back/scroll.
          </p>
          <div className="admin-tabs">
            <Link className="admin-tab admin-tab-active" href={buildHref(baseParams, "catalog")}>
              #catalog
            </Link>
            <Link className="admin-tab" href={buildHref(baseParams, "presets")}>
              #presets
            </Link>
            <Link className="admin-tab" href={buildHref(baseParams, "guardrails")}>
              #guardrails
            </Link>
            <Link className="admin-tab" href={buildHref(baseParams, "baselines")}>
              #baselines
            </Link>
          </div>
        </div>
      </div>

      <section id="catalog" className="admin-section">
        <div className="admin-section-header">
          <div>
            <h3>Catalog Summary</h3>
            <p className="admin-muted">DB-derived overview of families, variants, presets and rollout constraints.</p>
          </div>
        </div>

        <div className="admin-summary-grid">
          <article className="admin-card admin-summary-card">
            <span className="admin-summary-label">Families</span>
            <strong className="admin-summary-value">{families.length}</strong>
          </article>
          <article className="admin-card admin-summary-card">
            <span className="admin-summary-label">Variants</span>
            <strong className="admin-summary-value">{variants.length}</strong>
          </article>
          <article className="admin-card admin-summary-card">
            <span className="admin-summary-label">Presets</span>
            <strong className="admin-summary-value">{allPresetCount}</strong>
          </article>
          <article className="admin-card admin-summary-card">
            <span className="admin-summary-label">Enabled presets</span>
            <strong className="admin-summary-value">{enabledPresets}</strong>
          </article>
          <article className="admin-card admin-summary-card">
            <span className="admin-summary-label">Disabled presets</span>
            <strong className="admin-summary-value">{disabledPresets}</strong>
          </article>
          <article className="admin-card admin-summary-card">
            <span className="admin-summary-label">Coach-only presets</span>
            <strong className="admin-summary-value">{coachOnlyPresets}</strong>
          </article>
          <article className="admin-card admin-summary-card">
            <span className="admin-summary-label">Core / advanced</span>
            <strong className="admin-summary-value">
              {tierCounts.core ?? 0} / {tierCounts.advanced ?? 0}
            </strong>
          </article>
          <article className="admin-card admin-summary-card">
            <span className="admin-summary-label">Extended / expansion</span>
            <strong className="admin-summary-value">
              {tierCounts.extended ?? 0} / {tierCounts.expansion ?? 0}
            </strong>
          </article>
          <article className="admin-card admin-summary-card">
            <span className="admin-summary-label">VO2 expansion</span>
            <strong className="admin-summary-value">{vo2ExpansionCount}</strong>
          </article>
          <article className="admin-card admin-summary-card">
            <span className="admin-summary-label">Race-specific</span>
            <strong className="admin-summary-value">{raceSpecificCount}</strong>
          </article>
          <article className="admin-card admin-summary-card">
            <span className="admin-summary-label">Beginner run-walk</span>
            <strong className="admin-summary-value">{beginnerRunWalkCount}</strong>
          </article>
        </div>

        <article className="admin-card admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Invariant</th>
                <th>Status</th>
                <th>Scope</th>
              </tr>
            </thead>
            <tbody>
              {invariantRows.map((row) => (
                <tr key={row.label}>
                  <td>{row.label}</td>
                  <td>
                    <span className={row.ok ? "admin-badge admin-badge-success" : "admin-badge admin-badge-danger"}>
                      {row.ok ? "OK" : "Check"}
                    </span>
                  </td>
                  <td>
                    <span className="admin-muted">{row.detail}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </article>
      </section>

      <section id="presets" className="admin-section">
        <div className="admin-section-header">
          <div>
            <h3>Preset Table</h3>
            <p className="admin-muted">
              URL filters stay in query params so the page remains shareable and browser back keeps the same context.
            </p>
          </div>
        </div>

        <form className="admin-card admin-filters admin-filters-compact" method="get" action="/admin/coach-os#presets">
          {show === "all" && <input type="hidden" name="show" value="all" />}
          <label className="admin-field">
            <span>Family</span>
            <select name="family" defaultValue={family}>
              <option value="all">Все</option>
              {families.map((item) => (
                <option key={item.family_code} value={item.family_code}>
                  {item.family_code}
                </option>
              ))}
            </select>
          </label>
          <label className="admin-field">
            <span>Tier</span>
            <select name="tier" defaultValue={tier}>
              <option value="all">Все</option>
              <option value="core">core</option>
              <option value="advanced">advanced</option>
              <option value="extended">extended</option>
              <option value="expansion">expansion</option>
            </select>
          </label>
          <label className="admin-field">
            <span>Coach-only</span>
            <select name="coachOnly" defaultValue={coachOnly}>
              <option value="all">Все</option>
              <option value="yes">Только coach-only</option>
              <option value="no">Без coach-only</option>
            </select>
          </label>
          <label className="admin-field">
            <span>Поиск</span>
            <input className="admin-input" defaultValue={query} name="q" placeholder="preset_code / family / display_name" />
          </label>
          <div className="admin-actions admin-filters-actions">
            <button className="admin-button admin-button-secondary" type="submit">
              Применить
            </button>
            <Link className="admin-button admin-button-secondary" href={buildHref(resetPresetParams, "presets")}>
              Сбросить
            </Link>
          </div>
        </form>

        <div className="admin-card">
          <div className="admin-table-primary">
            <strong>{filteredPresets.length} preset(s)</strong>
            <span className="admin-muted">
              Сортировка: family, variant, tier, sort_order, preset_code.
            </span>
          </div>
        </div>

        <div className="admin-card admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>preset_code</th>
                <th>family</th>
                <th>variant</th>
                <th>display_name_ru</th>
                <th>tier</th>
                <th>source</th>
                <th>enabled_by_default</th>
                <th>coach_only</th>
                <th>coach_review_required</th>
                <th>target_mode</th>
                <th>reps / work</th>
                <th>recovery</th>
                <th>warmup</th>
                <th>cooldown</th>
              </tr>
            </thead>
            <tbody>
              {filteredPresets.length === 0 ? (
                <tr>
                  <td className="admin-empty-cell" colSpan={14}>
                    Ничего не найдено для текущих фильтров.
                  </td>
                </tr>
              ) : (
                filteredPresets.map((preset) => {
                  const details = getVariantDetails(preset);
                  const params = getPresetParameters(preset);

                  return (
                    <tr key={preset.id}>
                      <td>
                        <div className="admin-table-primary">
                          <strong>{preset.preset_code}</strong>
                          {details.intensityIntent && <span className="admin-muted">{details.intensityIntent}</span>}
                        </div>
                      </td>
                      <td>
                        <div className="admin-table-primary">
                          <span>{details.familyCode}</span>
                          {details.familyLabel && <span className="admin-muted">{details.familyLabel}</span>}
                        </div>
                      </td>
                      <td>
                        <div className="admin-table-primary">
                          <span>{details.variantCode}</span>
                          {details.variantLabel && <span className="admin-muted">{details.variantLabel}</span>}
                        </div>
                      </td>
                      <td>{preset.display_name_ru}</td>
                      <td>{preset.tier}</td>
                      <td>{preset.source}</td>
                      <td>
                        <span className={getBooleanBadgeClass(preset.enabled_by_default)}>
                          {formatBooleanText(preset.enabled_by_default)}
                        </span>
                      </td>
                      <td>
                        <span className={getBooleanBadgeClass(preset.coach_only)}>{formatBooleanText(preset.coach_only)}</span>
                      </td>
                      <td>
                        <span className={getBooleanBadgeClass(preset.coach_review_required)}>
                          {formatBooleanText(preset.coach_review_required)}
                        </span>
                      </td>
                      <td>{asText(params?.target_mode) ?? "—"}</td>
                      <td>
                        <div className="admin-table-primary">
                          <span>{asNumber(params?.reps) !== null ? formatNumber(params?.reps) : "—"}</span>
                          <span className="admin-muted">{formatWorkValue(preset)}</span>
                        </div>
                      </td>
                      <td>{formatRecoveryValue(preset)}</td>
                      <td>{getJoinedRefLabel(preset.workout_template_warmup_refs)}</td>
                      <td>{getJoinedRefLabel(preset.workout_template_cooldown_refs)}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section id="guardrails" className="admin-section">
        <div className="admin-section-header">
          <div>
            <h3>Guardrails / Coach Review Rules</h3>
            <p className="admin-muted">Read-only visibility into rule severity, trigger type and applicability scope.</p>
          </div>
        </div>

        <div className="admin-card admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>rule_code</th>
                <th>severity</th>
                <th>is_code_constant</th>
                <th>enabled</th>
                <th>applies_to</th>
                <th>message_ru</th>
              </tr>
            </thead>
            <tbody>
              {guardrails.map((row) => (
                <tr key={row.id}>
                  <td>{row.rule_code}</td>
                  <td>
                    <span className={getSeverityBadgeClass(row.severity)}>{row.severity}</span>
                  </td>
                  <td>{formatBooleanText(row.is_code_constant)}</td>
                  <td>{formatBooleanText(row.is_enabled)}</td>
                  <td>
                    <span className="admin-muted">{formatAppliesTo(row)}</span>
                  </td>
                  <td>{row.message_ru}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="admin-card admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>rule_code</th>
                <th>trigger_type</th>
                <th>threshold_value</th>
                <th>applies_to</th>
                <th>enabled</th>
                <th>message_ru</th>
              </tr>
            </thead>
            <tbody>
              {coachReviewRules.map((row) => (
                <tr key={row.id}>
                  <td>{row.rule_code}</td>
                  <td>{row.trigger_type}</td>
                  <td>{formatThresholdValue(row.threshold_value)}</td>
                  <td>
                    <span className="admin-muted">{formatAppliesTo(row)}</span>
                  </td>
                  <td>{formatBooleanText(row.is_enabled)}</td>
                  <td>{row.message_ru}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section id="baselines" className="admin-section">
        <div className="admin-section-header">
          <div>
            <h3>Athlete Baselines</h3>
            <p className="admin-muted">
              Family labels are advisory only. This page uses numeric caps as guardrails.
            </p>
          </div>
          <div className="admin-actions">
            <Link
              className={`admin-button ${show === "all" ? "admin-button-secondary" : ""}`}
              href={buildHref(withParam(baseParams, "show", null), "baselines")}
            >
              Needs review first
            </Link>
            <Link
              className={`admin-button ${show === "all" ? "" : "admin-button-secondary"}`}
              href={buildHref(withParam(baseParams, "show", "all"), "baselines")}
            >
              Show all
            </Link>
          </div>
        </div>

        <div className="admin-summary-grid">
          <article className="admin-card admin-summary-card">
            <span className="admin-summary-label">Current baselines</span>
            <strong className="admin-summary-value">{baselineSummary.current}</strong>
          </article>
          <article className="admin-card admin-summary-card">
            <span className="admin-summary-label">High confidence</span>
            <strong className="admin-summary-value">{baselineSummary.high}</strong>
          </article>
          <article className="admin-card admin-summary-card">
            <span className="admin-summary-label">Medium confidence</span>
            <strong className="admin-summary-value">{baselineSummary.medium}</strong>
          </article>
          <article className="admin-card admin-summary-card">
            <span className="admin-summary-label">Low confidence</span>
            <strong className="admin-summary-value">{baselineSummary.low}</strong>
          </article>
          <article className="admin-card admin-summary-card">
            <span className="admin-summary-label">Needs review</span>
            <strong className="admin-summary-value">{baselineSummary.needsReview}</strong>
          </article>
          <article className="admin-card admin-summary-card">
            <span className="admin-summary-label">Insufficient data</span>
            <strong className="admin-summary-value">{baselineSummary.insufficientData}</strong>
          </article>
          <article className="admin-card admin-summary-card">
            <span className="admin-summary-label">Manual review</span>
            <strong className="admin-summary-value">{baselineSummary.manualReview}</strong>
          </article>
          <article className="admin-card admin-summary-card">
            <span className="admin-summary-label">low_confidence flag</span>
            <strong className="admin-summary-value">{baselineSummary.lowConfidenceFlag}</strong>
          </article>
        </div>

        {show !== "all" && hiddenBaselineCount > 0 && (
          <div className="admin-alert admin-alert-warning">
            По умолчанию скрыты {hiddenBaselineCount} baseline(s) без review/low-confidence сигналов. Для полного списка
            используй `show=all`.
          </div>
        )}

        <div className="admin-card admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>student_name</th>
                <th>trainingpeaks_athlete_id</th>
                <th>confidence</th>
                <th>needs_review</th>
                <th>context_flags</th>
                <th>frequency_cap</th>
                <th>weekly_minutes_cap</th>
                <th>long_run_cap_min</th>
                <th>quality_count_cap</th>
                <th>interval_like_count</th>
                <th>source date range</th>
              </tr>
            </thead>
            <tbody>
              {baselineRowsVisible.length === 0 ? (
                <tr>
                  <td className="admin-empty-cell" colSpan={11}>
                    Baselines для выбранного режима не найдены.
                  </td>
                </tr>
              ) : (
                baselineRowsVisible.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <div className="admin-table-primary">
                        <strong>{row.student_name ?? row.student_id}</strong>
                        <span className="admin-muted">{row.student_id}</span>
                      </div>
                    </td>
                    <td>{row.trainingpeaks_athlete_id ?? "—"}</td>
                    <td>
                      <span className={getConfidenceBadgeClass(row.confidence)}>{row.confidence}</span>
                    </td>
                    <td>
                      <span className={getBooleanBadgeClass(row.needs_review)}>{formatBooleanText(row.needs_review)}</span>
                    </td>
                    <td>
                      <div className="admin-table-primary">
                        <span>{formatContextFlags(row.context_flags)}</span>
                        {row.family_label_advisory && (
                          <span className="admin-muted">advisory family: {row.family_label_advisory}</span>
                        )}
                      </div>
                    </td>
                    <td>{formatNumber(row.frequency_cap)}</td>
                    <td>{formatNumber(row.weekly_minutes_cap)}</td>
                    <td>{formatNumber(row.long_run_cap_min)}</td>
                    <td>{formatNumber(row.quality_count_cap)}</td>
                    <td>{formatNumber(row.interval_like_count)}</td>
                    <td>
                      <div className="admin-table-primary">
                        <span>
                          {row.source_from} — {row.source_to}
                        </span>
                        <span className="admin-muted">generated {formatIsoDate(row.generated_at)}</span>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}
