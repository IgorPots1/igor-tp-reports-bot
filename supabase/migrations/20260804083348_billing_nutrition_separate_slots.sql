-- Питание бывает двух видов, и это РАЗНЫЕ вещи:
--   included — внутри monthly_amount, один платёж (6000 = 5000 база + 1000 питание)
--   separate — база и питание приходят разными транзакциями в разные дни (с июля 2026)
-- Булев has_nutrition описывал только первый вид, и платежу питания было НЕКУДА ЛЕЧЬ:
-- на строке месяца один слот денег, первый пришедший платёж занимал его и закрывал
-- месяц. Так у Хади июль оказался помечен paid, будучи подкреплён только питанием
-- 2000 из ожидаемых 5000 базы.

alter table billing_clients
  add column if not exists nutrition_billing_mode text not null default 'none';

alter table billing_clients
  drop constraint if exists billing_clients_nutrition_billing_mode_check;

alter table billing_clients
  add constraint billing_clients_nutrition_billing_mode_check
  check (nutrition_billing_mode = any (array['none','included','separate']));

-- Существующие has_nutrition=true — это ровно «внутри суммы».
update billing_clients set nutrition_billing_mode = 'included' where has_nutrition;

-- has_nutrition НЕ удаляем до следующего релиза: если его что-то ещё читает, увидим
-- не сразу. Пока держим в синхроне констрейнтом — рассогласоваться они не смогут.
alter table billing_clients
  drop constraint if exists billing_clients_nutrition_amount_check;

alter table billing_clients
  add constraint billing_clients_nutrition_amount_check
  check (
    (nutrition_amount is null or nutrition_amount > 0)
    and (has_nutrition = (nutrition_billing_mode <> 'none'))
    and (case when nutrition_billing_mode = 'none'
              then nutrition_amount is null
              else nutrition_amount is not null end)
  );

-- Слоты на строке месяца. Заполняются только клиентам с mode='separate' и только
-- с июля 2026: флаг на клиенте не имеет даты начала, а явление имеет. Проставить
-- питание задним числом = выдумать долг за май-июнь, которого не было.
alter table billing_monthly_payments
  add column if not exists nutrition_planned_amount integer,
  add column if not exists nutrition_paid_amount integer;

alter table billing_monthly_payments
  drop constraint if exists billing_monthly_payments_nutrition_amounts_check;

alter table billing_monthly_payments
  add constraint billing_monthly_payments_nutrition_amounts_check
  check (
    (nutrition_planned_amount is null or nutrition_planned_amount > 0)
    and (nutrition_paid_amount is null or nutrition_paid_amount > 0)
  );

-- В какой слот лёг платёж. ОДНО место истины: связь платёж -> строка уже живёт
-- в matched_monthly_payment_id, а второй хеш на строке месяца завёл бы копию той же
-- связи, которая рано или поздно разъедется — как разъехались identity и платежи
-- в случае ключа «есения».
alter table billing_imported_payments
  add column if not exists applied_to text;

alter table billing_imported_payments
  drop constraint if exists billing_imported_payments_applied_to_check;

alter table billing_imported_payments
  add constraint billing_imported_payments_applied_to_check
  check (applied_to is null or applied_to = any (array['base','nutrition']));
