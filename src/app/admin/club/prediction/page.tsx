import { isClubAdminEnabled, listClubPredictionRoster } from "@/features/club-admin/repository";
import FormActionButton from "@/app/admin/FormActionButton";
import { getSingleSearchParam } from "@/app/admin/lib";
import { setClubPredictionVisibleAction } from "@/app/admin/club/actions";

export const dynamic = "force-dynamic";

export default async function ClubPredictionAdminPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!isClubAdminEnabled()) {
    return <section className="admin-section"><div className="admin-alert admin-alert-warning">Раздел выключен.</div></section>;
  }
  const sp = await searchParams;
  const notice = getSingleSearchParam(sp.notice);
  const error = getSingleSearchParam(sp.error);
  const selfPath = "/admin/club/prediction";
  const roster = await listClubPredictionRoster();
  const hidden = roster.filter((r) => !r.predictionVisible).length;

  return (
    <section className="admin-section">
      <div className="admin-section-header">
        <h1>Видимость прогноза</h1>
        <p className="admin-section-subtitle">Прогноз старта показывается ученику, только когда объявлен предстоящий старт и есть данные гонок. Здесь можно скрыть прогноз для конкретного ученика. По умолчанию показан. Скрыто сейчас: {hidden}.</p>
      </div>
      {notice ? <div className="admin-alert admin-alert-success">{notice}</div> : null}
      {error ? <div className="admin-alert admin-alert-warning">{error}</div> : null}

      <div className="admin-table-wrap">
        <table className="admin-table admin-table-compact">
          <thead><tr><th>Ученик</th><th>Прогноз</th><th>Действие</th></tr></thead>
          <tbody>
            {roster.length === 0 ? <tr><td colSpan={3} className="admin-empty-cell">Нет активных учеников</td></tr> : null}
            {roster.map((r) => (
              <tr key={r.studentId}>
                <td>{r.name}</td>
                <td>{r.predictionVisible ? "показан" : "скрыт"}</td>
                <td>
                  <form action={setClubPredictionVisibleAction}>
                    <input type="hidden" name="redirectTo" value={selfPath} />
                    <input type="hidden" name="studentId" value={r.studentId} />
                    <input type="hidden" name="visible" value={r.predictionVisible ? "false" : "true"} />
                    <FormActionButton className="admin-button admin-button-small" pendingText="…">{r.predictionVisible ? "Скрыть" : "Показать"}</FormActionButton>
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
