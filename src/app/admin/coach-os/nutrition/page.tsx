import Link from "next/link";

import { getSingleSearchParam } from "@/app/admin/lib";
import { listNutritionAdminDashboardRows } from "@/features/nutrition/admin";
import {
  formatNutritionNextAction,
  formatNutritionSafetyFlag,
  formatNutritionStatus,
  formatNutritionYesNo,
} from "@/features/nutrition/admin-labels";

type NutritionDashboardPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function asBoolean(value: string | null | undefined): boolean {
  return value === "1" || value === "true" || value === "yes";
}

function getBadgeClass(ok: boolean): string {
  return ok ? "admin-badge admin-badge-success" : "admin-badge admin-badge-muted";
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
  const active = asBoolean(getSingleSearchParam(resolved.active));
  const enabledNutrition = asBoolean(getSingleSearchParam(resolved.enabled));
  const safetyOnly = asBoolean(getSingleSearchParam(resolved.safety));

  const rows = await listNutritionAdminDashboardRows({
    active,
    enabledNutrition,
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
            Админка недельных обзоров питания. Только копирование черновика, без автоотправки.
          </p>
        </div>
        <span className="admin-badge admin-badge-outline">Только копия</span>
      </div>

      <div className="admin-summary-grid admin-summary-grid-compact">
        <article className="admin-card admin-summary-card">
          <span className="admin-summary-label">Ученики</span>
          <strong className="admin-summary-value">{rows.length}</strong>
        </article>
        <article className="admin-card admin-summary-card">
          <span className="admin-summary-label">Питание вкл.</span>
          <strong className="admin-summary-value">{enabledCount}</strong>
        </article>
        <article className="admin-card admin-summary-card">
          <span className="admin-summary-label">Готовы к анализу</span>
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
          <Link className={`admin-tab ${active ? "admin-tab-active" : ""}`} href="/admin/coach-os/nutrition?active=1">
            Активные
          </Link>
          <Link
            className={`admin-tab ${enabledNutrition ? "admin-tab-active" : ""}`}
            href="/admin/coach-os/nutrition?enabled=1"
          >
            Питание вкл.
          </Link>
          <Link className={`admin-tab ${safetyOnly ? "admin-tab-active" : ""}`} href="/admin/coach-os/nutrition?safety=1">
            Блок безопасности
          </Link>
          <Link className="admin-tab" href="/admin/coach-os/nutrition">
            Сбросить
          </Link>
        </div>
      </div>

      <div className="admin-card admin-card-compact admin-table-wrap">
        <table className="admin-table admin-table-compact">
          <thead>
            <tr>
              <th>Ученик</th>
              <th>Вкл.</th>
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
                    <span className={getBadgeClass(row.nutritionEnabled)}>
                      {formatNutritionYesNo(row.nutritionEnabled)}
                    </span>
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
