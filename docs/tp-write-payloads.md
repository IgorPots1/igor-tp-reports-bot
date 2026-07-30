# TrainingPeaks write payloads — observed from the UI

Captured **passively** while Igor performed each change by hand in the TrainingPeaks
web UI on his own account (athlete `3102415`) — see `tp-capture-write-payloads.ts`.
Nothing here was replayed or sent by the tooling. Values below are Igor's own test
data; tokens/cookies/iCal keys were redacted at capture and never stored.

Capture run: `2026-07-24T08:11:42Z`. Both payloads were captured in one session.

---

## 1. Zone / threshold write

**Endpoint (one per zone type):**
```
PUT https://tpapi.trainingpeaks.com/fitness/v2/athletes/{athleteId}/powerzones
PUT https://tpapi.trainingpeaks.com/fitness/v2/athletes/{athleteId}/heartratezones
PUT https://tpapi.trainingpeaks.com/fitness/v2/athletes/{athleteId}/speedzones
```
**Response:** `204 No Content` (empty body).

**The body is a JSON ARRAY of zone-set objects** — one element per `workoutTypeId`
set that exists for that zone type. Observed: `powerzones` → 1 set, `heartratezones`
→ 1 set, `speedzones` → 2 sets (`workoutTypeId` 0 and 1).

**⚠️ Whole-set overwrite, not a threshold-only patch.** The PUT replaces the entire
array. Each set carries the `threshold` AND the full `zones[]` with every zone's
`minimum`/`maximum` already computed. The client computes the zone boundaries from
`threshold` + `calculationMethod` and sends them explicitly — the request does not
send "just the new threshold". A threshold change to one sport still re-PUTs the whole
array (a pace change re-sent both speed sets).

### Zone-set object fields

| Field | Type | Notes |
|---|---|---|
| `threshold` | number | The threshold value the user set. Unit = pace (m/s) for speed, watts for power, bpm for HR. |
| `workoutTypeId` | int | Which set. `0` is the set TP reads for zone calc (established earlier). |
| `calculationMethod` | int | TP zone-calc enum. Observed: power `5`, HR `2`, speed `2`. Sent as-is. |
| `zones` | array | `[{label, minimum, maximum}]` — boundaries in the same unit as `threshold`. **Computed from threshold client-side, sent in full.** |
| `zoneCalculatorId` | int \| null | `null` observed. |
| `currentUserId` | int | Acting user id (the coach: `5457637`), not the athlete. |
| `distance` | number | power/speed only; `0` observed. |
| `maximumHeartRate` | int | **heartrate only.** |
| `restingHeartRate` | int | **heartrate only.** |

### Observed examples (athlete 3102415, `workoutTypeId: 0`)

```jsonc
// PUT .../speedzones  — array of 2 sets; set[0] shown
{
  "workoutTypeId": 0, "threshold": 3.571428571428571, "calculationMethod": 2,
  "distance": 0, "zoneCalculatorId": null, "currentUserId": 5457637,
  "zones": [
    { "label": "Zone 1", "minimum": 0,                 "maximum": 3.2679738562091503 },
    { "label": "Zone 2", "minimum": 3.2679738562091503,"maximum": 3.7037037037037033 },
    { "label": "Zone 3", "minimum": 3.7037037037037033,"maximum": 3.9840637450199203 }
    // … 7 zones total
  ]
}
```
```jsonc
// PUT .../powerzones set[0]: threshold 285 (W), calcMethod 5, 6 zones, zone[0] {label:"Recovery", min:0, max:159}
// PUT .../heartratezones set[0]: threshold 173 (bpm), calcMethod 2, maximumHeartRate 200, restingHeartRate 200, 7 zones, zone[0] {label:"Zone 1: Recovery", min:0, max:146}
```

### Required vs computed
- **Set by the user:** `threshold` (+ `calculationMethod` if they change the method).
- **Computed from threshold (client-side) and sent:** every `zones[].minimum/maximum`.
- Whether the server would recompute `zones[]` from `threshold` alone is **unverified**
  — the UI always sends the full set, and we do not test writes. Treat the full-array
  form as the known-good contract.

### Do NOT use the settings blob for zones
The same "Save" also fired `PUT /fitness/v1/athletes/{id}/settings` — the **entire
profile object** (email, address, `iCalendarKeys`, `heartRateZones`, `powerZones`,
`speedZones`, …). That endpoint carries PII/secrets and requires the whole blob; the
focused `/fitness/v2/.../{...}zones` endpoints above are the clean zone-write path.

---

## 2. Event / race create

**Endpoint:**
```
POST https://tpapi.trainingpeaks.com/fitness/v6/athletes/{athleteId}/event
```
Note **`/event` (singular)** — the earlier `POST .../events` (plural) with a guessed
body returned HTTP 500. This is the correction.

**Response:** `200 OK` with the created event object; `id` is the numeric event id
(observed `39611915`). Echoes `eventDate` as `"YYYY-MM-DDT00:00:00"`.

### Body fields (captured working request)

| Field | Type | Observed | Notes |
|---|---|---|---|
| `name` | string | `"13414"` | Required. |
| `eventType` | string | `"RunningRoad"` | A real TP event type — **not** `"Other"`. |
| `eventDate` | string | `"2026-07-25"` | `YYYY-MM-DD`. |
| `personId` | int | `3102415` | **The athlete id — field is `personId`, not `athleteId`.** |
| `distance` | number | `5000` | With `distanceUnits`. |
| `distanceUnits` | string | `"meters"` | |
| `atpPriority` | int \| null | `null` | Nullable (ATP priority A/B/C). |
| `raceTypeDuration` | any \| null | `null` | Nullable. |
| `description` | string \| null | `null` | Nullable. |
| `goals` | object | `{}` | Empty object accepted. |
| `legs` | array | `[]` | Empty array accepted (multisport legs). |
| `workouts` | array | `[]` | Empty array accepted. |
| `results` | array | `[{"resultType":"Division"},{"resultType":"Gender"},{"resultType":"Overall"}]` | Result-type placeholders; sent non-empty by the UI. |

```jsonc
// POST .../event  (minimal shape of the captured 200 request)
{
  "name": "13414", "eventType": "RunningRoad", "eventDate": "2026-07-25",
  "personId": 3102415, "distance": 5000, "distanceUnits": "meters",
  "atpPriority": null, "raceTypeDuration": null, "description": null,
  "goals": {}, "legs": [], "workouts": [],
  "results": [{"resultType":"Division"},{"resultType":"Gender"},{"resultType":"Overall"}]
}
```

### Why the earlier attempt 500'd
The recon POST used the wrong endpoint (`/events` plural) **and** a wrong/short body:
`athleteId` instead of `personId`, `eventType:"Other"`, and it was missing
`distance`/`distanceUnits`/`goals`/`legs`/`workouts`/`results`.

### Required vs optional
`name`, `eventType`, `eventDate`, `personId` are clearly required; `distance` +
`distanceUnits` accompany a race. Fields sent as `null`/`[]`/`{}` are likely optional
but **not verified** (we do not test writes). Treat the full captured body as the
known-good contract; trim optional fields only with a live capture, not by guessing.

---

## 3. Calendar Note create (a free note pinned to a day)

**Endpoint:**
```
POST https://tpapi.trainingpeaks.com/fitness/v1/athletes/{athleteId}/calendarNote
```
`/calendarNote` is **singular** and lives under **`/fitness/v1`** (not v6). The athlete id
is the field **`athleteId`** (unlike Event's `personId`).

**Body (captured working request):**
```jsonc
{
  "athleteId": 3102415,
  "title": "gif",
  "noteDate": "2027-01-20T00:00:00",  // YYYY-MM-DDT00:00:00
  "description": "",
  "isHidden": false,
  "attachments": []
}
```

**Response:** the created note object; `id` is the numeric note id (observed `93278873`).
Full read-back shape (`GET /calendarNote/{start}/{end}`):
```jsonc
{ "id": 93278873, "title": "gif", "description": "", "noteDate": "2027-01-20T00:00:00",
  "createdDate": "...", "modifiedDate": "...", "athleteId": 3102415, "isHidden": false,
  "ownerId": 5457637, "appliedPlanId": 0, "parentPlanNoteId": 0, "attachments": [] }
```

**Read:** `GET /fitness/v1/athletes/{id}/calendarNote/{startDate}/{endDate}` → `200` array
(SINGULAR `/calendarNote` with a date range; the plural `/calendarNotes` 404s).
Sub-resource `GET /calendarNote/{id}/comments` → `204` (empty).

**Delete (rollback):** `DELETE /fitness/v1/athletes/{id}/calendarNote/{noteId}`. The
single-resource `GET /calendarNote/{id}` returns `200` (confirmed by read), so DELETE
mirrors that path. The DELETE verb itself is **unverified** — confirm on first rollback.

**Cache:** a Note does **NOT** appear in the `/workouts/{start}/{end}` feed (verified by
reading the same date range), so it never enters `trainingpeaks_workout_cache`. Therefore
a club note created as a native Note needs **no guard sentinel** — unlike the Other(100)
fake-workout marker it replaces. Used by `createNote`/`deleteNote`, gated by
`CLUB_NOTES_AS_NOTE` (kind="note" only).

---

## 4. Availability create (unavailable / limited-availability on a date range)

**Endpoint:**
```
POST https://tpapi.trainingpeaks.com/fitness/v1/athletes/{athleteId}/availability
```
`/fitness/v1`, singular `/availability`. The athlete id is the field **`personId`**.
**Takes a DATE RANGE** (`startDate`..`endDate`), not a single day — consecutive days are
one record.

**Body (captured working request — "unavailable" mode):**
```jsonc
{
  "personId": 3102415,
  "startDate": "2027-01-22",           // YYYY-MM-DD
  "endDate": "2027-01-26",
  "limitedAvailability": false,
  "reason": "",
  "availableSportTypes": [],
  "description": "",
  "type": 1
}
```

**Response / read-back** (`GET /fitness/v1/athletes/{id}/availability/{start}/{end}` → 200
array; single `GET /availability/{id}` → 200):
```jsonc
{ "id": 2435682, "personId": 3102415, "startDate": "2027-01-22T00:00:00",
  "endDate": "2027-01-26T00:00:00", "type": 1, "limitedAvailability": false,
  "reason": "", "description": "", "availableSportTypes": [] }
```

**Delete (rollback):** `DELETE /fitness/v1/athletes/{id}/availability/{availabilityId}`
(single-resource `GET /availability/{id}` returns 200; DELETE mirrors it — unverified verb).

**Second capture — "limited availability" mode** (verified by read; ids 2436620/2436622):
```jsonc
{ "personId": 3102415, "startDate": "2026-12-03", "endDate": "2026-12-03",
  "limitedAvailability": false, "reason": "Injury", "availableSportTypes": [3],
  "description": "", "type": 2 }
```

**Fields — confirmed by reading BOTH records:**
- `type` — **`1` = unable to train** (a club day_off), **`2` = limited availability**.
  Confirmed by GET on both. The mode is carried by `type`.
- `limitedAvailability` — **`false` in BOTH modes** (even type 2). So this boolean does NOT
  carry the mode and is effectively unused for it — set `false` as the UI does; do not
  derive the mode from it.
- `reason` — TP enum, stored **verbatim as a string** (read back `"Injury"`). UI values:
  `Appointment`, `Injury`, `Sick`, `Vacation`, `Work`, `Other` (empty `""` = no reason).
  Whether the API validates against the enum or accepts any string is **unverified** (we do
  not test writes) — send only the enum values.
- `availableSportTypes` — **`[]` for type 1** (what a club day_off uses). For type 2 the
  captured value was `[3]` = **Run**; the id scheme coincides with TP `workoutTypeValueId`
  (Run=3, Bike=2, Swim=1, CrossTrain=5). No sport-type reference endpoint exists (all
  candidates 404); the full list (Brick, Mtn Bike) is **inferred, not captured**. Not needed
  for day_off (type 1, empty).
- `description` — free text; coach-visibility not separately confirmed.

**Cache:** availability does **NOT** appear in the `/workouts` feed (verified by reading the
same range), so it never enters `trainingpeaks_workout_cache` — **no guard needed**.

**Used by** `createAvailability`/`deleteAvailability`, gated by `CLUB_DAYOFF_AS_AVAILABILITY`
(day_off → type 1). A club day_off emits a single-day range (`start=end=date`);
grouping consecutive days into one range record is a batch concern (the single-record
executor does not group). Limited mode (type 2 / sport restriction) is NOT wired — a club
"preference" is a workout-TYPE wish, which `availableSportTypes` (SPORTS, not types) cannot
express, so preferences go to a Note (§3), not Availability.

**Health signal (plan, not wired):** `reason` ∈ {Injury, Sick} should raise a Coach OS
health signal, not stay a calendar marker. See `docs/club-health-signal-from-availability.md`.

---

## 5. Workout structure — create + in-place edit (verified 2026-07-30 via UI capture)

Resolves the open item in `tp-api-capability-matrix.md` (was: full-object workout PUT "not
tested"). Captured passively on athlete `3102415`, test workout `3875087430`
("PI STRUCTURE TEST"): one CREATE, four EDITs (one single-step, three multi-step).

| Op | Method + endpoint | Response |
|---|---|---|
| Create | `POST /fitness/v6/athletes/{athleteId}/workouts` | `200`, returns the workout with a real numeric `workoutId` |
| **Edit in place** | **`PUT /fitness/v6/athletes/{athleteId}/workouts/{workoutId}`** | `200` |

`content-type: application/json`. Cookie→bearer auth (same as everything else).

**Body = the WHOLE workout object** (~70 fields: `title`, `workoutDay`, `workoutTypeValueId`,
`description`, `coachComments`, `workoutComments`, planned/actual metrics, `userTags`, …), NOT
a patch. On create `workoutId: 0`; on edit it carries the real id.

**`structure` is a JSON-encoded STRING** (double-encoded — a string whose content is
`{"structure":[…],"primaryIntensityMetric":"percentOfThresholdPace","primaryLengthMetric":"duration"}`).
Inside: blocks (`type:"step"|"repetition"`, `length:{value,unit}`) → `steps[]` each
`{name, intensityClass ("warmUp"|"active"|"rest"|"coolDown"), length, openDuration,
targets:[{minValue, maxValue}]}`. `minValue`/`maxValue` are **integer percents**.

**PUT overwrites the ENTIRE structure — it does NOT patch a single step.** Observed:
- Edit #1 changed only `Hard` `100-103 → 90-100`, yet the body still carried **all 4 steps**.
- Edit #2 changed `Warm 78-88→63-73`, `Hard→92-99`, `Cool 70-80→44-60` — three steps in **one**
  PUT with the full structure.

**Preserved across an edit:** `workoutId` is **stable** (`3875087430` on all four PUTs → truly
in-place, id kept). `title`, `workoutDay`, `description`, `coachComments`, `workoutComments`
are all fields of the same object and round-trip unchanged when only `structure` is modified.

**Safe recipe to change step %:** GET the workout → modify → PUT the *whole object* back
(never build it from scratch — that would drop the fields you didn't set):
1. `GET /fitness/v6/athletes/{id}/workouts/{workoutId}` (full object; `structure` is a string).
2. `JSON.parse` the `structure` string → change `steps[].targets[0].minValue/maxValue` → `JSON.stringify` back onto the object.
3. `PUT /fitness/v6/athletes/{id}/workouts/{workoutId}` with the (otherwise untouched) object.
4. Verify: `GET` again → targets changed, `workoutId`/`description`/comments intact.

Read-of-shape endpoints seen alongside the edit: `GET …/workouts/{id}` and
`GET …/workouts/{id}/details` (the latter carries the structure) load the object the UI edits.

---

## Safety / provenance
- All mutations were performed by Igor by hand in the UI; the capture tool only
  observed traffic to `tpapi.trainingpeaks.com` / `api.peakswaresb.com`.
- Capture used a **separate** Playwright profile (`.playwright-profile/write-capture`),
  not the `tp-actions-loop` profile and not `~/.tp-reports-bot`; the loop was not paused.
- Only `POST/PUT/PATCH/DELETE` bodies were recorded; GETs are URL+status only.
- `authorization`/`cookie`/`token`/`iCal`/`email` values were `[REDACTED]` before write;
  a leak-scan of the two payload bodies found none.
- **These are capability facts, not permission.** Zone writes remain gated by the
  Zone-write policy in `tp-api-capability-matrix.md` (propose→apply only). Nothing here
  authorizes a direct write.
```
