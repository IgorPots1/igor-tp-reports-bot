"use client";
import { useRef } from "react";

interface CarouselProps {
  children: React.ReactNode;
  trackClassName: string;
  /** Подсказка под каруселью на телефоне. /coaching передаёт английскую. */
  hint?: string;
}

export default function Carousel({ children, trackClassName, hint = "← листай вбок →" }: CarouselProps) {
  const trackRef = useRef<HTMLDivElement>(null);

  function scroll(dir: number) {
    const track = trackRef.current;
    if (!track) return;
    const card = track.querySelector<HTMLElement>(".slide");
    const step = card ? card.offsetWidth + 16 : 320;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    track.scrollBy({ left: step * dir, behavior: reduce ? "auto" : "smooth" });
  }

  return (
    <div className="caro">
      <div className={`track ${trackClassName}`} ref={trackRef}>
        {children}
      </div>
      <div className="swipe-hint">{hint}</div>
      <div className="caro-nav">
        <button type="button" onClick={() => scroll(-1)}>
          ‹
        </button>
        <button type="button" onClick={() => scroll(1)}>
          ›
        </button>
      </div>
    </div>
  );
}
