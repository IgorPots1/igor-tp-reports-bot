import type { Metadata } from "next";
import type { CSSProperties, ReactNode } from "react";
import { Onest, JetBrains_Mono } from "next/font/google";

// Единственное место, где задан адрес для писем про данные. Тот же адрес идёт
// в заявку на OAuth-приложение Intervals.icu — менять здесь, а не по тексту.
const CONTACT_EMAIL = "potseluevigoralexeevich@gmail.com";

// Дата правится руками при каждом изменении текста. Автоподстановка new Date()
// врала бы: «обновлено» менялось бы от пересборки, а не от правки политики.
const UPDATED_AT = "26 августа 2026";

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
  title: "Политика конфиденциальности — Игорь Поцелуев · Беговой клуб",
  description:
    "Какие данные получает igorp.run, зачем они нужны, где хранятся и как их удалить.",
};

// Стили заинлайнены намеренно: страницу открывают внешние проверяющие
// (Intervals.icu), и она обязана выглядеть одинаково независимо от того, что
// происходит в globals.css и landing.css. Ни одного внешнего класса.
const BG = "#F6F4EF";
const SURFACE = "#FFFFFF";
const INK = "#16150F";
const INK_2 = "#4D483F";
const MUTED = "#857F73";
const LINE = "#E7E1D5";
const ACCENT = "#E5480E";
const GREEN = "#2E7D45";
const GREEN_BG = "#EAF3EC";

const SANS = "var(--font-onest), 'Onest', system-ui, sans-serif";
const MONO = "var(--font-jetbrains), 'JetBrains Mono', ui-monospace, monospace";

const rootStyle: CSSProperties = {
  minHeight: "100vh",
  background: BG,
  color: INK,
  fontFamily: SANS,
  fontSize: "17px",
  lineHeight: 1.6,
  WebkitFontSmoothing: "antialiased",
};

const mainStyle: CSSProperties = {
  maxWidth: "760px",
  margin: "0 auto",
  padding: "56px 22px 72px",
};

const eyebrowStyle: CSSProperties = {
  display: "block",
  fontFamily: MONO,
  fontSize: "12px",
  fontWeight: 500,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: ACCENT,
};

const h1Style: CSSProperties = {
  margin: "14px 0 0",
  fontSize: "clamp(30px, 5vw, 44px)",
  fontWeight: 700,
  letterSpacing: "-0.02em",
  lineHeight: 1.06,
};

const leadStyle: CSSProperties = {
  margin: "18px 0 0",
  fontSize: "clamp(16px, 1.6vw, 19px)",
  color: INK_2,
};

const metaStyle: CSSProperties = {
  margin: "22px 0 0",
  paddingTop: "18px",
  borderTop: `1px solid ${LINE}`,
  fontFamily: MONO,
  fontSize: "12.5px",
  color: MUTED,
  letterSpacing: "0.02em",
};

const sectionStyle: CSSProperties = {
  background: SURFACE,
  border: `1px solid ${LINE}`,
  borderRadius: "14px",
  padding: "24px 22px",
  marginTop: "14px",
};

const sectionNumberStyle: CSSProperties = {
  fontFamily: MONO,
  fontSize: "12px",
  fontWeight: 500,
  letterSpacing: "0.14em",
  color: ACCENT,
};

const h2Style: CSSProperties = {
  margin: "8px 0 0",
  fontSize: "clamp(19px, 2.2vw, 23px)",
  fontWeight: 700,
  letterSpacing: "-0.015em",
  lineHeight: 1.2,
};

const bodyStyle: CSSProperties = {
  margin: "12px 0 0",
  color: INK_2,
};

const listStyle: CSSProperties = {
  margin: "12px 0 0",
  paddingLeft: "20px",
  display: "grid",
  gap: "8px",
  color: INK_2,
};

const linkStyle: CSSProperties = {
  color: ACCENT,
  textDecoration: "none",
  fontWeight: 600,
};

const contactStyle: CSSProperties = {
  ...sectionStyle,
  background: GREEN_BG,
  border: `1px solid ${GREEN}`,
  marginTop: "26px",
};

const englishStyle: CSSProperties = {
  ...sectionStyle,
  background: "transparent",
  borderStyle: "dashed",
  marginTop: "26px",
};

const footerStyle: CSSProperties = {
  margin: "34px 0 0",
  paddingTop: "20px",
  borderTop: `1px solid ${LINE}`,
  fontSize: "14px",
  color: MUTED,
};

type SectionProps = {
  number: string;
  title: string;
  children: ReactNode;
};

function Section({ number, title, children }: SectionProps) {
  return (
    <section style={sectionStyle}>
      <span style={sectionNumberStyle}>{number}</span>
      <h2 style={h2Style}>{title}</h2>
      {children}
    </section>
  );
}

export default function PrivacyPage() {
  const mailto = `mailto:${CONTACT_EMAIL}`;

  return (
    <div style={rootStyle} className={`${onest.variable} ${jetbrains.variable}`}>
      <main style={mainStyle}>
        <span style={eyebrowStyle}>igorp.run · защита данных</span>
        <h1 style={h1Style}>Политика конфиденциальности</h1>
        <p style={leadStyle}>
          Здесь написано, какие данные о ваших тренировках получает этот проект,
          зачем они нужны, где лежат и как их удалить. Коротко и без юридического
          тумана: данные нужны только для тренерской работы с вами.
        </p>
        <p style={metaStyle}>Обновлено: {UPDATED_AT}</p>

        <Section number="01" title="Кто обрабатывает данные">
          <p style={bodyStyle}>
            Игорь Поцелуев, тренер по бегу, и его беговой клуб. Сайт и сервисы
            проекта работают на домене igorp.run. Обработкой занимается сам
            тренер, отдельной компании за проектом нет. Связь по любым вопросам о
            данных — на почту{" "}
            <a style={linkStyle} href={mailto}>
              {CONTACT_EMAIL}
            </a>
            .
          </p>
        </Section>

        <Section number="02" title="Что приходит из Intervals.icu">
          <p style={bodyStyle}>
            Данные из Intervals.icu приходят только после того, как вы сами
            подтвердили доступ на странице Intervals.icu. Без вашего нажатия
            проект не видит ничего. Мы запрашиваем:
          </p>
          <ul style={listStyle}>
            <li>
              профиль спортсмена: идентификатор в Intervals.icu, имя, часовой
              пояс, единицы измерения;
            </li>
            <li>
              тренировки: дата, вид спорта, длительность, дистанция, темп и
              скорость, пульс, мощность, каденс, набор высоты, название и
              описание занятия, а также посекундные потоки этих показателей;
            </li>
            <li>
              расчётные показатели тренировки: зоны, пороги, нагрузка, динамика
              формы;
            </li>
            <li>
              запланированные тренировки и события календаря, если они у вас
              заведены;
            </li>
            <li>
              записи самочувствия — вес, сон, пульс покоя, вариабельность
              ритма, — если вы их ведёте и если доступ к ним разрешён;
            </li>
            <li>
              технические токены доступа, которые Intervals.icu выдаёт вместо
              вашего пароля. Пароль от Intervals.icu проекту не передаётся и
              никогда не запрашивается.
            </li>
          </ul>
        </Section>

        <Section number="03" title="Зачем эти данные">
          <p style={bodyStyle}>
            Ровно для одного: чтобы тренер видел вашу реальную тренировку и мог
            её разобрать. На этих данных строятся недельные отчёты, разбор
            выполненных занятий, расчёт темпов и зон, план на следующую неделю и
            подготовка к забегу. Тексты разборов готовятся автоматическими
            инструментами, включая языковые модели, — по условиям их поставщиков
            переданные данные не используются для обучения моделей.
          </p>
          <p style={bodyStyle}>
            Никакой рекламы, никакого профилирования для рекламы, никакой
            продажи данных. Мы не публикуем ваши тренировки и не показываем их
            другим ученикам без вашего согласия.
          </p>
        </Section>

        <Section number="04" title="Кому данные не передаются">
          <p style={bodyStyle}>
            Третьим лицам данные не передаются и не продаются. Есть только
            технические поставщики, без которых сервис не работает: хостинг
            сайта (Vercel), база данных (Supabase), доставка сообщений и отчётов
            вам лично (Telegram) и поставщик языковой модели для подготовки
            текста разбора. Каждый из них видит данные только в объёме, нужном
            для своей задачи.
          </p>
        </Section>

        <Section number="05" title="Где и сколько хранится">
          <p style={bodyStyle}>
            Данные тренировок лежат в базе проекта, доступ к ней есть у тренера.
            Токены доступа хранятся отдельно, в серверных переменных и служебных
            записях, в интерфейсе они не показываются и никому не выдаются.
            Данные хранятся, пока вы занимаетесь с тренером, и удаляются по
            вашему запросу.
          </p>
        </Section>

        <Section number="06" title="Как отозвать доступ и удалить данные">
          <p style={bodyStyle}>
            Отозвать доступ можно в любой момент и без объяснений — в настройках
            своего аккаунта Intervals.icu, в разделе авторизованных приложений.
            После отзыва проект больше не получает новые тренировки.
          </p>
          <p style={bodyStyle}>
            Чтобы удалить уже полученные данные, напишите на{" "}
            <a style={linkStyle} href={mailto}>
              {CONTACT_EMAIL}
            </a>{" "}
            — удалим в течение 30 дней и подтвердим ответным письмом. По той же
            почте можно спросить, какие данные о вас есть, и получить их копию.
          </p>
        </Section>

        <Section number="07" title="Cookie и аналитика">
          <p style={bodyStyle}>
            На публичных страницах проекта нет рекламных трекеров и внешних
            систем аналитики. Служебные cookie используются только там, где нужен
            вход в закрытые разделы, и только для того, чтобы удержать сессию.
          </p>
        </Section>

        <Section number="08" title="Изменения">
          <p style={bodyStyle}>
            Если политика изменится, изменится и дата вверху страницы. Про
            изменения, которые расширяют состав собираемых данных, ученикам
            сообщается лично.
          </p>
        </Section>

        <section style={contactStyle}>
          <span style={{ ...sectionNumberStyle, color: GREEN }}>контакт</span>
          <h2 style={h2Style}>Вопросы по данным</h2>
          <p style={{ ...bodyStyle, color: INK }}>
            Пишите на{" "}
            <a style={{ ...linkStyle, color: GREEN }} href={mailto}>
              {CONTACT_EMAIL}
            </a>
            . Отвечает лично тренер — это же адрес для запросов на удаление
            данных и на выгрузку копии.
          </p>
        </section>

        <section style={englishStyle} lang="en">
          <span style={sectionNumberStyle}>english summary</span>
          <h2 style={h2Style}>Privacy summary</h2>
          <p style={bodyStyle}>
            igorp.run is the coaching service of Igor Potseluev, a running coach.
            With your explicit consent given on the Intervals.icu authorization
            screen, it reads your Intervals.icu athlete profile, activities
            (including their data streams), planned workouts and wellness records
            in order to produce your training reports and plans. Your
            Intervals.icu password is never requested or stored; only OAuth
            tokens are.
          </p>
          <p style={bodyStyle}>
            The data is never sold or shared with third parties beyond the
            technical providers required to run the service (Vercel, Supabase,
            Telegram, and a language-model provider that does not train on the
            data). You can revoke access at any time in your Intervals.icu
            settings, and request deletion of the stored data by writing to{" "}
            <a style={linkStyle} href={mailto}>
              {CONTACT_EMAIL}
            </a>
            ; deletion is completed within 30 days.
          </p>
        </section>

        <p style={footerStyle}>
          <a style={linkStyle} href="/landing">
            ← На сайт бегового клуба
          </a>
        </p>
      </main>
    </div>
  );
}
