"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { citySlug, inCity, raceCode } from "@/features/races-bot/core";

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
  plural,
  type Filters,
  type Race,
} from "./races-logic";
import SuggestRace from "./SuggestRace";
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

function RaceItem({ r, follow }: { r: Race; follow: FollowUi }) {
  const stub = dateStub(r);
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
          <div className={styles.title}>{r.name}</div>
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
          <b>{r.city || "место уточняется"}</b>
          {where ? `, ${r.region}` : null}
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
        {r.altDates.length ? (
          <p className={styles.note}>
            Другой календарь указывает {r.altDates.map(dayMonth).join(", ")}. Возможно, это другой день
            программы. Уточните дату на сайте организатора.
          </p>
        ) : null}
        {r.linkBad ? <p className={styles.note}>Сайт может не работать.</p> : null}
        {r.checked ? <p className={`${styles.note} ${styles.checked}`}>{r.checked}</p> : null}
        <div className={styles.links}>
          {r.reg ? (
            <a className={`${styles.btn} ${styles.primary}`} href={r.reg} target="_blank" rel="noopener noreferrer">
              Регистрация
            </a>
          ) : null}
          {r.site ? (
            <a className={styles.btn} href={r.site} target="_blank" rel="noopener noreferrer">
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
}: {
  races: Race[];
  failed: boolean;
  botUsername: string | null;
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

  const miniapp = useCallback(
    async (action: "list" | "follow" | "unfollow", raceId?: string) => {
      if (!initData) return;
      const res = await fetch("/api/races-bot/miniapp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ initData, action, raceId }),
      });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; follows?: string[] } | null;
      if (body?.ok && body.follows) setSaved(new Set(body.follows));
    },
    [initData],
  );

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

  // Поиск с задержкой, чтобы список не перерисовывался на каждую букву.
  useEffect(() => {
    const t = window.setTimeout(() => {
      setF((prev) => (prev.q === query ? prev : { ...prev, q: query }));
    }, 120);
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

  const list = useMemo(() => {
    const base = applyFilters(races, f);
    return onlyMine ? base.filter((r) => saved.has(r.id)) : base;
  }, [races, f, onlyMine, saved]);
  const months = useMemo(() => groupByMonth(list), [list]);
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
  const dirty = f.q !== "" || f.type !== "all" || f.dist !== "all";
  const inTg = initData !== null;
  // Плашка подписки — когда в поиске ровно город из календаря.
  const bannerCity = useMemo(() => {
    const q = f.q.trim().toLowerCase().replace(/ё/g, "е");
    return q ? cities.find((c) => c.toLowerCase().replace(/ё/g, "е") === q) ?? null : null;
  }, [f.q, cities]);
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
        {dirty || query !== "" ? (
          <button type="button" className={styles.reset} onClick={reset}>
            Сбросить
          </button>
        ) : null}
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
              onClick={() => setF((p) => ({ ...p, type: v }))}
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
              onClick={() => setF((p) => ({ ...p, dist: v }))}
            >
              {label}
              <span className={styles.n}>{distBase.filter((r) => distMatch(r, v)).length}</span>
            </button>
          ))}
        </div>
        <p className={styles.resultLine} aria-live="polite">
          {list.length ? (
            <>
              <b>{list.length}</b> {plural(list.length, "старт", "старта", "стартов")}
              {searching ? ` · ${listCities} ${plural(listCities, "населённый пункт", "населённых пункта", "населённых пунктов")}` : ""}
            </>
          ) : null}
        </p>
      </section>

      {/* Над списком, а в пустом результате поиска такая же форма стоит внутри сообщения. */}
      {races.length && list.length ? (
        <div className={styles.suggestBar}>
          <SuggestRace />
        </div>
      ) : null}

      <div className={styles.months}>
        {failed ? (
          <div className={styles.state}>Не получилось загрузить календарь. Обновите страницу через минуту.</div>
        ) : !races.length ? (
          <div className={styles.state}>Календарь пока пуст. Данные появятся после ближайшего обновления.</div>
        ) : !list.length ? (
          <div className={styles.state}>
            <p>
              Ничего не нашлось{f.q ? ` по запросу «${f.q}»` : ""}. Попробуйте область вместо города или
              снимите фильтр дистанции.
            </p>
            <button type="button" className={`${styles.btn} ${styles.primary}`} onClick={reset}>
              Сбросить фильтры
            </button>
            <SuggestRace prefillCity={f.q.trim()} />
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
                <ol className={styles.races}>
                  {m.races.map((r) => (
                    <RaceItem key={r.id} r={r} follow={followUi(r)} />
                  ))}
                </ol>
              </details>
            );
          })
        )}
      </div>

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
