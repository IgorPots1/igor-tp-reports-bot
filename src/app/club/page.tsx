import type { Metadata } from "next";
import { publicPageMetadata } from "@/lib/site";
import { Onest, JetBrains_Mono } from "next/font/google";
import Image from "next/image";
import LeadForm from "./LeadForm";
import Carousel from "./Carousel";
import { CLUB } from "@/lib/club";
import "./club.css";

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
  path: "/club",
  title: "Беговой клуб Игоря Поцелуева — система сопровождения бегунов",
  description:
    "Индивидуальный план тренировок, разбор техники, тренер на связи каждый день. От первых 5 км до марафона — системный подход к бегу.",
});

export default function LandingPage() {
  return (
    <div className={`landing-root ${onest.variable} ${jetbrains.variable}`}>
      {/* NAV */}
      <nav className="top">
        <div className="wrap">
          <div className="brand">
            <span className="dot"></span>Игорь Поцелуев · Беговой клуб
          </div>
          <a href="#join" className="btn">
            Записаться
          </a>
        </div>
      </nav>

      {/* HERO */}
      <section className="hero">
        <div className="wrap hero-grid">
          <div>
            <span className="eyebrow">Система сопровождения бегунов</span>
            <h1 style={{ marginTop: "16px" }}>
              Понятный план и <span className="hl">тренер рядом</span> — на
              пути к вашей цели
            </h1>
            <p className="hero-sub">
              Не приложение с шаблоном. Живая работа тренера и спортсмена: я
              веду вас шаг за шагом к вашей цели — будь то первый забег, личный
              рекорд или просто регулярный бег в удовольствие.
            </p>
            <ul className="deliver">
              <li>
                <span className="mk">&#10003;</span> Индивидуальный план под
                ваш уровень и цели
              </li>
              <li>
                <span className="mk">&#10003;</span> Разбор и обратная связь по
                каждой тренировке
              </li>
              <li>
                <span className="mk">&#10003;</span> Тренер на связи каждый
                день — в чате и лично
              </li>
              <li>
                <span className="mk">&#10003;</span> Силовые, растяжка и
                восстановление + разбор техники
              </li>
              <li>
                <span className="mk">&#10003;</span> Веду до вашей цели: забег,
                рекорд или регулярный бег
              </li>
            </ul>
            <div className="hero-cta">
              <a href="#join" className="btn btn--lg">
                Записаться в клуб &rarr;
              </a>
              <span className="meta">Присоединиться можно в любой момент</span>
            </div>
            <div className="trust">
              <span>
                <b>10+ лет</b> тренерской практики
              </span>
              <span>
                <b>500+</b> финишей учеников
              </span>
              <span>
                от <b>5 км</b> до ультрамарафонов
              </span>
            </div>
          </div>
          <div className="hero-photo">
            <Image
              src="/landing/01-hero.jpg"
              alt="Игорь Поцелуев на забеге"
              width={600}
              height={750}
              priority
              style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "50% 30%" }}
            />
            <div className="hero-badge">
              <span className="dot"></span>Игорь Поцелуев · тренер
            </div>
          </div>
        </div>
      </section>

      {/* КАК МЫ РАБОТАЕМ */}
      <section
        style={{
          background: "var(--surface)",
          borderTop: "1px solid var(--line)",
          borderBottom: "1px solid var(--line)",
        }}
      >
        <div className="wrap">
          <div className="head">
            <span className="eyebrow">Сопровождение</span>
            <h2>Как мы работаем</h2>
            <p>
              Это не разовый план, а постоянное сопровождение. Каждую неделю —
              план, ваши ощущения и моя обратная связь.
            </p>
          </div>
          <div className="steps">
            <div className="stepc">
              <div className="sc-n">— 01</div>
              <h3>План тренировок</h3>
              <p>Под ваш уровень, цели и график. Вся неделя видна наперёд.</p>
            </div>
            <div className="stepc">
              <div className="sc-n">— 02</div>
              <h3>Тренировка</h3>
              <p>
                Подробное описание: структура, темп и задача каждого отрезка.
              </p>
            </div>
            <div className="stepc">
              <div className="sc-n">— 03</div>
              <h3>Отчёт в чат</h3>
              <p>Делитесь данными и ощущениями после тренировки.</p>
            </div>
            <div className="stepc">
              <div className="sc-n">— 04</div>
              <h3>Разбор тренером</h3>
              <p>
                Я анализирую выполнение и даю рекомендации на следующий шаг.
              </p>
            </div>
          </div>
          <div className="visuals">
            <div className="vbox">
              <div className="window">
                <div className="window-bar">
                  <span className="win-dot r"></span>
                  <span className="win-dot y"></span>
                  <span className="win-dot g"></span>
                  <div className="win-title">
                    Личный кабинет · неделя тренировок
                  </div>
                  <div className="win-spacer"></div>
                </div>
                <div className="window-body">
                  <img
                    src="/landing/02-calendar.jpg"
                    alt="Календарь тренировок"
                    loading="lazy"
                  />
                </div>
              </div>
              <div className="visual-cap">Личный кабинет · план на неделю</div>
            </div>
            <div className="vbox">
              <div className="wcard">
                <div className="wc-head">
                  <span className="wc-title">
                    <span className="wc-ic">&#9201;</span> Интервальная
                    тренировка
                  </span>
                  <span className="wc-meta">10,0 км · 20 × 1 мин</span>
                </div>
                <div className="wc-bar">
                  <div className="wc-seg warm">Разминка</div>
                  <div className="wc-seg main">
                    <span className="chip">20 × 1 мин</span>
                  </div>
                  <div className="wc-seg cool">Заминка</div>
                </div>
                <div className="wc-rows">
                  <div className="wc-row">
                    <span className="pc">06:21–06:50</span>
                    <span className="tx">
                      <b>Разминка</b> — 10 мин лёгкого бега
                    </span>
                  </div>
                  <div className="wc-row">
                    <span className="pc">04:55–05:09</span>
                    <span className="tx">
                      <b>Основная</b> — 20 × (1 мин в темпе + 1 мин лёгкий)
                    </span>
                  </div>
                  <div className="wc-row">
                    <span className="pc">06:21–06:50</span>
                    <span className="tx">
                      <b>Заминка</b> — 5 мин спокойного бега
                    </span>
                  </div>
                </div>
                <div className="wc-note">
                  Между отрезками — полное восстановление: спокойное дыхание,
                  сброс пульса.
                </div>
              </div>
              <div className="visual-cap">
                Карточка тренировки · пример интервалов
              </div>
            </div>
          </div>
          <div className="flow-close">
            <span className="ic">&#8635;</span>
            <p>
              Этот цикл повторяется каждую неделю — устойчивый прогресс без
              догадок.
            </p>
          </div>
        </div>
      </section>

      {/* ВСЯ РАБОТА В ЧАТЕ */}
      <section>
        <div className="wrap">
          <div className="head">
            <span className="eyebrow">Как идёт работа</span>
            <h2>Вся работа идёт в чате</h2>
            <p>
              После каждой тренировки вы отправляете отчёт — я смотрю
              тренировку и даю рекомендации. Писать можно и в общий чат клуба,
              и лично мне в личные сообщения. Я на связи каждый день и разбираю
              тренировки в течение дня — это живое сопровождение, а не
              автоответы раз в неделю.
            </p>
          </div>
          <div className="proc">
            <div className="prc">
              <div className="prc-n">— 01</div>
              <h3>Выполнили тренировку</h3>
              <p>
                Бег по плану — данные с часов синхронизируются автоматически.
              </p>
            </div>
            <div className="prc-arrow">&rarr;</div>
            <div className="prc">
              <div className="prc-n">— 02</div>
              <h3>Отправили отчёт</h3>
              <p>
                Пишете самочувствие и ощущения от тренировки: что было легко,
                что тяжело. Темп и данные я вижу сам.
              </p>
            </div>
            <div className="prc-arrow">&rarr;</div>
            <div className="prc">
              <div className="prc-n">— 03</div>
              <h3>Получили рекомендации</h3>
              <p>
                Разбор тренировки и план на следующий шаг подготовки.
              </p>
            </div>
          </div>
          <div className="report-ex">
            <span className="eyebrow">Пример отчёта ученика</span>
            <blockquote className="report-quote">
              Пробежка сегодня зашла легко — дыхание ровное, ноги свежие,
              восстановился быстро. На последних минутах немного устал, но в
              целом бежалось в удовольствие.
              <cite>— из отчёта ученика после тренировки</cite>
            </blockquote>
          </div>
        </div>
      </section>

      {/* ЧТО АНАЛИЗИРУЕТ ТРЕНЕР */}
      <section
        style={{
          background: "var(--surface)",
          borderTop: "1px solid var(--line)",
          borderBottom: "1px solid var(--line)",
        }}
      >
        <div className="wrap">
          <div className="head">
            <span className="eyebrow">Обратная связь</span>
            <h2>Я анализирую каждую тренировку</h2>
            <p>
              Не просто галочка «выполнено». Смотрю на тренировку целиком — и
              подстраиваю план дальше.
            </p>
          </div>
          <div className="analyze">
            <div className="analyze-img">
              <img
                src="/landing/03-garmin-report.jpg"
                alt="Тренировка ученика"
                loading="lazy"
              />
              <div className="visual-cap">
                Реальная тренировка ученицы · Garmin
              </div>
            </div>
            <div className="analyze-card">
              <h3>Что анализирует тренер</h3>
              <ul className="checks">
                <li>
                  <span className="ch">&#10003;</span>темп тренировки
                </li>
                <li>
                  <span className="ch">&#10003;</span>пульс
                </li>
                <li>
                  <span className="ch">&#10003;</span>самочувствие ученика
                </li>
                <li>
                  <span className="ch">&#10003;</span>восстановление
                </li>
                <li>
                  <span className="ch">&#10003;</span>питание перед тренировкой
                </li>
                <li>
                  <span className="ch">&#10003;</span>соответствие плана и
                  факта
                </li>
              </ul>
              <div className="analyze-note">
                На основе разбора корректируем нагрузку и темп для следующих
                тренировок.
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* РАЗБОР ТЕХНИКИ */}
      <section>
        <div className="wrap">
          <div className="tech">
            <div className="tech-visual">
              <Image
                src="/landing/04-technique.jpg"
                alt="Разбор техники бега"
                width={600}
                height={450}
                loading="lazy"
                style={{ width: "100%", height: "auto", display: "block" }}
              />
            </div>
            <div>
              <span className="eyebrow">Техника бега</span>
              <h2 style={{ marginTop: "14px", marginBottom: "16px" }}>
                Разбираю технику по кадрам
              </h2>
              <p
                style={{
                  color: "var(--ink-2)",
                  fontSize: "16.5px",
                  maxWidth: "48ch",
                  marginBottom: "20px",
                }}
              >
                Снимаете себя на бегу — я по кадрам, простыми словами,
                показываю, что мешает бежать легче, экономичнее и безопаснее.
              </p>
              <ul className="checks">
                <li>
                  <span className="ch">&#10003;</span>наклон корпуса
                </li>
                <li>
                  <span className="ch">&#10003;</span>вынос колена
                </li>
                <li>
                  <span className="ch">&#10003;</span>работа рук
                </li>
                <li>
                  <span className="ch">&#10003;</span>постановка стопы
                </li>
              </ul>
              <div
                className="analyze-note"
                style={{
                  borderTop: "1px solid var(--line)",
                  marginTop: "22px",
                  paddingTop: "16px",
                }}
              >
                Что подкрутить в технике и что укрепить силовыми — с
                конкретными упражнениями.
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* КТО СОСТАВЛЯЕТ ПЛАН */}
      <section
        style={{
          background: "var(--surface)",
          borderTop: "1px solid var(--line)",
          borderBottom: "1px solid var(--line)",
        }}
      >
        <div className="wrap">
          <div className="expert">
            <span className="eyebrow">Кто ведёт</span>
            <h2 style={{ marginTop: "14px" }}>Кто составляет ваш план</h2>
            <p className="lede">
              Меня зовут <b>Игорь</b>. Более 10 лет я веду бегунов разного
              уровня — от первых 5 км до марафонов — и каждый план собираю под
              конкретного человека, а не по шаблону.
            </p>
            <div className="expert-facts">
              <div className="ef">
                <div className="v">10+ лет</div>
                <div className="k">тренерской практики</div>
              </div>
              <div className="ef">
                <div className="v">500+ финишей</div>
                <div className="k">учеников на разных дистанциях</div>
              </div>
              <div className="ef">
                <div className="v">Любители</div>
                <div className="k">разных уровней — от новичков</div>
              </div>
              <div className="ef">
                <div className="v">Системный подход</div>
                <div className="k">сопровождение, а не разовый план</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* РЕЗУЛЬТАТЫ */}
      <section>
        <div className="wrap">
          <div className="head">
            <span className="eyebrow">Результаты</span>
            <h2>Чего добиваются ученики</h2>
            <p>
              Реальные кейсы участников клуба. Главное — прогресс: было &rarr;
              стало.
            </p>
          </div>
          <div className="results-band">
            <div className="rb">
              <div className="v">
                <span className="u">500+</span>
              </div>
              <div className="k">
                успешных финишей подопечных на различных дистанциях
              </div>
            </div>
            <div className="rb">
              <div className="v">
                Первые <span className="u">марафоны</span>
              </div>
              <div className="k">
                ученики добегают первый марафон без «стены»
              </div>
            </div>
            <div className="rb">
              <div className="v">
                Личные <span className="u">рекорды</span>
              </div>
              <div className="k">
                прогресс на 5 км, 10 км, полумарафоне и марафоне
              </div>
            </div>
          </div>
          <Carousel trackClassName="w-case">
            <div className="slide">
              <img src="/landing/05-result-nadya.jpg" alt="Результат 1" loading="lazy" />
              <div className="case-cap">
                <div className="delta">
                  1:52 <span className="ar">&rarr;</span> 1:44
                </div>
                <div className="sub">
                  Полумарафон · минус 8 минут · 1 место в группе
                </div>
              </div>
            </div>
            <div className="slide">
              <img src="/landing/06-result-2-10-to-1-52.jpg" alt="Результат 2" loading="lazy" />
              <div className="case-cap">
                <div className="delta">
                  2:10 <span className="ar">&rarr;</span> 1:52
                </div>
                <div className="sub">Полумарафон · минус 18 минут</div>
              </div>
            </div>
            <div className="slide">
              <img src="/landing/07-result-2-16-to-1-50.jpg" alt="Результат 3" loading="lazy" />
              <div className="case-cap">
                <div className="delta">
                  2:16 <span className="ar">&rarr;</span> 1:50
                </div>
                <div className="sub">Полумарафон · минус 26 минут</div>
              </div>
            </div>
            <div className="slide">
              <img src="/landing/08-result-uglich-1-50-09.jpg" alt="Результат 4" loading="lazy" />
              <div className="case-cap">
                <div className="delta">1:50:09</div>
                <div className="sub">
                  Полумарафон в Угличе · минус 3 минуты
                </div>
              </div>
            </div>
            <div className="slide">
              <img src="/landing/09-result-sochi-marathon.jpg" alt="Результат 5" loading="lazy" />
              <div className="case-cap">
                <div className="delta">Первый марафон</div>
                <div className="sub">
                  Сочи · 42,2 км за 4:21 · «почти не устала»
                </div>
              </div>
            </div>
            <div className="slide">
              <img src="/landing/10-result-10k-47-43.jpg" alt="Результат 6" loading="lazy" />
              <div className="case-cap">
                <div className="delta">10 км — 47:43</div>
                <div className="sub">Личный рекорд на десятке</div>
              </div>
            </div>
            <div className="slide">
              <img src="/landing/11-result-capcity-1-51-47.jpg" alt="Результат 7" loading="lazy" />
              <div className="case-cap">
                <div className="delta">1:51:47</div>
                <div className="sub">
                  Второй полумарафон · минус 15 минут (США)
                </div>
              </div>
            </div>
          </Carousel>
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
            <h2>Что говорят ученики</h2>
            <p>Истории из чата и с финишей.</p>
          </div>
          <Carousel trackClassName="w-rev">
            <div className="slide">
              <img src="/landing/12-review-cheboksary.jpg" alt="Отзыв 1" loading="lazy" />
            </div>
            <div className="slide">
              <img src="/landing/13-review-sadovoe-pair.jpg" alt="Отзыв 2" loading="lazy" />
            </div>
            <div className="slide">
              <img src="/landing/14-review-bokeski.jpg" alt="Отзыв 3" loading="lazy" />
            </div>
            <div className="slide">
              <img src="/landing/15-review-itogi-2000km.jpg" alt="Отзыв 4" loading="lazy" />
            </div>
            <div className="slide">
              <img src="/landing/16-review-marina.jpg" alt="Отзыв 5" loading="lazy" />
            </div>
            <div className="slide">
              <img src="/landing/17-review-veronika.jpg" alt="Отзыв 6" loading="lazy" />
            </div>
            <div className="slide">
              <img src="/landing/18-review-podgorica.jpg" alt="Отзыв 7" loading="lazy" />
            </div>
            <div className="slide">
              <img src="/landing/19-video-1.jpg" alt="Отзыв 8" loading="lazy" />
            </div>
            <div className="slide">
              <img src="/landing/20-video-2.jpg" alt="Отзыв 9" loading="lazy" />
            </div>
            <div className="slide">
              <img src="/landing/21-video-3.jpg" alt="Отзыв 10" loading="lazy" />
            </div>
            <div className="slide">
              <img src="/landing/22-video-4.jpg" alt="Отзыв 11" loading="lazy" />
            </div>
          </Carousel>
        </div>
      </section>

      {/* MID CTA */}
      <section>
        <div className="wrap">
          <div className="cta-strip">
            <div className="cs-txt">
              <b>Готовы попробовать?</b>
              <span>
                Заявка ни к чему не обязывает — сначала знакомимся и обсуждаем
                цели.
              </span>
            </div>
            <a href="#join" className="btn btn--lg">
              Записаться в клуб &rarr;
            </a>
          </div>
        </div>
      </section>

      {/* БОЛЬШЕ ЧЕМ ПЛАН */}
      <section
        style={{
          background: "var(--surface)",
          borderTop: "1px solid var(--line)",
          borderBottom: "1px solid var(--line)",
        }}
      >
        <div className="wrap">
          <div className="head">
            <span className="eyebrow">Почему это работает</span>
            <h2>Больше чем просто план тренировок</h2>
            <p>
              План — только основа. Прогресс даёт система вокруг него: силовые,
              восстановление, питание и взгляд на всю картину.
            </p>
          </div>
          <div className="why-grid">
            <div className="why">
              <div className="ic">&#9677;</div>
              <h3>Питание как часть подготовки</h3>
              <ul>
                <li>Энергия для тренировок, а не подсчёт калорий</li>
                <li>Восстановление после нагрузок</li>
                <li>Питание перед стартами и на длительных</li>
                <li>Рекомендации под вашу нагрузку и цели</li>
              </ul>
            </div>
            <div className="why">
              <div className="ic">&#9683;</div>
              <h3>Силовые и восстановление</h3>
              <ul>
                <li>Силовые упражнения с видео</li>
                <li>ОФП под бег</li>
                <li>Растяжка и работа с роллом</li>
                <li>Восстановление без перегруза</li>
              </ul>
            </div>
            <div className="why">
              <div className="ic">&#9650;</div>
              <h3>Ежемесячный анализ прогресса</h3>
              <ul>
                <li>Динамика за месяц</li>
                <li>Насколько стабильно идёт подготовка</li>
                <li>Где есть прогресс, а где нет</li>
                <li>Рекомендации на следующий этап</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ЗАКРЫВАЕТ ПОТРЕБНОСТИ */}
      <section>
        <div className="wrap">
          <div className="head">
            <span className="eyebrow">Итог</span>
            <h2>Клуб закрывает ключевые потребности бегуна</h2>
          </div>
          <div className="needs">
            <div className="need">
              <span className="mk">&#10003;</span>Понятный и эффективный план
            </div>
            <div className="need">
              <span className="mk">&#10003;</span>Поддержка тренера каждый день
            </div>
            <div className="need">
              <span className="mk">&#10003;</span>Разбор техники бега
            </div>
            <div className="need">
              <span className="mk">&#10003;</span>Обратная связь на тренировки
            </div>
            <div className="need">
              <span className="mk">&#10003;</span>Гибкость и адаптация плана
            </div>
            <div className="need">
              <span className="mk">&#10003;</span>Силовые, растяжка, ролл и
              восстановление
            </div>
            <div className="need">
              <span className="mk">&#10003;</span>Сообщество, где поймут и
              поддержат
            </div>
            <div className="need">
              <span className="mk">&#10003;</span>Подготовка к стартам
            </div>
          </div>
        </div>
      </section>

      {/* КОМУ ПОДОЙДЁТ */}
      <section
        style={{
          background: "var(--surface)",
          borderTop: "1px solid var(--line)",
          borderBottom: "1px solid var(--line)",
        }}
      >
        <div className="wrap">
          <div className="head">
            <span className="eyebrow">Кому подойдёт</span>
            <h2>Клуб для тебя, если ты хочешь</h2>
          </div>
          <div className="who-grid">
            <div className="who">
              <span className="mk">&#10003;</span>
              <p>Начать бегать регулярно и без постоянных срывов</p>
            </div>
            <div className="who">
              <span className="mk">&#10003;</span>
              <p>
                Готовиться к первым 5 км, 10 км, полумарафону или марафону
              </p>
            </div>
            <div className="who">
              <span className="mk">&#10003;</span>
              <p>
                Улучшать результаты без перегрузок и хаотичных тренировок
              </p>
            </div>
            <div className="who">
              <span className="mk">&#10003;</span>
              <p>Получать обратную связь и поддержку тренера</p>
            </div>
            <div className="who">
              <span className="mk">&#10003;</span>
              <p>Тренироваться по индивидуальному плану</p>
            </div>
            <div className="who">
              <span className="mk">&#10003;</span>
              <p>Сделать бег частью жизни надолго</p>
            </div>
            <div className="who span">
              <span className="mk">&#10003;</span>
              <p>Быть в сильном, поддерживающем комьюнити</p>
            </div>
          </div>
        </div>
      </section>

      {/* СТОИМОСТЬ */}
      <section id="price">
        <div className="wrap">
          <div className="head">
            <span className="eyebrow">Стоимость</span>
            <h2>Сколько стоит</h2>
          </div>
          <div className="price-wrap">
            <div className="price-card">
              <div className="price-main">
                <b>{CLUB.priceMonthly}</b>
                <span>в месяц</span>
              </div>
              <p className="price-note">
                Одна цена за всё сопровождение. Никаких пакетов на полгода
                и доплат за разборы.
              </p>
              <ul className="price-list">
                <li>
                  <span className="mk">&#10003;</span> Индивидуальный план,
                  разбор каждой тренировки и связь с тренером каждый день
                </li>
                <li>
                  <span className="mk">&#10003;</span> Силовые, растяжка,
                  восстановление и разбор техники
                </li>
                <li>
                  <span className="mk">&#10003;</span> Оплата помесячно,
                  остановиться можно в любой момент
                </li>
                <li>
                  <span className="mk">&#10003;</span> Для тех, кто живёт не
                  в России, есть оплата в евро
                </li>
              </ul>
              <a href="#join" className="btn btn--lg">
                Записаться в клуб &rarr;
              </a>
            </div>
          </div>
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
              <summary>Сколько стоит и как оплачивать?</summary>
              <div className="a">
                {CLUB.priceMonthly} в месяц за всё сопровождение: план, разборы
                тренировок и связь с тренером. Оплата помесячно, остановиться
                можно в любой момент. Для учеников не из России есть оплата
                в евро.
              </div>
            </details>
            <details className="q">
              <summary>Подойдёт ли клуб новичку?</summary>
              <div className="a">
                Да. Возьму с любого уровня — даже если сейчас тяжело пробежать
                и километр. Начнём аккуратно, шаг за шагом, и постепенно
                дойдём до вашей цели.
              </div>
            </details>
            <details className="q">
              <summary>Нужны ли беговые часы?</summary>
              <div className="a">
                Необязательно. Можно начать с приложения на телефоне — я всё
                покажу и помогу настроить. Часы удобны, но на старте без них
                вполне можно обойтись.
              </div>
            </details>
            <details className="q">
              <summary>Сколько тренировок обычно в неделю?</summary>
              <div className="a">
                Обычно 3–5, в зависимости от цели и свободного времени. Можно
                бегать 3 раза по 30 минут, а можно готовиться к старту плотнее.
                Главное — регулярность, а не количество.
              </div>
            </details>
            <details className="q">
              <summary>Как часто вы отвечаете на сообщения?</summary>
              <div className="a">
                Я на связи каждый день и разбираю тренировки в течение дня. Это
                живое сопровождение, а не автоответы и не раз в неделю.
              </div>
            </details>
            <details className="q">
              <summary>Можно ли совмещать с работой и семьёй?</summary>
              <div className="a">
                Да, большинство учеников так и тренируется. План подстраивается
                под вашу неделю — можно менять дни и объём, если в жизни
                что-то поменялось.
              </div>
            </details>
            <details className="q">
              <summary>Что делать, если пропустил тренировку?</summary>
              <div className="a">
                Ничего страшного. План адаптируется — один пропуск не ломает
                подготовку. Главное — оставаться на связи и не исчезать.
              </div>
            </details>
            <details className="q">
              <summary>У меня была травма — не станет ли хуже?</summary>
              <div className="a">
                Нет. Учту ваш фон: плавный вход в нагрузку, работа над
                техникой, силовые без перегруза.
              </div>
            </details>
            <details className="q">
              <summary>Можно ли бегать на дорожке?</summary>
              <div className="a">
                Да, план легко адаптируется под беговую дорожку.
              </div>
            </details>
            <details className="q">
              <summary>Как выглядит план и обратная связь?</summary>
              <div className="a">
                У вас личный кабинет с календарём тренировок. После каждой —
                мой комментарий, подсказки и корректировка следующих занятий.
              </div>
            </details>
            <details className="q">
              <summary>С кем я буду тренироваться?</summary>
              <div className="a">
                С командой бегунов из разных городов и стран: поддержка,
                отчёты, советы и общие победы в чате клуба.
              </div>
            </details>
          </div>
        </div>
      </section>

      {/* ЧТО ПОСЛЕ ЗАЯВКИ */}
      <section
        style={{
          background: "var(--surface)",
          borderTop: "1px solid var(--line)",
          borderBottom: "1px solid var(--line)",
        }}
      >
        <div className="wrap">
          <div className="head">
            <span className="eyebrow">Спокойно и без обязательств</span>
            <h2>Что будет после заявки</h2>
          </div>
          <div className="after-grid">
            <div className="after">
              <div className="n">1</div>
              <h3>Связываемся и знакомимся</h3>
              <p>
                Я отвечу на заявку и мы договоримся, как удобнее пообщаться.
              </p>
            </div>
            <div className="after">
              <div className="n">2</div>
              <h3>Обсуждаем цели и уровень</h3>
              <p>Поговорим о ваших целях, опыте и текущей форме.</p>
            </div>
            <div className="after">
              <div className="n">3</div>
              <h3>Подбираем формат и стартуем</h3>
              <p>
                Определяем подходящий формат работы и начинаем подготовку.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ФОРМА */}
      <div className="cta-section" id="join">
        <div className="cta-in">
          <div>
            <h2>
              Хочешь тренироваться <span className="hl">осознанно</span> и с
              результатом?
            </h2>
            <p className="sub">
              Оставь заявку — познакомимся, обсудим твои цели и подберём формат
              работы. Присоединиться можно в любой момент. Стоимость{" "}
              {CLUB.priceMonthly} в месяц.
            </p>
          </div>
          <LeadForm />
        </div>
      </div>

      {/* FOOTER */}
      <footer>
        <div className="wrap">
          <div>© 2026 · Игорь Поцелуев · Беговой клуб</div>
          <div>
            <a href="#">Instagram</a> · <a href="#">Telegram</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
