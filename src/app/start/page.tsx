import type { Metadata } from "next";
import { Onest, JetBrains_Mono } from "next/font/google";
import Image from "next/image";
import fs from "fs";
import path from "path";
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
  const hasAvatar = fs.existsSync(
    path.join(process.cwd(), "public/start/avatar.jpg")
  );

  return (
    <div className={`start-root ${onest.variable} ${jetbrains.variable}`}>
      <main>
        <div className="wrap">
          <div className="prof">
            <div className="ava">
              {hasAvatar ? (
                <Image
                  src="/start/avatar.jpg"
                  alt="Игорь Поцелуев"
                  width={104}
                  height={104}
                  priority
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                    objectPosition: "50% 22%",
                  }}
                />
              ) : (
                <span>[ фото сюда ]</span>
              )}
            </div>
            <h1>Игорь Поцелуев</h1>
            <div className="role">Тренер по бегу · онлайн</div>
            <div className="facts">
              <span>
                <b>11 лет</b> практики
              </span>
              <span>
                <b>500+</b> финишей учеников
              </span>
            </div>
          </div>

          <div className="links">
            <a className="card primary" href="/intensive">
              <span className="badge">Идёт набор</span>
              <span className="ic int">&#9889;</span>
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
              <span className="ic club">&#127939;</span>
              <span className="txt">
                <span className="t">Беговой клуб</span>{" "}
                <span className="s">
                  Личный план и тренер рядом каждый день
                </span>
              </span>
              <span className="ar">&rsaquo;</span>
            </a>

            <a className="card" href={TG_LINK}>
              <span className="ic tg">&#9993;</span>
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
