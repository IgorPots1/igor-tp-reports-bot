import process from "node:process";

import {
  buildIllnessMergedSummary,
  collectIllnessClusterEpisodes,
  matchesIllnessSignal,
  matchesUpperRespiratorySignal,
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
  expectEpisodes: Array<{
    episodeKey: "health:illness:upper_respiratory" | "health:illness:general";
    itemCount: number;
    expectMergedSummary?: string;
  }>;
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
    summary: "После горок заболело колено.",
    expectIllness: false,
    expectUpperRespiratory: false,
  },
  {
    id: "dry-throat-after-training",
    summary: "Горло пересохло после тренировки.",
    expectIllness: false,
    expectUpperRespiratory: false,
  },
  {
    id: "fatigue-only",
    summary: "Данил пишет об усталости после недели.",
    expectIllness: false,
    expectUpperRespiratory: false,
  },
  {
    id: "flu-russian",
    summary: "Температура и грипп, врач подтвердил ОРВИ.",
    expectIllness: true,
    expectUpperRespiratory: true,
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
    expectEpisodes: [
      {
        episodeKey: "health:illness:upper_respiratory",
        itemCount: 4,
        expectMergedSummary: "Болезнь / першение в горле, планирует взять больничный.",
      },
    ],
  },
  {
    id: "knee-pain-not-illness",
    items: [
      { id: "a", memory_type: "pain_or_injury", summary_text: "После горок заболело колено." },
      { id: "b", memory_type: "pain_or_injury", summary_text: "Колено ноет на спусках." },
    ],
    expectEpisodes: [],
  },
  {
    id: "dry-throat-not-illness",
    items: [
      { id: "a", memory_type: "health_status", summary_text: "Горло пересохло после тренировки." },
      { id: "b", memory_type: "health_status", summary_text: "Усталость и жажда после интервального дня." },
    ],
    expectEpisodes: [],
  },
  {
    id: "fatigue-not-illness",
    items: [
      { id: "a", memory_type: "load_tolerance", summary_text: "усталость, нет сил после работы" },
      { id: "b", memory_type: "emotional_state", summary_text: "Нет сил на тренировки после долгого дня." },
    ],
    expectEpisodes: [],
  },
  {
    id: "distant-illness-episodes-split",
    items: [
      {
        id: "jan-1",
        memory_type: "health_status",
        summary_text: "Январь: температура, больничный и сильная простуда.",
        valid_from: "2026-01-10",
      },
      {
        id: "jan-2",
        memory_type: "health_status",
        summary_text: "Январь: горло болит, продолжается ОРВИ.",
        valid_from: "2026-01-16",
      },
      {
        id: "apr-1",
        memory_type: "health_status",
        summary_text: "Апрель: снова температура и грипп.",
        valid_from: "2026-04-11",
      },
      {
        id: "apr-2",
        memory_type: "health_status",
        summary_text: "Апрель: больничный на фоне вируса.",
        valid_from: "2026-04-18",
      },
    ],
    expectEpisodes: [
      { episodeKey: "health:illness:upper_respiratory", itemCount: 2 },
      { episodeKey: "health:illness:upper_respiratory", itemCount: 2 },
    ],
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
    const episodes = collectIllnessClusterEpisodes(testCase.items).filter((episode) => episode.items.length >= 2);
    const actualEpisodes = episodes.map((episode) => ({
      episodeKey: resolveIllnessEpisodeKey(episode.signals),
      itemCount: episode.items.length,
      mergedSummary: buildIllnessMergedSummary(resolveIllnessEpisodeKey(episode.signals), episode.signals),
    }));

    if (actualEpisodes.length !== testCase.expectEpisodes.length) {
      failures.push(
        `${testCase.id}: episode_count expected=${testCase.expectEpisodes.length} actual=${actualEpisodes.length}`
      );
      continue;
    }

    for (let index = 0; index < testCase.expectEpisodes.length; index += 1) {
      const expected = testCase.expectEpisodes[index];
      const actual = actualEpisodes[index];
      if (!actual) {
        failures.push(`${testCase.id}: missing episode index=${index}`);
        continue;
      }
      if (actual.episodeKey !== expected.episodeKey) {
        failures.push(
          `${testCase.id}: episode_key[${index}] expected=${expected.episodeKey} actual=${actual.episodeKey}`
        );
      }
      if (actual.itemCount !== expected.itemCount) {
        failures.push(`${testCase.id}: item_count[${index}] expected=${expected.itemCount} actual=${actual.itemCount}`);
      }
      if (expected.expectMergedSummary && actual.mergedSummary !== expected.expectMergedSummary) {
        failures.push(
          `${testCase.id}: merged_summary[${index}] expected=${JSON.stringify(expected.expectMergedSummary)} actual=${JSON.stringify(actual.mergedSummary)}`
        );
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
