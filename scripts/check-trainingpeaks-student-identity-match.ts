import { matchStudentByIdentity } from "@/features/trainingpeaks/student-identity-match";

type MockStudent = {
  id: string;
  studentId: string;
  studentName: string;
  telegramUsername: string | null;
  isActive: boolean;
};

const students: MockStudent[] = [
  {
    id: "1",
    studentId: "ivanov-i",
    studentName: "Ivan Ivanov",
    telegramUsername: "ivan_runner",
    isActive: true,
  },
  {
    id: "2",
    studentId: "petrova-m",
    studentName: "Maria Petrova",
    telegramUsername: "maria_track",
    isActive: true,
  },
  {
    id: "3",
    studentId: "olga-ivanova",
    studentName: "Olga Ivanova",
    telegramUsername: "olga_longrun",
    isActive: true,
  },
  {
    id: "4",
    studentId: "sidorova-e",
    studentName: "Ekaterina Sidorova",
    telegramUsername: "katya_track",
    isActive: true,
  },
  {
    id: "5",
    studentId: "alex-s",
    studentName: "Alexander Smirnov",
    telegramUsername: "alex_smirnov",
    isActive: true,
  },
  {
    id: "6",
    studentId: "alexandra-s",
    studentName: "Alexandra Sokolova",
    telegramUsername: "alexandra_s",
    isActive: true,
  },
  {
    id: "7",
    studentId: "polyakova-a",
    studentName: "Polyakova Anastasia",
    telegramUsername: "poly_anastasia",
    isActive: true,
  },
  {
    id: "8",
    studentId: "olga-petrova",
    studentName: "Olga Petrova",
    telegramUsername: "olga_pace",
    isActive: true,
  },
  {
    id: "9",
    studentId: "orlov-d",
    studentName: "Dmitry Orlov",
    telegramUsername: "dima_orlov",
    isActive: false,
  },
];

function runMatch(
  query: string,
  customStudents: MockStudent[] = students
): ReturnType<typeof matchStudentByIdentity<MockStudent>> {
  const active = customStudents.filter((student) => student.isActive);
  return matchStudentByIdentity({
    query,
    students: active,
    buildIdentities: (student) => [
      { value: student.studentName, kind: "trainingpeaks_name", weight: 1 },
      { value: student.studentId, kind: "trainingpeaks_id", weight: 1 },
      { value: student.telegramUsername, kind: "telegram_username", weight: 1.1 },
    ],
  });
}

function assertMatched(
  query: string,
  expectedStudentId: string,
  reason: string,
  customStudents: MockStudent[] = students
): number {
  const result = runMatch(query, customStudents);
  if (result.status !== "matched") {
    console.log(`FAIL: ${reason} | expected matched, got ${result.status}`);
    return 1;
  }
  if (result.student.studentId !== expectedStudentId) {
    console.log(
      `FAIL: ${reason} | expected ${expectedStudentId}, got ${result.student.studentId} (${result.matchedBy})`
    );
    return 1;
  }
  console.log(`PASS: ${reason} -> ${result.student.studentName} (${result.matchedBy})`);
  return 0;
}

function assertStatus(
  query: string,
  expectedStatus: "ambiguous" | "unmatched",
  reason: string,
  customStudents: MockStudent[] = students
): number {
  const result = runMatch(query, customStudents);
  if (result.status !== expectedStatus) {
    console.log(`FAIL: ${reason} | expected ${expectedStatus}, got ${result.status}`);
    return 1;
  }
  const preview =
    result.candidates.length > 0
      ? result.candidates
          .slice(0, 2)
          .map((candidate) => `${candidate.student.studentName}:${candidate.matchedBy}`)
          .join(", ")
      : "none";
  console.log(`PASS: ${reason} -> ${result.status} (${preview})`);
  return 0;
}

async function run(): Promise<void> {
  let failed = 0;

  failed += assertMatched("Maria Petrova", "petrova-m", "exact TrainingPeaks name");
  failed += assertMatched("Иванов Иван", "ivanov-i", "swapped first/last order");
  failed += assertMatched("@maria_track", "petrova-m", "telegram username with @");
  failed += assertMatched("Маша", "petrova-m", "nickname Маша -> Мария");
  const uniqueOlgaStudents = students.filter((student) => student.studentId !== "olga-petrova");
  failed += assertMatched("Оле", "olga-ivanova", "dative Оле -> Olga Ivanova (unique)", uniqueOlgaStudents);
  failed += assertMatched("Ольге", "olga-ivanova", "dative Ольге -> Olga Ivanova (unique)", uniqueOlgaStudents);
  failed += assertMatched("Оля", "olga-ivanova", "nickname Оля -> Olga Ivanova (unique)", uniqueOlgaStudents);
  failed += assertMatched("Маше", "petrova-m", "dative Маше -> Maria Petrova");
  failed += assertMatched("Кате", "sidorova-e", "dative Кате -> Ekaterina Sidorova");
  failed += assertStatus("Саша", "ambiguous", "ambiguous Саша with Александр + Александра");
  failed += assertStatus("Саше", "ambiguous", "ambiguous Саше with Alexander + Alexandra");
  failed += assertMatched("Иванова", "olga-ivanova", "surname token Иванова -> Ivanova");
  failed += assertStatus("Оле", "ambiguous", "ambiguous Оле with multiple Olga candidates");
  failed += assertStatus(
    "Оля",
    "ambiguous",
    "false positive Polyakova should not beat real Olga candidates"
  );
  failed += assertStatus("Орлов", "unmatched", "inactive excluded by caller wrapper");
  failed += assertStatus("Неизвестный Ученик", "unmatched", "unknown name unmatched");

  if (failed > 0) {
    console.log(`\ncheck-trainingpeaks-student-identity-match: FAILED (${failed})`);
    process.exitCode = 1;
    return;
  }

  console.log("\ncheck-trainingpeaks-student-identity-match: PASSED");
}

run().catch((error) => {
  console.error("check-trainingpeaks-student-identity-match crashed", error);
  process.exitCode = 1;
});
