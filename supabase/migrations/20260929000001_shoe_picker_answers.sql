-- Ответы подборщика беговых кроссовок (/tools/shoes).
--
-- Хранятся ради одного: понимать, чем реально бегает аудитория, и на чём
-- основана выданная ротация. Персональных данных здесь нет — ни имени, ни
-- контакта: контакт человек оставляет уже в боте, отдельным шагом.
create table if not exists public.shoe_picker_answers (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  -- Ответы опросника целиком: шкала вопросов ещё будет меняться, и колонка на
  -- каждый вопрос означала бы миграцию на каждую правку формулировки.
  answers jsonb not null,
  -- Что показали: слоты и id моделей. Нужно, чтобы задним числом понять, какую
  -- выдачу видел человек, — веса критериев со временем поедут после калибровки.
  picks jsonb,
  source text not null default 'tools/shoes',
  user_agent text
);

create index if not exists shoe_picker_answers_created_at_idx
  on public.shoe_picker_answers (created_at desc);

alter table public.shoe_picker_answers enable row level security;

-- Пишет только сервер под service_role (RLS его не касается). Публичных политик
-- нет намеренно: таблица не должна читаться из браузера.
