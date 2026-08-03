import { isClubAdminEnabled, listClubUpcomingRequests, type ClubUpcomingRequest } from "@/features/club-admin/repository";
import { isClubNotesAutoApproveEnabled, isClubDayoffAutoApproveEnabled } from "@/features/club/constants";

export const dynamic = "force-dynamic";

const KIND_ICON: Record<ClubUpcomingRequest["kind"], string> = { day_off: "🛌", preference: "🎯", note: "📝", race: "🏁" };
const STATUS_LABEL: Record<string, string> = { pending: "на подтв.", approved: "подтв.", rejected: "отклонён", applied: "в TP" };
const ENTITY_LABEL: Record<string, string> = { event: "Event", availability: "Availability", note: "Note", workout: "Workout" };

function ruDate(iso: string): string {
  const months = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/u);
  if (!m) return iso;
  return `${Number(m[3])} ${months[Number(m[2]) - 1] ?? ""}`;
}

export default async function ClubUpcomingPage() {
  if (!isClubAdminEnabled()) {
    return <section className="admin-section"><div className="admin-alert admin-alert-warning">Раздел выключен.</div></section>;
  }
  const entries = await listClubUpcomingRequests(45);

  const byDate = new Map<string, ClubUpcomingRequest[]>();
  for (const e of entries) {
    const list = byDate.get(e.date) ?? [];
    list.push(e);
    byDate.set(e.date, list);
  }
  const dates = [...byDate.keys()].sort();
  const pendingCount = entries.filter((e) => e.status === "pending").length;
  const sentCount = entries.filter((e) => e.sentToTp).length;
  const conflictCount = entries.filter((e) => e.plannedConflict && e.kind === "day_off").length;

  // Auto-approve flags live in TWO runtimes: Vercel (this admin page + request CREATION via the
  // mini-app) and the Mac runner (.env.local, TP sending). Requests are CREATED on Vercel, so
  // auto-approve must be set HERE. This page reads Vercel's env — so if a flag is off here while
  // matching requests pile up in pending, the flag was set only on the runner (the mismatch Igor hit).
  const pendingSoft = entries.filter((e) => e.status === "pending" && (e.kind === "note" || e.kind === "preference")).length;
  const pendingDayoff = entries.filter((e) => e.status === "pending" && e.kind === "day_off").length;
  const autoApproveGaps: string[] = [];
  if (pendingSoft > 0 && !isClubNotesAutoApproveEnabled()) autoApproveGaps.push("заметки и пожелания (CLUB_NOTES_AUTO_APPROVE)");
  if (pendingDayoff > 0 && !isClubDayoffAutoApproveEnabled()) autoApproveGaps.push("выходные (CLUB_DAYOFF_AUTO_APPROVE)");

  return (
    <section className="admin-section">
      <div className="admin-section-header">
        <h1>Все заявки клуба · 45 дней</h1>
        <p className="admin-section-subtitle">Всё, что отметили ученики: старты, выходные, заметки, пожелания - одним списком. Кто, когда, что, ушло ли в TP. Действия (подтвердить/отклонить) - на «Календаре»; здесь только просмотр. Жёлтым - конфликт: выходной на день с плановой тренировкой.</p>
      </div>

      <div className="admin-card" style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
        <span><strong>Всего:</strong> {entries.length}</span>
        <span className={pendingCount > 0 ? "admin-badge admin-badge-warning" : "admin-badge admin-badge-muted"}>на ручном подтверждении: {pendingCount}</span>
        <span><strong>Ушло в TP:</strong> {sentCount}</span>
        {conflictCount > 0 ? <span className="admin-badge admin-badge-warning">конфликтов с тренировкой: {conflictCount}</span> : null}
      </div>

      {autoApproveGaps.length > 0 ? (
        <div className="admin-alert admin-alert-warning" style={{ marginTop: 12 }}>
          <strong>⚠ Авто-подтверждение не выставлено на Vercel.</strong> Флаг читается в ДВУХ рантаймах: на Vercel (где ученики создают заявки) и у раннера (<code>.env.local</code>, отправка в TP). Заявки создаются на Vercel — значит авто-подтверждение должно стоять именно там. Сейчас на этой стороне (Vercel) выключено: {autoApproveGaps.join(", ")}. Пока не выставишь флаг в Vercel и не передеплоишь, новые заявки будут копиться в pending; старые подтверди вручную на «Календаре».
        </div>
      ) : null}

      {dates.length === 0 ? (
        <div className="admin-card" style={{ marginTop: 12 }}><span className="admin-summary-label">Заявок на ближайшие 45 дней нет.</span></div>
      ) : (
        dates.map((date) => (
          <div key={date} className="admin-card" style={{ marginTop: 12 }}>
            <div className="admin-badge-row"><strong>{ruDate(date)}</strong></div>
            <div className="admin-table-wrap">
              <table className="admin-table admin-table-compact">
                <thead><tr><th>Ученик</th><th>Заявка</th><th>Статус</th><th>В TP</th></tr></thead>
                <tbody>
                  {byDate.get(date)!.map((e) => {
                    const conflict = e.plannedConflict && e.kind === "day_off";
                    return (
                      <tr key={e.id} style={conflict ? { background: "rgba(240,180,20,0.12)" } : undefined}>
                        <td>{e.studentName}</td>
                        <td>
                          {KIND_ICON[e.kind]} {e.detail}
                          {e.reason ? <span className="admin-badge admin-badge-muted" style={{ marginLeft: 6 }}>{e.reason}</span> : null}
                          {conflict ? <span className="admin-badge admin-badge-warning" style={{ marginLeft: 6 }}>⚠ плановая тренировка в этот день</span> : null}
                        </td>
                        <td><span className={`admin-badge ${e.status === "approved" || e.status === "applied" ? "admin-badge-accent" : e.status === "rejected" ? "admin-badge-warning" : "admin-badge-muted"}`}>{STATUS_LABEL[e.status] ?? e.status}</span></td>
                        <td>{e.sentToTp ? <span className="admin-badge admin-badge-accent">{ENTITY_LABEL[e.appliedEntityType ?? ""] ?? e.appliedEntityType ?? "да"}</span> : <span className="admin-summary-label">-</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ))
      )}
    </section>
  );
}
