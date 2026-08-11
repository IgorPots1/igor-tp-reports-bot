// Данные текущего набора на беговой интенсив. Перед новым потоком поменять здесь.
export const FLOW = {
  number: 28, // номер потока: «28-й», «в 28-м потоке»
  startDate: "17 августа",
  seatsTotal: 10, // мест в потоке («Всего 10 мест»)
  seatsLeft: 10, // сколько осталось
  price: "999 ₽",
  priceEur: "10 €",
};

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
