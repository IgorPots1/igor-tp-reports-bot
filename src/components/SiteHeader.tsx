import Link from "next/link";

import styles from "./SiteHeader.module.css";

type SiteHeaderProps = {
  /** cream — хаб, /club-footer, /tools/*; dark — /tools/plan и /tools/nutrition
   *  (свой брендинг zinc-950 + yellow-400, без общих токенов). */
  theme?: "cream" | "dark";
};

export default function SiteHeader({ theme = "cream" }: SiteHeaderProps) {
  return (
    <header className={`${styles.header} ${theme === "dark" ? styles.dark : styles.cream}`}>
      <Link href="/" className={styles.brand}>
        igorp.run
      </Link>
      <nav aria-label="Основная навигация">
        <a href="/tools" className={styles.navLink}>
          Калькуляторы
        </a>
      </nav>
    </header>
  );
}
