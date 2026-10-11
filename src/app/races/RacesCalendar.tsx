"use client";

import { useEffect, useMemo, useState } from "react";

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

function RaceItem({ r }: { r: Race }) {
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
        <div className={styles.title}>{r.name}</div>
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
      </div>
    </li>
  );
}

export default function RacesCalendar({ races, failed }: { races: Race[]; failed: boolean }) {
  const [f, setF] = useState<Filters>(NO_FILTERS);
  const [query, setQuery] = useState("");
  /* Месяцы, которые человек раскрыл или свернул сам. Пока он ничего не
     трогал, открыт ближайший месяц (при поиске два первых). */
  const [open, setOpen] = useState<Record<string, boolean>>({});

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

  // Фильтры в адрес: ссылкой «трейлы в Казани» можно поделиться.
  useEffect(() => {
    const next = `${window.location.pathname}${filtersToSearch(f)}`;
    if (next !== `${window.location.pathname}${window.location.search}`) {
      window.history.replaceState(null, "", next);
    }
    setOpen({});
  }, [f]);

  const list = useMemo(() => applyFilters(races, f), [races, f]);
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

  function reset() {
    setQuery("");
    setF(NO_FILTERS);
  }

  return (
    <div className={styles.wrap}>
      <header className={styles.top}>
        <h1 className={styles.h1}>Старты России</h1>
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
                    <RaceItem key={r.id} r={r} />
                  ))}
                </ol>
              </details>
            );
          })
        )}
      </div>
    </div>
  );
}
