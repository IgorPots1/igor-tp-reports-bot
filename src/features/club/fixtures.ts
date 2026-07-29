// Club Mini App (/m/club) — fixtures for local preview / STUB fallback. NEVER used
// in prod responses (the service builds every view from real cache data). These
// let the UI be previewed as a student sees it without Telegram initData / a live DB.
//
// TODO(real-data): challenge goal — the `auto` mode (prev-week club km * factor) is
// the real default now; the fixture below is only the last-resort demo value.

import type {
  ClubChallengeView,
  ClubExtendedTopsView,
  ClubFeedItem,
  ClubFeedView,
  ClubProfileDetailView,
  ClubPublicProfileView,
  ClubRecordsView,
  ClubStatisticsView,
} from "./types";

const FRESH = { latestScannedAt: null, label: "обновлено 14 мин назад" };

function feedItem(over: Partial<ClubFeedItem> & { id: string; studentId: string }): ClubFeedItem {
  return {
    studentDisplayName: "Аноним",
    monogram: "АА",
    typeLabel: "Бег",
    isRunning: true,
    date: "2026-07-24",
    dateLabel: "24 июл",
    distanceKm: 10,
    durationSeconds: 3000,
    paceSecPerKm: 300,
    avgHr: null,
    timeLabel: null,
    insight: null,
    title: null,
    caption: null,
    track: null,
    reactionsEnabled: false,
    reactions: { like: 0, fire: 0 },
    mine: { like: false, fire: false },
    ...over,
  };
}

export const CLUB_FEED_FIXTURE: ClubFeedView = {
  freshness: FRESH,
  nextCursor: null,
  items: [
    feedItem({ id: "f1", studentId: "s1", studentDisplayName: "Анна", monogram: "АК", distanceKm: 12.4, durationSeconds: 3720, paceSecPerKm: 300, caption: "Длительный по набережной, ровно" }),
    feedItem({ id: "f2", studentId: "s2", studentDisplayName: "Павел", monogram: "ПС", distanceKm: 8, durationSeconds: 2400, paceSecPerKm: 300 }),
    feedItem({ id: "f3", studentId: "s3", studentDisplayName: "Ирина", monogram: "ИМ", typeLabel: "Силовая", isRunning: false, date: "2026-07-23", dateLabel: "23 июл", distanceKm: null, durationSeconds: 2700, paceSecPerKm: null, caption: "Ноги и кор" }),
  ],
};

export const CLUB_CHALLENGE_FIXTURE: ClubChallengeView = {
  clubKm: 312.6,
  goalKm: 340,
  goalIsFixture: false,
  goalMode: "auto",
  progressPct: 92,
  weekLabel: "20 июл - 26 июл",
  challenges: [],
  performersPeriod: "week",
  performersPeriodLabel: "за неделю",
  freshness: FRESH,
  topPerformers: [
    { studentId: "s1", displayName: "Анна", monogram: "АК", completionPct: 1, plannedCount: 5, completedCount: 5, noPlan: false, isCurrentStudent: false },
    { studentId: "s2", displayName: "Дмитрий", monogram: "ДВ", completionPct: 0.8, plannedCount: 5, completedCount: 4, noPlan: false, isCurrentStudent: true },
    { studentId: "s3", displayName: "Ирина", monogram: "ИМ", completionPct: 0.75, plannedCount: 4, completedCount: 3, noPlan: false, isCurrentStudent: false },
  ],
  personal: { contributionKm: 41.2, contributionPct: 13, completionPct: 0.8, plannedCount: 5, completedCount: 4, noPlan: false },
};

export const CLUB_RECORDS_FIXTURE: ClubRecordsView = {
  freshness: FRESH,
  personal: [
    { distanceKey: "10k", distanceLabel: "10 км", durationSeconds: 2610, paceSecPerKm: 261, date: "2026-06-14", dateLabel: "14 июн", trust: "verified", source: "reconstructed", calcMethod: "best_split", recordType: "race" },
    { distanceKey: "21k", distanceLabel: "21.1 км", durationSeconds: 5940, paceSecPerKm: 281, date: "2026-05-11", dateLabel: "11 мая", trust: "preliminary", source: "reconstructed", calcMethod: "whole_workout", recordType: "training_split" },
  ],
  clubTops: [
    { distanceKey: "5k", distanceLabel: "5 км", alwaysPreliminary: true, rows: [] },
    {
      distanceKey: "10k",
      distanceLabel: "10 км",
      alwaysPreliminary: false,
      rows: [
        { distanceKey: "10k", rank: 1, studentId: "s1", displayName: "Анна", monogram: "АК", durationSeconds: 2400, paceSecPerKm: 240, isCurrentStudent: false, trust: "verified", recordType: "race" },
        { distanceKey: "10k", rank: 2, studentId: "s2", displayName: "Дмитрий", monogram: "ДВ", durationSeconds: 2610, paceSecPerKm: 261, isCurrentStudent: true, trust: "verified", recordType: "race" },
      ],
    },
    { distanceKey: "21k", distanceLabel: "21.1 км", alwaysPreliminary: false, rows: [] },
    { distanceKey: "42k", distanceLabel: "42.2 км", alwaysPreliminary: false, rows: [] },
  ],
};

export const CLUB_PROFILE_FIXTURE: ClubProfileDetailView = {
  displayName: "Дмитрий",
  monogram: "ДВ",
  weekKm: 41.2,
  monthKm: 168.5,
  yearKm: 1120.4,
  streakDays: 4,
  bestWeekKm: 62.3,
  bestWeekLabel: "5 мая",
  weeklySeries: [
    { label: "5 мая", km: 62.3 }, { label: "12 мая", km: 48 }, { label: "19 мая", km: 55 },
    { label: "26 мая", km: 40 }, { label: "2 июн", km: 58 }, { label: "9 июн", km: 51 },
    { label: "16 июн", km: 44 }, { label: "23 июн", km: 60 }, { label: "30 июн", km: 47 },
    { label: "7 июл", km: 53 }, { label: "14 июл", km: 39 }, { label: "21 июл", km: 41.2 },
  ],
  typeBreakdown: [
    { family: "run", label: "Бег", count: 18, km: 168.5 },
    { family: "strength", label: "Силовая", count: 4, km: 0 },
  ],
  records: CLUB_RECORDS_FIXTURE.personal,
  achievements: [
    { code: "first_10k", title: "Первая десятка", hint: "Пробежать 10 км", earned: true, earnedDateLabel: null, stub: false, progress: { current: 10, target: 10, unit: "км" } },
    { code: "first_21k", title: "Первый полумарафон", hint: "Пробежать 21.1 км", earned: true, earnedDateLabel: null, stub: false, progress: { current: 21.1, target: 21.1, unit: "км" } },
    { code: "first_42k", title: "Первый марафон", hint: "Пробежать 42.2 км", earned: false, earnedDateLabel: null, stub: false, progress: { current: 28, target: 42.2, unit: "км" } },
    { code: "month_100k", title: "100 км за месяц", hint: "Набрать 100 км в одном месяце", earned: true, earnedDateLabel: null, stub: false, progress: { current: 100, target: 100, unit: "км" } },
    { code: "streak_10", title: "10 дней подряд", hint: "10 дней подряд с пробежкой", earned: false, earnedDateLabel: null, stub: false, progress: { current: 6, target: 10, unit: "дн" } },
  ],
  clubVisible: true,
  privacyEnabled: false,
  challengeRank: 2,
  challengeParticipants: 14,
  completionPct: 0.8,
  noPlan: false,
  freshness: FRESH,
};

export const CLUB_STATISTICS_FIXTURE: ClubStatisticsView = {
  weekLabel: "20 июл - 26 июл",
  clubKm: 312.6,
  activeCount: 11,
  workoutsCount: 47,
  avgCompletionPct: 0.78,
  prevClubKm: 289.4,
  weekOverWeekPct: 8,
  freshness: FRESH,
};

export const CLUB_TOPS_FIXTURE: ClubExtendedTopsView = {
  weekLabel: "20 июл - 26 июл",
  byVolume: [
    { studentId: "s1", displayName: "Анна", monogram: "АК", value: "58,0 км", isCurrentStudent: false },
    { studentId: "s2", displayName: "Дмитрий", monogram: "ДВ", value: "41,2 км", isCurrentStudent: true },
  ],
  byCount: [
    { studentId: "s1", displayName: "Анна", monogram: "АК", value: "5 трен.", isCurrentStudent: false },
    { studentId: "s2", displayName: "Дмитрий", monogram: "ДВ", value: "4 трен.", isCurrentStudent: true },
  ],
  byCompletion: [
    { studentId: "s1", displayName: "Анна", monogram: "АК", value: "100%", isCurrentStudent: false },
    { studentId: "s2", displayName: "Дмитрий", monogram: "ДВ", value: "80%", isCurrentStudent: true },
  ],
  byStreak: [
    { studentId: "s3", displayName: "Ирина", monogram: "ИМ", value: "7 дн", isCurrentStudent: false },
    { studentId: "s2", displayName: "Дмитрий", monogram: "ДВ", value: "4 дн", isCurrentStudent: true },
  ],
  freshness: FRESH,
};

export const CLUB_PUBLIC_PROFILE_FIXTURE: ClubPublicProfileView = {
  studentId: "s1",
  displayName: "Анна",
  monogram: "АК",
  visible: true,
  weekKm: 58,
  monthKm: 214.5,
  streakDays: 6,
  joinDateLabel: "12 мар 2024",
  last7Days: [
    { date: "2026-07-18", weekday: 5, active: false, km: 0 },
    { date: "2026-07-19", weekday: 6, active: true, km: 18 },
    { date: "2026-07-20", weekday: 0, active: true, km: 8 },
    { date: "2026-07-21", weekday: 1, active: false, km: 0 },
    { date: "2026-07-22", weekday: 2, active: true, km: 12 },
    { date: "2026-07-23", weekday: 3, active: true, km: 6 },
    { date: "2026-07-24", weekday: 4, active: true, km: 14 },
  ],
  month30: { runs: 18, km: 214.5, movingSeconds: 64800, avgPaceSecPerKm: 302, ascentM: 1240 },
  records: CLUB_RECORDS_FIXTURE.personal,
  pastRaces: CLUB_RECORDS_FIXTURE.personal.filter((r) => r.recordType === "race"),
  achievements: [],
  recentFeed: CLUB_FEED_FIXTURE.items.slice(0, 2),
  weeklySeries: [
    { label: "9 июн", km: 42 }, { label: "16 июн", km: 51 }, { label: "23 июн", km: 47 }, { label: "30 июн", km: 58 },
  ],
};
