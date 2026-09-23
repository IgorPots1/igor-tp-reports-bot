import Link from "next/link";

import styles from "./SiteHeader.module.css";

export default function SiteHeader() {
  return (
    <header className={styles.header}>
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
