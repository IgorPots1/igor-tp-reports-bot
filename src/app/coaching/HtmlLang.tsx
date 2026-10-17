"use client";
import { useEffect } from "react";

// Root layout renders <html lang="ru"> for the whole site. This page is English,
// so the browser should not offer "Translate from Russian" to international visitors.
export default function HtmlLang({ lang }: { lang: string }) {
  useEffect(() => {
    const prev = document.documentElement.lang;
    document.documentElement.lang = lang;
    return () => {
      document.documentElement.lang = prev;
    };
  }, [lang]);
  return null;
}
