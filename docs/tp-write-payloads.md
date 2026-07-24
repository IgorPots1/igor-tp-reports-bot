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
