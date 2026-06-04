import { createSupabaseServerClient } from "@/features/supabase/server";

export const WORKOUT_TEMPLATE_FAMILY_CODES = [
  "beginner_run_walk",
  "easy",
  "long_run",
  "steady_tempo",
  "intervals",
  "race_specific",
  "pre_race",
  "race_week",
  "optional_development",
] as const;

export const QUALITY_FAMILY_CODES = [
  "steady_tempo",
  "intervals",
  "race_specific",
  "pre_race",
  "race_week",
  "optional_development",
] as const;

export const REQUIRED_WARMUP_REF_CODES = [
  "warmup_none",
  "warmup_easy_start",
  "warmup_standard_easy_10_15",
  "warmup_full_prime",
] as const;

export const REQUIRED_COOLDOWN_REF_CODES = [
  "cooldown_none",
  "cooldown_easy_10",
  "cooldown_easy_10_15",
] as const;

export type WorkoutTemplateFamilyCode = (typeof WORKOUT_TEMPLATE_FAMILY_CODES)[number];
type StructureType = "continuous" | "intervals" | "long" | "activation" | "mixed" | "free";
type IntensityIntent =
  | "easy"
  | "steady"
  | "controlled_threshold"
  | "threshold"
  | "vo2"
  | "race_pace"
  | "marathon_pace"
  | "hm_pace"
  | "ten_k_pace";
type PresetSource = "observed" | "manual" | "science" | "baseline";
type PresetTier = "core" | "advanced" | "extended" | "expansion";
type AthleteLevel = "L0" | "L1" | "L2" | "L3" | "L4" | "L4M";
type ParameterUnit = "min" | "sec" | "km";
type RecoveryType = "easy_jog" | "walk" | "rest" | "active_rest";
type TargetMode = "pace" | "rpe" | "hr_chest_only";
type PaceHrHintMode = "none" | "advisory_wide_band_only" | "required";
type FuelingStrategy = "beginner" | "standard" | "advanced" | "race_rehearsal";

type FamilySeed = {
  familyCode: WorkoutTemplateFamilyCode;
  structureType: StructureType;
  displayNameRu: string;
  sortOrder: number;
};

type VariantSeed = {
  familyCode: WorkoutTemplateFamilyCode;
  variantCode: string;
  intensityIntent: IntensityIntent;
  displayNameRu: string;
  isCoachOnly?: boolean;
  notes?: string;
  sortOrder: number;
};

type RefSeed = {
  refCode: string;
  displayNameRu: string;
  durationMinApprox?: number | null;
  descriptionRu?: string | null;
};

type DescriptionRefSeed = {
  refCode: string;
  displayNameRu: string;
  descriptionTextRu: string;
};

export type WorkoutTemplatePresetParameterSeed = {
  reps?: number;
  workDurationMin?: number;
  workDurationSec?: number;
  workDistanceKm?: number;
  workUnit?: ParameterUnit;
  distanceUnit?: "km" | "m";
  recoveryDurationMin?: number;
  recoveryDurationSec?: number;
  recoveryUnit?: "min" | "sec";
  recoveryType?: RecoveryType;
  totalQualityVolumeMin?: number;
  rpeTarget?: number;
  rpeCap?: number;
  repsInReserve?: string;
  avoidAcidosis?: boolean;
  targetMode?: TargetMode;
  paceHrHintMode?: PaceHrHintMode;
  nutritionRequired?: boolean;
  fuelingStrategy?: FuelingStrategy;
  runDurationMin?: number;
  walkDurationMin?: number;
  extraParams?: Record<string, unknown>;
};

type PresetSeed = {
  familyCode: WorkoutTemplateFamilyCode;
  variantCode: string;
  presetCode: string;
  source: PresetSource;
  tier: PresetTier;
  enabledByDefault?: boolean;
  coachOnly?: boolean;
  coachReviewRequired?: boolean;
  requiresExplicitVo2Intensity?: boolean;
  athleteLevelMin?: AthleteLevel | null;
  displayNameRu: string;
  observedCount?: number;
  athleteCount?: number;
  warmupRefCode: string;
  cooldownRefCode: string;
  descriptionRefCode: string;
  sortOrder: number;
  parameters: WorkoutTemplatePresetParameterSeed;
};

export type WorkoutTemplateCatalogPresetRecord = {
  presetCode: string;
  familyCode: string;
  variantCode: string;
  intensityIntent: string;
  source: string;
  enabledByDefault: boolean;
  coachOnly: boolean;
  coachReviewRequired: boolean;
  requiresExplicitVo2Intensity: boolean;
  athleteLevelMin: string | null;
  observedCount: number;
  workDistanceKm: number | null;
  distanceUnit: string | null;
  targetMode: string;
};

export type WorkoutTemplateCatalogInvariantInput = {
  familyCodes: string[];
  warmupRefCodes: string[];
  cooldownRefCodes: string[];
  presets: WorkoutTemplateCatalogPresetRecord[];
};

function buildControlledThresholdPreset(input: {
  presetCode: string;
  displayNameRu: string;
  reps: number;
  workDurationMin: number;
  recoveryDurationMin: number;
  tier?: PresetTier;
  source?: PresetSource;
  enabledByDefault?: boolean;
  coachOnly?: boolean;
  athleteLevelMin?: AthleteLevel | null;
  observedCount?: number;
  athleteCount?: number;
  sortOrder: number;
}): PresetSeed {
  return {
    familyCode: "intervals",
    variantCode: "controlled_threshold",
    presetCode: input.presetCode,
    source: input.source ?? "manual",
    tier: input.tier ?? "core",
    enabledByDefault: input.enabledByDefault ?? true,
    coachOnly: input.coachOnly ?? false,
    coachReviewRequired: true,
    requiresExplicitVo2Intensity: false,
    athleteLevelMin: input.athleteLevelMin ?? null,
    displayNameRu: input.displayNameRu,
    observedCount: input.observedCount ?? 0,
    athleteCount: input.athleteCount ?? 0,
    warmupRefCode: "warmup_standard_easy_10_15",
    cooldownRefCode: "cooldown_easy_10_15",
    descriptionRefCode: "desc_placeholder_threshold",
    sortOrder: input.sortOrder,
    parameters: {
      reps: input.reps,
      workDurationMin: input.workDurationMin,
      workUnit: "min",
      recoveryDurationMin: input.recoveryDurationMin,
      recoveryUnit: "min",
      recoveryType: "easy_jog",
      totalQualityVolumeMin: input.reps * input.workDurationMin,
      rpeTarget: 7,
      rpeCap: 8,
      repsInReserve: "1-2",
      avoidAcidosis: true,
      targetMode: "rpe",
      paceHrHintMode: "advisory_wide_band_only",
      extraParams: {},
    },
  };
}

function buildVo2Preset(input: {
  presetCode: string;
  displayNameRu: string;
  reps: number;
  workDurationMin?: number;
  workDurationSec?: number;
  recoveryDurationMin?: number;
  recoveryDurationSec?: number;
  tier?: PresetTier;
  variantCode?: "vo2_default" | "vo2_expansion";
  enabledByDefault?: boolean;
  coachOnly?: boolean;
  athleteLevelMin?: AthleteLevel | null;
  source?: PresetSource;
  sortOrder: number;
  extraParams?: Record<string, unknown>;
}): PresetSeed {
  const workDurationSec = input.workDurationSec ?? 0;
  const totalQualityVolumeMin =
    input.workDurationMin != null
      ? input.reps * input.workDurationMin
      : Number(((input.reps * workDurationSec) / 60).toFixed(2));

  return {
    familyCode: "intervals",
    variantCode: input.variantCode ?? "vo2_default",
    presetCode: input.presetCode,
    source: input.source ?? "manual",
    tier: input.tier ?? "advanced",
    enabledByDefault: input.enabledByDefault ?? true,
    coachOnly: input.coachOnly ?? true,
    coachReviewRequired: true,
    requiresExplicitVo2Intensity: true,
    athleteLevelMin: input.athleteLevelMin ?? "L3",
    displayNameRu: input.displayNameRu,
    observedCount: 0,
    athleteCount: 0,
    warmupRefCode: "warmup_full_prime",
    cooldownRefCode: "cooldown_easy_10_15",
    descriptionRefCode: "desc_placeholder_vo2",
    sortOrder: input.sortOrder,
    parameters: {
      reps: input.reps,
      workDurationMin: input.workDurationMin,
      workDurationSec: input.workDurationSec,
      workUnit: input.workDurationSec != null ? "sec" : "min",
      recoveryDurationMin: input.recoveryDurationMin,
      recoveryDurationSec: input.recoveryDurationSec,
      recoveryUnit: input.recoveryDurationSec != null ? "sec" : "min",
      recoveryType: "easy_jog",
      totalQualityVolumeMin,
      rpeTarget: 8,
      rpeCap: 9,
      repsInReserve: "0-1",
      avoidAcidosis: false,
      targetMode: "rpe",
      paceHrHintMode: "advisory_wide_band_only",
      extraParams: input.extraParams ?? {},
    },
  };
}

const families: FamilySeed[] = [
  { familyCode: "beginner_run_walk", structureType: "mixed", displayNameRu: "Бег/ходьба для начинающих", sortOrder: 10 },
  { familyCode: "easy", structureType: "continuous", displayNameRu: "Легкий бег", sortOrder: 20 },
  { familyCode: "long_run", structureType: "long", displayNameRu: "Длительный бег", sortOrder: 30 },
  { familyCode: "steady_tempo", structureType: "continuous", displayNameRu: "Ровный / темповый", sortOrder: 40 },
  { familyCode: "intervals", structureType: "intervals", displayNameRu: "Интервалы", sortOrder: 50 },
  { familyCode: "race_specific", structureType: "intervals", displayNameRu: "Соревновательно-специфические", sortOrder: 60 },
  { familyCode: "pre_race", structureType: "activation", displayNameRu: "Предстартовая активация", sortOrder: 70 },
  { familyCode: "race_week", structureType: "mixed", displayNameRu: "Соревновательная неделя", sortOrder: 80 },
  { familyCode: "optional_development", structureType: "free", displayNameRu: "Опциональное развитие", sortOrder: 90 },
];

const variants: VariantSeed[] = [
  { familyCode: "beginner_run_walk", variantCode: "default", intensityIntent: "easy", displayNameRu: "Базовый переход", sortOrder: 10 },
  { familyCode: "easy", variantCode: "plain", intensityIntent: "easy", displayNameRu: "Обычный легкий", sortOrder: 10 },
  { familyCode: "easy", variantCode: "with_strides", intensityIntent: "easy", displayNameRu: "Легкий со скоростными вставками", sortOrder: 20 },
  { familyCode: "long_run", variantCode: "aerobic", intensityIntent: "easy", displayNameRu: "Аэробный длительный", sortOrder: 10 },
  { familyCode: "long_run", variantCode: "fast_finish", intensityIntent: "steady", displayNameRu: "Длительный с ускорением в конце", sortOrder: 20 },
  { familyCode: "long_run", variantCode: "combined", intensityIntent: "steady", displayNameRu: "Комбинированный длительный", sortOrder: 30 },
  { familyCode: "long_run", variantCode: "marathon_specific", intensityIntent: "marathon_pace", displayNameRu: "Марафон-специфический длительный", sortOrder: 40 },
  { familyCode: "steady_tempo", variantCode: "steady", intensityIntent: "steady", displayNameRu: "Ровный", sortOrder: 10 },
  { familyCode: "steady_tempo", variantCode: "tempo_continuous", intensityIntent: "threshold", displayNameRu: "Непрерывный темп", sortOrder: 20 },
  { familyCode: "intervals", variantCode: "controlled_threshold", intensityIntent: "controlled_threshold", displayNameRu: "Контролируемый порог", sortOrder: 10 },
  { familyCode: "intervals", variantCode: "threshold", intensityIntent: "threshold", displayNameRu: "Порог", sortOrder: 20 },
  { familyCode: "intervals", variantCode: "vo2_default", intensityIntent: "vo2", displayNameRu: "VO2 max по явному выбору", isCoachOnly: true, notes: "Только при явном выборе VO2-интенсивности.", sortOrder: 30 },
  { familyCode: "intervals", variantCode: "vo2_expansion", intensityIntent: "vo2", displayNameRu: "VO2 max расширение", isCoachOnly: true, notes: "Coach-only расширения, отключены по умолчанию.", sortOrder: 40 },
  { familyCode: "intervals", variantCode: "over_under", intensityIntent: "threshold", displayNameRu: "Over/under", sortOrder: 50 },
  { familyCode: "race_specific", variantCode: "ten_k", intensityIntent: "ten_k_pace", displayNameRu: "10K", sortOrder: 10 },
  { familyCode: "race_specific", variantCode: "hm", intensityIntent: "hm_pace", displayNameRu: "Полумарафон", sortOrder: 20 },
  { familyCode: "race_specific", variantCode: "marathon", intensityIntent: "marathon_pace", displayNameRu: "Марафон", sortOrder: 30 },
  { familyCode: "pre_race", variantCode: "activation", intensityIntent: "race_pace", displayNameRu: "Активация", sortOrder: 10 },
  { familyCode: "race_week", variantCode: "sharpening", intensityIntent: "race_pace", displayNameRu: "Подводка", sortOrder: 10 },
  { familyCode: "optional_development", variantCode: "progressive", intensityIntent: "steady", displayNameRu: "Прогрессия", sortOrder: 10 },
  { familyCode: "optional_development", variantCode: "fartlek", intensityIntent: "threshold", displayNameRu: "Фартлек", sortOrder: 20 },
  { familyCode: "optional_development", variantCode: "control", intensityIntent: "threshold", displayNameRu: "Контрольный", sortOrder: 30 },
];

const warmupRefs: RefSeed[] = [
  { refCode: "warmup_none", displayNameRu: "Без разминки", durationMinApprox: null, descriptionRu: "Плейсхолдер: разминка не задана." },
  { refCode: "warmup_easy_start", displayNameRu: "Легкий старт", durationMinApprox: 8, descriptionRu: "Плейсхолдер для мягкого входа в тренировку." },
  { refCode: "warmup_standard_easy_10_15", displayNameRu: "Стандартная легкая 10-15 мин", durationMinApprox: 12, descriptionRu: "Плейсхолдер для стандартной разминки качества." },
  { refCode: "warmup_full_prime", displayNameRu: "Полная активация", durationMinApprox: 20, descriptionRu: "Плейсхолдер для полной разминки перед интенсивной работой." },
];

const cooldownRefs: RefSeed[] = [
  { refCode: "cooldown_none", displayNameRu: "Без заминки", durationMinApprox: null, descriptionRu: "Плейсхолдер: заминка не задана." },
  { refCode: "cooldown_easy_10", displayNameRu: "Легкая заминка 10 мин", durationMinApprox: 10, descriptionRu: "Плейсхолдер для короткой заминки." },
  { refCode: "cooldown_easy_10_15", displayNameRu: "Легкая заминка 10-15 мин", durationMinApprox: 12, descriptionRu: "Плейсхолдер для стандартной заминки после качества." },
];

const descriptionRefs: DescriptionRefSeed[] = [
  { refCode: "desc_placeholder_beginner", displayNameRu: "Плейсхолдер: beginner", descriptionTextRu: "Черновой шаблон описания для beginner run-walk. Финальный текст будет добавлен позже." },
  { refCode: "desc_placeholder_easy", displayNameRu: "Плейсхолдер: easy", descriptionTextRu: "Черновой шаблон описания для easy family. Финальный текст будет добавлен позже." },
  { refCode: "desc_placeholder_long", displayNameRu: "Плейсхолдер: long", descriptionTextRu: "Черновой шаблон описания для long run family. Финальный текст будет добавлен позже." },
  { refCode: "desc_placeholder_threshold", displayNameRu: "Плейсхолдер: threshold", descriptionTextRu: "Черновой шаблон описания для пороговых интервалов. Финальный текст будет добавлен позже." },
  { refCode: "desc_placeholder_vo2", displayNameRu: "Плейсхолдер: vo2", descriptionTextRu: "Черновой шаблон описания для VO2-предустановок coach-only. Финальный текст будет добавлен позже." },
  { refCode: "desc_placeholder_race_specific", displayNameRu: "Плейсхолдер: race specific", descriptionTextRu: "Черновой шаблон описания для race-specific предустановок. Финальный текст будет добавлен позже." },
];

const presets: PresetSeed[] = [
  buildControlledThresholdPreset({ presetCode: "thr_5x4", displayNameRu: "5 x 4 мин контролируемый порог", reps: 5, workDurationMin: 4, recoveryDurationMin: 1, sortOrder: 10 }),
  buildControlledThresholdPreset({ presetCode: "thr_4x5", displayNameRu: "4 x 5 мин контролируемый порог", reps: 4, workDurationMin: 5, recoveryDurationMin: 1.5, sortOrder: 20 }),
  buildControlledThresholdPreset({ presetCode: "thr_6x4", displayNameRu: "6 x 4 мин контролируемый порог", reps: 6, workDurationMin: 4, recoveryDurationMin: 1, sortOrder: 30 }),
  buildControlledThresholdPreset({ presetCode: "thr_6x5", displayNameRu: "6 x 5 мин контролируемый порог", reps: 6, workDurationMin: 5, recoveryDurationMin: 1.5, sortOrder: 40 }),
  buildControlledThresholdPreset({ presetCode: "thr_6x6", displayNameRu: "6 x 6 мин контролируемый порог", reps: 6, workDurationMin: 6, recoveryDurationMin: 1.5, sortOrder: 50 }),
  buildControlledThresholdPreset({ presetCode: "thr_8x4", displayNameRu: "8 x 4 мин контролируемый порог", reps: 8, workDurationMin: 4, recoveryDurationMin: 1, sortOrder: 60 }),
  buildControlledThresholdPreset({ presetCode: "thr_4x8", displayNameRu: "4 x 8 мин контролируемый порог", reps: 4, workDurationMin: 8, recoveryDurationMin: 2, sortOrder: 70 }),
  buildControlledThresholdPreset({ presetCode: "thr_4x9", displayNameRu: "4 x 9 мин контролируемый порог", reps: 4, workDurationMin: 9, recoveryDurationMin: 2, sortOrder: 80 }),
  buildControlledThresholdPreset({ presetCode: "thr_5x7", displayNameRu: "5 x 7 мин контролируемый порог", reps: 5, workDurationMin: 7, recoveryDurationMin: 1.5, sortOrder: 90 }),
  buildControlledThresholdPreset({ presetCode: "thr_4x10", displayNameRu: "4 x 10 мин контролируемый порог", reps: 4, workDurationMin: 10, recoveryDurationMin: 2, sortOrder: 100 }),
  buildControlledThresholdPreset({ presetCode: "thr_3x8", displayNameRu: "3 x 8 мин контролируемый порог", reps: 3, workDurationMin: 8, recoveryDurationMin: 2, sortOrder: 110 }),
  buildControlledThresholdPreset({ presetCode: "thr_5x6", displayNameRu: "5 x 6 мин контролируемый порог", reps: 5, workDurationMin: 6, recoveryDurationMin: 1.5, sortOrder: 120 }),
  buildControlledThresholdPreset({ presetCode: "thr_3x12", displayNameRu: "3 x 12 мин контролируемый порог", reps: 3, workDurationMin: 12, recoveryDurationMin: 3, tier: "advanced", sortOrder: 130 }),
  buildControlledThresholdPreset({ presetCode: "thr_3x16", displayNameRu: "3 x 16 мин контролируемый порог", reps: 3, workDurationMin: 16, recoveryDurationMin: 4, tier: "advanced", coachOnly: true, athleteLevelMin: "L3", sortOrder: 140 }),
  buildControlledThresholdPreset({ presetCode: "thr_2x20", displayNameRu: "2 x 20 мин контролируемый порог", reps: 2, workDurationMin: 20, recoveryDurationMin: 5, tier: "advanced", coachOnly: true, athleteLevelMin: "L3", sortOrder: 150 }),
  buildControlledThresholdPreset({ presetCode: "thr_2x24", displayNameRu: "2 x 24 мин контролируемый порог", reps: 2, workDurationMin: 24, recoveryDurationMin: 5, tier: "advanced", coachOnly: true, athleteLevelMin: "L4", sortOrder: 160 }),
  buildControlledThresholdPreset({ presetCode: "thr_4x12", displayNameRu: "4 x 12 мин контролируемый порог", reps: 4, workDurationMin: 12, recoveryDurationMin: 3, tier: "advanced", athleteLevelMin: "L3", sortOrder: 170 }),
  buildControlledThresholdPreset({ presetCode: "thr_7x4", displayNameRu: "7 x 4 мин контролируемый порог", reps: 7, workDurationMin: 4, recoveryDurationMin: 1, tier: "extended", enabledByDefault: false, source: "science", sortOrder: 180 }),
  buildControlledThresholdPreset({ presetCode: "thr_7x5", displayNameRu: "7 x 5 мин контролируемый порог", reps: 7, workDurationMin: 5, recoveryDurationMin: 1.5, tier: "extended", enabledByDefault: false, source: "science", athleteLevelMin: "L3", sortOrder: 190 }),
  buildVo2Preset({ presetCode: "vo2_6x3", displayNameRu: "6 x 3 мин VO2 max", reps: 6, workDurationMin: 3, recoveryDurationMin: 2, sortOrder: 200 }),
  buildVo2Preset({ presetCode: "vo2_4x4", displayNameRu: "4 x 4 мин VO2 max", reps: 4, workDurationMin: 4, recoveryDurationMin: 3, sortOrder: 210 }),
  buildVo2Preset({ presetCode: "vo2_10x2", displayNameRu: "10 x 2 мин VO2 max", reps: 10, workDurationMin: 2, recoveryDurationMin: 1.5, sortOrder: 220 }),
  buildVo2Preset({ presetCode: "vo2_12x2", displayNameRu: "12 x 2 мин VO2 max", reps: 12, workDurationMin: 2, recoveryDurationMin: 1.5, sortOrder: 230 }),
  buildVo2Preset({ presetCode: "vo2_20x1", displayNameRu: "20 x 1 мин VO2 max", reps: 20, workDurationMin: 1, recoveryDurationMin: 1, sortOrder: 240 }),
  buildVo2Preset({ presetCode: "vo2_24x1", displayNameRu: "24 x 1 мин VO2 max", reps: 24, workDurationMin: 1, recoveryDurationMin: 1, athleteLevelMin: "L4", sortOrder: 250 }),
  buildVo2Preset({ presetCode: "vo2_15x1", displayNameRu: "15 x 1 мин VO2 max", reps: 15, workDurationMin: 1, recoveryDurationMin: 1, sortOrder: 260 }),
  buildVo2Preset({
    presetCode: "vo2_30_40sec",
    displayNameRu: "VO2 max 30-40 сек",
    reps: 16,
    workDurationSec: 35,
    recoveryDurationSec: 35,
    sortOrder: 270,
    extraParams: { workDurationSecRange: [30, 40] },
  }),
  buildVo2Preset({
    presetCode: "vo2_5x3",
    displayNameRu: "5 x 3 мин VO2 max expansion",
    reps: 5,
    workDurationMin: 3,
    recoveryDurationMin: 2.5,
    tier: "expansion",
    variantCode: "vo2_expansion",
    enabledByDefault: false,
    source: "science",
    athleteLevelMin: "L4",
    sortOrder: 280,
  }),
  buildVo2Preset({
    presetCode: "vo2_5x4",
    displayNameRu: "5 x 4 мин VO2 max expansion",
    reps: 5,
    workDurationMin: 4,
    recoveryDurationMin: 3,
    tier: "expansion",
    variantCode: "vo2_expansion",
    enabledByDefault: false,
    source: "science",
    athleteLevelMin: "L4",
    sortOrder: 290,
  }),
  buildVo2Preset({
    presetCode: "vo2_4x5",
    displayNameRu: "4 x 5 мин VO2 max expansion",
    reps: 4,
    workDurationMin: 5,
    recoveryDurationMin: 3,
    tier: "expansion",
    variantCode: "vo2_expansion",
    enabledByDefault: false,
    source: "science",
    athleteLevelMin: "L4",
    sortOrder: 300,
  }),
  buildVo2Preset({
    presetCode: "vo2_3x5",
    displayNameRu: "3 x 5 мин VO2 max expansion",
    reps: 3,
    workDurationMin: 5,
    recoveryDurationMin: 3,
    tier: "expansion",
    variantCode: "vo2_expansion",
    enabledByDefault: false,
    source: "science",
    athleteLevelMin: "L4",
    sortOrder: 310,
  }),
  {
    familyCode: "race_specific",
    variantCode: "ten_k",
    presetCode: "race_10k_4x2km",
    source: "manual",
    tier: "core",
    enabledByDefault: true,
    coachOnly: false,
    coachReviewRequired: true,
    requiresExplicitVo2Intensity: false,
    athleteLevelMin: "L2",
    displayNameRu: "10K: 4 x 2 км",
    observedCount: 0,
    athleteCount: 0,
    warmupRefCode: "warmup_full_prime",
    cooldownRefCode: "cooldown_easy_10_15",
    descriptionRefCode: "desc_placeholder_race_specific",
    sortOrder: 320,
    parameters: {
      reps: 4,
      workDistanceKm: 2,
      workUnit: "km",
      distanceUnit: "km",
      recoveryDurationMin: 3,
      recoveryUnit: "min",
      recoveryType: "easy_jog",
      rpeTarget: 8,
      rpeCap: 9,
      targetMode: "pace",
      paceHrHintMode: "advisory_wide_band_only",
      extraParams: {},
    },
  },
  {
    familyCode: "race_specific",
    variantCode: "ten_k",
    presetCode: "race_10k_3x3km",
    source: "manual",
    tier: "advanced",
    enabledByDefault: true,
    coachOnly: false,
    coachReviewRequired: true,
    requiresExplicitVo2Intensity: false,
    athleteLevelMin: "L3",
    displayNameRu: "10K: 3 x 3 км",
    observedCount: 0,
    athleteCount: 0,
    warmupRefCode: "warmup_full_prime",
    cooldownRefCode: "cooldown_easy_10_15",
    descriptionRefCode: "desc_placeholder_race_specific",
    sortOrder: 330,
    parameters: {
      reps: 3,
      workDistanceKm: 3,
      workUnit: "km",
      distanceUnit: "km",
      recoveryDurationMin: 4,
      recoveryUnit: "min",
      recoveryType: "easy_jog",
      rpeTarget: 8,
      rpeCap: 9,
      targetMode: "pace",
      paceHrHintMode: "advisory_wide_band_only",
      extraParams: {},
    },
  },
  {
    familyCode: "beginner_run_walk",
    variantCode: "default",
    presetCode: "rw_5x4_2walk",
    source: "manual",
    tier: "core",
    enabledByDefault: true,
    coachOnly: false,
    coachReviewRequired: true,
    requiresExplicitVo2Intensity: false,
    athleteLevelMin: "L0",
    displayNameRu: "5 x 4 мин бег / 2 мин шаг",
    observedCount: 0,
    athleteCount: 0,
    warmupRefCode: "warmup_easy_start",
    cooldownRefCode: "cooldown_easy_10",
    descriptionRefCode: "desc_placeholder_beginner",
    sortOrder: 340,
    parameters: {
      reps: 5,
      runDurationMin: 4,
      walkDurationMin: 2,
      recoveryType: "walk",
      targetMode: "rpe",
      rpeTarget: 4,
      rpeCap: 5,
      paceHrHintMode: "none",
      extraParams: {},
    },
  },
  {
    familyCode: "beginner_run_walk",
    variantCode: "default",
    presetCode: "rw_5x5_1_2walk",
    source: "manual",
    tier: "core",
    enabledByDefault: true,
    coachOnly: false,
    coachReviewRequired: true,
    requiresExplicitVo2Intensity: false,
    athleteLevelMin: "L0",
    displayNameRu: "5 x 5 мин бег / 1-2 мин шаг",
    observedCount: 0,
    athleteCount: 0,
    warmupRefCode: "warmup_easy_start",
    cooldownRefCode: "cooldown_easy_10",
    descriptionRefCode: "desc_placeholder_beginner",
    sortOrder: 350,
    parameters: {
      reps: 5,
      runDurationMin: 5,
      walkDurationMin: 1.5,
      recoveryType: "walk",
      targetMode: "rpe",
      rpeTarget: 4,
      rpeCap: 5,
      paceHrHintMode: "none",
      extraParams: { walkDurationMinRange: [1, 2] },
    },
  },
  {
    familyCode: "beginner_run_walk",
    variantCode: "default",
    presetCode: "rw_5x6_1walk",
    source: "manual",
    tier: "core",
    enabledByDefault: true,
    coachOnly: false,
    coachReviewRequired: true,
    requiresExplicitVo2Intensity: false,
    athleteLevelMin: "L0",
    displayNameRu: "5 x 6 мин бег / 1 мин шаг",
    observedCount: 0,
    athleteCount: 0,
    warmupRefCode: "warmup_easy_start",
    cooldownRefCode: "cooldown_easy_10",
    descriptionRefCode: "desc_placeholder_beginner",
    sortOrder: 360,
    parameters: {
      reps: 5,
      runDurationMin: 6,
      walkDurationMin: 1,
      recoveryType: "walk",
      targetMode: "rpe",
      rpeTarget: 4,
      rpeCap: 5,
      paceHrHintMode: "none",
      extraParams: {},
    },
  },
  {
    familyCode: "beginner_run_walk",
    variantCode: "default",
    presetCode: "rw_transition_continuous_easy",
    source: "manual",
    tier: "advanced",
    enabledByDefault: true,
    coachOnly: false,
    coachReviewRequired: true,
    requiresExplicitVo2Intensity: false,
    athleteLevelMin: "L0",
    displayNameRu: "Переход к непрерывному легкому бегу",
    observedCount: 0,
    athleteCount: 0,
    warmupRefCode: "warmup_easy_start",
    cooldownRefCode: "cooldown_easy_10",
    descriptionRefCode: "desc_placeholder_beginner",
    sortOrder: 370,
    parameters: {
      targetMode: "rpe",
      rpeTarget: 4,
      rpeCap: 5,
      paceHrHintMode: "none",
      extraParams: {
        sessionType: "continuous_easy_transition",
        suggestedContinuousDurationMin: 30,
      },
    },
  },
];

export const workoutTemplateCatalogSeed = {
  families,
  variants,
  warmupRefs,
  cooldownRefs,
  descriptionRefs,
  presets,
} as const;

export function buildSeedInvariantInput(): WorkoutTemplateCatalogInvariantInput {
  const variantMap = new Map<string, VariantSeed>();
  for (const variant of variants) {
    variantMap.set(`${variant.familyCode}:${variant.variantCode}`, variant);
  }

  return {
    familyCodes: families.map((family) => family.familyCode),
    warmupRefCodes: warmupRefs.map((ref) => ref.refCode),
    cooldownRefCodes: cooldownRefs.map((ref) => ref.refCode),
    presets: presets.map((preset) => {
      const variant = variantMap.get(`${preset.familyCode}:${preset.variantCode}`);
      return {
        presetCode: preset.presetCode,
        familyCode: preset.familyCode,
        variantCode: preset.variantCode,
        intensityIntent: variant?.intensityIntent ?? "unknown",
        source: preset.source,
        enabledByDefault: preset.enabledByDefault ?? true,
        coachOnly: preset.coachOnly ?? false,
        coachReviewRequired: preset.coachReviewRequired ?? true,
        requiresExplicitVo2Intensity: preset.requiresExplicitVo2Intensity ?? false,
        athleteLevelMin: preset.athleteLevelMin ?? null,
        observedCount: preset.observedCount ?? 0,
        workDistanceKm: preset.parameters.workDistanceKm ?? null,
        distanceUnit: preset.parameters.distanceUnit ?? null,
        targetMode: preset.parameters.targetMode ?? "rpe",
      };
    }),
  };
}

export function evaluateWorkoutTemplateCatalogInvariants(input: WorkoutTemplateCatalogInvariantInput): {
  ok: boolean;
  checks: string[];
  errors: string[];
} {
  const errors: string[] = [];
  const checks: string[] = [];
  const familySet = new Set(input.familyCodes);
  const presetMap = new Map(input.presets.map((preset) => [preset.presetCode, preset]));
  const qualityFamilySet = new Set<string>(QUALITY_FAMILY_CODES);

  const missingFamilies = WORKOUT_TEMPLATE_FAMILY_CODES.filter((familyCode) => !familySet.has(familyCode));
  if (missingFamilies.length > 0) {
    errors.push(`Missing core families: ${missingFamilies.join(", ")}`);
  } else {
    checks.push("All 9 core families exist.");
  }

  if (familySet.has("recovery")) {
    errors.push("Family code 'recovery' must not exist.");
  } else {
    checks.push("Recovery is not a family.");
  }

  for (const presetCode of ["thr_5x4", "thr_4x5", "thr_8x4", "thr_6x5", "thr_6x6", "thr_4x9", "thr_5x7"]) {
    const preset = presetMap.get(presetCode);
    if (!preset) {
      errors.push(`Missing controlled-threshold preset ${presetCode}.`);
      continue;
    }
    if (preset.familyCode !== "intervals" || preset.variantCode !== "controlled_threshold" || preset.intensityIntent !== "controlled_threshold") {
      errors.push(`${presetCode} must stay controlled_threshold, not VO2.`);
    }
  }
  checks.push("Protected 4-5 minute and related threshold sets remain controlled threshold by default.");

  for (const presetCode of ["vo2_5x4", "vo2_4x5"]) {
    const preset = presetMap.get(presetCode);
    if (!preset) {
      errors.push(`Missing coach-only VO2 expansion preset ${presetCode}.`);
      continue;
    }
    if (!preset.coachOnly || preset.enabledByDefault || !preset.requiresExplicitVo2Intensity) {
      errors.push(`${presetCode} must be coach_only, disabled by default, and require explicit VO2 intensity.`);
    }
  }
  checks.push("VO2 5x4 and 4x5 remain coach-only expansions.");

  const race10k3x3 = presetMap.get("race_10k_3x3km");
  if (!race10k3x3) {
    errors.push("Missing race_10k_3x3km preset.");
  } else if (
    race10k3x3.familyCode !== "race_specific" ||
    race10k3x3.variantCode !== "ten_k" ||
    race10k3x3.source !== "manual" ||
    race10k3x3.observedCount !== 0 ||
    race10k3x3.workDistanceKm !== 3 ||
    race10k3x3.distanceUnit !== "km"
  ) {
    errors.push("race_10k_3x3km must stay manual, zero-observed, and kilometer-based.");
  } else {
    checks.push("3x3 km stays manual and kilometer-based.");
  }

  const race10k4x2 = presetMap.get("race_10k_4x2km");
  if (!race10k4x2) {
    errors.push("Missing race_10k_4x2km preset.");
  } else if (race10k4x2.familyCode !== "race_specific" || race10k4x2.variantCode !== "ten_k" || race10k4x2.workDistanceKm !== 2 || race10k4x2.distanceUnit !== "km") {
    errors.push("race_10k_4x2km must stay kilometer-based.");
  } else {
    checks.push("4x2 for 10K is modeled in kilometers, not minutes.");
  }

  const missingCoachReview = input.presets.filter(
    (preset) => qualityFamilySet.has(preset.familyCode) && !preset.coachReviewRequired
  );
  if (missingCoachReview.length > 0) {
    errors.push(`Quality presets missing coach_review_required: ${missingCoachReview.map((preset) => preset.presetCode).join(", ")}`);
  } else {
    checks.push("All quality presets require coach review.");
  }

  const vo2ExpansionEnabled = input.presets.filter(
    (preset) => preset.familyCode === "intervals" && preset.variantCode === "vo2_expansion" && preset.enabledByDefault
  );
  if (vo2ExpansionEnabled.length > 0) {
    errors.push(`VO2 expansion presets must be disabled by default: ${vo2ExpansionEnabled.map((preset) => preset.presetCode).join(", ")}`);
  } else {
    checks.push("VO2 expansion presets are disabled by default.");
  }

  const beginnerVo2 = input.presets.filter(
    (preset) => preset.familyCode === "beginner_run_walk" && (preset.intensityIntent === "vo2" || preset.requiresExplicitVo2Intensity)
  );
  if (beginnerVo2.length > 0) {
    errors.push(`Beginner run-walk presets must not use VO2 intensity: ${beginnerVo2.map((preset) => preset.presetCode).join(", ")}`);
  } else {
    checks.push("Beginner run-walk presets stay non-VO2.");
  }

  const warmupSet = new Set(input.warmupRefCodes);
  const cooldownSet = new Set(input.cooldownRefCodes);
  const missingWarmups = REQUIRED_WARMUP_REF_CODES.filter((refCode) => !warmupSet.has(refCode));
  const missingCooldowns = REQUIRED_COOLDOWN_REF_CODES.filter((refCode) => !cooldownSet.has(refCode));
  if (missingWarmups.length > 0) {
    errors.push(`Missing warmup refs: ${missingWarmups.join(", ")}`);
  }
  if (missingCooldowns.length > 0) {
    errors.push(`Missing cooldown refs: ${missingCooldowns.join(", ")}`);
  }
  if (missingWarmups.length === 0 && missingCooldowns.length === 0) {
    checks.push("Required warmup and cooldown refs exist.");
  }

  return {
    ok: errors.length === 0,
    checks,
    errors,
  };
}

export async function listWorkoutTemplateFamilies() {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("workout_template_families")
    .select("*")
    .order("sort_order", { ascending: true })
    .order("family_code", { ascending: true });

  if (error) {
    throw new Error(`Failed to list workout template families: ${error.message}`);
  }

  return data ?? [];
}

export async function listWorkoutTemplateVariants() {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("workout_template_variants")
    .select(
      "id, family_id, variant_code, intensity_intent, display_name_ru, is_coach_only, is_enabled, notes, sort_order, created_at, updated_at, workout_template_families(family_code)"
    )
    .order("sort_order", { ascending: true })
    .order("variant_code", { ascending: true });

  if (error) {
    throw new Error(`Failed to list workout template variants: ${error.message}`);
  }

  return data ?? [];
}

export async function listWorkoutTemplatePresets() {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("workout_template_presets")
    .select(
      "id, variant_id, preset_code, source, tier, enabled_by_default, coach_only, coach_review_required, requires_explicit_vo2_intensity, athlete_level_min, display_name_ru, observed_count, athlete_count, is_enabled, sort_order, created_at, updated_at, workout_template_variants(variant_code, intensity_intent, workout_template_families(family_code)), workout_template_warmup_refs(ref_code), workout_template_cooldown_refs(ref_code), workout_template_description_refs(ref_code)"
    )
    .order("sort_order", { ascending: true })
    .order("preset_code", { ascending: true });

  if (error) {
    throw new Error(`Failed to list workout template presets: ${error.message}`);
  }

  return data ?? [];
}

export async function getWorkoutTemplatePresetByCode(presetCode: string) {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("workout_template_presets")
    .select(
      "id, variant_id, preset_code, source, tier, enabled_by_default, coach_only, coach_review_required, requires_explicit_vo2_intensity, athlete_level_min, display_name_ru, observed_count, athlete_count, is_enabled, sort_order, created_at, updated_at, workout_template_variants(variant_code, intensity_intent, workout_template_families(family_code)), workout_template_preset_parameters(*), workout_template_warmup_refs(ref_code), workout_template_cooldown_refs(ref_code), workout_template_description_refs(ref_code)"
    )
    .eq("preset_code", presetCode)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to get workout template preset ${presetCode}: ${error.message}`);
  }

  return data;
}

export async function listWorkoutTemplateGuardrails() {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("workout_template_guardrails")
    .select("*")
    .order("sort_order", { ascending: true })
    .order("rule_code", { ascending: true });

  if (error) {
    throw new Error(`Failed to list workout template guardrails: ${error.message}`);
  }

  return data ?? [];
}

export async function listCoachReviewRules() {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("coach_review_rules")
    .select("*")
    .order("sort_order", { ascending: true })
    .order("rule_code", { ascending: true });

  if (error) {
    throw new Error(`Failed to list coach review rules: ${error.message}`);
  }

  return data ?? [];
}
