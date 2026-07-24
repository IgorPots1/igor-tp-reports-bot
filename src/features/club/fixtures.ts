// Club Mini App (/m/club) — fixtures for local preview / fallback when real data
// is insufficient. NEVER used in prod responses: the service layer builds every
// view from real cache data. These exist so the UI can be previewed as a student
// sees it (Stage 3 self-check) without Telegram initData / a live DB.
//
// TODO(real-data): the club challenge GOAL km has no source in Coach OS — it is a
// fixture (CLUB_CHALLENGE_GOAL_KM_FIXTURE). Wire a real goal (mini table or env)
// before presenting the challenge target as real. See docs/questions.md §4.

import type {
  ClubChallengeView,
  ClubFeedView,
  ClubProfileView,
  ClubRecordsView,
} from "./types";

export const CLUB_FEED_FIXTURE: ClubFeedView = {
  freshness: { latestScannedAt: null, label: "обновлено 14 мин назад" },
  nextCursor: null,
  items: [
    {
      id: "f1",
      studentDisplayName: "Анна",
      monogram: "АК",
      typeLabel: "Бег",
      isRunning: true,
      date: "2026-07-24",
      dateLabel: "24 июл",
      distanceKm: 12.4,
      durationSeconds: 3720,
      paceSecPerKm: 300,
      caption: "Длительный по набережной, ровно",
      reactionsEnabled: false,
    },
    {
      id: "f2",
      studentDisplayName: "Павел",
      monogram: "ПС",
      typeLabel: "Бег",
      isRunning: true,
      date: "2026-07-24",
      dateLabel: "24 июл",
      distanceKm: 8,
      durationSeconds: 2400,
      paceSecPerKm: 300,
      caption: null,
      reactionsEnabled: false,
    },
    {
      id: "f3",
      studentDisplayName: "Ирина",
      monogram: "ИМ",
      typeLabel: "Силовая",
      isRunning: false,
      date: "2026-07-23",
      dateLabel: "23 июл",
      distanceKm: null,
      durationSeconds: 2700,
      paceSecPerKm: null,
      caption: "Ноги и кор",
      reactionsEnabled: false,
    },
  ],
};

export const CLUB_CHALLENGE_FIXTURE: ClubChallengeView = {
  clubKm: 312.6,
  goalKm: 500,
  goalIsFixture: true,
  progressPct: 63,
  weekLabel: "20 июл - 26 июл",
  topPerformers: [
    {
      studentId: "s1",
      displayName: "Анна",
      monogram: "АК",
      completionPct: 1,
      plannedCount: 5,
      completedCount: 5,
      noPlan: false,
      isCurrentStudent: false,
    },
    {
      studentId: "s2",
      displayName: "Дмитрий",
      monogram: "ДВ",
      completionPct: 0.8,
      plannedCount: 5,
      completedCount: 4,
      noPlan: false,
      isCurrentStudent: true,
    },
    {
      studentId: "s3",
      displayName: "Ирина",
      monogram: "ИМ",
      completionPct: 0.75,
      plannedCount: 4,
      completedCount: 3,
      noPlan: false,
      isCurrentStudent: false,
    },
  ],
  personal: {
    contributionKm: 41.2,
    contributionPct: 13,
    completionPct: 0.8,
    plannedCount: 5,
    completedCount: 4,
    noPlan: false,
  },
};

export const CLUB_RECORDS_FIXTURE: ClubRecordsView = {
  personal: [
    {
      distanceKey: "10k",
      distanceLabel: "10 км",
      durationSeconds: 2610,
      paceSecPerKm: 261,
      date: "2026-06-14",
      dateLabel: "14 июн",
      reliable: true,
    },
    {
      distanceKey: "21k",
      distanceLabel: "21.1 км",
      durationSeconds: 5940,
      paceSecPerKm: 281,
      date: "2026-05-11",
      dateLabel: "11 мая",
      reliable: false,
    },
  ],
  clubTops: [
    { distanceKey: "5k", distanceLabel: "5 км", alwaysPreliminary: true, rows: [] },
    {
      distanceKey: "10k",
      distanceLabel: "10 км",
      alwaysPreliminary: false,
      rows: [
        {
          distanceKey: "10k",
          rank: 1,
          displayName: "Анна",
          monogram: "АК",
          durationSeconds: 2400,
          paceSecPerKm: 240,
          isCurrentStudent: false,
          reliable: true,
        },
        {
          distanceKey: "10k",
          rank: 2,
          displayName: "Дмитрий",
          monogram: "ДВ",
          durationSeconds: 2610,
          paceSecPerKm: 261,
          isCurrentStudent: true,
          reliable: true,
        },
      ],
    },
    { distanceKey: "21k", distanceLabel: "21.1 км", alwaysPreliminary: false, rows: [] },
    { distanceKey: "42k", distanceLabel: "42.2 км", alwaysPreliminary: false, rows: [] },
  ],
};

export const CLUB_PROFILE_FIXTURE: ClubProfileView = {
  displayName: "Дмитрий",
  monogram: "ДВ",
  weekKm: 41.2,
  monthKm: 168.5,
  streakDays: 4,
  records: CLUB_RECORDS_FIXTURE.personal,
  challengeRank: 2,
  challengeParticipants: 14,
  completionPct: 0.8,
  noPlan: false,
};
