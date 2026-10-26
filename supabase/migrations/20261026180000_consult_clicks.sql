-- Клики «Записаться на бесплатную консультацию» под бесплатными инструментами
-- igorp.run (26.10.2026). До этого кнопка вела прямо в личный Telegram тренера,
-- клик нигде не оставлял следа, и нельзя было сказать, какой лид-магнит
-- приводит людей на консультацию. Теперь кнопка идёт через /go/consult,
-- который пишет строку сюда и перенаправляет в Telegram.
--
-- RLS включён без политик: пишет и читает только сервер на service_role.

create table if not exists public.consult_clicks (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  tool text not null,
  referrer text,
  user_agent text,
  country text
);

create index if not exists consult_clicks_created_at_idx on public.consult_clicks (created_at desc);
create index if not exists consult_clicks_tool_idx on public.consult_clicks (tool);

alter table public.consult_clicks enable row level security;

comment on table public.consult_clicks is
  'Клики по кнопке бесплатной консультации под инструментами igorp.run (пишет /go/consult).';
