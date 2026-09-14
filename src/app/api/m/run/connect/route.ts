import type { NextRequest } from "next/server";

import { isRunAppEnabled, jsonResponse, resolveRunAppStudent } from "@/features/intervals/loop/miniapp-guard";
import { buildAuthorizeUrl, oauthConfigMissing, readOauthConfig } from "@/features/intervals/oauth";
import { createOauthState } from "@/features/intervals/repository";

export const runtime = "nodejs";

// Выдаёт ссылку авторизации Intervals. Ссылку СОБИРАЕТ СЕРВЕР: client_id и
// адрес возврата не должны зависеть от того, что пришлёт клиент, а state обязан
// родиться там же, где его потом проверят.
export async function POST(request: NextRequest): Promise<Response> {
  if (!isRunAppEnabled()) {
    return jsonResponse(503, { ok: false, error: "Приложение пока не включено." });
  }

  let body: { initData?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return jsonResponse(400, { ok: false, error: "Неверный запрос." });
  }

  const auth = await resolveRunAppStudent(body.initData);
  if (!auth.ok) {
    return jsonResponse(auth.httpStatus, { ok: false, error: auth.error, code: auth.code });
  }

  const config = readOauthConfig();
  if (!config) {
    // Ключей нет — это настройка среды, а не вина человека. Ему говорим
    // по-человечески, точную причину оставляем в логе для тренера.
    console.error("[m.run.connect] нет ключей приложения", { missing: oauthConfigMissing() });
    return jsonResponse(503, {
      ok: false,
      error: "Подключение пока недоступно. Напишите тренеру, он включит.",
    });
  }

  try {
    const state = await createOauthState(auth.studentUuid);
    return jsonResponse(200, { ok: true, url: buildAuthorizeUrl({ clientId: config.clientId, state }) });
  } catch (error) {
    console.error("[m.run.connect] не удалось выдать ссылку", error);
    return jsonResponse(500, { ok: false, error: "Не получилось начать подключение. Попробуйте ещё раз." });
  }
}
