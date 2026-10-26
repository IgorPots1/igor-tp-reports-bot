import Link from "next/link";

import { getSingleSearchParam } from "@/app/admin/lib";
import { CONSULT_TOOL_LABELS, loadConsultClickStats, type ConsultClickStat } from "@/features/consult-clicks/stats";
import { ALL_PATHS, loadPageViewStats, type DayPoint, type PageViewStats, type SourceCount } from "@/features/page-views/stats";

// Просмотры публичных страниц igorp.run по своему счётчику (page_views, пишет /api/pv).
// Доступ — как у остальной админки (layout проверяет cookie).
export const dynamic = "force-dynamic";

function ViewsChart({ data, label }: { data: DayPoint[]; label: string }) {
  const max = Math.max(1, ...data.map((d) => d.n));
  const w = 720;
  const h = 140;
  const bw = w / data.length;
  return (
    <svg viewBox={`0 0 ${w} ${h + 20}`} role="img" aria-label={`Просмотры по дням: ${label}`} style={{ width: "100%", maxWidth: w, height: "auto" }}>
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

function SourcesTable({ title, rows }: { title: string; rows: SourceCount[] }) {
  return (
    <div className="admin-table-wrap">
      <table className="admin-table">
        <thead>
          <tr>
            <th>{title}</th>
            <th>Просмотры</th>
          </tr>
        </thead>
        <tbody>
          {rows.length ? (
            rows.slice(0, 20).map((r) => (
              <tr key={r.label}>
                <td>{r.label}</td>
                <td>{r.n}</td>
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={2} className="admin-muted">
                Пока нет
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export default async function ToolsStatsAdminPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const requested = getSingleSearchParam(sp.path) ?? ALL_PATHS;

  let s: PageViewStats | null = null;
  let error: string | null = null;
  try {
    s = await loadPageViewStats();
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  let consult: { rows: ConsultClickStat[]; truncated: boolean } | null = null;
  let consultError: string | null = null;
  try {
    consult = await loadConsultClickStats();
  } catch (e) {
    consultError = e instanceof Error ? e.message : String(e);
  }

  const selected = s && s.byDay[requested] ? requested : ALL_PATHS;
  const total = (d: DayPoint[]) => d.reduce((sum, x) => sum + x.n, 0);

  return (
    <section className="admin-section">
      <div className="admin-section-header">
        <h1>Просмотры сайта</h1>
        <p className="admin-section-subtitle">
          Свой счётчик igorp.run: /tools, /races, /camp, /club, /start и главная. Без ботов, админки и мини-аппа.
          Уникальные — по случайному id браузера. Дни московские.
        </p>
      </div>

      {error ? <div className="admin-alert admin-alert-error">Не удалось прочитать статистику: {error}</div> : null}
      {s?.truncated ? (
        <div className="admin-alert admin-alert-warning">Строк за 30 дней больше лимита чтения, цифры неполные.</div>
      ) : null}

      <div className="admin-card">
        <h2 className="admin-card-header">Клики «Записаться на консультацию»</h2>
        {consultError ? (
          <div className="admin-alert admin-alert-error">Не удалось прочитать клики: {consultError}</div>
        ) : null}
        {consult ? (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Инструмент</th>
                  <th>Сегодня</th>
                  <th>7 дней</th>
                  <th>30 дней</th>
                  <th>Всего</th>
                </tr>
              </thead>
              <tbody>
                {consult.rows.length ? (
                  consult.rows.map((r) => (
                    <tr key={r.tool}>
                      <td>{CONSULT_TOOL_LABELS[r.tool] ?? r.tool}</td>
                      <td>{r.today}</td>
                      <td>
                        <strong>{r.d7}</strong>
                      </td>
                      <td>{r.d30}</td>
                      <td>{r.total}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} className="admin-muted">
                      Пока нет кликов
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ) : null}
        <p className="admin-hint">
          Кнопка под бесплатными инструментами. Клик пишется до перехода в Telegram, поэтому это намерение, а не
          состоявшаяся переписка. Считаем с 26.10.2026.
        </p>
      </div>

      {s ? (
        <>
          <div className="admin-card">
            <h2 className="admin-card-header">Страницы</h2>
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Страница</th>
                    <th>Сегодня</th>
                    <th>7 дней</th>
                    <th>30 дней</th>
                  </tr>
                </thead>
                <tbody>
                  {s.paths.length ? (
                    s.paths.map((p) => (
                      <tr key={p.path}>
                        <td>
                          <Link href={`/admin/tools-stats?path=${encodeURIComponent(p.path)}`}>{p.path}</Link>
                        </td>
                        <td>
                          {p.today.views} · {p.today.visitors} уник.
                        </td>
                        <td>
                          <strong>{p.d7.views}</strong> · {p.d7.visitors} уник.
                        </td>
                        <td>
                          {p.d30.views} · {p.d30.visitors} уник.
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={4} className="admin-muted">
                        Пока нет просмотров
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <p className="admin-hint">Сортировка по просмотрам за 7 дней. Клик по странице — её график ниже.</p>
          </div>

          <div className="admin-card">
            <h2 className="admin-card-header">Просмотры по дням, 30 дней</h2>
            <form method="get" action="/admin/tools-stats" className="admin-form-inline" style={{ marginBottom: 12 }}>
              <select name="path" defaultValue={selected} className="admin-input">
                <option value={ALL_PATHS}>Все страницы</option>
                {s.paths.map((p) => (
                  <option key={p.path} value={p.path}>
                    {p.path}
                  </option>
                ))}
              </select>
              <button type="submit" className="admin-button admin-button-secondary admin-button-small">
                Показать
              </button>
            </form>
            <ViewsChart data={s.byDay[selected]} label={selected === ALL_PATHS ? "все страницы" : selected} />
            <p className="admin-hint">
              {selected === ALL_PATHS ? "Все страницы" : selected}: {total(s.byDay[selected])} за 30 дней.
            </p>
          </div>

          <div className="admin-card">
            <h2 className="admin-card-header">Источники за 7 дней</h2>
            <div className="admin-grid">
              <SourcesTable title="Откуда (домен)" rows={s.referrers7} />
              <SourcesTable title="utm_source" rows={s.utmSources7} />
            </div>
            <p className="admin-hint">Переходы внутри сайта в источники не попадают.</p>
          </div>
        </>
      ) : null}
    </section>
  );
}
