/**
 * OAuth Intervals: всё, что можно проверить без живого нажатия «Разрешить».
 *
 * ЧЕГО ЗДЕСЬ НЕТ И БЫТЬ НЕ МОЖЕТ: настоящего обмена кода. Код выдаёт провайдер
 * после того, как ЧЕЛОВЕК нажал согласие в браузере; подделать это нельзя и
 * изображать успех подделкой — врать. Обмен проверен подставным fetch: разбор
 * ответа, форма запроса и все ветки отказа.
 *
 *   node --experimental-strip-types --loader ./scripts/_alias-loader.mjs \
 *     --env-file=.env.local scripts/check-intervals-oauth.ts
 */
import process from "node:process";

import { createSupabaseServerClient } from "@/features/supabase/server";
import { buildAuthorizationHeader } from "@/features/intervals/auth";
import { IntervalsApiError } from "@/features/intervals/api-client";
import {
  buildAuthorizeUrl,
  exchangeCodeForToken,
  INTERVALS_SCOPES,
  isAuthFailure,
  normaliseAthleteId,
  redirectUri,
} from "@/features/intervals/oauth";
import {
  clearAuthFailure,
  connectOauthSource,
  consumeOauthState,
  createOauthState,
  getSourceConnection,
  markAuthFailure,
} from "@/features/intervals/repository";
import { provisionManualSource } from "@/features/intervals/manual-entry";

const SLUG = "check-oauth-student";
const ATHLETE_RAW = "9900112";

const MANUAL_CLAIM_SLUG = "check-oauth-manual-claim-student";
const MANUAL_CLAIM_ATHLETE_RAW = "9900114";

let failures = 0;
function step(title: string): void {
  console.log("");
  console.log(`── ${title} ${"─".repeat(Math.max(0, 56 - title.length))}`);
}
function expect(condition: boolean, message: string): void {
  console.log(`  ${condition ? "✓" : "✗"} ${message}`);
  if (!condition) failures += 1;
}

const supabase = createSupabaseServerClient();

async function dropSandbox(studentUuid: string | null): Promise<void> {
  const { data } = await supabase
    .from("student_data_sources")
    .select("id, kind")
    .eq("provider", "intervals")
    .eq("external_athlete_id", normaliseAthleteId(ATHLETE_RAW))
    .maybeSingle();
  if (data) {
    if ((data as { kind: string }).kind === "student" && studentUuid === null) {
      throw new Error("ОТКАЗ: источник песочницы выглядит боевым, не трогаю");
    }
    const { error } = await supabase
      .from("student_data_sources")
      .delete()
      .eq("id", String((data as { id: string }).id));
    if (error) throw new Error(`уборка источника: ${error.message}`);
  }
  if (studentUuid) {
    await supabase.from("intervals_oauth_states").delete().eq("student_id", studentUuid);
  }
}

async function ensureSandbox(): Promise<string> {
  const { data: existing } = await supabase
    .from("trainingpeaks_students")
    .select("id")
    .eq("student_id", SLUG)
    .maybeSingle();
  if (existing) {
    const id = String(existing.id);
    await dropSandbox(id);
    await supabase.from("trainingpeaks_students").update({ is_active: true }).eq("id", id);
    return id;
  }
  const { data, error } = await supabase
    .from("trainingpeaks_students")
    .insert({
      student_id: SLUG,
      student_name: "Проверка OAuth",
      trainingpeaks_athlete_url: `intervals://athlete/${normaliseAthleteId(ATHLETE_RAW)}`,
      coaching_platform: "intervals",
      is_active: true,
      weekly_report_enabled: false,
      telegram_delivery_enabled: false,
    })
    .select("id")
    .single();
  if (error) throw new Error(`карточка песочницы: ${error.message}`);
  return String(data.id);
}

// Второй, отдельный от основного, песочный ученик — чтобы не пересекаться с
// уже подключённым studentUuid из первой части файла.
async function ensureManualClaimSandbox(): Promise<string> {
  const { data: existing } = await supabase
    .from("trainingpeaks_students")
    .select("id")
    .eq("student_id", MANUAL_CLAIM_SLUG)
    .maybeSingle();
  const id = existing
    ? String(existing.id)
    : String(
        (
          await supabase
            .from("trainingpeaks_students")
            .insert({
              student_id: MANUAL_CLAIM_SLUG,
              student_name: "Проверка ручной→OAuth",
              trainingpeaks_athlete_url: `intervals://athlete/${normaliseAthleteId(MANUAL_CLAIM_ATHLETE_RAW)}`,
              coaching_platform: "intervals",
              is_active: true,
              weekly_report_enabled: false,
              telegram_delivery_enabled: false,
            })
            .select("id")
            .single()
        ).data!.id
      );
  await supabase.from("student_data_sources").delete().eq("student_id", id).eq("provider", "intervals");
  await supabase.from("trainingpeaks_students").update({ is_active: true }).eq("id", id);
  return id;
}

async function main(): Promise<void> {
  console.log("OAUTH INTERVALS — проверка без живого нажатия «Разрешить».");
  const studentUuid = await ensureSandbox();

  // ── Ссылка авторизации ──
  step("ССЫЛКА АВТОРИЗАЦИИ");
  const url = new URL(buildAuthorizeUrl({ clientId: "792", state: "STATE123" }));
  console.log(`     ${url.origin}${url.pathname}`);
  expect(url.origin + url.pathname === "https://intervals.icu/oauth/authorize", "адрес провайдера верный");
  expect(url.searchParams.get("client_id") === "792", "client_id в ссылке");
  expect(url.searchParams.get("state") === "STATE123", "state в ссылке");
  expect(
    url.searchParams.get("redirect_uri") === redirectUri(),
    `адрес возврата: ${redirectUri()}`
  );
  const scope = url.searchParams.get("scope") ?? "";
  console.log(`     scope: ${scope}`);
  expect(
    scope === "ACTIVITY,CALENDAR,WELLNESS",
    "права ровно те, что понимает провайдер, через запятую и без пробелов"
  );
  expect(INTERVALS_SCOPES.length === 3, "лишних прав не просим");

  // ДУБЛЬ ИМЕНИ ЛОВИМ ЗДЕСЬ, А НЕ У ПРОВАЙДЕРА. Именно на этом подключение
  // падало: ACTIVITY:READ и ACTIVITY:WRITE — два разных значения у нас, но одно
  // и то же право у Intervals, и он отвечал «Duplicate scope ACTIVITY».
  const bases = INTERVALS_SCOPES.map((value) => value.split(":")[0]);
  expect(
    new Set(bases).size === bases.length,
    "одно и то же право не просим дважды (проверка на Duplicate scope)"
  );
  expect(
    INTERVALS_SCOPES.every((value) => !value.includes(":")),
    "суффиксов :READ и :WRITE нет, у провайдера права называются без них"
  );
  expect(
    !INTERVALS_SCOPES.includes("SETTINGS" as (typeof INTERVALS_SCOPES)[number]),
    "SETTINGS не просим: зоны и пороги у Intervals не читаем"
  );

  // ── Идентификатор атлета ──
  step("ИДЕНТИФИКАТОР АТЛЕТА");
  expect(normaliseAthleteId("2049151") === "i2049151", "числовой id из ответа получает букву i");
  expect(normaliseAthleteId("i38500") === "i38500", "уже правильный id не портится");
  expect(normaliseAthleteId(" 123 ") === "i123", "пробелы не ломают");
  let threw = false;
  try {
    normaliseAthleteId("");
  } catch {
    threw = true;
  }
  expect(threw, "пустой id отклонён, а не превращён в «i»");

  // ── State: одноразовость ──
  step("STATE ОДНОРАЗОВЫЙ");
  const state = await createOauthState(studentUuid);
  expect(state.length >= 32, `state длинный и случайный (${state.length} символов)`);
  const first = await consumeOauthState(state);
  expect(first.ok && first.studentUuid === studentUuid, "первый возврат опознан и назвал ученика");
  const second = await consumeOauthState(state);
  expect(!second.ok && second.code === "replayed", "ПОВТОРНЫЙ возврат по той же ссылке отклонён");
  const unknown = await consumeOauthState("state-которого-не-было");
  expect(!unknown.ok && unknown.code === "unknown", "чужой state отличён от повтора");

  // ── Обмен кода: подставной провайдер ──
  step("ОБМЕН КОДА НА ТОКЕН");
  const config = { clientId: "792", clientSecret: "secret" };
  let seenBody = "";
  const okFetch = (async (_url: string, init?: RequestInit) => {
    seenBody = String(init?.body ?? "");
    return new Response(
      JSON.stringify({
        token_type: "Bearer",
        access_token: "d842c1fc25f241e5ae440d09756448a9",
        scope: "ACTIVITY,CALENDAR,WELLNESS",
        athlete: { id: ATHLETE_RAW, name: "Проверка OAuth" },
      }),
      { status: 200 }
    );
  }) as unknown as typeof fetch;

  const exchanged = await exchangeCodeForToken({ config, code: "CODE1", fetchImpl: okFetch });
  expect(exchanged.ok, "ответ провайдера разобран");
  if (exchanged.ok) {
    expect(exchanged.token.athleteId === `i${ATHLETE_RAW}`, "id атлета приведён к форме пути API");
    expect(exchanged.token.scope !== null, "выданные права сохранены как есть");
  }
  expect(seenBody.includes("client_secret=secret"), "секрет уходит в теле POST, а не в адресе");
  expect(seenBody.includes("code=CODE1"), "код уходит в теле");

  const noToken = await exchangeCodeForToken({
    config,
    code: "CODE2",
    fetchImpl: (async () => new Response(JSON.stringify({ token_type: "Bearer" }), { status: 200 })) as unknown as typeof fetch,
  });
  expect(!noToken.ok, "ответ без access_token считается отказом, а не успехом");

  const httpError = await exchangeCodeForToken({
    config,
    code: "CODE3",
    fetchImpl: (async () => new Response("bad code", { status: 400 })) as unknown as typeof fetch,
  });
  expect(!httpError.ok && httpError.reason.includes("400"), "HTTP-отказ провайдера назван кодом");

  const broken = await exchangeCodeForToken({
    config,
    code: "CODE4",
    fetchImpl: (async () => new Response("<html>", { status: 200 })) as unknown as typeof fetch,
  });
  expect(!broken.ok, "не-JSON в ответе не роняет поток");

  // ── Привязка источника ──
  step("ПРИВЯЗКА ИСТОЧНИКА");
  if (exchanged.ok) {
    const connected = await connectOauthSource({
      studentUuid,
      externalAthleteId: exchanged.token.athleteId,
      accessToken: exchanged.token.accessToken,
      scope: exchanged.token.scope,
    });
    expect(connected.ok, "источник заведён");

    const conn = await getSourceConnection(studentUuid);
    expect(conn?.authMethod === "oauth", "способ авторизации стал oauth");
    expect(conn?.connectedAt !== null, "дата подключения записана");
    expect(conn?.authFailedAt === null, "отметки отказа нет");

    // Заголовок — ТА САМАЯ функция, которая не должна была поменяться.
    const header = buildAuthorizationHeader({ authMethod: "oauth", credential: "TOKEN" });
    expect(header === "Bearer TOKEN", "OAuth даёт Bearer");
    const legacy = buildAuthorizationHeader({ authMethod: "api_key", credential: "KEY" });
    expect(
      legacy === `Basic ${Buffer.from("API_KEY:KEY").toString("base64")}`,
      "ключевой путь НЕ ЗАДЕТ: basic собирается как раньше"
    );

    // Чужой аккаунт не перевешивается молча.
    const { data: other } = await supabase
      .from("trainingpeaks_students")
      .select("id")
      .eq("student_id", "igor-test")
      .maybeSingle();
    if (other) {
      const stolen = await connectOauthSource({
        studentUuid: String(other.id),
        externalAthleteId: exchanged.token.athleteId,
        accessToken: "OTHER",
        scope: null,
      });
      expect(!stolen.ok, "чужой уже привязанный аккаунт НЕ перевешивается на другого ученика");
      if (!stolen.ok) console.log(`     отказ: ${stolen.reason}`);
    }

    // ИСТОЧНИК ТРЕНЕРА (kind='self', владельца нет) тоже неприкосновенен.
    const { data: selfSource } = await supabase
      .from("student_data_sources")
      .select("external_athlete_id, kind, student_id")
      .eq("provider", "intervals")
      .eq("kind", "self")
      .maybeSingle();
    if (selfSource) {
      const row = selfSource as { external_athlete_id: string };
      const hijack = await connectOauthSource({
        studentUuid,
        externalAthleteId: row.external_athlete_id,
        accessToken: "HIJACK",
        scope: null,
      });
      expect(
        !hijack.ok,
        `источник тренера ${row.external_athlete_id} НЕ перехватывается подключением из приложения`
      );
      if (!hijack.ok) console.log(`     отказ: ${hijack.reason}`);
    } else {
      console.log("     (источника тренера в базе нет — проверка пропущена)");
    }
  }

  // ── Обратный путь: начала вручную, потом подключила часы ──
  //
  // 16.09.2026: connectOauthSource искала заготовку только по префиксу
  // pending-, ручной источник (external_athlete_id='manual-<uuid>') под этот
  // фильтр не попадал — апсерт пытался вставить вторую строку для того же
  // (student_id, provider) и падал на unique-констрейнте. Студентка видела
  // «Не удалось привязать аккаунт» и не могла подключиться вообще.
  step("ПРИВЯЗКА ПОВЕРХ РУЧНОГО ВВОДА (started manual → connected watch)");
  {
    const manualStudentUuid = await ensureManualClaimSandbox();
    const provisioned = await provisionManualSource(manualStudentUuid);
    expect(provisioned.ok, "ручной источник заведён");
    if (provisioned.ok) {
      const manualSourceId = provisioned.sourceId;

      const realAthleteId = normaliseAthleteId(MANUAL_CLAIM_ATHLETE_RAW);
      const claimed = await connectOauthSource({
        studentUuid: manualStudentUuid,
        externalAthleteId: realAthleteId,
        accessToken: "MANUAL_CLAIM_TOKEN",
        scope: "ACTIVITY,CALENDAR,WELLNESS",
      });
      expect(claimed.ok, "OAuth-подключение поверх ручного источника прошло, а не упало на констрейнте");
      if (claimed.ok) {
        expect(
          claimed.sourceId === manualSourceId,
          "source_id тот же самый — история (тренировки, чек-ины, прогрессия) не осиротела"
        );
        const { data: row } = await supabase
          .from("student_data_sources")
          .select("auth_method, external_athlete_id, credential")
          .eq("id", manualSourceId)
          .maybeSingle();
        const claimedRow = row as { auth_method: string; external_athlete_id: string; credential: string } | null;
        expect(claimedRow?.auth_method === "oauth", "способ авторизации стал oauth, а не остался manual");
        expect(claimedRow?.external_athlete_id === realAthleteId, "external_athlete_id — настоящий, не manual-*");
        expect(claimedRow?.credential === "MANUAL_CLAIM_TOKEN", "токен лёг вместо заглушки ручного ввода");

        // Повторная авторизация ТОГО ЖЕ уже-реального аккаунта не должна
        // пересоздавать строку — иначе как раз тот краевой случай, который
        // рождает эта же правка (проверка на "уже совпадает").
        const reauthed = await connectOauthSource({
          studentUuid: manualStudentUuid,
          externalAthleteId: realAthleteId,
          accessToken: "MANUAL_CLAIM_TOKEN_2",
          scope: "ACTIVITY,CALENDAR,WELLNESS",
        });
        expect(reauthed.ok && reauthed.sourceId === manualSourceId, "повторная авторизация не плодит вторую строку");
      }
    }
    await supabase.from("student_data_sources").delete().eq("student_id", manualStudentUuid).eq("provider", "intervals");
    await supabase.from("trainingpeaks_students").update({ is_active: false }).eq("id", manualStudentUuid);
  }

  // ── Отказ в доступе ──
  step("ОТОЗВАННЫЙ ДОСТУП");
  expect(isAuthFailure(new IntervalsApiError(401, "x")), "401 считается отозванным доступом");
  expect(isAuthFailure(new IntervalsApiError(403, "x")), "403 тоже");
  expect(!isAuthFailure(new IntervalsApiError(429, "x")), "429 НЕ считается: это временно");
  expect(!isAuthFailure(new IntervalsApiError(500, "x")), "5xx НЕ считается: чужой сбой");
  expect(!isAuthFailure(new IntervalsApiError(0, "сеть")), "обрыв сети НЕ считается");

  const conn = await getSourceConnection(studentUuid);
  if (conn) {
    await markAuthFailure(conn.sourceId, "HTTP 401");
    const failed = await getSourceConnection(studentUuid);
    expect(failed?.authFailedAt !== null, "отказ записан на источнике");
    await clearAuthFailure(conn.sourceId);
    const healed = await getSourceConnection(studentUuid);
    expect(healed?.authFailedAt === null, "успешный прогон снимает отметку");
  }

  // ── Уборка ──
  step("УБОРКА");
  await dropSandbox(studentUuid);
  await supabase.from("trainingpeaks_students").update({ is_active: false }).eq("id", studentUuid);
  console.log("  ✓ данные прогона удалены, карточка погашена");

  console.log("");
  console.log("НЕ ПРОВЕРЕНО ЗДЕСЬ (и не может быть): настоящий обмен настоящего кода.");
  console.log("Его выдаёт провайдер после нажатия человеком — это шаг Игоря.");
  console.log("");
  if (failures === 0) {
    console.log("ВСЁ ПРОШЛО. Провалов: 0.");
    process.exit(0);
  }
  console.log(`ПРОВАЛОВ: ${failures}.`);
  process.exit(1);
}

main().catch((error) => {
  console.error(String(error));
  process.exit(1);
});
