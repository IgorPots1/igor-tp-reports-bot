"use client";

import { nbsp } from "@/lib/typography";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";

import {
  NEARBY_KM,
  citySlug,
  expectedDateMd,
  inCity,
  raceCode,
  seasons,
  usuallyIn,
  type PublicExpected,
} from "@/features/races-bot/core";

import {
  DISTS,
  NO_FILTERS,
  TYPES,
  TYPE_LABEL,
  dateStub,
  dayMonth,
  distPills,
  filtersFromSearch,
  filtersToSearch,
  MONTHS,
  plural,
  type Filters,
  type Race,
} from "./races-logic";
import { queryParams, type AreaItem, type Meta, type Page, type Summary } from "./race-query";
import DetailsSections, { type CourseRef } from "./DetailsSections";
import SuggestRace from "./SuggestRace";
import type { FullDetails } from "@/features/race-details/full";
import styles from "./races.module.css";

/** Как показывать «Следить»: ссылкой в бота (сайт) или звёздочкой (внутри Telegram). */
type FollowUi =
  | { mode: "site"; bot: string | null }
  | { mode: "tg"; saved: boolean; busy: boolean; onToggle: (r: Race) => void };

function tgLink(bot: string, start: string): string {
  return `https://t.me/${bot}?start=${start}`;
}

function StarIcon({ filled }: { filled: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
      <path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" />
    </svg>
  );
}

/** «Вся Тверская область», «Весь Краснодарский край», «Москва». */
function allLabel(subject: string): string {
  if (/^(Москва|Санкт-Петербург|Севастополь)$/.test(subject)) return subject;
  return /(край|округ)$/i.test(subject) ? `Весь ${subject}` : `Вся ${subject}`;
}

/** Ожидаемый старт города наверху (29.10.2026): «~16 авг», плашка «дата 2027 ещё не объявлена, в 2026
 *  было 16 августа» и «Следить» — бот напишет, когда объявят дату. */
function ExpectedTopItem({ e, today, bot }: { e: PublicExpected; today: string; bot: string | null }) {
  const date = expectedDateMd(e.md, today);
  const d = Number(date.slice(8, 10));
  const m = Number(date.slice(5, 7));
  return (
    <li className={`${styles.race} ${styles.expectedItem}`}>
      <div className={styles.stub}>
        <div className={styles.d}>~{d}</div>
        <div className={styles.w}>{MONTHS[m - 1].slice(0, 3).toLowerCase()}</div>
      </div>
      <div className={styles.body}>
        <div className={styles.title}>{e.name}</div>
        <div className={styles.where}>
          <b>{e.city || "место уточняется"}</b>
          {e.region && e.region !== e.city ? `, ${e.region}` : null}
        </div>
        <p className={`${styles.note} ${styles.notAnnounced}`}>
          {nbsp(`Дата ${date.slice(0, 4)} ещё не объявлена, в ${e.lastYear} было ${dayMonth(`${e.lastYear}${e.md}`)}`)}
        </p>
        <div className={styles.meta}>
          <span className={`${styles.pill} ${styles.expectedPill}`}>ожидается</span>
          {e.distances.slice(0, 5).map((x, i) => (
            <span key={`${x}-${i}`} className={`${styles.pill} ${styles.dist}`}>
              {x}
            </span>
          ))}
        </div>
        <div className={styles.links}>
          {bot ? (
            <a className={`${styles.btn} ${styles.primary}`} href={tgLink(bot, `e_${raceCode(e.id)}`)} target="_blank" rel="noopener noreferrer">
              <StarIcon filled={false} />
              Следить: сообщим, когда объявят
            </a>
          ) : null}
          {e.site ? (
            <a className={styles.btn} href={e.site} target="_blank" rel="noopener noreferrer">
              Организатор
            </a>
          ) : null}
        </div>
      </div>
    </li>
  );
}

/** away — для блока «Рядом в области»: «Старица, 71 км» вместо обычной строки места. */
/** «Всё о старте» в мини-приложении (16.10.2026): раскрывающийся блок, выжимка грузится при первом
 *  раскрытии (/api/races/details), раскрытие — событие details_open с via: miniapp. */
/** Выжимка, уже загруженная или в пути: блок, появившийся на экране, грузит её заранее (18.10.2026),
 *  и раскрытие «Всё о старте» показывает готовое без ожидания. Адрес только для мини-приложения:
 *  подписанный initData в заголовке (20.10.2026), без него сервер отвечает 401. */
type DetailsData = { important: string | null; details: FullDetails; courses: CourseRef[] };
const detailsCache = new Map<string, Promise<DetailsData>>();
function loadDetails(id: string): Promise<DetailsData> {
  let p = detailsCache.get(id);
  if (!p) {
    const initData = telegramWebApp()?.initData ?? "";
    p = fetch(`/api/races/details?id=${encodeURIComponent(id)}`, { headers: { "X-Telegram-Init-Data": initData } }).then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))));
    p.catch(() => detailsCache.delete(id)); // сбой — следующая попытка заново
    detailsCache.set(id, p);
  }
  return p;
}

function DetailsToggle({ r, onOpen }: { r: Race; onOpen: (r: Race) => void }) {
  const [data, setData] = useState<DetailsData | null>(null);
  const [failed, setFailed] = useState(false);
  const started = useRef(false);
  const box = useRef<HTMLDetailsElement | null>(null);
  // предзагрузка: блок на экране (или в 300 px от него) — выжимка грузится заранее, один раз
  useEffect(() => {
    const el = box.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (es) => {
        if (es.some((e) => e.isIntersecting)) {
          loadDetails(r.id).catch(() => undefined);
          io.disconnect();
        }
      },
      { rootMargin: "300px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [r.id]);
  return (
    <details
      ref={box}
      className={styles.more}
      onToggle={(e) => {
        if (!(e.currentTarget as HTMLDetailsElement).open || started.current) return;
        started.current = true;
        onOpen(r);
        loadDetails(r.id)
          .then((j) => setData(j))
          .catch(() => setFailed(true));
      }}
    >
      <summary className={styles.moreSummary}>Всё о старте</summary>
      <div className={styles.moreBody}>
        {data ? (
          <DetailsSections d={data.details} courses={data.courses} />
        ) : failed ? (
          <p className={styles.note}>Не получилось загрузить. Попробуйте ещё раз позже.</p>
        ) : (
          <p className={styles.moreWait}>Загружаю…</p>
        )}
      </div>
    </details>
  );
}

function RaceItem({
  r,
  follow,
  away,
  onAct,
  onDetails,
}: {
  r: Race;
  follow: FollowUi;
  away?: string;
  onAct?: (a: "open" | "reg" | "site", r: Race) => void;
  /** Только внутри Telegram: строка «Важное» и «Всё о старте». На сайте список без них (вариант Б). */
  onDetails?: (r: Race) => void;
}) {
  const stub = dateStub(r);
  // Расхождение дат разрешено (пометка проверки или правка даты) — без оранжевого предупреждения,
  // одна спокойная строка (16.10.2026). Оранжевое — только для неразрешённых.
  const resolved = !!r.checked || !!r.dateFixed;
  const pills = distPills(r);
  const where = r.region && r.region !== r.city;
  return (
    <li className={styles.race}>
      <div className={`${styles.stub} ${stub.weekend ? styles.weekend : ""}`}>
        <div className={styles.d}>
          {stub.day}
          {stub.tail ? <small>{stub.tail}</small> : null}
        </div>
        <div className={styles.w}>{stub.wd}</div>
      </div>
      <div className={styles.body}>
        <div className={styles.titleRow}>
          <div className={styles.title} onClick={() => onAct?.("open", r)}>
            {r.name}
          </div>
          {follow.mode === "tg" ? (
            <button
              type="button"
              className={`${styles.star} ${follow.saved ? styles.starOn : ""}`}
              aria-pressed={follow.saved}
              aria-label={follow.saved ? "Не следить" : "Следить"}
              disabled={follow.busy}
              onClick={() => follow.onToggle(r)}
            >
              <StarIcon filled={follow.saved} />
            </button>
          ) : null}
        </div>
        <div className={styles.where}>
          {away ? (
            <b>{away}</b>
          ) : (
            <>
              <b>{r.city || (r.noCity ? "город не указан" : "место уточняется")}</b>
              {where ? `, ${r.region}` : null}
            </>
          )}
        </div>
        <div className={styles.meta}>
          {TYPE_LABEL[r.type] ? (
            <span className={`${styles.pill} ${styles[`type_${r.type}`] || ""}`}>{TYPE_LABEL[r.type]}</span>
          ) : null}
          {r.tags.includes("ultra") && r.type !== "tri" ? <span className={styles.pill}>Ультра</span> : null}
          {r.tags.includes("night") ? <span className={styles.pill}>Ночной</span> : null}
          {pills.map((p, i) => (
            <span key={`${p}-${i}`} className={`${styles.pill} ${styles.dist}`}>
              {p}
            </span>
          ))}
          {r.nSources > 1 ? (
            <span className={`${styles.pill} ${styles.ok}`}>
              Подтверждён · {r.nSources} {plural(r.nSources, "источник", "источника", "источников")}
            </span>
          ) : null}
        </div>
        {r.altDates.length && !resolved ? (
          <p className={styles.note}>
            Другой календарь указывает {r.altDates.map(dayMonth).join(", ")}. Возможно, это другой день
            программы. Уточните дату на сайте организатора.
          </p>
        ) : null}
        {r.linkBad ? <p className={styles.note}>Сайт может не работать.</p> : null}
        {r.checked ? (
          <p className={`${styles.note} ${styles.checked}`}>{r.checked}</p>
        ) : r.dateFixed && r.altDates.length ? (
          <p className={`${styles.note} ${styles.checked}`}>Дата сверена с организатором.</p>
        ) : null}
        {onDetails && r.important ? (
          <p className={styles.important}>
            <b>Важное:</b>
            {nbsp(r.important.replace(/^Важное:/, ""))}
          </p>
        ) : null}
        {onDetails && (r.detailsN ?? 0) >= 3 ? <DetailsToggle r={r} onOpen={onDetails} /> : null}
        <div className={styles.links}>
          {r.reg ? (
            <a className={`${styles.btn} ${styles.primary}`} href={r.reg} target="_blank" rel="noopener noreferrer" onClick={() => onAct?.("reg", r)}>
              Регистрация
            </a>
          ) : null}
          {r.site ? (
            <a className={styles.btn} href={r.site} target="_blank" rel="noopener noreferrer" onClick={() => onAct?.("site", r)}>
              Сайт
            </a>
          ) : null}
          {r.vk ? (
            <a className={styles.btn} href={r.vk} target="_blank" rel="noopener noreferrer">
              ВКонтакте
            </a>
          ) : null}
        </div>
        {follow.mode === "site" && follow.bot ? (
          <div className={styles.follow}>
            <a className={styles.followBtn} href={tgLink(follow.bot, `r_${raceCode(r.id)}`)} target="_blank" rel="noopener noreferrer">
              <StarIcon filled={false} />
              Следить в Telegram
            </a>
            <span className={styles.followHint}>напомню, когда пора готовиться, и про погоду накануне</span>
          </div>
        ) : null}
      </div>
    </li>
  );
}

type TgWebApp = { initData?: string; version?: string; ready?: () => void; expand?: () => void };

function telegramWebApp(): TgWebApp | null {
  const w = window as unknown as { Telegram?: { WebApp?: TgWebApp } };
  return w.Telegram?.WebApp?.initData ? w.Telegram.WebApp : null;
}

/**
 * Шапка мини-приложения (16.10.2026): при прокрутке вниз сворачивается в одну строку (поиск и
 * «Фильтры»), при прокрутке вверх или по кнопке «Фильтры» раскрывается. Направление — после 40 px в
 * одну сторону; 350 мс после переключения прокрутку не слушаем: браузер подвигает страницу на разницу
 * высоты шапки, и это читалось бы как прокрутка обратно. Своё состояние — отдельным компонентом:
 * переключение перерисовывает только шапку, не 474 старта списка.
 */
function PinnedHead({
  enabled,
  boxRef,
  listTop,
  quietUntil,
  children,
}: {
  enabled: boolean;
  boxRef: RefObject<HTMLDivElement | null>;
  listTop: RefObject<HTMLDivElement | null>;
  quietUntil: RefObject<number>;
  children: ReactNode;
}) {
  const [compact, setCompactState] = useState(false);
  const now = useRef(false);
  const setCompact = useCallback(
    (v: boolean) => {
      if (now.current === v) return;
      now.current = v;
      quietUntil.current = Date.now() + 350;
      setCompactState(v);
    },
    [quietUntil],
  );
  useEffect(() => {
    if (!enabled) return;
    let last = window.scrollY;
    let acc = 0;
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(() => {
        raf = 0;
        const y = window.scrollY;
        const dy = y - last;
        last = y;
        if (Date.now() < quietUntil.current) return;
        acc = Math.sign(dy) === Math.sign(acc) ? acc + dy : dy;
        const top = (listTop.current?.offsetTop ?? 300) - 40;
        if (y < top) setCompact(false);
        else if (acc > 40) setCompact(true);
        else if (acc < -40) setCompact(false);
        if (Math.abs(acc) > 40) acc = 0;
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, [enabled, listTop, quietUntil, setCompact]);
  if (!enabled) return <div ref={boxRef}>{children}</div>;
  return (
    <div
      ref={boxRef}
      className={`${styles.pinnedTg} ${compact ? styles.compact : ""}`}
      // «Фильтры» в свёрнутой шапке: кнопка с data-expand внутри children
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("[data-expand]")) setCompact(false);
      }}
    >
      {children}
    </div>
  );
}

/** Месяц «Ожидаемых»: старты рисуются и запрашиваются только в раскрытом (их больше 1500). */
function LazyMonth({ summary, onOpen, children }: { summary: ReactNode; onOpen: () => void; children: () => ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <details
      className={styles.month}
      onToggle={(e) => {
        const now = (e.currentTarget as HTMLDetailsElement).open;
        setOpen(now);
        if (now) onOpen();
      }}
    >
      {summary}
      {open ? children() : null}
    </details>
  );
}

const BANNER_KEY = "races_tg_city_banner_closed";

/** Порция, уже показанная в месяце / блоке, и откуда брать следующую. */
type Chunk<T> = { items: T[]; next: number | null; total: number; loading?: boolean };

/** Ответы сервера в памяти страницы: туда-обратно по фильтрам — без повторного запроса и без
 *  лишнего счёта в лимит частоты. Ключ — адрес запроса и то, мини-приложение ли это. */
const answers = new Map<string, Promise<unknown>>();

function chunkOf<T>(p: Page<T>): Chunk<T> {
  return { items: p.items, next: p.next, total: p.total };
}

export default function RacesCalendar({
  meta,
  initial,
  failed,
  botUsername,
}: {
  meta: Meta;
  initial: Summary | null;
  failed: boolean;
  botUsername: string | null;
}) {
  const [f, setF] = useState<Filters>(NO_FILTERS);
  const [query, setQuery] = useState("");
  /* Месяцы, которые человек раскрыл или свернул сам. Пока он ничего не
     трогал, открыт ближайший месяц (при поиске два первых). */
  const [open, setOpen] = useState<Record<string, boolean>>({});
  /* Внутри Telegram (мини-апп бота): initData есть, звёздочка вместо ссылки в бота. С подписью сервер
     добавляет к стартам «Важное» и число полей выжимки. */
  const [initData, setInitData] = useState<string | null>(null);
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [onlyMine, setOnlyMine] = useState(false);
  const [bannerClosed, setBannerClosed] = useState(true);

  // Сводка по фильтрам и порции: месяцы, ожидаемые, «ожидаются в городе», «рядом».
  const [sum, setSum] = useState<Summary | null>(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<"" | "limit" | "net">("");
  const [months, setMonths] = useState<Record<string, Chunk<Race>>>(() =>
    initial?.first ? { [initial.first.month]: chunkOf(initial.first) } : {},
  );
  const [exMonths, setExMonths] = useState<Record<number, Chunk<PublicExpected>>>({});
  const [cityExp, setCityExp] = useState<Chunk<PublicExpected> | null>(() => (initial ? chunkOf(initial.cityExpected) : null));
  const [area, setArea] = useState<Chunk<AreaItem> | null>(() => (initial ? chunkOf(initial.area) : null));
  const gen = useRef(0);

  // Внутри Telegram страница открывается с #tgWebAppData=…: только тогда подключаем скрипт
  // Telegram (обычным посетителям сторонний скрипт не нужен) и ждём его несколько секунд.
  useEffect(() => {
    try {
      setBannerClosed(window.localStorage.getItem(BANNER_KEY) === "1");
    } catch {
      setBannerClosed(false);
    }
    if (!/tgWebApp(Data|Platform)/.test(window.location.hash)) return;
    if (!document.querySelector("script[data-tg-webapp]")) {
      const el = document.createElement("script");
      el.src = "https://telegram.org/js/telegram-web-app.js";
      el.async = true;
      el.dataset.tgWebapp = "1";
      document.head.appendChild(el);
    }
    let tries = 0;
    const t = window.setInterval(() => {
      const app = telegramWebApp();
      if (app) {
        app.ready?.();
        app.expand?.();
        setInitData(app.initData || null);
      }
      if (app || ++tries > 25) window.clearInterval(t);
    }, 200);
    return () => window.clearInterval(t);
  }, []);

  // Откуда открыт календарь из бота (?from= в ссылке web_app): читается при первом рендере,
  // до того как фильтры перепишут адрес, и уходит только с первым «list» — для статистики.
  const openedFrom = useRef<string | null>(typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("from") : null);

  const miniapp = useCallback(
    async (action: "list" | "follow" | "unfollow", raceId?: string) => {
      if (!initData) return;
      const from = action === "list" ? openedFrom.current : null;
      const res = await fetch("/api/races-bot/miniapp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // version — чтобы бот не слал rich-сообщения старому клиенту (18.10.2026)
        body: JSON.stringify({ initData, action, raceId, from, appVersion: action === "list" ? telegramWebApp()?.version ?? null : null }),
      });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; follows?: string[] } | null;
      if (body?.ok && body.follows) setSaved(new Set(body.follows));
    },
    [initData],
  );

  // Статистика: что делают внутри календаря (только в Telegram, по подписанному initData).
  // Тихо и без ожидания: сбой записи не мешает человеку.
  const act = useCallback(
    (a: "season" | "filter" | "open" | "reg" | "site" | "details", v?: string | null, raceId?: string) => {
      if (!initData) return;
      void fetch("/api/races-bot/miniapp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initData, action: "event", a, v: v ?? null, raceId }),
        keepalive: true,
      }).catch(() => undefined);
    },
    [initData],
  );

  // Поиск текстом — тоже фильтр; сам запрос в статистику не пишем.
  const lastQ = useRef("");
  useEffect(() => {
    if (f.q.trim() && f.q !== lastQ.current) act("filter", "q");
    lastQ.current = f.q;
  }, [f.q, act]);

  useEffect(() => {
    if (initData) void miniapp("list");
  }, [initData, miniapp]);

  async function toggle(r: Race) {
    const on = !saved.has(r.id);
    setBusy(r.id);
    setSaved((prev) => {
      const next = new Set(prev);
      if (on) next.add(r.id);
      else next.delete(r.id);
      return next;
    });
    try {
      await miniapp(on ? "follow" : "unfollow", r.id);
    } finally {
      setBusy(null);
    }
  }

  function closeBanner() {
    setBannerClosed(true);
    try {
      window.localStorage.setItem(BANNER_KEY, "1");
    } catch {
      /* приватный режим: закрыто до перезагрузки */
    }
  }

  // Фильтры из адреса: страница статическая (ISR), поэтому читаем их в браузере.
  useEffect(() => {
    const init = filtersFromSearch(window.location.search);
    setF(init);
    setQuery(init.q);
  }, []);

  // Поиск с задержкой 250 мс (16.10.2026; было 120): запрос к серверу не на каждую букву.
  useEffect(() => {
    const t = window.setTimeout(() => {
      setF((prev) => (prev.q === query ? prev : { ...prev, q: query }));
    }, 250);
    return () => window.clearTimeout(t);
  }, [query]);

  // Фильтры в адрес: ссылкой «трейлы в Казани» можно поделиться. Hash не трогаем: внутри
  // Telegram в нём #tgWebAppData, из которого скрипт Telegram берёт initData.
  useEffect(() => {
    const next = `${window.location.pathname}${filtersToSearch(f)}${window.location.hash}`;
    if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
      window.history.replaceState(null, "", next);
    }
    setOpen({});
  }, [f]);

  // Сменился фильтр или поиск — список наверх, один раз и сразу (без плавной прокрутки, которая
  // на iPhone догоняла новые результаты и прыгала). Только если человек уже ниже начала списка.
  const listTop = useRef<HTMLDivElement | null>(null);
  const pinned = useRef<HTMLDivElement | null>(null);
  const firstF = useRef(true);
  const quietUntil = useRef(0);
  useEffect(() => {
    if (firstF.current) {
      firstF.current = false;
      return;
    }
    const el = listTop.current;
    if (!el) return;
    const head = pinned.current?.getBoundingClientRect().height ?? 0;
    const target = el.getBoundingClientRect().top + window.scrollY - head - 8;
    if (window.scrollY > target) {
      quietUntil.current = Date.now() + 350;
      window.scrollTo({ top: Math.max(0, target), behavior: "auto" });
    }
  }, [f]);

  // ── запросы к серверу ───────────────────────────────────────────────────────
  const q = useMemo(() => ({ ...f, ids: onlyMine ? [...saved].sort() : null }), [f, onlyMine, saved]);
  const qKey = queryParams(q);
  const qRef = useRef(q);
  qRef.current = q;

  const api = useCallback(
    async <T,>(params: string): Promise<T> => {
      const key = `${initData ? "tg" : "web"}|${params}`;
      let p = answers.get(key) as Promise<T> | undefined;
      if (!p) {
        p = fetch(`/api/races/query?${params}`, { headers: initData ? { "X-Telegram-Init-Data": initData } : {} }).then(async (res) => {
          if (res.status === 429) throw new Error("limit");
          const j = (await res.json().catch(() => null)) as ({ ok?: boolean } & T) | null;
          if (!res.ok || !j?.ok) throw new Error("net");
          return j as T;
        });
        answers.set(key, p);
        if (answers.size > 200) answers.delete(answers.keys().next().value as string);
        p.catch(() => answers.delete(key)); // сбой не запоминаем
      }
      return p;
    },
    [initData],
  );

  // Сводка по фильтрам. Первый показ без фильтров уже в HTML; внутри Telegram — повторно, с «Важным».
  const initialKey = useRef(queryParams({ ...NO_FILTERS, ids: null }));
  useEffect(() => {
    if (failed) return;
    if (!initData && qKey === initialKey.current && gen.current === 0) return;
    const my = ++gen.current;
    setLoading(true);
    api<Summary>(qKey)
      .then((s) => {
        if (my !== gen.current) return;
        setError("");
        setSum(s);
        setMonths(s.first ? { [s.first.month]: chunkOf(s.first) } : {});
        setExMonths({});
        setCityExp(chunkOf(s.cityExpected));
        setArea(chunkOf(s.area));
      })
      .catch((e: Error) => {
        if (my === gen.current) setError(e.message === "limit" ? "limit" : "net");
      })
      .finally(() => {
        if (my === gen.current) setLoading(false);
      });
  }, [qKey, initData, api, failed]);

  /** Следующая порция блока: месяц списка, месяц ожидаемых, «ожидаются в городе», «рядом». */
  const more = useCallback(
    <T,>(params: Record<string, string | number>, set: (fn: (c: Chunk<T> | undefined) => Chunk<T>) => void, offset: number) => {
      const my = gen.current;
      set((c) => ({ items: c?.items ?? [], next: c?.next ?? null, total: c?.total ?? 0, loading: true }));
      api<Page<T>>(queryParams(qRef.current, { ...params, offset }))
        .then((p) => {
          if (my !== gen.current) return;
          setError("");
          set((c) => ({ items: [...(offset ? c?.items ?? [] : []), ...p.items], next: p.next, total: p.total }));
        })
        .catch((e: Error) => {
          if (my !== gen.current) return;
          setError(e.message === "limit" ? "limit" : "net");
          set((c) => ({ items: c?.items ?? [], next: c?.next ?? offset, total: c?.total ?? 0 }));
        });
    },
    [api],
  );
  const moreMonth = useCallback(
    (key: string, offset: number) => more<Race>({ view: "month", month: key }, (fn) => setMonths((all) => ({ ...all, [key]: fn(all[key]) })), offset),
    [more],
  );
  const moreExpected = (m: number, offset: number) =>
    more<PublicExpected>({ view: "expected", m }, (fn) => setExMonths((all) => ({ ...all, [m]: fn(all[m]) })), offset);

  // Раскрытый месяц без своих стартов — запросить первую порцию.
  const searching = f.q.trim() !== "";
  const monthList = sum?.months ?? [];
  const openKeys = monthList.filter(([k], i) => open[k] ?? (searching ? i < 2 : i === 0)).map(([k]) => k);
  const openKey = openKeys.join(",");
  useEffect(() => {
    for (const k of openKey ? openKey.split(",") : []) if (!months[k]) moreMonth(k, 0);
  }, [openKey, months, moreMonth]);

  const today = meta.today || new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Moscow" }).format(new Date());
  const seasonTabs = useMemo(() => seasons(today), [today]);
  const place = sum?.place ?? null;
  const cityCount = sum?.cityCount ?? 0;
  const dirty = f.q !== "" || f.type !== "all" || f.dist !== "all" || f.region !== "" || !!f.season;
  const inTg = initData !== null;
  // Плашка подписки — когда в поиске ровно город из календаря.
  const bannerCity = place;
  const onRaceAct = (a: "open" | "reg" | "site", r: Race) => act(a, null, r.id);
  const onDetails = (r: Race) => act("details", null, r.id);
  const followUi = (r: Race): FollowUi =>
    inTg ? { mode: "tg", saved: saved.has(r.id), busy: busy === r.id, onToggle: toggle } : { mode: "site", bot: botUsername };
  const listCount = sum?.listCount ?? 0;
  const listCities = sum?.listCities ?? 0;
  const areaItems = area?.items ?? [];
  const areaTotal = area?.total ?? 0;
  const cityExpItems = cityExp?.items ?? [];

  function reset() {
    setQuery("");
    setF(NO_FILTERS);
  }

  return (
    <div className={styles.wrap}>
      <header className={styles.top}>
        <h1 className={styles.h1}>Забеги России</h1>
        <p className={styles.lede}>
          Шоссе, трейлы, ультра и триатлон. Введите город, и забеги разложатся по месяцам. У каждого
          старта ссылка на сайт организатора и регистрацию.
        </p>
        {meta.total ? (
          <p className={styles.stats}>
            <span>
              <b>{meta.total}</b> {plural(meta.total, "старт", "старта", "стартов")}
            </span>
            <span>
              <b>{meta.nCities}</b> {plural(meta.nCities, "город", "города", "городов")}
            </span>
          </p>
        ) : null}
      </header>

      <PinnedHead enabled={inTg} boxRef={pinned} listTop={listTop} quietUntil={quietUntil}>
      <div className={styles.search}>
        <input
          type="search"
          list="races-cities"
          className={styles.input}
          // Короче эталона: «…или название забега» на 375 px не влезает даже на всю
          // ширину, а шрифт меньше 16 px нельзя (iOS приближает страницу при фокусе).
          placeholder="Город, область или забег"
          aria-label="Город, область или название забега"
          autoComplete="off"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <datalist id="races-cities">
          {meta.cities.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        {/* «Сбросить» только когда есть что сбрасывать: на 375 px пустое поле
            рядом с кнопкой обрезало плейсхолдер, а с фильтрами в поле уже текст. */}
        {inTg ? (
          <button type="button" className={`${styles.reset} ${styles.expandBtn}`} data-expand="1">
            Фильтры
          </button>
        ) : null}
        {dirty || query !== "" ? (
          <button type="button" className={`${styles.reset} ${styles.resetBtn}`} onClick={reset}>
            Сбросить
          </button>
        ) : null}
      </div>

        <div className={styles.seasons} role="tablist" aria-label="Сезон">
          {seasonTabs.map((s) => {
            const on = (f.season || "all") === s.key;
            const n = sum?.counts.season[s.key] ?? 0;
            if (!n && s.key !== "all") return null;
            return (
              <button
                key={s.key}
                type="button"
                role="tab"
                aria-selected={on}
                className={styles.chip}
                onClick={() => {
                  act("season", s.key);
                  setF((p) => ({ ...p, season: s.key === "all" ? "" : s.key }));
                }}
              >
                {s.key === "near" ? "Ближайшие" : s.key === "all" ? "Все" : s.label}
                <span className={styles.n}>{n}</span>
              </button>
            );
          })}
        </div>
      <section className={styles.filters} aria-label="Фильтры">
        <div className={styles.chiprow} role="group" aria-label="Тип старта">
          <span className={styles.lbl}>Тип</span>
          {TYPES.map(([v, label]) => (
            <button
              key={v}
              type="button"
              className={styles.chip}
              aria-pressed={f.type === v}
              onClick={() => {
                act("filter", `type:${v}`);
                setF((p) => ({ ...p, type: v }));
              }}
            >
              {label}
              <span className={styles.n}>{sum?.counts.type[v] ?? 0}</span>
            </button>
          ))}
        </div>
        <div className={styles.chiprow} role="group" aria-label="Дистанция">
          <span className={styles.lbl}>Дистанция</span>
          {DISTS.map(([v, label]) => (
            <button
              key={v}
              type="button"
              className={styles.chip}
              aria-pressed={f.dist === v}
              onClick={() => {
                act("filter", `dist:${v}`);
                setF((p) => ({ ...p, dist: v }));
              }}
            >
              {label}
              <span className={styles.n}>{sum?.counts.dist[v] ?? 0}</span>
            </button>
          ))}
        </div>
        {meta.subjects.length ? (
          <div className={styles.chiprow}>
            <label className={styles.lbl} htmlFor="races-region">
              Область
            </label>
            <select
              id="races-region"
              className={styles.select}
              value={f.region}
              onChange={(e) => {
                act("filter", `region:${e.target.value || "all"}`);
                setF((p) => ({ ...p, region: e.target.value }));
              }}
            >
              <option value="">Все области</option>
              {meta.subjects.map(({ subject, n }) => (
                <option key={subject} value={subject}>
                  {allLabel(subject)} · {n}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <p className={styles.resultLine} aria-live="polite">
          {listCount ? (
            <>
              <b>{listCount}</b> {plural(listCount, "старт", "старта", "стартов")}
              {searching ? ` · ${listCities} ${plural(listCities, "населённый пункт", "населённых пункта", "населённых пунктов")}` : ""}
            </>
          ) : null}
        </p>
      </section>
      </PinnedHead>

      {/* Плашка всегда на одном месте (16.10.2026): раньше при пустом промежуточном результате поиска
          она переезжала внутрь сообщения «ничего не нашлось» и монтировалась заново — мигала. */}
      {meta.total ? (
        <div className={styles.suggestBar}>
          <SuggestRace />
        </div>
      ) : null}

      {error ? (
        <div className={styles.state} role="status">
          {error === "limit"
            ? "Слишком много запросов подряд. Подождите минуту, и календарь снова ответит."
            : "Не получилось загрузить. Проверьте связь и попробуйте ещё раз."}
        </div>
      ) : null}

      {cityExpItems.length && place ? (
        <section className={styles.expected} aria-label="Ожидаются в городе">
          <h2 className={styles.expectedTitle}>{nbsp(`Ожидаются ${inCity(place)}`)}</h2>
          <p className={styles.expectedLede}>
            {cityCount
              ? `Стартов с датой ${inCity(place)} пока ${cityCount}. `
              : `Стартов с датой ${inCity(place)} пока нет. `}
            Эти проходят каждый год, а дату следующего ещё не объявили. «Следить» — напишем в Telegram, когда объявят.
          </p>
          <ol className={styles.races}>
            {cityExpItems.map((e) => (
              <ExpectedTopItem key={e.id} e={e} today={today} bot={botUsername} />
            ))}
          </ol>
          {cityExp?.next != null ? (
            <button
              type="button"
              className={styles.btn}
              disabled={cityExp.loading}
              onClick={() => more<PublicExpected>({ view: "cityexp" }, (fn) => setCityExp((c) => fn(c ?? undefined)), cityExp.next ?? 0)}
            >
              Показать ещё {Math.min(30, cityExp.total - cityExpItems.length)}
            </button>
          ) : null}
        </section>
      ) : null}

      <div ref={listTop} className={styles.months} aria-busy={loading} style={loading ? { opacity: 0.55 } : undefined}>
        {failed ? (
          <div className={styles.state}>Не получилось загрузить календарь. Обновите страницу через минуту.</div>
        ) : !meta.total ? (
          <div className={styles.state}>Календарь пока пуст. Данные появятся после ближайшего обновления.</div>
        ) : !sum ? null : !listCount && place ? (
          <div className={styles.state}>
            <p>
              {`${inCity(place).replace(/^в/, "В")} пока нет стартов с датой`}
              {areaTotal ? `. Ниже ближайшие в радиусе ${NEARBY_KM} км` : ""}
              {f.type !== "all" || f.dist !== "all" ? " с этими фильтрами" : ""}.
            </p>
          </div>
        ) : !listCount ? (
          <div className={styles.state}>
            <p>
              Ничего не нашлось{f.q ? ` по запросу «${f.q}»` : ""}. Попробуйте область вместо города или
              снимите фильтр дистанции. Знаете старт, которого нет? Добавьте его формой выше.
            </p>
            <button type="button" className={`${styles.btn} ${styles.primary}`} onClick={reset}>
              Сбросить фильтры
            </button>
          </div>
        ) : (
          monthList.map(([key, n], i) => {
            const isOpen = open[key] ?? (searching ? i < 2 : i === 0);
            const [y, m] = key.split("-").map(Number);
            const chunk = months[key];
            return (
              <details
                key={key}
                className={styles.month}
                open={isOpen}
                onToggle={(e) => {
                  const now = (e.currentTarget as HTMLDetailsElement).open;
                  if (now !== isOpen) setOpen((o) => ({ ...o, [key]: now }));
                }}
              >
                <summary className={styles.summary}>
                  <span className={styles.mName}>
                    {MONTHS[m - 1]} {y}
                  </span>
                  <span className={styles.mCount}>
                    <b>{n}</b> {plural(n, "старт", "старта", "стартов")}
                  </span>
                  <span className={styles.caret} aria-hidden="true" />
                </summary>
                {/* Закрытый месяц стартов не рисует и не запрашивает; раскрытый — порциями по 30. */}
                {isOpen ? (
                  <>
                    {chunk?.items.length ? (
                      <ol className={styles.races}>
                        {chunk.items.map((r) => (
                          <RaceItem key={r.id} r={r} follow={followUi(r)} onAct={onRaceAct} onDetails={inTg ? onDetails : undefined} />
                        ))}
                      </ol>
                    ) : (
                      <p className={styles.moreWait}>Загружаю…</p>
                    )}
                    {chunk && chunk.next != null ? (
                      <button type="button" className={styles.btn} disabled={chunk.loading} onClick={() => moreMonth(key, chunk.next ?? 0)}>
                        {chunk.loading ? "Загружаю…" : `Показать ещё ${Math.min(30, n - chunk.items.length)}`}
                      </button>
                    ) : null}
                  </>
                ) : null}
              </details>
            );
          })
        )}
      </div>

      {areaItems.length ? (
        <section className={styles.expected} aria-label="Рядом в области">
          <h2 className={styles.expectedTitle}>{cityCount ? "Рядом в области" : `Ближайшие старты в радиусе ${NEARBY_KM} км`}</h2>
          <p className={styles.expectedLede}>
            {sum?.area.subject ? `${sum.area.subject} и` : "В"} радиусе {NEARBY_KM} км от города {bannerCity}: {areaTotal}{" "}
            {plural(areaTotal, "старт", "старта", "стартов")}, ближайшие первыми.
          </p>
          <ol className={styles.races}>
            {areaItems.map(({ race, km }) => (
              <RaceItem
                key={race.id}
                r={race}
                follow={followUi(race)}
                onAct={onRaceAct}
                onDetails={inTg ? onDetails : undefined}
                away={`${race.city || `${race.subject}, город не указан`}${km === null ? "" : `, ${km} км`}`}
              />
            ))}
          </ol>
          {area?.next != null ? (
            <button
              type="button"
              className={styles.btn}
              disabled={area.loading}
              onClick={() => more<AreaItem>({ view: "area", limit: 8 }, (fn) => setArea((c) => fn(c ?? undefined)), area.next ?? 0)}
            >
              Показать ещё {Math.min(8, areaTotal - areaItems.length)}
            </button>
          ) : null}
        </section>
      ) : null}

      {/* Город без своих стартов (29.10.2026): после ожидаемых и соседей — позвать добавить свой старт. */}
      {place && !cityCount && !onlyMine ? (
        <div className={styles.suggestBar}>
          <SuggestRace key={place} prefillCity={place} label="Знаете старт в вашем городе? Добавьте" />
        </div>
      ) : null}

      {sum?.expectedTotal ? (
        <section className={styles.expected} aria-label="Ожидаемые старты">
          <h2 className={styles.expectedTitle}>Ожидаются, дата 2027 пока не объявлена</h2>
          <p className={styles.expectedLede}>
            Прошли в прошлом сезоне, а даты следующего проведения ещё нет. {sum.expectedTotal}{" "}
            {plural(sum.expectedTotal, "старт", "старта", "стартов")}, по месяцу прошлого проведения.
          </p>
          {sum.expectedMonths.map(([m, n]) => (
            <LazyMonth
              key={`${qKey}|${m}`}
              onOpen={() => {
                if (!exMonths[m]) moreExpected(m, 0);
              }}
              summary={
                <summary className={styles.summary}>
                  <span className={styles.mName}>{MONTHS[m - 1]}</span>
                  <span className={styles.mCount}>
                    <b>{n}</b> ожидается
                  </span>
                  <span className={styles.caret} aria-hidden="true" />
                </summary>
              }
            >
              {() => {
                const chunk = exMonths[m];
                if (!chunk?.items.length) return <p className={styles.moreWait}>Загружаю…</p>;
                return (
                  <>
                    <ol className={styles.races}>
                      {chunk.items.map((e) => (
                        <li key={e.id} className={`${styles.race} ${styles.expectedItem}`}>
                          <div className={styles.stub}>
                            <div className={styles.d}>?</div>
                            <div className={styles.w}>{MONTHS[m - 1].slice(0, 3).toLowerCase()}</div>
                          </div>
                          <div className={styles.body}>
                            <div className={styles.title}>{e.name}</div>
                            <div className={styles.where}>
                              <b>{e.city || "место уточняется"}</b>
                              {e.region && e.region !== e.city ? `, ${e.region}` : null} · {usuallyIn(m)}
                            </div>
                            <div className={styles.meta}>
                              <span className={`${styles.pill} ${styles.expectedPill}`}>ожидается</span>
                              {e.distances.slice(0, 5).map((d, i) => (
                                <span key={`${d}-${i}`} className={`${styles.pill} ${styles.dist}`}>
                                  {d}
                                </span>
                              ))}
                            </div>
                            <div className={styles.links}>
                              {e.site ? (
                                <a className={styles.btn} href={e.site} target="_blank" rel="noopener noreferrer">
                                  Организатор
                                </a>
                              ) : null}
                              {botUsername ? (
                                <a className={styles.btn} href={tgLink(botUsername, `e_${raceCode(e.id)}`)} target="_blank" rel="noopener noreferrer">
                                  Сообщить, когда объявят дату
                                </a>
                              ) : null}
                            </div>
                          </div>
                        </li>
                      ))}
                    </ol>
                    {chunk.next != null ? (
                      <button type="button" className={styles.btn} disabled={chunk.loading} onClick={() => moreExpected(m, chunk.next ?? 0)}>
                        {chunk.loading ? "Загружаю…" : `Показать ещё ${Math.min(30, n - chunk.items.length)}`}
                      </button>
                    ) : null}
                  </>
                );
              }}
            </LazyMonth>
          ))}
        </section>
      ) : null}

      {inTg ? (
        <div className={styles.dock}>
          <button
            type="button"
            className={`${styles.btn} ${styles.primary} ${styles.dockBtn}`}
            aria-pressed={onlyMine}
            onClick={() => setOnlyMine((v) => !v)}
          >
            {onlyMine ? "Все забеги" : `Мои забеги · ${saved.size}`}
          </button>
        </div>
      ) : botUsername && bannerCity && !bannerClosed ? (
        <div className={styles.dock}>
          <div className={styles.banner}>
            <div className={styles.bannerText}>
              <b>Новые забеги {inCity(bannerCity)} в Telegram</b>
              <span>одно сообщение в неделю</span>
            </div>
            <a
              className={`${styles.btn} ${styles.primary}`}
              href={tgLink(botUsername, `c_${citySlug(bannerCity)}`)}
              target="_blank"
              rel="noopener noreferrer"
            >
              Подписаться
            </a>
            <button type="button" className={styles.bannerClose} aria-label="Скрыть" onClick={closeBanner}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6 6 18" />
              </svg>
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
