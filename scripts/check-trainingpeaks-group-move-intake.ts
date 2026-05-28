import { passesTrainingPeaksStrictMoveWorkoutIntentGate } from "@/features/trainingpeaks/service";

function normalizeMoveDetectText(value: string): string {
  return value
    .toLocaleLowerCase("ru")
    .replace(/ё/g, "е")
    .replace(/[.,!?;:()"']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const DIRECT_MOVE_WORDING_PATTERN =
  /(?:^|[\s,.!?;:()"'`])(?:можешь|можно|сдвин(?:уть|ь)|перенести|перенеси|перенесите|поставить|поставь|поставьте|переставить|переставь|сместить)(?:$|[\s,.!?;:()"'`])/u;
const COACH_MENTION_PATTERN = /@\w+/u;

function detectMovePairsPreview(rawText: string): Array<{ source: string; target: string }> {
  const normalized = normalizeMoveDetectText(rawText);
  if (!normalized) {
    return [];
  }

  const tokens = normalized.split(" ").filter((token) => token.length > 0);
  const pairSideTokenPattern = /^[а-яa-z0-9_-]{2,}$/iu;
  const blockedWords = new Set([
    "можешь",
    "можно",
    "сдвинуть",
    "сдвинь",
    "перенести",
    "перенеси",
    "перенесите",
    "поставить",
    "поставь",
    "поставьте",
    "переставить",
    "переставь",
    "сместить",
    "тренировку",
    "тренировки",
  ]);
  const isCompactSide = (raw: string): boolean => {
    const sideTokens = raw
      .trim()
      .split(/\s+/)
      .filter((token) => token.length > 0);
    if (sideTokens.length < 1 || sideTokens.length > 2) {
      return false;
    }
    return sideTokens.every((token) => pairSideTokenPattern.test(token) && !blockedWords.has(token));
  };

  const pairs: Array<{ source: string; target: string }> = [];
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index] !== "на") {
      continue;
    }

    let extracted: { source: string; target: string } | null = null;
    for (const sourceLength of [1, 2]) {
      const sourceStart = index - sourceLength;
      if (sourceStart < 0) {
        continue;
      }
      const source = tokens.slice(sourceStart, index).join(" ").trim();
      if (!isCompactSide(source)) {
        continue;
      }
      for (const targetLength of [1, 2]) {
        const targetEnd = index + 1 + targetLength;
        if (targetEnd > tokens.length) {
          continue;
        }
        const target = tokens.slice(index + 1, targetEnd).join(" ").trim();
        if (!isCompactSide(target)) {
          continue;
        }
        extracted = { source, target };
        break;
      }
      if (extracted) {
        break;
      }
    }

    if (extracted) {
      pairs.push(extracted);
    }
  }
  return pairs.slice(0, 3);
}

function detectGroupMoveMultiMove(rawText: string): {
  detected: boolean;
  possible: boolean;
  reason: string | null;
  movePairsPreview: Array<{ source: string; target: string }>;
} {
  const pairs = detectMovePairsPreview(rawText);
  if (pairs.length >= 2) {
    return {
      detected: true,
      possible: true,
      reason: "multiple source-target phrases",
      movePairsPreview: pairs,
    };
  }

  const normalized = normalizeMoveDetectText(rawText);
  const hasConjunctionSplit = /\b(а|и)\b/.test(normalized);
  const naMatches = normalized.match(/\bна\b/g)?.length ?? 0;
  if (hasConjunctionSplit && naMatches >= 2) {
    return {
      detected: false,
      possible: true,
      reason: "multiple source-target phrases",
      movePairsPreview: pairs,
    };
  }

  return {
    detected: false,
    possible: false,
    reason: null,
    movePairsPreview: pairs,
  };
}

function shouldCreateGroupMoveCase(input: {
  text: string;
  linkedStudent: boolean;
  coachSender: boolean;
  botSender: boolean;
  serviceMessage: boolean;
}): {
  shouldCreateCase: boolean;
  strictMoveIntent: boolean;
  moveWorkoutCandidate: boolean;
  directMoveWording: boolean;
  coachMentioned: boolean;
  multiMove: ReturnType<typeof detectGroupMoveMultiMove>;
} {
  const strictMoveIntent = passesTrainingPeaksStrictMoveWorkoutIntentGate(input.text);
  const moveWorkoutCandidate = strictMoveIntent;
  const directMoveWording = DIRECT_MOVE_WORDING_PATTERN.test(normalizeMoveDetectText(input.text));
  const coachMentioned = COACH_MENTION_PATTERN.test(input.text);
  const multiMove = detectGroupMoveMultiMove(input.text);

  const shouldCreateCase =
    input.linkedStudent &&
    !input.coachSender &&
    !input.botSender &&
    !input.serviceMessage &&
    moveWorkoutCandidate &&
    (coachMentioned || directMoveWording);

  return {
    shouldCreateCase,
    strictMoveIntent,
    moveWorkoutCandidate,
    directMoveWording,
    coachMentioned,
    multiMove,
  };
}

async function run(): Promise<void> {
  let failed = 0;

  const tanyaText =
    "@IgorPotseluev а можешь мне сдвинуть тренировки, поставить сегодняшнюю на пятницу, а субботнюю на воскресенье? Вообще нет сил даже ходить сегодня";
  const tanyaResult = shouldCreateGroupMoveCase({
    text: tanyaText,
    linkedStudent: true,
    coachSender: false,
    botSender: false,
    serviceMessage: false,
  });
  const tanyaOk =
    tanyaResult.shouldCreateCase &&
    tanyaResult.strictMoveIntent &&
    tanyaResult.moveWorkoutCandidate &&
    tanyaResult.multiMove.possible &&
    tanyaResult.multiMove.movePairsPreview.length === 2 &&
    tanyaResult.multiMove.movePairsPreview[0]?.source === "сегодняшнюю" &&
    tanyaResult.multiMove.movePairsPreview[0]?.target === "пятницу" &&
    tanyaResult.multiMove.movePairsPreview[1]?.source === "субботнюю" &&
    tanyaResult.multiMove.movePairsPreview[1]?.target === "воскресенье";
  if (!tanyaOk) {
    failed += 1;
    console.log("FAIL: Tanya-style text must route to case-only intake with strict compact pairs");
  }

  const futureReportText = "Отлично! :) спасибо большое! Как сделаю завтра интервал отпишу";
  const futureReportResult = shouldCreateGroupMoveCase({
    text: futureReportText,
    linkedStudent: true,
    coachSender: false,
    botSender: false,
    serviceMessage: false,
  });
  if (futureReportResult.shouldCreateCase || futureReportResult.strictMoveIntent) {
    failed += 1;
    console.log("FAIL: future report promise must not create group move case");
  }

  const unlinkedSenderResult = shouldCreateGroupMoveCase({
    text: "можешь перенести сегодняшнюю тренировку на пятницу",
    linkedStudent: false,
    coachSender: false,
    botSender: false,
    serviceMessage: false,
  });
  if (unlinkedSenderResult.shouldCreateCase) {
    failed += 1;
    console.log("FAIL: unknown/unlinked sender must not create group move case");
  }

  const singleMoveResult = shouldCreateGroupMoveCase({
    text: "можешь перенести сегодняшнюю тренировку на пятницу",
    linkedStudent: true,
    coachSender: false,
    botSender: false,
    serviceMessage: false,
  });
  if (!singleMoveResult.shouldCreateCase || singleMoveResult.multiMove.possible) {
    failed += 1;
    console.log("FAIL: single move should create case and not be marked multi-move");
  }

  if (failed > 0) {
    console.log(`\n${failed} group move intake check(s) failed.`);
    process.exit(1);
  }

  console.log("All TrainingPeaks group move intake checks passed.");
}

void run();
