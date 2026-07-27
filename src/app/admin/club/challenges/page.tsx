import { isClubAdminEnabled, listClubChallengesAdmin, type ClubChallengeAdminRow } from "@/features/club-admin/repository";
import FormActionButton from "@/app/admin/FormActionButton";
import { getSingleSearchParam } from "@/app/admin/lib";
import { createClubChallengeAction, setClubChallengeStatusAction } from "@/app/admin/club/actions";

export const dynamic = "force-dynamic";

function ruDate(iso: string): string {
  const months = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/u);
  return m ? `${Number(m[3])} ${months[Number(m[2]) - 1] ?? ""}` : iso;
}
function goalLabel(r: ClubChallengeAdminRow): string {
  return r.goalType === "km" ? `${r.goalValue} км` : `${r.goalValue} трен.`;
}

export default async function ClubChallengesAdminPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!isClubAdminEnabled()) {
    return <section className="admin-section"><div className="admin-alert admin-alert-warning">Раздел выключен.</div></section>;
  }
  const sp = await searchParams;
  const notice = getSingleSearchParam(sp.notice);
  const error = getSingleSearchParam(sp.error);
  const selfPath = "/admin/club/challenges";
  const all = await listClubChallengesAdmin();
  const active = all.filter((c) => c.status === "active");
  const history = all.filter((c) => c.status !== "active");

  return (
    <section className="admin-section">
      <div className="admin-section-header">
        <h1>Челленджи клуба</h1>
        <p className="admin-section-subtitle">Несколько активных сразу. Пока активных нет, цель клуба авто (среднее км за 4 недели). Прогресс считается по завершённым беговым тренировкам участников.</p>
      </div>
      {notice ? <div className="admin-alert admin-alert-success">{notice}</div> : null}
      {error ? <div className="admin-alert admin-alert-warning">{error}</div> : null}

      <div className="admin-card" style={{ marginTop: 12 }}>
        <strong>Новый челлендж</strong>
        <form action={createClubChallengeAction} className="admin-form-inline" style={{ gap: 8, flexWrap: "wrap", marginTop: 8 }}>
          <input type="hidden" name="redirectTo" value={selfPath} />
          <input className="admin-input" name="title" placeholder="Название" style={{ width: 200 }} />
          <select className="admin-input" name="goalType" defaultValue="km">
            <option value="km">Цель: километраж</option>
            <option value="workouts">Цель: число тренировок</option>
          </select>
          <input className="admin-input" name="goalValue" placeholder="Значение цели" style={{ width: 130 }} required />
          <label className="admin-summary-label">с <input className="admin-input" type="date" name="startsAt" required /></label>
          <label className="admin-summary-label">по <input className="admin-input" type="date" name="endsAt" required /></label>
          <select className="admin-input" name="participantScope" defaultValue="all">
            <option value="all">Весь клуб</option>
            <option value="selected">Выбранные</option>
          </select>
          <input className="admin-input" name="participantIds" placeholder="student_id через запятую (для «выбранные»)" style={{ width: 280 }} />
          <FormActionButton className="admin-button admin-button-primary admin-button-small" pendingText="…">Создать</FormActionButton>
        </form>
      </div>

      <h2 className="admin-section-subtitle">Активные ({active.length})</h2>
      <div className="admin-table-wrap">
        <table className="admin-table admin-table-compact">
          <thead><tr><th>Название</th><th>Цель</th><th>Период</th><th>Участники</th><th>Действия</th></tr></thead>
          <tbody>
            {active.length === 0 ? <tr><td colSpan={5} className="admin-empty-cell">Нет активных - работает авто-цель клуба.</td></tr> : null}
            {active.map((c) => (
              <tr key={c.id}>
                <td>{c.title}</td>
                <td>{goalLabel(c)}</td>
                <td>{ruDate(c.startsAt)} - {ruDate(c.endsAt)}</td>
                <td>{c.participantScope === "all" ? "весь клуб" : `выбрано ${c.participantCount}`}</td>
                <td>
                  <div style={{ display: "flex", gap: 6 }}>
                    <form action={setClubChallengeStatusAction}>
                      <input type="hidden" name="redirectTo" value={selfPath} />
                      <input type="hidden" name="challengeId" value={c.id} />
                      <input type="hidden" name="status" value="completed" />
                      <FormActionButton className="admin-button admin-button-small" pendingText="…">Завершить</FormActionButton>
                    </form>
                    <form action={setClubChallengeStatusAction}>
                      <input type="hidden" name="redirectTo" value={selfPath} />
                      <input type="hidden" name="challengeId" value={c.id} />
                      <input type="hidden" name="status" value="archived" />
                      <FormActionButton className="admin-button admin-button-danger admin-button-small" confirmMessage="В архив?" pendingText="…">Архив</FormActionButton>
                    </form>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="admin-section-subtitle">История ({history.length})</h2>
      <div className="admin-table-wrap">
        <table className="admin-table admin-table-compact">
          <thead><tr><th>Название</th><th>Цель</th><th>Период</th><th>Статус</th><th></th></tr></thead>
          <tbody>
            {history.length === 0 ? <tr><td colSpan={5} className="admin-empty-cell">Пусто</td></tr> : null}
            {history.map((c) => (
              <tr key={c.id}>
                <td>{c.title}</td>
                <td>{goalLabel(c)}</td>
                <td>{ruDate(c.startsAt)} - {ruDate(c.endsAt)}</td>
                <td><span className="admin-badge admin-badge-muted">{c.status === "completed" ? "завершён" : "архив"}</span></td>
                <td>
                  <form action={setClubChallengeStatusAction}>
                    <input type="hidden" name="redirectTo" value={selfPath} />
                    <input type="hidden" name="challengeId" value={c.id} />
                    <input type="hidden" name="status" value="active" />
                    <FormActionButton className="admin-button admin-button-small" pendingText="…">Вернуть в активные</FormActionButton>
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
