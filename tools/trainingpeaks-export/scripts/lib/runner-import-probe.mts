// Проба импорта для check:runner-import-health. НИЧЕГО не делает: только тянет ту самую цепочку,
// на которой 11.08.2026 легли боевые раннеры — scripts/ -> src/features/trainingpeaks/repository.ts,
// а внутри него импорты через алиас @/.
//
// Импорт безопасен и не ходит в сеть: repository.ts создаёт клиента Supabase ВНУТРИ функций,
// на верхнем уровне ничего не выполняется. Поэтому проба не пишет в БД и не требует живых ключей.
//
// Файл лежит именно в scripts/lib/, а не где-то в стороне: у tsx разрешение tsconfig зависит от
// расположения файла, поэтому проба обязана жить там же, где живут настоящие раннеры — иначе она
// проверяла бы не ту конфигурацию.
import * as repository from "../../../../src/features/trainingpeaks/repository.ts";

const exportCount = Object.keys(repository).length;
if (exportCount === 0) {
  console.error("PROBE FAIL: модуль импортировался, но пустой — цепочка разрешилась не туда");
  process.exit(1);
}
console.log(`PROBE OK: ${exportCount} экспортов`);
