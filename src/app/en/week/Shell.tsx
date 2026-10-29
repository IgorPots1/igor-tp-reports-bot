import type { ReactNode } from "react";

import HtmlLang from "../../coaching/HtmlLang";
import { jetbrains, onest } from "@/lib/fonts";
import "./en-week.css";

/** Page frame of the free week: fonts, lang="en", scoped styles. */
export function Shell({ children }: { children: ReactNode }) {
  return (
    <div className={`ew-root ${onest.variable} ${jetbrains.variable}`}>
      <HtmlLang lang="en" />
      {children}
    </div>
  );
}

export function Brand() {
  return (
    <div className="who">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="ava" src="/landing/01-hero.jpg" alt="" />
      Igor · running coach
    </div>
  );
}

/** Flag off: neutral page, no form, nothing read from the DB. */
export function ComingSoon() {
  return (
    <Shell>
      <header>
        <div className="wrap">
          <div className="hbar">
            <Brand />
          </div>
        </div>
      </header>
      <main>
        <div className="wrap soon">
          <h1>Coming soon</h1>
          <p className="lede">The free training week is not open yet. Check back in a few days.</p>
        </div>
      </main>
    </Shell>
  );
}
