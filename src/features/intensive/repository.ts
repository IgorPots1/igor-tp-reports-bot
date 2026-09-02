// ТОЛЬКО СЕРВЕР. Модуль тянет service-role клиент Supabase — импортировать его из
// клиентского компонента нельзя, ключ уедет в браузерный бандл. Пакета server-only
// в проекте нет, поэтому граница держится этим комментарием и тем, что
// src/lib/flow.ts (его импортируют обе публичные страницы) остаётся чистым конфигом.
import {
  createSupabaseServerClient,
  describeSupabaseError,
  withSupabaseNetworkRetry,
} from "@/features/supabase/server";
import { FLOW, SEATS_TOTAL } from "@/lib/flow";

const FLOW_CONFIG_TABLE = "intensive_flow_config";

/** Настройки текущего потока — то, что видят /, /camp и апи анкеты. */
export type FlowConfig = {
  number: number;
  startDateIso: string;
  seatsTotal: number;
  priceRub: string;
  priceEur: string;
};

/** То же самое плюс id строки — нужен только админке, чтобы знать, что обновлять. */
export type FlowConfigRow = FlowConfig & { id: string };

function fallbackFlowConfig(): FlowConfig {
  return {
    number: FLOW.number,
    startDateIso: FLOW.startDateIso,
    seatsTotal: SEATS_TOTAL,
    priceRub: FLOW.price,
    priceEur: FLOW.priceEur,
  };
}

type FlowConfigDbRow = {
  id: string;
  flow_number: number;
  start_date: string;
  seats_total: number;
  price_rub: string;
  price_eur: string;
};

function mapFlowConfigRow(row: FlowConfigDbRow): FlowConfigRow {
  return {
    id: row.id,
    number: row.flow_number,
    startDateIso: row.start_date,
    seatsTotal: row.seats_total,
    priceRub: row.price_rub,
    priceEur: row.price_eur,
  };
}

/**
 * Активная строка настроек потока как есть, БЕЗ фолбэка — бросает исключение,
 * если база недоступна. Для админки: там ошибку показывают тренеру прямым
 * текстом (так же, как loadError у списка заявок), а не подсовывают
 * fallback-константы, которые он мог бы принять за настоящие и молча
 * пересохранить.
 */
export async function getActiveFlowConfigRow(): Promise<FlowConfigRow | null> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await withSupabaseNetworkRetry(() =>
    supabase
      .from(FLOW_CONFIG_TABLE)
      .select("id, flow_number, start_date, seats_total, price_rub, price_eur")
      .eq("is_active", true)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle()
  );

  if (error) {
    throw new Error(`flow config read failed: ${describeSupabaseError(error)}`);
  }

  return data ? mapFlowConfigRow(data as FlowConfigDbRow) : null;
}

/**
 * Настройки текущего потока для публичных страниц и апи анкеты. НИКОГДА не
 * бросает исключение и не роняет вызывающую страницу — при недоступной базе
 * или отсутствующей активной строке тихо возвращает fallbackFlowConfig().
 * Тот же принцип, что у getSeatsLeft: живой сайт важнее точного числа.
 */
export async function getFlowConfig(): Promise<FlowConfig> {
  try {
    const row = await getActiveFlowConfigRow();
    return row ?? fallbackFlowConfig();
  } catch (error) {
    console.error("[intensive] flow config failed, using fallback:", error);
    return fallbackFlowConfig();
  }
}

export const APPLICATION_STATUSES = [
  "new",
  "confirmed",
  "waitlist",
  "cancelled",
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

/**
 * Статусы, которые ЗАНИМАЮТ место в потоке.
 *
 * waitlist и cancelled место НЕ занимают: анкета сохранена и видна тренеру, но
 * на арифметику набора не влияет. Кого пустить в поток — решение тренера в
 * админке, а не отказ на входе в API.
 */
const OCCUPYING_STATUSES: ApplicationStatus[] = ["new", "confirmed"];

const BUCKET = "intensive-screenshots";
const SIGNED_URL_TTL_SECONDS = 60 * 10;

export type Screenshot = {
  path: string;
  name: string;
  size: number;
};

export type IntensiveApplication = {
  id: string;
  createdAt: string;
  flowNumber: string | null;
  status: ApplicationStatus;
  fullName: string;
  birthDate: string | null;
  sex: string | null;
  heightCm: number | null;
  weightKg: number | null;
  city: string | null;
  healthChronic: string | null;
  healthInjuries: string | null;
  healthDiscomfort: string | null;
  healthDisclaimerAccepted: boolean;
  weeklyKm: string | null;
  maxDistance: string | null;
  pr5k: string | null;
  pr10k: string | null;
  pr21k: string | null;
  pr42k: string | null;
  currentTraining: string | null;
  otherSports: string | null;
  goal: string | null;
  racesThisYear: string | null;
  whyIntensive: string | null;
  availableDays: string[];
  sessionDuration: string | null;
  surfaces: string[];
  gadgets: string[];
  shoes: string | null;
  strength: string | null;
  screenshots: Screenshot[];
  adminNote: string | null;
};

export type NewApplicationInput = Omit<
  IntensiveApplication,
  "id" | "createdAt" | "status" | "adminNote"
>;

type ApplicationRow = {
  id: string;
  created_at: string;
  flow_number: string | null;
  status: string;
  full_name: string;
  birth_date: string | null;
  sex: string | null;
  height_cm: number | null;
  weight_kg: number | null;
  city: string | null;
  health_chronic: string | null;
  health_injuries: string | null;
  health_discomfort: string | null;
  health_disclaimer_accepted: boolean;
  weekly_km: string | null;
  max_distance: string | null;
  pr_5k: string | null;
  pr_10k: string | null;
  pr_21k: string | null;
  pr_42k: string | null;
  current_training: string | null;
  other_sports: string | null;
  goal: string | null;
  races_this_year: string | null;
  why_intensive: string | null;
  available_days: string[] | null;
  session_duration: string | null;
  surfaces: string[] | null;
  gadgets: string[] | null;
  shoes: string | null;
  strength: string | null;
  screenshots: unknown;
  admin_note: string | null;
};

function toStatus(value: string): ApplicationStatus {
  return (APPLICATION_STATUSES as readonly string[]).includes(value)
    ? (value as ApplicationStatus)
    : "new";
}

function toScreenshots(value: unknown): Screenshot[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const candidate = item as Record<string, unknown>;
    if (typeof candidate.path !== "string") return [];
    return [
      {
        path: candidate.path,
        name: typeof candidate.name === "string" ? candidate.name : candidate.path,
        size: typeof candidate.size === "number" ? candidate.size : 0,
      },
    ];
  });
}

function mapRow(row: ApplicationRow): IntensiveApplication {
  return {
    id: row.id,
    createdAt: row.created_at,
    flowNumber: row.flow_number,
    status: toStatus(row.status),
    fullName: row.full_name,
    birthDate: row.birth_date,
    sex: row.sex,
    heightCm: row.height_cm,
    weightKg: row.weight_kg === null ? null : Number(row.weight_kg),
    city: row.city,
    healthChronic: row.health_chronic,
    healthInjuries: row.health_injuries,
    healthDiscomfort: row.health_discomfort,
    healthDisclaimerAccepted: row.health_disclaimer_accepted,
    weeklyKm: row.weekly_km,
    maxDistance: row.max_distance,
    pr5k: row.pr_5k,
    pr10k: row.pr_10k,
    pr21k: row.pr_21k,
    pr42k: row.pr_42k,
    currentTraining: row.current_training,
    otherSports: row.other_sports,
    goal: row.goal,
    racesThisYear: row.races_this_year,
    whyIntensive: row.why_intensive,
    availableDays: row.available_days ?? [],
    sessionDuration: row.session_duration,
    surfaces: row.surfaces ?? [],
    gadgets: row.gadgets ?? [],
    shoes: row.shoes,
    strength: row.strength,
    screenshots: toScreenshots(row.screenshots),
    adminNote: row.admin_note,
  };
}

/**
 * Сколько мест осталось В ТЕКУЩЕМ ПОТОКЕ. Считается по базе, руками не правится.
 *
 * Номер потока и общее число мест передаёт вызывающая сторона — раньше это
 * были константы FLOW.number/SEATS_TOTAL, теперь оба значения приходят из
 * getFlowConfig() и меняются формой в админке без деплоя.
 *
 * Фильтр по flow_number обязателен: без него анкеты прошлых потоков продолжают
 * занимать места в новом, и свежий набор открывается уже «закрытым». Ровно это
 * случилось бы при переходе на 29-й поток — десять участников 28-го держали
 * все места. Номер берётся из переданного конфига, так что смена потока сама
 * обнуляет счётчик.
 *
 * Если база недоступна — возвращаем переданный seatsTotal, а не ноль и не
 * исключение: упавший запрос не должен ни ронять публичную страницу, ни
 * показывать «набор закрыт» живому потоку. Перекос в эту сторону безопаснее —
 * человек напишет, и тренер разберётся вручную.
 */
export async function getSeatsLeft(flow: {
  number: number;
  seatsTotal: number;
}): Promise<number> {
  try {
    const supabase = createSupabaseServerClient();
    const { count, error } = await withSupabaseNetworkRetry(() =>
      supabase
        .from("intensive_applications")
        .select("id", { count: "exact", head: true })
        .eq("flow_number", String(flow.number))
        .in("status", OCCUPYING_STATUSES)
    );

    if (error) {
      console.error("[intensive] seats count failed:", describeSupabaseError(error));
      return flow.seatsTotal;
    }

    return Math.max(0, flow.seatsTotal - (count ?? 0));
  } catch (error) {
    console.error("[intensive] seats count threw:", describeSupabaseError(error));
    return flow.seatsTotal;
  }
}

export async function getSeatsTaken(flow: {
  number: number;
  seatsTotal: number;
}): Promise<number> {
  return flow.seatsTotal - (await getSeatsLeft(flow));
}

/**
 * Сколько анкет ждут в листе ожидания. Место они не занимают, но тренеру нужно
 * видеть, что за закрытым набором стоит очередь.
 *
 * НАМЕРЕННО БЕЗ ФИЛЬТРА ПО ПОТОКУ, в отличие от getSeatsLeft: очередь живёт
 * дольше одного набора — записавшегося в 28-й зовут в 29-й. Привяжи счётчик к
 * текущему потоку, и при смене номера люди из очереди пропали бы из сводки,
 * будто их и не было. В админке подписано «все потоки», чтобы не путать.
 *
 * При сбое базы возвращаем 0 — счётчик в админке не должен ронять страницу.
 */
export async function getWaitlistCount(): Promise<number> {
  try {
    const supabase = createSupabaseServerClient();
    const { count, error } = await withSupabaseNetworkRetry(() =>
      supabase
        .from("intensive_applications")
        .select("id", { count: "exact", head: true })
        .eq("status", "waitlist")
    );

    if (error) {
      console.error("[intensive] waitlist count failed:", describeSupabaseError(error));
      return 0;
    }

    return count ?? 0;
  } catch (error) {
    console.error("[intensive] waitlist count threw:", describeSupabaseError(error));
    return 0;
  }
}

/**
 * Заводит анкету. Статус приходит снаружи: 'new' если место есть, 'waitlist'
 * если мест нет. Отказов здесь нет — анкета сохраняется всегда.
 */
export async function createIntensiveApplication(
  input: NewApplicationInput,
  status: ApplicationStatus = "new"
): Promise<string> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from("intensive_applications")
    .insert({
      status,
      flow_number: input.flowNumber,
      full_name: input.fullName,
      birth_date: input.birthDate,
      sex: input.sex,
      height_cm: input.heightCm,
      weight_kg: input.weightKg,
      city: input.city,
      health_chronic: input.healthChronic,
      health_injuries: input.healthInjuries,
      health_discomfort: input.healthDiscomfort,
      health_disclaimer_accepted: input.healthDisclaimerAccepted,
      weekly_km: input.weeklyKm,
      max_distance: input.maxDistance,
      pr_5k: input.pr5k,
      pr_10k: input.pr10k,
      pr_21k: input.pr21k,
      pr_42k: input.pr42k,
      current_training: input.currentTraining,
      other_sports: input.otherSports,
      goal: input.goal,
      races_this_year: input.racesThisYear,
      why_intensive: input.whyIntensive,
      available_days: input.availableDays,
      session_duration: input.sessionDuration,
      surfaces: input.surfaces,
      gadgets: input.gadgets,
      shoes: input.shoes,
      strength: input.strength,
      screenshots: input.screenshots,
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(`insert failed: ${describeSupabaseError(error)}`);
  }

  return data.id as string;
}

/**
 * Кладёт файл в приватный bucket. Путь {applicationId}/{index}-{filename}.
 * Имя обеззараживается: в ключ объекта попадают только латиница, цифры,
 * точка, дефис и подчёркивание — кириллическое имя файла с пробелами
 * ломает подписанные ссылки.
 */
export async function uploadScreenshot(
  applicationId: string,
  index: number,
  file: File
): Promise<Screenshot> {
  const supabase = createSupabaseServerClient();
  const safeName =
    file.name
      .normalize("NFKD")
      .replace(/[^\w.-]+/gu, "_")
      .replace(/^_+|_+$/gu, "")
      .slice(0, 80) || "screenshot";
  const path = `${applicationId}/${index}-${safeName}`;

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, new Uint8Array(await file.arrayBuffer()), {
      contentType: file.type,
      upsert: false,
    });

  if (error) {
    throw new Error(`upload failed: ${describeSupabaseError(error)}`);
  }

  return { path, name: file.name.slice(0, 120), size: file.size };
}

export async function setApplicationScreenshots(
  applicationId: string,
  screenshots: Screenshot[]
): Promise<void> {
  const supabase = createSupabaseServerClient();
  const { error } = await supabase
    .from("intensive_applications")
    .update({ screenshots })
    .eq("id", applicationId);

  if (error) {
    throw new Error(`screenshots update failed: ${describeSupabaseError(error)}`);
  }
}

export type ApplicationListItem = {
  id: string;
  createdAt: string;
  fullName: string;
  city: string | null;
  goal: string | null;
  status: ApplicationStatus;
  flowNumber: string | null;
  screenshotCount: number;
};

export async function listApplications(filters: {
  status?: string | null;
  flow?: string | null;
}): Promise<ApplicationListItem[]> {
  const supabase = createSupabaseServerClient();
  let query = supabase
    .from("intensive_applications")
    .select("id, created_at, full_name, city, goal, status, flow_number, screenshots")
    .order("created_at", { ascending: false })
    .limit(500);

  if (filters.status && (APPLICATION_STATUSES as readonly string[]).includes(filters.status)) {
    query = query.eq("status", filters.status);
  }
  if (filters.flow) {
    query = query.eq("flow_number", filters.flow);
  }

  const { data, error } = await withSupabaseNetworkRetry(() => query);

  if (error) {
    throw new Error(`list failed: ${describeSupabaseError(error)}`);
  }

  return (data ?? []).map((row) => ({
    id: row.id as string,
    createdAt: row.created_at as string,
    fullName: row.full_name as string,
    city: (row.city as string | null) ?? null,
    goal: (row.goal as string | null) ?? null,
    status: toStatus(row.status as string),
    flowNumber: (row.flow_number as string | null) ?? null,
    screenshotCount: toScreenshots(row.screenshots).length,
  }));
}

export async function listFlowNumbers(): Promise<string[]> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await withSupabaseNetworkRetry(() =>
    supabase
      .from("intensive_applications")
      .select("flow_number")
      .not("flow_number", "is", null)
      .limit(1000)
  );

  if (error) {
    throw new Error(`flow list failed: ${describeSupabaseError(error)}`);
  }

  const unique = new Set(
    (data ?? []).map((row) => row.flow_number as string).filter(Boolean)
  );
  return [...unique].sort((a, b) => b.localeCompare(a, "ru", { numeric: true }));
}

export async function getApplication(id: string): Promise<IntensiveApplication | null> {
  const supabase = createSupabaseServerClient();
  const { data, error } = await withSupabaseNetworkRetry(() =>
    supabase.from("intensive_applications").select("*").eq("id", id).maybeSingle()
  );

  if (error) {
    throw new Error(`get failed: ${describeSupabaseError(error)}`);
  }
  if (!data) return null;

  return mapRow(data as ApplicationRow);
}

export async function updateApplication(
  id: string,
  patch: { status?: ApplicationStatus; adminNote?: string | null }
): Promise<void> {
  const supabase = createSupabaseServerClient();
  const payload: Record<string, unknown> = {};
  if (patch.status) payload.status = patch.status;
  if (patch.adminNote !== undefined) payload.admin_note = patch.adminNote;
  if (Object.keys(payload).length === 0) return;

  const { error } = await supabase
    .from("intensive_applications")
    .update(payload)
    .eq("id", id);

  if (error) {
    throw new Error(`update failed: ${describeSupabaseError(error)}`);
  }
}

/**
 * Подписанные ссылки на скриншоты. Bucket приватный, поэтому прямых URL нет —
 * ссылка живёт 10 минут и генерируется на каждый показ страницы.
 */
export async function createScreenshotUrls(
  screenshots: Screenshot[]
): Promise<{ screenshot: Screenshot; url: string | null }[]> {
  if (screenshots.length === 0) return [];

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrls(
      screenshots.map((item) => item.path),
      SIGNED_URL_TTL_SECONDS
    );

  if (error) {
    console.error("[intensive] signed urls failed:", describeSupabaseError(error));
    return screenshots.map((screenshot) => ({ screenshot, url: null }));
  }

  const byPath = new Map(
    (data ?? []).map((item) => [item.path ?? "", item.signedUrl ?? null])
  );
  return screenshots.map((screenshot) => ({
    screenshot,
    url: byPath.get(screenshot.path) ?? null,
  }));
}

/**
 * Обновляет активную строку настроек потока. updated_at ставится явно, а не
 * оставлен на default — иначе при обновлении через .update() он бы не
 * тронулся сам (default срабатывает только на insert), а именно на нём
 * держится «последняя активная по updated_at» в getActiveFlowConfigRow.
 */
export async function updateFlowConfig(
  id: string,
  patch: {
    number: number;
    startDateIso: string;
    seatsTotal: number;
    priceRub: string;
    priceEur: string;
  }
): Promise<void> {
  const supabase = createSupabaseServerClient();
  const { error } = await supabase
    .from(FLOW_CONFIG_TABLE)
    .update({
      flow_number: patch.number,
      start_date: patch.startDateIso,
      seats_total: patch.seatsTotal,
      price_rub: patch.priceRub,
      price_eur: patch.priceEur,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) {
    throw new Error(`flow config update failed: ${describeSupabaseError(error)}`);
  }
}
