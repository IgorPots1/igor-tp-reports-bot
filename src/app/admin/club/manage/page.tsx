import { isClubAdminEnabled, getClubManagementData } from "@/features/club-admin/repository";

export const dynamic = "force-dynamic";

export default async function ClubManagePage() {
  if (!isClubAdminEnabled()) {
    return <section className="admin-section"><div className="admin-alert admin-alert-warning">Раздел выключен.</div></section>;
  }
  const d = await getClubManagementData();

  return (
    <section className="admin-section">
      <div className="admin-section-header">
        <h1>Управление клубом</h1>
        <p className="admin-section-subtitle">Свежесть данных и режим челленджа.</p>
      </div>

      <div className="admin-summary-grid">
        <div className="admin-summary-card"><div className="admin-summary-label">Свежесть кэша</div><div className="admin-summary-value">{d.freshnessLabel}</div></div>
        <div className="admin-summary-card"><div className="admin-summary-label">Строк в кэше</div><div className="admin-summary-value">{d.cacheRows}</div></div>
        <div className="admin-summary-card"><div className="admin-summary-label">Плотность лапов</div><div className="admin-summary-value">{d.lapDensityPct}%</div></div>
        <div className="admin-summary-card"><div className="admin-summary-label">Активных учеников</div><div className="admin-summary-value">{d.activeStudents}</div></div>
      </div>

      <div className="admin-card" style={{ marginTop: 12 }}>
        <div className="admin-badge-row"><strong>Режим цели челленджа</strong><span className="admin-badge admin-badge-accent">{d.goalMode}</span></div>
        <p className="admin-summary-label" style={{ marginTop: 6 }}>Управляется переменной окружения CLUB_CHALLENGE_GOAL_MODE (auto / manual / fixture). auto = среднее клубного км за 4 недели. manual — из таблицы club_challenges.</p>
      </div>

      <div className="admin-card" style={{ marginTop: 12 }}>
        <div className="admin-badge-row"><strong>Покрытие TP-пиков</strong></div>
        <p className="admin-summary-label" style={{ marginTop: 6 }}>{d.peaksCoverage}</p>
      </div>

      {d.latestScannedAt ? <p className="admin-summary-label" style={{ marginTop: 8 }}>Последний скан: {new Date(d.latestScannedAt).toLocaleString("ru-RU")}</p> : null}

      {(() => {
        const bad = d.clubTablesHealth.filter((t) => !t.ok);
        return (
          <div className="admin-card" style={{ marginTop: 12 }}>
            <div className="admin-badge-row">
              <strong>Доступ к клубным таблицам</strong>
              {bad.length === 0
                ? <span className="admin-badge admin-badge-success">все {d.clubTablesHealth.length} ОК</span>
                : <span className="admin-badge admin-badge-danger">{bad.length} с ошибкой</span>}
            </div>
            {bad.length > 0 ? (
              <div className="admin-alert admin-alert-error" style={{ marginTop: 8 }}>
                Ошибка доступа — вкладки клуба покажут ПУСТО, пока не починить (гранты/миграция):
                <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                  {bad.map((t) => (
                    <li key={t.table}>
                      <code>{t.table}</code> — {t.code === "42501" ? "нет прав (42501): применить гранты" : t.code === "42P01" ? "таблицы нет (42P01): применить миграцию" : `${t.code ?? "ошибка"}: ${t.message ?? ""}`}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="admin-summary-label" style={{ marginTop: 6 }}>
                service_role видит все клубные таблицы. 42501/42P01 здесь появятся ГРОМКО, а не «пусто».
              </p>
            )}
          </div>
        );
      })()}
    </section>
  );
}
