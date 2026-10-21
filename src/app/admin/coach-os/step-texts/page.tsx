/**
 * Эталоны текстов шагов [решение Игоря, 21.10.2026]: ключ, текст, когда
 * поставлен, откуда (ссылка на тренировку), снять. Живой эталон один на ключ;
 * снятый остаётся в списке ниже, генератор его больше не берёт.
 */
import Link from "next/link";

import FormActionButton from "@/app/admin/FormActionButton";
import { STEP_KEYS, STEP_KEY_LABEL_RU } from "@/features/intervals/step-texts/keys";
import { listEtalons } from "@/features/intervals/step-texts/repository";
import { createSupabaseServerClient } from "@/features/supabase/server";

import { retireEtalonAction } from "../beginner/actions";

export const dynamic = "force-dynamic";

const cell = { padding: "6px 10px", verticalAlign: "top" as const, borderBottom: "1px solid #eee" };

export default async function StepTextsPage() {
  const etalons = await listEtalons();
  const sourceIds = [...new Set(etalons.map((e) => e.sourceSessionId).filter((x): x is string => !!x))];
  const where = new Map<string, { studentUuid: string; studentName: string; date: string; title: string }>();
  if (sourceIds.length) {
    const supabase = createSupabaseServerClient();
    const { data } = await supabase
      .from("intervals_plan_sessions")
      .select("id, session_date, title, intervals_plan_cycles(student_data_sources(student_id, trainingpeaks_students(student_name)))")
      .in("id", sourceIds);
    for (const row of (data ?? []) as unknown as {
      id: string;
      session_date: string;
      title: string;
      intervals_plan_cycles: { student_data_sources: { student_id: string; trainingpeaks_students: { student_name: string } | null } | null } | null;
    }[]) {
      const src = row.intervals_plan_cycles?.student_data_sources;
      if (src) where.set(row.id, { studentUuid: src.student_id, studentName: src.trainingpeaks_students?.student_name ?? "?", date: row.session_date, title: row.title });
    }
  }
  const live = etalons.filter((e) => !e.retiredAt);
  const retired = etalons.filter((e) => e.retiredAt);
  const liveKeys = new Set(live.map((e) => e.stepKey));

  const source = (id: string | null) => {
    const w = id ? where.get(id) : null;
    if (!w) return <span style={{ color: "#999" }}>—</span>;
    return (
      <Link href={`/admin/coach-os/beginner/${w.studentUuid}#s-${id}`}>
        {w.studentName}, {w.date} · {w.title}
      </Link>
    );
  };

  return (
    <section style={{ maxWidth: 1000 }}>
      <h1>Эталоны текстов шагов</h1>
      <p style={{ color: "#555", margin: "0 0 14px" }}>
        Генератор берёт текст шага отсюда, если эталон есть, иначе свой. Только текст: минуты, повторы и «усилие N из 10» ставит генератор.
      </p>
      <table style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead>
          <tr style={{ textAlign: "left" }}>
            <th style={cell}>Ключ</th>
            <th style={cell}>Текст</th>
            <th style={cell}>Поставлен</th>
            <th style={cell}>Откуда</th>
            <th style={cell} />
          </tr>
        </thead>
        <tbody>
          {live.map((e) => (
            <tr key={e.id}>
              <td style={cell}>{STEP_KEY_LABEL_RU[e.stepKey]}</td>
              <td style={{ ...cell, whiteSpace: "pre-wrap" }}>{e.text}</td>
              <td style={cell}>
                {e.setAt.slice(0, 16).replace("T", " ")}
                <div style={{ color: "#888", fontSize: 12 }}>{e.setBy}</div>
              </td>
              <td style={cell}>{source(e.sourceSessionId)}</td>
              <td style={cell}>
                <form action={retireEtalonAction}>
                  <input type="hidden" name="id" value={e.id} />
                  <FormActionButton confirmMessage="Снять эталон? Генератор вернётся к своему тексту для этого ключа. Уже собранные тренировки не изменятся." pendingText="Снимаю…">
                    Снять
                  </FormActionButton>
                </form>
              </td>
            </tr>
          ))}
          {STEP_KEYS.filter((k) => !liveKeys.has(k)).map((k) => (
            <tr key={k} style={{ color: "#999" }}>
              <td style={cell}>{STEP_KEY_LABEL_RU[k]}</td>
              <td style={cell} colSpan={4}>
                эталона нет — текст генератора
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {retired.length ? (
        <details style={{ marginTop: 18 }}>
          <summary style={{ cursor: "pointer" }}>Снятые ({retired.length})</summary>
          {retired.map((e) => (
            <div key={e.id} style={{ padding: "6px 0", borderBottom: "1px solid #eee", fontSize: 13 }}>
              <strong>{STEP_KEY_LABEL_RU[e.stepKey]}</strong> · {e.setAt.slice(0, 10)} → снят {e.retiredAt?.slice(0, 10)} ({e.retiredBy})
              <div style={{ whiteSpace: "pre-wrap", color: "#555" }}>{e.text}</div>
            </div>
          ))}
        </details>
      ) : null}
    </section>
  );
}
