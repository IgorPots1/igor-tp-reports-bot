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

import { CONNECT_PAGE } from "@/features/intervals/connect-content";
import {
  DEVICE_GUIDES,
  MARK_ALL_RU,
  NO_WATCH_BODY_RU,
  NO_WATCH_TITLE_RU,
  STEP_LEAD_RU,
  STEP_TITLE_RU,
  WHERE_TO_LOOK_RU,
} from "@/features/intervals/device-guide";

import { renderMiniMarkdown } from "./markdown";
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

type SessionSegment = {
  minutes: number;
  fastSec: number | null;
  slowSec: number | null;
  label: string;
  noPaceText?: string;
};

type SessionCard = {
  sessionId: string;
  date: string;
  dateLabel: string;
  weekdayLabel: string;
  title: string;
  minutes: number;
  description: string | null;
  /** null — сессия сгенерирована до появления структуры, только проза. */
  segments: SessionSegment[] | null;
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

type WaitingView = {
  messageRu: string;
  doneRu: string[];
  nextRu: string;
  answersSummaryRu: string[];
};

type CoachReply = {
  id: string;
  aboutDateLabel: string | null;
  body: string;
  dateLabel: string;
  isNew: boolean;
};

type View =
  | { state: "no_plan"; messageRu: string; waiting?: WaitingView; coachReplies?: CoachReply[] }
  | {
      state: "ready";
      today: SessionCard | null;
      upcoming: SessionCard[];
      ladder: LadderView | null;
      canLogUnplanned: boolean;
      coachReplies?: CoachReply[];
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
  const [isManualEntry, setIsManualEntry] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  // ПРАВИЛА ФОРМАТА ОТДЕЛЬНЫМ ЭКРАНОМ, А НЕ ЧАСТЬЮ ПОДКЛЮЧЕНИЯ. В момент
  // подключения человеку нечего про них запоминать: у него ещё нет плана, не
  // было ни одной тренировки и нечего переносить. Зато когда план появился,
  // правила нужны не раз, поэтому это экран, куда можно вернуться, а не
  // всплывшее один раз окно.
  const [showGuide, setShowGuide] = useState(false);
  // ЛИЧНЫЙ КАБИНЕТ — ВХОД С ГЛАВНОГО ЭКРАНА ПЛАНА, РЯДОМ С «КАК МЫ РАБОТАЕМ»
  // [решение 16.09.2026]. «Как мы работаем» читают один раз и держат в
  // памяти; кабинет — статистика, на неё возвращаются часто. Разные экраны,
  // не одна дверь с двумя комнатами.
  const [showCabinet, setShowCabinet] = useState(false);

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
        isManualEntry?: boolean;
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
      setIsManualEntry(json.isManualEntry === true);
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
        <ConnectScreen
          initData={initData}
          lostRu={connectionLost}
          onRetry={() => void load(initData)}
          onManualEntry={() => void load(initData)}
        />
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

  if (showGuide) {
    return (
      <Shell>
        <GuideScreen onBack={() => setShowGuide(false)} />
      </Shell>
    );
  }

  if (showCabinet) {
    return (
      <Shell>
        <CabinetScreen initData={initData ?? ""} onBack={() => setShowCabinet(false)} />
      </Shell>
    );
  }

  return (
    <Shell>
      {toast ? <Banner text={toast} /> : null}
      {view.state === "no_plan" ? (
        <WaitingScreen
          view={view.waiting ?? null}
          fallbackRu={view.messageRu}
          coachReplies={view.coachReplies ?? []}
          onOpenGuide={() => setShowGuide(true)}
        />
      ) : (
        <PlanScreen
          view={view}
          initData={initData ?? ""}
          isManualEntry={isManualEntry}
          onOpenGuide={() => setShowGuide(true)}
          onOpenCabinet={() => setShowCabinet(true)}
          onChanged={(note) => {
            setToast(note);
            if (initData) void load(initData);
          }}
        />
      )}
    </Shell>
  );
}

/**
 * «Как мы работаем»: что входит, правила и что делать, если.
 *
 * ТЕКСТ ТОТ ЖЕ, ЧТО НА САЙТЕ, из одного файла. Две копии разъехались бы на
 * первой правке, и человек прочитал бы в приложении одно, а на странице другое.
 */
function GuideScreen(props: { onBack: () => void }) {
  return (
    <div>
      <button
        type="button"
        onClick={props.onBack}
        style={{
          background: "none",
          border: "none",
          padding: 0,
          marginBottom: 10,
          color: ACCENT,
          fontWeight: 600,
          fontSize: 14,
          cursor: "pointer",
        }}
      >
        ← Назад
      </button>
      <h1 style={{ fontSize: 22, margin: "0 0 4px" }}>Как мы работаем</h1>
      {renderMiniMarkdown(CONNECT_PAGE.formatRu, "guide-format")}
      <h2 style={{ fontSize: 17, fontWeight: 700, margin: "20px 0 0" }}>
        {CONNECT_PAGE.troubleTitleRu}
      </h2>
      {renderMiniMarkdown(CONNECT_PAGE.troubleRu, "guide-trouble")}
      <p style={{ marginTop: 22, color: MUTED, fontSize: 13, lineHeight: 1.5 }}>
        {CONNECT_PAGE.closingRu}
      </p>
    </div>
  );
}

type CabinetHistoryEntry = {
  date: string;
  dateLabel: string;
  title: string;
  minutes: number | null;
  effortLabel: string | null;
  pain: boolean;
  commentText: string | null;
};

type CabinetLadderStep = { step: number; labelRu: string; sinceDateLabel: string };

type CabinetData = {
  weeksTogether: number | null;
  cycleProgress: { currentWeek: number; totalWeeks: number } | null;
  totals: { sessionsCompleted: number; minutesAccumulated: number } | null;
  history: CabinetHistoryEntry[] | null;
  ladder: { currentLabelRu: string; nextLabelRu: string | null; path: CabinetLadderStep[] } | null;
};

function cardStyle(): React.CSSProperties {
  return {
    background: "#fff",
    border: `1px solid ${LINE}`,
    borderRadius: 14,
    padding: "14px 16px",
    marginBottom: 16,
  };
}

/**
 * Личный кабинет: то, что уже есть в базе и раньше не показывалось.
 *
 * ПУСТЫХ БЛОКОВ НЕТ [решение 16.09.2026]. Сервер уже решил, какой блок
 * содержателен (buildCabinetView), а не декоративен — здесь только null-чек
 * на каждый, без собственных «0 тренировок» и подобных пустышек.
 */
function CabinetScreen(props: { initData: string; onBack: () => void }) {
  const [data, setData] = useState<CabinetData | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/m/run/cabinet", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ initData: props.initData }),
        });
        const json = (await res.json()) as { ok: boolean; error?: string; view?: CabinetData };
        if (cancelled) return;
        if (!json.ok) {
          setErr(json.error ?? "Не получилось загрузить.");
          return;
        }
        setData(json.view ?? null);
      } catch {
        if (!cancelled) setErr("Нет связи. Попробуйте ещё раз.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [props.initData]);

  return (
    <div>
      <button
        type="button"
        onClick={props.onBack}
        style={{
          background: "none",
          border: "none",
          padding: 0,
          marginBottom: 10,
          color: ACCENT,
          fontWeight: 600,
          fontSize: 14,
          cursor: "pointer",
        }}
      >
        ← Назад
      </button>
      <h1 style={{ fontSize: 22, margin: "0 0 14px" }}>Кабинет</h1>

      {loading ? <p style={{ color: MUTED }}>Загружаю…</p> : null}
      {err ? <p style={{ color: ACCENT, fontWeight: 600 }}>{err}</p> : null}

      {data?.weeksTogether !== null && data?.weeksTogether !== undefined ? (
        <div style={cardStyle()}>
          <p style={{ margin: 0, fontWeight: 600, fontSize: 15 }}>
            Работаем вместе {data.weeksTogether} {plural(data.weeksTogether, "неделю", "недели", "недель")}
          </p>
          {data.cycleProgress ? (
            <p style={{ margin: "4px 0 0", color: MUTED, fontSize: 14 }}>
              Текущий план: неделя {data.cycleProgress.currentWeek} из {data.cycleProgress.totalWeeks}
            </p>
          ) : null}
        </div>
      ) : null}

      {data?.totals ? (
        <div style={cardStyle()}>
          <p style={{ margin: 0, fontWeight: 600, fontSize: 15 }}>Итоги</p>
          <p style={{ margin: "6px 0 0", fontSize: 14 }}>
            {data.totals.sessionsCompleted}{" "}
            {plural(data.totals.sessionsCompleted, "тренировка", "тренировки", "тренировок")} отмечено
          </p>
          {data.totals.minutesAccumulated > 0 ? (
            <p style={{ margin: "2px 0 0", color: MUTED, fontSize: 14 }}>
              Набрано {data.totals.minutesAccumulated} мин по плану
            </p>
          ) : null}
        </div>
      ) : null}

      {data?.ladder ? (
        <div style={cardStyle()}>
          <p style={{ margin: 0, fontWeight: 600, fontSize: 15 }}>Ступени</p>
          <p style={{ margin: "6px 0 0", fontSize: 14 }}>Сейчас: {data.ladder.currentLabelRu}</p>
          {data.ladder.nextLabelRu ? (
            <p style={{ margin: "2px 0 0", color: MUTED, fontSize: 14 }}>
              Дальше: {data.ladder.nextLabelRu}
            </p>
          ) : (
            <p style={{ margin: "2px 0 0", color: MUTED, fontSize: 14 }}>
              Последняя ступень программы новичка
            </p>
          )}
          {data.ladder.path.length > 1 ? (
            <div style={{ marginTop: 10, borderTop: `1px solid ${LINE}`, paddingTop: 10 }}>
              {data.ladder.path.map((step) => (
                <p key={step.step} style={{ margin: "4px 0 0", color: MUTED, fontSize: 13 }}>
                  Ступень {step.step} — {step.labelRu} (с {step.sinceDateLabel})
                </p>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {data?.history && data.history.length > 0 ? (
        <div style={cardStyle()}>
          <p style={{ margin: 0, fontWeight: 600, fontSize: 15 }}>История</p>
          <div style={{ marginTop: 8, display: "grid", gap: 10 }}>
            {data.history.map((entry) => (
              <div key={entry.date} style={{ borderTop: `1px solid ${LINE}`, paddingTop: 8 }}>
                <p style={{ margin: 0, fontSize: 13, color: MUTED }}>{entry.dateLabel}</p>
                <p style={{ margin: "2px 0 0", fontSize: 14, fontWeight: 600 }}>
                  {entry.title}
                  {entry.minutes ? ` · ${entry.minutes} мин` : ""}
                </p>
                {entry.effortLabel ? (
                  <p style={{ margin: "2px 0 0", fontSize: 13, color: MUTED }}>
                    {entry.effortLabel}
                    {entry.pain ? " · что-то беспокоило" : ""}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {!loading &&
      !err &&
      !data?.weeksTogether &&
      !data?.totals &&
      !data?.history &&
      !data?.ladder ? (
        <p style={{ color: MUTED, fontSize: 14 }}>
          Пока рано: кабинет наполнится, как только появятся первые отметки о тренировках.
        </p>
      ) : null}
    </div>
  );
}

/**
 * Свёрнутый блок для подробностей, которые нужны не всем и не сразу.
 *
 * НЕ СПРЯТАТЬ, А УБРАТЬ С ДОРОГИ. Экран подключения обязан помещаться в голову:
 * человек на незнакомой территории, и стена текста читается как «тут сложно».
 * Поэтому подробности про регистрацию и про «часов нет» свёрнуты, но лежат
 * здесь же, а не за ссылкой на сайт: по ссылке он не пойдёт.
 */
function Collapsible(props: { title: string; children: React.ReactNode; divider?: boolean }) {
  // Черта сверху нужна, когда блок идёт ПОСЛЕ текста: она отделяет подробности
  // от главного. Когда блок в карточке один, та же черта читается как обрезок
  // чего-то исчезнувшего, поэтому её можно выключить.
  const divider = props.divider !== false;
  return (
    <details
      style={{
        marginTop: divider ? 12 : 0,
        borderTop: divider ? `1px solid ${LINE}` : undefined,
        paddingTop: divider ? 10 : 0,
      }}
    >
      <summary style={{ cursor: "pointer", fontWeight: 600, fontSize: 15, color: ACCENT }}>
        {props.title}
      </summary>
      <div style={{ paddingBottom: 4 }}>{props.children}</div>
    </details>
  );
}

/**
 * Экран ожидания плана. НЕ ТУПИК: человек видит, что его работа не пропала,
 * что происходит сейчас и от кого это зависит.
 */
function GuideLink(props: { onClick: () => void; labelRu: string }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      style={{
        display: "block",
        width: "100%",
        marginTop: 20,
        padding: "12px 14px",
        background: "#fff",
        border: `1px solid ${LINE}`,
        borderRadius: 12,
        color: ACCENT,
        fontWeight: 600,
        fontSize: 14,
        fontFamily: "inherit",
        textAlign: "left",
        cursor: "pointer",
      }}
    >
      {props.labelRu}
    </button>
  );
}

function WaitingScreen(props: {
  view: WaitingView | null;
  fallbackRu: string;
  coachReplies: CoachReply[];
  onOpenGuide: () => void;
}) {
  if (!props.view) return <Banner text={props.fallbackRu} />;
  const { view } = props;
  return (
    <div>
      <h1 style={{ fontSize: 22, margin: "0 0 6px" }}>План готовится</h1>
      <p style={{ color: MUTED, margin: "0 0 18px", lineHeight: 1.5 }}>{view.nextRu}</p>

      {view.doneRu.length > 0 ? (
        <div
          style={{
            background: "#fff",
            border: `1px solid ${LINE}`,
            borderRadius: 14,
            padding: "14px 16px",
            marginBottom: 12,
          }}
        >
          <p style={{ margin: 0, fontWeight: 600 }}>Уже готово</p>
          <ul style={{ margin: "8px 0 0", paddingLeft: 18, color: GREEN, lineHeight: 1.7, fontSize: 15 }}>
            {view.doneRu.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {view.answersSummaryRu.length > 0 ? (
        <div
          style={{
            background: "#fff",
            border: `1px solid ${LINE}`,
            borderRadius: 14,
            padding: "14px 16px",
          }}
        >
          <p style={{ margin: 0, fontWeight: 600 }}>Что вы ответили</p>
          <ul style={{ margin: "8px 0 0", paddingLeft: 18, color: MUTED, lineHeight: 1.7, fontSize: 15 }}>
            {view.answersSummaryRu.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <p style={{ margin: "10px 0 0", color: MUTED, fontSize: 13, lineHeight: 1.5 }}>
            Если здесь ошибка, скажите тренеру сейчас: поправить до плана проще, чем после.
          </p>
        </div>
      ) : null}

      {/* Ответ тренера может прийти и до плана: человек написал вопрос в
          анкете или отметился о своей пробежке. Прятать его до появления плана
          значит потерять единственный живой контакт в самые первые дни. */}
      <CoachReplies replies={props.coachReplies} />

      {/* ЛУЧШИЙ МОМЕНТ ПРОЧИТАТЬ ПРАВИЛА — ИМЕННО ЗДЕСЬ. Человек только что всё
          сделал и ждёт: заняться ему нечем, а прочитанное пригодится через день,
          когда план появится. */}
      <GuideLink onClick={props.onOpenGuide} labelRu="Пока ждёте: как мы будем работать →" />
    </div>
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

/**
 * Выбрал свои часы — увидел, что отметить.
 *
 * Список приходит из общего модуля device-guide: тот же самый показывается на
 * странице-инструкции. Две копии разошлись бы молча, а цена расхождения здесь —
 * человек не отмечает галочку и данные не идут.
 */
const NO_WATCH_CODE = "__no_watch__";

function DeviceChecklist(props: { onManualEntry: () => void }) {
  const [device, setDevice] = useState<string | null>(null);
  const guide = DEVICE_GUIDES.find((item) => item.code === device) ?? null;
  const noWatchActive = device === NO_WATCH_CODE;

  return (
    <div
      style={{
        background: "#fff",
        border: `1px solid ${LINE}`,
        borderRadius: 14,
        padding: "14px 16px",
        marginBottom: 16,
      }}
    >
      <p style={{ margin: 0, fontWeight: 600 }}>Какие у вас часы?</p>
      <p style={{ margin: "4px 0 10px", color: MUTED, fontSize: 13, lineHeight: 1.5 }}>
        Покажем, что отметить. Без нужной галочки подключение пройдёт, а тренировки не придут.
      </p>
      {/* «Моих часов тут нет» — ЗАМЕТНАЯ ПОЗИЦИЯ РЯДОМ С МОДЕЛЯМИ, А НЕ СВЁРНУТАЯ
          СТРОКА ПОД СПИСКОМ [решение 16.09.2026]. Человек с неподдерживаемыми
          часами (Honor, Xiaomi, любая мелочь) листал семь карточек, не находил
          себя и упирался: дверь была, но под катом после Polar Beat, а найти
          кат можно только предположив, что «часов нет» — это ещё один пункт
          списка. Здесь она — такой же по виду пункт списка, как остальные, а
          не примечание к нему. */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {DEVICE_GUIDES.map((item) => (
          <button
            key={item.code}
            type="button"
            onClick={() => setDevice(device === item.code ? null : item.code)}
            style={chipStyle(device === item.code)}
          >
            {item.labelRu}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setDevice(noWatchActive ? null : NO_WATCH_CODE)}
          style={chipStyle(noWatchActive)}
        >
          Моих часов тут нет
        </button>
      </div>

      {noWatchActive ? (
        <NoWatchFork onManualEntry={props.onManualEntry} />
      ) : guide ? (
        <div style={{ marginTop: 14, borderTop: `1px solid ${LINE}`, paddingTop: 14 }}>
          {/* «Где искать галочки» — только тем, у кого они есть. Для Apple Watch
              отмечать в настройках Intervals нечего, и звать туда человека
              значит отправить его искать несуществующий блок. */}
          {guide.steps.length > 0 ? (
            <p style={{ margin: 0, color: MUTED, fontSize: 13, lineHeight: 1.5 }}>{WHERE_TO_LOOK_RU}</p>
          ) : null}
          {guide.settingsBoxRu ? (
            <p style={{ margin: "8px 0 0", fontSize: 13, color: MUTED }}>
              Ищите блок «{guide.settingsBoxRu}».
            </p>
          ) : null}
          {/* Часы без прямого подключения (Apple Watch): вместо галочек текст. */}
          {guide.bridgeRu.map((paragraph) => (
            <p
              key={paragraph.slice(0, 32)}
              style={{ margin: "10px 0 0", fontSize: 14, lineHeight: 1.55 }}
            >
              {paragraph}
            </p>
          ))}
          {guide.steps.length > 0 ? (
            <p style={{ margin: "10px 0 0", fontSize: 13.5, lineHeight: 1.5 }}>{MARK_ALL_RU}</p>
          ) : null}
          {guide.steps.map((stepItem) => (
            <div
              key={stepItem.titleRu}
              style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "flex-start" }}
            >
              {/* КВАДРАТИК ФИКСИРОВАННОГО РАЗМЕРА. У прошлой плашки со словом
                  не было ни alignItems у строки, ни высоты у самой плашки:
                  она растягивалась на всю высоту абзаца рядом. */}
              <span
                aria-hidden
                style={{
                  flexShrink: 0,
                  alignSelf: "flex-start",
                  width: 18,
                  height: 18,
                  marginTop: 2,
                  borderRadius: 5,
                  background: "#FDE8E0",
                  color: ACCENT,
                  fontSize: 11,
                  fontWeight: 700,
                  lineHeight: "18px",
                  textAlign: "center",
                }}
              >
                ✓
              </span>
              <div>
                <p style={{ margin: 0, fontWeight: 600, fontSize: 15 }}>{stepItem.titleRu}</p>
                <p style={{ margin: "2px 0 0", color: MUTED, fontSize: 13, lineHeight: 1.5 }}>
                  {stepItem.whyRu}
                </p>
              </div>
            </div>
          ))}
          {guide.noteRu ? (
            <p
              style={{
                margin: "12px 0 0",
                background: "#FBF3E4",
                borderRadius: 10,
                padding: "9px 11px",
                color: INK,
                fontSize: 13,
                lineHeight: 1.5,
              }}
            >
              {guide.noteRu}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Развилка «моих часов тут нет»: два честных пути, Polar Beat первым.
 *
 * ОБА ВЕДУТ ДАЛЬШЕ, К АНКЕТЕ [решение 16.09.2026]. Раньше это были два разных
 * места на экране: инструкция про Polar Beat лежала здесь же под списком, без
 * собственного «дальше» — человек читал её и должен был сам сообразить, что
 * нужная кнопка снизу называется «Подключить часы» и относится и к нему тоже.
 * Ручной ввод жил ещё ниже отдельной карточкой. Одна дверь с двумя честными
 * описаниями вместо двух карточек, найденных порознь.
 *
 * ПОРЯДОК НЕ СЛУЧАЕН: Polar Beat даёт трек, темп и (с датчиком) пульс — это
 * данные, по которым можно судить об интенсивности внутри тренировки. Ручной
 * ввод не даёт ничего из этого. Он не должен выглядеть равноценной
 * альтернативой первому — только показываться вторым, для тех, кому первый
 * путь не подошёл.
 */
function NoWatchFork(props: { onManualEntry: () => void }) {
  const [path, setPath] = useState<"polar" | "manual" | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submitManual = async () => {
    const tg = getTelegram();
    if (!tg?.initData) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/m/run/connect-manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initData: tg.initData }),
      });
      const json = (await res.json()) as { ok: boolean; error?: string };
      if (!json.ok) {
        setErr(json.error ?? "Не получилось.");
        return;
      }
      props.onManualEntry();
    } catch {
      setErr("Нет связи. Попробуйте ещё раз.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ marginTop: 14, borderTop: `1px solid ${LINE}`, paddingTop: 14 }}>
      <p style={{ margin: "0 0 10px", color: MUTED, fontSize: 13, lineHeight: 1.5 }}>
        Тоже работаем, просто данных будет меньше. Выберите, как будем получать тренировки.
      </p>
      <div style={{ display: "grid", gap: 6 }}>
        <button
          type="button"
          onClick={() => setPath(path === "polar" ? null : "polar")}
          style={optionStyle(path === "polar")}
        >
          <span style={{ fontWeight: 600 }}>Телефон через Polar Beat</span>
          <span style={{ display: "block", color: MUTED, fontSize: 13, marginTop: 2 }}>
            Настоящий трек и темп; с нагрудным датчиком пульса — ещё и пульс.
          </span>
        </button>
        {path === "polar" ? (
          <div style={{ padding: "2px 2px 8px" }}>
            <p style={{ margin: "0 0 8px", fontWeight: 600, fontSize: 14 }}>{NO_WATCH_TITLE_RU}</p>
            {renderMiniMarkdown(NO_WATCH_BODY_RU, "c-nowatch")}
            <p style={{ margin: "10px 0 0", fontWeight: 600, fontSize: 14 }}>
              Когда всё готово — нажмите «Подключить часы» ниже: для Polar Beat это тот же шаг, через
              Intervals.
            </p>
          </div>
        ) : null}

        <button
          type="button"
          onClick={() => setPath(path === "manual" ? null : "manual")}
          style={optionStyle(path === "manual")}
        >
          <span style={{ fontWeight: 600 }}>Вручную, без приложений</span>
          <span style={{ display: "block", color: MUTED, fontSize: 13, marginTop: 2 }}>
            Цифры со слов: без анализа интенсивности внутри тренировки и без диагностического теста.
          </span>
        </button>
        {path === "manual" ? (
          <div style={{ padding: "2px 2px 0" }}>
            <p style={{ margin: "0 0 10px", lineHeight: 1.5, fontSize: 14 }}>
              После каждой тренировки открываете это же приложение и вписываете: сколько длилась,
              сколько километров, если знаете, и как прошло. Пульс и темп — если помните навскидку, не
              обязательно.
            </p>
            <p style={{ margin: "0 0 10px", lineHeight: 1.5, fontSize: 14, color: MUTED }}>
              Чего не будет по сравнению с часами или Polar Beat: карты маршрута, точного темпа по
              километрам, подтверждённого пульса. Я буду видеть только то, что вы напишете, и не смогу
              сказать, ровно ли шла тренировка внутри — только по вашим словам и самочувствию. План
              строим и так, темпы отрезков поначалу — по усилию, а не по цифрам.
            </p>
            {err ? <p style={{ color: ACCENT, fontWeight: 600, margin: "0 0 10px" }}>{err}</p> : null}
            <button type="button" onClick={submitManual} disabled={busy} style={primaryButtonStyle(busy)}>
              {busy ? "Включаю…" : "Да, буду вписывать сама"}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ConnectScreen(props: {
  initData: string;
  lostRu: string | null;
  onRetry: () => void;
  onManualEntry: () => void;
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
        Чтобы тренер собрал план, ваши тренировки должны к нему приходить. Делается один раз:
        аккаунт, часы, кнопка внизу.
      </p>

      {props.lostRu ? <Banner text={props.lostRu} /> : null}

      {/* ИНСТРУКЦИЯ ЖИВЁТ ЗДЕСЬ, А НЕ ЗА ССЫЛКОЙ НА САЙТ [решение Игоря,
          14.09.2026]. Уход на сайт это лишний переход ровно в тот момент, когда
          человек и так на незнакомой территории: он теряет приложение из виду и
          возвращается не всегда. Текст тот же самый, из общего файла, поэтому
          двух правд не заводится.

          На экране ТОЛЬКО то, что нужно, чтобы подключиться. Правила формата
          (что входит, как отмечаться, что делать, если заболели) переехали на
          отдельный экран «Как мы работаем»: сейчас их запоминать бессмысленно,
          плана ещё нет. */}
      <div
        style={{
          background: "#fff",
          border: `1px solid ${LINE}`,
          borderRadius: 14,
          padding: "14px 16px",
          marginBottom: 16,
        }}
      >
        {/* ЭКРАН ЧИТАЕТСЯ ЗА ДЕСЯТЬ СЕКУНД [решение Игоря, 15.09.2026].
            Раньше здесь лежали оба шага целиком, и человек видел простыню. Всё,
            кроме одной строки на шаг, свёрнуто: подробности нужны не всем и не
            сразу, но лежат тут же, а не за ссылкой на сайт. */}
        <p style={{ margin: 0, fontWeight: 600, fontSize: 15 }}>Шаг 1. Заведите аккаунт в Intervals</p>
        <p style={{ margin: "6px 0 0", color: MUTED, fontSize: 14, lineHeight: 1.5 }}>
          Бесплатно, пара минут. Туда приходят ваши тренировки.
        </p>
        <Collapsible title="Подробнее: что вводить при регистрации">
          {renderMiniMarkdown(CONNECT_PAGE.step1Ru, "c-step1")}
          {renderMiniMarkdown(CONNECT_PAGE.step1DetailsRu, "c-step1d")}
        </Collapsible>
      </div>

      <div
        style={{
          background: "#fff",
          border: `1px solid ${LINE}`,
          borderRadius: 14,
          padding: "14px 16px",
          marginBottom: 16,
        }}
      >
        <p style={{ margin: 0, fontWeight: 600, fontSize: 15 }}>{STEP_TITLE_RU}</p>
        <p style={{ margin: "6px 0 0", color: MUTED, fontSize: 14, lineHeight: 1.5 }}>
          Выберите свои часы ниже: покажу, что отметить именно у них.
        </p>
        <Collapsible title="Подробнее: где это в настройках">
          {renderMiniMarkdown(STEP_LEAD_RU, "c-step2")}
        </Collapsible>
      </div>

      {/* ГЛАВНОЕ НА ЭТОМ ЭКРАНЕ. В Intervals галочки скачивания отмечаются
          отдельно, и не отметив нужную, человек проходит авторизацию и видит
          «подключено», а данные не идут ВООБЩЕ. Поэтому список показывается ДО
          кнопки, а не прячется в ссылку: ссылку не откроют.

          «МОИХ ЧАСОВ ТУТ НЕТ» — ПУНКТ ЭТОГО ЖЕ СПИСКА, А НЕ ОТДЕЛЬНЫЙ БЛОК ПОД
          НИМ [решение 16.09.2026]. Раньше это были две карточки НИЖЕ списка —
          инструкция про Polar Beat и отдельно ручной ввод. Человек с
          неподдерживаемыми часами листал семь моделей, не находил себя и
          решал, что ему сюда нельзя: дверь была, но под катом после Polar
          Beat. Теперь она — такой же по виду пункт списка, как остальные, и
          по нажатию даёт честную развилку из двух путей (см. NoWatchFork). */}
      <DeviceChecklist onManualEntry={props.onManualEntry} />

      <div
        style={{
          background: "#fff",
          border: `1px solid ${LINE}`,
          borderRadius: 14,
          padding: "14px 16px",
          marginBottom: 16,
        }}
      >
        <Collapsible title="Что мы будем видеть" divider={false}>
          <ul style={{ margin: "8px 0 0", paddingLeft: 18, color: MUTED, lineHeight: 1.6, fontSize: 14 }}>
            <li>ваши тренировки и их данные</li>
            <li>самочувствие: пульс покоя, сон, вес</li>
            <li>календарь, чтобы класть туда план</li>
          </ul>
          <p style={{ margin: "10px 0 0", color: MUTED, fontSize: 13, lineHeight: 1.5 }}>
            Пароль от Intervals.icu мы не видим и не храним. Отозвать доступ можно в любой момент в
            настройках Intervals.icu.
          </p>
        </Collapsible>
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
  // Как проходит обычная пробежка. От этого зависит только первая тренировка:
  // тому, кто пока чередует бег с шагом, лестница начинается раньше.
  const [runStyle, setRunStyle] = useState<string | null>(null);
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
            ...(shows("canRunContinuously") && runStyle ? { runStyle } : {}),
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
      {/* Строка из бывшего шага 4 на сайте: страница теперь про формат работы,
          а этот совет нужен ровно здесь, над самими вопросами. */}
      <p style={{ margin: "0 0 14px", color: MUTED, lineHeight: 1.5 }}>
        Отвечайте честно, а не как хотелось бы. План, который не влезает в вашу жизнь, не
        выполняется на второй неделе.
      </p>
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

      {/* ПРО ФАКТ, А НЕ ПРО СПОСОБНОСТЬ. «Можете ли вы бежать двадцать минут»
          звучит как норматив, и человек отвечает то, что считает правильным.
          «Как проходит ваша обычная пробежка» спрашивает про вчерашний день, и
          ответ выходит честным. Ни один вариант не хуже других: от них зависит
          только то, с чего начнём. */}
      {shows("canRunContinuously") ? (
        <Field
          label="Как сейчас проходит ваша обычная пробежка?"
          hint="Про то, как есть, а не как хотелось бы. Нужно только для первой тренировки."
        >
          <div style={{ display: "grid", gap: 6 }}>
            {[
              { value: "continuous", label: "Бегу без остановок, двадцать минут и дольше" },
              { value: "walk_breaks", label: "Бегу, но иногда перехожу на шаг" },
              { value: "mostly_walk", label: "Пока больше хожу, чем бегу" },
            ].map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setRunStyle(option.value)}
                style={optionStyle(runStyle === option.value)}
              >
                <span style={{ fontWeight: 600 }}>{option.label}</span>
              </button>
            ))}
          </div>
        </Field>
      ) : null}

      {shows("goalKind") ? (
        <Field
          label="Что для вас сейчас важнее?"
          hint="Необязательно, можно не выбирать. «Улучшать результаты» значит, что нагрузка будет постепенно расти; «просто бегать» — что останется на нынешнем уровне."
        >
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {[
              { value: "race", label: "Готовлюсь к старту" },
              { value: "improve", label: "Хочу улучшать результаты" },
              { value: "regular", label: "Просто бегать регулярно" },
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
  isManualEntry: boolean;
  onChanged: (note: string) => void;
  onOpenGuide: () => void;
  onOpenCabinet: () => void;
}) {
  const { view } = props;
  return (
    <div>
      {/* ОТВЕТ ТРЕНЕРА ВЫШЕ ПЛАНА, И ЭТО НЕ СЛУЧАЙНО. Ради него человек и
          открывает приложение после тренировки: он отметился и ждёт, что
          скажут. План на сегодня никуда не денется и через два экрана, а
          ответ, спрятанный внизу, читается как «мне не ответили». */}
      <CoachReplies replies={view.coachReplies ?? []} />

      {view.ladder ? <LadderBlock ladder={view.ladder} /> : null}

      <h2 style={{ fontSize: 18, margin: "22px 0 10px" }}>Сегодня</h2>
      {view.today ? (
        <SessionBlock
          card={view.today}
          initData={props.initData}
          effortOptions={view.effortOptions}
          painOptions={view.painOptions}
          onChanged={props.onChanged}
          isManualEntry={props.isManualEntry}
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
          isManualEntry={props.isManualEntry}
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
              isManualEntry={props.isManualEntry}
              isToday={false}
            />
          ))}
        </>
      ) : null}

      {/* Правила нужны не раз: заболела, не пошло, уезжает. Поэтому в самом
          низу главного экрана стоит постоянная дверь туда, а не одноразовое
          окно, которое человек закрыл и больше не нашёл. */}
      <GuideLink onClick={props.onOpenGuide} labelRu="Как мы работаем: правила и что делать, если →" />
      <GuideLink onClick={props.onOpenCabinet} labelRu="Кабинет: недели, итоги, ступени →" />
    </div>
  );
}

/**
 * Ответ тренера. Пусто — блока нет вовсе: пустая рамка «ответов пока нет»
 * выглядит как упрёк и занимает место на маленьком экране.
 */
function CoachReplies({ replies }: { replies: CoachReply[] }) {
  if (replies.length === 0) return null;
  return (
    <section style={{ marginBottom: 4 }}>
      <h2 style={{ fontSize: 18, margin: "0 0 10px" }}>Ответ тренера</h2>
      {replies.map((reply) => (
        <div
          key={reply.id}
          style={{
            background: "#fff",
            border: `1px solid ${reply.isNew ? ACCENT : LINE}`,
            borderRadius: 14,
            padding: "14px 16px",
            marginBottom: 10,
          }}
        >
          <p style={{ margin: "0 0 6px", fontSize: 13, color: MUTED }}>
            {reply.aboutDateLabel ? `про ${reply.aboutDateLabel}` : reply.dateLabel}
            {reply.isNew ? <span style={{ color: ACCENT, fontWeight: 600 }}> · новое</span> : null}
          </p>
          <p style={{ margin: 0, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{reply.body}</p>
        </div>
      ))}
    </section>
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

function plural(n: number, one: string, few: string, many: string): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return many;
  const mod10 = n % 10;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

/** «5:30» из секунд на километр. Тот же формат, что и в остальном приложении. */
function formatPace(sec: number): string {
  const total = Math.round(sec);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * Структура тренировки — разминка/работа/заминка видно с одного взгляда, а не
 * абзацем прозы [решение 16.09.2026]. Один ряд на сегмент: сколько минут, что
 * делать, каким темпом (или чем заменить темп, если его нет — «стоя», «по
 * ощущениям»).
 */
function SegmentList({ segments }: { segments: SessionSegment[] }) {
  return (
    <div style={{ margin: "10px 0 0", display: "grid", gap: 6 }}>
      {segments.map((seg, i) => (
        <div key={i} style={{ display: "flex", gap: 8, fontSize: 14, lineHeight: 1.4 }}>
          <span style={{ flexShrink: 0, minWidth: 52, color: MUTED, fontVariantNumeric: "tabular-nums" }}>
            {seg.minutes} мин
          </span>
          <span>
            {seg.label}
            {seg.fastSec != null && seg.slowSec != null
              ? ` — ${formatPace(seg.fastSec)}–${formatPace(seg.slowSec)} на км`
              : seg.noPaceText
                ? ` — ${seg.noPaceText}`
                : ""}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * Прозе есть куда пойти, только если она длиннее одной строки — короткое
 * "Лёгкий бег: 35 минут 5:30–5:50 на километр." от renderDescription не
 * прячем, это и так одна строка. В стену текста (диагностический тест: правила
 * записи, разбор по шагам, исключения) превращаются только многоабзацные
 * описания — их узнаём по переносу строки, который renderDescription никогда
 * не производит (join(". ")), а ручной текст диагностического теста — всегда.
 */
function isLongFormDescription(text: string): boolean {
  return text.includes("\n") || text.length > 140;
}

function SessionBlock(props: {
  card: SessionCard;
  initData: string;
  effortOptions: EffortOption[];
  painOptions: PainOption[];
  onChanged: (note: string) => void;
  isManualEntry: boolean;
  isToday: boolean;
}) {
  const { card } = props;
  const [openCheckin, setOpenCheckin] = useState(false);
  const [openMove, setOpenMove] = useState(false);
  const segments = card.segments && card.segments.length > 0 ? card.segments : null;
  const longForm = card.description ? isLongFormDescription(card.description) : false;

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

      {segments ? <SegmentList segments={segments} /> : null}

      {card.description ? (
        longForm ? (
          <div style={{ margin: "10px 0 0" }}>
            <Collapsible title="Подробнее" divider={false}>
              <p style={{ margin: 0, lineHeight: 1.5, fontSize: 15, whiteSpace: "pre-wrap" }}>
                {card.description}
              </p>
            </Collapsible>
          </div>
        ) : !segments ? (
          <p style={{ margin: "10px 0 0", lineHeight: 1.5, fontSize: 15 }}>{card.description}</p>
        ) : null
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
          manualEntry={props.isManualEntry}
          defaultDate={card.date}
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
  isManualEntry: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginTop: 10 }}>
      <button type="button" onClick={() => setOpen((v) => !v)} style={secondaryButtonStyle}>
        {open
          ? "Свернуть"
          : props.isManualEntry
            ? "Записать тренировку"
            : "Я всё равно бегал(а), отметиться"}
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
            manualEntry={props.isManualEntry}
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
  /** Часов нет: перед вопросами про усилие — время, дистанция, пульс, темп. */
  manualEntry?: boolean;
  /** Дата тренировки по умолчанию. Пусто — сервер возьмёт «сегодня». */
  defaultDate?: string;
}) {
  const [effort, setEffort] = useState<string | null>(null);
  const [pain, setPain] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [date, setDate] = useState(props.defaultDate ?? "");
  const [durationMinutes, setDurationMinutes] = useState("");
  const [distanceKm, setDistanceKm] = useState("");
  const [averageHeartrate, setAverageHeartrate] = useState("");
  const [averagePace, setAveragePace] = useState(""); // "5:30"
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (!effort || !pain) {
      setErr("Ответьте на оба вопроса.");
      return;
    }
    if (props.manualEntry && !durationMinutes.trim()) {
      setErr("Укажите время тренировки — это единственное обязательное поле.");
      return;
    }
    let paceSecPerKm: number | null = null;
    if (props.manualEntry && averagePace.trim()) {
      const match = averagePace.trim().match(/^(\d{1,2}):(\d{2})$/);
      if (!match) {
        setErr("Темп пишите как 5:30 (минуты:секунды на километр).");
        return;
      }
      paceSecPerKm = Number(match[1]) * 60 + Number(match[2]);
    }
    setBusy(true);
    setErr(null);
    try {
      const url = props.manualEntry ? "/api/m/run/manual-entry" : "/api/m/run/checkin";
      const body: Record<string, unknown> = {
        initData: props.initData,
        timeZone: detectTimeZone(),
        sessionId: props.sessionId,
        effort,
        pain,
        comment,
      };
      if (props.manualEntry) {
        body.date = date || undefined;
        body.durationMinutes = Number(durationMinutes);
        body.distanceKm = distanceKm.trim() ? Number(distanceKm) : null;
        body.averageHeartrate = averageHeartrate.trim() ? Number(averageHeartrate) : null;
        body.averagePaceSecPerKm = paceSecPerKm;
      }
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
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
      {props.manualEntry ? (
        <div style={{ marginBottom: 16 }}>
          <p style={{ margin: "0 0 8px", fontWeight: 600 }}>Тренировка</p>
          <div style={{ display: "grid", gap: 8 }}>
            <label style={{ display: "block" }}>
              <span style={{ display: "block", fontSize: 13, color: MUTED, marginBottom: 4 }}>Дата</span>
              <input
                type="date"
                value={date}
                max={new Date().toISOString().slice(0, 10)}
                onChange={(e) => setDate(e.target.value)}
                style={inputStyle}
              />
            </label>
            <label style={{ display: "block" }}>
              <span style={{ display: "block", fontSize: 13, color: MUTED, marginBottom: 4 }}>
                Сколько длилась, минут *
              </span>
              <input
                type="number"
                inputMode="numeric"
                value={durationMinutes}
                onChange={(e) => setDurationMinutes(e.target.value)}
                placeholder="40"
                style={inputStyle}
              />
            </label>
            <label style={{ display: "block" }}>
              <span style={{ display: "block", fontSize: 13, color: MUTED, marginBottom: 4 }}>
                Дистанция, км — если знаете
              </span>
              <input
                type="number"
                inputMode="decimal"
                value={distanceKm}
                onChange={(e) => setDistanceKm(e.target.value)}
                placeholder="6.5"
                style={inputStyle}
              />
            </label>
            <label style={{ display: "block" }}>
              <span style={{ display: "block", fontSize: 13, color: MUTED, marginBottom: 4 }}>
                Средний пульс — если помните
              </span>
              <input
                type="number"
                inputMode="numeric"
                value={averageHeartrate}
                onChange={(e) => setAverageHeartrate(e.target.value)}
                placeholder="148"
                style={inputStyle}
              />
            </label>
            <label style={{ display: "block" }}>
              <span style={{ display: "block", fontSize: 13, color: MUTED, marginBottom: 4 }}>
                Средний темп, мин:сек на км — если знаете и не вписали дистанцию
              </span>
              <input
                type="text"
                inputMode="numeric"
                value={averagePace}
                onChange={(e) => setAveragePace(e.target.value)}
                placeholder="5:30"
                style={inputStyle}
              />
            </label>
          </div>
        </div>
      ) : null}

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
