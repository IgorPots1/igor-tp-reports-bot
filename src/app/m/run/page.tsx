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

import {
  SESSION_CAP_OPTIONS,
  SURFACE_OPTIONS,
  TIME_OF_DAY_OPTIONS,
  WEEK_STABILITY_OPTIONS,
} from "@/features/intervals/loop/schedule";

type TelegramWebApp = {
  initData: string;
  ready: () => void;
  expand: () => void;
  colorScheme?: "light" | "dark";
  /** Внешний браузер Telegram. Окно согласия провайдера внутри webview не откроется. */
  openLink?: (url: string, options?: { try_instant_view?: boolean }) => void;
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

const WEEK_STABILITY = WEEK_STABILITY_OPTIONS;
const TIME_OF_DAY = TIME_OF_DAY_OPTIONS;
const SURFACES = SURFACE_OPTIONS;
const SESSION_CAPS = SESSION_CAP_OPTIONS;

/**
 * Зона берётся у браузера и уходит на сервер с каждым запросом. Спрашиваем её
 * только если тут ничего не вышло: вопрос, на который машина знает ответ, —
 * плохой вопрос.
 */
function detectTimeZone(): string | null {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof zone === "string" && zone.length > 0 ? zone : null;
  } catch {
    return null;
  }
}

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
  const [needsConnection, setNeedsConnection] = useState(false);
  const [connectionLost, setConnectionLost] = useState<string | null>(null);
  // Поля, которые ученица вообще увидит. Приходят с сервера списком того, что
  // ПОКАЗАТЬ, а не того, что скрыть: скрывать на клиенте значит сначала отдать
  // наружу то, чего человек видеть не должен.
  const [formFields, setFormFields] = useState<string[]>([]);
  const [presetGoal, setPresetGoal] = useState<string | null>(null);
  const [needsTimezone, setNeedsTimezone] = useState(false);
  const [timezoneOptions, setTimezoneOptions] = useState<Array<{ zone: string; labelRu: string }>>([]);
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
        setError("Откройте приложение из Telegram.");
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
        body: JSON.stringify({ initData: data, timeZone: detectTimeZone() }),
      });
      const json = (await res.json()) as {
        ok: boolean;
        error?: string;
        needsOnboarding?: boolean;
        needsConnection?: boolean;
        connectionLostRu?: string | null;
        formFields?: string[];
        presetGoalKind?: string | null;
        needsTimezone?: boolean;
        timezoneOptions?: Array<{ zone: string; labelRu: string }>;
        view?: View;
      };
      if (!json.ok) {
        setError(json.error ?? "Не получилось загрузить.");
        return;
      }
      setError(null);
      setNeedsOnboarding(json.needsOnboarding === true);
      setNeedsConnection(json.needsConnection === true);
      setConnectionLost(json.connectionLostRu ?? null);
      setFormFields(json.formFields ?? []);
      setPresetGoal(json.presetGoalKind ?? null);
      setNeedsTimezone(json.needsTimezone === true);
      setTimezoneOptions(json.timezoneOptions ?? []);
      setView(json.view ?? null);
    } catch {
      setError("Нет связи. Попробуйте ещё раз.");
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
  if (needsConnection && initData) {
    return (
      <Shell>
        <ConnectScreen initData={initData} lostRu={connectionLost} onRetry={() => void load(initData)} />
      </Shell>
    );
  }
  if (needsOnboarding && initData) {
    return (
      <Shell>
        <OnboardingForm
          fields={formFields}
          presetGoal={presetGoal}
          needsTimezone={needsTimezone}
          timezoneOptions={timezoneOptions}
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

function ConnectScreen(props: {
  initData: string;
  lostRu: string | null;
  onRetry: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const connect = async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/m/run/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initData: props.initData }),
      });
      const json = (await res.json()) as { ok: boolean; url?: string; error?: string };
      if (!json.ok || !json.url) {
        setErr(json.error ?? "Не получилось начать подключение.");
        return;
      }
      // Открываем во внешнем браузере Telegram: окно согласия Intervals внутри
      // мини-приложения не откроется, а после разрешения человеку нужно
      // вернуться сюда и нажать «Я подключил(а)».
      const tg = getTelegram();
      if (tg?.openLink) tg.openLink(json.url);
      else window.open(json.url, "_blank");
    } catch {
      setErr("Нет связи. Попробуйте ещё раз.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <h1 style={{ fontSize: 22, margin: "0 0 6px" }}>Подключим часы</h1>
      <p style={{ color: MUTED, margin: "0 0 18px", lineHeight: 1.5 }}>
        Тренер строит план по вашим тренировкам, поэтому начинаем с подключения. Одно нажатие:
        откроется Intervals.icu, вы нажмёте «Разрешить» и вернётесь сюда. Копировать ничего не
        нужно.
      </p>

      {props.lostRu ? <Banner text={props.lostRu} /> : null}

      <div
        style={{
          background: "#fff",
          border: `1px solid ${LINE}`,
          borderRadius: 14,
          padding: "14px 16px",
          marginBottom: 16,
        }}
      >
        <p style={{ margin: 0, fontWeight: 600 }}>Что мы будем видеть</p>
        <ul style={{ margin: "8px 0 0", paddingLeft: 18, color: MUTED, lineHeight: 1.6, fontSize: 14 }}>
          <li>ваши тренировки и их данные</li>
          <li>самочувствие: пульс покоя, сон, вес</li>
          <li>календарь, чтобы класть туда план</li>
        </ul>
        <p style={{ margin: "10px 0 0", color: MUTED, fontSize: 13, lineHeight: 1.5 }}>
          Пароль от Intervals.icu мы не видим и не храним. Отозвать доступ можно в любой момент в
          настройках Intervals.icu.
        </p>
      </div>

      {err ? <p style={{ color: ACCENT, fontWeight: 600, lineHeight: 1.5 }}>{err}</p> : null}

      <button type="button" onClick={connect} disabled={busy} style={primaryButtonStyle(busy)}>
        {busy ? "Открываю…" : "Подключить часы"}
      </button>

      <button
        type="button"
        onClick={props.onRetry}
        style={{ ...secondaryButtonStyle, marginTop: 10, width: "100%" }}
      >
        Я подключил(а), проверить
      </button>
    </div>
  );
}

// ── Настройка графика ────────────────────────────────────────────────────────
//
// НЕ АНКЕТА-ЗНАКОМСТВО. Опыт, травмы, история бега, цели живут в развёрнутой
// анкете ДО приложения (интенсив или форма тренера) и приезжают сюда
// предзаполнением. Здесь спрашиваем только то, чего генератор не берёт из
// данных и чего тренер не знает про человека: расписание.

function OnboardingForm(props: {
  initData: string;
  fields: string[];
  presetGoal: string | null;
  needsTimezone: boolean;
  timezoneOptions: Array<{ zone: string; labelRu: string }>;
  onDone: (note: string) => void;
}) {
  // Поле, которого нет в списке, тренер задал за человека либо оно вообще не
  // задаётся в приложении. Оно не рисуется и не отправляется: «спрятать, но
  // прислать» оставило бы в базе значение, которого человек не выбирал.
  const shows = (field: string) => props.fields.includes(field);

  const [stability, setStability] = useState<string | null>(null);
  const [free, setFree] = useState<number[]>([]);
  const [busy, setBusy] = useState<number[]>([]);
  const [longDay, setLongDay] = useState<number | null>(null);
  const [qualityDay, setQualityDay] = useState<number | null>(null);
  const [timeOfDay, setTimeOfDay] = useState<string | null>(null);
  const [surfaces, setSurfaces] = useState<string[]>([]);
  const [breakers, setBreakers] = useState("");
  const [sessionCap, setSessionCap] = useState<string | null>(null);
  const [zone, setZone] = useState<string | null>(null);
  const [goalKind, setGoalKind] = useState(props.presetGoal ?? "");
  const [raceDate, setRaceDate] = useState("");
  const [raceKm, setRaceKm] = useState("");
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Неделя плавающая: расписанием дальше не мучаем. Человек со сменным
  // графиком назовёт удобные дни, а через неделю они будут другими, и план,
  // построенный на этом ответе, он нарушит и сочтёт себя виноватым.
  const asksSchedule = stability === "stable";

  const toggleDay = (day: number, target: "free" | "busy") => {
    if (target === "free") {
      setBusy((prev) => prev.filter((d) => d !== day));
      setFree((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]));
    } else {
      setFree((prev) => prev.filter((d) => d !== day));
      setBusy((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]));
    }
  };

  const toggleSurface = (value: string) =>
    setSurfaces((prev) => (prev.includes(value) ? prev.filter((s) => s !== value) : [...prev, value]));

  const submit = async () => {
    setSending(true);
    setErr(null);
    try {
      const res = await fetch("/api/m/run/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          initData: props.initData,
          timeZone: detectTimeZone(),
          answers: {
            ...(shows("weekStability") ? { weekStability: stability } : {}),
            ...(shows("availableWeekdays") && asksSchedule ? { availableWeekdays: free } : {}),
            ...(shows("unavailableWeekdays") && asksSchedule ? { unavailableWeekdays: busy } : {}),
            ...(shows("preferredLongWeekday") && asksSchedule ? { preferredLongWeekday: longDay } : {}),
            ...(shows("preferredQualityWeekday") && asksSchedule
              ? { preferredQualityWeekday: qualityDay }
              : {}),
            ...(shows("timeOfDay") ? { timeOfDay } : {}),
            ...(shows("runSurfaces") ? { runSurfaces: surfaces } : {}),
            ...(shows("weekBreakers") ? { weekBreakers: breakers } : {}),
            ...(shows("maxSessionMinutes") ? { maxSessionCap: sessionCap } : {}),
            ...(props.needsTimezone && zone ? { timezone: zone } : {}),
            ...(shows("goalKind") && goalKind ? { goalKind } : {}),
            ...(shows("raceDate") && goalKind === "race" ? { raceDate } : {}),
            ...(shows("raceDistanceKm") && goalKind === "race" ? { raceDistanceKm: raceKm } : {}),
          },
        }),
      });
      const json = (await res.json()) as { ok: boolean; error?: string; noteRu?: string };
      if (!json.ok) {
        setErr(json.error ?? "Не получилось сохранить.");
        return;
      }
      props.onDone(json.noteRu ?? "Сохранено.");
    } catch {
      setErr("Нет связи. Попробуйте ещё раз.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div>
      <h1 style={{ fontSize: 22, margin: "0 0 6px" }}>Настроим график</h1>
      <p style={{ color: MUTED, margin: "0 0 22px", lineHeight: 1.5 }}>
        Всё остальное тренер про вас уже знает. Здесь только про то, когда и где вам удобно
        бегать. Если что-то поменяется, скажите тренеру, поправим.
      </p>

      {shows("weekStability") ? (
        <Field label="Ваша неделя обычно одинаковая?">
          <div style={{ display: "grid", gap: 6 }}>
            {WEEK_STABILITY.map((option) => (
              <button
                key={option.code}
                type="button"
                onClick={() => setStability(option.code)}
                style={optionStyle(stability === option.code)}
              >
                <span style={{ fontWeight: 600 }}>{option.labelRu}</span>
                <span style={{ display: "block", color: MUTED, fontSize: 13, marginTop: 2 }}>
                  {option.hintRu}
                </span>
              </button>
            ))}
          </div>
        </Field>
      ) : null}

      {stability === "varies" ? (
        <Banner text="Понятно. Тогда расписание жёстко задавать не будем: тренировки можно будет переносить внутри недели прямо здесь." />
      ) : null}

      {asksSchedule && shows("availableWeekdays") ? (
        <Field
          label="Какие дни точно свободны, а какие точно нет?"
          hint="Нажмите на день один раз, чтобы отметить его свободным, ещё раз, чтобы снять. Дни, про которые не уверены, не отмечайте никак."
        >
          <div style={{ display: "grid", gap: 6 }}>
            {DAYS.map((d) => (
              <div key={d.idx} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 28, color: MUTED, fontSize: 14 }}>{d.label}</span>
                <button
                  type="button"
                  onClick={() => toggleDay(d.idx, "free")}
                  style={miniChipStyle(free.includes(d.idx), GREEN)}
                >
                  свободен
                </button>
                <button
                  type="button"
                  onClick={() => toggleDay(d.idx, "busy")}
                  style={miniChipStyle(busy.includes(d.idx), ACCENT)}
                >
                  занят
                </button>
              </div>
            ))}
          </div>
        </Field>
      ) : null}

      {asksSchedule && shows("preferredLongWeekday") ? (
        <Field
          label="В какой день удобнее самая длинная пробежка?"
          hint="Обычно её ставят на выходной, когда никуда не надо спешить."
        >
          <DayPicker
            days={DAYS.filter((d) => !busy.includes(d.idx))}
            value={longDay}
            onChange={(v) => setLongDay(v)}
          />
        </Field>
      ) : null}

      {asksSchedule && shows("preferredQualityWeekday") ? (
        <Field
          label="А в какой день вы готовы поработать потяжелее?"
          hint="После такой тренировки нужен спокойный день, поэтому её ставят не вплотную к длинной."
        >
          <DayPicker
            days={DAYS.filter((d) => !busy.includes(d.idx) && d.idx !== longDay)}
            value={qualityDay}
            onChange={(v) => setQualityDay(v)}
          />
        </Field>
      ) : null}

      {shows("timeOfDay") ? (
        <Field label="Когда вам удобнее бегать?">
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {TIME_OF_DAY.map((option) => (
              <button
                key={option.code}
                type="button"
                onClick={() => setTimeOfDay(option.code)}
                style={chipStyle(timeOfDay === option.code)}
              >
                {option.labelRu}
              </button>
            ))}
          </div>
        </Field>
      ) : null}

      {shows("runSurfaces") ? (
        <Field
          label="Где вы обычно бегаете?"
          hint="Можно отметить несколько. Одна и та же тренировка в холмистом парке и на стадионе получается разной."
        >
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {SURFACES.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => toggleSurface(option)}
                style={chipStyle(surfaces.includes(option))}
              >
                {option}
              </button>
            ))}
          </div>
        </Field>
      ) : null}

      {shows("maxSessionMinutes") ? (
        <Field
          label="Сколько времени вы реально можете выделить на одну тренировку?"
          hint="Считайте вместе с дорогой и душем, если это упирается во время. Длиннее этого в плане не появится."
        >
          <div style={{ display: "grid", gap: 6 }}>
            {SESSION_CAPS.map((option) => (
              <button
                key={option.code}
                type="button"
                onClick={() => setSessionCap(option.code)}
                style={optionStyle(sessionCap === option.code)}
              >
                <span style={{ fontWeight: 600 }}>{option.labelRu}</span>
              </button>
            ))}
          </div>
        </Field>
      ) : null}

      {props.needsTimezone ? (
        <Field
          label="В каком часовом поясе вы живёте?"
          hint="Не получилось определить автоматически. Нужно, чтобы «сегодня» у вас и в плане совпадало."
        >
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {props.timezoneOptions.map((option) => (
              <button
                key={option.zone}
                type="button"
                onClick={() => setZone(option.zone)}
                style={chipStyle(zone === option.zone)}
              >
                {option.labelRu}
              </button>
            ))}
          </div>
        </Field>
      ) : null}

      {shows("weekBreakers") ? (
        <Field
          label="Что чаще всего срывает вам неделю?"
          hint="Командировки, сменный график, дети, поездки. Напишите как есть, это читает тренер."
        >
          <textarea
            value={breakers}
            onChange={(e) => setBreakers(e.target.value)}
            rows={3}
            style={{ ...inputStyle, resize: "vertical" }}
          />
        </Field>
      ) : null}

      {shows("goalKind") ? (
        <Field label="Есть цель впереди?" hint="Необязательно. Если цели нет, просто пропустите.">
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {[
              { value: "", label: "Пока нет" },
              { value: "regular", label: "Бегать регулярно" },
              { value: "race", label: "Готовлюсь к старту" },
            ].map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setGoalKind(option.value)}
                style={chipStyle(goalKind === option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </Field>
      ) : null}

      {goalKind === "race" && (shows("raceDate") || shows("raceDistanceKm")) ? (
        <Field label="Когда старт и какая дистанция?">
          <div style={{ display: "flex", gap: 8 }}>
            <input
              type="date"
              value={raceDate}
              onChange={(e) => setRaceDate(e.target.value)}
              style={inputStyle}
            />
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

      {err ? <p style={{ color: ACCENT, fontWeight: 600, lineHeight: 1.5 }}>{err}</p> : null}

      <button type="button" onClick={submit} disabled={sending} style={primaryButtonStyle(sending)}>
        {sending ? "Сохраняю…" : "Готово"}
      </button>
    </div>
  );
}

function DayPicker(props: {
  days: Array<{ idx: number; label: string }>;
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {props.days.map((d) => (
        <button
          key={d.idx}
          type="button"
          onClick={() => props.onChange(props.value === d.idx ? null : d.idx)}
          style={chipStyle(props.value === d.idx)}
        >
          {d.label}
        </button>
      ))}
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
        {open ? "Свернуть" : "Я всё равно бегал(а), отметиться"}
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
      setErr("Ответьте на оба вопроса.");
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
          timeZone: detectTimeZone(),
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
      setErr("Нет связи. Попробуйте ещё раз.");
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
        placeholder="Хотите что-то добавить? Необязательно."
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
        body: JSON.stringify({
          initData: props.initData,
          timeZone: detectTimeZone(),
          sessionId: props.sessionId,
          toDate,
        }),
      });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!json.ok) {
        setErr(json.error ?? "Не получилось перенести.");
        return;
      }
      props.onChanged("Готово, план обновлён.");
    } catch {
      setErr("Нет связи. Попробуйте ещё раз.");
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
        Переносить можно внутри недели и только на свободные дни.
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

/** Компактная кнопка состояния дня. Цвет несёт смысл: зелёный свободен, оранжевый занят. */
function miniChipStyle(active: boolean, color: string): React.CSSProperties {
  return {
    padding: "6px 12px",
    borderRadius: 999,
    border: `1px solid ${active ? color : LINE}`,
    background: active ? color : "#fff",
    color: active ? "#fff" : MUTED,
    fontSize: 13,
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
