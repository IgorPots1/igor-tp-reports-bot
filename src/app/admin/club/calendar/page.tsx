import { isClubAdminEnabled, listClubCalendarAdmin, type ClubCalendarAdminEntry } from "@/features/club-admin/repository";
import FormActionButton from "@/app/admin/FormActionButton";
import { getSingleSearchParam } from "@/app/admin/lib";
import { setCalendarEntryStatusAction, approveAllPendingCalendarAction } from "@/app/admin/club/actions";

export const dynamic = "force-dynamic";

const KIND_ICON: Record<ClubCalendarAdminEntry["kind"], string> = { day_off: "🛌", preference: "🎯", note: "📝", race: "🏁" };
const STATUS_LABEL: Record<string, string> = { pending: "на подтв.", approved: "подтв.", rejected: "отклонён", applied: "в TP" };

function ruDate(iso: string): string {
  const months = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/u);
  if (!m) return iso;
  return `${Number(m[3])} ${months[Number(m[2]) - 1] ?? ""}`;
}

export default async function ClubCalendarAdminPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!isClubAdminEnabled()) {
    return <section className="admin-section"><div className="admin-alert admin-alert-warning">Раздел выключен.</div></section>;
  }
  const sp = await searchParams;
  const notice = getSingleSearchParam(sp.notice);
  const error = getSingleSearchParam(sp.error);
  const selfPath = "/admin/club/calendar";
  const entries = await listClubCalendarAdmin();

  // Group by date for the 45-day forward view.
  const byDate = new Map<string, ClubCalendarAdminEntry[]>();
  for (const e of entries) {
    const list = byDate.get(e.date) ?? [];
    list.push(e);
    byDate.set(e.date, list);
  }
  const dates = [...byDate.keys()].sort();
  const pendingCount = entries.filter((e) => e.status === "pending").length;

  return (
    <section className="admin-section">
      <div className="admin-section-header">
        <h1>Календарь клуба · 45 дней</h1>
        <p className="admin-section-subtitle">Заявки учеников по дням: выходные, пожелания по типу, заметки, забеги. Подтверждение здесь; в TrainingPeaks запись — отдельной фазой (Phase 11).</p>
      </div>
      {notice ? <div className="admin-alert admin-alert-success">{notice}</div> : null}
      {error ? <div className="admin-alert admin-alert-warning">{error}</div> : null}

      <div className="admin-card" style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 12 }}>
        <strong>На подтверждении: {pendingCount}</strong>
        {pendingCount > 0 ? (
          <form action={approveAllPendingCalendarAction}>
            <input type="hidden" name="redirectTo" value={selfPath} />
            <FormActionButton className="admin-button admin-button-primary admin-button-small" confirmMessage={`Подтвердить все ${pendingCount} заявок?`} pendingText="…">Подтвердить все</FormActionButton>
          </form>
        ) : null}
      </div>

      {dates.length === 0 ? (
        <div className="admin-card" style={{ marginTop: 12 }}><span className="admin-summary-label">Заявок на ближайшие 45 дней нет (или миграция club_calendar_entries не применена).</span></div>
      ) : (
        dates.map((date) => (
          <div key={date} className="admin-card" style={{ marginTop: 12 }}>
            <div className="admin-badge-row"><strong>{ruDate(date)}</strong></div>
            <div className="admin-table-wrap">
              <table className="admin-table admin-table-compact">
                <thead><tr><th>Ученик</th><th>Заявка</th><th>Статус</th><th>Действия</th></tr></thead>
                <tbody>
                  {byDate.get(date)!.map((e) => (
                    <tr key={e.id}>
                      <td>{e.studentName}</td>
                      <td>{KIND_ICON[e.kind]} {e.detail}</td>
                      <td><span className={`admin-badge ${e.status === "approved" || e.status === "applied" ? "admin-badge-accent" : e.status === "rejected" ? "admin-badge-warning" : "admin-badge-muted"}`}>{STATUS_LABEL[e.status] ?? e.status}</span></td>
                      <td>
                        {e.status === "pending" ? (
                          <div style={{ display: "flex", gap: 6 }}>
                            <form action={setCalendarEntryStatusAction}>
                              <input type="hidden" name="redirectTo" value={selfPath} />
                              <input type="hidden" name="entryId" value={e.id} />
                              <input type="hidden" name="status" value="approved" />
                              <FormActionButton className="admin-button admin-button-primary admin-button-small" pendingText="…">✓</FormActionButton>
                            </form>
                            <form action={setCalendarEntryStatusAction}>
                              <input type="hidden" name="redirectTo" value={selfPath} />
                              <input type="hidden" name="entryId" value={e.id} />
                              <input type="hidden" name="status" value="rejected" />
                              <FormActionButton className="admin-button admin-button-danger admin-button-small" pendingText="…">✕</FormActionButton>
                            </form>
                          </div>
                        ) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))
      )}
    </section>
  );
}
