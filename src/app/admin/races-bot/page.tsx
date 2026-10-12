import Link from "next/link";

import { getSingleSearchParam } from "@/app/admin/lib";
import { loadBotStats } from "@/features/races-bot/runtime";
import type { BotStatsReport, StatPeriod } from "@/features/races-bot/stats";

// Бот «Забеги России» (@ruruns_bot): те же цифры, что /stats в боте, плюс график новых
// пользователей и воронка. Доступ — как у остальной админки (layout проверяет cookie).
export const dynamic = "force-dynamic";

const PERIODS: [string, string][] = [["7", "7 дней"], ["30", "30 дней"], ["all", "Всё время"]];

function fmtDate(iso: string): string {
  return new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Moscow" }).format(new Date(iso));
}

function NewUsersChart({ data }: { data: BotStatsReport["newByDay"] }) {
  const max = Math.max(1, ...data.map((d) => d.n));
  const w = 720;
  const h = 140;
  const bw = w / data.length;
  return (
    <svg viewBox={`0 0 ${w} ${h + 20}`} role="img" aria-label="Новые пользователи по дням" style={{ width: "100%", maxWidth: w, height: "auto" }}>
      {data.map((d, i) => {
        const bh = Math.round((d.n / max) * h);
        return (
          <g key={d.day}>
            <rect x={i * bw + 1} y={h - bh} width={Math.max(1, bw - 2)} height={bh} fill="#e5480e" rx="2">
              <title>{`${d.day}: ${d.n}`}</title>
            </rect>
            {i % 5 === 0 ? (
              <text x={i * bw + bw / 2} y={h + 14} fontSize="10" textAnchor="middle" fill="#857f73">
                {d.day.slice(5)}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

export default async function RacesBotAdminPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const raw = getSingleSearchParam(sp.period);
  const period: StatPeriod = raw === "7" ? 7 : raw === "all" ? "all" : 30;

  let s: BotStatsReport | null = null;
  let error: string | null = null;
  try {
    s = await loadBotStats(period);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  return (
    <section className="admin-section">
      <div className="admin-section-header">
        <h1>Бот забегов</h1>
        <p className="admin-section-subtitle">
          @ruruns_bot «Забеги России»: пользователи, воронка, источники и клики. Те же цифры показывает /stats в боте.
        </p>
      </div>

      <div className="admin-card-actions" style={{ marginBottom: 16 }}>
        {PERIODS.map(([v, label]) => (
          <Link key={v} href={`/admin/races-bot?period=${v}`} className={String(period) === v ? "admin-badge admin-badge-accent" : "admin-badge admin-badge-outline"}>
            {label}
          </Link>
        ))}
      </div>

      {error ? <div className="admin-alert admin-alert-error">Не удалось прочитать статистику: {error}</div> : null}

      {s ? (
        <>
          <div className="admin-summary-grid">
            {[
              ["Всего", s.users.total],
              ["Новые за 7 дней", s.users.new7],
              ["Новые за 30 дней", s.users.new30],
              ["Активные за 7 дней", s.users.active7],
              ["Заблокировали", s.users.blocked],
              ["Отписались", s.users.unsubscribed],
            ].map(([label, value]) => (
              <div key={String(label)} className="admin-summary-card">
                <div className="admin-summary-label">{label}</div>
                <div className="admin-summary-value">{value}</div>
              </div>
            ))}
          </div>

          <div className="admin-card">
            <h2 className="admin-card-header">Новые пользователи по дням</h2>
            <NewUsersChart data={s.newByDay} />
          </div>

          <div className="admin-card">
            <h2 className="admin-card-header">Воронка</h2>
            <div style={{ display: "grid", gap: 8 }}>
              {s.funnel.map((f) => (
                <div key={f.key} style={{ display: "grid", gridTemplateColumns: "180px 1fr 90px", gap: 12, alignItems: "center" }}>
                  <span>{f.label}</span>
                  <div style={{ background: "#ede9e0", borderRadius: 6, height: 18 }}>
                    <div style={{ width: `${f.pct}%`, background: "#e5480e", height: 18, borderRadius: 6, minWidth: f.people ? 4 : 0 }} />
                  </div>
                  <span>
                    {f.people} · {f.pct}%
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="admin-card">
            <h2 className="admin-card-header">Источники</h2>
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Метка</th>
                    <th>Пришли</th>
                    <th>Нажали «Следить»</th>
                    <th>Заявка</th>
                  </tr>
                </thead>
                <tbody>
                  {s.sources.length ? (
                    s.sources.map((x) => (
                      <tr key={x.source}>
                        <td>{x.source}</td>
                        <td>{x.users}</td>
                        <td>{x.follow}</td>
                        <td>{x.consult}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={4} className="admin-muted">
                        Пока нет
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="admin-card">
            <h2 className="admin-card-header">Клики</h2>
            <div className="admin-summary-grid admin-summary-grid-compact">
              {(
                [
                  ["Регистрация", s.clicks.registration],
                  ["Сайт", s.clicks.site],
                  ["Календарь", s.clicks.calendar],
                ] as const
              ).map(([label, c]) => (
                <div key={label} className="admin-summary-card">
                  <div className="admin-summary-label">{label}: 7 / 30 дней</div>
                  <div className="admin-summary-value">
                    {c.d7} / {c.d30}
                  </div>
                </div>
              ))}
            </div>
            <p className="admin-hint">
              Топ забегов: {s.topRaces.length ? s.topRaces.map((r) => `${r.name} (${r.n})`).join("; ") : "нет"}
            </p>
            <p className="admin-hint">
              Топ городов: {s.topCities.length ? s.topCities.map((c) => `${c.city} (${c.n})`).join(", ") : "нет"}
            </p>
          </div>

          <div className="admin-card">
            <h2 className="admin-card-header">Заявки на консультацию (последние 10)</h2>
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Дата</th>
                    <th>Имя</th>
                    <th>Username</th>
                    <th>Город</th>
                    <th>Забег</th>
                  </tr>
                </thead>
                <tbody>
                  {s.consults.length ? (
                    s.consults.map((c, i) => (
                      <tr key={`${c.date}-${i}`}>
                        <td>{fmtDate(c.date)}</td>
                        <td>{c.name}</td>
                        <td>{c.username ? `@${c.username}` : "-"}</td>
                        <td>{c.city || "-"}</td>
                        <td>{c.race || "-"}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={5} className="admin-muted">
                        Пока нет
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
}
