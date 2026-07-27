import { isClubAdminEnabled, listClubCommentsAdmin } from "@/features/club-admin/repository";
import FormActionButton from "@/app/admin/FormActionButton";
import { getSingleSearchParam } from "@/app/admin/lib";
import { deleteClubCommentAction } from "@/app/admin/club/actions";

export const dynamic = "force-dynamic";

export default async function ClubCommentsAdminPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!isClubAdminEnabled()) {
    return <section className="admin-section"><div className="admin-alert admin-alert-warning">Раздел выключен.</div></section>;
  }
  const sp = await searchParams;
  const notice = getSingleSearchParam(sp.notice);
  const error = getSingleSearchParam(sp.error);
  const selfPath = "/admin/club/comments";
  const rows = await listClubCommentsAdmin();

  return (
    <section className="admin-section">
      <div className="admin-section-header">
        <h1>Комментарии клуба</h1>
        <p className="admin-section-subtitle">Все комментарии учеников к тренировкам. Удаление - только модерация; ученикам ничего не уходит. Показ в мини-аппе включается флагом CLUB_COMMENTS_ENABLED.</p>
      </div>
      {notice ? <div className="admin-alert admin-alert-success">{notice}</div> : null}
      {error ? <div className="admin-alert admin-alert-warning">{error}</div> : null}

      <h2 className="admin-section-subtitle">Всего ({rows.length})</h2>
      <div className="admin-table-wrap">
        <table className="admin-table admin-table-compact">
          <thead><tr><th>Когда</th><th>Автор</th><th>Тренировка</th><th>Текст</th><th></th></tr></thead>
          <tbody>
            {rows.length === 0 ? <tr><td colSpan={5} className="admin-empty-cell">Пусто</td></tr> : null}
            {rows.map((c) => (
              <tr key={c.id}>
                <td style={{ whiteSpace: "nowrap" }}>{c.createdAtLabel}</td>
                <td>{c.authorName}</td>
                <td style={{ color: "var(--admin-muted, #888)", fontSize: 12 }}>{c.workoutLabel}</td>
                <td style={{ maxWidth: 360, whiteSpace: "normal" }}>{c.body}</td>
                <td>
                  <form action={deleteClubCommentAction}>
                    <input type="hidden" name="redirectTo" value={selfPath} />
                    <input type="hidden" name="commentId" value={c.id} />
                    <FormActionButton className="admin-button admin-button-danger admin-button-small" confirmMessage="Удалить комментарий?" pendingText="…">Удалить</FormActionButton>
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
