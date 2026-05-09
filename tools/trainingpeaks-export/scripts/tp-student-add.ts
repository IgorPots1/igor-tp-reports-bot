import process from "node:process";

import {
  ensureStudentsConfigExists,
  findStudentById,
  readStudentsConfig,
  writeStudentsConfig
} from "./lib/students.ts";

type CliArgs = {
  student: string;
  name: string;
  url: string;
  update: boolean;
  legacyLocalOnly: boolean;
};

function usage(): string {
  return [
    "Usage:",
    '  npm run tp-student-add -- --legacy-local-only --student=Olga --name="Ольга" --url="https://app.trainingpeaks.com/#calendar/athletes/5734279"',
    '  npm run tp-student-add -- --legacy-local-only --student=Olga --name="Ольга" --url="https://app.trainingpeaks.com/#calendar/athletes/5734279" --update'
  ].join("\n");
}

function parseArgs(argv: string[]): CliArgs {
  const values: Partial<Omit<CliArgs, "update" | "legacyLocalOnly">> = {};
  let update = false;
  let legacyLocalOnly = false;

  for (const arg of argv) {
    if (arg === "--update") {
      update = true;
      continue;
    }

    if (arg === "--legacy-local-only") {
      legacyLocalOnly = true;
      continue;
    }

    if (!arg.startsWith("--")) {
      continue;
    }

    const [rawKey, ...rest] = arg.slice(2).split("=");
    const value = rest.join("=");
    if (!value) {
      continue;
    }

    if (rawKey === "student" || rawKey === "name" || rawKey === "url") {
      values[rawKey] = value;
    }
  }

  if (!values.student || !values.name || !values.url) {
    throw new Error(`Missing required CLI args.\n\n${usage()}`);
  }

  return {
    student: values.student,
    name: values.name,
    url: values.url,
    update,
    legacyLocalOnly
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (!args.legacyLocalOnly) {
    throw new Error(
      `tp-student-add is now legacy/local-only and refuses to update config/students.json without --legacy-local-only.\nUse Web Admin / Supabase as the source of truth, then run tp-sync-students.\n\n${usage()}`
    );
  }

  console.warn(
    "WARNING: tp-student-add only changes local config/students.json. Supabase / Web Admin remains the source of truth."
  );
  await ensureStudentsConfigExists();

  const students = await readStudentsConfig();
  const existingStudent = findStudentById(students, args.student);

  if (existingStudent && !args.update) {
    console.log(`Student "${args.student}" already exists.`);
    console.log("Re-run with --update to change only the name and URL.");
    process.exit(1);
  }

  if (existingStudent) {
    const updatedStudents = students.map((student) =>
      student.student_id === args.student
        ? {
            ...student,
            name: args.name,
            trainingpeaks_athlete_url: args.url
          }
        : student
    );

    await writeStudentsConfig(updatedStudents);
    console.log(`Updated student "${args.student}".`);
    return;
  }

  const nextStudents = [
    ...students,
    {
      student_id: args.student,
      name: args.name,
      trainingpeaks_athlete_url: args.url,
      is_active: true,
      weekly_report_enabled: true,
      data_quality_status: "ok",
      notes: ""
    }
  ];

  await writeStudentsConfig(nextStudents);
  console.log(`Added student "${args.student}".`);
}

main().catch((error: unknown) => {
  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(error);
  }

  process.exit(1);
});
