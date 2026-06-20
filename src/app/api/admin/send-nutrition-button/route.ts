import type { NextRequest } from "next/server";

import { sendNutritionFormButtonToStudent } from "@/features/nutrition/send-nutrition-form";
import { isValidAdminAccessToken } from "@/lib/admin-auth";

export const runtime = "nodejs";

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function checkAdminAuth(request: NextRequest): boolean {
  const auth = request.headers.get("Authorization");
  const token = auth?.startsWith("Bearer ") ? auth.slice(7).trim() : null;
  if (token && isValidAdminAccessToken(token)) return true;
  // Also accept the token as a query param (curl convenience).
  const qp = new URL(request.url).searchParams.get("admin_token");
  return Boolean(qp && isValidAdminAccessToken(qp));
}

export async function GET(request: NextRequest): Promise<Response> {
  if (!checkAdminAuth(request)) {
    return jsonResponse(401, { ok: false, error: "Unauthorized" });
  }

  const studentId = new URL(request.url).searchParams.get("studentId")?.trim();
  if (!studentId) {
    return jsonResponse(400, { ok: false, error: "studentId required" });
  }

  const result = await sendNutritionFormButtonToStudent(studentId);
  if (!result.ok) {
    return jsonResponse(422, { ok: false, error: result.reason });
  }

  return jsonResponse(200, { ok: true, studentId, studentName: result.studentName });
}
