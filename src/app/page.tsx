import type { Metadata } from "next";
import { publicPageMetadata } from "@/lib/site";
import { Calculator, Users, Zap } from "lucide-react";
import SiteHeader from "@/components/SiteHeader";
import "./_hub/hub.css";
import { jetbrains, onest } from "@/lib/fonts";

// КОРЕНЬ САЙТА — страница-хаб (раньше жила по /start). Голый igorp.run отдаёт
// её сам, со своим содержимым и статусом 200: редирект на этом месте означал бы
// лишний прыжок для всего входящего трафика из шапки профиля.
//
// Стили лежат в _hub/: папка с подчёркиванием — приватная для роутера Next, она
// не становится адресом. Обычная папка src/app/hub/ завела бы лишнюю страницу.
// Старые адреса (/start, /landing, /intensive) переброшены в next.config.ts.

export const metadata: Metadata = publicPageMetadata({
  path: "/",
  title: "Игорь Поцелуев · Тренер по бегу",
  description:
    "Беговой интенсив, беговой клуб и бесплатные материалы — все ссылки в одном месте.",
  clubImage: true,
});

export default function StartPage() {
  // Строки «Набор в этот поток закрыт / Старт … · осталось N мест» под
  // интенсивом и карточки «Написать мне» больше нет — тренер убрал (18.10.2026):
  // интенсив стартует в любой день, а связь в Telegram есть на самом /camp.
  return (
    <div className={`start-root ${onest.variable} ${jetbrains.variable}`}>
      <SiteHeader />
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
            <a className="card primary" href="/camp">
              <span className="badge">Идёт набор</span>
              <span className="ic int">
                <Zap size={22} strokeWidth={2} aria-hidden="true" />
              </span>
              <span className="txt">
                <span className="t">Беговой интенсив</span>{" "}
                <span className="s">
                  10 дней, которые изменят твои тренировки
                </span>
              </span>
              <span className="ar">&rsaquo;</span>
            </a>

            <a className="card" href="/club">
              <span className="ic club">
                <Users size={22} strokeWidth={2} aria-hidden="true" />
              </span>
              <span className="txt">
                <span className="t">Беговой клуб</span>{" "}
                <span className="s">
                  Личный план и тренер рядом каждый день
                </span>
              </span>
              <span className="ar">&rsaquo;</span>
            </a>

            <a className="card" href="/tools">
              <span className="ic free">
                <Calculator size={22} strokeWidth={2} aria-hidden="true" />
              </span>
              <span className="txt">
                <span className="t">Бесплатные материалы</span>{" "}
                <span className="s">
                  Калькуляторы темпа, раскладки, питания, одежды и тест
                  готовности к марафону
                </span>
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
