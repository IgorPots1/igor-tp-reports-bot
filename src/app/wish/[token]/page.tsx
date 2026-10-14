import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";

import { resolveWishToken } from "@/features/gift-wishlist/repository";
import { montserrat, onest } from "@/lib/fonts";

import WishList from "./WishList";
import styles from "./wish.module.css";

// Личная страница по секретной ссылке: не индексируется и не отдаёт адрес
// (с токеном) магазинам в Referer, когда она открывает ссылку на товар.
export const metadata: Metadata = {
  title: "Хочу в подарок",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#fbf5f8",
};

export const dynamic = "force-dynamic";

export default async function WishPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const access = await resolveWishToken(token).catch(() => null);
  if (!access) notFound();

  return (
    <div className={`${onest.variable} ${montserrat.variable} ${styles.page}`}>
      <WishList token={token} role={access.role} title={access.title} />
    </div>
  );
}
