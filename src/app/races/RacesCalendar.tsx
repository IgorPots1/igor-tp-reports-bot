"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { NEARBY_KM, areaRaces, citySlug, expectedDate, inCity, raceCode, seasons, usuallyIn, type ExpectedItem } from "@/features/races-bot/core";

import {
  DISTS,
  NO_FILTERS,
  TYPES,
  TYPE_LABEL,
  applyFilters,
  dateStub,
  dayMonth,
  distMatch,
  distPills,
  filtersFromSearch,
  filtersToSearch,
  groupByMonth,
  MONTHS,
  norm,
  plural,
  inRange,
  subjectsOf,
  type Filters,
  type Race,
} from "./races-logic";
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

/** away — для блока «Рядом в области»: «Старица, 71 км» вместо обычной строки места. */
/** «Всё о старте» в мини-приложении (16.10.2026): раскрывающийся блок, выжимка грузится при первом
 *  раскрытии (/api/races/details), раскрытие — событие details_open с via: miniapp. */
function DetailsToggle({ r, onOpen }: { r: Race; onOpen: (r: Race) => void }) {
  const [data, setData] = useState<{ important: string | null; details: FullDetails; courses: CourseRef[] } | null>(null);
  const [failed, setFailed] = useState(false);
  const started = useRef(false);
  return (
    <details
      className={styles.more}
      onToggle={(e) => {
        if (!(e.currentTarget as HTMLDetailsElement).open || started.current) return;
        started.current = true;
        onOpen(r);
        fetch(`/api/races/details?id=${encodeURIComponent(r.id)}`)
          .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
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
            {r.important.replace(/^Важное:/, "")}
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
          {r.src && r.src !== r.reg && r.src !== r.site ? (
            <a className={`${styles.btn} ${styles.quiet}`} href={r.src} target="_blank" rel="noopener noreferrer">
              {r.srcName}
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

type TgWebApp = { initData?: string; ready?: () => void; expand?: () => void };

function telegramWebApp(): TgWebApp | null {
  const w = window as unknown as { Telegram?: { WebApp?: TgWebApp } };
  return w.Telegram?.WebApp?.initData ? w.Telegram.WebApp : null;
}

const BANNER_KEY = "races_tg_city_banner_closed";

export default function RacesCalendar({
  races,
  failed,
  botUsername,
  expected = [],
}: {
  races: Race[];
  failed: boolean;
  botUsername: string | null;
  expected?: ExpectedItem[];
}) {
  const [f, setF] = useState<Filters>(NO_FILTERS);
  const [query, setQuery] = useState("");
  /* Месяцы, которые человек раскрыл или свернул сам. Пока он ничего не
     трогал, открыт ближайший месяц (при поиске два первых). */
  const [open, setOpen] = useState<Record<string, boolean>>({});
  /* Внутри Telegram (мини-апп бота): initData есть, звёздочка вместо ссылки в бота. */
  const [initData, setInitData] = useState<string | null>(null);
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [onlyMine, setOnlyMine] = useState(false);
  const [bannerClosed, setBannerClosed] = useState(true);

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
        body: JSON.stringify({ initData, action, raceId, from }),
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

  // Поиск с задержкой 250 мс (16.10.2026; было 120): список не перерисовывается на каждую букву.
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

  // Шапка мини-приложения (16.10.2026): при прокрутке вниз сворачивается в одну строку (поиск и
  // «Фильтры»), при прокрутке вверх или по кнопке раскрывается. Направление — после 40 px в одну
  // сторону; 350 мс после переключения прокрутку не слушаем: браузер подвигает страницу на разницу
  // высоты шапки, и это читалось бы как прокрутка обратно (шапка дёргалась бы туда-обратно).
  const [compact, setCompactState] = useState(false);
  const compactNow = useRef(false);
  const setCompact = useCallback((v: boolean) => {
    if (compactNow.current === v) return;
    compactNow.current = v;
    quietUntil.current = Date.now() + 350;
    setCompactState(v);
  }, []);
  useEffect(() => {
    if (initData === null) return;
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
  }, [initData, setCompact]);

  // Сезоны вкладками сверху — те же, что в боте: Ближайшие, три сезона, Все.
  const today = useMemo(() => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Moscow" }).format(new Date()), []);
  const seasonTabs = useMemo(() => seasons(today), [today]);
  const season = seasonTabs.find((s) => s.key === f.season && s.key !== "all") ?? null;
  const list = useMemo(() => {
    const base = applyFilters(races, f).filter((r) => !season || inRange(r, season.from, season.to));
    return onlyMine ? base.filter((r) => saved.has(r.id)) : base;
  }, [races, f, onlyMine, saved, season]);
  const months = useMemo(() => groupByMonth(list), [list]);
  // Ожидаемые: те же поиск и фильтры, что у стартов (дистанции — по километрам из строк).
  const expectedByMonth = useMemo(() => {
    if (onlyMine) return [];
    const words = norm(f.q).split(/[\s,]+/).filter(Boolean);
    const shown = expected.filter((e) => {
      if (f.type !== "all" && e.type !== f.type) return false;
      if (f.dist !== "all" && !distMatch({ km: e.km, tags: [] } as unknown as Race, f.dist)) return false;
      if (f.region && e.subject !== f.region) return false;
      if (season) {
        const d = expectedDate(e, today);
        if (d < season.from || d > season.to) return false;
      }
      const hay = norm(`${e.name} ${e.city} ${e.region} ${e.subject ?? ""}`);
      return words.every((w) => hay.includes(w));
    });
    const by = new Map<number, ExpectedItem[]>();
    for (const e of shown) by.set(e.lastMonth, [...(by.get(e.lastMonth) || []), e]);
    // С ближайшего месяца: сейчас октябрь — сначала ноябрь, декабрь, потом весна.
    const startM = new Date().getMonth() + 1;
    return [...by.entries()].sort((a, b) => ((a[0] - startM + 12) % 12) - ((b[0] - startM + 12) % 12));
  }, [expected, f, onlyMine, season, today]);
  const expectedCount = expectedByMonth.reduce((n, [, xs]) => n + xs.length, 0);
  const typeBase = useMemo(() => applyFilters(races, f, "type"), [races, f]);
  const distBase = useMemo(() => applyFilters(races, f, "dist"), [races, f]);
  const cities = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of races) if (r.city) counts.set(r.city, (counts.get(r.city) || 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
  }, [races]);

  const searching = f.q.trim() !== "";
  const nCities = new Set(races.map((r) => r.city).filter(Boolean)).size;
  const listCities = new Set(list.map((r) => r.city).filter(Boolean)).size;
  const dirty = f.q !== "" || f.type !== "all" || f.dist !== "all" || f.region !== "" || !!f.season;
  const subjects = useMemo(() => subjectsOf(races), [races]);
  const inTg = initData !== null;
  // Плашка подписки — когда в поиске ровно город из календаря.
  const bannerCity = useMemo(() => {
    const q = f.q.trim().toLowerCase().replace(/ё/g, "е");
    return q ? cities.find((c) => c.toLowerCase().replace(/ё/g, "е") === q) ?? null : null;
  }, [f.q, cities]);
  // Страница города (в поиске ровно город): блок «Рядом в области» — та же область и 150 км,
  // ближайшие первыми, «Старица, 71 км». Тип и дистанция применяются, поиск и область — нет.
  const [areaShown, setAreaShown] = useState(8);
  const area = useMemo(() => {
    if (!bannerCity || onlyMine) return { subject: "", items: [] as { race: Race; km: number | null }[] };
    const a = areaRaces(races, bannerCity, [], []);
    return { subject: a.subject, items: a.items.filter(({ race }) => applyFilters([race], { ...f, q: "", region: "" }).length > 0) };
  }, [bannerCity, races, f, onlyMine]);
  useEffect(() => setAreaShown(8), [bannerCity]);
  // Счётчик на вкладке сезона: те же фильтры, без самого сезона.
  const seasonBase = useMemo(() => applyFilters(races, { ...f, season: "" }), [races, f]);
  const seasonCount = (s: { from: string; to: string } | null) => (s ? seasonBase.filter((r) => inRange(r, s.from, s.to)).length : seasonBase.length);
  const onRaceAct = (a: "open" | "reg" | "site", r: Race) => act(a, null, r.id);
  const onDetails = (r: Race) => act("details", null, r.id);
  const followUi = (r: Race): FollowUi =>
    inTg ? { mode: "tg", saved: saved.has(r.id), busy: busy === r.id, onToggle: toggle } : { mode: "site", bot: botUsername };

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
        {races.length ? (
          <p className={styles.stats}>
            <span>
              <b>{races.length}</b> {plural(races.length, "старт", "старта", "стартов")}
            </span>
            <span>
              <b>{nCities}</b> {plural(nCities, "город", "города", "городов")}
            </span>
          </p>
        ) : null}
      </header>

      <div ref={pinned} className={inTg ? `${styles.pinnedTg} ${compact ? styles.compact : ""}` : undefined}>
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
          {cities.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        {/* «Сбросить» только когда есть что сбрасывать: на 375 px пустое поле
            рядом с кнопкой обрезало плейсхолдер, а с фильтрами в поле уже текст. */}
        {inTg && compact ? (
          <button
            type="button"
            className={styles.reset}
            onClick={() => setCompact(false)}
          >
            Фильтры
          </button>
        ) : dirty || query !== "" ? (
          <button type="button" className={styles.reset} onClick={reset}>
            Сбросить
          </button>
        ) : null}
      </div>

        <div className={styles.seasons} role="tablist" aria-label="Сезон">
          {seasonTabs.map((s) => {
            const on = (f.season || "all") === s.key;
            const n = seasonCount(s.key === "all" ? null : s);
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
              <span className={styles.n}>{v === "all" ? typeBase.length : typeBase.filter((r) => r.type === v).length}</span>
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
              <span className={styles.n}>{distBase.filter((r) => distMatch(r, v)).length}</span>
            </button>
          ))}
        </div>
        {subjects.length ? (
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
              {subjects.map(({ subject, n }) => (
                <option key={subject} value={subject}>
                  {allLabel(subject)} · {n}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <p className={styles.resultLine} aria-live="polite">
          {list.length ? (
            <>
              <b>{list.length}</b> {plural(list.length, "старт", "старта", "стартов")}
              {searching ? ` · ${listCities} ${plural(listCities, "населённый пункт", "населённых пункта", "населённых пунктов")}` : ""}
            </>
          ) : null}
        </p>
      </section>
      </div>

      {/* Плашка всегда на одном месте (16.10.2026): раньше при пустом промежуточном результате поиска
          она переезжала внутрь сообщения «ничего не нашлось» и монтировалась заново — мигала. */}
      {races.length ? (
        <div className={styles.suggestBar}>
          <SuggestRace />
        </div>
      ) : null}

      <div ref={listTop} className={styles.months}>
        {failed ? (
          <div className={styles.state}>Не получилось загрузить календарь. Обновите страницу через минуту.</div>
        ) : !races.length ? (
          <div className={styles.state}>Календарь пока пуст. Данные появятся после ближайшего обновления.</div>
        ) : !list.length ? (
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
          months.map((m, i) => {
            const isOpen = open[m.key] ?? (searching ? i < 2 : i === 0);
            return (
              <details
                key={m.key}
                className={styles.month}
                open={isOpen}
                onToggle={(e) => {
                  const now = (e.currentTarget as HTMLDetailsElement).open;
                  if (now !== isOpen) setOpen((o) => ({ ...o, [m.key]: now }));
                }}
              >
                <summary className={styles.summary}>
                  <span className={styles.mName}>
                    {m.name} {m.year}
                  </span>
                  <span className={styles.mCount}>
                    <b>{m.races.length}</b> {plural(m.races.length, "старт", "старта", "стартов")}
                  </span>
                  <span className={styles.caret} aria-hidden="true" />
                </summary>
                {/* Закрытый месяц стартов не рисует (16.10.2026): на «Все» это 474 блока в DOM,
                    прокрутка на iPhone дёргалась. */}
                {isOpen ? (
                  <ol className={styles.races}>
                    {m.races.map((r) => (
                      <RaceItem key={r.id} r={r} follow={followUi(r)} onAct={onRaceAct} onDetails={inTg ? onDetails : undefined} />
                    ))}
                  </ol>
                ) : null}
              </details>
            );
          })
        )}
      </div>

      {area.items.length ? (
        <section className={styles.expected} aria-label="Рядом в области">
          <h2 className={styles.expectedTitle}>Рядом в области</h2>
          <p className={styles.expectedLede}>
            {area.subject ? `${area.subject} и` : "В"} радиусе {NEARBY_KM} км от города {bannerCity}: {area.items.length}{" "}
            {plural(area.items.length, "старт", "старта", "стартов")}, ближайшие первыми.
          </p>
          <ol className={styles.races}>
            {area.items.slice(0, areaShown).map(({ race, km }) => (
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
          {area.items.length > areaShown ? (
            <button type="button" className={styles.btn} onClick={() => setAreaShown((n) => n + 8)}>
              Показать ещё {Math.min(8, area.items.length - areaShown)}
            </button>
          ) : null}
        </section>
      ) : null}

      {expectedCount ? (
        <section className={styles.expected} aria-label="Ожидаемые старты">
          <h2 className={styles.expectedTitle}>Ожидаются, дата 2027 пока не объявлена</h2>
          <p className={styles.expectedLede}>
            Прошли в прошлом сезоне, а даты следующего проведения ещё нет. {expectedCount}{" "}
            {plural(expectedCount, "старт", "старта", "стартов")}, по месяцу прошлого проведения.
          </p>
          {expectedByMonth.map(([m, xs]) => (
            <details key={m} className={styles.month}>
              <summary className={styles.summary}>
                <span className={styles.mName}>{MONTHS[m - 1]}</span>
                <span className={styles.mCount}>
                  <b>{xs.length}</b> ожидается
                </span>
                <span className={styles.caret} aria-hidden="true" />
              </summary>
              <ol className={styles.races}>
                {xs.map((e) => (
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
                        <a className={`${styles.btn} ${styles.quiet}`} href={e.lastUrl} target="_blank" rel="noopener noreferrer">
                          Прошлый старт
                        </a>
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
            </details>
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
