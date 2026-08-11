-- Per-student payment link (club cabinet «Оплатить»). Наряд ч.5.1: у разных учеников
-- разные ссылки на оплату. Раньше мини-апп открывал одну общую CLUB_TBANK_PAYMENT_URL с
-- подстановкой {label}; теперь ссылка индивидуальна и живёт на самом ученике.
--
-- Additive и идемпотентно: nullable text, дефолта нет. Никак не связано с логикой
-- начислений/аллокаций (billing_monthly_payments и т.п. не трогаются) — это просто
-- контакт-ссылка ученика. Если поле пустое, кнопка «Оплатить» в мини-аппе НЕ показывается
-- (getClubBilling.payUrl = null), общий фолбэк убран намеренно (наряд ч.5.2).
alter table public.trainingpeaks_students
  add column if not exists payment_url text;

comment on column public.trainingpeaks_students.payment_url is
  'Персональная ссылка оплаты ученика (T-Bank и т.п.). Заполняется тренером в /admin/club/payment-links. NULL → кнопка «Оплатить» в мини-аппе скрыта (общего фолбэка нет).';
