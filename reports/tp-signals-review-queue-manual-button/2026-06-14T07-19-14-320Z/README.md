# TP Signals Review Queue — Manual Launch Button

## Summary

Added a coach-facing inline button at the bottom of `/tp_signals` to manually launch the Review Queue card batch. The button uses callback `tp:signals:review_queue:start`, sends up to 5 cards to the requesting coach chat, and does not mutate signals on launch. Manual send is gated by a new independent flag `TRAININGPEAKS_TP_SIGNAL_REVIEW_QUEUE_MANUAL_SEND_ENABLED`, so auto-send can remain off while the button works.

## Files changed

- `src/features/trainingpeaks/tp-signals-review-flow.ts` — manual send flag, collection helper, launch handler, launch markup
- `src/features/telegram/trainingpeaks.ts` — attach button to `/tp_signals`, callback dispatch
- `src/features/trainingpeaks/tp-signals-review-queue-helpers.ts` — diagnostic markdown includes manual flag
- `scripts/check-tp-signals-review-queue.ts` — 10 new deterministic cases (58 total)
- `scripts/diagnose-tp-signals-review-queue.ts` — console summary includes manual flag

## Button placement

- Appears on the **last chunk** of `/tp_signals` output (multi-message safe)
- Only when `TRAININGPEAKS_TP_SIGNAL_REVIEW_QUEUE_ENABLED=true`
- Coach/private context only (existing `/tp_signals` access gate unchanged)
- Text: `🔎 Разобрать спорные сигналы`
- Callback: `tp:signals:review_queue:start`

## Callback behavior

1. Coach-only check → `Команда доступна только тренеру.`
2. Queue enabled check → `Review Queue сейчас выключена.`
3. Manual send enabled check → `Review Queue сейчас выключена.`
4. Collect queue for Belgrade today via existing selector (close candidates first, hidden/superseded/generic plan excluded)
5. Send cards to **requesting coach chat only** (not all coach chats)
6. Answer callback:
   - sent: `Отправил N карточек на разбор.`
   - empty: `✅ Сейчас нет спорных TP Signals для разбора.`

Launch does not write review decisions or mutate operational signal status.

## Feature flags

Recommended rollout:

```env
TRAININGPEAKS_TP_SIGNAL_REVIEW_QUEUE_ENABLED=true
TRAININGPEAKS_TP_SIGNAL_REVIEW_QUEUE_MANUAL_SEND_ENABLED=true
TRAININGPEAKS_TP_SIGNAL_REVIEW_QUEUE_SEND_ENABLED=false
TRAININGPEAKS_TP_SIGNAL_REVIEW_QUEUE_BUTTONS_ENABLED=true
TRAININGPEAKS_TP_SIGNAL_REVIEW_QUEUE_MUTATIONS_ENABLED=true
```

Optional limit:

```env
TRAININGPEAKS_TP_SIGNAL_REVIEW_QUEUE_MANUAL_LIMIT=5
```

Default limit: 5 (hard-coded fallback if env unset/invalid).

## Tests

`npm run check:tp-signals-review-queue` — PASS (58/58), covers:

- launch button markup and callback prefix
- callback not parsed as card action (`tp:rvq:*`)
- manual send works with `SEND_ENABLED=false`
- disabled queue/manual send safe answers
- empty queue message
- launch sends cards without DB mutations
- card context (`Что произошло`) unchanged from prior commit

All other required checks PASS (lint, build, buckets, pending mutations, schedule expiry, nonrun cleanup, recovery close candidates, regression cases strict, full output, coach operational signals).

## Manual smoke instructions

1. Set flags per rollout above in `.env.local`
2. Send `/tp_signals` from coach private chat
3. Confirm button `🔎 Разобрать спорные сигналы` at bottom
4. Click button → up to 5 review cards with `Что произошло` block
5. Resolve cards with existing buttons (`✅ Закрыть сигнал`, `✅ Актуально`, `🙈 Это шум`, `📝 Проверить позже`)
6. Verify no athlete messages and no auto-send on signal creation

Live Telegram smoke requires Igor approval.

## Remaining limitations

- Launch scans all active operational signals (same scope as diagnose `--all-active`), not filtered by `/tp_signals` scope argument
- Only one pending review card TTL slot per coach chat (last sent card wins pending map)
- No refresh button on `/tp_signals` (optional future row)
- CLI `--send` still requires `SEND_ENABLED=true` (auto path unchanged)
