import styles from "./ConsultNotice.module.css";

/* English version of ConsultNotice for the English tools (/tools/en/*) and the
 * @runnigor audience. Same look, but the button opens Igor's WhatsApp instead of
 * Telegram: the international audience doesn't use Telegram much.
 *
 * The prefilled text is the source label: Igor sees from the first message that
 * the person came from the free English tools. A tool can pass its own prefill. */

const CONSULT_WA = "https://wa.me/79157317090";

export const CONSULT_PREFILL_EN = "Hi Igor! I'd like a free consultation";
export const CONSULT_TITLE_EN = "Want a plan built for you, not just numbers?";
export const CONSULT_TEXT_EN =
  "Book a free consultation: we'll look at your running, your goal and what holds you back.";
export const CONSULT_BUTTON_EN = "Book a free consultation";

export function consultLinkEn(prefill: string = CONSULT_PREFILL_EN): string {
  return `${CONSULT_WA}?text=${encodeURIComponent(prefill)}`;
}

export default function ConsultNoticeEn({ prefill }: { prefill?: string }) {
  return (
    <aside className={styles.notice} lang="en">
      <p className={styles.title}>{CONSULT_TITLE_EN}</p>
      <p className={styles.text}>{CONSULT_TEXT_EN}</p>
      <a
        href={consultLinkEn(prefill)}
        target="_blank"
        rel="noopener noreferrer"
        className={styles.button}
      >
        {CONSULT_BUTTON_EN}
      </a>
    </aside>
  );
}
