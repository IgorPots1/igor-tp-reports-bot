/* Подвал календаря, страниц стартов и разборов трасс (наряд 20.10.2026): запрет копирования и
 * автоматического сбора. Тот же текст — в заголовке X-Copyright ответов /api/races/*. */

import { COPYRIGHT_TEXT } from "@/features/race-guard/guard";

import styles from "./races.module.css";

export default function RacesFooter() {
  return <footer className={styles.copyright}>{COPYRIGHT_TEXT}</footer>;
}
