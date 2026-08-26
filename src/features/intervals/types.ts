/** Типы приёма данных из Intervals.icu. */

import type { IntervalsAuthMethod } from "./auth";

/** Вид источника: боевой ученик, личный аккаунт тренера, тестовое подключение. */
export type DataSourceKind = "student" | "self" | "test";

/** Строка student_data_sources, как её читает серверный код. */
export type StudentDataSource = {
  id: string;
  /** NULL у self/test: у аккаунта тренера карточки ученика нет и не должно быть. */
  studentId: string | null;
  kind: DataSourceKind;
  provider: "intervals";
  externalAthleteId: string;
  authMethod: IntervalsAuthMethod;
  /** СЕКРЕТ. Не логировать, не отдавать наружу. */
  credential: string;
  isActive: boolean;
  lastSyncedAt: string | null;
};

/**
 * Активность в том виде, в каком её отдаёт провайдер. Поля объявлены
 * необязательными сознательно: набор зависит от вида спорта и от того, чем
 * записывали. Разбираем то, что пришло, и не требуем ничего сверх id.
 */
export type IntervalsActivity = {
  id: string;
  name?: string | null;
  type?: string | null;
  start_date?: string | null;
  start_date_local?: string | null;
  timezone?: string | null;
  moving_time?: number | null;
  elapsed_time?: number | null;
  distance?: number | null;
  total_elevation_gain?: number | null;
  average_heartrate?: number | null;
  max_heartrate?: number | null;
  average_speed?: number | null;
  calories?: number | null;
  [key: string]: unknown;
};

/** Три ряда, которые забираем. Длины совпадают, дырки — null внутри массива. */
export type ActivityStreams = {
  time: number[];
  heartrate: (number | null)[] | null;
  velocitySmooth: (number | null)[] | null;
};

/** Что реально есть в тренировке — считается по рядам. */
export type DataLevel = "heartrate" | "pace_only" | "none";

export type ActivityDataQuality = {
  dataLevel: DataLevel;
  hasHeartrate: boolean;
  hasPace: boolean;
  /** Доля точек с ненулевым пульсом, 0..100; null — ряда пульса нет вовсе. */
  hrCoveragePct: number | null;
  pointCount: number;
};

/** Итог одного прогона приёма — то, что печатает скрипт и видит отчёт. */
export type IngestSummary = {
  /** null в холостом прогоне и у источников без владельца. */
  studentId: string | null;
  /** null только в холостом прогоне — писать было некуда. */
  sourceId: string | null;
  externalAthleteId: string;
  from: string | null;
  to: string | null;
  /** true — прошли весь путь, но в базу не записали ничего. */
  dryRun: boolean;
  activitiesSeen: number;
  activitiesSaved: number;
  streamsSaved: number;
  streamsMissing: number;
  withHeartrate: number;
  paceOnly: number;
  noData: number;
  /** Сколько байт JSON заняли бы ряды. Считается только в холостом прогоне. */
  streamBytes: number;
  failures: { activityId: string; reason: string }[];
};
