import { getSingleSearchParam } from "@/app/admin/lib";
import FormActionButton from "@/app/admin/FormActionButton";
import { isClubAdminEnabled, listClubQueue } from "@/features/club-admin/repository";
import { setRequestStatusAction, batchApproveRacesAction } from "@/app/admin/club/actions";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<string, string> = { race: "Старт", dayoff: "Выходной", wish: "Пожелание" };

export default async function ClubQueuePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!isClubAdminEnabled()) {
    return <section className="admin-section"><div className="admin-alert admin-alert-warning">Раздел выключен.</div></section>;
  }
  const sp = await searchParams;
  const notice = getSingleSearchParam(sp.notice);
  const error = getSingleSearchParam(sp.error);
  const kind = getSingleSearchParam(sp.kind) ?? "all";
  const status = getSingleSearchParam(sp.status) ?? "all";
  const selfPath = "/admin/club/queue";

  const items = await listClubQueue({ kind, status });
  const actionable = items.filter((i) => i.actionable);

  return (
    <section className="admin-section">
      <div className="admin-section-header">
        <h1>Очередь заявок</h1>
        <p className="admin-section-subtitle">Старты, выходные, пожелания. Подтверждение меняет статус в Supabase. Исполнение в TrainingPeaks - отдельная фаза.</p>
      </div>

      {notice ? <div className="admin-alert admin-alert-success">{notice}</div> : null}
      {error ? <div className="admin-alert admin-alert-error">{error}</div> : null}

      <form method="get" className="admin-filters">
        <label className="admin-field">Тип
          <select className="admin-input" name="kind" defaultValue={kind}>
            <option value="all">все</option><option value="race">старты</option><option value="dayoff">выходные</option><option value="wish">пожелания</option>
          </select>
        </label>
        <label className="admin-field">Статус
          <select className="admin-input" name="status" defaultValue={status}>
            <option value="all">все</option><option value="declared">заявлен</option><option value="pending">на подтверждении</option><option value="approved">подтверждён</option><option value="rejected">отклонён</option>
          </select>
        </label>
        <button className="admin-button admin-button-secondary" type="submit">Фильтр</button>
      </form>

      {actionable.some((i) => i.kind === "race") ? (
        <form action={batchApproveRacesAction} id="batch-races" style={{ marginTop: 8 }}>
          <input type="hidden" name="redirectTo" value={selfPath} />
          <FormActionButton className="admin-button admin-button-primary admin-button-small" confirmMessage="Подтвердить все отмеченные старты?" pendingText="…">Подтвердить отмеченные старты</FormActionButton>
        </form>
      ) : null}

      <div className="admin-table-wrap" style={{ marginTop: 8 }}>
        <table className="admin-table admin-table-compact">
          <thead><tr><th></th><th>Тип</th><th>Заявка</th><th>Статус</th><th>Действия</th></tr></thead>
          <tbody>
            {items.length === 0 ? <tr><td colSpan={5} className="admin-empty-cell">Заявок нет</td></tr> : null}
            {items.map((i) => (
              <tr key={`${i.kind}-${i.id}`}>
                <td>{i.kind === "race" && i.actionable ? <input type="checkbox" name="raceIds" value={i.id} form="batch-races" /> : null}</td>
                <td>{KIND_LABEL[i.kind]}</td>
                <td>{i.title}<div className="admin-summary-label">{i.subtitle}</div></td>
                <td>{i.status}</td>
                <td>
                  {i.actionable ? (
                    <div className="admin-inline-actions">
                      <form action={setRequestStatusAction}>
                        <input type="hidden" name="redirectTo" value={selfPath} />
                        <input type="hidden" name="kind" value={i.kind} />
                        <input type="hidden" name="id" value={i.id} />
                        <input type="hidden" name="status" value="approved" />
                        <FormActionButton className="admin-button admin-button-small" pendingText="…">Подтвердить</FormActionButton>
                      </form>
                      <form action={setRequestStatusAction}>
                        <input type="hidden" name="redirectTo" value={selfPath} />
                        <input type="hidden" name="kind" value={i.kind} />
                        <input type="hidden" name="id" value={i.id} />
                        <input type="hidden" name="status" value="rejected" />
                        <FormActionButton className="admin-button admin-button-danger admin-button-small" confirmMessage="Отклонить заявку?" pendingText="…">Отклонить</FormActionButton>
                      </form>
                    </div>
                  ) : <span className="admin-badge admin-badge-muted">-</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
