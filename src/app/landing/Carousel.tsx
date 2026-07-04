"use client";
import { useRef } from "react";

interface CarouselProps {
  children: React.ReactNode;
  trackClassName: string;
}

export default function Carousel({ children, trackClassName }: CarouselProps) {
  const trackRef = useRef<HTMLDivElement>(null);

  function scroll(dir: number) {
    const track = trackRef.current;
    if (!track) return;
    const card = track.querySelector<HTMLElement>(".slide");
    const step = card ? card.offsetWidth + 16 : 320;
    track.scrollBy({ left: step * dir, behavior: "smooth" });
  }

  return (
    <div className="caro">
      <div className={`track ${trackClassName}`} ref={trackRef}>
        {children}
      </div>
      <div className="swipe-hint">← листай вбок →</div>
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
