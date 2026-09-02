/**
 * Проверка правил конвейера — сверки источников (раздел 4) и порогов уровней
 * (раздел 6). Сети не требует: правила проверяются на заданных входах.
 *
 *   npx tsx tools/shoes-pipeline/check-pipeline-rules.ts
 */
import { DIVERGENCE_LIMIT_PCT, reconcileNumber, type Observation } from "./lib/reconcile";
import { thresholdsFromPrices, tierHistogram, tierOf } from "./lib/tiers";

let failures = 0;
const check = (cond: boolean, msg: string) => {
  console.log(`  ${cond ? "✓" : "✗"} ${msg}`);
  if (!cond) failures += 1;
};

const obs = (source: string, value: number, kind: "measured" | "declared" = "declared"): Observation => ({
  source,
  value,
  kind,
  evidence: `${source}: ${value}`,
});

console.log("=== Сверка источников ===");
{
  const r = reconcileNumber("weight_g", []);
  check(r.status === "no_source", "нет источника — поле в базу не идёт");
}
{
  const r = reconcileNumber("weight_g", [obs("rtings", 255)]);
  check(r.status === "single_source", "один источник — мало, нужен второй");
}
{
  const r = reconcileNumber("weight_g", [obs("rtings", 255), obs("brand", 258)]);
  check(r.status === "ok", "два сошедшихся источника — значение принято");
  check(r.status === "ok" && r.sources.length === 2, "в записи остались оба источника");
}
{
  // 39 и 45 расходятся на 15,4 % — усреднять нельзя.
  const r = reconcileNumber("stack_heel_mm", [obs("brand", 39), obs("rtings", 45, "measured")]);
  check(r.status === "divergent", `расхождение больше ${DIVERGENCE_LIMIT_PCT} % — в отчёт, не усредняем`);
  check(
    r.status === "divergent" && !JSON.stringify(r).includes('"value":42'),
    "среднее 42 нигде не появилось — числа, которого нет в источниках, не возникает"
  );
}
{
  // Замер важнее заявленного там, где они сошлись.
  const r = reconcileNumber("drop_mm", [obs("brand", 8), obs("rtings", 8.6, "measured")]);
  check(r.status === "ok" && r.value === 8.6, "при согласии берётся измеренное, а не заявленное");
}

console.log("\n=== Пороги уровней по распределению ===");
{
  // Цены с перекосом в дорогую сторону — ровно то, на чём пороги «на глаз» врут.
  const eu = [110, 120, 125, 130, 140, 145, 150, 150, 155, 160, 165, 170, 180, 185, 190, 200, 220, 250, 275, 290, 300];
  const t = thresholdsFromPrices(eu, 5);
  const hist = tierHistogram(eu, t);
  console.log(`  пороги: low ≤ ${t.low} €, mid ≤ ${t.mid} €, дальше top`);
  console.log(`  корзины: ${JSON.stringify(hist)}`);
  check(t.low < t.mid, "нижний порог ниже верхнего");
  check(hist.low > 0 && hist.mid > 0 && hist.top > 0, "ни одна корзина не пустая");
  const total = hist.low + hist.mid + hist.top;
  check(total === eu.length, "все модели разложены по уровням");
  const smallest = Math.min(hist.low, hist.mid, hist.top);
  check(smallest >= Math.floor(eu.length / 6), `самая маленькая корзина не вырождена (${smallest} из ${total})`);
}
{
  // Пороги из наряда на том же распределении — показываем, насколько они мимо.
  const eu = [110, 120, 125, 130, 140, 145, 150, 150, 155, 160, 165, 170, 180, 185, 190, 200, 220, 250, 275, 290, 300];
  const naryad = { low: 125, mid: 199 };
  const histNaryad = tierHistogram(eu, naryad);
  console.log(`  для сравнения, пороги из наряда (125/199): ${JSON.stringify(histNaryad)}`);
  check(true, "распределение по порогам наряда посчитано для сравнения");
}
{
  const ru = [9900, 10500, 10900, 12900, 13500, 14200, 14500, 14900, 15200, 15900, 16500, 17500, 17900, 18900, 22900, 27900, 29500, 29900, 31500];
  const t = thresholdsFromPrices(ru, 500);
  const hist = tierHistogram(ru, t);
  console.log(`  пороги: low ≤ ${t.low} ₽, mid ≤ ${t.mid} ₽, дальше top`);
  console.log(`  корзины: ${JSON.stringify(hist)}`);
  check(hist.low > 0 && hist.mid > 0 && hist.top > 0, "ни одна корзина не пустая (Россия)");
  check(tierOf(9900, t) === "low" && tierOf(31500, t) === "top", "края распределения попали в крайние уровни");
}

console.log(failures ? `\nПРОВАЛ: ${failures}` : "\nОК");
process.exit(failures ? 1 : 0);
