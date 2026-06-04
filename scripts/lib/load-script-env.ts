import fs from "node:fs";
import path from "node:path";
import process from "node:process";

type ScriptEnvResult = {
  supabaseUrl: string;
  serviceRoleKey: string;
};

function parseEnvFile(filePath: string): void {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const content = fs.readFileSync(filePath, "utf8");
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

function getEnvValue(name: "NEXT_PUBLIC_SUPABASE_URL" | "SUPABASE_URL" | "SUPABASE_SERVICE_ROLE_KEY"): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

export function loadScriptEnv(): void {
  const repoRoot = path.resolve(process.cwd());
  const envPaths = [path.join(repoRoot, ".env.local"), path.join(repoRoot, ".env")];
  for (const envPath of envPaths) {
    parseEnvFile(envPath);
  }
}

export function getSupabaseEnvStatus(): { hasUrl: boolean; hasServiceKey: boolean } {
  const supabaseUrl = getEnvValue("NEXT_PUBLIC_SUPABASE_URL") ?? getEnvValue("SUPABASE_URL");
  const serviceRoleKey = getEnvValue("SUPABASE_SERVICE_ROLE_KEY");
  return {
    hasUrl: Boolean(supabaseUrl),
    hasServiceKey: Boolean(serviceRoleKey),
  };
}

export function resolveSupabaseEnv(): ScriptEnvResult | null {
  const supabaseUrl = getEnvValue("NEXT_PUBLIC_SUPABASE_URL") ?? getEnvValue("SUPABASE_URL");
  const serviceRoleKey = getEnvValue("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return null;
  }
  if (!process.env.SUPABASE_URL) {
    process.env.SUPABASE_URL = supabaseUrl;
  }
  return {
    supabaseUrl,
    serviceRoleKey,
  };
}

export function assertSupabaseEnvOrSkip(scriptName: string): ScriptEnvResult | null {
  const resolved = resolveSupabaseEnv();
  if (resolved) {
    return resolved;
  }

  const status = getSupabaseEnvStatus();
  console.log(
    `[${scriptName}] SKIP: missing NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (hasUrl=${status.hasUrl} hasServiceKey=${status.hasServiceKey})`
  );
  return null;
}
