import {
  normalizeNameToLatinTokens,
  scoreBillingNameMatch,
} from "@/features/billing/name-matching";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

// Реальные пары из ростера: клиент (кириллица) ↔ ученик TP (латиница).
const TRUE_PAIRS: Array<{ client: string; student: string }> = [
  { client: "Аня Лободина", student: "Anna Lobodina" },
  { client: "Лена Васильева", student: "Elena Vasileva" },
  { client: "Даша Хмельникова", student: "Darya Khmelkova" },
  { client: "Филипп Красавин", student: "Filip Krasavin" },
  { client: "Александр Иванов", student: "Alexander Ivanov" },
  { client: "Олеся Воронина", student: "Olesya Voronina" },
  { client: "Настя Холодная", student: "Nastya Holodnaya" },
];

const SUGGESTION_THRESHOLD = 45;

// 1) Каждая истинная пара должна давать заметный score.
for (const pair of TRUE_PAIRS) {
  const { score } = scoreBillingNameMatch(pair.client, pair.student);
  assert(
    score >= SUGGESTION_THRESHOLD,
    `Пара должна сопоставляться: "${pair.client}" ↔ "${pair.student}" (score=${score})`
  );
}

// 2) Явно разные люди — низкий score.
{
  const { score } = scoreBillingNameMatch("Александр Иванов", "Anna Lobodina");
  assert(score < SUGGESTION_THRESHOLD, `Разные люди не должны сопоставляться (score=${score})`);
}

// 3) Верный ученик выигрывает среди похожих кандидатов (ранжирование).
{
  const client = "Даша Хмельникова";
  const candidates = ["Irina Melnikova", "Darya Khmelkova", "Anna Lobodina", "Alexander Ivanov"];
  const ranked = candidates
    .map((student) => ({ student, score: scoreBillingNameMatch(client, student).score }))
    .sort((a, b) => b.score - a.score);
  assert(
    ranked[0].student === "Darya Khmelkova",
    `Верный ученик должен быть первым для "${client}", получили: ${JSON.stringify(ranked)}`
  );
}

// 4) Полное совпадение (с транслитерацией) даёт максимум.
{
  const { score } = scoreBillingNameMatch("Аня Лободина", "Anna Lobodina");
  assert(score === 100, `Полное совпадение должно быть 100 (score=${score})`);
}

// 5) Транслитерация токенов корректна.
{
  const tokens = normalizeNameToLatinTokens("Александр Иванов");
  assert(tokens.includes("ivanov"), `Иванов → ivanov, получили ${JSON.stringify(tokens)}`);
}

// 6) Уменьшительное раскрывается: Аня → анна → anna.
{
  const tokens = normalizeNameToLatinTokens("Аня");
  assert(tokens.includes("anna"), `Аня → anna, получили ${JSON.stringify(tokens)}`);
}

console.log("check-billing-name-matching: ok");
