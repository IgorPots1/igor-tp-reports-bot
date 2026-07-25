# 1A — Разведка существующей админки (для клубных разделов)

Дата: 2026-07-25. Ветка `feature/club-admin`. Только чтение кода.

## 1. Где живёт админка
- Корень: `src/app/admin/`. Роутинг — стандартный App Router (папка→URL).
- **Единственный layout** на всё дерево: `src/app/admin/layout.tsx` (гейтит доступ, оборачивает в `AdminShell`). Вложенных layout нет.
- Существующие роуты: `/admin`, `/admin/reports[/:id]`, `/admin/coach-os[/signals|/nutrition[/:studentId]]`, `/admin/students[...]`, `/admin/telegram-links`, `/admin/billing[...]`.
- Шелл/навигация: `src/app/admin/AdminShell.tsx`. Общие хелперы: `src/app/admin/lib.ts` (`getSingleSearchParam`), `src/app/admin/FormActionButton.tsx`.

## 2. Реестр навигации — ФАЙЛ ПОД ПРАВКУ
- Дата-реестра нет. Верхнее меню — хардкод `<Link>` в **`src/app/admin/AdminShell.tsx`** (`<nav className="admin-nav">`). Чтобы добавить раздел — добавить один `<Link href="/admin/club">Клуб</Link>` сюда. **Это единственная обязательная правка существующего файла.**
- Форма элемента: `<Link href="/admin/<path>">Русский лейбл</Link>`. Ни иконок, ни ролей, ни active-state.
- Подменю — per-page (напр. кнопки в `coach-os/page.tsx`). Мы своё подменю рисуем на своей hub-странице, existing не трогаем.

## 3. Авторизация
- Одна роль, бинарный доступ. Токен `ADMIN_ACCESS_TOKEN` → cookie `tp_admin_access` (`src/lib/admin-auth.ts`). В dev без токена — открыто (`isAdminAccessBypassedForLocalDev`).
- Гейт страниц — в `admin/layout.tsx` (покрывает все `/admin/*` автоматически; новые страницы гейтятся даром).
- Гейт мутаций — каждый server-action ПЕРВОЙ строкой зовёт приватный `ensureAdminAccess(redirectTo)`. Своя копия в каждом `actions.ts`. Наши новые actions обязаны копировать этот паттерн.

## 4. UI-паттерны
- Стилей-фреймворков нет. Классы `admin-*` в `src/app/globals.css`: `admin-section`, `admin-card`, `admin-table[-wrap]`, `admin-summary-grid/card`, `admin-button[-primary|-secondary|-danger|-small]`, `admin-badge[-success|-danger|-warning|-muted]`, `admin-tabs/tab[-active]`, `admin-filters/field/input/textarea`, `admin-alert[-success|-error|-warning]`.
- Тостов/модалок нет: «тост» = `admin-alert` из `?notice=`/`?error=`; подтверждение = `window.confirm` внутри `FormActionButton`.
- Переиспользуем: `src/app/admin/FormActionButton.tsx` (submit + confirm + pending). Больше общих примитивов нет — остальное инлайновый JSX.
- Форма страницы: `async` server component → `await searchParams` → `getSingleSearchParam` фильтры → загрузка из repository → рендер `admin-section`/`admin-alert`/`admin-summary-grid`/`<form method=get>`/`admin-table`. Мутации — `<form action={serverAction}>` + hidden inputs + `FormActionButton`.

## 5. Данные
- Клиент: `createSupabaseServerClient()` (service-role) из `src/features/supabase/server.ts` (+ `withSupabaseNetworkRetry`).
- Слой доступа: `src/features/<feature>/repository.ts` (функции кидают Error на `error`), опц. фасад `admin.ts`.
- **Чтение — прямо в серверном компоненте; запись — через server actions** (`revalidatePath` → `redirect(withNotice(...))`). Админка НЕ ходит client-fetch и НЕ использует API-роуты. Новые разделы делаем так же.

## 6. Образец «список → просмотр → действие с подтверждением»
Питание: список `coach-os/nutrition/page.tsx` → деталь `[studentId]/page.tsx` → действия `coach-os/nutrition/actions.ts` (`approveNutritionReviewAction`: `ensureAdminAccess` → repo-мутация → `revalidatePath` → `redirect(withNotice)`). Батч — чекбоксы через атрибут `form` + один `FormActionButton`. Это шаблон для очереди заявок и ревизии результатов.

## 7. Что менять vs создавать
**Менять (обязательно):**
- `src/app/admin/AdminShell.tsx` — добавить один gated `<Link href="/admin/club">Клуб</Link>` (виден только при `CLUB_ADMIN_ENABLED`). Иначе раздел недостижим из UI. Больше ничего в этом файле не трогаем (логику `showAdminNav`/`hasAdminSession`/`logoutAdminAction` не касаемся).

**Создавать (всё остальное — новые файлы):**
- `src/app/admin/club/page.tsx` (hub) + `results/`, `queue/`, `links/`, `manage/` (page.tsx + actions.ts).
- `src/features/club-admin/repository.ts` (+ переиспользование `src/features/club/*` для реконструкции).
- Миграция `..._club_records_coach_fields.sql` (поле race_name у club_records — под ручной ввод гонки; НЕ применять здесь).
- CSS не добавляем (хватает `admin-*`).

`src/app/layout.tsx` и `src/app/admin/layout.tsx` НЕ трогаем (новые роуты наследуют всё).

## 8. Риск
- `AdminShell.tsx` рендерится на КАЖДОЙ admin-странице → синтакс-ошибка тут кладёт всю админку. Правка — один `<Link>` под флагом, логику не трогаем.
- Новые роуты изолированы (низкий риск). Забыть `ensureAdminAccess` в новом action = дыра (не краш) — проверяем, что каждый action начинается с гейта.
- `revalidatePath`: наши мутации ревалидируют только свои `/admin/club/*` пути.
- **Проверка регресса:** при `CLUB_ADMIN_ENABLED=false` линка «Клуб» нет → админка выглядит и работает как сейчас. Прогнать сборку + открыть `/admin/reports`, `/admin/coach-os[/nutrition]`, `/admin/students`, `/admin/billing`, `/admin/telegram-links`.
