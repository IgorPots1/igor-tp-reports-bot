"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

import { isExcludedPath, isTrackedPath } from "@/features/page-views/paths";

// Свой счётчик просмотров: на открытии страницы и на каждой смене маршрута — маяк в /api/pv.
// Без персональных данных: visitor_id живёт в localStorage, session_id — в sessionStorage,
// оба случайные. Хранилища могут быть недоступны (приватный режим, WebView) — тогда шлём без id.
// UTM берём из адреса прямо в момент отправки (useSearchParams в корневом layout потребовал бы
// Suspense на каждой странице).

const VISITOR_KEY = "pv_vid";
const SESSION_KEY = "pv_sid";
const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content"] as const;

function randomId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }
}

function storedId(storage: () => Storage, key: string): string | null {
  try {
    const s = storage();
    const existing = s.getItem(key);
    if (existing) return existing;
    const id = randomId();
    s.setItem(key, id);
    return id;
  } catch {
    return null;
  }
}

// Модульные, а не useRef: в dev StrictMode эффект зовётся дважды, второй маяк не нужен.
let lastPath: string | null = null;
let lastSentAt = 0;
let previousUrl: string | null = null;

function send(pathname: string) {
  const now = Date.now();
  if (pathname === lastPath && now - lastSentAt < 1000) return;
  lastPath = pathname;
  lastSentAt = now;

  // Первый просмотр — внешний referrer; дальше внутри сайта — предыдущая страница.
  const referrer = previousUrl ?? document.referrer;
  previousUrl = window.location.origin + pathname;

  const params = new URLSearchParams(window.location.search);
  const body: Record<string, string | null> = {
    path: pathname,
    referrer: referrer || null,
    visitor_id: storedId(() => window.localStorage, VISITOR_KEY),
    session_id: storedId(() => window.sessionStorage, SESSION_KEY),
  };
  for (const key of UTM_KEYS) body[key] = params.get(key);

  const json = JSON.stringify(body);
  try {
    if (navigator.sendBeacon?.("/api/pv", new Blob([json], { type: "application/json" }))) return;
  } catch {
    // ниже — запасной путь
  }
  fetch("/api/pv", { method: "POST", body: json, keepalive: true, headers: { "Content-Type": "application/json" } }).catch(
    () => undefined,
  );
}

export default function PageViewTracker() {
  const pathname = usePathname();

  useEffect(() => {
    if (!pathname || isExcludedPath(pathname) || !isTrackedPath(pathname)) return;
    send(pathname);
  }, [pathname]);

  return null;
}
