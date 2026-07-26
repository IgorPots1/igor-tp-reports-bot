import { getSingleSearchParam } from "@/app/admin/lib";
import FormActionButton from "@/app/admin/FormActionButton";
import { isClubAdminEnabled, getClubAccessRequestsAdminData } from "@/features/club-admin/repository";
import { approveClubAccessRequestAction, rejectClubAccessRequestAction } from "@/app/admin/club/actions";

export const dynamic = "force-dynamic";

function candLabel(c: {
  name: string; tpAthleteId: string | null; lastWorkoutDate: string | null; count30d: number;
  active: boolean; service: boolean; boundTelegramUserId: number | null; duplicateTp: boolean;
}): string {
  const tags: string[] = [];
  if (!c.active) tags.push("АРХИВ");
  if (c.service) tags.push("СЕРВИС");
  if (c.boundTelegramUserId) tags.push("ЗАНЯТ");
  if (c.duplicateTp) tags.push("ДУБЛЬ-TP");
  return `${c.name} · TP${c.tpAthleteId ?? "—"} · посл ${c.lastWorkoutDate ?? "нет"} · 30д ${c.count30d}${tags.length ? " · " + tags.join(",") : ""}`;
}

export default async function ClubRequestsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!isClubAdminEnabled()) {
    return <section className="admin-section"><div className="admin-alert admin-alert-warning">Раздел выключен.</div></section>;
  }
  const sp = await searchParams;
  const notice = getSingleSearchParam(sp.notice);
  const error = getSingleSearchParam(sp.error);
  const selfPath = "/admin/club/requests";

  const { requests, candidates } = await getClubAccessRequestsAdminData();
  const byId = new Map(candidates.map((c) => [c.studentId, c]));
  // Dropdown: active non-service first (recommended), archived/service last (marked).
  const ordered = [...candidates].sort((a, b) => {
    const rank = (c: typeof a) => (c.service ? 2 : !c.active ? 1 : 0);
    return rank(a) - rank(b) || a.name.localeCompare(b.name, "ru");
  });

  return (
    <section className="admin-section">
      <div className="admin-section-header">
        <h1>Заявки на доступ</h1>
        <p className="admin-section-subtitle">Непривязанный открыл клуб → заявка. Сопоставь с учеником (один Telegram = один ученик). Автоподсказка по имени — не привязывает сама. Архивные/сервисные не предлагаются.</p>
      </div>

      {notice ? <div className="admin-alert admin-alert-success">{notice}</div> : null}
      {error ? <div className="admin-alert admin-alert-error">{error}</div> : null}

      {requests.length === 0 ? (
        <div className="admin-card" style={{ marginTop: 12 }}><p className="admin-summary-label">Заявок нет.</p></div>
      ) : null}

      {requests.map(({ request: r, suggestions }) => {
        const tgName = [r.firstName, r.lastName].filter(Boolean).join(" ") || "—";
        return (
          <div className="admin-card" key={r.id} style={{ marginTop: 12 }}>
            <div className="admin-badge-row">
              <strong>{tgName}</strong>
              <span className="admin-summary-label">@{r.telegramUsername ?? "—"} · id {r.telegramUserId} · {new Date(r.createdAt).toLocaleString("ru-RU")}</span>
            </div>

            {suggestions.length > 0 ? (
              <div style={{ marginTop: 8 }}>
                <span className="admin-summary-label">Похожие: </span>
                {suggestions.map((s) => (
                  <form key={s.studentId} action={approveClubAccessRequestAction} style={{ display: "inline", marginRight: 6 }}>
                    <input type="hidden" name="redirectTo" value={selfPath} />
                    <input type="hidden" name="requestId" value={r.id} />
                    <input type="hidden" name="telegramUserId" value={r.telegramUserId} />
                    <input type="hidden" name="studentId" value={s.studentId} />
                    <FormActionButton className="admin-button admin-button-primary admin-button-small" confirmMessage={`Привязать «${tgName}» → «${s.name}»?`} pendingText="…">{s.name} ({(s.sim * 100).toFixed(0)}%)</FormActionButton>
                  </form>
                ))}
              </div>
            ) : null}

            <form action={approveClubAccessRequestAction} className="admin-form-inline" style={{ gap: 8, marginTop: 8, flexWrap: "wrap" }}>
              <input type="hidden" name="redirectTo" value={selfPath} />
              <input type="hidden" name="requestId" value={r.id} />
              <input type="hidden" name="telegramUserId" value={r.telegramUserId} />
              <select className="admin-input" name="studentId" defaultValue={suggestions[0]?.studentId ?? ""} style={{ minWidth: 380 }}>
                <option value="" disabled>— выбери ученика —</option>
                {ordered.map((c) => (
                  <option key={c.studentId} value={c.studentId}>{candLabel(byId.get(c.studentId)!)}</option>
                ))}
              </select>
              <FormActionButton className="admin-button admin-button-primary admin-button-small" confirmMessage={`Привязать «${tgName}» к выбранному ученику?`} pendingText="…">Привязать</FormActionButton>
            </form>

            <div style={{ marginTop: 6 }}>
              <form action={rejectClubAccessRequestAction} style={{ display: "inline" }}>
                <input type="hidden" name="redirectTo" value={selfPath} />
                <input type="hidden" name="requestId" value={r.id} />
                <input type="hidden" name="telegramUserId" value={r.telegramUserId} />
                <FormActionButton className="admin-button admin-button-danger admin-button-small" confirmMessage="Отклонить заявку (посторонний)?" pendingText="…">Отклонить</FormActionButton>
              </form>
            </div>
          </div>
        );
      })}
    </section>
  );
}
