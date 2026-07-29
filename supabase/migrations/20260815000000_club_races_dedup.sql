-- Club races dedup backstop. A student's SAME race (student + date + normalized name)
-- must not create a second row. The app pre-checks in createClubRace for a friendly no-op;
-- this partial-free functional unique index is the concurrency-safe guard (two near-
-- simultaneous submits). Normalization matches normRaceName(): lower + trimmed. Whitespace
-- collapse is app-side only (btrim covers the common leading/trailing case at the DB level).
--
-- Similar-but-different names on the same date are intentionally NOT blocked: the coach sees
-- them flagged in the admin race list and decides. Additive, non-destructive. NOT applied here.

create unique index if not exists club_races_student_date_name_uidx
  on public.club_races (student_id, race_date, lower(btrim(name)));
