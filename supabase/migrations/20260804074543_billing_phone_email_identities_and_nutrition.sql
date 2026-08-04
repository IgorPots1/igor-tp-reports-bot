-- Телефон и email как ключи личности плательщика.
--
-- Телефон — ОДИН ИЗ ключей, не единственный: клиент держит сколько угодно identity
-- любого типа. Приоритет разбора: phone -> email -> payer_hint (см.
-- buildTrustedAutoMatchDecision в src/features/billing/service.ts). Нет телефона или он
-- чужой — всё работает ровно как раньше, ничего не теряется.
--
-- Новых уникальных индексов НЕ добавляем. Существующий
-- billing_payer_identities_identity_type_hash_uidx (identity_type, identity_hash)
-- остаётся как есть: «один человек — два номера» в него укладывается (разные хеши),
-- «один номер — двое» (семьи) — нет. Именно поэтому автоматч обязан уводить расхождение
-- ключей в ручной разбор (skipped_identity_conflict), а не доверять телефону молча.

alter table billing_payer_identities
  drop constraint if exists billing_payer_identities_identity_type_check;

alter table billing_payer_identities
  add constraint billing_payer_identities_identity_type_check
  check (identity_type = any (array[
    'payer_hint',
    'description_hint',
    'payment_description',
    'phone',
    'email'
  ]));

-- Питание как отдельная статья ВНУТРИ месячной суммы.
--
-- nutrition_amount — РАЗБИВКА monthly_amount, а не добавка к нему: у платящего 6000
-- (5000 база + 1000 питание) monthly_amount остаётся 6000. Если уменьшить его до 5000,
-- сорвётся доверенный автоматч — он сверяет monthlyAmount === amount на точное равенство.
--
-- Разметка по номиналу ЗАПРЕЩЕНА: 6000 в этой базе означает три разные вещи —
-- 4000+2000, 5000+1000 и полтора месяца базы по 4000. Заполнять только вручную.

alter table billing_clients
  add column if not exists has_nutrition boolean not null default false;

alter table billing_clients
  add column if not exists nutrition_amount integer;

alter table billing_clients
  drop constraint if exists billing_clients_nutrition_amount_check;

alter table billing_clients
  add constraint billing_clients_nutrition_amount_check
  check (
    (nutrition_amount is null or nutrition_amount > 0)
    and (has_nutrition or nutrition_amount is null)
  );
