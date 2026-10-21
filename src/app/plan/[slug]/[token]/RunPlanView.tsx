"use client";

// Страница плана ученицы нашего плана (intervals_*). Стиль и сдержанность —
// со страницы Ильи (PlanView, plan.module.css); мини-апп /m/run образцом не
// служит [решение Игоря, 21.10.2026]. Текста минимум: если что-то требует
// пояснения абзацем, значит оно устроено сложно.

import { useCallback, useEffect, useMemo, useState } from "react";

import { reportDayFor } from "@/features/intervals/plan-page/report-day";
import type { PageSession, PageWeek, PlanPageView } from "@/features/intervals/plan-page/view";

import s from "./plan.module.css";
import r from "./run.module.css";

type Tab = "train" | "days" | "coach" | "hist";
type Focus = { sessionId: string | null; weekStart: string | null; tab: "coach" | null };
type Surface = "street" | "treadmill";
type Api = (body: Record<string, unknown>) => Promise<{ ok: boolean; error?: string }>;

const DW = ["вс", "пн", "вт", "ср", "чт", "пт", "сб"];
const WD7 = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];
const MON = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
const KIND: Record<PageSession["role"], { t: string; c?: string }> = {
  quality: { t: "Интервалы", c: s.k_intervals },
  long: { t: "Длительная", c: s.k_long },
  easy: { t: "Лёгкая" },
};

const pd = (iso: string) => new Date(`${iso}T12:00:00`);
const cx = (...xs: (string | false | null | undefined)[]) => xs.filter(Boolean).join(" ");
const shift = (iso: string, days: number) => {
  const d = pd(iso);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const dayShort = (iso: string) => `${DW[pd(iso).getDay()]} ${pd(iso).getDate()} ${MON[pd(iso).getMonth()]}`;
const num = (x: number) => String(x).replace(".", ",");

async function shrinkToDataUrl(file: File): Promise<string> {
  const img = await createImageBitmap(file);
  const k = Math.min(1, 1600 / Math.max(img.width, img.height));
  const c = document.createElement("canvas");
  c.width = Math.round(img.width * k);
  c.height = Math.round(img.height * k);
  c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.85);
}

function statusOf(x: PageSession, today: string): { c: string; t: string } {
  if (x.report) return { c: s.s_done, t: "Выполнено" };
  if (x.paused) return { c: "", t: "Пауза" };
  if (x.date < today) return { c: s.s_missing, t: "Не отмечено" };
  return { c: "", t: x.date === today ? "Сегодня" : "Впереди" };
}

export default function RunPlanView(props: { slug: string; token: string; initialView: PlanPageView; focus: Focus }) {
  const [view, setView] = useState(props.initialView);
  const [tab, setTab] = useState<Tab>(props.focus.tab === "coach" ? "coach" : "train");
  const [week, setWeek] = useState<string | null>(props.focus.weekStart);
  const [open, setOpen] = useState<string | null>(props.focus.sessionId);

  const api: Api = useCallback(
    async (body) => {
      try {
        const res = await fetch(`/api/plan/${props.slug}/${props.token}/run`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = (await res.json()) as { ok: boolean; error?: string; view?: PlanPageView };
        if (data.ok && data.view) setView(data.view);
        return data;
      } catch {
        return { ok: false, error: "Нет связи, попробуйте ещё раз" };
      }
    },
    [props.slug, props.token],
  );

  // Ссылка из бота ведёт в НУЖНОЕ место: тренировка из истории открывает
  // вкладку «История», а не ищется по неделям.
  useEffect(() => {
    const id = props.focus.sessionId;
    if (!id) return;
    const inCurrent = view.current.find((w) => w.sessions.some((x) => x.id === id));
    if (inCurrent) {
      setWeek(inCurrent.weekStart);
    } else if (view.history.some((w) => w.sessions.some((x) => x.id === id))) {
      setTab("hist");
    }
    setTimeout(() => document.getElementById(`c-${id}`)?.scrollIntoView({ block: "start", behavior: "smooth" }), 80);
    // только при входе по ссылке
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const markSeen = useCallback(
    (ids: string[]) => {
      if (ids.length) void api({ op: "seen", ids });
    },
    [api],
  );

  const hasNew = view.coachFeed.some((x) => x.isNew);
  useEffect(() => {
    if (tab === "coach") markSeen(view.coachFeed.filter((x) => x.isNew).map((x) => x.id));
  }, [tab, view.coachFeed, markSeen]);

  const openCard = (id: string | null) => {
    setOpen(id);
    if (!id) return;
    const sess = [...view.current, ...view.history].flatMap((w) => w.sessions).find((x) => x.id === id);
    markSeen((sess?.replies ?? []).filter((x) => x.isNew).map((x) => x.id));
  };

  const goSession = (id: string) => {
    const inCurrent = view.current.find((w) => w.sessions.some((x) => x.id === id));
    if (inCurrent) {
      setTab("train");
      setWeek(inCurrent.weekStart);
    } else setTab("hist");
    openCard(id);
    setTimeout(() => document.getElementById(`c-${id}`)?.scrollIntoView({ block: "start", behavior: "smooth" }), 80);
  };

  const curWeek: PageWeek | null =
    view.current.find((w) => w.weekStart === week) ??
    view.current.find((w) => w.weekStart <= view.todayIso && view.todayIso <= shift(w.weekStart, 6)) ??
    view.current[0] ??
    null;

  return (
    <div className={cx(s.wrap, r.screen)}>
      <header className={s.head}>
        <div className={s.eyebrow}>План тренировок</div>
        <h1 className={s.title}>{view.studentName}</h1>
      </header>

      {tab === "train" && (
        <>
          {view.current.length > 1 && (
            <nav className={s.weeks} aria-label="Недели">
              {view.current.map((w) => {
                const done = w.sessions.filter((x) => x.report).length;
                return (
                  <button key={w.weekStart} type="button" className={cx(s.wk, w === curWeek && s.wkOn)} onClick={() => setWeek(w.weekStart)}>
                    <div className={s.wkN}>{w.label}</div>
                    <div className={s.wkD}>
                      {done}/{w.sessions.length}
                    </div>
                  </button>
                );
              })}
            </nav>
          )}
          {curWeek ? (
            <>
              <section className={s.wkInfo}>
                <h2>{curWeek.label}</h2>
                {curWeek.notes.length > 0 && <p className={r.wnote}>{curWeek.notes.join(" · ")}</p>}
              </section>
              <WeekCards week={curWeek} view={view} open={open} onOpen={openCard} api={api} />
            </>
          ) : (
            <div className={s.empty}>
              <b>План скоро появится</b>
            </div>
          )}
        </>
      )}

      {tab === "days" && <MyDays view={view} api={api} />}

      {tab === "coach" && <CoachTab view={view} api={api} onSession={goSession} />}

      {tab === "hist" &&
        (view.history.length ? (
          view.history.map((w) => {
            const hasOpen = w.sessions.some((x) => x.id === open);
            return (
              <details key={w.weekStart} className={r.hw} open={hasOpen || undefined}>
                <summary>
                  <span>{w.label}</span>
                  <span className={s.dur}>
                    {w.sessions.filter((x) => x.report).length}/{w.sessions.length}
                  </span>
                </summary>
                <div className={r.hwList}>
                  <WeekCards week={w} view={view} open={open} onOpen={openCard} api={api} />
                </div>
              </details>
            );
          })
        ) : (
          <div className={s.empty}>Пока пусто</div>
        ))}

      <nav className={r.tabbar}>
        {(
          [
            ["train", "Тренировки"],
            ["days", "Мои дни"],
            ["coach", "Тренер"],
            ["hist", "История"],
          ] as [Tab, string][]
        ).map(([k, t]) => (
          <button
            key={k}
            type="button"
            className={cx(r.tab, tab === k && r.tabOn)}
            onClick={() => {
              setTab(k);
              window.scrollTo({ top: 0 });
            }}
          >
            {t}
            {k === "coach" && hasNew && <span className={r.dot} />}
          </button>
        ))}
      </nav>
    </div>
  );
}

function WeekCards(props: { week: PageWeek; view: PlanPageView; open: string | null; onOpen: (id: string | null) => void; api: Api }) {
  return (
    <section className={s.list}>
      {props.week.sessions.map((x) => (
        <Card
          key={x.id}
          sess={x}
          week={props.week}
          view={props.view}
          isOpen={props.open === x.id}
          onToggle={() => props.onOpen(props.open === x.id ? null : x.id)}
          api={props.api}
        />
      ))}
    </section>
  );
}

function Card(props: { sess: PageSession; week: PageWeek; view: PlanPageView; isOpen: boolean; onToggle: () => void; api: Api }) {
  const { sess, view, api } = props;
  const [editing, setEditing] = useState(false);
  const [moving, setMoving] = useState(false);
  const st = statusOf(sess, view.todayIso);
  const d = pd(sess.date);
  const kind = KIND[sess.role];
  const canMove = !sess.report && sess.date >= view.todayIso;
  // «Отметить» на каждой карточке текущей недели, как у Ильи: бегает она не
  // всегда в день из плана (report-day.ts).
  const reportDay = reportDayFor({ sessionDate: sess.date, weekStart: sess.weekStart, todayIso: view.todayIso });
  const canReport = reportDay.ok;

  return (
    <article className={s.card} id={`c-${sess.id}`}>
      <div className={s.cardTop}>
        <button
          type="button"
          className={cx(s.date, r.dateBtn, sess.date === view.todayIso && r.today)}
          disabled={!canMove}
          onClick={() => setMoving(true)}
          aria-label={canMove ? "Перенести на другой день" : undefined}
        >
          <span className={s.dw}>{DW[d.getDay()]}</span>
          <span className={cx(s.dd, canMove && r.ddLink)}>{d.getDate()}</span>
          <span className={s.dm}>{MON[d.getMonth()]}</span>
        </button>
        <button type="button" className={cx(s.ct, r.dateBtn)} style={{ textAlign: "left" }} aria-expanded={props.isOpen} onClick={props.onToggle}>
          <div className={s.row}>
            <span className={cx(s.kind, kind.c)}>{kind.t}</span>
            <span className={s.dur}>{sess.minutes} мин</span>
            <span className={cx(s.status, st.c)}>{st.t}</span>
          </div>
          <h3>{sess.title}</h3>
          {sess.movedFrom && <span className={r.moved}>перенесено с {dayShort(sess.movedFrom)}</span>}
        </button>
      </div>

      {props.isOpen && (
        <div className={s.body}>
          <Scheme sess={sess} />
          {editing ? (
            <ReportForm sess={sess} view={view} api={api} onDone={() => setEditing(false)} />
          ) : sess.report ? (
            <Sent sess={sess} onEdit={() => setEditing(true)} />
          ) : canReport ? (
            <ReportGate sess={sess} view={view} api={api} />
          ) : null}
          {!sess.report && sess.replies.map((x) => <CoachBlock key={x.id} body={x.body} at={x.at} week={x.isWeekReview} />)}
        </div>
      )}

      {moving && <MoveSheet sess={sess} week={props.week} view={view} api={api} onClose={() => setMoving(false)} />}
    </article>
  );
}

function Scheme({ sess }: { sess: PageSession }) {
  const sc = sess.scheme;
  const steps = (xs: { v: string; w: string; rest?: boolean }[]) =>
    xs.map((x, i) => (
      <div key={i} className={cx(s.step, x.rest && s.stepRest)}>
        <div className={s.stepV}>{x.v}</div>
        <div className={s.stepW}>{x.w}</div>
      </div>
    ));
  return (
    <>
      {sc.warm.length > 0 && (
        <div className={s.sec}>
          <h4>Разминка</h4>
          <ul>
            {sc.warm.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ul>
        </div>
      )}
      {sc.rep && (
        <div className={s.sec}>
          <h4>Основная часть</h4>
          <div className={s.scheme}>
            {steps(sc.rep.steps)}
            <div className={s.rep}>× {sc.rep.count}</div>
          </div>
        </div>
      )}
      {sc.main.length > 0 && (
        <div className={s.sec}>
          <h4>Тренировка</h4>
          <div className={s.scheme}>{steps(sc.main)}</div>
        </div>
      )}
      {sc.cool.length > 0 && (
        <div className={s.sec}>
          <h4>Заминка</h4>
          <ul>
            {sc.cool.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

function CoachBlock({ body, at, week }: { body: string; at: string; week: boolean }) {
  const [full, setFull] = useState(false);
  const long = body.split("\n").filter(Boolean).length > 2 || body.length > 160;
  return (
    <div className={s.coach}>
      <div className={s.coachWho}>
        Тренер{week ? " · разбор недели" : ""} · {dayShort(at.slice(0, 10))}
      </div>
      <p className={cx(!full && long && r.clamp)}>{body}</p>
      {long && !full && (
        <button type="button" className={r.more} onClick={() => setFull(true)}>
          дальше
        </button>
      )}
    </div>
  );
}

function Sent({ sess, onEdit }: { sess: PageSession; onEdit: () => void }) {
  const rep = sess.report!;
  const kv: [string, string][] = [];
  if (rep.surface) kv.push(["Где", rep.surface === "street" ? "улица" : "дорожка"]);
  if (rep.effortLabel) kv.push(["Как далась", rep.effortLabel]);
  kv.push(["Болело", rep.pain ? "да" : "нет"]);
  if (rep.minutes !== null) kv.push(["Минуты", String(rep.minutes)]);
  if (rep.speedKmh !== null) kv.push([rep.recoverySpeedKmh !== null ? "Отрезки" : "Скорость", `${num(rep.speedKmh)} км/ч`]);
  if (rep.recoverySpeedKmh !== null) kv.push(["Восстановление", `${num(rep.recoverySpeedKmh)} км/ч`]);
  if (rep.speedKmh === null && rep.distanceKm !== null) kv.push(["Км", num(rep.distanceKm)]);
  return (
    <div className={s.report}>
      <h4>Отчёт</h4>
      <div className={s.kv}>
        {kv.map(([k, v]) => (
          <div key={k}>
            <div className={s.kvK}>{k}</div>
            <div className={s.kvV}>{v}</div>
          </div>
        ))}
      </div>
      {rep.comment && <div className={s.quote}>{rep.comment}</div>}
      {rep.files.length > 0 && (
        <div className={s.files}>
          {rep.files.map((f) =>
            f.url ? (
              <a key={f.path} className={s.thumb} href={f.url} target="_blank" rel="noopener noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={f.url} alt="Скриншот" loading="lazy" />
              </a>
            ) : null,
          )}
        </div>
      )}
      {sess.replies.map((x) => (
        <CoachBlock key={x.id} body={x.body} at={x.at} week={x.isWeekReview} />
      ))}
      <div className={s.actions}>
        <button type="button" className={cx(s.btn, s.ghost)} onClick={onEdit}>
          Изменить
        </button>
      </div>
    </div>
  );
}

/** Отчёт открывается по кнопке, не висит [решение Игоря, 21.10.2026]. */
function ReportGate(props: { sess: PageSession; view: PlanPageView; api: Api }) {
  const [open, setOpen] = useState(false);
  if (open) return <ReportForm {...props} onDone={() => setOpen(false)} />;
  return (
    <div className={s.actions}>
      <button type="button" className={s.btn} onClick={() => setOpen(true)}>
        Отметить
      </button>
    </div>
  );
}

function ReportForm({ sess, view, api, onDone }: { sess: PageSession; view: PlanPageView; api: Api; onDone: () => void }) {
  const prev = sess.report;
  const isQ = sess.role === "quality";
  const [surface, setSurface] = useState<Surface>(prev?.surface ?? view.defaultSurface);
  const [effort, setEffort] = useState<string | null>(view.effortOptions.find((o) => o.label === prev?.effortLabel)?.code ?? null);
  const [pain, setPain] = useState<string>(prev?.pain ? "pain" : "no_pain");
  const [minutes, setMinutes] = useState(prev?.minutes != null ? String(prev.minutes) : "");
  const [km, setKm] = useState(prev?.distanceKm != null ? num(prev.distanceKm) : "");
  const [speed, setSpeed] = useState(prev?.speedKmh != null ? num(prev.speedKmh) : "");
  const [rest, setRest] = useState(prev?.recoverySpeedKmh != null ? num(prev.recoverySpeedKmh) : "");
  const [comment, setComment] = useState(prev?.comment ?? "");
  const [keep, setKeep] = useState<string[]>(prev?.files.map((f) => f.path) ?? []);
  const [added, setAdded] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (!effort) return setErr(`${view.effortQuestion}?`);
    setBusy(true);
    setErr(null);
    const res = await api({
      op: "report",
      report: {
        sessionId: sess.id,
        surface,
        effort,
        pain,
        minutes,
        distanceKm: km,
        speedKmh: speed,
        recoverySpeedKmh: isQ ? rest : "",
        comment,
        keepPaths: keep,
        newFiles: added,
      },
    });
    setBusy(false);
    if (res.ok) onDone();
    else setErr(res.error ?? "Не сохранилось");
  };

  const seg = (opts: [string, string][], val: string | null, set: (v: string) => void) => (
    <div className={s.seg}>
      {opts.map(([v, t]) => (
        <button key={v} type="button" className={cx(s.segB, val === v && s.segOn)} aria-pressed={val === v} onClick={() => set(v)}>
          {t}
        </button>
      ))}
    </div>
  );

  return (
    <div className={s.report}>
      <h4>Отметить</h4>
      {!prev && sess.date > view.todayIso && <p className={s.msg}>Запишется сегодняшним днём, {dayShort(view.todayIso)}</p>}
      <div className={s.fld}>
        <label>Где бегала</label>
        {seg([["street", "Улица"], ["treadmill", "Дорожка"]], surface, (v) => setSurface(v as Surface))}
      </div>
      <div className={s.fld}>
        <label>{view.effortQuestion}</label>
        {seg(view.effortOptions.map((o) => [o.code, o.label]), effort, setEffort)}
      </div>
      <div className={s.fld}>
        <label>Болело</label>
        {seg([["no_pain", "Нет"], ["pain", "Да"]], pain, setPain)}
      </div>
      <div className={r.grid2}>
        {view.isManualEntry && (
          <div className={s.fld}>
            <label>Минуты</label>
            <input className={s.inp} inputMode="numeric" placeholder={String(sess.minutes)} value={minutes} onChange={(e) => setMinutes(e.target.value)} />
          </div>
        )}
        {view.isManualEntry && surface === "street" && (
          <div className={s.fld}>
            <label>Дистанция, км</label>
            <input className={s.inp} inputMode="decimal" value={km} onChange={(e) => setKm(e.target.value)} />
          </div>
        )}
        {view.isManualEntry && surface === "treadmill" && (
          <div className={s.fld}>
            <label>{isQ ? "Отрезки, км/ч" : "Скорость, км/ч"}</label>
            <input className={s.inp} inputMode="decimal" value={speed} onChange={(e) => setSpeed(e.target.value)} />
          </div>
        )}
        {view.isManualEntry && surface === "treadmill" && isQ && (
          <div className={s.fld}>
            <label>Восстановление, км/ч</label>
            <input className={s.inp} inputMode="decimal" value={rest} onChange={(e) => setRest(e.target.value)} />
          </div>
        )}
      </div>
      <div className={s.files}>
        {keep.map((p) => {
          const url = prev?.files.find((f) => f.path === p)?.url;
          return (
            <span key={p} className={s.thumb}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {url && <img src={url} alt="" />}
              <button type="button" className={s.x} onClick={() => setKeep(keep.filter((x) => x !== p))} aria-label="Убрать">
                ×
              </button>
            </span>
          );
        })}
        {added.map((u, i) => (
          <span key={i} className={s.thumb}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={u} alt="" />
            <button type="button" className={s.x} onClick={() => setAdded(added.filter((_, j) => j !== i))} aria-label="Убрать">
              ×
            </button>
          </span>
        ))}
        {keep.length + added.length < 2 && (
          <label className={s.upl}>
            <b>+</b>скриншот
            <input
              type="file"
              accept="image/*"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) setAdded([...added, await shrinkToDataUrl(f)]);
              }}
            />
          </label>
        )}
      </div>
      <div className={s.fld}>
        <textarea className={cx(s.inp, s.ta)} placeholder="Заметка (по желанию)" value={comment} onChange={(e) => setComment(e.target.value)} />
      </div>
      <div className={s.actions}>
        <button type="button" className={s.btn} disabled={busy} onClick={submit}>
          Отправить
        </button>
        <button type="button" className={cx(s.btn, s.ghost)} onClick={onDone}>
          Отмена
        </button>
        {err && <span className={cx(s.msg, s.err)}>{err}</span>}
      </div>
    </div>
  );
}

/** Перенос внутри своей недели. Правила те же, что у мини-аппа (move.ts). */
function MoveSheet({ sess, week, view, api, onClose }: { sess: PageSession; week: PageWeek; view: PlanPageView; api: Api; onClose: () => void }) {
  const [to, setTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const taken = useMemo(() => new Set(week.sessions.filter((x) => x.id !== sess.id).map((x) => x.date)), [week, sess.id]);
  const days = Array.from({ length: 7 }, (_, i) => shift(week.weekStart, i));
  return (
    <>
      <div className={r.veil} onClick={onClose} />
      <div className={r.sheet} role="dialog">
        <div className={r.sheetIn}>
          <h3>{sess.title}</h3>
          <div className={r.days7}>
            {days.map((iso, i) => (
              <button
                key={iso}
                type="button"
                className={cx(r.day7, (to ?? sess.date) === iso && r.day7On)}
                disabled={iso < view.todayIso || taken.has(iso)}
                onClick={() => setTo(iso)}
              >
                <small>{WD7[i]}</small>
                <b>{pd(iso).getDate()}</b>
              </button>
            ))}
          </div>
          <div className={s.actions}>
            <button
              type="button"
              className={s.btn}
              disabled={busy || !to || to === sess.date}
              onClick={async () => {
                setBusy(true);
                const res = await api({ op: "move", sessionId: sess.id, toDate: to });
                setBusy(false);
                if (res.ok) onClose();
                else setErr(res.error ?? "Не перенеслось");
              }}
            >
              Перенести
            </button>
            {err && <span className={cx(s.msg, s.err)}>{err}</span>}
          </div>
        </div>
      </div>
    </>
  );
}

/** «Каждую неделю»: тап — бегаю, ещё тап — длительная, ещё тап — убрать. */
function MyDays({ view, api }: { view: PlanPageView; api: Api }) {
  const [avail, setAvail] = useState<number[]>(view.days.available);
  const [long, setLong] = useState<number | null>(view.days.long);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ t: string; err?: boolean } | null>(null);
  const tap = (d: number) => {
    setMsg(null);
    if (!avail.includes(d)) return setAvail([...avail, d].sort());
    if (long !== d) return setLong(d);
    setLong(null);
    setAvail(avail.filter((x) => x !== d));
  };
  return (
    <section className={s.list}>
      <div className={r.wkd}>
        {WD7.map((t, d) => (
          <button key={d} type="button" className={cx(r.wkdB, avail.includes(d) && (long === d ? r.wkdLong : r.wkdOn))} onClick={() => tap(d)}>
            {t}
          </button>
        ))}
      </div>
      <div className={r.legend}>
        <span>
          <i style={{ background: "var(--ink)" }} />
          бегаю
        </span>
        <span>
          <i style={{ background: "var(--t-long)" }} />
          длительная
        </span>
      </div>
      <div className={s.actions}>
        <button
          type="button"
          className={s.btn}
          disabled={busy || avail.length === 0}
          onClick={async () => {
            setBusy(true);
            const res = await api({ op: "days", available: avail, long });
            setBusy(false);
            setMsg(res.ok ? { t: "Сохранено" } : { t: res.error ?? "Не сохранилось", err: true });
          }}
        >
          Сохранить
        </button>
        {msg && <span className={cx(s.msg, msg.err && s.err)}>{msg.t}</span>}
      </div>
    </section>
  );
}

function CoachTab({ view, api, onSession }: { view: PlanPageView; api: Api; onSession: (id: string) => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const items = [
    ...view.coachFeed.map((x) => ({ k: "c" as const, at: x.at, x })),
    ...view.myMessages.map((x) => ({ k: "m" as const, at: x.at, x })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  return (
    <section className={r.feed}>
      <div className={r.write}>
        <textarea className={cx(s.inp, s.ta)} placeholder="Написать тренеру" value={text} onChange={(e) => setText(e.target.value)} />
        <button
          type="button"
          className={s.btn}
          disabled={busy || !text.trim()}
          onClick={async () => {
            setBusy(true);
            const res = await api({ op: "message", text });
            setBusy(false);
            if (res.ok) setText("");
            else setErr(res.error ?? "Не отправилось");
          }}
        >
          →
        </button>
      </div>
      {err && <span className={cx(s.msg, s.err)}>{err}</span>}
      {items.length === 0 && <div className={s.empty}>Пока пусто</div>}
      {items.map((it) =>
        it.k === "m" ? (
          <div key={`m-${it.x.id}`} className={r.fi} style={{ alignItems: "flex-end" }}>
            <div className={r.mine}>{it.x.body}</div>
            <div className={r.mineAt}>{dayShort(it.at.slice(0, 10))}</div>
          </div>
        ) : (
          <div key={`c-${it.x.id}`} className={r.fi}>
            <button type="button" className={r.fiH} disabled={!it.x.sessionId} onClick={() => it.x.sessionId && onSession(it.x.sessionId)}>
              {it.x.isNew && <span className={r.dot} />}
              {it.x.sessionDate ? `${dayShort(it.x.sessionDate)} · ${it.x.sessionTitle}` : dayShort(it.at.slice(0, 10))}
            </button>
            <CoachBlock body={it.x.body} at={it.x.at} week={it.x.isWeekReview} />
          </div>
        ),
      )}
    </section>
  );
}
