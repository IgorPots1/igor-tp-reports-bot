"use client";

import { Analytics, type BeforeSendEvent } from "@vercel/analytics/next";

import { isExcludedPath } from "@/features/page-views/paths";

// Обёртка нужна только ради beforeSend: функцию нельзя передать в клиентский компонент
// из серверного корневого layout.
function dropServicePages(event: BeforeSendEvent): BeforeSendEvent | null {
  try {
    return isExcludedPath(new URL(event.url).pathname) ? null : event;
  } catch {
    return event;
  }
}

export default function SiteAnalytics() {
  return <Analytics beforeSend={dropServicePages} />;
}
