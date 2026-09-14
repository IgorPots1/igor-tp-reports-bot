"use client";

/**
 * Экран ученика: анкета один раз, дальше — тренировка на сегодня, ближайшие
 * дни, ступень и чек-ин.
 *
 * ЧЕГО ЗДЕСЬ НЕТ И НЕ ДОЛЖНО БЫТЬ: графиков, недельных объёмов, пульсовых зон.
 * Новичку график недельных минут не говорит ничего, кроме «цифра маленькая»,
 * а сравнение с прошлой неделей на третьей неделе жизни в беге — это способ
 * расстроиться, а не измерить.
 */

import { useCallback, useEffect, useState } from "react";

type TelegramWebApp = {
  initData: string;
  ready: () => void;
  expand: () => void;
  colorScheme?: "light" | "dark";
};

function getTelegram(): TelegramWebApp | null {
  const w = window as unknown as { Telegram?: { WebApp?: TelegramWebApp } };
  return w.Telegram?.WebApp ?? null;
}

type EffortOption = { code: string; labelRu: string; hintRu: string; rpe: number };
type PainOption = { code: string; labelRu: string; hintRu: string; pain: boolean };

type SessionCard = {
  sessionId: string;
  date: string;
  dateLabel: string;
  weekdayLabel: string;
  title: string;
  minutes: number;
  description: string | null;
  checkedIn: boolean;
  checkinLabel: string | null;
  moveTargets: Array<{ date: string; label: string }>;
  movedFrom: string | null;
};

type LadderView = {
  step: number;
  totalSteps: number;
  labelRu: string;
  nextLabelRu: string | null;
  sessionsAtStep: number;
  progressNoteRu: string;
};

type View =
  | { state: "no_plan"; messageRu: string }
  | {
      state: "ready";
      today: SessionCard | null;
      upcoming: SessionCard[];
      ladder: LadderView | null;
      canLogUnplanned: boolean;
      effortOptions: EffortOption[];
      painOptions: PainOption[];
      restNoteRu: string | null;
    };

const BG = "#F6F4EF";
const INK = "#16150F";
const ACCENT = "#E5480E";
const GREEN = "#2E7D45";
const MUTED = "#6C675A";
const LINE = "#E2DDD1";

const DAYS = [
  { idx: 0, label: "Пн" },
  { idx: 1, label: "Вт" },
  { idx: 2, label: "Ср" },
  { idx: 3, label: "Чт" },
  { idx: 4, label: "Пт" },
  { idx: 5, label: "Сб" },
  { idx: 6, label: "Вс" },
];

export default function RunAppPage() {
  const [initData, setInitData] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  // Поля, которые ученица вообще увидит. Приходят с сервера списком того, что
  // ПОКАЗАТЬ, а не того, что скрыть: скрывать на клиенте значит сначала отдать
  // наружу то, чего человек видеть не должен.
  const [formFields, setFormFields] = useState<string[]>([]);
  const [presetGoal, setPresetGoal] = useState<string | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    let tries = 0;
    const tick = () => {
      const tg = getTelegram();
      if (tg?.initData) {
        tg.ready();
        tg.expand();
        setInitData(tg.initData);
        return;
      }
      tries += 1;
      if (tries > 40) {
        setLoading(false);
        setError("Открой приложение из Telegram.");
        return;
      }
      window.setTimeout(tick, 100);
    };
    tick();
  }, []);

  const load = useCallback(async (data: string) => {
    setLoading(true);
    try {
      const res = await fetch("/api/m/run/state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initData: data }),
      });
      const json = (await res.json()) as {
        ok: boolean;
        error?: string;
        needsOnboarding?: boolean;
        formFields?: string[];
        presetGoalKind?: string | null;
        view?: View;
      };
      if (!json.ok) {
        setError(json.error ?? "Не получилось загрузить.");
        return;
      }
      setError(null);
      setNeedsOnboarding(json.needsOnboarding === true);
      setFormFields(json.formFields ?? []);
      setPresetGoal(json.presetGoalKind ?? null);
      setView(json.view ?? null);
    } catch {
      setError("Нет связи. Попробуй ещё раз.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (initData) void load(initData);
  }, [initData, load]);

  if (loading) {
    return <Shell><p style={{ color: MUTED }}>Загружаю…</p></Shell>;
  }
  if (error) {
    return <Shell><p style={{ color: ACCENT, fontWeight: 600 }}>{error}</p></Shell>;
  }
  if (needsOnboarding && initData) {
    return (
      <Shell>
        <OnboardingForm
          fields={formFields}
          presetGoal={presetGoal}
          initData={initData}
          onDone={(note) => {
            setToast(note);
            void load(initData);
          }}
        />
      </Shell>
    );
  }
  if (!view) {
    return <Shell><p style={{ color: MUTED }}>Пока пусто.</p></Shell>;
  }

  return (
    <Shell>
      {toast ? <Banner text={toast} /> : null}
      {view.state === "no_plan" ? (
        <Banner text={view.messageRu} />
      ) : (
        <PlanScreen
          view={view}
          initData={initData ?? ""}
          onChanged={(note) => {
            setToast(note);
            if (initData) void load(initData);
          }}
        />
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main
      style={{
        minHeight: "100vh",
        background: BG,
        color: INK,
        padding: "20px 16px 48px",
        fontFamily: "var(--font-montserrat), system-ui, sans-serif",
        maxWidth: 560,
        margin: "0 auto",
      }}
    >
      {children}
    </main>
  );
}

function Banner({ text }: { text: string }) {
  return (
    <p
      style={{
        background: "#fff",
        border: `1px solid ${LINE}`,
        borderRadius: 12,
        padding: "12px 14px",
        margin: "0 0 16px",
        lineHeight: 1.5,
      }}
    >
      {text}
    </p>
  );
}

// ── Анкета ───────────────────────────────────────────────────────────────────

function OnboardingForm(props: {
  initData: string;
  fields: string[];
  presetGoal: string | null;
  onDone: (note: string) => void;
}) {
  // Поле, которого нет в списке, тренер задал за ученицу. Оно не рисуется и не
  // отправляется: «спрятать, но прислать» оставило бы в базе значение, которого
  // человек не выбирал.
  const shows = (field: string) => props.fields.includes(field);
  // Цель, заданную тренером, форма не показывает, но знать её обязана: от неё
  // зависит, спрашивать ли дату старта и вопрос про непрерывный бег.
  const [goalKind, setGoalKind] = useState(props.presetGoal ?? "start_running");
  const [raceDate, setRaceDate] = useState("");
  const [raceKm, setRaceKm] = useState("");
  const [days, setDays] = useState(3);
  const [unavailable, setUnavailable] = useState<number[]>([]);
  const [longDay, setLongDay] = useState<number | null>(null);
  const [canRun, setCanRun] = useState<boolean | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const toggleDay = (idx: number) =>
    setUnavailable((prev) => (prev.includes(idx) ? prev.filter((d) => d !== idx) : [...prev, idx]));

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/m/run/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          initData: props.initData,
          answers: {
            ...(shows("goalKind") ? { goalKind } : {}),
            ...(shows("raceDate") && goalKind === "race" ? { raceDate } : {}),
            ...(shows("raceDistanceKm") && goalKind === "race" ? { raceDistanceKm: raceKm } : {}),
            ...(shows("daysPerWeek") ? { daysPerWeek: days } : {}),
            ...(shows("unavailableWeekdays") ? { unavailableWeekdays: unavailable } : {}),
            ...(shows("preferredLongWeekday") ? { preferredLongWeekday: longDay } : {}),
            ...(shows("canRunContinuously") && goalKind === "start_running"
              ? { canRunContinuously: canRun }
              : {}),
            coachNote: note,
          },
        }),
      });
      const json = (await res.json()) as { ok: boolean; error?: string; noteRu?: string };
      if (!json.ok) {
        setErr(json.error ?? "Не получилось сохранить.");
        return;
      }
      props.onDone(json.noteRu ?? "Анкета сохранена.");
    } catch {
      setErr("Нет связи. Попробуй ещё раз.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <h1 style={{ fontSize: 22, margin: "0 0 6px" }}>Пара вопросов — и соберём план</h1>
      <p style={{ color: MUTED, margin: "0 0 22px", lineHeight: 1.5 }}>
        Отвечать один раз. Если что-то поменяется — скажешь тренеру, поправим.
      </p>

      {shows("goalKind") ? (
      <Field label="Что впереди?">
        <Choice value={goalKind} onChange={setGoalKind} options={[
          { value: "start_running", label: "Хочу начать бегать" },
          { value: "regular", label: "Просто бегать регулярно" },
          { value: "race", label: "Готовлюсь к старту" },
        ]} />
      </Field>
      ) : null}

      {goalKind === "race" && (shows("raceDate") || shows("raceDistanceKm")) ? (
        <Field label="Когда старт и какая дистанция">
          <div style={{ display: "flex", gap: 8 }}>
            <input type="date" value={raceDate} onChange={(e) => setRaceDate(e.target.value)} style={inputStyle} />
            <input
              type="number"
              inputMode="decimal"
              placeholder="км"
              value={raceKm}
              onChange={(e) => setRaceKm(e.target.value)}
              style={{ ...inputStyle, maxWidth: 100 }}
            />
          </div>
        </Field>
      ) : null}

      {goalKind === "start_running" && shows("canRunContinuously") ? (
        <Field
          label="Можешь сейчас бежать без остановки хотя бы 20 минут?"
          hint="Честный ответ важнее удобного: от него зависит самая первая тренировка."
        >
          <Choice
            value={canRun === null ? "" : canRun ? "yes" : "no"}
            onChange={(v) => setCanRun(v === "yes")}
            options={[
              { value: "no", label: "Нет, пока с передышками" },
              { value: "yes", label: "Да, могу" },
            ]}
          />
        </Field>
      ) : null}

      {shows("daysPerWeek") ? (
      <Field label="Сколько дней в неделю готова бегать?">
        <Choice
          value={String(days)}
          onChange={(v) => setDays(Number(v))}
          options={[
            { value: "2", label: "2" },
            { value: "3", label: "3" },
            { value: "4", label: "4" },
            { value: "5", label: "5" },
          ]}
        />
      </Field>
      ) : null}

      {shows("unavailableWeekdays") ? (
      <Field label="В какие дни бегать точно не получится?" hint="Можно ничего не выбирать.">
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {DAYS.map((d) => (
            <button
              key={d.idx}
              type="button"
              onClick={() => toggleDay(d.idx)}
              style={chipStyle(unavailable.includes(d.idx))}
            >
              {d.label}
            </button>
          ))}
        </div>
      </Field>
      ) : null}

      {shows("preferredLongWeekday") ? (
      <Field label="Какой день удобнее для самой длинной тренировки?" hint="Если всё равно — не выбирай.">
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {DAYS.filter((d) => !unavailable.includes(d.idx)).map((d) => (
            <button
              key={d.idx}
              type="button"
              onClick={() => setLongDay(longDay === d.idx ? null : d.idx)}
              style={chipStyle(longDay === d.idx)}
            >
              {d.label}
            </button>
          ))}
        </div>
      </Field>
      ) : null}

      <Field
        label="Что важно знать тренеру?"
        hint="Всё, что не влезло в вопросы выше: здоровье, страхи, режим, прошлый опыт. Это читает человек."
      >
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={4}
          style={{ ...inputStyle, resize: "vertical" }}
        />
      </Field>

      {err ? <p style={{ color: ACCENT, fontWeight: 600, lineHeight: 1.5 }}>{err}</p> : null}

      <button type="button" onClick={submit} disabled={busy} style={primaryButtonStyle(busy)}>
        {busy ? "Сохраняю…" : "Готово"}
      </button>
    </div>
  );
}

// ── План ─────────────────────────────────────────────────────────────────────

function PlanScreen(props: {
  view: Extract<View, { state: "ready" }>;
  initData: string;
  onChanged: (note: string) => void;
}) {
  const { view } = props;
  return (
    <div>
      {view.ladder ? <LadderBlock ladder={view.ladder} /> : null}

      <h2 style={{ fontSize: 18, margin: "22px 0 10px" }}>Сегодня</h2>
      {view.today ? (
        <SessionBlock
          card={view.today}
          initData={props.initData}
          effortOptions={view.effortOptions}
          painOptions={view.painOptions}
          onChanged={props.onChanged}
          isToday
        />
      ) : (
        <Banner text={view.restNoteRu ?? "Сегодня тренировки нет."} />
      )}

      {view.canLogUnplanned ? (
        <UnplannedCheckin
          initData={props.initData}
          effortOptions={view.effortOptions}
          painOptions={view.painOptions}
          onChanged={props.onChanged}
        />
      ) : null}

      {view.upcoming.length > 0 ? (
        <>
          <h2 style={{ fontSize: 18, margin: "26px 0 10px" }}>Дальше</h2>
          {view.upcoming.map((card) => (
            <SessionBlock
              key={card.sessionId}
              card={card}
              initData={props.initData}
              effortOptions={view.effortOptions}
              painOptions={view.painOptions}
              onChanged={props.onChanged}
              isToday={false}
            />
          ))}
        </>
      ) : null}
    </div>
  );
}

function LadderBlock({ ladder }: { ladder: LadderView }) {
  return (
    <section
      style={{
        background: "#fff",
        border: `1px solid ${LINE}`,
        borderRadius: 14,
        padding: "14px 16px",
      }}
    >
      <p style={{ margin: 0, color: MUTED, fontSize: 13, letterSpacing: 0.4, textTransform: "uppercase" }}>
        Ступень {ladder.step} из {ladder.totalSteps}
      </p>
      <p style={{ margin: "6px 0 0", fontSize: 19, fontWeight: 700 }}>{ladder.labelRu}</p>
      <div style={{ display: "flex", gap: 4, margin: "12px 0 10px" }}>
        {Array.from({ length: ladder.totalSteps }, (_, i) => (
          <span
            key={i}
            style={{
              flex: 1,
              height: 6,
              borderRadius: 3,
              background: i < ladder.step ? GREEN : LINE,
            }}
          />
        ))}
      </div>
      <p style={{ margin: 0, color: MUTED, lineHeight: 1.5, fontSize: 14 }}>{ladder.progressNoteRu}</p>
    </section>
  );
}

function SessionBlock(props: {
  card: SessionCard;
  initData: string;
  effortOptions: EffortOption[];
  painOptions: PainOption[];
  onChanged: (note: string) => void;
  isToday: boolean;
}) {
  const { card } = props;
  const [openCheckin, setOpenCheckin] = useState(false);
  const [openMove, setOpenMove] = useState(false);

  return (
    <article
      style={{
        background: "#fff",
        border: `1px solid ${LINE}`,
        borderRadius: 14,
        padding: "14px 16px",
        marginBottom: 10,
      }}
    >
      <p style={{ margin: 0, color: MUTED, fontSize: 13 }}>
        {card.weekdayLabel}, {card.dateLabel}
        {card.movedFrom ? " · перенесена" : ""}
      </p>
      <p style={{ margin: "4px 0 0", fontSize: 17, fontWeight: 700 }}>{card.title}</p>
      <p style={{ margin: "2px 0 0", color: MUTED, fontSize: 14 }}>{card.minutes} мин</p>
      {card.description ? (
        <p style={{ margin: "10px 0 0", lineHeight: 1.5, fontSize: 15 }}>{card.description}</p>
      ) : null}

      {card.checkedIn ? (
        <p style={{ margin: "12px 0 0", color: GREEN, fontWeight: 600, fontSize: 14 }}>
          ✓ отмечено: {card.checkinLabel}
        </p>
      ) : (
        <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
          {props.isToday ? (
            <button type="button" onClick={() => setOpenCheckin((v) => !v)} style={secondaryButtonStyle}>
              {openCheckin ? "Свернуть" : "Как прошло?"}
            </button>
          ) : null}
          {card.moveTargets.length > 0 ? (
            <button type="button" onClick={() => setOpenMove((v) => !v)} style={secondaryButtonStyle}>
              {openMove ? "Свернуть" : "Перенести"}
            </button>
          ) : null}
        </div>
      )}

      {openCheckin && !card.checkedIn ? (
        <CheckinForm
          initData={props.initData}
          sessionId={card.sessionId}
          effortOptions={props.effortOptions}
          painOptions={props.painOptions}
          onChanged={props.onChanged}
        />
      ) : null}

      {openMove ? (
        <MoveForm
          initData={props.initData}
          sessionId={card.sessionId}
          targets={card.moveTargets}
          onChanged={props.onChanged}
        />
      ) : null}
    </article>
  );
}

function UnplannedCheckin(props: {
  initData: string;
  effortOptions: EffortOption[];
  painOptions: PainOption[];
  onChanged: (note: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginTop: 10 }}>
      <button type="button" onClick={() => setOpen((v) => !v)} style={secondaryButtonStyle}>
        {open ? "Свернуть" : "Я всё равно бегала — отметиться"}
      </button>
      {open ? (
        <div
          style={{
            background: "#fff",
            border: `1px solid ${LINE}`,
            borderRadius: 14,
            padding: "14px 16px",
            marginTop: 10,
          }}
        >
          <CheckinForm
            initData={props.initData}
            sessionId={null}
            effortOptions={props.effortOptions}
            painOptions={props.painOptions}
            onChanged={props.onChanged}
          />
        </div>
      ) : null}
    </div>
  );
}

function CheckinForm(props: {
  initData: string;
  sessionId: string | null;
  effortOptions: EffortOption[];
  painOptions: PainOption[];
  onChanged: (note: string) => void;
}) {
  const [effort, setEffort] = useState<string | null>(null);
  const [pain, setPain] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (!effort || !pain) {
      setErr("Ответь на оба вопроса.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/m/run/checkin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          initData: props.initData,
          sessionId: props.sessionId,
          effort,
          pain,
          comment,
        }),
      });
      const json = (await res.json()) as { ok: boolean; error?: string; replyRu?: string };
      if (!json.ok) {
        setErr(json.error ?? "Не получилось сохранить.");
        return;
      }
      props.onChanged(json.replyRu ?? "Записал.");
    } catch {
      setErr("Нет связи. Попробуй ещё раз.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ marginTop: 14, borderTop: `1px solid ${LINE}`, paddingTop: 14 }}>
      <p style={{ margin: "0 0 8px", fontWeight: 600 }}>Как далось?</p>
      <div style={{ display: "grid", gap: 6 }}>
        {props.effortOptions.map((option) => (
          <button
            key={option.code}
            type="button"
            onClick={() => setEffort(option.code)}
            style={optionStyle(effort === option.code)}
          >
            <span style={{ fontWeight: 600 }}>{option.labelRu}</span>
            <span style={{ display: "block", color: MUTED, fontSize: 13, marginTop: 2 }}>{option.hintRu}</span>
          </button>
        ))}
      </div>

      <p style={{ margin: "16px 0 8px", fontWeight: 600 }}>Что-то беспокоило?</p>
      <div style={{ display: "grid", gap: 6 }}>
        {props.painOptions.map((option) => (
          <button
            key={option.code}
            type="button"
            onClick={() => setPain(option.code)}
            style={optionStyle(pain === option.code)}
          >
            <span style={{ fontWeight: 600 }}>{option.labelRu}</span>
            <span style={{ display: "block", color: MUTED, fontSize: 13, marginTop: 2 }}>{option.hintRu}</span>
          </button>
        ))}
      </div>

      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        rows={3}
        placeholder="Хочешь что-то добавить? Необязательно."
        style={{ ...inputStyle, marginTop: 14, resize: "vertical" }}
      />

      {err ? <p style={{ color: ACCENT, fontWeight: 600 }}>{err}</p> : null}
      <button type="button" onClick={submit} disabled={busy} style={primaryButtonStyle(busy)}>
        {busy ? "Сохраняю…" : "Отправить"}
      </button>
    </div>
  );
}

function MoveForm(props: {
  initData: string;
  sessionId: string;
  targets: Array<{ date: string; label: string }>;
  onChanged: (note: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const move = async (toDate: string) => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/m/run/move", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initData: props.initData, sessionId: props.sessionId, toDate }),
      });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!json.ok) {
        setErr(json.error ?? "Не получилось перенести.");
        return;
      }
      props.onChanged("Перенесла. План обновлён.");
    } catch {
      setErr("Нет связи. Попробуй ещё раз.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ marginTop: 14, borderTop: `1px solid ${LINE}`, paddingTop: 14 }}>
      <p style={{ margin: "0 0 8px", fontWeight: 600 }}>На какой день?</p>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {props.targets.map((target) => (
          <button
            key={target.date}
            type="button"
            disabled={busy}
            onClick={() => move(target.date)}
            style={chipStyle(false)}
          >
            {target.label}
          </button>
        ))}
      </div>
      <p style={{ margin: "10px 0 0", color: MUTED, fontSize: 13, lineHeight: 1.5 }}>
        Переносить можно внутри недели и только на свободные дни — неделя это доза нагрузки.
      </p>
      {err ? <p style={{ color: ACCENT, fontWeight: 600 }}>{err}</p> : null}
    </div>
  );
}

// ── Мелочь оформления ────────────────────────────────────────────────────────

function Field(props: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <p style={{ margin: "0 0 6px", fontWeight: 600 }}>{props.label}</p>
      {props.hint ? (
        <p style={{ margin: "0 0 8px", color: MUTED, fontSize: 13, lineHeight: 1.4 }}>{props.hint}</p>
      ) : null}
      {props.children}
    </div>
  );
}

function Choice(props: {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {props.options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => props.onChange(option.value)}
          style={chipStyle(props.value === option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "10px 12px",
  borderRadius: 10,
  border: `1px solid ${LINE}`,
  background: "#fff",
  color: INK,
  fontSize: 16,
  fontFamily: "inherit",
};

function chipStyle(active: boolean): React.CSSProperties {
  return {
    padding: "9px 14px",
    borderRadius: 999,
    border: `1px solid ${active ? ACCENT : LINE}`,
    background: active ? ACCENT : "#fff",
    color: active ? "#fff" : INK,
    fontSize: 15,
    fontFamily: "inherit",
    cursor: "pointer",
  };
}

function optionStyle(active: boolean): React.CSSProperties {
  return {
    textAlign: "left",
    padding: "10px 12px",
    borderRadius: 10,
    border: `1px solid ${active ? ACCENT : LINE}`,
    background: active ? "#FDEFE9" : "#fff",
    color: INK,
    fontSize: 15,
    fontFamily: "inherit",
    cursor: "pointer",
  };
}

function primaryButtonStyle(busy: boolean): React.CSSProperties {
  return {
    marginTop: 16,
    width: "100%",
    padding: "13px 16px",
    borderRadius: 12,
    border: "none",
    background: busy ? MUTED : ACCENT,
    color: "#fff",
    fontSize: 16,
    fontWeight: 700,
    fontFamily: "inherit",
    cursor: busy ? "default" : "pointer",
  };
}

const secondaryButtonStyle: React.CSSProperties = {
  padding: "9px 14px",
  borderRadius: 10,
  border: `1px solid ${LINE}`,
  background: "#fff",
  color: INK,
  fontSize: 15,
  fontFamily: "inherit",
  cursor: "pointer",
};
