import Link from "next/link";

import styles from "./SiteHeader.module.css";
import HtmlLang from "@/app/coaching/HtmlLang";

// English header for the English tools: the brand leads to /links (the English
// link-in-bio page), "Free guides" to its free materials tab. It also switches
// <html lang> to "en" so the browser doesn't offer to translate from Russian.
export default function SiteHeaderEn() {
  return (
    <header className={styles.header}>
      <HtmlLang lang="en" />
      <Link href="/links" className={styles.brand}>
        igorp.run
      </Link>
      <nav aria-label="Main navigation">
        <a href="/links#free" className={styles.navLink}>
          Free guides
        </a>
      </nav>
    </header>
  );
}
