import process from "node:process";

import {
  buildIllnessMergedSummary,
  collectIllnessClusterItems,
  matchesIllnessSignal,
  matchesUpperRespiratorySignal,
  parseMemoryDuplicateSignals,
  resolveIllnessEpisodeKey,
} from "@/features/trainingpeaks/coach-memory-duplicate-clustering";
import type { TrainingPeaksStudentMemoryType } from "@/features/trainingpeaks/repository";

const LOG_PREFIX = "[check-coach-memory-duplicate-clustering]";

type SignalCase = {
  id: string;
  summary: string;
  expectIllness: boolean;
  expectUpperRespiratory: boolean;
};

type ClusterCase = {
  id: string;
  items: Array<{ id: string; memory_type: TrainingPeaksStudentMemoryType; summary_text: string }>;
  expectEpisodeKey: "health:illness:upper_respiratory" | "health:illness:general" | null;
  expectItemCount: number;
  expectMergedSummary?: string;
};

const SIGNAL_CASES: SignalCase[] = [
  {
    id: "danil-sick-leave-tomorrow",
    summary: "Данил собирается брать больничный завтра.",
    expectIllness: true,
    expectUpperRespiratory: false,
  },
  {
    id: "danil-throat",
    summary: "Данил сообщает о том, что горло запершило.",
    expectIllness: true,
    expectUpperRespiratory: true,
  },
  {
    id: "danil-sick-leave",
    summary: "Данил собирается брать больничный.",
    expectIllness: true,
    expectUpperRespiratory: false,
  },
  {
    id: "danil-illness-report",
    summary: "Данил сообщает о болезни.",
    expectIllness: true,
    expectUpperRespiratory: false,
  },
  {
    id: "knee-pain-only",
    summary: "Данил жалуется на боль в колене.",
    expectIllness: false,
    expectUpperRespiratory: false,
  },
  {
    id: "fatigue-only",
    summary: "Данил пишет об усталости после недели.",
    expectIllness: false,
    expectUpperRespiratory: false,
  },
];

const CLUSTER_CASES: ClusterCase[] = [
  {
    id: "danil-illness-episode",
    items: [
      { id: "1", memory_type: "health_status", summary_text: "Данил собирается брать больничный завтра." },
      { id: "2", memory_type: "health_status", summary_text: "Данил сообщает о том, что горло запершило." },
      { id: "3", memory_type: "health_status", summary_text: "Данил собирается брать больничный." },
      { id: "4", memory_type: "health_status", summary_text: "Данил сообщает о болезни." },
    ],
    expectEpisodeKey: "health:illness:upper_respiratory",
    expectItemCount: 4,
    expectMergedSummary: "Болезнь / першение в горле, планирует взять больничный.",
  },
  {
    id: "knee-pain-not-illness",
    items: [
      { id: "a", memory_type: "pain_or_injury", summary_text: "Болит левое колено после пробежки." },
      { id: "b", memory_type: "pain_or_injury", summary_text: "Колено ноет на спусках." },
    ],
    expectEpisodeKey: null,
    expectItemCount: 0,
  },
  {
    id: "fatigue-not-illness",
    items: [
      { id: "a", memory_type: "load_tolerance", summary_text: "Сильная усталость после блока." },
      { id: "b", memory_type: "emotional_state", summary_text: "Нет сил на тренировки." },
    ],
    expectEpisodeKey: null,
    expectItemCount: 0,
  },
];

function runSignalCases(): string[] {
  const failures: string[] = [];

  for (const testCase of SIGNAL_CASES) {
    const illness = matchesIllnessSignal(testCase.summary);
    const upperRespiratory = matchesUpperRespiratorySignal(testCase.summary);

    if (illness !== testCase.expectIllness) {
      failures.push(`${testCase.id}: illness expected=${String(testCase.expectIllness)} actual=${String(illness)}`);
    }
    if (upperRespiratory !== testCase.expectUpperRespiratory) {
      failures.push(
        `${testCase.id}: upper_respiratory expected=${String(testCase.expectUpperRespiratory)} actual=${String(upperRespiratory)}`
      );
    }
  }

  return failures;
}

function runClusterCases(): string[] {
  const failures: string[] = [];

  for (const testCase of CLUSTER_CASES) {
    const { items } = collectIllnessClusterItems(testCase.items);
    const signals = items
      .map((item) => parseMemoryDuplicateSignals(item.summary_text))
      .filter(Boolean);
    const episodeKey = items.length >= 2 ? resolveIllnessEpisodeKey(signals) : null;

    if (episodeKey !== testCase.expectEpisodeKey) {
      failures.push(
        `${testCase.id}: episode_key expected=${String(testCase.expectEpisodeKey)} actual=${String(episodeKey)}`
      );
    }
    if (items.length !== testCase.expectItemCount) {
      failures.push(
        `${testCase.id}: item_count expected=${testCase.expectItemCount} actual=${items.length}`
      );
    }
    if (testCase.expectMergedSummary && episodeKey) {
      const merged = buildIllnessMergedSummary(episodeKey, signals);
      if (merged !== testCase.expectMergedSummary) {
        failures.push(`${testCase.id}: merged_summary expected=${JSON.stringify(testCase.expectMergedSummary)} actual=${JSON.stringify(merged)}`);
      }
    }
  }

  return failures;
}

function main(): void {
  const failures = [...runSignalCases(), ...runClusterCases()];
  if (failures.length > 0) {
    console.error(`${LOG_PREFIX} FAIL`);
    for (const failure of failures) {
      console.error(`${LOG_PREFIX} ${failure}`);
    }
    process.exit(1);
  }

  console.log(`${LOG_PREFIX} OK signal_cases=${SIGNAL_CASES.length} cluster_cases=${CLUSTER_CASES.length}`);
}

main();
