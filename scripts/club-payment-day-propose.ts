/**
 * F4 — propose a planned_payment_day for billing clients that have none, from their OWN payment history.
 * A client with no planned_payment_day is silently un-remindable (see F3). For each such client we look at
 * the day-of-month of their real payments (billing_monthly_payments.actual_payment_date) and propose the
 * MODAL day (ties → the earlier day), together with how many payments back it. Only clients with at least
 * MIN_PAYMENTS dated payments get a proposal — one payment is not a pattern.
 *
 * DRY-RUN by default: prints «client | proposed day | based on N payments», writes NOTHING.
 * With --commit: sets billing_clients.planned_payment_day for the proposed clients.
 *
 *   node --experimental-strip-types --loader ./scripts/_alias-loader.mjs \
 *     --env-file=/Users/igor/igor-tp-reports-bot/.env.local scripts/club-payment-day-propose.ts [--commit]
 */
import { createSupabaseServerClient } from "@/features/supabase/server";

const COMMIT = process.argv.includes("--commit");
const MIN_PAYMENTS = Number(process.argv.find((a) => a.startsWith("--min="))?.slice("--min=".length)) || 2;

type Client = { id: string; client_name: string | null; planned_payment_day: number | null; is_active: boolean | null };
type Pay = { billing_client_id: string; actual_payment_date: string | null };

function modalDay(days: number[]): number | null {
  if (days.length === 0) return null;
  const count = new Map<number, number>();
  for (const d of days) count.set(d, (count.get(d) ?? 0) + 1);
  // most frequent; tie → the smaller (earlier) day
  return [...count.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
}

async function main(): Promise<void> {
  const supabase = createSupabaseServerClient();
  const { data: cData, error: cErr } = await supabase
    .from("billing_clients")
    .select("id, client_name, planned_payment_day, is_active")
    .is("planned_payment_day", null);
  if (cErr) throw new Error(`billing_clients: ${cErr.message}`);
  const clients = ((cData ?? []) as Client[]).filter((c) => c.is_active !== false);
  if (clients.length === 0) { console.log("Клиентов без planned_payment_day нет."); return; }

  const ids = clients.map((c) => c.id);
  const { data: pData, error: pErr } = await supabase
    .from("billing_monthly_payments")
    .select("billing_client_id, actual_payment_date")
    .in("billing_client_id", ids)
    .not("actual_payment_date", "is", null);
  if (pErr) throw new Error(`billing_monthly_payments: ${pErr.message}`);
  const pays = (pData ?? []) as Pay[];

  const daysByClient = new Map<string, number[]>();
  for (const p of pays) {
    const m = (p.actual_payment_date ?? "").match(/^\d{4}-\d{2}-(\d{2})/);
    if (!m) continue;
    const day = Number(m[1]);
    if (day < 1 || day > 31) continue;
    (daysByClient.get(p.billing_client_id) ?? daysByClient.set(p.billing_client_id, []).get(p.billing_client_id)!).push(day);
  }

  const plan: Array<{ id: string; name: string; day: number; n: number; spread: number[] }> = [];
  const noBasis: string[] = [];
  for (const c of clients) {
    const days = daysByClient.get(c.id) ?? [];
    if (days.length < MIN_PAYMENTS) { noBasis.push(`${c.client_name ?? c.id.slice(0, 8)} (${days.length} платежей)`); continue; }
    const day = modalDay(days);
    if (day == null) { noBasis.push(c.client_name ?? c.id.slice(0, 8)); continue; }
    // clamp to a safe planned day (1..28) — a modal 29/30/31 does not exist every month
    plan.push({ id: c.id, name: c.client_name ?? c.id.slice(0, 8), day: Math.min(day, 28), n: days.length, spread: [...new Set(days)].sort((a, b) => a - b) });
  }
  plan.sort((a, b) => a.name.localeCompare(b.name));

  console.log(`=== F4 payment-day proposal — ${plan.length} proposed, ${noBasis.length} without basis ${COMMIT ? "(COMMIT)" : "(DRY-RUN)"} ===\n`);
  console.log("client".padEnd(28), "proposed day", "based on", "days seen");
  for (const p of plan) console.log(p.name.padEnd(28), String(p.day).padStart(9), " ", String(p.n).padStart(6), "  ", p.spread.join(","));
  if (noBasis.length) console.log(`\nбез основания (<${MIN_PAYMENTS} датированных платежей): ${noBasis.join("; ")}`);

  if (!COMMIT) { console.log("\nDRY-RUN: ничего не записано. --commit проставит planned_payment_day предложенным."); return; }

  let ok = 0;
  for (const p of plan) {
    const { error } = await supabase.from("billing_clients").update({ planned_payment_day: p.day }).eq("id", p.id).is("planned_payment_day", null);
    if (error) { console.log(`  FAIL ${p.name}: ${error.message}`); continue; }
    ok++;
  }
  console.log(`\nCOMMIT: ${ok}/${plan.length} billing_clients.planned_payment_day проставлено.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
