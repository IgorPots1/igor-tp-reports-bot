-- Пришла ЧАСТЬ ожидаемого: например, база есть, а питание отдельным платежом ещё
-- не дошло.
--
-- Зачем отдельный статус, а не просто две суммы на строке. Все четыре агрегата долга
-- смотрят на СТАТУС, а не на суммы:
--   repository.ts listUnpaidBillingMonthlyPayments — .in("status", [...])
--   service.ts    приостановка клиента — цикл по статусам
--   service.ts    isBillingPaymentOverdueCandidate — status pending/overdue
--   admin.ts      isBillingRowEffectivelyOverdue — status + daysOverdue
-- Поэтому слот питания без нового статуса не решил бы задачу, а спрятал её: строка
-- осталась бы paid, и неоплаченное питание не попало бы НИ В ОДИН агрегат — ровно
-- так же, как до этого был невидим недобор 3000 у Хади за июль.
--
-- partial означает «пришло не всё», и потому ведёт себя как pending: попадает
-- в незакрытые, просрочивается по planned_payment_date, останавливается вместе
-- с клиентом. Но НЕ блокирует приём второго платежа — иначе тупик: месяц стал
-- partial именно оттого, что второй платёж ещё не пришёл.
--
-- ТА ЖЕ ОГОВОРКА, ЧТО У waived_presystem И waived_covered: computeReminderCandidates
-- (src/features/billing/club-reminders.ts) пропускает только 'paid', то есть partial
-- пролетит сквозь него. Вызывающего у неё сегодня нет — добавить в guard, когда
-- появится.

alter table billing_monthly_payments
  drop constraint if exists billing_monthly_payments_status_check;

alter table billing_monthly_payments
  add constraint billing_monthly_payments_status_check
  check (status = any (array[
    'pending',
    'paid',
    'overdue',
    'paused',
    'manual_review',
    'refunded',
    'waived_presystem',
    'waived_covered',
    'partial'
  ]));
