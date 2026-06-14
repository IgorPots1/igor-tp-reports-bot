import { createHash } from "node:crypto";

import type { BillingImportedPayment } from "@/features/billing/types";

export const BILLING_PAYER_IDENTITY_TYPES = [
  "payer_hint",
  "description_hint",
  "payment_description",
] as const;

export type BillingPayerIdentityType = (typeof BILLING_PAYER_IDENTITY_TYPES)[number];

export type DerivedBillingPayerIdentity = {
  identityType: BillingPayerIdentityType;
  identityHash: string;
  displayHint: string | null;
};

const MAX_DISPLAY_HINT_LENGTH = 120;
const MIN_NORMALIZED_LENGTH = 4;

function normalizeForIdentity(raw: string | null): string {
  if (!raw) {
    return "";
  }

  return raw
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[_.,;:!?()[\]{}"'`~+=\\/|-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripSensitivePatterns(value: string): string {
  return value
    .replace(/\b(?:email|e-mail|mail|phone|tel|card|acct|account|iban|счет|сч[её]т|карта|телефон|почта)\b/gi, " ")
    .replace(/\S+@\S+/g, " ")
    .replace(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi, " ")
    .replace(/\+?\d[\d\s().-]{6,}\d/g, " ")
    .replace(/\b(?:\d[ -]?){12,19}\b/g, " ")
    .replace(/\b(?:[a-zа-я]{2}\d{2}[a-z0-9]{4,30})\b/gi, " ")
    .replace(/\b\d{10,}\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildDisplayHint(value: string): string | null {
  if (!value) {
    return null;
  }

  if (value.length <= MAX_DISPLAY_HINT_LENGTH) {
    return value;
  }

  return `${value.slice(0, MAX_DISPLAY_HINT_LENGTH - 3).trim()}...`;
}

function hasSensitiveNumericDensity(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  if (digits.length >= 10) {
    return true;
  }

  return /\b\d{4,}\b/.test(value);
}

function maybeBuildIdentity(
  identityType: BillingPayerIdentityType,
  source: string | null
): DerivedBillingPayerIdentity | null {
  const normalized = stripSensitivePatterns(normalizeForIdentity(source));
  if (normalized.length < MIN_NORMALIZED_LENGTH) {
    return null;
  }
  if (hasSensitiveNumericDensity(normalized)) {
    return null;
  }

  const identityHash = createHash("sha256").update(`${identityType}:${normalized}`, "utf8").digest("hex");
  const displayHint = buildDisplayHint(normalized);
  if (!displayHint) {
    return null;
  }

  return {
    identityType,
    identityHash,
    displayHint,
  };
}

export function derivePayerIdentitiesFromImportedPayment(
  imported: BillingImportedPayment
): DerivedBillingPayerIdentity[] {
  // Запоминаем/матчим плательщика ТОЛЬКО по имени (payer_hint). Описание из банка
  // (например, «Товар 1») generic и одинаково у разных людей — по нему нельзя
  // привязывать плательщика, иначе один платёж ложно «узнаётся» как другой клиент
  // (и может быть ошибочно авто-засчитан).
  const candidates = [maybeBuildIdentity("payer_hint", imported.payerHint)];

  const seen = new Set<string>();
  const result: DerivedBillingPayerIdentity[] = [];

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    const dedupeKey = `${candidate.identityType}:${candidate.identityHash}`;
    if (seen.has(dedupeKey)) {
      continue;
    }

    seen.add(dedupeKey);
    result.push(candidate);
  }

  return result;
}
