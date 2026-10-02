import styles from "./ConsultNotice.module.css";

/* Предложение консультации под результатом инструмента.
 *
 * ОДНО МЕСТО НА ВЕСЬ САЙТ. До этого у трёх инструментов были свои блоки с
 * разным текстом и разными кнопками: «Записаться на консультацию» на /tools/plan,
 * «Написать мне в Telegram» на /tools/nutrition, «Получить разбор» на
 * /tools/shoes. Человек, прошедший два инструмента подряд, видел два разных
 * предложения, а правка формулировки означала обход всех файлов. Теперь текст и
 * ссылка меняются здесь и сразу везде.
 *
 * ЗАГОТОВКА В ССЫЛКЕ — ЭТО МЕТКА ИСТОЧНИКА, А НЕ УКРАШЕНИЕ. По тексту первого
 * сообщения тренер сразу видит, что человек пришёл с бесплатных инструментов, а
 * не с лендинга клуба или интенсива. Поэтому заготовка ровно про консультацию:
 * у карточки «Написать мне» на хабе зашито «Хочу записаться на беговой
 * интенсив», и здесь она врала бы человеку, который нажал «Записаться» под
 * словом «консультация».
 *
 * Инструмент может уточнить заготовку своим prefill: /tools/marathon называет
 * подготовку к марафону, и по первому же сообщению видно, откуда человек
 * пришёл. Без параметра берётся общая, которая не называет ни одного
 * инструмента. Кодирование для URL делает сам consultLink, вручную его писать
 * не надо. */

const CONSULT_TG = "https://t.me/IgorPotseluev";

/** Заготовка по умолчанию: годится любому инструменту, не называет ни одного. */
export const CONSULT_PREFILL = "Здравствуйте! Хочу на бесплатную консультацию по бегу";
export const CONSULT_TITLE = "Хочешь не просто цифры, а план под себя?";
export const CONSULT_TEXT =
  "Бесплатная консультация: разберём твой бег, цель и что мешает прогрессу.";
export const CONSULT_BUTTON = "Записаться";

export function consultLink(prefill: string = CONSULT_PREFILL): string {
  return `${CONSULT_TG}?text=${encodeURIComponent(prefill)}`;
}

export const CONSULT_LINK = consultLink();

export default function ConsultNotice({ prefill }: { prefill?: string }) {
  return (
    <aside className={styles.notice}>
      <p className={styles.title}>{CONSULT_TITLE}</p>
      <p className={styles.text}>{CONSULT_TEXT}</p>
      <a
        href={consultLink(prefill)}
        target="_blank"
        rel="noopener noreferrer"
        className={styles.button}
      >
        {CONSULT_BUTTON}
      </a>
    </aside>
  );
}
