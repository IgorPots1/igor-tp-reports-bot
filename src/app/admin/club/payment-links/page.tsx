import { isClubAdminEnabled } from "@/features/club-admin/repository";
import { listStudentsForPaymentLinks } from "@/features/club-admin/payment-links";
import FormActionButton from "@/app/admin/FormActionButton";
import { getSingleSearchParam } from "@/app/admin/lib";
import { setPaymentLinksAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function ClubPaymentLinksPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!isClubAdminEnabled()) {
    return <section className="admin-section"><div className="admin-alert admin-alert-warning">Раздел выключен.</div></section>;
  }
  const sp = await searchParams;
  const notice = getSingleSearchParam(sp.notice);
  const error = getSingleSearchParam(sp.error);

  const students = await listStudentsForPaymentLinks();
  const withLink = students.filter((s) => s.paymentUrl);

  return (
    <section className="admin-section">
      <div className="admin-section-header">
        <h1>Платёжные ссылки учеников</h1>
        <p className="admin-section-subtitle">
          Персональная ссылка оплаты у каждого ученика. Мини-апп открывает ЕЁ по кнопке «Оплатить»; если ссылки нет — кнопка не показывается (общей ссылки больше нет). Заполнено: {withLink.length} из {students.length}.
        </p>
      </div>
      {notice ? <div className="admin-alert admin-alert-success">{notice}</div> : null}
      {error ? <div className="admin-alert admin-alert-warning">{error}</div> : null}

      <h2 className="admin-section-subtitle">Массовое заполнение</h2>
      <p className="admin-hint">
        Одна строка на ученика: <code>ученик</code> и <code>ссылка</code> через <code>Tab</code>, <code>|</code>, <code>=</code>, запятую или двойной пробел. «Ученик» — точное имя (как в таблице ниже) или его id. Пустая ссылка справа очищает поле. Неоднозначные имена (два одинаковых) пропускаются и показываются в отчёте — вписывай их по id.
      </p>
      <form action={setPaymentLinksAction} style={{ marginBottom: 18 }}>
        <textarea
          name="bulk"
          className="admin-input"
          rows={8}
          style={{ width: "100%", fontFamily: "ui-monospace, Menlo, monospace", fontSize: 13 }}
          placeholder={"Марина Николаева | https://pay.example/xxxx\n1af7d1cb-e792-4ff8-a249-15b98786d163 = https://pay.example/yyyy"}
        />
        <div style={{ marginTop: 8 }}>
          <FormActionButton className="admin-button admin-button-primary" pendingText="Сохраняю…">Сохранить ссылки</FormActionButton>
        </div>
      </form>

      <h2 className="admin-section-subtitle">Ученики ({students.length})</h2>
      <div className="admin-table-wrap">
        <table className="admin-table admin-table-compact">
          <thead><tr><th>Имя</th><th>id</th><th>Ссылка</th></tr></thead>
          <tbody>
            {students.length === 0 ? <tr><td colSpan={3} className="admin-empty-cell">Нет учеников</td></tr> : null}
            {students.map((s) => (
              <tr key={s.id}>
                <td>{s.name}</td>
                <td style={{ fontFamily: "ui-monospace, Menlo, monospace", fontSize: 11, whiteSpace: "nowrap" }}>{s.id}</td>
                <td style={{ whiteSpace: "normal", wordBreak: "break-all" }}>
                  {s.paymentUrl ? <a href={s.paymentUrl} target="_blank" rel="noreferrer">{s.paymentUrl}</a> : <span className="admin-empty-cell">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
