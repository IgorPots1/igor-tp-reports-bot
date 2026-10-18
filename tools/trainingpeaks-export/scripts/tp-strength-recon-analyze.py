"""Strength recon, step 2c — OFFLINE analysis of already-fetched strength workouts.

No network. Reads reports/strength/raw/*.json (calendar lists) and
reports/strength/detail/*.json (full workouts) from the canonical checkout and writes:
  reports/strength/analysis-named.md   — with athlete names (gitignored, PII)
  reports/strength/analysis-anon.json  — depersonalized aggregates (athletes as A01, A02…)
and prints the depersonalized summary to stdout.

  python3 -I tools/trainingpeaks-export/scripts/tp-strength-recon-analyze.py [--since=2025-10-18] [--until=2026-10-18]
"""
import datetime as dt
import json
import re
import statistics as st
import sys
from collections import Counter, defaultdict
from pathlib import Path

CANON = Path("/Users/igor/igor-tp-reports-bot")
RAW = CANON / "reports/strength/raw"
DET = CANON / "reports/strength/detail"
OUT = CANON / "reports/strength"

args = dict(a[2:].split("=", 1) for a in sys.argv[1:] if a.startswith("--") and "=" in a)
SINCE = args.get("since", "2025-10-18")
UNTIL = args.get("until", "2026-10-18")
REST_RE = re.compile(r"(отдых|пауз|rest|recover|сек\b|секунд|мин\b|минут|\d+\s*(s|с|сек|''|\"))", re.I)


def median(xs):
    return st.median(xs) if xs else None


def iso_week(d):
    y, w, _ = dt.date.fromisoformat(d).isocalendar()
    return f"{y}-W{w:02d}"


# ---- load ----
names, fetchlog = {}, {}
log = json.loads((RAW / "_fetch-log.json").read_text())
for e in log["log"]:
    names[e["athleteId"]] = e["displayName"]
    fetchlog[e["athleteId"]] = e

workouts = []  # (athleteId, summary, detail|None)
for f in sorted(RAW.glob("[0-9]*.json")):
    d = json.loads(f.read_text())
    for w in d["workouts"]:
        detp = DET / f"{w['id']}.json"
        det = None
        if detp.exists():
            r = json.loads(detp.read_text())
            if r.get("status") == 200:
                det = r["body"]["data"]
        workouts.append((d["athleteId"], w, det))

all_fetched = len(workouts)
future = [x for x in workouts if x[1]["prescribedDate"][:10] > UNTIL]
in_range = [x for x in workouts if SINCE <= x[1]["prescribedDate"][:10] <= UNTIL]
# "Unplanned" rows are device files (title "Strength", hasPrescribedData=false, 0 sets) that
# the strength service also lists — not something the coach prescribed. Keep them out.
unplanned = [x for x in in_range if not x[1].get("hasPrescribedData")]
workouts = [x for x in in_range if x[1].get("hasPrescribedData")]

anon = {}
def A(aid):
    if aid not in anon:
        anon[aid] = f"A{len(anon) + 1:02d}"
    return anon[aid]

# rank athletes by count so A01 = most strength
per_ath = Counter(a for a, _, _ in workouts)
for aid, _ in per_ath.most_common():
    A(aid)

res = {"range": [SINCE, UNTIL]}
res["roster"] = len(fetchlog)
res["fetch_failed"] = [
    {"athlete": A(a) if a in anon else f"X{a % 997}", "statuses": sorted({s["status"] for s in e["statuses"]}),
     "error": next((str(s.get("error"))[:160] for s in e["statuses"] if s.get("error")), None)}
    for a, e in fetchlog.items() if not e["ok"]
]
res["fetched_total_incl_future"] = all_fetched
res["future_after_until"] = len(future)
res["in_range_all"] = len(in_range)
res["unplanned_device_rows_excluded"] = {"n": len(unplanned), "titles": Counter(w["title"] for _, w, _ in unplanned).most_common(5),
                                         "athletes": len({a for a, _, _ in unplanned})}
res["workouts"] = len(workouts)
res["with_detail"] = sum(1 for _, _, d in workouts if d)
res["athletes_with_strength"] = len(per_ath)
res["per_athlete_counts_sorted"] = [c for _, c in per_ath.most_common()]

# ---- frequency ----
weeks_by_ath = defaultdict(Counter)
for a, w, _ in workouts:
    weeks_by_ath[a][iso_week(w["prescribedDate"][:10])] += 1
per_week_in_active = []
per_week_span = {}
for a, wk in weeks_by_ath.items():
    per_week_in_active.extend(wk.values())
    dates = sorted(w["prescribedDate"][:10] for x, w, _ in workouts if x == a)
    span_weeks = max(1, (dt.date.fromisoformat(dates[-1]) - dt.date.fromisoformat(dates[0])).days / 7 + 1)
    per_week_span[A(a)] = round(len(dates) / span_weeks, 2)
res["sessions_per_week_when_any"] = dict(sorted(Counter(per_week_in_active).items()))
res["sessions_per_week_over_active_span_median"] = median(list(per_week_span.values()))
res["sessions_per_week_over_active_span"] = per_week_span
by_month = Counter(w["prescribedDate"][:7] for _, w, _ in workouts)
res["by_month"] = dict(sorted(by_month.items()))
res["weekday"] = dict(Counter(dt.date.fromisoformat(w["prescribedDate"][:10]).strftime("%a") for _, w, _ in workouts))

# ---- state ----
res["complianceState"] = dict(Counter(w["complianceState"] for _, w, _ in workouts))
res["completed_by_athlete_in_app"] = sum(1 for _, w, _ in workouts if w.get("completedDateTime"))
res["isHidden"] = sum(1 for _, w, _ in workouts if w.get("isHidden"))
res["isLocked"] = sum(1 for _, w, _ in workouts if w.get("isLocked"))
res["with_comments"] = sum(1 for _, w, _ in workouts if w.get("totalComments"))
res["with_instructions"] = sum(1 for _, w, d in workouts if (d or w).get("instructions"))
res["titles_top"] = Counter(w["title"] for _, w, _ in workouts).most_common(25)

# ---- structure ----
ex_use, ex_ath, ex_owner, ex_title = Counter(), defaultdict(set), {}, {}
blocktypes, nblocks, npresc, nsets_per_presc = Counter(), [], [], []
param_combo, param_presence = Counter(), Counter()
vals = defaultdict(list)
notes_block = notes_presc = notes_rest = 0
set_values_filled = set_values_empty = 0
custom_ex = Counter()
for a, w, d in workouts:
    if not d:
        continue
    blocks = d.get("blocks") or []
    nblocks.append(len(blocks))
    pc = 0
    for b in blocks:
        blocktypes[b.get("blockType")] += 1
        if b.get("coachNotes"):
            notes_block += 1
            if REST_RE.search(b["coachNotes"]):
                notes_rest += 1
        for p in b.get("prescriptions") or []:
            pc += 1
            ex = p.get("exercise") or {}
            eid = str(ex.get("id"))
            ex_use[eid] += 1
            ex_ath[eid].add(a)
            ex_title[eid] = ex.get("title")
            ex_owner[eid] = ex.get("ownerId")
            if ex.get("ownerId") not in (2000301, None):
                custom_ex[eid] += 1
            if p.get("coachNotes"):
                notes_presc += 1
                if REST_RE.search(p["coachNotes"]):
                    notes_rest += 1
            params = tuple(x.get("parameter") for x in p.get("parameters") or [])
            param_combo[params] += 1
            for x in params:
                param_presence[x] += 1
            sets = p.get("sets") or []
            nsets_per_presc.append(len(sets))
            for s in sets:
                for pv in s.get("parameterValues") or []:
                    v = pv.get("prescribedValue")
                    if v in (None, ""):
                        set_values_empty += 1
                        continue
                    set_values_filled += 1
                    vals[pv.get("parameter")].append(v)
    npresc.append(pc)

def num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        m = re.match(r"^(\d+):(\d+)(?::(\d+))?$", str(v))
        if m:
            h = [int(x) for x in m.groups() if x is not None]
            return h[0] * 60 + h[1] if len(h) == 2 else h[0] * 3600 + h[1] * 60 + h[2]
        return None

def dist(xs):
    n = [num(x) for x in xs]
    n = [x for x in n if x is not None]
    if not n:
        return {"n": len(xs), "sample": xs[:5]}
    c = Counter(n).most_common(8)
    return {"n": len(n), "min": min(n), "median": median(n), "max": max(n), "top": c}

res["blocks_per_workout"] = {"median": median(nblocks), "dist": dict(sorted(Counter(nblocks).items()))}
res["exercises_per_workout"] = {"median": median(npresc), "dist": dict(sorted(Counter(npresc).items()))}
res["sets_per_exercise"] = {"median": median(nsets_per_presc), "dist": dict(sorted(Counter(nsets_per_presc).items()))}
res["blockTypes"] = dict(blocktypes)
res["param_combos_top"] = [[list(k), v] for k, v in param_combo.most_common(12)]
res["param_presence"] = dict(param_presence)
res["value_distributions"] = {k: dist(v) for k, v in vals.items()}
res["set_values_filled_vs_empty"] = [set_values_filled, set_values_empty]
res["coachNotes"] = {"blocks_with_notes": notes_block, "prescriptions_with_notes": notes_presc, "notes_mentioning_rest_or_time": notes_rest}
res["distinct_exercises_used"] = len(ex_use)
res["custom_exercise_uses"] = sum(custom_ex.values())
res["exercises_top"] = [
    {"exerciseId": e, "title": ex_title[e], "system": ex_owner[e] in (2000301, None), "uses": c, "athletes": len(ex_ath[e])}
    for e, c in ex_use.most_common(40)
]

# ---- repeated templates ----
sig_ath, sig_n, sig_title = defaultdict(set), Counter(), {}
sigv_ath, sigv_n = defaultdict(set), Counter()
for a, w, d in workouts:
    if not d:
        continue
    seq = tuple(str((p.get("exercise") or {}).get("id")) for b in d.get("blocks") or [] for p in b.get("prescriptions") or [])
    seqv = tuple(
        (str((p.get("exercise") or {}).get("id")),
         tuple(tuple((pv.get("parameter"), pv.get("prescribedValue")) for pv in s.get("parameterValues") or []) for s in p.get("sets") or []))
        for b in d.get("blocks") or [] for p in b.get("prescriptions") or [])
    sig_ath[seq].add(a); sig_n[seq] += 1; sig_title.setdefault(seq, Counter())[w["title"]] += 1
    sigv_ath[seqv].add(a); sigv_n[seqv] += 1
res["distinct_exercise_sequences"] = len(sig_n)
res["sequences_used_by_2plus_athletes"] = sum(1 for s in sig_ath if len(sig_ath[s]) >= 2)
res["share_workouts_on_shared_sequences"] = round(sum(sig_n[s] for s in sig_ath if len(sig_ath[s]) >= 2) / max(1, sum(sig_n.values())), 3)
res["top_sequences"] = [
    {"n": sig_n[s], "athletes": len(sig_ath[s]), "len": len(s), "title_top": sig_title[s].most_common(2),
     "exercises": [ex_title.get(e) for e in s]}
    for s, _ in sig_n.most_common(12)
]
res["identical_incl_values_shared_by_2plus"] = sum(1 for s in sigv_ath if len(sigv_ath[s]) >= 2)
res["top_identical_incl_values"] = [{"n": sigv_n[s], "athletes": len(sigv_ath[s])} for s, _ in sigv_n.most_common(8)]

# ---- progression: top 3 athletes by count ----
prog = {}
for aid, _ in per_ath.most_common(3):
    rows = sorted(((w["prescribedDate"][:10], d) for a, w, d in workouts if a == aid and d), key=lambda x: x[0])
    exc = Counter(str((p.get("exercise") or {}).get("id")) for _, d in rows for b in d["blocks"] for p in b["prescriptions"])
    track = {}
    for eid, _ in exc.most_common(4):
        series = []
        for date, d in rows:
            for b in d["blocks"]:
                for p in b["prescriptions"]:
                    if str((p.get("exercise") or {}).get("id")) != eid:
                        continue
                    sets = p.get("sets") or []
                    first = {pv["parameter"]: pv.get("prescribedValue") for pv in (sets[0]["parameterValues"] if sets else [])}
                    series.append([date, len(sets), first])
        track[ex_title.get(eid)] = series
    prog[A(aid)] = {"workouts": len(rows), "titles": Counter(t for t in (w["title"] for a, w, _ in workouts if a == aid)).most_common(5), "tracks": track}
res["progression_top3"] = prog

# ---- write ----
(OUT / "analysis-anon.json").write_text(json.dumps(res, ensure_ascii=False, indent=1, default=str))
lines = ["# Strength analysis (NAMED, PII — do not commit)", "", f"range {SINCE}..{UNTIL}", "", "| code | athleteId | name | strength | /week span |", "|---|---|---|---|---|"]
for aid, c in per_ath.most_common():
    lines.append(f"| {A(aid)} | {aid} | {names.get(aid)} | {c} | {per_week_span[A(aid)]} |")
lines += ["", "## fetch failures", ""]
for a, e in fetchlog.items():
    if not e["ok"]:
        lines.append(f"- {a} {names.get(a)}: {[s['status'] for s in e['statuses']]} {next((str(s.get('error'))[:200] for s in e['statuses'] if s.get('error')), '')}")
(OUT / "analysis-named.md").write_text("\n".join(lines) + "\n")
print(json.dumps(res, ensure_ascii=False, indent=1, default=str))
