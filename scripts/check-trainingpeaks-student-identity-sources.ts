import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { createSupabaseServerClient } from "@/features/supabase/server";

const LOG_PREFIX = "[check-trainingpeaks-student-identity-sources]";
const PAGE_SIZE = 500;

const ALIAS_TABLE_CANDIDATES = ["trainingpeaks_student_aliases", "student_aliases"] as const;

const OLGA_PATTERNS = ["ольга", "оля", "olga", "olya", "olha"] as const;

const COMMON_NAME_GROUPS = {
  masha_maria: ["маша", "мария", "masha", "maria"],
  dima_dmitry: ["дима", "дмитрий", "dima", "dmitry", "dmitri"],
  sasha_alexander: ["саша", "александр", "александра", "sasha", "alexander", "alexandra", "alex"],
} as const;

const FORBIDDEN_SELECT_FIELDS = new Set([
  "last_text",
  "text_preview",
  "display_hint",
  "raw_row",
  "notes",
  "metadata",
  "draft_preview",
  "student_message_preview",
  "coach_note_preview",
  "telegram_context_notes",
]);

type CliOptions = {
  nameQuery: string | null;
  showSafeNames: boolean;
  debugName: boolean;
};

type StudentRow = {
  id: string;
  student_id: string;
  student_name: string;
  is_active: boolean;
  telegram_chat_id: string | null;
  telegram_username: string | null;
  telegram_delivery_enabled: boolean;
  telegram_profile_url: string | null;
};

type BusinessChatRow = {
  chat_id: string;
  username: string | null;
  first_name: string | null;
  last_name: string | null;
};

type BillingClientRow = {
  id: string;
  student_id: string | null;
  client_name: string;
  is_active: boolean;
};

type AliasRow = {
  student_id: string | null;
  alias: string | null;
};

type StudentIdentityBundle = {
  student: StudentRow;
  businessChat: BusinessChatRow | null;
  billingClient: BillingClientRow | null;
  aliasCount: number;
  aliases: string[];
};

type NameMatchResult = {
  bundle: StudentIdentityBundle;
  matchedSources: string[];
  matchedPatterns: string[];
};

type TablePresence = {
  table: string;
  present: boolean;
};

type CountByKey = Record<string, number>;

function getEnvValue(name: "NEXT_PUBLIC_SUPABASE_URL" | "SUPABASE_SERVICE_ROLE_KEY" | "SUPABASE_URL"): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function loadLocalEnvFiles(): void {
  const repoRoot = path.resolve(process.cwd());
  const envPaths = [path.join(repoRoot, ".env.local"), path.join(repoRoot, ".env")];

  for (const envPath of envPaths) {
    if (!fs.existsSync(envPath)) {
      continue;
    }

    const content = fs.readFileSync(envPath, "utf8");
    for (const rawLine of content.split(/\r?\n/u)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) {
        continue;
      }

      const separatorIndex = line.indexOf("=");
      if (separatorIndex <= 0) {
        continue;
      }

      const key = line.slice(0, separatorIndex).trim();
      if (!key || process.env[key] !== undefined) {
        continue;
      }

      let value = line.slice(separatorIndex + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      process.env[key] = value;
    }
  }
}

function parseCliOptions(argv: string[]): CliOptions {
  const options: CliOptions = {
    nameQuery: null,
    showSafeNames: false,
    debugName: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--show-safe-names") {
      options.showSafeNames = true;
      continue;
    }

    if (arg === "--debug-name") {
      options.debugName = true;
      continue;
    }

    if (arg.startsWith("--name=")) {
      options.nameQuery = arg.slice("--name=".length).trim() || null;
      continue;
    }

    if (arg === "--name") {
      const next = argv[index + 1]?.trim();
      if (!next || next.startsWith("--")) {
        throw new Error(`${LOG_PREFIX} FAIL: missing value for --name`);
      }
      options.nameQuery = next;
      index += 1;
    }
  }

  return options;
}

function normalizeForMatch(input: string): string {
  return input
    .toLocaleLowerCase("ru")
    .replace(/ё/g, "е")
    .replace(/[^0-9a-zа-я]+/giu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasLatinLetters(value: string): boolean {
  return /[a-z]/iu.test(value);
}

function hasCyrillicLetters(value: string): boolean {
  return /[а-я]/iu.test(value);
}

function classifyNameScript(name: string | null | undefined): "latin" | "cyrillic" | "mixed" | "empty" {
  const trimmed = name?.trim() ?? "";
  if (!trimmed) {
    return "empty";
  }

  const latin = hasLatinLetters(trimmed);
  const cyrillic = hasCyrillicLetters(trimmed);

  if (latin && cyrillic) {
    return "mixed";
  }
  if (latin) {
    return "latin";
  }
  if (cyrillic) {
    return "cyrillic";
  }
  return "empty";
}

function looksLatinSlug(slug: string | null | undefined): boolean {
  const trimmed = slug?.trim() ?? "";
  if (!trimmed) {
    return false;
  }
  return /^[a-z0-9._-]+$/iu.test(trimmed) && hasLatinLetters(trimmed);
}

function redactDisplayName(name: string | null | undefined, showSafeNames: boolean): string {
  const trimmed = name?.trim() ?? "";
  if (!trimmed) {
    return "(empty)";
  }

  if (showSafeNames) {
    return trimmed;
  }

  const tokens = trimmed.split(/\s+/u).filter(Boolean);
  if (tokens.length >= 2) {
    const first = tokens[0] ?? "";
    const lastInitial = (tokens[tokens.length - 1] ?? "").slice(0, 1);
    if (first && lastInitial) {
      return `${first} ${lastInitial}.`;
    }
  }

  if (trimmed.length <= 3) {
    return `${trimmed.slice(0, 1)}*`;
  }

  return `${trimmed.slice(0, 3)}*`;
}

function businessDisplayName(chat: BusinessChatRow | null): string | null {
  if (!chat) {
    return null;
  }

  const parts = [chat.first_name, chat.last_name].map((part) => part?.trim()).filter(Boolean);
  if (parts.length > 0) {
    return parts.join(" ");
  }

  return chat.username?.trim() || null;
}

function collectIdentityValues(bundle: StudentIdentityBundle): Array<{ source: string; value: string }> {
  const values: Array<{ source: string; value: string }> = [];

  if (bundle.student.student_name.trim()) {
    values.push({ source: "trainingpeaks_name", value: bundle.student.student_name });
  }
  if (bundle.student.student_id.trim()) {
    values.push({ source: "trainingpeaks_id", value: bundle.student.student_id });
  }
  if (bundle.student.telegram_username?.trim()) {
    values.push({ source: "telegram_username", value: bundle.student.telegram_username });
  }

  const businessName = businessDisplayName(bundle.businessChat);
  if (businessName) {
    values.push({ source: "business_display_name", value: businessName });
  }

  if (bundle.billingClient?.client_name.trim()) {
    values.push({ source: "billing_client_name", value: bundle.billingClient.client_name });
  }

  for (const alias of bundle.aliases) {
    if (alias.trim()) {
      values.push({ source: "alias", value: alias });
    }
  }

  return values;
}

function matchesPatterns(value: string, patterns: readonly string[]): string[] {
  const normalized = normalizeForMatch(value);
  if (!normalized) {
    return [];
  }

  const tokens = normalized.split(" ").filter(Boolean);
  const matched: string[] = [];

  for (const pattern of patterns) {
    const normalizedPattern = normalizeForMatch(pattern);
    if (!normalizedPattern) {
      continue;
    }

    if (tokens.includes(normalizedPattern) || normalized.includes(normalizedPattern)) {
      matched.push(pattern);
    }
  }

  return matched;
}

function findNameMatches(
  bundles: StudentIdentityBundle[],
  patterns: readonly string[],
  activeOnly: boolean
): NameMatchResult[] {
  const results: NameMatchResult[] = [];

  for (const bundle of bundles) {
    if (activeOnly && !bundle.student.is_active) {
      continue;
    }

    const matchedSources = new Set<string>();
    const matchedPatterns = new Set<string>();

    for (const identity of collectIdentityValues(bundle)) {
      const patternHits = matchesPatterns(identity.value, patterns);
      if (patternHits.length > 0) {
        matchedSources.add(identity.source);
        for (const hit of patternHits) {
          matchedPatterns.add(hit);
        }
      }
    }

    if (matchedSources.size > 0) {
      results.push({
        bundle,
        matchedSources: [...matchedSources].sort(),
        matchedPatterns: [...matchedPatterns].sort(),
      });
    }
  }

  return results;
}

function printSection(title: string): void {
  console.log("");
  console.log(`${LOG_PREFIX} ${title}`);
}

function printCount(label: string, value: number): void {
  console.log(`${LOG_PREFIX} ${label}=${value}`);
}

function assertReadOnlySelectFields(fields: string[]): void {
  for (const field of fields) {
    if (FORBIDDEN_SELECT_FIELDS.has(field)) {
      throw new Error(`${LOG_PREFIX} FAIL: forbidden select field ${field}`);
    }
  }
}

function isMissingTableError(error: { message?: string; code?: string }): boolean {
  const message = (error.message ?? "").toLowerCase();
  const code = (error.code ?? "").toUpperCase();
  return (
    code === "PGRST205" ||
    code === "42P01" ||
    message.includes("does not exist") ||
    message.includes("could not find the table") ||
    message.includes("schema cache")
  );
}

async function tableExists(table: string): Promise<boolean> {
  const supabase = createSupabaseServerClient();
  const { error } = await supabase.from(table).select("id").limit(1);
  if (!error) {
    return true;
  }

  if (isMissingTableError(error)) {
    return false;
  }

  throw new Error(`${LOG_PREFIX} FAIL: ${table}: ${error.message}`);
}

async function countTableRows(table: string): Promise<number> {
  const supabase = createSupabaseServerClient();
  const { count, error } = await supabase.from(table).select("id", { head: true, count: "exact" });
  if (error) {
    if (isMissingTableError(error)) {
      return 0;
    }
    throw new Error(`${LOG_PREFIX} FAIL: ${table} count: ${error.message}`);
  }
  if (count == null) {
    const probe = await supabase.from(table).select("id").limit(1);
    if (probe.error && isMissingTableError(probe.error)) {
      return 0;
    }
  }
  return count ?? 0;
}

async function fetchAllStudents(): Promise<StudentRow[]> {
  const supabase = createSupabaseServerClient();
  const selectFields = [
    "id",
    "student_id",
    "student_name",
    "is_active",
    "telegram_chat_id",
    "telegram_username",
    "telegram_delivery_enabled",
    "telegram_profile_url",
  ];
  assertReadOnlySelectFields(selectFields);

  const rows: StudentRow[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from("trainingpeaks_students")
      .select(selectFields.join(", "))
      .order("student_id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      throw new Error(`${LOG_PREFIX} FAIL: trainingpeaks_students: ${error.message}`);
    }

    const page = (data as unknown as StudentRow[] | null) ?? [];
    rows.push(...page);

    if (page.length < PAGE_SIZE) {
      break;
    }

    from += PAGE_SIZE;
  }

  return rows;
}

async function fetchBusinessChats(): Promise<BusinessChatRow[]> {
  const supabase = createSupabaseServerClient();
  const selectFields = ["chat_id", "username", "first_name", "last_name"];
  assertReadOnlySelectFields(selectFields);

  const rows: BusinessChatRow[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from("trainingpeaks_telegram_business_chats")
      .select(selectFields.join(", "))
      .order("chat_id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      throw new Error(`${LOG_PREFIX} FAIL: trainingpeaks_telegram_business_chats: ${error.message}`);
    }

    const page = (data as unknown as BusinessChatRow[] | null) ?? [];
    rows.push(...page);

    if (page.length < PAGE_SIZE) {
      break;
    }

    from += PAGE_SIZE;
  }

  return rows;
}

async function fetchBillingClients(): Promise<BillingClientRow[]> {
  const supabase = createSupabaseServerClient();
  const selectFields = ["id", "student_id", "client_name", "is_active"];
  assertReadOnlySelectFields(selectFields);

  const rows: BillingClientRow[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from("billing_clients")
      .select(selectFields.join(", "))
      .order("client_name", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      throw new Error(`${LOG_PREFIX} FAIL: billing_clients: ${error.message}`);
    }

    const page = (data as unknown as BillingClientRow[] | null) ?? [];
    rows.push(...page);

    if (page.length < PAGE_SIZE) {
      break;
    }

    from += PAGE_SIZE;
  }

  return rows;
}

async function fetchAliasRows(table: string): Promise<AliasRow[]> {
  const supabase = createSupabaseServerClient();

  const columnProbe = await supabase.from(table).select("*").limit(1);
  if (columnProbe.error) {
    throw new Error(`${LOG_PREFIX} FAIL: ${table}: ${columnProbe.error.message}`);
  }

  const sample = (columnProbe.data?.[0] ?? {}) as Record<string, unknown>;
  const aliasField = ["alias", "alias_value", "name", "identity_value"].find((field) => field in sample) ?? "alias";
  const studentField =
    ["student_id", "trainingpeaks_student_id"].find((field) => field in sample) ?? "student_id";

  assertReadOnlySelectFields([aliasField, studentField]);

  const rows: AliasRow[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select(`${studentField}, ${aliasField}`)
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      throw new Error(`${LOG_PREFIX} FAIL: ${table}: ${error.message}`);
    }

    const page =
      (data as unknown as Array<Record<string, string | null>> | null)?.map((row) => ({
        student_id: row[studentField] ?? null,
        alias: row[aliasField] ?? null,
      })) ?? [];

    rows.push(...page);

    if (page.length < PAGE_SIZE) {
      break;
    }

    from += PAGE_SIZE;
  }

  return rows;
}

async function countDistinctStudents(table: string): Promise<number> {
  const supabase = createSupabaseServerClient();
  const rows: string[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select("student_id")
      .not("student_id", "is", null)
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      throw new Error(`${LOG_PREFIX} FAIL: ${table} student_id distinct: ${error.message}`);
    }

    const page = (data as unknown as Array<{ student_id: string }> | null) ?? [];
    rows.push(...page.map((row) => row.student_id));

    if (page.length < PAGE_SIZE) {
      break;
    }

    from += PAGE_SIZE;
  }

  return new Set(rows).size;
}

async function countGroupedField(table: string, field: string): Promise<CountByKey> {
  const supabase = createSupabaseServerClient();
  const counts: CountByKey = {};
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select(field)
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      throw new Error(`${LOG_PREFIX} FAIL: ${table}.${field}: ${error.message}`);
    }

    const page = (data as unknown as Array<Record<string, string | null>> | null) ?? [];
    for (const row of page) {
      const key = row[field]?.trim() || "(null)";
      counts[key] = (counts[key] ?? 0) + 1;
    }

    if (page.length < PAGE_SIZE) {
      break;
    }

    from += PAGE_SIZE;
  }

  return counts;
}

async function countPayerIdentities(): Promise<{ total: number; withDisplayHint: number }> {
  const supabase = createSupabaseServerClient();
  const { count: total, error: totalError } = await supabase
    .from("billing_payer_identities")
    .select("id", { head: true, count: "exact" });

  if (totalError) {
    throw new Error(`${LOG_PREFIX} FAIL: billing_payer_identities count: ${totalError.message}`);
  }

  const { count: withDisplayHint, error: hintError } = await supabase
    .from("billing_payer_identities")
    .select("id", { head: true, count: "exact" })
    .not("display_hint", "is", null);

  if (hintError) {
    throw new Error(`${LOG_PREFIX} FAIL: billing_payer_identities display_hint count: ${hintError.message}`);
  }

  return {
    total: total ?? 0,
    withDisplayHint: withDisplayHint ?? 0,
  };
}

function buildBundles(input: {
  students: StudentRow[];
  businessChats: BusinessChatRow[];
  billingClients: BillingClientRow[];
  aliasRows: AliasRow[];
}): StudentIdentityBundle[] {
  const businessByChatId = new Map(input.businessChats.map((chat) => [chat.chat_id, chat]));
  const billingByStudentUuid = new Map<string, BillingClientRow>();

  for (const client of input.billingClients) {
    if (client.student_id && !billingByStudentUuid.has(client.student_id)) {
      billingByStudentUuid.set(client.student_id, client);
    }
  }

  const aliasesByStudent = new Map<string, string[]>();
  for (const aliasRow of input.aliasRows) {
    if (!aliasRow.student_id || !aliasRow.alias?.trim()) {
      continue;
    }
    const existing = aliasesByStudent.get(aliasRow.student_id) ?? [];
    existing.push(aliasRow.alias.trim());
    aliasesByStudent.set(aliasRow.student_id, existing);
  }

  return input.students.map((student) => ({
    student,
    businessChat: student.telegram_chat_id ? businessByChatId.get(student.telegram_chat_id) ?? null : null,
    billingClient: billingByStudentUuid.get(student.id) ?? null,
    aliasCount: aliasesByStudent.get(student.id)?.length ?? 0,
    aliases: aliasesByStudent.get(student.id) ?? [],
  }));
}

function sourceFlags(bundle: StudentIdentityBundle): {
  tpName: boolean;
  telegramUsername: boolean;
  businessName: boolean;
  billingName: boolean;
  alias: boolean;
} {
  return {
    tpName: Boolean(bundle.student.student_name.trim()),
    telegramUsername: Boolean(bundle.student.telegram_username?.trim()),
    businessName: Boolean(businessDisplayName(bundle.businessChat)?.trim()),
    billingName: Boolean(bundle.billingClient?.client_name.trim()),
    alias: bundle.aliasCount > 0,
  };
}

function printCompactCandidateTable(
  matches: NameMatchResult[],
  showSafeNames: boolean,
  title: string
): void {
  printSection(title);
  printCount("candidate_count", matches.length);

  for (const match of matches) {
    const flags = sourceFlags(match.bundle);
    const safeName = redactDisplayName(match.bundle.student.student_name, showSafeNames);
    console.log(
      `${LOG_PREFIX} candidate id=${match.bundle.student.id.slice(0, 8)} slug=${match.bundle.student.student_id} name=${safeName} sources=${match.matchedSources.join(",")} patterns=${match.matchedPatterns.join(",")} flags=TP:${flags.tpName ? "Y" : "N"} TG:${flags.telegramUsername ? "Y" : "N"} Biz:${flags.businessName ? "Y" : "N"} Bill:${flags.billingName ? "Y" : "N"} Alias:${flags.alias ? "Y" : "N"}`
    );
  }
}

async function run(): Promise<void> {
  loadLocalEnvFiles();

  const options = parseCliOptions(process.argv.slice(2));

  const supabaseUrl = getEnvValue("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = getEnvValue("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    console.log(`${LOG_PREFIX} SKIP: missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY`);
    return;
  }

  if (!process.env.SUPABASE_URL) {
    process.env.SUPABASE_URL = supabaseUrl;
  }

  console.log(`${LOG_PREFIX} mode=read-only`);
  console.log(`${LOG_PREFIX} privacy=conservative${options.showSafeNames ? " (show-safe-names enabled)" : ""}`);

  const aliasPresence: TablePresence[] = [];
  for (const table of ALIAS_TABLE_CANDIDATES) {
    aliasPresence.push({ table, present: await tableExists(table) });
  }

  const presentAliasTable = aliasPresence.find((entry) => entry.present)?.table ?? null;

  const [students, businessChats, billingClients, aliasRows] = await Promise.all([
    fetchAllStudents(),
    fetchBusinessChats(),
    fetchBillingClients(),
    presentAliasTable ? fetchAliasRows(presentAliasTable) : Promise.resolve([] as AliasRow[]),
  ]);

  const bundles = buildBundles({ students, businessChats, billingClients, aliasRows });
  const activeBundles = bundles.filter((bundle) => bundle.student.is_active);
  const inactiveCount = bundles.length - activeBundles.length;

  printSection("1) Active student counts");
  printCount("students_total", bundles.length);
  printCount("students_active", activeBundles.length);
  printCount("students_inactive", inactiveCount);

  printSection("2) TrainingPeaks names");
  const nameScriptCounts = { latin: 0, cyrillic: 0, mixed: 0, empty: 0 };
  let withStudentName = 0;

  for (const bundle of bundles) {
    const name = bundle.student.student_name?.trim() ?? "";
    if (name) {
      withStudentName += 1;
    }
    nameScriptCounts[classifyNameScript(name)] += 1;
  }

  printCount("with_student_name", withStudentName);
  printCount("likely_latin_names", nameScriptCounts.latin);
  printCount("likely_cyrillic_names", nameScriptCounts.cyrillic);
  printCount("mixed_script_names", nameScriptCounts.mixed);
  printCount("empty_or_missing_names", nameScriptCounts.empty);

  printSection("3) Slugs");
  printCount("with_student_id_slug", bundles.filter((bundle) => bundle.student.student_id.trim()).length);
  printCount(
    "latin_or_transliterated_slugs",
    bundles.filter((bundle) => looksLatinSlug(bundle.student.student_id)).length
  );

  printSection("4) Telegram linkage");
  printCount(
    "with_telegram_chat_id",
    bundles.filter((bundle) => Boolean(bundle.student.telegram_chat_id?.trim())).length
  );
  printCount(
    "with_telegram_username",
    bundles.filter((bundle) => Boolean(bundle.student.telegram_username?.trim())).length
  );
  printCount(
    "with_telegram_delivery_enabled",
    bundles.filter((bundle) => bundle.student.telegram_delivery_enabled).length
  );
  printCount(
    "with_telegram_profile_url",
    bundles.filter((bundle) => Boolean(bundle.student.telegram_profile_url?.trim())).length
  );

  printSection("5) Telegram Business chat identity");
  printCount("business_chats_total", businessChats.length);
  printCount(
    "students_with_linked_business_chat",
    activeBundles.filter((bundle) => Boolean(bundle.businessChat)).length
  );
  printCount(
    "linked_business_chats_with_first_or_last_name",
    activeBundles.filter((bundle) => {
      if (!bundle.businessChat) {
        return false;
      }
      return Boolean(bundle.businessChat.first_name?.trim() || bundle.businessChat.last_name?.trim());
    }).length
  );

  printSection("6) Billing");
  const activeBillingClients = billingClients.filter((client) => client.is_active);
  printCount("billing_clients_active", activeBillingClients.length);
  printCount(
    "billing_clients_linked_to_trainingpeaks_student",
    billingClients.filter((client) => Boolean(client.student_id)).length
  );
  printCount(
    "linked_billing_clients_with_client_name",
    billingClients.filter((client) => Boolean(client.student_id && client.client_name.trim())).length
  );

  const payerIdentityCounts = await countPayerIdentities();
  printCount("billing_payer_identities_total", payerIdentityCounts.total);
  printCount("billing_payer_identities_with_display_hint", payerIdentityCounts.withDisplayHint);

  printSection("7) Current voice identity coverage (active students)");
  printCount(
    "active_with_trainingpeaks_name",
    activeBundles.filter((bundle) => Boolean(bundle.student.student_name.trim())).length
  );
  printCount(
    "active_with_telegram_username",
    activeBundles.filter((bundle) => Boolean(bundle.student.telegram_username?.trim())).length
  );
  printCount(
    "active_with_business_display_name",
    activeBundles.filter((bundle) => Boolean(businessDisplayName(bundle.businessChat)?.trim())).length
  );
  printCount(
    "active_with_billing_client_name",
    activeBundles.filter((bundle) => Boolean(bundle.billingClient?.client_name.trim())).length
  );
  printCount(
    "active_with_alias_rows",
    activeBundles.filter((bundle) => bundle.aliasCount > 0).length
  );

  printSection("Alias tables");
  for (const entry of aliasPresence) {
    console.log(`${LOG_PREFIX} alias_table ${entry.table} present=${entry.present ? "yes" : "no"}`);
  }
  if (presentAliasTable) {
    printCount("alias_rows_total", aliasRows.length);
  } else {
    console.log(`${LOG_PREFIX} alias_rows_total=0 (no alias table present)`);
  }

  printSection("Supplemental source aggregates");
  const supplementalTables = [
    "trainingpeaks_student_threads",
    "trainingpeaks_student_contact_events",
    "trainingpeaks_telegram_context_observations",
    "trainingpeaks_reply_drafts",
  ] as const;

  for (const table of supplementalTables) {
    const present = await tableExists(table);
    if (!present) {
      console.log(`${LOG_PREFIX} ${table} present=no`);
      continue;
    }

    const total = await countTableRows(table);
    printCount(`${table}_rows`, total);

    if (table !== "trainingpeaks_reply_drafts") {
      const distinctStudents = await countDistinctStudents(table);
      printCount(`${table}_distinct_students`, distinctStudents);
    } else {
      const distinctStudents = await countDistinctStudents(table);
      printCount(`${table}_distinct_students`, distinctStudents);
      const outcomeCounts = await countGroupedField(table, "outcome");
      for (const [key, value] of Object.entries(outcomeCounts).sort(([a], [b]) => a.localeCompare(b))) {
        printCount(`${table}_outcome_${key}`, value);
      }
    }

    if (table === "trainingpeaks_student_contact_events") {
      const eventTypeCounts = await countGroupedField(table, "event_type");
      for (const [key, value] of Object.entries(eventTypeCounts).sort(([a], [b]) => a.localeCompare(b))) {
        printCount(`${table}_event_type_${key}`, value);
      }
      const sourceCounts = await countGroupedField(table, "source");
      for (const [key, value] of Object.entries(sourceCounts).sort(([a], [b]) => a.localeCompare(b))) {
        printCount(`${table}_source_${key}`, value);
      }
    }

    if (table === "trainingpeaks_telegram_context_observations") {
      const sourceTypeCounts = await countGroupedField(table, "source_type");
      for (const [key, value] of Object.entries(sourceTypeCounts).sort(([a], [b]) => a.localeCompare(b))) {
        printCount(`${table}_source_type_${key}`, value);
      }
    }
  }

  printSection("8) Olga/Olya diagnostic (active students)");
  const olgaMatches = findNameMatches(bundles, OLGA_PATTERNS, true);
  printCompactCandidateTable(olgaMatches, options.showSafeNames, "Olga-like matches");

  printSection("9) Common name diagnostics (counts only)");
  for (const [groupName, patterns] of Object.entries(COMMON_NAME_GROUPS)) {
    const matches = findNameMatches(bundles, patterns, true);
    printCount(`${groupName}_candidate_count`, matches.length);

    if (options.debugName) {
      printCompactCandidateTable(matches, options.showSafeNames, `${groupName} matches (--debug-name)`);
    }
  }

  if (options.nameQuery) {
    const queryPatterns = [options.nameQuery];
    const customMatches = findNameMatches(bundles, queryPatterns, true);
    printCompactCandidateTable(customMatches, options.showSafeNames, `Custom --name "${options.nameQuery}" scan`);
  }

  console.log("");
  console.log(`${LOG_PREFIX} OK read-only diagnostic complete`);
}

void run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message.startsWith(`${LOG_PREFIX} FAIL:`) ? message : `${LOG_PREFIX} FAIL: ${message}`);
  process.exit(1);
});
