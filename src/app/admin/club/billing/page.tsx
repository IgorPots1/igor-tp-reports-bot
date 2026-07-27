import {
  isClubAdminEnabled,
  listClubPaymentClaims,
  listClubDebtors,
  listClubPaymentReminders,
} from "@/features/club-admin/repository";
import FormActionButton from "@/app/admin/FormActionButton";
import { getSingleSearchParam } from "@/app/admin/lib";
import {
  reviewPaymentClaimAction,
  createReminderDraftsAction,
  confirmRemindersAction,
} from "@/app/admin/club/actions";

export const dynamic = "force-dynamic";

export default async function ClubBillingAdminPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!isClubAdminEnabled()) {
    return <section className="admin-section"><div className="admin-alert admin-alert-warning">Раздел выключен.</div></section>;
  }
  const sp = await searchParams;
  const notice = getSingleSearchParam(sp.notice);
  const error = getSingleSearchParam(sp.error);
  const selfPath = "/admin/club/billing";

  const claims = await listClubPaymentClaims(false);
  const { billingMonth, debtors } = await listClubDebtors();
  const reminders = billingMonth ? await listClubPaymentReminders(billingMonth) : [];
  const drafts = reminders.filter((r) => r.status === "draft");

  return (
    <section className="admin-section">
      <div className="admin-section-header">
        <h1>Оплата клуба</h1>
        <p className="admin-section-subtitle">Заявки «я оплатил», должники и черновики напоминаний. Всё read-only поверх биллинга: суммы и статусы не меняются здесь. Ученикам ничего не отправляется - автоотправка выключена флагом CLUB_BILLING_REMINDER_AUTOSEND_ENABLED.</p>
      </div>
      {notice ? <div className="admin-alert admin-alert-success">{notice}</div> : null}
      {error ? <div className="admin-alert admin-alert-warning">{error}</div> : null}

      <h2 className="admin-section-subtitle">Заявки «я оплатил» ({claims.length})</h2>
      <div className="admin-table-wrap">
        <table className="admin-table admin-table-compact">
          <thead><tr><th>Когда</th><th>Ученик</th><th>Заметка</th><th></th></tr></thead>
          <tbody>
            {claims.length === 0 ? <tr><td colSpan={4} className="admin-empty-cell">Нет новых заявок</td></tr> : null}
            {claims.map((c) => (
              <tr key={c.id}>
                <td style={{ whiteSpace: "nowrap" }}>{c.createdAtLabel}</td>
                <td>{c.studentName}</td>
                <td style={{ whiteSpace: "normal" }}>{c.note ?? ""}</td>
                <td>
                  <form action={reviewPaymentClaimAction}>
                    <input type="hidden" name="redirectTo" value={selfPath} />
                    <input type="hidden" name="claimId" value={c.id} />
                    <FormActionButton className="admin-button admin-button-small" pendingText="…">Обработано</FormActionButton>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="admin-section-subtitle">Должники{billingMonth ? ` · ${billingMonth}` : ""} ({debtors.length})</h2>
      <form action={createReminderDraftsAction} style={{ marginBottom: 8 }}>
        <input type="hidden" name="redirectTo" value={selfPath} />
        <FormActionButton className="admin-button admin-button-secondary admin-button-small" pendingText="…">Создать черновики напоминаний</FormActionButton>
      </form>
      <div className="admin-table-wrap">
        <table className="admin-table admin-table-compact">
          <thead><tr><th>Ученик</th><th>Просрочка</th><th>Сумма</th></tr></thead>
          <tbody>
            {debtors.length === 0 ? <tr><td colSpan={3} className="admin-empty-cell">Должников нет (или биллинг не подключён)</td></tr> : null}
            {debtors.map((d) => (
              <tr key={d.studentId}>
                <td>{d.name}</td>
                <td>{d.daysOverdue ? `${d.daysOverdue} дн.` : "-"}</td>
                <td>{d.amountLabel ?? "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="admin-section-subtitle">Черновики напоминаний ({drafts.length})</h2>
      <form action={confirmRemindersAction}>
        <input type="hidden" name="redirectTo" value={selfPath} />
        <div className="admin-table-wrap">
          <table className="admin-table admin-table-compact">
            <thead><tr><th></th><th>Ученик</th><th>Текст черновика</th><th>Статус</th></tr></thead>
            <tbody>
              {reminders.length === 0 ? <tr><td colSpan={4} className="admin-empty-cell">Черновиков нет</td></tr> : null}
              {reminders.map((r) => (
                <tr key={r.id}>
                  <td>{r.status === "draft" ? <input type="checkbox" name="reminderIds" value={r.id} /> : null}</td>
                  <td>{r.studentName}</td>
                  <td style={{ whiteSpace: "normal" }}>{r.draftText}</td>
                  <td><span className="admin-badge admin-badge-muted">{r.status === "draft" ? "черновик" : r.status === "confirmed" ? "подтверждён" : "отменён"}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {drafts.length > 0 ? (
          <div style={{ marginTop: 8 }}>
            <FormActionButton className="admin-button admin-button-primary admin-button-small" pendingText="…">Подтвердить отмеченные</FormActionButton>
            <span style={{ marginLeft: 10, fontSize: 12, color: "var(--admin-muted, #888)" }}>Подтверждение только помечает черновик готовым. Отправки нет.</span>
          </div>
        ) : null}
      </form>
    </section>
  );
}
