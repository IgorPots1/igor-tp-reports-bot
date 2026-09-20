/**
 * Чек: результат роста лексикона не остался незакоммиченным.
 *
 * ЧТО ЭТО ЛОВИТ. 14.09.2026 кто-то прогнал build-feedback-lexicon.ts (режимы
 * grow и blacklist), файлы изменились — 35 живых стемов и 22 кандидата — и так
 * и остались в рабочем дереве. Шесть дней. Обнаружилось случайно, при сборке
 * локальной админки: в бандл ушло одно, на Vercel было другое, и разбор
 * черновиков в двух местах вёл себя по-разному.
 *
 * ПОЧЕМУ ЭТО НЕ ЛОВИЛОСЬ САМО. draft-lexicon.ts импортирует JSON напрямую,
 * поэтому незакоммиченный файл работает ЛОКАЛЬНО и молчит. Ни один тип, ни один
 * тест, ни одна сборка не жалуются: файл валиден, просто его нет в репозитории.
 * Расхождение видно только тому, кто сравнит две машины.
 *
 * ПОЧЕМУ ЧЕК, А НЕ ХУК. Хук срабатывает на коммите, а этот случай — про
 * ОТСУТСТВИЕ коммита. Блокировать чужой коммит из-за грязного лексикона тоже
 * неверно: человек чинит совсем другое. Поэтому отдельный чек, который гоняют
 * перед нарядом, плюс громкое напоминание в самом build-feedback-lexicon.ts.
 *
 *   npx tsx scripts/check-lexicon-committed.ts
 */
import { execFileSync } from "node:child_process";
import process from "node:process";

const LEX_DIR = "src/features/trainingpeaks/feedback/lexicon";

function gitStatus(): string {
  try {
    return execFileSync("git", ["status", "--porcelain", "--", LEX_DIR], {
      encoding: "utf8",
    });
  } catch (error) {
    console.error(`⛔ git не отвечает: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

const dirty = gitStatus()
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line.length > 0);

if (dirty.length === 0) {
  console.log("check:lexicon-committed — лексикон закоммичен, расхождения нет");
  process.exit(0);
}

console.error("⛔ Лексикон изменён и НЕ закоммичен:");
for (const line of dirty) console.error(`   ${line}`);
console.error("");
console.error("Пока это так, локальная сборка и прод разбирают черновики ПО-РАЗНОМУ:");
console.error("draft-lexicon.ts импортирует эти JSON напрямую, поэтому у вас они есть,");
console.error("а на Vercel их нет. Ни один тип и ни один тест этого не увидят.");
console.error("");
console.error("Что сделать:");
console.error(`   git add ${LEX_DIR} && git commit -m "chore(feedback): выросший лексикон"`);
console.error("Либо, если прогон был разведочный и результат не нужен:");
console.error(`   git restore ${LEX_DIR}`);
process.exit(1);
