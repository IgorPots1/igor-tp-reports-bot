import type {
  BillingNutritionBillingMode,
  BillingPaymentStatus,
} from "@/features/billing/types";

// На строке месяца два слота денег. До появления питания отдельным платежом слот был
// один, и первый пришедший платёж закрывал месяц целиком — так у Хади июль оказался
// помечен paid, будучи подкреплён только питанием 2000 из ожидаемых 5000 базы.
export type BillingPaymentSlot = "base" | "nutrition";

// Куда садится платёж. Сумма должна совпасть с ожиданием слота ТОЧНО — это тот же
// строгий гейт, что был раньше, просто теперь ожиданий два.
//
// Разметки по номиналу нет и быть не должно: слот питания открыт ТОЛЬКО клиенту,
// которому явно выставлен mode='separate'. У Абрамова mode='none', и его платёж 2000
// (доплата за полтора месяца базы) сюда не попадёт.
export function resolvePaymentSlot(input: {
  amount: number;
  monthlyAmount: number;
  nutritionBillingMode: BillingNutritionBillingMode;
  nutritionAmount: number | null;
}): BillingPaymentSlot | null {
  const matchesBase = input.amount === input.monthlyAmount;
  const matchesNutrition =
    input.nutritionBillingMode === "separate" &&
    input.nutritionAmount != null &&
    input.amount === input.nutritionAmount;

  // База и питание совпали по сумме — по деньгам их не различить, это ручной разбор.
  if (matchesBase && matchesNutrition) {
    return null;
  }
  if (matchesBase) {
    return "base";
  }
  if (matchesNutrition) {
    return "nutrition";
  }
  return null;
}

// Открыт ли КОНКРЕТНЫЙ слот. Раньше проверка была на строку целиком, и при
// mode='separate' она ломалась на втором платеже месяца: база заполняла слот и
// проставляла хеш, а питание после этого отбивалось.
//
// partial НЕ блокирует ничего: месяц становится partial ровно потому, что второй
// платёж ещё не пришёл. Блокировать им приём второго платежа — замкнуть круг.
export function isSlotOpen(input: {
  slot: BillingPaymentSlot;
  status: BillingPaymentStatus;
  paidAmount: number | null;
  externalPaymentHash: string | null;
  nutritionPaidAmount: number | null;
}): boolean {
  // Возврат — всегда ручной разбор, ни один слот не открыт.
  if (input.status === "refunded") {
    return false;
  }

  if (input.slot === "base") {
    return input.externalPaymentHash == null && (input.paidAmount == null || input.paidAmount === 0);
  }

  return input.nutritionPaidAmount == null || input.nutritionPaidAmount === 0;
}

// paid означает «пришло всё, что ожидалось», а не «что-то пришло». Иначе месяц
// закрывается первым же платежом и недобор становится невидимым: все четыре
// агрегата долга смотрят на статус, а не на суммы.
export function computeBillingRowStatusAfterPayment(input: {
  plannedAmount: number;
  paidAmount: number | null;
  nutritionPlannedAmount: number | null;
  nutritionPaidAmount: number | null;
}): "paid" | "partial" {
  const expected = input.plannedAmount + (input.nutritionPlannedAmount ?? 0);
  const received = (input.paidAmount ?? 0) + (input.nutritionPaidAmount ?? 0);
  return received >= expected ? "paid" : "partial";
}

// Выбор слота при ручной привязке. Обе стороны, а не одна:
//   separate + слот не назван     -> молчаливый дефолт base это поломка Хади;
//   НЕ separate + слот 'nutrition' -> у такого клиента слота питания не существует.
// Второе — то же правило, что «2000 не означает питание автоматически», с другого конца.
export function validateSlotChoice(input: {
  nutritionBillingMode: BillingNutritionBillingMode;
  slot: BillingPaymentSlot | undefined;
  nutritionPlannedAmount: number | null;
}): { ok: true; slot: BillingPaymentSlot } | { ok: false; message: string } {
  const isSeparate = input.nutritionBillingMode === "separate";

  if (isSeparate && input.slot == null) {
    return {
      ok: false,
      message:
        "У этого клиента питание оплачивается отдельным платежом — укажи, в какой слот засчитать: база или питание.",
    };
  }

  if (!isSeparate && input.slot === "nutrition") {
    return {
      ok: false,
      message: "У этого клиента нет отдельного платежа за питание — засчитать в слот питания нельзя.",
    };
  }

  const slot: BillingPaymentSlot = input.slot ?? "base";

  if (slot === "nutrition" && input.nutritionPlannedAmount == null) {
    return { ok: false, message: "За этот месяц питание не начислено — засчитать в слот питания нельзя." };
  }

  return { ok: true, slot };
}
