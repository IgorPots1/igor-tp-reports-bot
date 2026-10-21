/**
 * Описание тренировки из её сегментов — одна реализация на генератор и
 * админку. Генератор (autoplanner-week.ts, renderDescription) зовёт её же:
 * редактор тренировки в админке пересобирает описание после правки текста или
 * минут шага, и две копии одного формата разошлись бы молча, а описание потом
 * разбирается обратно (verifyRoundTrip).
 */

export type DescribedSegment = {
  minutes: number;
  fastSec: number | null;
  slowSec: number | null;
  label: string;
  noPaceText?: string;
};

export const formatPace = (sec: number): string => {
  const m = Math.floor(sec / 60),
    s = Math.round(sec % 60);
  return s === 60 ? `${m + 1}:00` : `${m}:${String(s).padStart(2, "0")}`;
};

export function renderSegmentsDescription(segs: DescribedSegment[]): string {
  return (
    segs
      .map((s) => {
        const dur = `${s.minutes} ${s.minutes === 1 ? "минута" : s.minutes < 5 ? "минуты" : "минут"}`;
        if (s.fastSec != null && s.slowSec != null) return `${s.label}: ${dur} ${formatPace(s.fastSec)}–${formatPace(s.slowSec)}`;
        return `${s.label}: ${dur} ${s.noPaceText ?? "по ощущениям"}`;
      })
      .join(". ") + "."
  );
}
