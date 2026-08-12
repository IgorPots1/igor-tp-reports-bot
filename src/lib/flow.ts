// Данные текущего набора на беговой интенсив. Перед новым потоком поменять здесь.
//
// Числа мест здесь НЕТ намеренно: сколько осталось — считается по заявкам в базе
// (getSeatsLeft в src/features/intensive/repository.ts). Раньше seatsLeft правили
// руками, и оно расходилось с реальностью между правками.
export const FLOW = {
  number: 28, // номер потока: «28-й», «в 28-м потоке»
  startDate: "17 августа",
  price: "999 ₽",
  priceEur: "10 €",
};

// Сколько мест в потоке всего. Занятыми считаются заявки со статусами
// new и confirmed; cancelled место возвращает.
export const SEATS_TOTAL = 10;

// «27 потоков интенсива уже прошло»
export const pastFlows = FLOW.number - 1;

// «10 мест», «3 места», «1 место»
export function seatsWord(n: number): string {
  const mod100 = n % 100;
  const mod10 = n % 10;
  if (mod100 >= 11 && mod100 <= 14) return "мест";
  if (mod10 === 1) return "место";
  if (mod10 >= 2 && mod10 <= 4) return "места";
  return "мест";
}
