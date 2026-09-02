/**
 * Сведение источников в одну модель.
 *
 * Живёт отдельным модулем НАМЕРЕННО: этими же правилами пользуются и отчёт о
 * расхождениях, и сборка каталога. Держи их в двух местах — и однажды отчёт
 * скажет «всё сошлось», а в каталог поедет другое число.
 */
import { modelKey, normalizeBrand } from "./match";
import { reconcileNumber, type Observation, type Reconciled } from "./reconcile";
import type { ParsedSpec } from "./parsers/rtings";

export type RtingsModel = {
  brandSlug: string;
  modelSlug: string;
  url: string;
  specs: Record<string, ParsedSpec>;
};
export type RunRepeatModel = { slug: string; url: string; specs: Record<string, ParsedSpec> };

/**
 * Поля, где обе лаборатории меряют одно и то же.
 *
 * Ширина платформы взята с оговоркой: RTINGS даёт ширину ПОДОШВЫ, RunRepeat —
 * ширину МЕЖПОДОШВЫ в том же месте. Величины близкие, но не тождественные;
 * сводим осознанно, потому что правило десяти процентов как раз и поймает
 * случаи, где разница перестала быть несущественной. Источник у каждого числа
 * подписан, так что различие видно, а не спрятано.
 */
export const COMPARABLE: { field: string; rtings: string; runrepeat: string; note?: string }[] = [
  { field: "weight_g", rtings: "weight_g", runrepeat: "weight_men_g" },
  { field: "stack_heel_mm", rtings: "stack_heel_mm", runrepeat: "stack_heel_mm" },
  { field: "stack_fore_mm", rtings: "stack_fore_mm", runrepeat: "stack_fore_mm" },
  { field: "drop_mm", rtings: "drop_mm", runrepeat: "drop_mm" },
  {
    field: "platform_width_heel_mm",
    rtings: "platform_width_heel_mm",
    runrepeat: "platform_width_heel_mm",
    note: "RTINGS меряет подошву, RunRepeat межподошву — величины близкие, но не одна и та же",
  },
  {
    field: "platform_width_fore_mm",
    rtings: "platform_width_fore_mm",
    runrepeat: "platform_width_fore_mm",
    note: "то же различие подошва/межподошва",
  },
];

/** Поля, которые есть только у RunRepeat: подтверждать их нечем и некем. */
export const RUNREPEAT_ONLY = [
  "midsole_softness_ac",
  "heel_counter_stiffness",
  "outsole_thickness_mm",
  "outsole_wear_mm",
  "outsole_hardness_hc",
  "midsole_softness_cold_pct",
  "toebox_width_mm",
  "weight_women_g",
  "widths_available",
];

export type MergedModel = {
  key: string;
  sources: string[];
  /** Поля, сведённые из двух источников. */
  reconciled: Record<string, Reconciled>;
  /** Поля от единственного источника — со своей пометкой. */
  single: Record<string, ParsedSpec & { source: string }>;
};

const obsFrom = (source: string, spec: ParsedSpec | undefined): Observation[] =>
  spec && typeof spec.value === "number"
    ? [{ source, value: spec.value, kind: spec.kind, evidence: spec.evidence }]
    : [];

export function mergeSources(
  rtings: RtingsModel[],
  runrepeat: RunRepeatModel[]
): { models: MergedModel[]; matched: number } {
  const rtByKey = new Map(rtings.map((s) => [modelKey(normalizeBrand(s.brandSlug), s.modelSlug), s]));
  const rrByKey = new Map(runrepeat.map((s) => [modelKey("", s.slug), s]));
  const keys = [...new Set([...rtByKey.keys(), ...rrByKey.keys()])].sort();

  let matched = 0;
  const models: MergedModel[] = keys.map((key) => {
    const a = rtByKey.get(key);
    const b = rrByKey.get(key);
    if (a && b) matched += 1;

    const reconciled: Record<string, Reconciled> = {};
    for (const c of COMPARABLE) {
      reconciled[c.field] = reconcileNumber(c.field, [
        ...obsFrom("rtings", a?.specs[c.rtings]),
        ...obsFrom("runrepeat", b?.specs[c.runrepeat]),
      ]);
    }

    const single: MergedModel["single"] = {};
    for (const f of RUNREPEAT_ONLY) {
      const spec = b?.specs[f];
      if (spec && spec.value !== null) single[f] = { ...spec, source: "runrepeat" };
    }
    // Заявленный производителем перепад: держим отдельно и помеченным.
    const declared = b?.specs.drop_declared_mm ?? a?.specs.drop_declared_mm;
    if (declared && declared.value !== null) {
      single.drop_declared_mm = { ...declared, source: b?.specs.drop_declared_mm ? "runrepeat" : "rtings" };
    }

    return {
      key,
      sources: [a ? "rtings" : null, b ? "runrepeat" : null].filter((x): x is string => x !== null),
      reconciled,
      single,
    };
  });

  return { models, matched };
}
