import { isClubAdminEnabled, listClubProtocolPending } from "@/features/club-admin/repository";
import FormActionButton from "@/app/admin/FormActionButton";
import { getSingleSearchParam } from "@/app/admin/lib";
import { confirmProtocolMatchAction, rejectProtocolMatchAction } from "@/app/admin/club/actions";

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

  return (
    <section className="admin-section">
      <div className="admin-section-header">
        <h1>Очередь протоколов · {pending.length}</h1>
        <p className="admin-section-subtitle">Вероятные привязки к официальным протоколам probeg. Обе стороны рядом. Подтвердить - пишет рекорд (если дистанция стандартная), журнал и запоминает написание имени (человек больше не вернётся в очередь). Отклонить - больше не предлагается.</p>
      </div>
      {notice ? <div className="admin-alert admin-alert-success">{notice}</div> : null}
      {error ? <div className="admin-alert admin-alert-warning">{error}</div> : null}

      {pending.length === 0 ? (
        <div className="admin-card" style={{ marginTop: 12 }}><span className="admin-summary-label">Очередь пуста (или таблица club_protocol_pending не применена).</span></div>
      ) : (
        pending.map((p) => (
          <div key={p.id} className="admin-card" style={{ marginTop: 12 }}>
            <div className="admin-badge-row" style={{ gap: 8 }}>
              <strong>{p.studentName}</strong>
              <span className="admin-badge admin-badge-muted">{p.raceDate}</span>
              {p.distanceDoubtful ? <span className="admin-badge admin-badge-warning">наша дистанция сомнительна</span> : null}
              {p.nameUnrecognized ? <span className="admin-badge admin-badge-warning">имя не распозналось</span> : null}
              {p.weakName ? <span className="admin-badge admin-badge-warning">ученик без фамилии</span> : null}
            </div>

            <div className="admin-table-wrap" style={{ marginTop: 8 }}>
              <table className="admin-table admin-table-compact">
                <thead><tr><th style={{ width: "50%" }}>Протокол (probeg)</th><th style={{ width: "50%" }}>Наше (тренировка)</th></tr></thead>
                <tbody>
                  <tr>
                    <td>
                      <div><strong>{p.protocolName ?? "имя не распозналось"}</strong>{p.protocolPlace ? ` · место ${p.protocolPlace}` : ""}</div>
                      <div>{p.protocolEvent ?? "-"}{p.protocolCity ? ` · ${p.protocolCity}` : ""}</div>
                      <div>{p.raceDate} · {km(p.protocolDistanceKm)} · <strong>{fmt(p.protocolSeconds)}</strong></div>
                      {p.protocolUrl ? <div><a href={p.protocolUrl} target="_blank" rel="noreferrer">открыть протокол</a></div> : null}
                    </td>
                    <td>
                      <div>{p.ourTitle ?? "-"}</div>
                      <div>{p.raceDate} · {km(p.ourDistanceKm)} · <strong>{fmt(p.ourSeconds)}</strong></div>
                      <div className="admin-summary-label">время из сводки тренировки того дня</div>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="admin-inline-actions" style={{ marginTop: 8, display: "flex", gap: 8 }}>
              <form action={confirmProtocolMatchAction}>
                <input type="hidden" name="redirectTo" value={selfPath} />
                <input type="hidden" name="pendingId" value={p.id} />
                <FormActionButton className="admin-button admin-button-primary admin-button-small" confirmMessage={`Привязать ${p.studentName}: ${km(p.protocolDistanceKm)} ${fmt(p.protocolSeconds)}?`} pendingText="…">Подтвердить</FormActionButton>
              </form>
              <form action={rejectProtocolMatchAction}>
                <input type="hidden" name="redirectTo" value={selfPath} />
                <input type="hidden" name="pendingId" value={p.id} />
                <FormActionButton className="admin-button admin-button-danger admin-button-small" confirmMessage="Отклонить эту привязку (больше не предлагать)?" pendingText="…">Отклонить</FormActionButton>
              </form>
            </div>
          </div>
        ))
      )}
    </section>
  );
}
