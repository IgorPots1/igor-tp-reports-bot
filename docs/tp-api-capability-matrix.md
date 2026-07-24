# TrainingPeaks API — Verified Capability Matrix (PR1)

Source of truth for the write architecture in `/Users/igor/.claude/plans/foamy-scribbling-book.md` (§A/§B/§D). This
document replaces the plan's 🟡/❓ placeholders with **live-verified** results wherever a probe was actually run.
All live probes ran against the safe test athlete **3102415** only, on far-future/reversible dates, and were rolled
back (deleted) as part of the same run. Probe scripts live in `tools/trainingpeaks-export/scripts/tp-probe-*.ts`.

Legend: ✅ **verified live this pass** (create→verify→delete or read, on 3102415) · 🟡 endpoint identified from
`nagelflorian/trainingpeaks-mcp-server` source (real working open-source implementation, same auth), not yet
live-tested here · ❓ still unresolved · 🔴 policy-excluded (never to be tested/used even if API-capable).

## A. Read

| Entity | Verdict | Endpoint | Notes |
|---|---|---|---|
| Workout list/detail/laps/samples/events | ✅ (pre-existing) | `tpapi.trainingpeaks.com/fitness/v6/...` | Unchanged from prior sessions. |
| Athlete settings (incl. zones) | ✅ **verified live** | `GET /fitness/v1/athletes/{id}/settings` | HTTP 200, 57 keys returned. `tp-probe-events-and-settings.ts`. |
| Strength workout | ✅ (pre-existing + re-verified) | `GET api.peakswaresb.com/rx/activity/v1/workouts/{numericId}` | Re-confirmed as part of the write round trip below. |
| CTL/ATL/TSB / PMC | 🟡 | `POST /fitness/v1/athletes/{id}/reporting/performancedata/{from}/{to}` (nagelflorian `fitness.ts`) — note **POST**, not GET | Not tested this pass; also `GET /fitness/v1/athletes/{id}/atp/{from}/{to}` (annual training plan) and `personalrecord/v2/...`. |

## B. Write — resolved this pass

### Structured strength — **RESOLVED, verified end-to-end**
Root cause of the earlier non-persisting draft (plan §B): the multi-step flow (`create shell → add block → add
exercise → PUT`) only ever echoes a client-side draft (`complianceState: "Unplanned"`, UUID id, never addressable).
The real persist call is a **single atomic POST**:

```
POST https://api.peakswaresb.com/rx/activity/v1/workouts/save
```

Full workout object (blocks/prescriptions/sets with client-generated UUIDs, `calendarId`, `prescribedDate`) is sent
in one shot — no incremental draft-building. Found in `nagelflorian/trainingpeaks-mcp-server` (`src/api/strength.ts`,
`createStrengthWorkout()`), same cookie→bearer auth as everything else in our stack.

**Live round trip (athlete 3102415, date 2026-12-31):**
1. `POST /save` → HTTP 200, returned id `22291958` (**numeric**, not UUID)
2. `complianceState` after save: `"NoCompletion"` (a real planned state, not `"Unplanned"`)
3. `GET /workouts/22291958` → HTTP 200, `blocks: 1` (**persisted**, independently addressable)
4. `DELETE /workouts/22291958` → HTTP 200 (works — nagelflorian has no delete tool for strength, but the generic
   delete verb on this host does work)
5. `GET /workouts/22291958` (after delete) → HTTP 404 (**confirmed gone**)

**Verdict: ✅ create AND delete both work.** Script: `tools/trainingpeaks-export/scripts/tp-probe-strength-create-save.ts`.
This directly unblocks PR5 — no DOM-builder fallback needed.

### Workout delete (cardio, tpapi host) — **verified**
`DELETE https://tpapi.trainingpeaks.com/fitness/v6/athletes/{athleteId}/workouts/{workoutId}`

Round trip (athlete 3102415, date 2026-12-30): create → workoutId `3840679213` → `DELETE` → HTTP 200, body `true`.

**⚠️ Finding: the follow-up GET does NOT return 404/403.** It returns **HTTP 400** with body
`"Invalid workoutId (<id>)"`. Confirmed truly deleted via the day-range list endpoint (0 workouts returned, id
absent). **Any future executor's post-delete verification logic must treat `400 + "Invalid workoutId"` as
success, not just 404/403** — this is now encoded in `tp-probe-workout-delete.ts`'s `gone` check and should carry
into PR3/PR4's generalized verify step.

**Verdict: ✅ delete works, confirmed.**

## C. Write — endpoint identified, not live-tested this pass

All of the following are confirmed to exist (real paths from a working open-source client using our exact auth
mechanism), but were not exercised live in this PR1 pass — either for time, or deliberately for safety (see notes).

| Entity | Endpoint | Method | Note |
|---|---|---|---|
| Event create | `POST /fitness/v6/athletes/{id}/event` | POST | ✅ **RESOLVED via UI capture (2026-07-24).** The earlier 500 was the wrong endpoint (`/events` plural) + wrong body. Real endpoint is **`/event` (singular)**; body uses **`personId`** (not `athleteId`), a real `eventType` (e.g. `RunningRoad`), `eventDate`, `distance`+`distanceUnits`, and `goals{}`/`legs[]`/`workouts[]`/`results[]`. Returns 200 with numeric event `id`. **Exact form: `docs/tp-write-payloads.md` §2.** |
| Workout comments | `/fitness/v2/athletes/{id}/workouts/{workoutId}/comments[/{commentId}]` | GET/POST/DELETE | **Correction to plan §A**, which said "no dedicated comment endpoint" — nagelflorian shows there IS one (v2), separate from the full-object workout PUT. Not tested live. |
| Private workout note | `/fitness/v6/workouts/{workoutId}/privateWorkoutNote` | PUT | Not tested. |
| Calendar notes | `/fitness/v1/athletes/{id}/calendarNote[/{id}]` (+ `/comment`, `/comments`) | GET/POST/PUT/DELETE | Full CRUD available. Not tested. |
| Availability (limited-training periods) | `/fitness/v1/athletes/{id}/availability[/{id}]` | GET/POST/PUT/DELETE | Not tested. |
| Goal lists | `/fitness/v1/athletes/{id}/goallists[/{id}]` | POST/DELETE | Not tested. |
| Metrics write (weight/HRV/sleep/etc.) | `POST /metrics/v3/athletes/{id}/consolidatedtimedmetric` (singular) | POST | **Deliberately not live-tested**: athlete 3102415 is Igor's real personal TP account (not a synthetic dummy) — this endpoint has **no documented delete/undo** in nagelflorian, so a bad write could corrupt real historical health data. Recommend testing only with an explicitly disposable date/value AND Igor's live supervision, or finding the delete/reset call first. |
| Library → schedule to calendar | `POST /fitness/v6/athletes/{id}/commands/addworkoutfromlibraryitem` | POST | Reversible in principle (result is a normal workout, deletable via the now-verified workout-delete endpoint). Not tested — needs a valid `exerciseLibraryItemId` first (read-only lookup via `/exerciselibrary/v2/...`, already available). |
| Equipment (bikes/shoes) | `PUT /fitness/v1/athletes/{id}/equipment` (whole-array replace) | PUT | Genuinely reversible by design (GET full array → append/remove → PUT the array back) — nagelflorian's `addEquipmentItem`/`deleteEquipmentItem` do exactly this. **Not live-tested this pass** (deliberately deferred to a dedicated, careful pass rather than rushed at the end of a long session — this is Igor's real gear list). |
| Workout library CRUD | `/exerciselibrary/v1/libraries[/{id}][/items[/{id}]]` (+ `/name`) | POST/PUT/DELETE | Not tested. Note: `/exerciselibrary/v2` (read) vs `/v1` (write) — different versions for read vs write on this entity. |
| Zones write (power/HR/speed) | `PUT /fitness/v2/athletes/{id}/{power|heartrate|speed}zones` | PUT | **🔴 No direct write** — gated propose/apply only (see **Zone-write policy** below). Form now known via UI capture (2026-07-24): body is an **array of zone-sets**, each with `threshold` + full computed `zones[]` → **PUT overwrites the whole set**, returns 204. **Exact form: `docs/tp-write-payloads.md` §1.** |
| FTP write | via settings/zones update | PUT | **🔴 No direct write** — same policy (FTP recalculates zones). |

### Zone-write policy (power/HR/speed zones + FTP/LTHR/threshold pace)

**Direct writes to zones/thresholds are forbidden.** No code path may `PUT`
`/fitness/v2/athletes/{id}/{power|heartrate|speed}zones` (or write FTP via settings)
directly. High blast radius: a zone/FTP change silently recalculates the athlete's
training zones. The **only** permitted mutation path is **assisted propose → apply**,
and only when **all four** of the following hold:

- **proposal_id** — every apply carries the id of an Igor-approved proposal (confirmed
  via the existing `tp:ta:x:` "✅ Выполнить" gate). No apply without one.
- **payload_before (mandatory)** — the exact pre-image (current zones/thresholds read
  back immediately before apply) is captured and stored on the run. Apply aborts if the
  pre-image can't be read. This is what makes rollback to the exact prior state possible.
- **snapshot precondition** — a zone snapshot for that athlete must already exist in
  `tp_zone_snapshots` (captured read-only). No zone write against an athlete we have
  never snapshotted.
- **batched** — zone changes go through the batch action path (one confirmation + full
  per-item preview + per-item verify + per-item rollback token), never as ad-hoc
  singletons.

Execution stays with the local runner under `TP_ACTIONS_REAL_EXECUTION`; the agent/
connector only **proposes**, never writes. Until an apply path meeting all four gates is
built and reviewed, zones/FTP remain **manual only**.

## D. Cookie / secrets — Playwright-profile auth (plan §D task)

**Verdict: ✅ possible, empirically confirmed — with concrete caveats.**

Tested `tools/trainingpeaks-export/scripts/tp-probe-auth-from-profile.ts` against the real logged-in persistent
profile (`tools/trainingpeaks-export/.playwright-profile/trainingpeaks`, ~858MB, last used same day):

- `context.cookies([...])` returns the **actual cleartext** `Production_tpAuth` value (1797 chars) — Playwright/
  Chromium handles the OS-level (macOS Keychain) decryption internally; no raw SQLite parsing needed.
- Cookie `expires` timestamp → **2026-08-11**, i.e. a **~30-day TTL**, same as a manually-copied DevTools cookie.
- The sniffed live `Authorization` bearer header successfully authorized a real `GET /users/v3/user` (HTTP 200).
- **This closes Igor's original autominting question**: an API-executor does not need a raw cookie sitting in a
  long-lived env var at all — it can be sourced programmatically from the same profile Igor already keeps logged
  in for the DOM runner.

**Caveats (also confirmed empirically):**
1. **Not portable across checkouts.** A *different* worktree (fresh `.playwright-profile/` at a different path) has
   its own **empty, unauthenticated** profile — 0 relevant cookies. Confirmed: running the same probe from the
   `feature/tp-api-layer` worktree returned `production_tpauth_cookie_present: false`. The executor must run on the
   same machine/path as the one true logged-in profile, or a snapshot of it must be transported.
2. **Recommend a snapshot step, not live concurrent access.** Chromium disallows two processes opening the same
   `user-data-dir` at once. Rather than have the API-executor launch a full Playwright/Chromium instance per
   request (heavy, and risks lock conflicts with `tp-actions-once.ts`'s own DOM sessions), add a small **sequential**
   `tp-refresh-session-snapshot.ts` step that launches the profile headless, calls `context.cookies()`, writes just
   the `Production_tpAuth` value to a short-lived local file (gitignored), and exits. The lightweight API client
   (PR2) reads from that snapshot file instead of `process.env.TRAININGPEAKS_COOKIE` — same downstream code path
   (cookie → `/users/v3/token` → bearer), just a different source for the cookie string.
3. **Does not eliminate re-login forever.** The underlying TP session still expires (~30 days observed) or can be
   invalidated server-side. This removes the manual *copy-paste from DevTools* step, not the occasional need for
   Igor to have an interactively-valid session in that Chromium profile.
4. Direct SQLite (`Default/Cookies`) parsing was **not** attempted/recommended — Chromium encrypts values via
   macOS Keychain; decrypting outside Playwright's own API is more fragile and a bigger security surface, not less.

**Design recommendation for PR2/§D (updated after review):**
- Authorization comes **ONLY** from the persistent Playwright profile (`context.cookies()`). ~30-day TTL,
  confirmed empirically in PR1.
- `TRAININGPEAKS_COOKIE` is **NOT built at all**. The raw-cookie-in-env model is **DROPPED**, not kept alongside
  the profile source. No raw secret sits in an environment variable anywhere in this design.
- Cookie auto-minting is a **CLOSED** question, not deferred — there is no separate auto-mint task.
- The Telegram 401 alert stays as a **safety net**, not the primary refresh path.
- **PR2 must solve the snapshot-export of the profile across worktrees/checkouts** (see caveat 1/2 above).

## Open question carried over (not investigated this pass)

**17 (API) vs 18 (cache) workout-count discrepancy** for athlete `5931798`, window `2026-06-13…2026-07-11` — per
plan §A, **not explained by pagination boundaries** (boundaries are inclusive, confirmed separately). Left as an
explicit separate task: diff `workoutId` lists (live API vs `trainingpeaks_workout_cache`), classify the extra
record. Dedup-by-`workoutId` remains a cache-write invariant regardless of the outcome.

## Safety confirmation
- All live mutations ran against **athlete 3102415 only** (the repo's existing safe test athlete constant,
  `SAFE_RUNNING_WORKOUT_ATHLETE_ID`), on future/reversible dates.
- Every mutating probe was rolled back (deleted) in the same run; post-delete state verified via GET/list, not
  assumed.
- Auth was sourced from the existing logged-in Playwright profile — **no raw cookie was ever typed, pasted, or
  printed** during this pass (unlike earlier sessions in this thread, which is why plan §D flagged a credential
  leak and asked Igor to re-login/rotate).
- Zones/FTP/equipment/metrics writes were deliberately **not** exercised live this pass (policy-excluded or
  deferred for real-data-safety reasons — see §C notes per row).
