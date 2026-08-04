// Нормализация телефона плательщика из выписки эквайринга.
//
// Форматы, реально встречающиеся в источнике: «9043719408», «79032324456»,
// «+7(904)***-**-08». Третий — это МАСКА КАРТЫ, а не телефон, и импортировать её нельзя.

export function normalizeBillingPhone(raw: string | null | undefined): string | null {
  if (!raw) {
    return null;
  }

  // Маскированное значение — маска карты в выписке, а не телефон.
  if (raw.includes("*")) {
    return null;
  }

  const digits = raw.replace(/\D/g, "");
  // 11 цифр с кодом страны 7/8 — отбрасываем код.
  const local =
    digits.length === 11 && (digits[0] === "7" || digits[0] === "8") ? digits.slice(1) : digits;

  if (local.length !== 10) {
    return null;
  }

  // Российский мобильный всегда начинается с 9. Всё прочее — опечатка или не телефон.
  // Это правило само отсеивает уже пойманные в выписке «8268883793» и «6026866474»
  // (последнее — опечатка в номере Трофимова), и не даёт мусорным ключам попасть
  // в пространство identity.
  if (local[0] !== "9") {
    return null;
  }

  return local;
}

// В display_hint кладём маску, а не значение: читаемых телефонов и почт в таблице
// identity лежать не должно. Матч идёт по хешу, маска нужна только тренеру для опознания.
export function maskBillingPhone(local: string): string {
  return `+7•••${local.slice(3, 6)}••${local.slice(8)}`;
}

export function maskBillingEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) {
    return "•••";
  }

  const name = email.slice(0, at);
  const domain = email.slice(at);
  const head = name.slice(0, Math.min(2, name.length));
  return `${head}•••${domain}`;
}
