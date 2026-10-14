"use client";

/* eslint-disable @next/next/no-img-element -- фото приходят подписанными
   ссылками Supabase Storage, next/image тут только мешает. */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { WishItem, WishRole, WishView } from "@/features/gift-wishlist/repository";

import styles from "./wish.module.css";

const WANT: Record<number, string> = { 3: "Очень хочу", 2: "Хочу", 1: "Было бы мило" };
const POLL_MS = 30_000;
const SEEN_KEY = "wish_seen_pick_at";

function plural(n: number, a: string, b: string, c: string) {
  const m = n % 10;
  const t = n % 100;
  if (m === 1 && t !== 11) return a;
  if (m >= 2 && m <= 4 && (t < 10 || t >= 20)) return b;
  return c;
}

function host(u: string) {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return "ссылка";
  }
}

function readSeen(): string {
  try {
    return localStorage.getItem(SEEN_KEY) ?? "";
  } catch {
    return "";
  }
}
function writeSeen(v: string) {
  try {
    localStorage.setItem(SEEN_KEY, v);
  } catch {
    /* приватный режим: уведомление просто покажется ещё раз */
  }
}

async function shrinkToDataUrl(file: File): Promise<string> {
  const bmp = await createImageBitmap(file);
  const max = 1400;
  const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * s);
  c.height = Math.round(bmp.height * s);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.85);
}

type Toast = { icon: string; text: string } | null;

export default function WishList({ token, role, title }: { token: string; role: WishRole; title: string }) {
  const [view, setView] = useState<WishView | null>(null);
  const [failed, setFailed] = useState(false);
  const [toast, setToast] = useState<Toast>(null);
  const [editing, setEditing] = useState<WishItem | "new" | null>(null);
  const [filter, setFilter] = useState<"all" | "free" | "mine">("all");
  const [busyId, setBusyId] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((icon: string, text: string, ms = 5000) => {
    setToast({ icon, text });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), ms);
  }, []);

  const api = `/api/wish/${token}`;

  const applyView = useCallback(
    (v: WishView) => {
      setView(v);
      setFailed(false);
      // Сюрприз для неё: он что-то выбрал с её прошлого визита.
      if (v.role === "her" && v.picks?.lastPickAt && v.picks.count > 0) {
        const seen = readSeen();
        if (v.picks.lastPickAt > seen) {
          if (seen) showToast("🎁", "Игорь только что выбрал подарок из твоего списка! Какой, не скажем 🤫", 9000);
          else showToast("🎁", `Игорь уже присмотрел ${v.picks.count} ${plural(v.picks.count, "подарок", "подарка", "подарков")} 🤫`, 9000);
          writeSeen(v.picks.lastPickAt);
        }
      }
    },
    [showToast],
  );

  const load = useCallback(async () => {
    try {
      const r = await fetch(api, { cache: "no-store" });
      const j = await r.json();
      if (j.ok) applyView(j.view);
      else setFailed(true);
    } catch {
      setFailed(true);
    }
  }, [api, applyView]);

  useEffect(() => {
    load();
    const t = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, POLL_MS);
    const onVis = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [load]);

  const post = useCallback(
    async (payload: Record<string, unknown>) => {
      const r = await fetch(api, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const j = await r.json().catch(() => ({ ok: false, error: "Не сохранилось, попробуй ещё раз" }));
      if (!j.ok) throw new Error(j.error || "Не сохранилось, попробуй ещё раз");
      applyView(j.view);
    },
    [api, applyView],
  );

  const claimed = useMemo(() => new Set(view?.claimedIds ?? []), [view]);

  const toggleClaim = async (it: WishItem) => {
    if (busyId) return;
    const next = !claimed.has(it.id);
    setBusyId(it.id);
    try {
      await post({ op: "claim", itemId: it.id, claimed: next });
      showToast(next ? "🎁" : "↩️", next ? "Готово. Она увидит, что ты что-то выбрал, но не что" : "Снял выбор");
    } catch (e) {
      showToast("⚠️", (e as Error).message);
    }
    setBusyId(null);
  };

  const remove = async (it: WishItem) => {
    setBusyId(it.id);
    try {
      await post({ op: "delete", itemId: it.id });
      showToast("🗑", "Удалено");
    } catch (e) {
      showToast("⚠️", (e as Error).message);
    }
    setBusyId(null);
  };

  const items = useMemo(() => {
    const list = [...(view?.items ?? [])].sort(
      (a, b) => b.want - a.want || (b.createdAt > a.createdAt ? 1 : b.createdAt < a.createdAt ? -1 : 0),
    );
    if (role !== "him") return list;
    if (filter === "free") return list.filter((i) => !claimed.has(i.id));
    if (filter === "mine") return list.filter((i) => claimed.has(i.id));
    return list;
  }, [view, role, filter, claimed]);

  const total = view?.items.length ?? 0;
  const myCount = (view?.items ?? []).filter((i) => claimed.has(i.id)).length;

  return (
    <div className={styles.wrap}>
      <header className={styles.header}>
        <h1 className={styles.h1}>
          {title}
          <small>
            {!view
              ? failed
                ? "Не загрузилось, проверь интернет"
                : "Загружаю список…"
              : role === "him"
                ? total
                  ? `${total} ${plural(total, "хотелка", "хотелки", "хотелок")} · ты выбрал ${myCount}`
                  : "Пока пусто"
                : total
                  ? `${total} ${plural(total, "хотелка", "хотелки", "хотелок")}`
                  : "Список ждёт первую хотелку"}
          </small>
        </h1>
        {role === "her" && view && (
          <button className={styles.primary} onClick={() => setEditing("new")}>
            + Хотелка
          </button>
        )}
      </header>

      {role === "him" && (
        <>
          <div className={`${styles.notice} ${styles.secret}`}>
            <span>🤫</span>
            <div>
              <b>Тайный режим.</b> Эту ссылку не отправляй ей. Когда жмёшь «Беру», она увидит, что ты что-то выбрал, но не
              узнает что именно.
            </div>
          </div>
          <div className={styles.bar}>
            {(
              [
                ["all", "Все"],
                ["free", "Ещё не выбрано"],
                ["mine", "Мой выбор"],
              ] as const
            ).map(([k, l]) => (
              <button key={k} className={styles.chip} aria-pressed={filter === k} onClick={() => setFilter(k)}>
                {l}
              </button>
            ))}
          </div>
        </>
      )}

      {role === "her" && view?.picks && view.picks.count > 0 && (
        <div className={`${styles.notice} ${styles.info}`}>
          <span>🎁</span>
          <div>
            <b>
              Игорь уже присмотрел {view.picks.count} {plural(view.picks.count, "подарок", "подарка", "подарков")}.
            </b>{" "}
            Какие именно, секрет.
          </div>
        </div>
      )}

      {view && items.length === 0 && (
        <div className={styles.empty}>
          <h2>{total ? "Здесь ничего" : role === "her" ? "Что тебе подарить?" : "Список пока пуст"}</h2>
          <p>
            {total
              ? "Попробуй другой фильтр."
              : role === "her"
                ? "Нажми «+ Хотелка»: название, ссылка на магазин, фото, цена и пара слов про цвет или размер."
                : "Как только она добавит первую хотелку, она появится здесь."}
          </p>
          {!total && role === "her" && (
            <button className={styles.primary} onClick={() => setEditing("new")}>
              + Добавить первую
            </button>
          )}
        </div>
      )}

      <div className={styles.grid}>
        {items.map((it) => (
          <Card
            key={it.id}
            it={it}
            role={role}
            mine={role === "him" && claimed.has(it.id)}
            busy={busyId === it.id}
            onClaim={() => toggleClaim(it)}
            onEdit={() => setEditing(it)}
            onDelete={() => remove(it)}
          />
        ))}
      </div>

      {editing && (
        <Sheet
          item={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSave={async (item) => {
            await post({ op: "save", item });
            setEditing(null);
            showToast("💝", editing === "new" ? "Хотелка добавлена" : "Сохранено");
          }}
        />
      )}

      {toast && (
        <div className={styles.toast} role="status">
          <span className={styles.toastIcon}>{toast.icon}</span>
          <span>{toast.text}</span>
        </div>
      )}
    </div>
  );
}

function Card({
  it,
  role,
  mine,
  busy,
  onClaim,
  onEdit,
  onDelete,
}: {
  it: WishItem;
  role: WishRole;
  mine: boolean;
  busy: boolean;
  onClaim: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [armed, setArmed] = useState(false);
  const [imgOk, setImgOk] = useState(true);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);
  const initial = (it.title || "?").trim().charAt(0).toUpperCase();

  return (
    <article className={`${styles.card} ${mine ? styles.mine : ""}`}>
      {mine && <span className={styles.flag}>Твой выбор</span>}
      <div className={styles.ph}>
        {it.photoUrl && imgOk ? (
          <img src={it.photoUrl} alt={it.title} loading="lazy" onError={() => setImgOk(false)} />
        ) : (
          <span className={styles.mono}>{initial}</span>
        )}
      </div>
      <div className={styles.body}>
        <span className={styles.want}>{WANT[it.want] ?? WANT[2]}</span>
        <div className={styles.top}>
          <h3 className={styles.title}>{it.title}</h3>
          {it.price && <span className={styles.price}>{it.price}</span>}
        </div>
        {it.note && <p className={styles.note}>{it.note}</p>}
        <div className={styles.actions}>
          {it.url && (
            <a className={styles.link} href={it.url} target="_blank" rel="noopener noreferrer">
              {host(it.url)} ↗
            </a>
          )}
          <span className={styles.spacer} />
          {role === "him" ? (
            <button className={mine ? styles.claimed : styles.claim} onClick={onClaim} disabled={busy}>
              {mine ? "✓ Беру · отменить" : "🎁 Беру"}
            </button>
          ) : (
            <>
              <button className={styles.ghost} onClick={onEdit} disabled={busy}>
                Изменить
              </button>
              <button
                className={styles.del}
                disabled={busy}
                onClick={() => (armed ? onDelete() : setArmed(true))}
              >
                {armed ? "Точно удалить?" : "Удалить"}
              </button>
            </>
          )}
        </div>
      </div>
    </article>
  );
}

type SaveInput = {
  id?: string;
  title: string;
  url: string;
  price: string;
  note: string;
  want: number;
  photo?: string | null;
};

function Sheet({
  item,
  onClose,
  onSave,
}: {
  item: WishItem | null;
  onClose: () => void;
  onSave: (item: SaveInput) => Promise<void>;
}) {
  const [title, setTitle] = useState(item?.title ?? "");
  const [url, setUrl] = useState(item?.url ?? "");
  const [price, setPrice] = useState(item?.price ?? "");
  const [note, setNote] = useState(item?.note ?? "");
  const [want, setWant] = useState(item?.want ?? 2);
  const [photo, setPhoto] = useState<string | null | undefined>(undefined);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  const takeFile = useCallback(async (f: File | undefined) => {
    if (!f || !f.type.startsWith("image/")) return;
    try {
      setPhoto(await shrinkToDataUrl(f));
    } catch {
      setErr("Не получилось прочитать фото, попробуй другое");
    }
  }, []);

  useEffect(() => {
    titleRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const onPaste = (e: ClipboardEvent) => {
      const f = Array.from(e.clipboardData?.files ?? []).find((x) => x.type.startsWith("image/"));
      if (f) {
        e.preventDefault();
        takeFile(f);
      }
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("paste", onPaste);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("paste", onPaste);
    };
  }, [onClose, takeFile]);

  const preview = photo === undefined ? item?.photoUrl ?? null : photo;

  return (
    <div className={styles.veil} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <form
        className={styles.sheet}
        onSubmit={async (e) => {
          e.preventDefault();
          setErr("");
          if (!title.trim()) {
            setErr("Напиши хотя бы название");
            return;
          }
          setSaving(true);
          try {
            await onSave({ id: item?.id, title, url, price, note, want, photo });
          } catch (x) {
            setErr((x as Error).message);
            setSaving(false);
          }
        }}
      >
        <h2>{item ? "Изменить хотелку" : "Новая хотелка"}</h2>

        <label htmlFor="w-title">Что это</label>
        <input
          ref={titleRef}
          id="w-title"
          type="text"
          maxLength={160}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Например, серёжки с жемчугом"
        />

        <label htmlFor="w-photo">Фото</label>
        <div
          className={styles.drop}
          role="button"
          tabIndex={0}
          onClick={() => fileRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              fileRef.current?.click();
            }
          }}
        >
          {preview ? <img src={preview} alt="" /> : <span className={styles.dropIcon}>📷</span>}
          <span>
            {preview
              ? "Нажми, чтобы заменить. Можно вставить скриншот из буфера."
              : "Выбери фото или вставь скриншот из буфера"}
          </span>
          {preview && (
            <button
              type="button"
              className={styles.del}
              onClick={(e) => {
                e.stopPropagation();
                setPhoto(null);
              }}
            >
              Убрать
            </button>
          )}
        </div>
        <input
          ref={fileRef}
          id="w-photo"
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => takeFile(e.target.files?.[0])}
        />

        <label htmlFor="w-url">Ссылка на магазин</label>
        <input
          id="w-url"
          type="url"
          inputMode="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://…"
        />

        <label htmlFor="w-price">Цена</label>
        <input id="w-price" type="text" maxLength={60} value={price} onChange={(e) => setPrice(e.target.value)} placeholder="5 000 RSD" />

        <label>Насколько хочется</label>
        <div className={styles.seg}>
          {[3, 2, 1].map((v) => (
            <button key={v} type="button" aria-pressed={want === v} onClick={() => setWant(v)}>
              {WANT[v]}
            </button>
          ))}
        </div>

        <label htmlFor="w-note">Подсказка для Игоря</label>
        <textarea
          id="w-note"
          maxLength={800}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Размер, цвет, где посмотреть вживую…"
        />

        {err && (
          <div className={styles.err} role="alert">
            {err}
          </div>
        )}

        <div className={styles.foot}>
          <button type="button" className={styles.ghost} onClick={onClose}>
            Отмена
          </button>
          <button type="submit" className={styles.primary} disabled={saving}>
            {saving ? "Сохраняю…" : item ? "Сохранить" : "Добавить"}
          </button>
        </div>
      </form>
    </div>
  );
}
