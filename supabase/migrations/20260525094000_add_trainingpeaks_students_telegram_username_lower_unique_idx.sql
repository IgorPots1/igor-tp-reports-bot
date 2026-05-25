do $$
declare
  duplicate_count integer;
begin
  select count(*) into duplicate_count
  from (
    select lower(trim(telegram_username)) as normalized_telegram_username
    from public.trainingpeaks_students
    where telegram_username is not null
      and trim(telegram_username) <> ''
    group by lower(trim(telegram_username))
    having count(*) > 1
  ) duplicates;

  if duplicate_count > 0 then
    raise exception
      'Cannot create unique index: % duplicate normalized telegram_username values found',
      duplicate_count;
  end if;
end $$;

create unique index if not exists trainingpeaks_students_telegram_username_lower_unique_idx
  on public.trainingpeaks_students ((lower(trim(telegram_username))))
  where telegram_username is not null
    and trim(telegram_username) <> '';
