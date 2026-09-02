// Фолбэк-константы на случай, если intensive_flow_config недоступна — база
// упала или сеть моргнула. Основной источник данных потока теперь БАЗА
// (таблица public.intensive_flow_config, читает getFlowConfig в
// src/features/intensive/repository.ts), а тренер меняет её формой в
// /admin/intensive, без правки кода и деплоя.
//
// Эти константы держим на последнем известном боевом состоянии и обновляем
// редко — они подстраховка, а не основной канал. Здесь только чистые
// значения и форматирование, без обращений к базе: модуль импортируют и
// клиентские компоненты, и Supabase-клиент в нём быть не должен (см. границу
// в repository.ts).
export const FLOW = {
  number: 29, // номер потока: «29-й», «в 29-м потоке»
  startDateIso: "2026-08-31",
  price: "999 ₽",
  priceEur: "10 €",
};

// Сколько мест в потоке всего. Занятыми считаются заявки со статусами
// new и confirmed; cancelled и waitlist место возвращают/не занимают.
export const SEATS_TOTAL = 10;

// «сколько потоков уже прошло» — от НОМЕРА ТЕКУЩЕГО потока, а не от FLOW.number
// напрямую: номер приходит из базы и меняется без деплоя, а константа читалась
// бы один раз при сборке и быстро разошлась бы с реальностью. Раньше это было
// готовое число pastFlows = FLOW.number - 1; убрано именно поэтому.
export function pastFlowsCount(currentFlowNumber: number): number {
  return currentFlowNumber - 1;
}

// «10 мест», «3 места», «1 место»
export function seatsWord(n: number): string {
  const mod100 = n % 100;
  const mod10 = n % 10;
  if (mod100 >= 11 && mod100 <= 14) return "мест";
  if (mod10 === 1) return "место";
  if (mod10 >= 2 && mod10 <= 4) return "места";
  return "мест";
}

/**
 * ISO-дата («2026-09-11») → человекочитаемый русский вид («11 сентября»).
 *
 * Дата в базе хранится как date, без названия месяца — грамматику собираем
 * здесь. Разбираем строку вручную и форматируем в UTC: голая ISO-дата без
 * времени в одних раннерах трактуется как локальная полночь, в других как
 * полночь UTC, и в нероссийских таймзонах «11 сентября» рискует стать
 * «10 сентября». Собирая дату и форматируя её в одном и том же UTC, эту
 * гонку убираем целиком.
 */
export function formatFlowStartDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(date);
}
