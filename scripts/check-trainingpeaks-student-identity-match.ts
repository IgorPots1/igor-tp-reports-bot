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
    studentName: "Иван Иванов",
    telegramUsername: "ivan_runner",
    isActive: true,
  },
  {
    id: "2",
    studentId: "petrova-m",
    studentName: "Мария Петрова",
    telegramUsername: "maria_track",
    isActive: true,
  },
  {
    id: "3",
    studentId: "sidorova-o",
    studentName: "Ольга Сидорова",
    telegramUsername: "olga_longrun",
    isActive: true,
  },
  {
    id: "4",
    studentId: "alex-s",
    studentName: "Александр Смирнов",
    telegramUsername: "alex_smirnov",
    isActive: true,
  },
  {
    id: "5",
    studentId: "alexandra-s",
    studentName: "Александра Соколова",
    telegramUsername: "alexandra_s",
    isActive: true,
  },
  {
    id: "6",
    studentId: "orlov-d",
    studentName: "Дмитрий Орлов",
    telegramUsername: "dima_orlov",
    isActive: false,
  },
];

function runMatch(query: string): ReturnType<typeof matchStudentByIdentity<MockStudent>> {
  const active = students.filter((student) => student.isActive);
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

function assertMatched(query: string, expectedStudentId: string, reason: string): number {
  const result = runMatch(query);
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
  reason: string
): number {
  const result = runMatch(query);
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

  failed += assertMatched("Мария Петрова", "petrova-m", "exact TrainingPeaks name");
  failed += assertMatched("Иванов Иван", "ivanov-i", "swapped first/last order");
  failed += assertMatched("@maria_track", "petrova-m", "telegram username with @");
  failed += assertMatched("Маша", "petrova-m", "nickname Маша -> Мария");
  failed += assertMatched("Оля", "sidorova-o", "nickname Оля -> Ольга");
  failed += assertStatus("Саша", "ambiguous", "ambiguous Саша with Александр + Александра");
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
