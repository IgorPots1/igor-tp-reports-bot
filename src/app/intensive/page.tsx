import type { Metadata } from "next";
import { publicPageMetadata } from "@/lib/site";
import { Onest, JetBrains_Mono } from "next/font/google";
import Image from "next/image";
import fs from "fs";
import path from "path";
import Carousel from "../landing/Carousel";
import { FLOW, SEATS_TOTAL, pastFlows, seatsWord } from "@/lib/flow";
import { getSeatsLeft } from "@/features/intensive/repository";
import "./intensive.css";

// Число мест живое — считается по заявкам на каждый показ страницы.
// Без этого Next отдавал бы статику, и счётчик замерз бы на времени сборки.
export const dynamic = "force-dynamic";

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

export const metadata: Metadata = publicPageMetadata({
  path: "/intensive",
  title:
    "Беговой интенсив Игоря Поцелуева — 10 дней, которые изменят твои тренировки",
  description:
    "Личный план, техника, силовые и разбор каждой тренировки. Первые сдвиги уже на первой неделе.",
});

const TG_LINK =
  "https://t.me/IgorPotseluev?text=%D0%97%D0%B4%D1%80%D0%B0%D0%B2%D1%81%D1%82%D0%B2%D1%83%D0%B9%D1%82%D0%B5%21%20%D0%A5%D0%BE%D1%87%D1%83%20%D0%B7%D0%B0%D0%BF%D0%B8%D1%81%D0%B0%D1%82%D1%8C%D1%81%D1%8F%20%D0%BD%D0%B0%20%D0%B1%D0%B5%D0%B3%D0%BE%D0%B2%D0%BE%D0%B9%20%D0%B8%D0%BD%D1%82%D0%B5%D0%BD%D1%81%D0%B8%D0%B2";

const TgIcon = () => (
  <svg
    className="tg-ic"
    viewBox="0 0 24 24"
    fill="#fff"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path d="M21.94 4.3 18.7 19.6c-.24 1.08-.88 1.35-1.78.84l-4.92-3.63-2.37 2.28c-.26.26-.48.48-.99.48l.35-5 9.1-8.22c.4-.35-.09-.55-.62-.2L6.2 13.1l-4.85-1.52c-1.05-.33-1.07-1.05.22-1.56L20.6 2.8c.88-.33 1.65.2 1.34 1.5Z" />
  </svg>
);

export default async function IntensivePage() {
  const seatsLeft = await getSeatsLeft();
  const seatsClosed = seatsLeft <= 0;
  const hasHeroPhoto = fs.existsSync(
    path.join(process.cwd(), "public/intensive/hero.jpg")
  );

  return (
    <div className={`intensive-root ${onest.variable} ${jetbrains.variable}`}>
      {/* NAV */}
      <nav className="top">
        <div className="wrap">
          <div className="brand">
            <span className="dot"></span>Игорь Поцелуев · Беговой интенсив
          </div>
          <a href={TG_LINK} className="btn">
            Записаться
          </a>
        </div>
      </nav>

      {/* HERO */}
      <section className="hero">
        <div className="wrap hero-grid">
          <div>
            <span className="eyebrow">Беговой интенсив · онлайн</span>
            <h1 style={{ marginTop: "15px" }}>
              10 дней, которые{" "}
              <span className="hl">изменят твои тренировки</span>
            </h1>
            <p className="hero-sub">
              Личный план, техника, силовые и разбор каждой тренировки.
              Первые сдвиги уже на первой неделе.
            </p>

            {/* CONFIG plashka */}
            <div className="flow-band">
              <div className="fb">
                <div className="k">Поток</div>
                <div className="v">{FLOW.number}-й</div>
              </div>
              <div className="fb">
                <div className="k">Старт</div>
                <div className="v">{FLOW.startDate}</div>
              </div>
              <div className="fb">
                <div className="k">{seatsClosed ? "Мест" : "Осталось"}</div>
                <div className="v">
                  <span className="acc">
                    {seatsClosed ? "Набор закрыт" : `${seatsLeft} ${seatsWord(seatsLeft)}`}
                  </span>
                </div>
              </div>
            </div>

            <div className="hero-cta">
              <a href={TG_LINK} className="btn btn--tg btn--lg">
                <TgIcon />
                Записаться в Telegram
              </a>
              <span className="hero-note">Отвечу лично, без ботов</span>
            </div>
            <div className="hero-trust">
              <span>
                <b>{pastFlows}</b> потоков
              </span>
              <span>
                <b>300+</b> участников
              </span>
              <span>
                <b>11 лет</b> практики
              </span>
            </div>
            <div className="after-cta">
              <span className="d">&#8594;</span>
              <span>
                Пишешь, отвечаю лично: рассказываю детали и отвечаю на
                вопросы. Без спама и давления.
              </span>
            </div>
          </div>

          <div className={`hero-photo${hasHeroPhoto ? " has-photo" : ""}`}>
            {hasHeroPhoto ? (
              <Image
                src="/intensive/hero.jpg"
                alt="Игорь Поцелуев"
                width={600}
                height={750}
                priority
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                  objectPosition: "50% 30%",
                }}
              />
            ) : (
              <span>
                [ фото сюда ]
                <br />
                вставим позже
              </span>
            )}
          </div>
        </div>
      </section>

      {/* ЧТО ТЕБЯ ЖДЁТ */}
      <section
        style={{
          background: "var(--surface)",
          borderTop: "1px solid var(--line)",
          borderBottom: "1px solid var(--line)",
        }}
      >
        <div className="wrap">
          <div className="head">
            <span className="eyebrow">Что это</span>
            <h2>Что тебя ждёт на интенсиве</h2>
          </div>
          <div className="grid g2">
            <div className="card whaty">
              <span className="mk">&#10003;</span>
              <p>
                Беговой план под <b>твой уровень и цель</b>
              </p>
            </div>
            <div className="card whaty">
              <span className="mk">&#10003;</span>
              <p>
                Упражнения на технику и силовые, <b>с видео</b>
              </p>
            </div>
            <div className="card whaty">
              <span className="mk">&#10003;</span>
              <p>
                Поддержка и <b>разбор каждой тренировки</b>
              </p>
            </div>
            <div className="card whaty">
              <span className="mk">&#10003;</span>
              <p>Ответы на все вопросы</p>
            </div>
            <div className="card whaty">
              <span className="mk">&#10003;</span>
              <p>
                Поймёшь, как тренироваться{" "}
                <b>осознанно и с результатом</b>
              </p>
            </div>
            <div className="card whaty">
              <span className="mk">&#128204;</span>
              <p>
                Подойдёт даже тем, кто выходил на пробежку{" "}
                <b>всего пару раз</b>
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* РЕЗУЛЬТАТЫ ПОТОКОВ */}
      <section>
        <div className="wrap">
          <div className="head">
            <span className="eyebrow">Результаты потоков</span>
            <h2>Цифры интенсива</h2>
          </div>
          <div className="stats">
            <div className="stat">
              <div className="v">
                <span className="u">{pastFlows}</span>
              </div>
              <div className="k">потоков интенсива уже прошло</div>
            </div>
            <div className="stat">
              <div className="v">
                <span className="u">300+</span>
              </div>
              <div className="k">участников прошли интенсив</div>
            </div>
            <div className="stat">
              <div className="v">
                <span className="u">50+</span>
              </div>
              <div className="k">впервые пробежали 10 км</div>
            </div>
            <div className="stat">
              <div className="v">
                <span className="u">11 лет</span>
              </div>
              <div className="k">тренерской практики</div>
            </div>
          </div>
        </div>
      </section>

      {/* КАК ПРОХОДИТ */}
      <section>
        <div className="wrap">
          <div className="head">
            <span className="eyebrow">Формат</span>
            <h2>Как проходит</h2>
          </div>
          <div className="steps">
            <div className="stp">
              <span className="n">01</span>
              <p>
                <b>10 дней с понятной структурой:</b> каждый день расписан.
              </p>
            </div>
            <div className="stp">
              <span className="n">02</span>
              <p>
                <b>План приходит заранее.</b> Ты всегда знаешь, что делать.
              </p>
            </div>
            <div className="stp">
              <span className="n">03</span>
              <p>
                <b>Отправляешь отчёт, получаешь обратную связь</b> по
                тренировке.
              </p>
            </div>
            <div className="stp">
              <span className="n">04</span>
              <p>
                <b>Общение в чате:</b> поддержка, мотивация, ответы, полезная
                информация.
              </p>
            </div>
            <div className="stp">
              <span className="n">05</span>
              <p>
                Примеры тренировок и обратной связи{" "}
                <b>в карточках ниже.</b>
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ПРИМЕРЫ ТРЕНИРОВОК */}
      <section
        style={{
          background: "var(--surface)",
          borderTop: "1px solid var(--line)",
          borderBottom: "1px solid var(--line)",
        }}
      >
        <div className="wrap">
          <div className="head">
            <span className="eyebrow">Как выглядит план</span>
            <h2>Примеры тренировок интенсива</h2>
            <p>
              Каждая тренировка расписана: структура, темп и задача. Ничего
              не нужно додумывать.
            </p>
          </div>
          <Carousel trackClassName="w-workouts">
            <div className="wcard">
              <div className="wc-h">
                <span className="t">
                  <span className="ic">&#128694;</span> Тестовая пробежка
                </span>
                <span className="m">45 мин</span>
              </div>
              <div className="wc-bar">
                <div className="wc-seg easy" style={{ flex: 1 }}>
                  лёгкая зона 1-2
                </div>
              </div>
              <div className="wc-rows">
                <div className="wc-row">
                  <span className="pc">по ощущениям</span>
                  <span className="tx">
                    <b>45 минут</b> в устойчивом комфортном темпе
                  </span>
                </div>
                <div className="wc-row">
                  <span className="pc">дыхание</span>
                  <span className="tx">
                    ровное, можешь говорить полными фразами
                  </span>
                </div>
              </div>
              <div className="wc-note">
                Цель: определить твою лёгкую беговую зону. Это основа для
                тренировок в зоне 1-2.
              </div>
            </div>

            <div className="wcard">
              <div className="wc-h">
                <span className="t">
                  <span className="ic">&#9201;</span> Интервальная
                </span>
                <span className="m">5 × 5 мин</span>
              </div>
              <div className="wc-bar">
                <div className="wc-seg warm">разм.</div>
                <div className="wc-seg main">
                  <span>5 × 5 мин</span>
                </div>
                <div className="wc-seg cool">зам.</div>
              </div>
              <div className="wc-rows">
                <div className="wc-row">
                  <span className="pc">04:55-05:15</span>
                  <span className="tx">
                    <b>5 × 5 минут</b> в устойчивом темпе (7 из 10 усилия)
                  </span>
                </div>
                <div className="wc-row">
                  <span className="pc">07:00 и ниже</span>
                  <span className="tx">
                    1:30 очень лёгкого бега между отрезками
                  </span>
                </div>
              </div>
              <div className="wc-note">
                Все 5 отрезков равные по качеству и усилию. Это не максимум,
                остаётся запас.
              </div>
            </div>

            <div className="wcard">
              <div className="wc-h">
                <span className="t">
                  <span className="ic">&#127939;</span> Равномерный бег
                </span>
                <span className="m">40 мин · среда</span>
              </div>
              <div className="wc-bar">
                <div className="wc-seg easy" style={{ flex: 1 }}>
                  равномерный темп
                </div>
              </div>
              <div className="wc-rows">
                <div className="wc-row">
                  <span className="pc">06:45-07:00</span>
                  <span className="tx">
                    <b>40 минут</b> равномерного бега
                  </span>
                </div>
              </div>
              <div className="wc-note">
                Развиваем базу и поддерживаем общий объём.
              </div>
            </div>

            <div className="wcard">
              <div className="wc-h">
                <span className="t">
                  <span className="ic">&#9889;</span> Активация
                </span>
                <span className="m">пятница</span>
              </div>
              <div className="wc-bar">
                <div className="wc-seg easy">лёгкий</div>
                <div className="wc-seg tempo">темп 5к</div>
                <div className="wc-seg easy">лёгкий</div>
              </div>
              <div className="wc-rows">
                <div className="wc-row">
                  <span className="pc">разминка</span>
                  <span className="tx">10 минут лёгкого бега</span>
                </div>
                <div className="wc-row">
                  <span className="pc">темп 5 км</span>
                  <span className="tx">
                    <b>3 минуты</b> в темпе бега на 5 км: интенсивно, но с
                    контролем
                  </span>
                </div>
                <div className="wc-row">
                  <span className="pc">заминка</span>
                  <span className="tx">10 минут лёгкого завершения</span>
                </div>
              </div>
              <div className="wc-note">
                Цель: «встряхнуть» тело, активировать скорость и технику.
              </div>
            </div>

            <div className="wcard">
              <div className="wc-h">
                <span className="t">
                  <span className="ic">&#128170;</span> Силовая после бега
                </span>
                <span className="m">ср · вс</span>
              </div>
              <div className="wc-rows" style={{ marginTop: "2px" }}>
                <div className="wc-row">
                  <span className="pc">3 × 12-15</span>
                  <span className="tx">
                    <b>Болгарский сплит-присед</b> на каждую ногу
                  </span>
                </div>
                <div className="wc-row">
                  <span className="pc">3 × 12-15</span>
                  <span className="tx">
                    <b>Подъём на носок стоя</b> на каждую ногу
                  </span>
                </div>
              </div>
              <div className="wc-note">
                Укрепляем ноги, ягодицы и корпус для стабильности в беге. К
                каждому упражнению есть видео.
              </div>
            </div>
          </Carousel>
        </div>
      </section>

      {/* КОМУ ПОДОЙДЁТ */}
      <section>
        <div className="wrap">
          <div className="head">
            <span className="eyebrow">Кому подойдёт</span>
            <h2>Подойдёт тебе, если</h2>
          </div>
          <div className="grid g2">
            <div className="card whaty">
              <span className="mk">&#10003;</span>
              <p>Хочешь начать бегать, но не знаешь, с чего</p>
            </div>
            <div className="card whaty">
              <span className="mk">&#10003;</span>
              <p>Бегаешь наугад и без системы</p>
            </div>
            <div className="card whaty">
              <span className="mk">&#10003;</span>
              <p>Уже тренируешься, но нет прогресса</p>
            </div>
            <div className="card whaty">
              <span className="mk">&#10003;</span>
              <p>Хочешь попробовать работу со мной</p>
            </div>
          </div>
        </div>
      </section>

      {/* ОТЗЫВЫ */}
      <section
        style={{
          background: "var(--surface)",
          borderTop: "1px solid var(--line)",
          borderBottom: "1px solid var(--line)",
        }}
      >
        <div className="wrap">
          <div className="head">
            <span className="eyebrow">Отзывы</span>
            <h2>Что говорят участники</h2>
            <p>Скриншоты из чатов прошлых потоков.</p>
          </div>
          <Carousel trackClassName="w-rev">
            <div className="slide">
              <img
                src="/intensive/rev-01-lex.jpg"
                alt="Отзыв Lex об интенсиве"
                loading="lazy"
              />
            </div>
            <div className="slide">
              <img
                src="/intensive/rev-02-lubava.jpg"
                alt="Отзыв Любавы"
                loading="lazy"
              />
            </div>
            <div className="slide">
              <img
                src="/intensive/rev-03-olga.jpg"
                alt="Отзыв Ольги Королёвой"
                loading="lazy"
              />
            </div>
            <div className="slide">
              <img
                src="/intensive/rev-04-stepan.jpg"
                alt="Отзыв Степана Трофимова"
                loading="lazy"
              />
            </div>
            <div className="slide">
              <img
                src="/intensive/rev-05-makar.jpg"
                alt="Отзыв Макара"
                loading="lazy"
              />
            </div>
            <div className="slide">
              <img
                src="/intensive/rev-06-anna.jpg"
                alt="Отзыв Анны Куликовой"
                loading="lazy"
              />
            </div>
            <div className="slide">
              <img
                src="/intensive/rev-07-viktoria.jpg"
                alt="Отзыв Виктории"
                loading="lazy"
              />
            </div>
            <div className="slide">
              <img
                src="/intensive/rev-08-nadi.jpg"
                alt="Отзыв Нади"
                loading="lazy"
              />
            </div>
            <div className="slide">
              <img
                src="/intensive/rev-09-darya.jpg"
                alt="Отзыв Дарьи"
                loading="lazy"
              />
            </div>
            <div className="slide">
              <img
                src="/intensive/rev-10-babyso.jpg"
                alt="Отзыв участницы интенсива"
                loading="lazy"
              />
            </div>
            <div className="slide">
              <img
                src="/intensive/rev-11-irina.jpg"
                alt="Отзыв Ирины"
                loading="lazy"
              />
            </div>
            <div className="slide">
              <img
                src="/intensive/rev-12-alina-kovaleva.jpg"
                alt="Отзыв Алины Ковалевой"
                loading="lazy"
              />
            </div>
            <div className="slide">
              <img
                src="/intensive/rev-13-yaroslav.jpg"
                alt="Отзыв Ярослава Ермолаева"
                loading="lazy"
              />
            </div>
            <div className="slide">
              <img
                src="/intensive/rev-14-svetlana.jpg"
                alt="Отзыв Светланы"
                loading="lazy"
              />
            </div>
            <div className="slide">
              <img
                src="/intensive/rev-15-alina.jpg"
                alt="Отзыв Алины"
                loading="lazy"
              />
            </div>
            <div className="slide">
              <img
                src="/intensive/rev-16-maria.jpg"
                alt="Отзыв Марии Туркиной"
                loading="lazy"
              />
            </div>
          </Carousel>
        </div>
      </section>

      {/* FAQ */}
      <section>
        <div className="wrap">
          <div className="head">
            <span className="eyebrow">Частые вопросы</span>
            <h2>Что обычно спрашивают</h2>
          </div>
          <div className="faq">
            <details className="q">
              <summary>
                У меня нет беговых часов и пульсометра, что делать?
              </summary>
              <div className="a">
                Можно использовать приложение на телефоне. Я расскажу, какое
                скачать и как настроить.
              </div>
            </details>
            <details className="q">
              <summary>
                У меня нет беговой экипировки, можно участвовать?
              </summary>
              <div className="a">
                Да. Подойдут любые удобные кроссовки и одежда по погоде.
                Начнём с того, что есть, помогу с выбором позже.
              </div>
            </details>
            <details className="q">
              <summary>Как часто нужно будет бегать?</summary>
              <div className="a">
                Обычно 3-4 тренировки в неделю по 30-60 минут. План
                подстраиваю под твой уровень и занятость.
              </div>
            </details>
            <details className="q">
              <summary>Можно бегать на дорожке?</summary>
              <div className="a">
                Да. План подходит и для улицы, и для дорожки.
              </div>
            </details>
            <details className="q">
              <summary>Если пропущу тренировку, что делать?</summary>
              <div className="a">
                Ничего страшного. План адаптируется. Главное, быть на связи
                и не молчать.
              </div>
            </details>
            <details className="q">
              <summary>Я с нуля, справлюсь?</summary>
              <div className="a">
                Да, план подстраивается. Даже если сейчас только ходишь, это
                уже точка старта.
              </div>
            </details>
          </div>
        </div>
      </section>

      {/* ЧТО ОСТАЁТСЯ ПОСЛЕ */}
      <section>
        <div className="wrap">
          <div className="head">
            <span className="eyebrow">После интенсива</span>
            <h2>Что остаётся с тобой</h2>
            <p>
              Интенсив длится 10 дней, но то, что ты получаешь, работает
              дальше.
            </p>
          </div>
          <div className="grid g2">
            <div className="card whaty">
              <span className="mk">&#10003;</span>
              <p>
                <b>Понимание, как тренироваться дальше</b> самостоятельно,
                без догадок
              </p>
            </div>
            <div className="card whaty">
              <span className="mk">&#10003;</span>
              <p>
                <b>Как устроен тренировочный процесс:</b> из чего
                складывается неделя и зачем нужна каждая тренировка
              </p>
            </div>
            <div className="card whaty">
              <span className="mk">&#10003;</span>
              <p>
                <b>Как работают пульсовые зоны</b> и как бежать в своём
                темпе
              </p>
            </div>
            <div className="card whaty">
              <span className="mk">&#10003;</span>
              <p>
                <b>Все гайды и материалы</b> интенсива остаются у тебя
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* КОГДА И КАК */}
      <section
        style={{
          background: "var(--surface)",
          borderTop: "1px solid var(--line)",
          borderBottom: "1px solid var(--line)",
        }}
      >
        <div className="wrap">
          <div className="head">
            <span className="eyebrow">Когда и как</span>
            <h2>Формат набора</h2>
          </div>
          <div className="band" style={{ marginBottom: "30px" }}>
            <div className="bandi">
              <div className="v">Раз в 2-3 недели</div>
              <div className="k">интенсив запускается потоками</div>
            </div>
            <div className="bandi">
              <div className="v">Набор закрывается</div>
              <div className="k">в течение часа после старта</div>
            </div>
            <div className="bandi">
              <div className="v">
                Всего {SEATS_TOTAL} {seatsWord(SEATS_TOTAL)}
              </div>
              <div className="k">каждого веду лично</div>
            </div>
          </div>
          <div className="price">
            <div>
              <div
                className="eyebrow"
                style={{ color: "rgba(255,255,255,.55)", marginBottom: "10px" }}
              >
                Стоимость
              </div>
              <div className="big">
                {FLOW.price} <span>· {FLOW.priceEur}</span>
              </div>
            </div>
            <ul className="price-stack">
              <li>
                <span className="c">&#10003;</span>Личный беговой план на 10
                дней
              </li>
              <li>
                <span className="c">&#10003;</span>Техника и силовые, с видео
              </li>
              <li>
                <span className="c">&#10003;</span>Разбор каждой тренировки
              </li>
              <li>
                <span className="c">&#10003;</span>Поддержка и ответы в чате
              </li>
              <li>
                <span className="c">&#10003;</span>Система, которую заберёшь
                с собой
              </li>
            </ul>
          </div>
        </div>
      </section>

      {/* ФИНАЛЬНЫЙ CTA */}
      <section>
        <div className="wrap">
          <div className="final">
            <span className="urg">
              {seatsClosed ? (
                <>&#9203; Набор в этот поток закрыт</>
              ) : (
                <>
                  &#9203; Осталось {seatsLeft} {seatsWord(seatsLeft)} в{" "}
                  {FLOW.number}-м потоке
                </>
              )}
            </span>
            <h2>Хочешь бегать правильно и улучшать результаты?</h2>
            <p>
              Записывайся сейчас, чтобы точно занять своё место в потоке.
              Отвечу лично и всё расскажу.
            </p>
            <a href={TG_LINK} className="btn btn--tg btn--lg">
              <TgIcon />
              Записаться в Telegram
            </a>
          </div>
        </div>
      </section>

      {/* НАВИГАЦИЯ / ССЫЛКИ */}
      <section style={{ paddingTop: 0 }}>
        <div className="wrap">
          <div
            className="head"
            style={{ textAlign: "center", margin: "0 auto 28px" }}
          >
            <span className="eyebrow">Ещё у меня есть</span>
          </div>
          <div className="links">
            <a className="linkbtn" href="/landing">
              <span className="ic">&#127939;</span>Беговой клуб: постоянное
              сопровождение
              <span className="ar">&rarr;</span>
            </a>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer>
        <div className="wrap">
          <div>© 2026 · Игорь Поцелуев · Беговой интенсив</div>
          <div>
            <a href="https://t.me/IgorPotseluev">Telegram</a> ·{" "}
            <a href="#">Instagram</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
