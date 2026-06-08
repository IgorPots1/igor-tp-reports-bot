import Link from "next/link";

import FormActionButton from "@/app/admin/FormActionButton";
import { getSingleSearchParam } from "@/app/admin/lib";
import { setNutritionEnabledAction } from "@/app/admin/coach-os/nutrition/actions";
import { listNutritionAdminDashboardRows } from "@/features/nutrition/admin";
import {
  formatNutritionCohortStatus,
  formatNutritionNextAction,
  formatNutritionSafetyFlag,
  formatNutritionStatus,
} from "@/features/nutrition/admin-labels";
import type { NutritionDashboardViewMode } from "@/features/nutrition/repository";

type NutritionDashboardPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function asBoolean(value: string | null | undefined): boolean {
  return value === "1" || value === "true" || value === "yes";
}

function parseViewMode(value: string | null | undefined): NutritionDashboardViewMode {
  if (value === "all" || value === "not-in-test") {
    return value;
  }
  return "test";
}

function buildNutritionDashboardHref(input: {
  view?: NutritionDashboardViewMode;
  safety?: boolean;
  active?: boolean;
}): string {
  const params = new URLSearchParams();
  if (input.view && input.view !== "test") {
    params.set("view", input.view);
  }
  if (input.safety) {
    params.set("safety", "1");
  }
  if (input.active) {
    params.set("active", "1");
  }
  const query = params.toString();
  return query ? `/admin/coach-os/nutrition?${query}` : "/admin/coach-os/nutrition";
}

function getBadgeClass(ok: boolean): string {
  return ok ? "admin-badge admin-badge-success" : "admin-badge admin-badge-muted";
}

function getCohortBadgeClass(enabled: boolean): string {
  return enabled ? "admin-badge admin-badge-success" : "admin-badge admin-badge-muted";
}

function getStatusBadgeClass(status: string | null): string {
  if (!status) {
    return "admin-badge admin-badge-muted";
  }
  if (status === "ready_for_analysis" || status === "approved_for_copy") {
    return "admin-badge admin-badge-success";
  }
  if (status === "insufficient" || status === "blocked_safety") {
    return "admin-badge admin-badge-danger";
  }
  if (status === "needs_review") {
    return "admin-badge admin-badge-warning";
  }
  return "admin-badge admin-badge-outline";
}

export default async function CoachOsNutritionDashboardPage({
  searchParams,
}: NutritionDashboardPageProps) {
  const resolved = (await searchParams) ?? {};
  const viewMode = parseViewMode(getSingleSearchParam(resolved.view));
  const active = asBoolean(getSingleSearchParam(resolved.active));
  const safetyOnly = asBoolean(getSingleSearchParam(resolved.safety));
  const redirectTo = buildNutritionDashboardHref({ view: viewMode, safety: safetyOnly, active });

  const rows = await listNutritionAdminDashboardRows({
    viewMode,
    active,
    safetyOnly,
  });
  const readyCount = rows.filter((row) => row.lastReportStatus === "ready_for_analysis").length;
  const needsReviewCount = rows.filter(
    (row) => row.lastReportStatus === "needs_review" || row.lastAnalysisStatus === "needs_review"
  ).length;
  const blockedCount = rows.filter((row) => row.hasSafetyFlag).length;
  const enabledCount = rows.filter((row) => row.nutritionEnabled).length;

  return (
    <section className="admin-section admin-nutrition-page">
      <div className="admin-section-header">
        <div>
          <h2>Питание · Coach OS</h2>
          <p className="admin-muted">
            Админка недельных обзоров питания. По умолчанию — только участники теста питания.
          </p>
        </div>
        <span className="admin-badge admin-badge-outline">Только копия</span>
      </div>

      <div className="admin-summary-grid admin-summary-grid-compact">
        <article className="admin-card admin-summary-card">
          <span className="admin-summary-label">В списке</span>
          <strong className="admin-summary-value">{rows.length}</strong>
        </article>
        <article className="admin-card admin-summary-card">
          <span className="admin-summary-label">В тесте питания</span>
          <strong className="admin-summary-value">{enabledCount}</strong>
        </article>
        <article className="admin-card admin-summary-card">
          <span className="admin-summary-label">Готово к разбору</span>
          <strong className="admin-summary-value">{readyCount}</strong>
        </article>
        <article className="admin-card admin-summary-card">
          <span className="admin-summary-label">Нужна проверка</span>
          <strong className="admin-summary-value">{needsReviewCount}</strong>
        </article>
        <article className="admin-card admin-summary-card">
          <span className="admin-summary-label">Блок безопасности</span>
          <strong className="admin-summary-value">{blockedCount}</strong>
        </article>
      </div>

      <div className="admin-card admin-card-compact">
        <div className="admin-tabs">
          <Link
            className={`admin-tab ${viewMode === "test" && !safetyOnly ? "admin-tab-active" : ""}`}
            href={buildNutritionDashboardHref({ view: "test", active })}
          >
            В тесте питания
          </Link>
          <Link
            className={`admin-tab ${viewMode === "all" && !safetyOnly ? "admin-tab-active" : ""}`}
            href={buildNutritionDashboardHref({ view: "all", active })}
          >
            Все ученики
          </Link>
          <Link
            className={`admin-tab ${viewMode === "not-in-test" && !safetyOnly ? "admin-tab-active" : ""}`}
            href={buildNutritionDashboardHref({ view: "not-in-test", active })}
          >
            Не в тесте
          </Link>
          <Link
            className={`admin-tab ${safetyOnly ? "admin-tab-active" : ""}`}
            href={buildNutritionDashboardHref({ view: viewMode, safety: true, active })}
          >
            Блок безопасности
          </Link>
          {viewMode === "all" ? (
            <Link
              className={`admin-tab ${active ? "admin-tab-active" : ""}`}
              href={buildNutritionDashboardHref({ view: "all", active: !active, safety: safetyOnly })}
            >
              {active ? "Только активные" : "Активные"}
            </Link>
          ) : null}
        </div>
      </div>

      <div className="admin-card admin-card-compact admin-table-wrap">
        <table className="admin-table admin-table-compact">
          <thead>
            <tr>
              <th>Ученик</th>
              <th>Питание</th>
              <th>Вес</th>
              <th>Приложение</th>
              <th>Отчёт</th>
              <th>Дней</th>
              <th>Анализ</th>
              <th>Безопасность</th>
              <th>След. шаг</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td className="admin-empty-cell" colSpan={10}>
                  Нет учеников по выбранным фильтрам.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={row.studentId}>
                  <td>
                    <div className="admin-table-primary">
                      <strong>{row.studentName}</strong>
                      <span className="admin-muted">{row.studentSlug}</span>
                    </div>
                  </td>
                  <td>
                    <div className="admin-inline-actions">
                      <span className={getCohortBadgeClass(row.nutritionEnabled)}>
                        {formatNutritionCohortStatus(row.nutritionEnabled)}
                      </span>
                      <form action={setNutritionEnabledAction}>
                        <input type="hidden" name="studentId" value={row.studentId} />
                        <input type="hidden" name="redirectTo" value={redirectTo} />
                        <input type="hidden" name="enabled" value={row.nutritionEnabled ? "false" : "true"} />
                        <FormActionButton className="admin-button admin-button-secondary admin-button-compact" pendingText="…">
                          {row.nutritionEnabled ? "Выключить" : "Включить"}
                        </FormActionButton>
                      </form>
                    </div>
                  </td>
                  <td>{row.currentWeightKg ?? "—"}</td>
                  <td>{row.trackingApp ?? "—"}</td>
                  <td>
                    <span className={getStatusBadgeClass(row.lastReportStatus)}>
                      {formatNutritionStatus(row.lastReportStatus, "report")}
                    </span>
                  </td>
                  <td>{row.parsedDays}</td>
                  <td>
                    <span className={getStatusBadgeClass(row.lastAnalysisStatus)}>
                      {formatNutritionStatus(row.lastAnalysisStatus, "analysis")}
                    </span>
                  </td>
                  <td>
                    <span className={getBadgeClass(!row.hasSafetyFlag)}>
                      {formatNutritionSafetyFlag(row.hasSafetyFlag)}
                    </span>
                  </td>
                  <td>{formatNutritionNextAction(row.nextAction)}</td>
                  <td>
                    <Link className="admin-button admin-button-secondary" href={`/admin/coach-os/nutrition/${row.studentId}`}>
                      Открыть
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
