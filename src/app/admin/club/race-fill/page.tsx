import { isClubAdminEnabled, getClubRaceFillPlan, DISTANCE_LABELS } from "@/features/club-admin/repository";
import FormActionButton from "@/app/admin/FormActionButton";
import { getSingleSearchParam } from "@/app/admin/lib";
import { applyRaceFillRecoveryAction, confirmRaceResultAction } from "@/app/admin/club/actions";
import type { RecordDistanceKey } from "@/features/club/records";

export const dynamic = "force-dynamic";

const KEYS: RecordDistanceKey[] = ["5k", "10k", "21k", "42k"];
const REASON_LABEL: Record<string, string> = {
  no_workout: "нет завершённого бега в этот день",
  nonstandard_distance: "нестандартная дистанция",
};

export default async function ClubRaceFillPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!isClubAdminEnabled()) {
    return <section className="admin-section"><div className="admin-alert admin-alert-warning">Раздел выключен.</div></section>;
  }
  const sp = await searchParams;
  const notice = getSingleSearchParam(sp.notice);
  const error = getSingleSearchParam(sp.error);
  const selfPath = "/admin/club/race-fill";
  const plan = await getClubRaceFillPlan();
  const toRecover = plan.fillable.filter((r) => !r.alreadyHasCoach);

  return (
    <section className="admin-section">
      <div className="admin-section-header">
        <h1>Дотяжка гонок</h1>
        <p className="admin-section-subtitle">Восстановление гонок из race_events по времени из сводки тренировки того дня (записывается как coach_confirmed, откат в «Ревизии результатов»). Ниже - те, что автоматически не вытянуть: введи вручную.</p>
      </div>
      {notice ? <div className="admin-alert admin-alert-success">{notice}</div> : null}
      {error ? <div className="admin-alert admin-alert-warning">{error}</div> : null}

      <div className="admin-card" style={{ marginTop: 12 }}>
        <div className="admin-badge-row">
          <strong>Восстановимо автоматически: {toRecover.length}</strong>
          {plan.fillable.length - toRecover.length > 0 ? <span className="admin-badge admin-badge-muted">уже подтверждено: {plan.fillable.length - toRecover.length}</span> : null}
        </div>
        <p className="admin-section-subtitle" style={{ margin: "6px 0" }}>Запишет {toRecover.length} записей coach_confirmed (по одной на ученика и дистанцию, самое быстрое время). Существующие тренерские записи не трогает.</p>
        <form action={applyRaceFillRecoveryAction}>
          <input type="hidden" name="redirectTo" value={selfPath} />
          <FormActionButton className="admin-button admin-button-primary admin-button-small" confirmMessage={`Записать ${toRecover.length} гонок как coach_confirmed?`} pendingText="…">Восстановить {toRecover.length}</FormActionButton>
        </form>
      </div>

      {toRecover.length > 0 ? (
        <>
          <h2 className="admin-section-subtitle">Что будет записано ({toRecover.length})</h2>
          <div className="admin-table-wrap">
            <table className="admin-table admin-table-compact">
              <thead><tr><th>Ученик</th><th>Дистанция</th><th>Время</th><th>Дата</th><th>Забег</th></tr></thead>
              <tbody>
                {toRecover.map((r, i) => (
                  <tr key={`${r.studentId}-${r.distanceKey}-${i}`}>
                    <td>{r.name}</td>
                    <td>{DISTANCE_LABELS[r.distanceKey]}</td>
                    <td>{r.timeLabel}</td>
                    <td>{r.date}</td>
                    <td style={{ maxWidth: 220, whiteSpace: "normal" }}>{r.raceName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      <h2 className="admin-section-subtitle">Ручной ввод - недостижимые ({plan.unreachable.length})</h2>
      <div className="admin-table-wrap">
        <table className="admin-table admin-table-compact">
          <thead><tr><th>Ученик</th><th>Дата</th><th>Забег</th><th>Дистанция (raw)</th><th>Причина</th><th>Ввод</th></tr></thead>
          <tbody>
            {plan.unreachable.length === 0 ? <tr><td colSpan={6} className="admin-empty-cell">Нет</td></tr> : null}
            {plan.unreachable.map((u, i) => (
              <tr key={`${u.studentId}-${u.date}-${i}`}>
                <td>{u.name}</td>
                <td style={{ whiteSpace: "nowrap" }}>{u.date}</td>
                <td style={{ maxWidth: 180, whiteSpace: "normal" }}>{u.title}</td>
                <td>{u.distanceRaw ?? "-"}</td>
                <td>{REASON_LABEL[u.reason] ?? u.reason}</td>
                <td>
                  <form action={confirmRaceResultAction} className="admin-form-inline" style={{ gap: 6, flexWrap: "wrap" }}>
                    <input type="hidden" name="redirectTo" value={selfPath} />
                    <input type="hidden" name="studentId" value={u.studentId} />
                    <input type="hidden" name="date" value={u.date} />
                    <input type="hidden" name="raceName" value={u.title} />
                    <select className="admin-input" name="distanceKey" defaultValue="10k" style={{ width: 90 }}>
                      {KEYS.map((k) => <option key={k} value={k}>{DISTANCE_LABELS[k]}</option>)}
                    </select>
                    <input className="admin-input" name="time" placeholder="чч:мм:сс" style={{ width: 100 }} />
                    <FormActionButton className="admin-button admin-button-small" pendingText="…">Подтвердить</FormActionButton>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
