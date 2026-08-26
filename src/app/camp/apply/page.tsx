import type { Metadata } from "next";
import { Onest, JetBrains_Mono } from "next/font/google";

import ApplyForm from "./ApplyForm";
import "./apply.css";

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

export const metadata: Metadata = {
  title: "Анкета участника · Беговой интенсив",
  description:
    "Анкета участника бегового интенсива: базовые данные, здоровье, опыт, цель и расписание.",
  robots: { index: false, follow: false },
};

export default function ApplyPage() {
  return (
    <div className={`apply-root ${onest.variable} ${jetbrains.variable}`}>
      <ApplyForm />
    </div>
  );
}
