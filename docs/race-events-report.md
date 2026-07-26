# race_events как источник гонок — отчёт (Фаза 1.5)

Read-only пересчёт на ПОЛНЫХ данных. `trainingpeaks_race_events` подключён как
источник гонок: его даты классифицируют тренировку того дня как race (время берётся
из тренировки; `distance_km` race_events намеренно НЕ используется — ненадёжен).
Приоритет источников: coach_confirmed > race_events > club_races > реконструкция.

**Итог: было race = 0 → стало 24 гонки у 15 учеников.** Клубные топы (только race) и раздел
«Гонки» перестают быть пустыми; якорь E-Predictor получает настоящие гонки.

**Почему 24, а не 43 (столько дат совпало с тренировкой по SQL).** Совпадение даты — ещё не
рекорд: тренировка гоночного дня должна попасть в корзину 5k/10k/21k/42k (гонка на 15k/трейл
не корзинуется), пройти проверки правдоподобия (часть скрыта pause_gap и пр.), и берётся
ЛУЧШАЯ на дистанцию (дедуп). 43 совпадения → 24 валидные записи — честный отсев, не потеря.

## Что появилось (было race = 0)

| Метрика | Значение |
|---|---|
| Записей типа RACE (лучшая на дистанцию) | 24 |
| Учеников с ≥1 гонкой | 15 |
| Записей типа отрезок тренировки | 238 |

### Гонки по источнику

| Источник | Записей |
|---|---|
| race_events (календарь TP) | 24 |
| club_races (заявки учеников) | 0 |
| reconstructed (дата без источника) | 0 |

### Гонки по дистанциям

| Дистанция | Гонок |
|---|---|
| 5k | 8 |
| 10k | 10 |
| 21k | 3 |
| 42k | 3 |

## Что остаётся ручным (1.5.5)

Учеников БЕЗ единой гонки после подключения: **97** из 112.
Это реальный объём ручного ввода в админке (вместо всех ~110): у них нет ни
совпадения race_events с тренировкой, ни заявки, ни coach_confirmed. Причины:
гонка есть в календаре, но нет тренировки того дня (DNS / не синкнулось), либо
вообще нет гонок в периоде.

Список (первые 60):

- Aleksandr Bogachev
- Aleksandr Sorokin
- Aleksandra Kasianenko
- Aleksandra Tararova
- Aleksei Lobus
- Alena Grill
- Alex
- Alexander Lavrentyev
- Alexander Pautov
- Anastasia Il
- Anastasia Utenkova
- Anastasiya Grushevskaya
- Anna Chernysheva
- Anna Denisova
- Anna Frantsuzova
- Anna Kuzovkina
- Anna Lobodina
- Anna Plotnitskaya
- Anton Malyk
- Danil Morozov
- Danila Shorokh
- Daria Postolaki
- Demian Diachenko
- Dolgor Takhanaeva
- ELENA
- Elena Leonova
- Elena Titskaia
- Elena Vasileva
- Elena Yarulina
- Elizaveta Kolodkina
- Emil Hasanov
- Erik Yashin
- Eseniya Degtyareva
- Filip Krasavin
- Gladkikh Ekaterina
- grigori bereznoi
- Gudkova Ekaterina
- Igor Karnaukh
- Igor Klimovich
- ILYA BOGDANOV
- Irina Kaluzhskikh
- Irina Melnikova
- Jelizaveta Stolova
- Katerina Melnikova
- Khadizhat Murtazalieva
- Kristina Pamparaite
- Ksenia Vlasova
- Kudryavtseva Liliya
- Larionova
- Leila Ermakova
- Levina Ekaterina
- Liliya Zalogina
- Maksim Severin
- Margarita
- Maria Panteleeva
- Maria Turkina
- Maria Zueva
- Mariya Whitcomb
- Mariyet Kalakutok
- Martynenko Marija
