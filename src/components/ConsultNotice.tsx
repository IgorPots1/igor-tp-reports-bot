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
 * ССЫЛКА — ЛИЧНЫЙ TELEGRAM БЕЗ ЗАГОТОВЛЕННОГО ТЕКСТА. На хабе у карточки
 * «Написать мне» в адрес зашито «Хочу записаться на беговой интенсив», и для
 * блока про БЕСПЛАТНУЮ КОНСУЛЬТАЦИЮ такая заготовка врала бы: человек нажимает
 * «Записаться» под словом «консультация», а в окне у него интенсив. Голый адрес
 * — ровно то, что уже стояло в прежних блоках plan, nutrition и shoes. */

export const CONSULT_LINK = "https://t.me/IgorPotseluev";
export const CONSULT_TITLE = "Хочешь не просто цифры, а план под себя?";
export const CONSULT_TEXT =
  "Бесплатная консультация: разберём твой бег, цель и что мешает прогрессу.";
export const CONSULT_BUTTON = "Записаться";

export default function ConsultNotice() {
  return (
    <aside className={styles.notice}>
      <p className={styles.title}>{CONSULT_TITLE}</p>
      <p className={styles.text}>{CONSULT_TEXT}</p>
      <a
        href={CONSULT_LINK}
        target="_blank"
        rel="noopener noreferrer"
        className={styles.button}
      >
        {CONSULT_BUTTON}
      </a>
    </aside>
  );
}
