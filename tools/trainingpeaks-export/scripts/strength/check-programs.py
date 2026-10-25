#!/usr/bin/env python3
"""
Offline check of programs.json against the TP library snapshot. Read-only, no network.

Checks:
  1. every exerciseId exists in the library (946, libraryContent snapshot);
  2. every libraryParameterId belongs to that exercise's parameter set (exercises/{id} snapshot),
     null only when the parameter is NOT in the set (an "added" parameter);
  3. each program has 4-8 exercises, in every week and both formats;
  4. weeks 4 and 8 are deloads: below weeks 3 and 7 — compared by (chain step, sets*value);
  5. sets go 3 -> 4 not before reps/holds grew on the same chain step;
  6. circuit = exactly one Circuit block, all prescriptions sets == rounds, coachNotes "N круга";
     classic = one SingleExercise block per exercise; circuit and classic carry the same exercises/values;
  7. no weight parameters; workout titles in Cyrillic (no Latin letters, in particular not "Cиловая").

Exit 1 on any failure. Run: python3 check-programs.py
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
snap = json.load(open(os.path.join(HERE, "library-snapshot.json"), encoding="utf-8"))
prog = json.load(open(os.path.join(HERE, "programs.json"), encoding="utf-8"))
LIB = {e["exerciseId"] for e in snap["library"]}
PARAMS = snap["exerciseParameters"]
ORDER = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "exercise-order.json"), encoding="utf-8"))["classes"]
errors: list[str] = []


def err(msg: str) -> None:
    errors.append(msg)


def check_presc(where: str, pr: dict, needs_value: bool = True) -> None:
    ex = pr["exerciseId"]
    if ex not in LIB:
        err(f"{where}: exerciseId {ex} not in library")
        return
    if ex not in PARAMS:
        err(f"{where}: no parameter snapshot for exerciseId {ex}")
        return
    lib_set = {p["parameter"]: p["id"] for p in PARAMS[ex]["parameters"]}
    pid = pr["libraryParameterId"]
    if pid is None:
        if pr["parameter"] in lib_set:
            err(f"{where}: {ex} {pr['parameter']} is in the library set ({lib_set[pr['parameter']]}) but id is null")
    elif lib_set.get(pr["parameter"]) != pid:
        err(f"{where}: {ex} {pr['parameter']} id {pid} != library {lib_set.get(pr['parameter'])}")
    if pr["parameter"].startswith("Weight"):
        err(f"{where}: weight parameter is not allowed")
    if needs_value and not re.fullmatch(r"[1-9]\d*", str(pr.get("prescribedValue", ""))):
        err(f"{where}: prescribedValue must be a positive integer string")


# chains
for cid, c in prog["chains"].items():
    for st in c["steps"]:
        check_presc(f"chain {cid}[{st['step']}]", st, needs_value=False)

LATIN = re.compile(r"[A-Za-z]")
for p in prog["programs"]:
    pid = p["id"]
    for fmt in ("classic", "circuit"):
        t = p["workoutTitle"][fmt]
        if LATIN.search(t):
            err(f"{pid}: workout title {t!r} contains Latin letters")
    n_ex = len(p["exercises"])
    if not 4 <= n_ex <= 8:
        err(f"{pid}: {n_ex} exercises, need 4-8")

    weeks_by_fmt = {}
    for fmt in ("classic", "circuit"):
        weeks = {w["week"]: w for w in p["formats"][fmt]}
        weeks_by_fmt[fmt] = weeks
        if sorted(weeks) != list(range(1, 9)):
            err(f"{pid}/{fmt}: weeks {sorted(weeks)} != 1..8")
            continue
        for wn, w in weeks.items():
            if LATIN.search(w["workoutTitle"]):
                err(f"{pid}/{fmt}/w{wn}: Latin letters in title")
            blocks = w["blocks"]
            if fmt == "classic":
                if any(b["blockType"] != "SingleExercise" or len(b["prescriptions"]) != 1 for b in blocks):
                    err(f"{pid}/classic/w{wn}: every block must be SingleExercise with one prescription")
                presc = [b["prescriptions"][0] for b in blocks]
            else:
                if len(blocks) != 1 or blocks[0]["blockType"] != "Circuit":
                    err(f"{pid}/circuit/w{wn}: must be exactly one Circuit block")
                    continue
                b = blocks[0]
                presc = b["prescriptions"]
                rounds = {pr["sets"] for pr in presc}
                if len(rounds) != 1 or rounds != {b["rounds"]}:
                    err(f"{pid}/circuit/w{wn}: sets per exercise {rounds} must all equal rounds {b['rounds']}")
                if not re.fullmatch(rf"{b['rounds']} круг(а|ов)", b["coachNotes"] or ""):
                    err(f"{pid}/circuit/w{wn}: block coachNotes {b['coachNotes']!r} must be 'N круга'")
            if not 4 <= len(presc) <= 8:
                err(f"{pid}/{fmt}/w{wn}: {len(presc)} exercises")
            for i, pr in enumerate(presc):
                check_presc(f"{pid}/{fmt}/w{wn}#{i}", pr)

    # classic vs circuit: same exercises / values / sets
    c, k = weeks_by_fmt.get("classic", {}), weeks_by_fmt.get("circuit", {})
    for wn in range(1, 9):
        if wn not in c or wn not in k:
            continue
        a = [(b["prescriptions"][0]["exerciseId"], b["prescriptions"][0]["prescribedValue"], b["prescriptions"][0]["sets"])
             for b in c[wn]["blocks"]]
        bb = [(pr["exerciseId"], pr["prescribedValue"], pr["sets"]) for pr in k[wn]["blocks"][0]["prescriptions"]]
        # БЫЛО (до 21.10): классика и круг — один и тот же порядок. Отменено решением Игоря о порядке упражнений:
        # классика сортируется по классу, круг — свой порядок, но класс 2 в начале круга. Теперь строже:
        # тот же НАБОР упражнений с теми же значениями и подходами, а порядок каждого формата — по своему правилу.
        if sorted(a) != sorted(bb):
            err(f"{pid}/w{wn}: classic and circuit differ in exercises/values/sets")
        ca = [ORDER[x[0]]["class"] for x in a]
        if ca != sorted(ca):
            err(f"{pid}/w{wn}: classic — класс идёт после большего: {ca}")
        kb = [ORDER[x[0]]["class"] for x in bb]
        if 2 in kb and any(kb[i] != 2 for i in range(kb.count(2))):
            err(f"{pid}/w{wn}: circuit — класс 2 не в начале круга: {kb}")

    # progression per exercise (classic)
    if sorted(c) != list(range(1, 9)):
        continue
    for i in range(n_ex):
        series = [(c[w]["blocks"][i]["prescriptions"][0]) for w in range(1, 9)]
        key = [(pr["step"], pr["sets"] * int(pr["prescribedValue"]), pr["sets"], int(pr["prescribedValue"])) for pr in series]
        name = f"{pid}#{i} {series[0]['title']}"
        for dl, prev in ((4, 3), (8, 7)):
            if not key[dl - 1][:2] < key[prev - 1][:2]:
                err(f"{name}: week {dl} {key[dl-1]} is not below week {prev} {key[prev-1]}")
            if c[dl]["phase"] != "deload":
                err(f"{pid}: week {dl} phase must be deload")
        # sets 3 -> 4 only after value grew on the same step
        for w in range(0, 8):
            step, _, sets, val = key[w]
            if sets > 3:
                start_val = next(k_[3] for k_ in key if k_[0] == step)
                grew = any(k_[0] == step and k_[3] > start_val for k_ in key[:w])
                if not grew:
                    err(f"{name}: 4 sets in week {w+1} before reps/holds grew")
        # step change in exactly one direction per cycle: never more than +1 step
        if max(k_[0] for k_ in key) - key[0][0] > 1:
            err(f"{name}: more than one chain step in 8 weeks")

# каждый exerciseId программ и цепочек — с классом порядка
for p_ in prog["programs"]:
    for fmt_, ws_ in p_["formats"].items():
        for w_ in ws_:
            for b_ in w_["blocks"]:
                for pr_ in b_["prescriptions"]:
                    if pr_["exerciseId"] not in ORDER:
                        err(f"{p_['id']}/{fmt_}/w{w_['week']}: нет класса порядка у {pr_['exerciseId']} {pr_['title']}")

# Длинное тире «—» в тексте, который видит ученик (решение Игоря 25.10): перефразировать, не менять на дефис.
# Поля: название тренировки, описание, заметки блока и упражнения, строка отдыха. Диапазоны «2–3» (короткое тире) не трогаем.
# Проверяются ВСЕ файлы программ, не только programs.json; служебные doc/source/title-метки ученик не видит.
VISIBLE = {"workoutTitle", "instructions", "coachNotes"}


def dash_walk(o, where: str, key: "str | None" = None, in_rest: bool = False) -> None:
    if isinstance(o, dict):
        for k, v in o.items():
            vis_key = key if key == "workoutTitle" and k in ("classic", "circuit") else k
            dash_walk(v, f"{where}.{k}", vis_key, in_rest or k == "rest")
    elif isinstance(o, list):
        for i, v in enumerate(o):
            dash_walk(v, f"{where}[{i}]", key, in_rest)
    elif isinstance(o, str) and "—" in o and (key in VISIBLE or in_rest):
        err(f"{where}: «—» в тексте для ученика: {o!r}")


for f_ in ["programs.json"] + sorted(x for x in os.listdir(HERE) if x.startswith("program-") and x.endswith(".json")):
    dash_walk(json.load(open(os.path.join(HERE, f_), encoding="utf-8")), f_)

if errors:
    print("FAIL")
    for e in errors:
        print(" -", e)
    sys.exit(1)
n_presc = sum(len(w["blocks"]) for p in prog["programs"] for w in p["formats"]["classic"])
print(f"OK: {len(prog['programs'])} programs x 2 formats x 8 weeks, {n_presc} classic prescriptions, "
      f"{len(prog['chains'])} chains; all exerciseIds in library ({len(LIB)}), parameter ids match snapshot")
