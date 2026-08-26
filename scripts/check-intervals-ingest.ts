/**
 * Детерминированный чек приёма Intervals.icu: заголовок авторизации и уровень
 * качества данных. Ни сети, ни базы — только чистые функции.
 *
 * Эти два места ломаются тихо и дорого. Заголовок: опечатка в логине-константе
 * или в порядке «логин:пароль» даёт 401 на КАЖДОМ запросе, и выглядит это как
 * «ученик дал плохой ключ». Уровень качества: сдвинутый порог заставит
 * генератор разбора рассуждать об интенсивности по тренировке, где пульс есть
 * на четверти дистанции.
 *
 *   npx tsx scripts/check-intervals-ingest.ts
 */
import assert from "node:assert/strict";

import { buildAuthorizationHeader, redactSecrets } from "@/features/intervals/auth";
import { assessDataQuality } from "@/features/intervals/data-quality";
import type { ActivityStreams } from "@/features/intervals/types";

// ── Заголовок авторизации ────────────────────────────────────────────────────

const apiKeyHeader = buildAuthorizationHeader({ authMethod: "api_key", credential: "secret123" });
assert.equal(
  apiKeyHeader,
  `Basic ${Buffer.from("API_KEY:secret123").toString("base64")}`,
  "api_key: логин обязан быть константой API_KEY, пароль — ключом ученика"
);

assert.equal(
  buildAuthorizationHeader({ authMethod: "oauth", credential: "tok" }),
  "Bearer tok",
  "oauth: заголовок Bearer с токеном"
);

// Переезд на OAuth обязан быть заменой ОДНОГО поля, поэтому обе ветки живут
// рядом и обе проверяются: следующий кусок меняет auth_method и больше ничего.
assert.notEqual(
  buildAuthorizationHeader({ authMethod: "api_key", credential: "x" }),
  buildAuthorizationHeader({ authMethod: "oauth", credential: "x" }),
  "способы авторизации должны давать разные заголовки"
);

assert.throws(
  () => buildAuthorizationHeader({ authMethod: "api_key", credential: "   " }),
  /Пустой credential/,
  "пустой ключ обязан падать здесь, а не превращаться в 401 у провайдера"
);

// ── Затирание секретов ───────────────────────────────────────────────────────

assert.equal(
  redactSecrets("Authorization: Basic YWJjOmRlZg=="),
  "Authorization: Basic «скрыто»",
  "basic-заголовок обязан затираться"
);
assert.equal(
  redactSecrets("Authorization: Bearer abc.def-ghi"),
  "Authorization: Bearer «скрыто»",
  "bearer-токен обязан затираться"
);
assert.match(
  redactSecrets("api_key=0123456789abcdef"),
  /«скрыто»/,
  "ключ в строке запроса обязан затираться"
);

// ── Уровень качества данных ──────────────────────────────────────────────────

function streams(hr: (number | null)[] | null, velocity: (number | null)[] | null): ActivityStreams {
  const length = hr?.length ?? velocity?.length ?? 0;
  return {
    time: Array.from({ length }, (_, index) => index),
    heartrate: hr,
    velocitySmooth: velocity,
  };
}

const none = assessDataQuality(null);
assert.equal(none.dataLevel, "none", "без рядов — none");
assert.equal(none.pointCount, 0);
assert.equal(none.hrCoveragePct, null, "ряда пульса не было — доля неизвестна, а не ноль");

const full = assessDataQuality(streams([120, 130, 140, 150], [3, 3, 3, 3]));
assert.equal(full.dataLevel, "heartrate", "полный пульс — heartrate");
assert.equal(full.hasHeartrate, true);
assert.equal(full.hasPace, true);
assert.equal(full.hrCoveragePct, 100);
assert.equal(full.pointCount, 4);

// Пульс на четверти тренировки: поле average_heartrate у такой активности будет
// заполнено, а рассуждать об интенсивности по ней нельзя.
const sparse = assessDataQuality(streams([120, null, null, null], [3, 3, 3, 3]));
assert.equal(sparse.dataLevel, "pace_only", "пульс на 25% — это не «есть пульс»");
assert.equal(sparse.hasHeartrate, false);
assert.equal(sparse.hrCoveragePct, 25);

// Ровно на пороге — считается годным: граница включительная.
const half = assessDataQuality(streams([120, 130, null, null], [3, 3, 3, 3]));
assert.equal(half.dataLevel, "heartrate", "50% покрытия — граница включительная");
assert.equal(half.hrCoveragePct, 50);

const paceOnly = assessDataQuality(streams(null, [3, 3, 3]));
assert.equal(paceOnly.dataLevel, "pace_only", "без ряда пульса — только темп");
assert.equal(paceOnly.hrCoveragePct, null);

const emptyHr = assessDataQuality(streams([null, null, null], [3, 3, 3]));
assert.equal(emptyHr.hrCoveragePct, 0, "ряд пришёл пустым — это ноль, а не «ряда не было»");
assert.equal(emptyHr.dataLevel, "pace_only");

// Стояние на светофоре — не отсутствие темпа, но и одних нулей мало.
const standing = assessDataQuality(streams(null, [0, 0, 0]));
assert.equal(standing.dataLevel, "none", "ряд скорости из одних нулей — данных о темпе нет");

const moving = assessDataQuality(streams(null, [0, 0, 2.5]));
assert.equal(moving.dataLevel, "pace_only", "хоть одна точка движения — темп есть");

console.log("check:intervals-ingest — все проверки пройдены");
