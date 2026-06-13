# TP Signals Phase 2 — Schedule Expiry Hardening

- **Date:** 2026-06-13
- **Branch:** `tp-signals-pending-mutation-replay` (base HEAD `ecdfd34`)
- **Scope:** Class B only (stale schedule / plan-constraint expiry). No recovery, no classifier suppression, no DB writes.

## Summary

Fixed the narrow, deterministic root cause of stale schedule constraints: a **generous default `valid_until` was overriding concrete past unavailability dates**, so a constraint whose actual unavailable day had already passed stayed visible until the (later) default window end.

The fix makes **concrete one-off unavailability dates win over `valid_until`**: a schedule signal is now treated as expired when all its `unavailable_dates` are in the past **and** there is no remaining future actionable date (`planned_training_dates` / `resolved_available_dates`), even if `valid_until` is still in the future. Availability windows (`resolved_available_dates` / `available_days`) are intentionally **not** a trigger, to avoid over-hiding recurring availability rows.

### Key investigation findings
- The **current classifier already materializes** `unavailable_dates` (verified: "в среду не смогу" → `[2026-06-10]`; "next week вторник" → `[2026-06-09]`). The gap was purely in the expiry layer.
- The two **live** stuck rows (Lavrentyev `2e9db013`, Denisova `85256508`) were created by the **old** parser and have **empty** `unavailable_dates`/`unavailable_days`/`weekdays` — only free-text `latest_summary`. They carry a default `valid_until=2026-06-14`.
- Denisova's row says "**на следующей неделе**" and was encoded as a window `valid_from=06-08 / valid_until=06-14` — the **same end date as Naida's keep-case** ("доступна 08.06—14.06"). A text-mining display rule to force-hide these empty rows would risk **over-hiding Naida** and depends on ambiguous next-week resolution → deliberately **not** done (stop-and-report; see Limitations).

## Files changed
| File | Change |
|---|---|
| `src/features/trainingpeaks/service.ts` | Added `areAllUnavailableDatesExpired(payload, asOf)`; `isExpiredScheduleOperationalSignal` now returns expired when all one-off `unavailable_dates` are past with no future actionable date, ahead of the `valid_until` check. |
| `scripts/check-tp-signals-schedule-expiry.ts` | **new** — 10 deterministic fixtures (Lavrentyev/Denisova/future/mixed + Naida/Levan/Polyakova/empty-payload controls). |
| `package.json` | +1 script `check:tp-signals-schedule-expiry`. |

## Fixtures added (10/10 PASS)
1. Lavrentyev "в среду" (unavailable 06-10, vu 06-10) → **expired**.
2. **Core bug:** past unavailable 06-10 with generous vu 06-14 → **expired** (actionable date wins).
3. Denisova "вт next week" (unavailable 06-09, vu 06-14) → **expired**.
4. Future availability window (resolved 06-16/06-18) → **not expired**.
5. Mixed unavailable 06-09 + 06-15 → **not expired** (future kept).
6. Naida availability (resolved 06-09/06-11 past, no unavailable_dates) → **not expired** (not over-hidden).
7. Levan availability incl. today 06-13 → **not expired** (same-day convention).
8. Polyakova mixed (unavailable 06-10 past + planned 06-15 future) → **not expired**.
9/10. Empty-payload legacy rows → governed by `valid_until` only (future kept, past expired).

## Before / after behavior
| Case | Before | After |
|---|---|---|
| New "в среду не смогу" (unavailable 06-10, default vu 06-14) | visible until 06-14 | **expired/hidden after Wednesday** |
| New "next week вт" (unavailable 06-09, default vu 06-14) | visible until 06-14 | **expired/hidden after that Tuesday** |
| Lavrentyev/Denisova **existing live rows** (empty payload, vu 06-14) | visible | **unchanged** — self-clear 06-15 via `valid_until` (see Limitations) |
| Naida availability (resolved dates past, vu 06-14) | visible | **visible** (not over-hidden) |
| Levan (today 06-13), Tararova/Yulia (planned 13/14), Nastya (14) | visible | **visible** |
| Polyakova case-8 mixed | visible (shows future) | **visible** (unchanged) |

## Live diagnostic (read-only, as-of 2026-06-13)
`diagnose:tp-signals-explain --names="Alexander Lavrentyev,Anna Denisova,Levan,Naida Volkova,Aleksandra Tararova,Yulia Kuznetsova,Nastya Bunyakina"` → 7 matched, 13 active, **9 visible, all bug=none**. No future/availability row was hidden. The two empty-payload legacy rows (Lavrentyev/Denisova) remain (see Limitations).

## Checks run / results
| Command | Result |
|---|---|
| lint | 0 errors, 13 warnings (pre-existing `tools/`) |
| build | success |
| check:tp-signals-schedule-expiry | **PASS (10/10) — new** |
| check:tp-signals-regression-cases | 8/8 PASS (case 5 & 8 intact) |
| ... --strict | 8/8 PASS |
| check:tp-signals-review-queue | PASS (20/20) |
| check:tp-signals-review-buckets | PASS (9/9) |
| check:tp-signals-review-pending-mutations | PASS (16/16) |
| check:tp-signals-full-output | PASS |
| check-coach-operational-signals | PASS |

## Remaining limitations (stop-and-report)
1. **Existing empty-payload live rows** (Lavrentyev `2e9db013`, Denisova `85256508`) are **not** retroactively hidden — they carry no materialized dates, only free-text. They self-clear **06-15** via their `valid_until`. Hiding them now would require display-time text mining of `latest_summary`, which risks **over-hiding Naida** (same window end) and depends on ambiguous "next week" resolution. Recommended instead: a separately-reviewed **guarded recompute/cleanup** to re-materialize their dates (DB write — out of scope here), or let them self-clear 06-15. The classifier already materializes dates, so this class will not recur for new messages.
2. Availability windows whose listed days have all passed (e.g. Naida) are intentionally kept until `valid_until` (recurring-vs-one-off ambiguity); flagged for product confirmation whether stale availability windows should also expire.

## Safety
- No Telegram sends. No TrainingPeaks writes. No DB writes / no cleanup or replay apply. No status mutations. No auto-close of pain/illness. Recovery and classifier-suppression logic untouched. No push.
