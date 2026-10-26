import styles from "./ConsultNotice.module.css";

/* English version of ConsultNotice for the English tools (/tools/en/*) and the
 * @runnigor audience. Same look, but the button opens Igor's WhatsApp instead of
 * Telegram: the international audience doesn't use Telegram much.
 *
 * The prefilled text is the source label: Igor sees from the first message that
 * the person came from the free English tools. A tool can pass its own prefill. */

import type { ConsultTool } from "@/features/consult-clicks/record";
import { CONSULT_PREFILL_DEFAULT_EN } from "@/features/consult-clicks/record";

/* Click tracking (26.10.2026): the button goes through /go/consult, which records
 * the click in consult_clicks with the tool name and then redirects to WhatsApp with
 * the same prefill. Every English tool must pass its own en-* tool. */

export const CONSULT_PREFILL_EN = CONSULT_PREFILL_DEFAULT_EN;
export const CONSULT_TITLE_EN = "Want a plan built for you, not just numbers?";
export const CONSULT_TEXT_EN =
  "Book a free consultation: we'll look at your running, your goal and what holds you back.";
export const CONSULT_BUTTON_EN = "Book a free consultation";

export function consultLinkEn(tool: ConsultTool, prefill: string = CONSULT_PREFILL_EN): string {
  return `/go/consult?tool=${encodeURIComponent(tool)}&text=${encodeURIComponent(prefill)}`;
}

export default function ConsultNoticeEn({ tool, prefill }: { tool: ConsultTool; prefill?: string }) {
  return (
    <aside className={styles.notice} lang="en">
      <p className={styles.title}>{CONSULT_TITLE_EN}</p>
      <p className={styles.text}>{CONSULT_TEXT_EN}</p>
      <a
        href={consultLinkEn(tool, prefill)}
        target="_blank"
        rel="noopener noreferrer"
        className={styles.button}
      >
        {CONSULT_BUTTON_EN}
      </a>
    </aside>
  );
}
