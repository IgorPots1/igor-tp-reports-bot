/**
 * Привязать аккаунт Intervals.icu к ученику (или обновить доступ).
 *
 * СЕКРЕТ ЧИТАЕТСЯ ТОЛЬКО ИЗ ОКРУЖЕНИЯ и никогда из аргументов: то, что попало
 * в argv, остаётся в истории шелла и видно в ps любому процессу на машине.
 *
 *   node --experimental-strip-types --loader ./scripts/_alias-loader.mjs \
 *     --env-file=.env.local scripts/intervals-link-source.ts \
 *     --student=<student_id> --athlete=i38500 [--key-env=INTERVALS_PILOT_API_KEY] [--auth=api_key]
 *
 * Источник без владельца (личный аккаунт тренера, тестовое подключение) —
 * ученик не указывается, вместо него вид источника:
 *   node ... scripts/intervals-link-source.ts --kind=self --athlete=i38500
 *
 * Повторный запуск обновляет доступ того же ученика, а не заводит второй.
 */
import process from "node:process";

import { findStudentByKey, upsertSource } from "@/features/intervals/repository";
import type { DataSourceKind } from "@/features/intervals/types";

function arg(name: string): string | null {
  const prefix = `--${name}=`;
  const found = process.argv.find((value) => value.startsWith(prefix));
  return found ? found.slice(prefix.length).trim() : null;
}

async function main(): Promise<void> {
  const studentKey = arg("student");
  const athleteId = arg("athlete");
  const keyEnv = arg("key-env") ?? "INTERVALS_PILOT_API_KEY";
  const authMethod = (arg("auth") ?? "api_key") as "api_key" | "oauth";
  const kind = (arg("kind") ?? "student") as DataSourceKind;

  if (!athleteId) {
    console.error("Нужен --athlete=<i38500>");
    process.exit(1);
  }
  if (kind !== "student" && kind !== "self" && kind !== "test") {
    console.error("--kind принимает только student, self или test");
    process.exit(1);
  }
  // Боевой источник обязан иметь владельца — это же стережёт констрейнт в базе.
  // Проверяем и здесь, чтобы ошибка была понятной, а не текстом от Postgres.
  if (kind === "student" && !studentKey) {
    console.error("Для --kind=student нужен --student=<student_id>");
    process.exit(1);
  }
  // А у аккаунта тренера ученика быть не должно: если его указали, это почти
  // наверняка недоразумение, и молча игнорировать его нельзя.
  if (kind === "self" && studentKey) {
    console.error("--kind=self не сочетается с --student: у аккаунта тренера нет карточки ученика");
    process.exit(1);
  }
  if (authMethod !== "api_key" && authMethod !== "oauth") {
    console.error("--auth принимает только api_key или oauth");
    process.exit(1);
  }

  const credential = process.env[keyEnv]?.trim();
  if (!credential) {
    console.error(
      `Переменная окружения ${keyEnv} пуста. Положите в неё ключ ученика ` +
        "(intervals.icu → Settings → Developer Settings) и повторите."
    );
    process.exit(1);
  }

  let owner: { id: string; label: string } | null = null;
  if (studentKey) {
    const student = await findStudentByKey(studentKey);
    if (!student) {
      console.error(`Ученик со student_id=${studentKey} не найден`);
      process.exit(1);
    }
    owner = { id: student.id, label: `${student.studentName} (${student.studentId})` };
  }

  const sourceId = await upsertSource({
    studentUuid: owner?.id ?? null,
    kind,
    externalAthleteId: athleteId,
    authMethod,
    credential,
  });

  // Печатаем ЧТО угодно, кроме ключа: длину — и ту не показываем, она сужает
  // перебор. Достаточно факта «принят».
  console.log(
    `Источник сохранён: вид ${kind}, владелец ${owner?.label ?? "нет (источник без ученика)"}, ` +
      `athlete ${athleteId}, способ ${authMethod}, строка ${sourceId}`
  );
}

main().catch((error) => {
  console.error(String(error));
  process.exit(1);
});
