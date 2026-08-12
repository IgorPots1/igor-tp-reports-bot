import type { Metadata } from "next";
import { Onest, JetBrains_Mono } from "next/font/google";
import { FLOW, seatsWord } from "@/lib/flow";
import "./start.css";

const onest = Onest({
  subsets: ["latin", "cyrillic"],
  variable: "--font-onest",
  display: "swap",
});
const jetbrains = JetBrains_Mono({
  subsets: ["latin", "cyrillic"],
  variable: "--font-jetbrains",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Игорь Поцелуев · Тренер по бегу",
  description:
    "Беговой интенсив, беговой клуб и личная связь с тренером — все ссылки в одном месте.",
};

const TG_LINK =
  "https://t.me/IgorPotseluev?text=%D0%97%D0%B4%D1%80%D0%B0%D0%B2%D1%81%D1%82%D0%B2%D1%83%D0%B9%D1%82%D0%B5%21%20%D0%A5%D0%BE%D1%87%D1%83%20%D0%B7%D0%B0%D0%BF%D0%B8%D1%81%D0%B0%D1%82%D1%8C%D1%81%D1%8F%20%D0%BD%D0%B0%20%D0%B1%D0%B5%D0%B3%D0%BE%D0%B2%D0%BE%D0%B9%20%D0%B8%D0%BD%D1%82%D0%B5%D0%BD%D1%81%D0%B8%D0%B2";

export default function StartPage() {
  return (
    <div className={`start-root ${onest.variable} ${jetbrains.variable}`}>
      <main>
        <div className="wrap">
          <div className="prof">
            <h1>Игорь Поцелуев</h1>
            <div className="role">Тренер по бегу · онлайн</div>
            <div className="facts">
              <span>
                <b>11 лет</b> тренерства
              </span>
              <span>
                <b>300+</b> учеников
              </span>
            </div>
          </div>

          <div className="links">
            <a className="card primary" href="/intensive">
              <span className="badge">Идёт набор</span>
              <span className="ic int">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M13 2 4.5 13.5H11l-1 8.5 8.5-11.5H12l1-8.5Z" />
                </svg>
              </span>
              <span className="txt">
                <span className="t">Беговой интенсив</span>{" "}
                <span className="s">
                  10 дней, которые изменят твои тренировки
                </span>
                <span className="meta">
                  &#128337; Старт {FLOW.startDate} · осталось{" "}
                  {FLOW.seatsLeft} {seatsWord(FLOW.seatsLeft)}
                </span>
              </span>
              <span className="ar">&rsaquo;</span>
            </a>

            <a className="card" href="/landing">
              <span className="ic club">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <circle cx="15.5" cy="4.2" r="2" />
                  <path d="M12.3 21.5 14 16l-3.2-2.6.9-5.2 3.1 3.4 3.4.9" />
                  <path d="M10.6 8.2 7.2 9.6l-1.4 3.1" />
                  <path d="M14 16l-3.6.6-2.9 4.4" />
                </svg>
              </span>
              <span className="txt">
                <span className="t">Беговой клуб</span>{" "}
                <span className="s">
                  Личный план и тренер рядом каждый день
                </span>
              </span>
              <span className="ar">&rsaquo;</span>
            </a>

            <a className="card" href={TG_LINK}>
              <span className="ic tg">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M21.5 3.5 2.8 10.4c-.8.3-.8 1.4 0 1.7l4.6 1.6 1.7 5c.3.8 1.3.9 1.8.2l2.4-3.2 4.7 3.5c.7.5 1.7.1 1.9-.7l3-13.5c.2-.9-.6-1.6-1.4-1.5Z" />
                  <path d="M21.5 3.5 9.4 13.7" />
                </svg>
              </span>
              <span className="txt">
                <span className="t">Написать мне</span>{" "}
                <span className="s">Отвечу лично, помогу выбрать формат</span>
              </span>
              <span className="ar">&rsaquo;</span>
            </a>
          </div>
        </div>
      </main>

      <footer>© 2026 · Игорь Поцелуев</footer>
    </div>
  );
}
