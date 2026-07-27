import { getSingleSearchParam } from "@/app/admin/lib";
import FormActionButton from "@/app/admin/FormActionButton";
import { isClubAdminEnabled, getClubLinksAdminData, listLinkEvents } from "@/features/club-admin/repository";
import {
  unbindStudentAction,
  relinkStudentAction,
  generateClubLinkAction,
  generateAllUnboundLinksAction,
  revokeClubLinkAction,
  setClubDisplayNameAction,
} from "@/app/admin/club/actions";

export const dynamic = "force-dynamic";

function expLabel(iso: string): string {
  const days = Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000));
  return `истекает через ${days} дн.`;
}

export default async function ClubLinksPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!isClubAdminEnabled()) {
    return <section className="admin-section"><div className="admin-alert admin-alert-warning">Раздел выключен.</div></section>;
  }
  const sp = await searchParams;
  const notice = getSingleSearchParam(sp.notice);
  const error = getSingleSearchParam(sp.error);
  const selfPath = "/admin/club/links";

  const [data, events] = await Promise.all([getClubLinksAdminData(), listLinkEvents()]);
  const { bound, unbound, generalLink, configured, configError, tokensByStudent } = data;

  // Export list: every active token → "Имя → ссылка" (for the coach to copy & send himself).
  const exportLines: string[] = [];
  for (const s of unbound) {
    for (const t of tokensByStudent[s.studentId] ?? []) {
      if (t.link) exportLines.push(`${s.name} → ${t.link}`);
    }
  }

  return (
    <section className="admin-section">
      <div className="admin-section-header">
        <h1>Ссылки на клуб</h1>
        <p className="admin-section-subtitle">Одноразовые токены привязки. Ученику НИЧЕГО не отправляется — только генерация и копирование. Привязка одноразовая, отвязка — тренером.</p>
      </div>

      {notice ? <div className="admin-alert admin-alert-success">{notice}</div> : null}
      {error ? <div className="admin-alert admin-alert-error">{error}</div> : null}
      {!configured ? <div className="admin-alert admin-alert-warning">Ссылки не строятся: {configError} Токены генерируются, но ссылку собрать нельзя, пока не задан short name/бот.</div> : null}

      <div className="admin-summary-grid">
        <div className="admin-summary-card"><div className="admin-summary-label">Привязано</div><div className="admin-summary-value">{bound.length}</div></div>
        <div className="admin-summary-card"><div className="admin-summary-label">Не привязано</div><div className="admin-summary-value">{unbound.length}</div></div>
      </div>

      <div className="admin-card" style={{ marginTop: 12 }}>
        <div className="admin-badge-row"><strong>Общая ссылка (для уже привязанных)</strong></div>
        <p className="admin-summary-label" style={{ marginTop: 6 }}>Без токена. Привязанный ученик открывает клуб сразу; непривязанный получит «обратись к тренеру».</p>
        {generalLink ? <input className="admin-input" readOnly value={generalLink} style={{ width: "100%", marginTop: 6 }} /> : <span className="admin-badge admin-badge-muted">нет (не настроен short name)</span>}
      </div>

      <div className="admin-card" style={{ marginTop: 12 }}>
        <div className="admin-badge-row">
          <strong>Массовая генерация</strong>
          <form action={generateAllUnboundLinksAction}>
            <input type="hidden" name="redirectTo" value={selfPath} />
            <FormActionButton className="admin-button admin-button-primary admin-button-small" confirmMessage={`Сгенерировать по ссылке каждому из ${unbound.length} непривязанных?`} pendingText="…">Сгенерировать всем непривязанным</FormActionButton>
          </form>
        </div>
        {exportLines.length > 0 ? (
          <>
            <p className="admin-summary-label" style={{ marginTop: 8 }}>Скопируй список (ученик → ссылка) и разошли сам:</p>
            <textarea className="admin-input" readOnly rows={Math.min(12, exportLines.length + 1)} style={{ width: "100%", fontFamily: "monospace", fontSize: 12 }} value={exportLines.join("\n")} />
          </>
        ) : <p className="admin-summary-label" style={{ marginTop: 8 }}>Активных токенов у непривязанных пока нет.</p>}
      </div>

      <h2 className="admin-section-subtitle">Не привязанные — сгенерировать личную ссылку</h2>
      <div className="admin-table-wrap">
        <table className="admin-table admin-table-compact">
          <thead><tr><th>Ученик</th><th>Активные ссылки</th><th>Действия</th></tr></thead>
          <tbody>
            {unbound.map((l) => {
              const tokens = tokensByStudent[l.studentId] ?? [];
              return (
                <tr key={l.studentId}>
                  <td>{l.name}</td>
                  <td>
                    {tokens.length === 0 ? <span className="admin-badge admin-badge-muted">нет</span> : tokens.map((t) => (
                      <div key={t.id} style={{ marginBottom: 4 }}>
                        {t.link ? <input className="admin-input" readOnly value={t.link} style={{ width: 320, fontSize: 11 }} /> : <span className="admin-badge admin-badge-warning">токен есть, ссылка не строится</span>}
                        <span className="admin-summary-label" style={{ marginLeft: 6 }}>{expLabel(t.expiresAt)}</span>
                        <form action={revokeClubLinkAction} style={{ display: "inline", marginLeft: 6 }}>
                          <input type="hidden" name="redirectTo" value={selfPath} />
                          <input type="hidden" name="tokenId" value={t.id} />
                          <FormActionButton className="admin-button admin-button-danger admin-button-small" confirmMessage="Отозвать этот токен?" pendingText="…">Отозвать</FormActionButton>
                        </form>
                      </div>
                    ))}
                  </td>
                  <td>
                    <form action={generateClubLinkAction}>
                      <input type="hidden" name="redirectTo" value={selfPath} />
                      <input type="hidden" name="studentId" value={l.studentId} />
                      <FormActionButton className="admin-button admin-button-primary admin-button-small" pendingText="…">Сгенерировать ссылку</FormActionButton>
                    </form>
                    <form action={relinkStudentAction} className="admin-form-inline" style={{ gap: 6, marginTop: 6 }}>
                      <input type="hidden" name="redirectTo" value={selfPath} />
                      <input type="hidden" name="studentId" value={l.studentId} />
                      <input className="admin-input" name="telegramUserId" placeholder="ручная привязка: tg id" style={{ width: 150 }} />
                      <FormActionButton className="admin-button admin-button-small" confirmMessage={`Привязать «${l.name}» вручную?`} pendingText="…">Привязать</FormActionButton>
                    </form>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <h2 className="admin-section-subtitle">Привязанные</h2>
      <div className="admin-table-wrap">
        <table className="admin-table admin-table-compact">
          <thead><tr><th>Ученик</th><th>Telegram user id</th><th>@username</th><th>Имя в клубе</th><th>Отвязка</th></tr></thead>
          <tbody>
            {bound.map((l) => (
              <tr key={l.studentId}>
                <td>{l.name}</td><td>{l.telegramUserId}</td><td>{l.username ?? "—"}</td>
                <td>
                  <form action={setClubDisplayNameAction} className="admin-form-inline" style={{ gap: 6 }}>
                    <input type="hidden" name="redirectTo" value={selfPath} />
                    <input type="hidden" name="studentId" value={l.studentId} />
                    <input className="admin-input" name="displayName" placeholder="переопределить (пусто = сброс)" style={{ width: 200 }} maxLength={40} />
                    <FormActionButton className="admin-button admin-button-small" pendingText="…">Сохранить</FormActionButton>
                  </form>
                </td>
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
