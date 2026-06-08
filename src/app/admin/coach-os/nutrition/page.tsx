import Link from "next/link";

import { getSingleSearchParam } from "@/app/admin/lib";
import { listNutritionAdminDashboardRows } from "@/features/nutrition/admin";

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
    <section className="admin-section">
      <div className="admin-section-header">
        <div>
          <h2>Coach OS Nutrition</h2>
          <p className="admin-muted">
            Admin-only nutrition workflow for weekly review drafts. No auto-send paths.
          </p>
        </div>
        <span className="admin-badge admin-badge-outline">Copy-only workflow</span>
      </div>

      <div className="admin-summary-grid">
        <article className="admin-card admin-summary-card">
          <span className="admin-summary-label">Students</span>
          <strong className="admin-summary-value">{rows.length}</strong>
        </article>
        <article className="admin-card admin-summary-card">
          <span className="admin-summary-label">Nutrition enabled</span>
          <strong className="admin-summary-value">{enabledCount}</strong>
        </article>
        <article className="admin-card admin-summary-card">
          <span className="admin-summary-label">Ready for analysis</span>
          <strong className="admin-summary-value">{readyCount}</strong>
        </article>
        <article className="admin-card admin-summary-card">
          <span className="admin-summary-label">Needs review</span>
          <strong className="admin-summary-value">{needsReviewCount}</strong>
        </article>
        <article className="admin-card admin-summary-card">
          <span className="admin-summary-label">Safety blocked</span>
          <strong className="admin-summary-value">{blockedCount}</strong>
        </article>
      </div>

      <div className="admin-card">
        <div className="admin-tabs">
          <Link className={`admin-tab ${active ? "admin-tab-active" : ""}`} href="/admin/coach-os/nutrition?active=1">
            Active
          </Link>
          <Link
            className={`admin-tab ${enabledNutrition ? "admin-tab-active" : ""}`}
            href="/admin/coach-os/nutrition?enabled=1"
          >
            Enabled nutrition
          </Link>
          <Link className={`admin-tab ${safetyOnly ? "admin-tab-active" : ""}`} href="/admin/coach-os/nutrition?safety=1">
            Safety blocked
          </Link>
          <Link className="admin-tab" href="/admin/coach-os/nutrition">
            Reset
          </Link>
        </div>
      </div>

      <div className="admin-card admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Student</th>
              <th>Enabled</th>
              <th>Weight</th>
              <th>Tracking app</th>
              <th>Last report</th>
              <th>Days parsed</th>
              <th>Last analysis</th>
              <th>Safety</th>
              <th>Next action</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td className="admin-empty-cell" colSpan={10}>
                  No students for selected filters.
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
                    <span className={getBadgeClass(row.nutritionEnabled)}>{row.nutritionEnabled ? "Yes" : "No"}</span>
                  </td>
                  <td>{row.currentWeightKg ?? "—"}</td>
                  <td>{row.trackingApp ?? "—"}</td>
                  <td>
                    <span className={getStatusBadgeClass(row.lastReportStatus)}>{row.lastReportStatus ?? "—"}</span>
                  </td>
                  <td>{row.parsedDays}</td>
                  <td>
                    <span className={getStatusBadgeClass(row.lastAnalysisStatus)}>{row.lastAnalysisStatus ?? "—"}</span>
                  </td>
                  <td>
                    <span className={getBadgeClass(!row.hasSafetyFlag)}>
                      {row.hasSafetyFlag ? "Blocked" : "Clear"}
                    </span>
                  </td>
                  <td>{row.nextAction}</td>
                  <td>
                    <Link className="admin-button admin-button-secondary" href={`/admin/coach-os/nutrition/${row.studentId}`}>
                      Open card
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
