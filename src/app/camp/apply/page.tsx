import type { Metadata } from "next";

import ApplyForm from "./ApplyForm";
import "./apply.css";
import { jetbrains, onest } from "@/lib/fonts";

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
