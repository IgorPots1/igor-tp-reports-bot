#!/usr/bin/env python3
"""
Strength programs for runners — generator of programs.json (no TP writes, no DB, no messages).

Input:  library-snapshot.json (same dir; GET-only snapshot of the TP exercise library)
Output: programs.json (same dir)

Everything that is a coach decision or a design choice lives in the SPEC below, each with a
source tag:
  [решение Игоря] — fixed by the coach, not discussed;
  [практика]      — from the coach's own 889 strength workouts (2025-10-18..2026-10-18), with counts;
  [литература]    — a concrete published source (exercise choice / progression only);
  [выведено]      — derived by us, with the reason.
Practice counts are anonymised aggregates ("N назначений / M атлетов"), no names.

Run: python3 build-programs.py
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
SNAP = json.load(open(os.path.join(HERE, "library-snapshot.json"), encoding="utf-8"))
LIB = {e["exerciseId"]: e for e in SNAP["library"]}
PARAMS = SNAP["exerciseParameters"]

# ─── literature (exercise choice / progression; never overrides the coach) ─────────────────
LIT = {
    "blagrove2018": "Blagrove RC, Howatson G, Hayes PR. Effects of strength training on the physiologic "
    "determinants and performance of middle- and long-distance running: a systematic review. "
    "Sports Med. 2018;48(5):1117-1149.",
    "lauersen2014": "Lauersen JB, Bertelsen DM, Andersen LB. The effectiveness of exercise interventions to "
    "prevent sports injuries: a systematic review and meta-analysis of RCTs. Br J Sports Med. 2014;48(11):871-877.",
    "dorn2012": "Dorn TW, Schache AG, Pandy MG. Muscular strategy shift in human running: dependence of "
    "running speed on hip and ankle muscle performance. J Exp Biol. 2012;215(11):1944-1956.",
    "mcgill2015": "McGill S. Low Back Disorders: Evidence-Based Prevention and Rehabilitation. 3rd ed. "
    "Human Kinetics; 2015 («big three»: curl-up, side bridge, bird dog).",
    "ekstrom2007": "Ekstrom RA, Donatelli RA, Carp KC. Electromyographic analysis of core trunk, hip, and thigh "
    "muscles during 9 rehabilitation exercises. J Orthop Sports Phys Ther. 2007;37(12):754-762.",
    "distefano2009": "Distefano LJ, Blackburn JT, Marshall SW, Padua DA. Gluteal muscle activation during "
    "common therapeutic exercises. J Orthop Sports Phys Ther. 2009;39(7):532-540.",
    "spurrs2003": "Spurrs RW, Murphy AJ, Watsford ML. The effect of plyometric training on distance running "
    "performance. Eur J Appl Physiol. 2003;89(1):1-7.",
    "acsm2009": "American College of Sports Medicine. Position stand: progression models in resistance "
    "training for healthy adults. Med Sci Sports Exerc. 2009;41(3):687-708.",
}

# ─── chains: progression of variants, easiest first. Every step = a real library exercise. ──
# step: (exerciseId, parameter, coachNotes, noteSource, stepSource)
# parameter must be in the exercise's library parameter set, unless added=True (no library id).
CHAINS = {
    "bridge": {
        "title": "Ягодичный мост",
        "source": "[литература] ekstrom2007 (мост на одной ноге — высокая активность большой и средней "
        "ягодичной); порядок двух → одна нога → стопа на возвышении — [выведено]: растёт плечо и нагрузка на одну ногу",
        "steps": [
            ("579", "Reps", "без веса, поясница не прогибается",
             "«без веса» — [практика] 321 раз в заметках; «поясница не прогибается» — [практика] его формула у DeadBug (60 раз)"),
            ("81", "RepsPerSide", "без веса, таз держи ровно",
             "«без веса» — [практика]; «таз ровно» — новое [выведено]: у него заметок к мосту нет (575 назначений без заметки)"),
            ("81", "Duration", "удержание наверху, на каждую ногу",
             "новое [выведено]; Duration у этого упражнения — ДОБАВЛЕННЫЙ параметр (в наборе только RepsPerSide), "
             "так он сам делал у DeadBug 89 раз", True),
            ("827", "RepsPerSide", "стопа на возвышении (ступенька, диван)", "новое [выведено]"),
        ],
    },
    "calf_straight": {
        "title": "Икры (прямое колено)",
        "source": "[литература] dorn2012 (икроножная и камбаловидная — главный вклад в опорную реакцию в беге); "
        "порядок две ноги → одна на ровном → одна с возвышения (амплитуда) — [выведено]",
        "steps": [
            ("859", "Reps", "без веса", "[практика] у этого упражнения «без веса» 25 из 25 назначений (3 атлета)"),
            ("26", "RepsPerSide", "на ровном", "[практика] «на ровном» 39 раз / 3 атлета (+ «на ровном делай» 7)"),
            ("554", "RepsPerSide", "с возвышения, пятка опускается ниже опоры",
             "новое [выведено]: следующая ступень после «на ровном» — полная амплитуда"),
        ],
    },
    "calf_bent": {
        "title": "Икры (согнутое колено, камбаловидная)",
        "source": "[литература] dorn2012 (камбаловидная — наибольшая сила среди мышц ноги в беге); "
        "у Игоря отдельного упражнения на камбаловидную нет — [выведено]",
        "steps": [
            ("26", "RepsPerSide", "колено чуть согнуто, на ровном",
             "«на ровном» — [практика]; «колено согнуто» — новое [выведено]: в библиотеке нет стоячего подъёма на согнутом колене"),
            ("520", "RepsPerSide", "сидя, гантель на колене, носок на возвышении", "новое [выведено]"),
        ],
    },
    "tibialis": {
        "title": "Передняя большеберцовая",
        "source": "[практика] Anterior Tibialis Raise — его собственное упражнение, 46 назначений / 5 атлетов; "
        "вторая ступень «на одной ноге» — тот же exerciseId, другой заметкой [выведено] (в библиотеке ступени сложнее нет)",
        "steps": [
            ("387588", "Reps", "спиной к стене, поднимай носки", "новое [выведено]: у него заметок нет"),
            ("387588", "Reps", "на каждую ногу, спиной к стене", "«на каждую ногу» — [практика] 11 раз"),
        ],
    },
    "hops": {
        "title": "Прыжковые на стопу",
        "source": "[литература] spurrs2003 (плиометрика улучшает экономичность бега через жёсткость сухожилия); "
        "порядок без полёта → две ноги → одна нога — [выведено]",
        "steps": [
            ("5369", "RepsPerSide", "быстрые короткие подъёмы на носок, одна стопа на опоре", "новое [выведено]"),
            ("625", "Reps", "можно без скакалки — прыжки на месте на носках", "новое [выведено]"),
            ("5404", "RepsPerSide", "мягко на носок, колено почти прямое", "новое [выведено]"),
        ],
    },
    "split_squat": {
        "title": "Выпады / болгарские",
        "source": "[практика] Bulgarian Split Squat — 433 назначения / 38 атлетов; порядок сплит-присед → болгарский → "
        "болгарский с гантелями — [выведено] (плечо и вес)",
        "steps": [
            ("447", "RepsPerSide", "без веса, колено над стопой", "«без веса» — [практика]; «колено над стопой» — новое"),
            ("443", "RepsPerSide", "без веса, глубоко не опускайтесь",
             "[практика] его заметки к этому упражнению: «Без веса», «Глубоко не опускайтесь» (по 1 разу)"),
            ("500", "RepsPerSide", "1й раз без веса, дальше с гантелями",
             "[практика] его заметка к DB Bulgarian: «1й раз без веса» 7, «1й разминочный» 13"),
        ],
    },
    "single_leg_squat": {
        "title": "Присед на одной ноге",
        "source": "[практика] Single Leg Box Squat 178 / 15 атлетов, High Box 16 / 1; высокая опора → низкая → без опоры — "
        "[выведено] (глубина без страховки)",
        "steps": [
            ("828", "RepsPerSide", "высокая опора, глубоко не садись", "«глубоко не садись» — [практика] (1 раз, Single Leg Standing Squat)"),
            ("5402", "RepsPerSide", "глубоко не опускайтесь", "[практика] его формулировка (1 раз)"),
            ("5405", "RepsPerSide", "глубоко не садись", "[практика] его заметка к этому упражнению (1 раз)"),
        ],
    },
    "sl_deadlift": {
        "title": "Становая на одной ноге",
        "source": "[практика] DB Single Leg Deadlift 295 / 28 атлетов, почти всегда «без веса»; [литература] distefano2009 "
        "(становая на одной ноге — высокая активность средней ягодичной)",
        "steps": [
            ("523", "RepsPerSide", "без веса", "[практика] «без веса/Без веса/БЕЗ ВЕСА» у становой на одной ноге 229 раз / 19+ атлетов"),
            ("648", "RepsPerSide", "с гантелью + 1 разминочный сделай без веса",
             "[практика] его заметка дословно (4 раза у DB Single Leg Deadlift)"),
            ("523", "RepsPerSide", "с двумя гантелями", "[практика] его заметка (7 раз)"),
        ],
    },
    "step_up": {
        "title": "Зашагивания",
        "source": "[практика] Step Up with Knee Raise 274 / 27 атлетов; следующая ступень — с гантелями [выведено]",
        "steps": [
            ("876", "RepsPerSide", "без веса", "[практика] 10 раз / 2 атлета"),
            ("165", "RepsPerSide", "1й разминочный без веса, дальше с гантелями", "[практика] «1й разминочный» 112 раз + «с гантелями» 4"),
        ],
    },
    "front_plank": {
        "title": "Планка",
        "source": "[практика] Forearm Plank 293 / 31 атлет; планка → с подъёмом ноги → ноги на возвышении — [выведено]",
        "steps": [
            ("571", "Duration", "на локтях, поясница не прогибается", "«На локтях» — [практика] 13; «поясница не прогибается» — [практика]"),
            ("5215", "RepsPerSide", "на каждую ногу", "[практика] у этого упражнения «на каждую ногу» 11, «по 10 раз на каждую сторону» 15"),
            ("530", "Duration", "ноги на возвышении, поясница не прогибается", "новое [выведено]"),
        ],
    },
    "side_plank": {
        "title": "Боковая планка",
        "source": "[практика] Side Plank 366 / 32 атлета; [литература] mcgill2015 (side bridge), ekstrom2007 "
        "(высокая активность средней ягодичной); с опусканием таза → с ракушкой — [выведено]",
        "steps": [
            ("79", "Duration", "на локте, на каждую сторону", "новое (в стиле его «на каждую ногу»); у него к планке заметок нет"),
            ("792", "RepsPerSide", "на локте, таз опускай плавно", "новое [выведено]"),
            ("794", "RepsPerSide", "резинка над коленями, таз не проваливается", "новое [выведено]"),
        ],
    },
    "clam": {
        "title": "Ракушка",
        "source": "[практика] Banded Clam Shell 95 / 13 атлетов; [литература] distefano2009 (лёжа на боку — "
        "высокая активность средней ягодичной); лёжа → в боковой планке — [выведено]",
        "steps": [
            ("418", "RepsPerSide", "резинка над коленями, стопы вместе", "новое [выведено]"),
            ("793", "Duration", "резинка над коленями, колено держи вверху", "новое [выведено]"),
            ("794", "RepsPerSide", "резинка над коленями", "новое [выведено]"),
        ],
    },
    "band_walk": {
        "title": "Шаги с резинкой",
        "source": "[практика] Band Crab Walk 70 / 8 атлетов; [литература] distefano2009 (боковые шаги с резинкой); "
        "X Band Walk — сложнее (резинка крест-накрест) [выведено]",
        "steps": [
            ("5191", "RepsPerSide", "шаги короткие, резинка все время в натяжении",
             "[практика] его заметка «10 шагов в каждую сторону (шаги короткие, резинка все время в натяжение)» (10)"),
            ("942", "RepsPerSide", "шаги короткие, резинка все время в натяжении", "та же формулировка [практика]"),
        ],
    },
    "dead_bug": {
        "title": "Мёртвый жук",
        "source": "[практика] DeadBug 160 / 7 атлетов; DeadBug → Hollow Hold → Hollow Rock — [выведено] (длиннее рычаг)",
        "steps": [
            ("528", "RepsPerSide", "следите за тем, чтобы поясница не прогибалась (ноги выше держите)",
             "[практика] дословно, 33 раза"),
            ("5310", "Duration", "следите, чтобы поясница не прогибалась (ноги выше держите)", "[практика] формулировка с DeadBug"),
            ("5311", "Reps", "делай очень плавно, поясница не прогибается", "[практика] формулировка с DeadBug"),
        ],
    },
    "bird_dog": {
        "title": "Птица-собака",
        "source": "[практика] Bird Dog 19 / 2 атлета; [литература] mcgill2015 (bird dog в «big three»); "
        "с резинкой → с тягой — [выведено]",
        "steps": [
            ("440", "RepsPerSide", "сильно спину не прогибайте", "[практика] его формулировка с Alternating Superman (33)"),
            ("5203", "RepsPerSide", "сильно спину не прогибайте", "[практика]"),
            ("5228", "RepsPerSide", "сильно спину не прогибайте, без веса или лёгкая гантель", "[практика] + [выведено]"),
        ],
    },
}

# ─── programs: item = (chainId, startStep, A, delta, B0, startSource) ──────────────────────
# A = start value, A+delta = after the reps/holds step, B0 = start value on the next chain step (week 7).
PROGRAMS = [
    {
        "id": "beginner",
        "title": "Базовая для новичка",
        "workoutTitle": {"classic": "Силовая — база", "circuit": "Силовая круговая — база"},
        "purpose": "первая силовая: всё без веса, двусторонние и простые варианты",
        "items": [
            ("bridge", 0, 15, 5, 10, "[практика] Glute Bridge — Reps 15/20 (7 назначений); W7 на одну ногу с 10 [выведено]"),
            ("calf_straight", 0, 15, 5, 12, "[практика] Standing DB Calf Raise — Reps 15 в 25 из 25"),
            ("split_squat", 0, 10, 2, 10, "[практика] сплит-присед: RepsPerSide 15/12; старт с 10 для новичка [выведено], 10 у болгарского — 110 назначений"),
            ("front_plank", 0, 30, 10, 10, "[практика] Forearm Plank 30 с — 12 назначений, 40 — 36 (медиана 45); новичку 30 [выведено]"),
            ("side_plank", 0, 20, 10, 10, "[практика] Side Plank 20 с — 6, 30 — 341 из 366; новичку 20 [выведено]"),
            ("bird_dog", 0, 10, 2, 10, "[практика] Bird Dog RepsPerSide 12/15 (19 назначений); новичку 10 [выведено]"),
        ],
    },
    {
        "id": "main",
        "title": "Основная для бегуна",
        "workoutTitle": {"classic": "Силовая — основная", "circuit": "Силовая круговая — основная"},
        "purpose": "базовый набор бегуна: ягодичные, икры, одна нога, корпус",
        "items": [
            ("bridge", 1, 12, 3, 20, "[практика] Single Leg Glute Bridge — 15 в 369 из 575, 12 в 78; старт 12 → 15 [выведено]; W7 удержание 20 с [выведено]"),
            ("calf_straight", 1, 15, 5, 12, "[практика] Single Leg Calf Raise — 15 в 366 из 540, 20 в 140"),
            ("split_squat", 1, 10, 2, 10, "[практика] Bulgarian — 15/12/10 (153/138/110 из 433)"),
            ("sl_deadlift", 0, 12, 3, 10, "[практика] DB Single Leg Deadlift — 15 в 265 из 295; старт 12 [выведено]"),
            ("step_up", 0, 12, 3, 10, "[практика] Step Up with Knee Raise — 15 в 125, 12 в 34 из 274"),
            ("side_plank", 0, 30, 10, 10, "[практика] Side Plank 30 с — 341 из 366"),
            ("dead_bug", 0, 12, 4, 20, "[практика] DeadBug RepsPerSide 16–30 (71 назначение); старт 12 [выведено]; Hollow Hold 20 с [выведено]"),
        ],
    },
    {
        "id": "foot_calf",
        "title": "Упор на стопу и икры",
        "workoutTitle": {"classic": "Силовая — стопа и икры", "circuit": "Силовая круговая — стопа и икры"},
        "purpose": "икры (прямое и согнутое колено), передняя большеберцовая, прыжковые на стопу, баланс на одной ноге",
        "items": [
            ("calf_straight", 1, 15, 5, 12, "[практика] Single Leg Calf Raise — 15 в 366 из 540, 20 в 140"),
            ("calf_bent", 0, 12, 3, 12, "[выведено] на согнутом колене амплитуда меньше — старт ниже прямого"),
            ("tibialis", 0, 15, 5, 12, "[практика] Anterior Tibialis Raise — Reps 20 в 38 из 46, 15 в 6"),
            ("hops", 0, 15, 5, 30, "[выведено] прыжковые — малый объём на старте; Jump Rope 30 прыжков [выведено]"),
            ("sl_deadlift", 0, 10, 2, 10, "[практика] DB Single Leg Deadlift — 15 в 265 из 295; здесь акцент на баланс, старт 10 [выведено]"),
            ("single_leg_squat", 0, 8, 2, 8, "[практика] Single Leg High Box Squat 12 (16 из 16), Box Squat 10–15; старт 8 [выведено]"),
            ("bridge", 1, 12, 3, 20, "[практика] Single Leg Glute Bridge — 15 в 369 из 575; W7 удержание 20 с [выведено]"),
        ],
    },
    {
        "id": "core_glutes",
        "title": "Упор на корпус и ягодичные",
        "workoutTitle": {"classic": "Силовая — корпус и ягодичные", "circuit": "Силовая круговая — корпус и ягодичные"},
        "purpose": "средняя и большая ягодичные, боковая и передняя стабилизация корпуса",
        "items": [
            ("bridge", 1, 12, 3, 20, "[практика] Single Leg Glute Bridge — 15 в 369 из 575; W7 удержание 20 с [выведено]"),
            ("clam", 0, 15, 5, 20, "[практика] Banded Clam Shell — 25 в 67, 20 в 28 из 95; старт 15 [выведено]; удержание 20 с [выведено]"),
            ("band_walk", 0, 10, 5, 10, "[практика] Band Crab Walk — 15 в 51, 20 в 19 из 70; его «10 шагов в каждую сторону» 19 раз"),
            ("side_plank", 0, 30, 10, 12, "[практика] Side Plank 30 с — 341 из 366"),
            ("front_plank", 0, 40, 10, 10, "[практика] Forearm Plank 45 с — 201 из 293, 40 — 36, 50 — 42"),
            ("dead_bug", 0, 12, 4, 20, "[практика] DeadBug RepsPerSide 16–30; старт 12 [выведено]"),
            ("bird_dog", 0, 12, 3, 10, "[практика] Bird Dog — 15 в 16 из 19, 12 в 2"),
        ],
    },
]

# ─── 8-week scheme ─────────────────────────────────────────────────────────────────────────
# Per week: (week, phase, stepOffset, sets, valueKind, label)
#   valueKind: "A" | "A+d" | "B0"
SCHEME = [
    (1, "start", 0, 3, "A", "Старт: 3 подхода, стартовые повторы/удержание"),
    (2, "start", 0, 3, "A", "Повтор недели 1"),
    (3, "reps_up", 0, 3, "A+d", "Шаг 1: растут повторы/удержание"),
    (4, "deload", 0, 3, "A", "Разгрузка: шаг назад к неделям 1–2"),
    (5, "sets_up", 0, 4, "A+d", "Шаг 2: подходы 3 → 4 (повторы уже выросли на неделе 3)"),
    (6, "sets_up", 0, 4, "A+d", "Повтор недели 5"),
    (7, "variant_up", 1, 3, "B0", "Шаг 3: вариант сложнее по цепочке, снова 3 подхода"),
    (8, "deload", 0, 3, "A+d", "Разгрузка: шаг назад — прежний вариант, 3 подхода (как неделя 3)"),
]
SCHEME_SOURCE = (
    "[решение Игоря] прогрессия повторы/удержания → подходы 3→4 → вариант сложнее; 1 силовая в неделю → шаг раз в "
    "2 недели; разгрузка на 4-й и 8-й неделе (шаг назад). Конкретная раскладка шагов по неделям 3/5/7 и форма "
    "разгрузки — [выведено]. Общий принцип прогрессивной перегрузки — [литература] acsm2009."
)
PLACEMENT = [
    "Не в день качественной тренировки [решение Игоря].",
    "Не накануне длительной [решение Игоря].",
    "1 силовая в неделю [решение Игоря]; при 2 в неделю шаг прогрессии раз в неделю — не проектировалось, вопрос Игорю.",
    "Следующий 8-недельный цикл начинается с уровня недели 7 (вариант по цепочке выше) [выведено].",
]

UNILATERAL_INSTR = "Начинай с более слабой ноги, важно делать одинаковое кол-во повторений на каждую ногу"
DELOAD_INSTR = "Разгрузочная неделя — легче, чем прошлая"


def plural_krug(n: int) -> str:
    return f"{n} круга" if n in (2, 3, 4) else f"{n} кругов"


def step_obj(chain_id: str, idx: int) -> dict:
    st = CHAINS[chain_id]["steps"][idx]
    ex_id, param, note, note_src = st[0], st[1], st[2], st[3]
    added = len(st) > 4 and st[4]
    lib_params = PARAMS[ex_id]["parameters"]
    lib_param_id = next((p["id"] for p in lib_params if p["parameter"] == param), None)
    if lib_param_id is None and not added:
        raise SystemExit(f"{chain_id}[{idx}] {ex_id}: parameter {param} not in library set and not marked added")
    if lib_param_id is not None and added:
        raise SystemExit(f"{chain_id}[{idx}] {ex_id}: parameter {param} is in library set but marked added")
    return {
        "step": idx,
        "exerciseId": ex_id,
        "title": LIB[ex_id]["title"],
        "parameter": param,
        "libraryParameterId": lib_param_id,
        "addedParameter": lib_param_id is None,
        "coachNotes": note,
        "coachNotesSource": note_src,
    }


def build() -> dict:
    chains_out = {}
    for cid, c in CHAINS.items():
        chains_out[cid] = {
            "title": c["title"],
            "source": c["source"],
            "steps": [step_obj(cid, i) for i in range(len(c["steps"]))],
        }

    programs_out = []
    for p in PROGRAMS:
        unilateral = any(chains_out[i[0]]["steps"][i[1]]["parameter"] == "RepsPerSide" for i in p["items"])
        exercises = []
        for cid, start, a, d, b0, src in p["items"]:
            if start + 1 >= len(CHAINS[cid]["steps"]):
                raise SystemExit(f"{p['id']}/{cid}: no next chain step for week 7")
            exercises.append({
                "chainId": cid,
                "startStep": start,
                "startValue": str(a),
                "repsStep": str(d),
                "nextStepStartValue": str(b0),
                "startSource": src,
            })
        formats = {"classic": [], "circuit": []}
        for week, phase, off, sets, kind, label in SCHEME:
            prescriptions = []
            for cid, start, a, d, b0, _src in p["items"]:
                st = chains_out[cid]["steps"][start + off]
                value = {"A": a, "A+d": a + d, "B0": b0}[kind]
                prescriptions.append({
                    "chainId": cid,
                    "step": start + off,
                    "exerciseId": st["exerciseId"],
                    "title": st["title"],
                    "parameter": st["parameter"],
                    "libraryParameterId": st["libraryParameterId"],
                    "sets": sets,
                    "prescribedValue": str(value),
                    "coachNotes": st["coachNotes"],
                })
            instr = [UNILATERAL_INSTR] if unilateral else []
            if phase == "deload":
                instr.append(DELOAD_INSTR)
            instructions = ". ".join(instr) or None
            formats["classic"].append({
                "week": week, "phase": phase,
                "workoutTitle": p["workoutTitle"]["classic"],
                "instructions": instructions,
                "blocks": [{"blockType": "SingleExercise", "coachNotes": None, "prescriptions": [pr]} for pr in prescriptions],
            })
            # Circuit: one block, rounds = sets of EVERY exercise (TP has no separate rounds field —
            # live probe 2026-10-19), label in block coachNotes.
            rounds = sets
            formats["circuit"].append({
                "week": week, "phase": phase,
                "workoutTitle": p["workoutTitle"]["circuit"],
                "instructions": instructions,
                "blocks": [{
                    "blockType": "Circuit",
                    "coachNotes": plural_krug(rounds),
                    "rounds": rounds,
                    "prescriptions": [dict(pr, sets=rounds) for pr in prescriptions],
                }],
            })
        programs_out.append({
            "id": p["id"],
            "title": p["title"],
            "purpose": p["purpose"],
            "workoutTitle": p["workoutTitle"],
            "workoutTitleSource": "[выведено] кириллицей; в практике «Cиловая» с латинской C — 169 раз (ошибка, не повторять), "
            "«Strength Workout» (дефолт TP) — 598",
            "exercises": exercises,
            "formats": formats,
        })

    return {
        "schemaVersion": 1,
        "doc": "docs/strength-programs.md",
        "note": "Только проект. Ничего не записано в TrainingPeaks/Supabase. Вес числом не задаётся [решение Игоря].",
        "legend": {
            "[решение Игоря]": "задано тренером, не обсуждается",
            "[практика]": "из 889 тренерских силовых за 2025-10-18..2026-10-18, с числами",
            "[литература]": "конкретный источник, см. literature",
            "[выведено]": "наш вывод, обоснование рядом",
        },
        "literature": LIT,
        "tpModel": {
            "classic": "по блоку SingleExercise на упражнение, sets = подходы",
            "circuit": "один блок Circuit; отдельного поля «число кругов» нет (block.parameters=[]): круги = sets у "
            "каждого упражнения блока, подпись «N круга» — в coachNotes блока (живая проба 2026-10-19)",
            "addedParameter": "libraryParameterId=null — параметра нет в наборе упражнения; в TP он получит id при сохранении "
            "тренировки (так в практике: DeadBug+Duration, 89 раз)",
            "weight": "вес не задаётся; WeightLb/WeightKg в prescriptions не включаются",
        },
        "schedule": {
            "frequencyPerWeek": 1,
            "source": SCHEME_SOURCE,
            "weeks": [{"week": w, "phase": ph, "chainStepOffset": off, "sets": s, "value": k, "label": lb}
                      for w, ph, off, s, k, lb in SCHEME],
            "placementRules": PLACEMENT,
        },
        "chains": chains_out,
        "programs": programs_out,
    }


if __name__ == "__main__":
    out = build()
    path = os.path.join(HERE, "programs.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
        f.write("\n")
    print(f"wrote {path}: {len(out['programs'])} programs, {len(out['chains'])} chains")
