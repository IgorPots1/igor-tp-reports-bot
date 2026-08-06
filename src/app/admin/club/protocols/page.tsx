import { isClubAdminEnabled, listClubProtocolPending } from "@/features/club-admin/repository";
import FormActionButton from "@/app/admin/FormActionButton";
import { getSingleSearchParam } from "@/app/admin/lib";
import { confirmProtocolMatchAction, rejectProtocolMatchAction, confirmProtocolGroupAction } from "@/app/admin/club/actions";

export const dynamic = "force-dynamic";

function fmt(sec: number | null): string {
  if (sec == null) return "?";
  const t = Math.round(sec);
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}
function km(v: number | null): string {
  return v == null ? "?км" : `${v} км`;
}

export default async function ClubProtocolsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!isClubAdminEnabled()) {
    return <section className="admin-section"><div className="admin-alert admin-alert-warning">Раздел выключен.</div></section>;
  }
  const sp = await searchParams;
  const notice = getSingleSearchParam(sp.notice);
  const error = getSingleSearchParam(sp.error);
  const selfPath = "/admin/club/protocols";
  const pending = await listClubProtocolPending();

  // Group by RACE (event + date) so the coach reviews one event with all our finishers at once.
  type Row = (typeof pending)[number];
  const flagged = (r: Row): boolean => r.distanceDoubtful || r.nameUnrecognized || r.weakName;
  const groups = new Map<string, { event: string; date: string; rows: Row[] }>();
  for (const p of pending) {
    const event = p.protocolEvent && p.protocolEvent.trim() ? p.protocolEvent : "(без названия события)";
    const key = `${event}||${p.raceDate}`;
    const g = groups.get(key) ?? { event, date: p.raceDate, rows: [] };
    g.rows.push(p);
    groups.set(key, g);
  }
  // Confidence sort: races with any doubt on TOP (review first), clean races below (batch-confirm fast).
  const list = [...groups.values()]
    .map((g) => ({ ...g, flags: g.rows.filter(flagged).length }))
    .sort((a, b) => b.flags - a.flags || (a.date < b.date ? 1 : -1));

  return (
    <section className="admin-section">
      <div className="admin-section-header">
        <h1>Очередь протоколов · {pending.length} рез. в {list.length} гонках</h1>
        <p className="admin-section-subtitle">Сгруппировано по гонке — одно событие, все наши финишёры рядом. Сверху те, где есть сомнения; ниже — очевидные (подтверждай всю гонку разом). Подтверждённое и отклонённое уходит из очереди навсегда. Пополняется каждую неделю probeg-синком.</p>
      </div>
      {notice ? <div className="admin-alert admin-alert-success">{notice}</div> : null}
      {error ? <div className="admin-alert admin-alert-warning">{error}</div> : null}

      {pending.length === 0 ? (
        <div className="admin-card" style={{ marginTop: 12 }}><span className="admin-summary-label">Очередь пуста (или таблица club_protocol_pending не применена).</span></div>
      ) : (
        list.map((g) => (
          <div key={`${g.event}||${g.date}`} className="admin-card" style={{ marginTop: 12 }}>
            <div className="admin-badge-row" style={{ gap: 8, alignItems: "baseline" }}>
              <strong>{g.event}</strong>
              <span className="admin-badge admin-badge-muted">{g.date}</span>
              <span className="admin-badge admin-badge-muted">наших: {g.rows.length}</span>
              {g.flags > 0
                ? <span className="admin-badge admin-badge-warning">требуют внимания: {g.flags}</span>
                : <span className="admin-badge admin-badge-muted">без флагов</span>}
            </div>

            <div className="admin-table-wrap" style={{ marginTop: 8 }}>
              <table className="admin-table admin-table-compact">
                <thead><tr><th>Ученик</th><th>Наше (тренировка)</th><th>Протокол (probeg)</th><th style={{ width: 1 }}></th></tr></thead>
                <tbody>
                  {g.rows.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <strong>{p.studentName}</strong>
                        {p.distanceDoubtful ? <div><span className="admin-badge admin-badge-warning">дистанция?</span></div> : null}
                        {p.nameUnrecognized ? <div><span className="admin-badge admin-badge-warning">имя не распозналось</span></div> : null}
                        {p.weakName ? <div><span className="admin-badge admin-badge-warning">без фамилии</span></div> : null}
                      </td>
                      <td>{km(p.ourDistanceKm)} · <strong>{fmt(p.ourSeconds)}</strong>{p.ourTitle ? <div className="admin-summary-label">{p.ourTitle}</div> : null}</td>
                      <td>
                        {km(p.protocolDistanceKm)} · <strong>{fmt(p.protocolSeconds)}</strong>{p.protocolPlace ? ` · место ${p.protocolPlace}` : ""}
                        <div className="admin-summary-label">{p.protocolName ?? "имя не распозналось"}{p.protocolCity ? ` · ${p.protocolCity}` : ""}{p.protocolUrl ? <> · <a href={p.protocolUrl} target="_blank" rel="noreferrer">протокол</a></> : null}</div>
                      </td>
                      <td>
                        <div style={{ display: "flex", gap: 6 }}>
                          <form action={confirmProtocolMatchAction}>
                            <input type="hidden" name="redirectTo" value={selfPath} />
                            <input type="hidden" name="pendingId" value={p.id} />
                            <FormActionButton className="admin-button admin-button-primary admin-button-small" confirmMessage={`Привязать ${p.studentName}: ${km(p.protocolDistanceKm)} ${fmt(p.protocolSeconds)}?`} pendingText="…">✓</FormActionButton>
                          </form>
                          <form action={rejectProtocolMatchAction}>
                            <input type="hidden" name="redirectTo" value={selfPath} />
                            <input type="hidden" name="pendingId" value={p.id} />
                            <FormActionButton className="admin-button admin-button-danger admin-button-small" confirmMessage="Отклонить (больше не предлагать)?" pendingText="…">✕</FormActionButton>
                          </form>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ marginTop: 8 }}>
              <form action={confirmProtocolGroupAction}>
                <input type="hidden" name="redirectTo" value={selfPath} />
                <input type="hidden" name="pendingIds" value={g.rows.map((r) => r.id).join(",")} />
                <FormActionButton className="admin-button admin-button-primary admin-button-small" confirmMessage={`Привязать все ${g.rows.length} результатов гонки «${g.event}» (${g.date})?`} pendingText="…">Подтвердить всю гонку ({g.rows.length})</FormActionButton>
              </form>
            </div>
          </div>
        ))
      )}
    </section>
  );
}
