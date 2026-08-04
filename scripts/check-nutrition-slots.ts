import {
  computeBillingRowStatusAfterPayment,
  isSlotOpen,
  resolvePaymentSlot,
  validateSlotChoice,
} from "@/features/billing/nutrition-slots";
import type { BillingPaymentStatus } from "@/features/billing/types";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

// Клиент с питанием отдельным платежом: база 5000, питание 2000 (случай Хади).
const SEPARATE = {
  monthlyAmount: 5000,
  nutritionBillingMode: "separate" as const,
  nutritionAmount: 2000,
};

// Клиент без питания: 6000 — это полный тариф, разбивки нет (случай Абрамова,
// у которого 2000 были доплатой за полтора месяца базы).
const NONE = {
  monthlyAmount: 4000,
  nutritionBillingMode: "none" as const,
  nutritionAmount: null,
};

// ---------------------------------------------------------------------------
// 1) ОСНОВНОЙ СЦЕНАРИЙ: приходит база, потом питание — оба должны сесть,
//    месяц стать paid. Именно он ломался до послотового гейта: база проставляла
//    хеш, и питание отбивалось как «строка занята».
// ---------------------------------------------------------------------------
{
  // Стартовое состояние строки месяца: ничего не пришло.
  let row = {
    plannedAmount: 5000,
    paidAmount: null as number | null,
    nutritionPlannedAmount: 2000 as number | null,
    nutritionPaidAmount: null as number | null,
    externalPaymentHash: null as string | null,
    status: "pending" as BillingPaymentStatus,
  };

  // --- платёж 1: база 5000
  const slotBase = resolvePaymentSlot({ amount: 5000, ...SEPARATE });
  assert(slotBase === "base", `База должна адресоваться в базовый слот, получено ${slotBase}`);
  assert(
    isSlotOpen({
      slot: "base",
      status: row.status,
      paidAmount: row.paidAmount,
      externalPaymentHash: row.externalPaymentHash,
      nutritionPaidAmount: row.nutritionPaidAmount,
    }),
    "Базовый слот должен быть открыт до первого платежа"
  );

  row = { ...row, paidAmount: 5000, externalPaymentHash: "hash-base" };
  const statusAfterBase = computeBillingRowStatusAfterPayment(row);
  assert(
    statusAfterBase === "partial",
    `После одной базы месяц обязан быть partial, а не ${statusAfterBase}: питание ещё не пришло`
  );
  row = { ...row, status: statusAfterBase };

  // --- платёж 2: питание 2000. Вот здесь всё и ломалось.
  const slotNutrition = resolvePaymentSlot({ amount: 2000, ...SEPARATE });
  assert(slotNutrition === "nutrition", `Питание должно адресоваться в свой слот, получено ${slotNutrition}`);
  assert(
    isSlotOpen({
      slot: "nutrition",
      status: row.status,
      paidAmount: row.paidAmount,
      externalPaymentHash: row.externalPaymentHash,
      nutritionPaidAmount: row.nutritionPaidAmount,
    }),
    "Слот питания обязан быть открыт, хотя базовый уже занят и на строке стоит хеш"
  );
  assert(
    !isSlotOpen({
      slot: "base",
      status: row.status,
      paidAmount: row.paidAmount,
      externalPaymentHash: row.externalPaymentHash,
      nutritionPaidAmount: row.nutritionPaidAmount,
    }),
    "Базовый слот после базы обязан быть закрыт"
  );

  row = { ...row, nutritionPaidAmount: 2000 };
  const statusAfterNutrition = computeBillingRowStatusAfterPayment(row);
  assert(
    statusAfterNutrition === "paid",
    `После базы и питания месяц обязан стать paid, получено ${statusAfterNutrition}`
  );
}

// ---------------------------------------------------------------------------
// 2) ОБРАТНЫЙ ПОРЯДОК: сначала питание, потом база (реальный случай Хади —
//    питание 06.07, база 16.07). Итог обязан быть тот же.
// ---------------------------------------------------------------------------
{
  let row = {
    plannedAmount: 5000,
    paidAmount: null as number | null,
    nutritionPlannedAmount: 2000 as number | null,
    nutritionPaidAmount: null as number | null,
    externalPaymentHash: null as string | null,
    status: "pending" as BillingPaymentStatus,
  };

  row = { ...row, nutritionPaidAmount: 2000 };
  const afterNutrition = computeBillingRowStatusAfterPayment(row);
  assert(
    afterNutrition === "partial",
    `Одно питание не закрывает месяц: ожидался partial, получено ${afterNutrition}`
  );
  row = { ...row, status: afterNutrition };

  // partial НЕ должен блокировать приём второго платежа — иначе тупик:
  // месяц partial именно потому, что второй платёж не пришёл.
  assert(
    isSlotOpen({
      slot: "base",
      status: row.status,
      paidAmount: row.paidAmount,
      externalPaymentHash: row.externalPaymentHash,
      nutritionPaidAmount: row.nutritionPaidAmount,
    }),
    "partial не должен блокировать базовый слот — иначе месяц не закрыть никогда"
  );

  row = { ...row, paidAmount: 5000, externalPaymentHash: "hash-base" };
  assert(
    computeBillingRowStatusAfterPayment(row) === "paid",
    "После питания и базы месяц обязан стать paid"
  );
}

// ---------------------------------------------------------------------------
// 3) НЕГАТИВНЫЙ СЛУЧАЙ: клиент без питания, платёж 2000 — никуда не садится.
//    Разметка по номиналу запрещена: 2000 у такого клиента может быть чем угодно.
// ---------------------------------------------------------------------------
{
  const slot = resolvePaymentSlot({ amount: 2000, ...NONE });
  assert(
    slot === null,
    `Клиенту без питания платёж 2000 садиться не должен (это уйдёт в skipped_amount_mismatch), получено ${slot}`
  );

  // И его же полная сумма по-прежнему садится в базу.
  assert(resolvePaymentSlot({ amount: 4000, ...NONE }) === "base", "Полная сумма обязана садиться в базу");
}

// ---------------------------------------------------------------------------
// 4) КРАЕВЫЕ СЛУЧАИ
// ---------------------------------------------------------------------------
{
  // Режим included — питание внутри суммы, отдельного слота нет.
  assert(
    resolvePaymentSlot({
      amount: 1000,
      monthlyAmount: 6000,
      nutritionBillingMode: "included",
      nutritionAmount: 1000,
    }) === null,
    "При mode='included' питание отдельным платежом не принимается"
  );

  // База и питание совпали по сумме — по деньгам их не различить, ручной разбор.
  assert(
    resolvePaymentSlot({
      amount: 3000,
      monthlyAmount: 3000,
      nutritionBillingMode: "separate",
      nutritionAmount: 3000,
    }) === null,
    "Совпадение базы и питания по сумме обязано уходить в ручной разбор"
  );

  // Возврат — ни один слот не открыт.
  for (const slot of ["base", "nutrition"] as const) {
    assert(
      !isSlotOpen({
        slot,
        status: "refunded",
        paidAmount: null,
        externalPaymentHash: null,
        nutritionPaidAmount: null,
      }),
      `Слот ${slot} не должен приниматься при статусе refunded`
    );
  }

  // Переплата не должна делать месяц partial.
  assert(
    computeBillingRowStatusAfterPayment({
      plannedAmount: 5000,
      paidAmount: 6000,
      nutritionPlannedAmount: null,
      nutritionPaidAmount: null,
    }) === "paid",
    "Переплата обязана считаться paid"
  );

  // Клиент без питания: слота нет, статус считается только по базе.
  assert(
    computeBillingRowStatusAfterPayment({
      plannedAmount: 4000,
      paidAmount: 4000,
      nutritionPlannedAmount: null,
      nutritionPaidAmount: null,
    }) === "paid",
    "Без питания полная база обязана давать paid"
  );
}

// ---------------------------------------------------------------------------
// 5) ВЫБОР СЛОТА ПРИ РУЧНОЙ ПРИВЯЗКЕ — обе стороны, а не одна.
// ---------------------------------------------------------------------------
{
  // separate + слот не назван -> требуем явный выбор. Молчаливый дефолт base здесь
  // и есть поломка Хади: платёж питания закрыл базовый слот.
  const noSlot = validateSlotChoice({
    nutritionBillingMode: "separate",
    slot: undefined,
    nutritionPlannedAmount: 2000,
  });
  assert(!noSlot.ok, "У separate-клиента слот обязан требоваться явно");

  // ЗЕРКАЛЬНАЯ ошибка: у обычного клиента слота питания не существует.
  // nutritionPlannedAmount намеренно НЕ null, иначе срабатывала бы проверка
  // «питание не начислено» и маскировала бы отсутствие зеркального правила.
  const wrongSlot = validateSlotChoice({
    nutritionBillingMode: "none",
    slot: "nutrition",
    nutritionPlannedAmount: 2000,
  });
  assert(!wrongSlot.ok, "Обычному клиенту нельзя засчитать в слот питания");
  assert(
    !wrongSlot.ok && wrongSlot.message.includes("нет отдельного платежа за питание"),
    `Должно сработать ИМЕННО зеркальное правило, получено: ${!wrongSlot.ok ? wrongSlot.message : "ok"}`
  );

  const includedWrongSlot = validateSlotChoice({
    nutritionBillingMode: "included",
    slot: "nutrition",
    nutritionPlannedAmount: 2000,
  });
  assert(!includedWrongSlot.ok, "При mode='included' слота питания на строке нет");

  // Обычный клиент без слота — прежнее поведение байт-в-байт: молча base.
  const legacy = validateSlotChoice({
    nutritionBillingMode: "none",
    slot: undefined,
    nutritionPlannedAmount: null,
  });
  assert(legacy.ok && legacy.slot === "base", "Обычный клиент без слота обязан идти в базу как раньше");

  // separate + явный слот — проходит.
  for (const slot of ["base", "nutrition"] as const) {
    const chosen = validateSlotChoice({
      nutritionBillingMode: "separate",
      slot,
      nutritionPlannedAmount: 2000,
    });
    assert(chosen.ok && chosen.slot === slot, `Явный выбор ${slot} обязан проходить`);
  }

  // separate, но питание за месяц не начислено — класть некуда.
  const noPlan = validateSlotChoice({
    nutritionBillingMode: "separate",
    slot: "nutrition",
    nutritionPlannedAmount: null,
  });
  assert(!noPlan.ok, "Без начисленного питания слот питания принимать нельзя");
}

console.log("check-nutrition-slots: OK");
