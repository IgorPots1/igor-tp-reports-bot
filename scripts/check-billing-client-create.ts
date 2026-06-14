import { normalizeBillingClientCreateInput } from "@/features/billing/service";
import type { BillingClientCreateInput } from "@/features/billing/types";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function expectThrows(input: BillingClientCreateInput, label: string): void {
  let threw = false;
  try {
    normalizeBillingClientCreateInput(input);
  } catch {
    threw = true;
  }
  assert(threw, `Должно бросить ошибку: ${label}`);
}

const base: BillingClientCreateInput = {
  clientName: "Иван Петров",
  monthlyAmount: 5000,
  currency: "RUB",
  paymentMethod: "tbank_link_a",
};

// 1. Валидный вход нормализуется.
{
  const out = normalizeBillingClientCreateInput({
    ...base,
    clientName: "  Иван Петров  ",
    groupName: "  Основная  ",
    plannedPaymentDay: 5,
    studentId: "  abc  ",
    notes: "  заметка  ",
  });
  assert(out.clientName === "Иван Петров", "имя должно триммиться");
  assert(out.groupName === "Основная", "группа должна триммиться");
  assert(out.studentId === "abc", "studentId должен триммиться");
  assert(out.notes === "заметка", "заметка должна триммиться");
  assert(out.plannedPaymentDay === 5, "день оплаты сохраняется");
  assert(out.monthlyAmount === 5000 && out.currency === "RUB", "сумма/валюта сохраняются");
}

// 2. Пустые опциональные поля → null.
{
  const out = normalizeBillingClientCreateInput({ ...base, groupName: "  ", notes: "", studentId: "" });
  assert(out.groupName === null && out.notes === null && out.studentId === null, "пустые опциональные → null");
  assert(out.plannedPaymentDay === null, "день оплаты по умолчанию null");
}

// 3. EUR и OTHER допустимы.
{
  assert(normalizeBillingClientCreateInput({ ...base, currency: "EUR", paymentMethod: "manual_eur" }).currency === "EUR", "EUR ок");
  assert(normalizeBillingClientCreateInput({ ...base, currency: "OTHER", paymentMethod: "manual_other" }).currency === "OTHER", "OTHER ок");
}

// 4. Невалидные входы.
expectThrows({ ...base, clientName: "   " }, "пустое имя");
expectThrows({ ...base, monthlyAmount: 0 }, "сумма 0");
expectThrows({ ...base, monthlyAmount: -100 }, "отрицательная сумма");
expectThrows({ ...base, monthlyAmount: 1000.5 }, "нецелая сумма");
expectThrows({ ...base, currency: "USD" as BillingClientCreateInput["currency"] }, "неизвестная валюта");
expectThrows({ ...base, paymentMethod: "paypal" }, "неизвестный метод оплаты");
expectThrows({ ...base, plannedPaymentDay: 0 }, "день 0");
expectThrows({ ...base, plannedPaymentDay: 32 }, "день 32");
expectThrows({ ...base, plannedPaymentDay: 5.5 }, "нецелый день");

console.log("check-billing-client-create: ok");
