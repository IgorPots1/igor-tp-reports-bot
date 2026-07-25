import { getSingleSearchParam } from "@/app/admin/lib";
import FormActionButton from "@/app/admin/FormActionButton";
import { isClubAdminEnabled, listTelegramLinks, listLinkEvents } from "@/features/club-admin/repository";
import { unbindStudentAction, relinkStudentAction } from "@/app/admin/club/actions";

export const dynamic = "force-dynamic";

export default async function ClubLinksPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!isClubAdminEnabled()) {
    return <section className="admin-section"><div className="admin-alert admin-alert-warning">Раздел выключен.</div></section>;
  }
  const sp = await searchParams;
  const notice = getSingleSearchParam(sp.notice);
  const error = getSingleSearchParam(sp.error);
  const selfPath = "/admin/club/links";

  const [links, events] = await Promise.all([listTelegramLinks(), listLinkEvents()]);
  const bound = links.filter((l) => l.telegramUserId);
  const unbound = links.filter((l) => !l.telegramUserId);

  return (
    <section className="admin-section">
      <div className="admin-section-header">
        <h1>Telegram-привязки</h1>
        <p className="admin-section-subtitle">Отвязка/перепривязка — только тренером (в мини-аппе ученика запрещена). Логируется в club_link_events.</p>
      </div>

      {notice ? <div className="admin-alert admin-alert-success">{notice}</div> : null}
      {error ? <div className="admin-alert admin-alert-error">{error}</div> : null}

      <div className="admin-summary-grid">
        <div className="admin-summary-card"><div className="admin-summary-label">Привязано</div><div className="admin-summary-value">{bound.length}</div></div>
        <div className="admin-summary-card"><div className="admin-summary-label">Не привязано</div><div className="admin-summary-value">{unbound.length}</div></div>
      </div>

      <h2 className="admin-section-subtitle">Привязанные</h2>
      <div className="admin-table-wrap">
        <table className="admin-table admin-table-compact">
          <thead><tr><th>Ученик</th><th>Telegram user id</th><th>@username</th><th>Отвязка</th></tr></thead>
          <tbody>
            {bound.map((l) => (
              <tr key={l.studentId}>
                <td>{l.name}</td><td>{l.telegramUserId}</td><td>{l.username ?? "—"}</td>
                <td>
                  <form action={unbindStudentAction}>
                    <input type="hidden" name="redirectTo" value={selfPath} />
                    <input type="hidden" name="studentId" value={l.studentId} />
                    <FormActionButton className="admin-button admin-button-danger admin-button-small" confirmMessage={`Отвязать Telegram у «${l.name}»?`} pendingText="…">Отвязать</FormActionButton>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="admin-section-subtitle">Не привязанные — ручная привязка</h2>
      <div className="admin-table-wrap">
        <table className="admin-table admin-table-compact">
          <thead><tr><th>Ученик</th><th>Привязать к Telegram user id</th></tr></thead>
          <tbody>
            {unbound.map((l) => (
              <tr key={l.studentId}>
                <td>{l.name}</td>
                <td>
                  <form action={relinkStudentAction} className="admin-form-inline" style={{ gap: 8 }}>
                    <input type="hidden" name="redirectTo" value={selfPath} />
                    <input type="hidden" name="studentId" value={l.studentId} />
                    <input className="admin-input" name="telegramUserId" placeholder="telegram user id" style={{ width: 160 }} />
                    <FormActionButton className="admin-button admin-button-small" confirmMessage={`Привязать «${l.name}» к указанному Telegram id?`} pendingText="…">Привязать</FormActionButton>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="admin-section-subtitle">Журнал попыток (последние 200)</h2>
      <div className="admin-table-wrap">
        <table className="admin-table admin-table-compact">
          <thead><tr><th>Когда</th><th>Результат</th><th>Telegram</th><th>Причина</th></tr></thead>
          <tbody>
            {events.length === 0 ? <tr><td colSpan={4} className="admin-empty-cell">Пусто</td></tr> : null}
            {events.map((e) => (
              <tr key={e.id}>
                <td>{new Date(e.createdAt).toLocaleString("ru-RU")}</td>
                <td><span className={`admin-badge ${e.result === "confirmed" || e.result === "relinked" ? "admin-badge-success" : e.result === "conflict" ? "admin-badge-danger" : "admin-badge-warning"}`}>{e.result}</span></td>
                <td>{e.telegramUserId ?? "—"}{e.username ? ` · ${e.username}` : ""}</td>
                <td>{e.reason ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
