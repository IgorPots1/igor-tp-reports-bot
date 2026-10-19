"use client";

/* eslint-disable @next/next/no-img-element -- скриншоты приходят подписанными
   ссылками Supabase Storage, next/image тут только мешает. */

import { useCallback, useEffect, useState } from "react";

import type {
  PlanDoc,
  PlanReport,
  PlanRole,
  PlanSession,
  PlanView as View,
} from "@/features/athlete-plans/repository";

import s from "./plan.module.css";

const DAYS = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
const MON = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
const KIND: Record<string, string> = {
  intervals: "Интервалы",
  stations: "Станции",
  long: "Длительная",
  easy: "Лёгкий бег",
  strength: "Силовая",
  test: "Контрольная",
};
const FEEL = ["Легко", "Нормально", "Тяжело", "Не вытянул"];
type AskKey = "distance" | "time" | "hr" | "pace" | "speed" | "splits" | "stations" | "fuel";
const ASKS: Record<AskKey, { label: string; ph: string; area?: boolean; hint?: string; num?: boolean }> = {
  distance: { label: "Дистанция, км", ph: "10.2", num: true },
  time: { label: "Время", ph: "58:30" },
  hr: { label: "Ср. пульс", ph: "148", num: true },
  pace: { label: "Ср. темп", ph: "5:40" },
  speed: { label: "Скорость, км/ч", ph: "11.5", num: true },
  splits: { label: "Отрезки по порядку", ph: "1) 13.5  2) 13.5  3) 13.8 ...", area: true, hint: "Скорость на дорожке или темп каждого отрезка" },
  stations: { label: "Станции", ph: "Лыжи 4:10, wall ball 3:20 ...", area: true, hint: "Время на каждой станции, если засекал" },
  fuel: { label: "Что ел и пил", ph: "Банан за час, гель на 50-й минуте, 500 мл воды" },
};
const POLL_MS = 60_000;

const pd = (x: string) => {
  const [y, m, d] = x.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const today = () => {
  const t = new Date();
  return new Date(t.getFullYear(), t.getMonth(), t.getDate());
};
const fmtD = (x: string) => {
  const d = pd(x);
  return `${d.getDate()} ${MON[d.getMonth()]}`;
};
const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(" ");

function statusOf(sess: PlanSession, r: PlanReport | undefined): { c: string; t: string } {
  if (r?.status === "done") return { c: s.s_done, t: r.coachReply ? "Выполнено · есть ответ" : "Выполнено" };
  if (r?.status === "partial") return { c: s.s_skipped, t: r.coachReply ? "Частично · есть ответ" : "Частично" };
  if (r?.status === "skipped") return { c: s.s_skipped, t: "Пропущено" };
  if (sess.date && sess.kind !== "strength") {
    const d = pd(sess.date).getTime();
    if (d < today().getTime()) return { c: s.s_missing, t: "Ждёт отчёт" };
    if (d === today().getTime()) return { c: s.s_missing, t: "Сегодня" };
  }
  return { c: "", t: "Впереди" };
}

async function shrinkToDataUrl(file: File): Promise<string> {
  const bmp = await createImageBitmap(file);
  const max = 1600;
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.85);
}

type Api = (body: Record<string, unknown>) => Promise<{ ok: boolean; error?: string }>;

export default function PlanView({ slug, token }: { slug: string; token: string }) {
  const [view, setView] = useState<View | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [week, setWeek] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const url = `/api/plan/${slug}/${token}`;

  const load = useCallback(async () => {
    try {
      const r = await fetch(url, { cache: "no-store" });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error);
      setView(j.view);
      setLoadErr(null);
    } catch {
      setLoadErr("План не загрузился. Проверь интернет и обнови страницу.");
    }
  }, [url]);

  useEffect(() => {
    load();
    const t = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  const api: Api = useCallback(
    async (body) => {
      try {
        const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        const j = await r.json().catch(() => ({ ok: false, error: r.status === 413 ? "Скриншоты слишком тяжёлые, добавь меньше за раз" : undefined }));
        if (j.ok && j.view) setView(j.view);
        return { ok: !!j.ok, error: j.error };
      } catch {
        return { ok: false, error: "Нет связи, проверь интернет и нажми ещё раз" };
      }
    },
    [url],
  );

  if (!view) {
    return (
      <div className={s.wrap}>
        <div className={s.empty}>
          <b>{loadErr ? "Не получилось" : "Загружаю план"}</b>
          {loadErr && <span>{loadErr}</span>}
        </div>
      </div>
    );
  }

  const plan: PlanDoc = view.plan ?? {};
  const weeks = plan.weeks ?? [];
  let cur = week;
  if (!cur || !weeks.some((w) => w.id === cur)) {
    cur = weeks[0]?.id ?? null;
    for (const w of weeks) if (w.start && pd(w.start) <= today()) cur = w.id;
  }
  const w = weeks.find((x) => x.id === cur);
  const daysToRace = plan.raceDate ? Math.round((pd(plan.raceDate).getTime() - today().getTime()) / 864e5) : null;

  return (
    <div className={s.wrap}>
      <header className={s.head}>
        <div className={s.eyebrow}>{plan.eyebrow || "План подготовки"}</div>
        <h1 className={s.title}>{plan.title || view.athleteName}</h1>
        <div className={s.tags}>
          {(plan.tags ?? []).map((t, i) => (
            <span key={i} className={cx(s.tag, t.hot && s.tagHot)}>
              {t.k && <b>{t.k}</b>}
              {t.v}
            </span>
          ))}
          {daysToRace !== null && daysToRace >= 0 && (
            <span className={cx(s.tag, s.tagHot)}>
              <b>До старта</b>
              {Math.ceil(daysToRace / 7)} нед.
            </span>
          )}
        </div>
        {plan.note && <p className={s.note}>{plan.note}</p>}
        {view.role === "coach" && <div className={s.coachBar}>Ссылка тренера: здесь можно отвечать на отчёты. Ученику давай его ссылку.</div>}
      </header>

      {weeks.length > 1 && (
        <nav className={s.weeks} aria-label="Недели">
          {weeks.map((x) => {
            const runs = x.sessions.filter((q) => q.kind !== "strength");
            const done = runs.filter((q) => view.reports[q.id]?.status === "done").length;
            return (
              <button
                key={x.id}
                type="button"
                className={cx(s.wk, x.id === cur && s.wkOn)}
                aria-pressed={x.id === cur}
                onClick={() => {
                  setWeek(x.id);
                  setOpen(null);
                }}
              >
                <div className={s.wkN}>{x.label || x.id}</div>
                <div className={s.wkD}>
                  {x.start ? fmtD(x.start) : ""} · {done}/{runs.length}
                </div>
              </button>
            );
          })}
        </nav>
      )}

      {w ? (
        <>
          <section className={s.wkInfo}>
            <h2>{w.title || w.label}</h2>
            {w.focus && <p>{w.focus}</p>}
          </section>
          <section className={s.list}>
            {w.sessions.map((q) => (
              <Card
                key={q.id}
                sess={q}
                report={view.reports[q.id]}
                role={view.role}
                isOpen={open === q.id}
                onToggle={() => {
                  const next = open === q.id ? null : q.id;
                  setOpen(next);
                  if (next) setTimeout(() => document.getElementById(`c-${q.id}`)?.scrollIntoView({ block: "start", behavior: "smooth" }), 30);
                }}
                api={api}
              />
            ))}
          </section>
        </>
      ) : (
        <div className={s.empty}>
          <b>План скоро появится</b>
          <span>Тренер добавит тренировки недели, обнови страницу чуть позже.</span>
        </div>
      )}

    </div>
  );
}

function Card(props: {
  sess: PlanSession;
  report: PlanReport | undefined;
  role: PlanRole;
  isOpen: boolean;
  onToggle: () => void;
  api: Api;
}) {
  const { sess, report, role, isOpen, onToggle, api } = props;
  const [editing, setEditing] = useState(false);
  const st = statusOf(sess, report);
  const d = sess.date ? pd(sess.date) : null;
  return (
    <article className={s.card} id={`c-${sess.id}`}>
      <button type="button" className={s.cardTop} aria-expanded={isOpen} onClick={onToggle}>
        <div className={s.date}>
          <span className={s.dw}>{d ? DAYS[d.getDay()] : ""}</span>
          <span className={s.dd}>{d ? d.getDate() : "·"}</span>
          <span className={s.dm}>{d ? MON[d.getMonth()] : ""}</span>
        </div>
        <div className={s.ct}>
          <div className={s.row}>
            <span className={cx(s.kind, s[`k_${sess.kind}`])}>{KIND[sess.kind ?? ""] ?? sess.kind}</span>
            {sess.duration && <span className={s.dur}>{sess.duration}</span>}
            <span className={cx(s.status, st.c)}>{st.t}</span>
          </div>
          <h3>{sess.title}</h3>
          {sess.summary && <div className={s.sum}>{sess.summary}</div>}
        </div>
      </button>
      {isOpen && (
        <div className={s.body}>
          {(sess.sections ?? []).map((sec, i) => (
            <div className={s.sec} key={i}>
              <h4>{sec.h}</h4>
              {sec.scheme && (
                <div className={s.scheme}>
                  {sec.scheme.steps.map((x, j) => (
                    <div key={j} className={cx(s.step, x.rest && s.stepRest)}>
                      <div className={s.stepV}>{x.v}</div>
                      <div className={s.stepW}>{x.w}</div>
                    </div>
                  ))}
                  {sec.scheme.repeat && <div className={s.rep}>{sec.scheme.repeat}</div>}
                </div>
              )}
              {sec.items && (
                <ul>
                  {sec.items.map((x, j) => (
                    <li key={j}>{x}</li>
                  ))}
                </ul>
              )}
              {sec.stations && (
                <ol className={s.st}>
                  {sec.stations.map((x, j) => (
                    <li key={j}>
                      <span>{x[0]}</span>
                      <span className={s.stR}>{x[1] ?? ""}</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          ))}
          {sess.tips && sess.tips.length > 0 && (
            <div className={s.sec}>
              <h4>Как выполнять</h4>
              <div className={s.tips}>
                {sess.tips.map((t, i) =>
                  typeof t === "string" ? (
                    <p key={i}>{t}</p>
                  ) : (
                    <p key={i}>
                      {t.b && <b>{t.b} </b>}
                      {t.t}
                    </p>
                  ),
                )}
              </div>
            </div>
          )}
          {sess.kind === "strength" ? null : report && !editing ? (
            <Sent report={report} role={role} sessionId={sess.id} api={api} onEdit={() => setEditing(true)} />
          ) : role === "athlete" ? (
            <ReportForm sess={sess} existing={report} api={api} onDone={() => setEditing(false)} />
          ) : (
            <p className={s.msg}>Отчёта пока нет.</p>
          )}
        </div>
      )}
    </article>
  );
}

function Sent({ report, role, sessionId, api, onEdit }: { report: PlanReport; role: PlanRole; sessionId: string; api: Api; onEdit: () => void }) {
  const [reply, setReply] = useState(report.coachReply ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ t: string; err?: boolean } | null>(null);
  const kv: [string, string][] = [];
  kv.push(["Статус", report.status === "done" ? "Выполнено" : report.status === "partial" ? "Частично" : "Пропущено"]);
  if (report.rpe) kv.push(["Нагрузка", `${report.rpe} из 10`]);
  if (report.feel) kv.push(["Ощущения", report.feel]);
  for (const k of Object.keys(ASKS) as AskKey[]) if (!ASKS[k].area && report.fields[k]) kv.push([ASKS[k].label, report.fields[k]]);
  return (
    <div className={s.report}>
      <h4>{role === "coach" ? "Отчёт ученика" : "Твой отчёт"}</h4>
      <div className={s.kv}>
        {kv.map(([k, v]) => (
          <div key={k}>
            <div className={s.kvK}>{k}</div>
            <div className={s.kvV}>{v}</div>
          </div>
        ))}
      </div>
      {(Object.keys(ASKS) as AskKey[])
        .filter((k) => ASKS[k].area && report.fields[k])
        .map((k) => (
          <div className={s.fld} key={k}>
            <label>{ASKS[k].label}</label>
            <div className={s.quote}>{report.fields[k]}</div>
          </div>
        ))}
      {report.comment && (
        <div className={s.fld}>
          <label>Комментарий</label>
          <div className={s.quote}>{report.comment}</div>
        </div>
      )}
      {report.files.length > 0 && (
        <div className={s.files}>
          {report.files.map((f) =>
            f.url ? (
              <a key={f.path} className={s.thumb} href={f.url} target="_blank" rel="noopener noreferrer">
                <img src={f.url} alt="Скриншот" loading="lazy" />
              </a>
            ) : null,
          )}
        </div>
      )}
      {role === "athlete" && report.coachReply && (
        <div className={s.coach}>
          <div className={s.coachWho}>Тренер</div>
          <p>{report.coachReply}</p>
        </div>
      )}
      {role === "coach" ? (
        <div className={s.fld}>
          <label htmlFor={`reply-${sessionId}`}>Ответ ученику</label>
          <textarea id={`reply-${sessionId}`} className={cx(s.inp, s.ta)} value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Ответ появится у него на странице" />
          <div className={s.actions}>
            <button
              type="button"
              className={s.btn}
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                const r = await api({ op: "reply", sessionId, reply });
                setMsg(r.ok ? { t: "Ответ сохранён" } : { t: r.error || "Не сохранилось", err: true });
                setBusy(false);
              }}
            >
              Ответить
            </button>
            {msg && <span className={cx(s.msg, msg.err && s.err)}>{msg.t}</span>}
          </div>
        </div>
      ) : (
        <div className={s.actions}>
          <button type="button" className={cx(s.btn, s.ghost)} onClick={onEdit}>
            Изменить отчёт
          </button>
        </div>
      )}
    </div>
  );
}

function ReportForm({ sess, existing, api, onDone }: { sess: PlanSession; existing: PlanReport | undefined; api: Api; onDone: () => void }) {
  const [status, setStatus] = useState<PlanReport["status"]>(existing?.status ?? "done");
  const [rpe, setRpe] = useState<number | null>(existing?.rpe ?? null);
  const [feel, setFeel] = useState<string | null>(existing?.feel ?? null);
  const [fields, setFields] = useState<Record<string, string>>(existing?.fields ?? {});
  const [comment, setComment] = useState(existing?.comment ?? "");
  const [keep, setKeep] = useState(existing?.files ?? []);
  const [added, setAdded] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ t: string; err?: boolean } | null>(null);
  const asks = ((sess.ask && sess.ask.length ? sess.ask : ["distance", "time", "hr"]) as AskKey[]).filter((k) => ASKS[k]);
  const fid = (k: string) => `${sess.id}-${k}`;

  const onFiles = async (list: FileList | null) => {
    if (!list) return;
    const room = 2 - keep.length - added.length;
    const pick = [...list].slice(0, Math.max(0, room));
    if (pick.length < list.length) setMsg({ t: "Не больше 2 скриншотов на тренировку", err: true });
    for (const f of pick) {
      try {
        const durl = await shrinkToDataUrl(f);
        setAdded((a) => [...a, durl]);
      } catch {
        setMsg({ t: "Этот файл не открылся, нужен скриншот или фото", err: true });
      }
    }
  };

  const submit = async () => {
    setBusy(true);
    setMsg({ t: "Отправляю…" });
    const r = await api({
      op: "report",
      report: {
        sessionId: sess.id,
        status,
        rpe,
        feel,
        fields,
        comment,
        keepPaths: keep.map((k) => k.path),
        newFiles: added,
      },
    });
    setBusy(false);
    if (r.ok) {
      setMsg(null);
      onDone();
    } else setMsg({ t: r.error || "Не сохранилось, нажми ещё раз", err: true });
  };

  return (
    <div className={s.report}>
      <h4>{existing ? "Изменить отчёт" : "Отчёт о тренировке"}</h4>
      <div className={s.seg}>
        {(
          [
            ["done", "Выполнил"],
            ["partial", "Частично"],
            ["skipped", "Пропустил"],
          ] as const
        ).map(([v, t]) => (
          <button key={v} type="button" className={cx(s.segB, status === v && s.segOn)} aria-pressed={status === v} onClick={() => setStatus(v)}>
            {t}
          </button>
        ))}
      </div>
      {status !== "skipped" && (
        <>
          <div className={s.fld}>
            <label>Насколько тяжело, от 1 до 10</label>
            <div className={s.rpe}>
              {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                <button key={n} type="button" aria-label={`Нагрузка ${n}`} aria-pressed={rpe === n} className={cx(s.rpeB, rpe === n && s.rpeOn)} onClick={() => setRpe(n)}>
                  {n}
                </button>
              ))}
            </div>
            <div className={s.rpeCap}>
              <span>1 разминка</span>
              <span>5 могу говорить</span>
              <span>10 на пределе</span>
            </div>
          </div>
          <div className={s.fld}>
            <label>Как ощущалось</label>
            <div className={s.seg}>
              {FEEL.map((f) => (
                <button key={f} type="button" aria-pressed={feel === f} className={cx(s.segB, feel === f && s.segOn)} onClick={() => setFeel(f)}>
                  {f}
                </button>
              ))}
            </div>
          </div>
          {asks.some((k) => !ASKS[k].area) && (
            <div className={s.grid3}>
              {asks
                .filter((k) => !ASKS[k].area)
                .map((k) => (
                  <div className={s.fld} key={k}>
                    <label htmlFor={fid(k)}>{ASKS[k].label}</label>
                    <input
                      id={fid(k)}
                      className={s.inp}
                      inputMode={ASKS[k].num ? "decimal" : undefined}
                      placeholder={ASKS[k].ph}
                      value={fields[k] ?? ""}
                      onChange={(e) => setFields((x) => ({ ...x, [k]: e.target.value }))}
                    />
                  </div>
                ))}
            </div>
          )}
          {asks
            .filter((k) => ASKS[k].area)
            .map((k) => (
              <div className={s.fld} key={k}>
                <label htmlFor={fid(k)}>{ASKS[k].label}</label>
                {ASKS[k].hint && <span className={s.hint}>{ASKS[k].hint}</span>}
                <textarea id={fid(k)} className={cx(s.inp, s.ta)} placeholder={ASKS[k].ph} value={fields[k] ?? ""} onChange={(e) => setFields((x) => ({ ...x, [k]: e.target.value }))} />
              </div>
            ))}
        </>
      )}
      <div className={s.fld}>
        <label htmlFor={fid("comment")}>Комментарий для тренера</label>
        <textarea
          id={fid("comment")}
          className={cx(s.inp, s.ta)}
          placeholder={status === "skipped" ? "Что помешало?" : "Что получилось, что нет, где было тяжелее всего"}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />
      </div>
      <div className={s.fld}>
        <label>Скриншоты с часов</label>
        <div className={s.files}>
          {keep.map((f) => (
            <div className={s.thumb} key={f.path}>
              {f.url && <img src={f.url} alt="Скриншот" />}
              <button type="button" className={s.x} aria-label="Убрать скриншот" onClick={() => setKeep((k) => k.filter((x) => x.path !== f.path))}>
                ×
              </button>
            </div>
          ))}
          {added.map((d, i) => (
            <div className={s.thumb} key={`n${i}`}>
              <img src={d} alt="Новый скриншот" />
              <button type="button" className={s.x} aria-label="Убрать скриншот" onClick={() => setAdded((a) => a.filter((_, j) => j !== i))}>
                ×
              </button>
            </div>
          ))}
          {keep.length + added.length < 2 && (
            <label className={s.upl} htmlFor={fid("file")}>
              <b>+</b>
              Скриншот
              <input
                id={fid("file")}
                type="file"
                accept="image/*"
                multiple
                onChange={(e) => {
                  onFiles(e.target.files);
                  e.target.value = "";
                }}
              />
            </label>
          )}
        </div>
      </div>
      <div className={s.actions}>
        {existing && (
          <button type="button" className={cx(s.btn, s.ghost)} onClick={onDone}>
            Отмена
          </button>
        )}
        <button type="button" className={s.btn} disabled={busy} onClick={submit}>
          {existing ? "Сохранить" : "Отправить отчёт"}
        </button>
        {msg && <span className={cx(s.msg, msg.err && s.err)}>{msg.t}</span>}
      </div>
    </div>
  );
}
