/**
 * Цель сессии числами: полоса основной части и усилие.
 *
 * ПОЧЕМУ ОТДЕЛЬНЫЙ ФАЙЛ. Этим пользуются и генератор плана, и перегенерация.
 * Держать это в одном из них нельзя: оба они скрипты, которые при импорте
 * запускаются целиком (поймано дважды за сессию).
 */

/**
 * Полоса ОСНОВНОЙ ЧАСТИ, а не первого сегмента.
 *
 * ПОЙМАНО ЖИВЫМ ПРОГОНОМ: первым сегментом у качественной сессии идёт разминка,
 * и разница показывала «темповый бег 5:29–5:59» — темп разминки. Тренер увидел
 * бы, что порог ничего не изменил, хотя изменил всё. Берём самый быстрый
 * сегмент с темпом: у лёгкой он единственный, у качественной это работа.
 */
export function workBand(segments: Array<{ fastSec: number | null; slowSec: number | null }>): {
  fastSec: number | null;
  slowSec: number | null;
} {
  let best: { fastSec: number; slowSec: number } | null = null;
  for (const segment of segments) {
    if (segment.fastSec === null || segment.slowSec === null) continue;
    if (best === null || segment.fastSec < best.fastSec) {
      best = { fastSec: segment.fastSec, slowSec: segment.slowSec };
    }
  }
  return { fastSec: best?.fastSec ?? null, slowSec: best?.slowSec ?? null };
}

/**
 * Полосы и усилие из ГОТОВОГО ОПИСАНИЯ.
 *
 * ЗАЧЕМ РАЗБОР ТЕКСТА. Колонки pace_fast_s / pace_slow_s / rpe в таблице есть,
 * но до сегодня в них никто не писал: числа жили только внутри описания.
 * Значит у планов, выданных РАНЬШЕ этой правки, сравнивать нечего, и разница
 * показывала бы «цели нет» там, где цель была. Описание порождаем мы сами и
 * формат его знаем, поэтому разбор здесь надёжен ровно настолько, насколько
 * надёжен наш же отрисовщик.
 *
 * Новые планы пишут числа в колонки, и этот запасной путь для них не нужен.
 */
export function parseTargetFromDescription(description: string): {
  fastSec: number | null;
  slowSec: number | null;
  rpe: number | null;
} {
  const bands: Array<{ fastSec: number; slowSec: number }> = [];
  const re = /(\d{1,2}):(\d{2})\s*[\u2013\u2014-]\s*(\d{1,2}):(\d{2})/gu;
  let match: RegExpExecArray | null;
  while ((match = re.exec(description)) !== null) {
    bands.push({
      fastSec: Number(match[1]) * 60 + Number(match[2]),
      slowSec: Number(match[3]) * 60 + Number(match[4]),
    });
  }
  const fastest = bands.sort((a, b) => a.fastSec - b.fastSec)[0] ?? null;
  const effort = description.match(/усилие\s+(\d+(?:[.,]\d)?)\s+из\s+10/u);
  return {
    fastSec: fastest?.fastSec ?? null,
    slowSec: fastest?.slowSec ?? null,
    rpe: effort ? Number(effort[1].replace(",", ".")) : null,
  };
}

/**
 * Граница, с которой перегенерация имеет право переписывать: ближайший
 * понедельник ПОСЛЕ текущей недели.
 *
 * ПОЧЕМУ НЕ «С ЗАВТРА». Человек смотрит план неделей: он уже знает, что у него
 * в пятницу, и мог под это подстроить рабочий график. Менять середину недели,
 * которую он уже увидел, значит отнять у него возможность планировать. Неделя
 * целая или не трогается вовсе.
 */
export function nextMonday(todayIso: string): string {
  const date = new Date(`${todayIso}T00:00:00Z`);
  const weekday = (date.getUTCDay() + 6) % 7; // 0 = понедельник
  const shifted = new Date(date.getTime() + (7 - weekday) * 86_400_000);
  return shifted.toISOString().slice(0, 10);
}
