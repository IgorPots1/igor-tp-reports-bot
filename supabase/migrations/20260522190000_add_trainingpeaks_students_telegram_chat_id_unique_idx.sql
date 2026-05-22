do $$
declare
  duplicate_count integer;
begin
  select count(*) into duplicate_count
  from (
    select telegram_chat_id
    from public.trainingpeaks_students
    where telegram_chat_id is not null
    group by telegram_chat_id
    having count(*) > 1
  ) duplicates;

  if duplicate_count > 0 then
    raise exception 'Cannot create unique index: % duplicate telegram_chat_id values found', duplicate_count;
  end if;
end $$;

create unique index if not exists trainingpeaks_students_telegram_chat_id_unique_idx
  on public.trainingpeaks_students (telegram_chat_id)
  where telegram_chat_id is not null;
