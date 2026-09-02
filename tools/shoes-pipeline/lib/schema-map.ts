/**
 * Карта «поле схемы → чем его можно закрыть».
 *
 * Смысл файла — ответить на вопрос, который решает судьбу всего этапа: хватает
 * ли РАЗРЕШЁННЫХ источников, чтобы запись прошла валидацию. Ответ считается по
 * фактически собранным страницам, а не по обещаниям в наряде.
 */

export type FieldSpec = {
  field: string;
  /** Обязательное — без него запись отбраковывается валидатором приложения. */
  required: boolean;
  /** Кто в принципе может дать это поле. */
  sources: string[];
  /** Как получается, если не берётся напрямую. */
  derived?: string;
  note?: string;
};

export const SCHEMA_FIELDS: FieldSpec[] = [
  { field: "id", required: true, sources: ["производное"], derived: "бренд + модель" },
  { field: "brand", required: true, sources: ["rtings", "бренды", "магазины"] },
  { field: "model", required: true, sources: ["rtings", "бренды", "магазины"] },
  { field: "year", required: true, sources: ["бренды", "магазины"], note: "RTINGS год модели не публикует; дата обзора — не год модели" },
  { field: "categories", required: true, sources: ["обзоры", "бренды"], note: "у RTINGS своя таксономия usages, в наши категории один в один не ложится" },
  { field: "surface", required: true, sources: ["rtings", "бренды"] },
  { field: "weight_g", required: true, sources: ["rtings"], note: "RTINGS меряет сам — лучше заявленного" },
  { field: "stack_heel_mm", required: true, sources: ["rtings"] },
  { field: "stack_fore_mm", required: true, sources: ["производное"], derived: "stack_heel_mm − drop_mm" },
  { field: "drop_mm", required: true, sources: ["rtings"] },
  { field: "midsole_durometer_ha", required: true, sources: ["runrepeat"], note: "ТОЛЬКО Shore HA. У RTINGS прогиб под 550 Н — другой прибор, другая шкала" },
  { field: "softness", required: true, sources: ["производное"], derived: "softnessFromHa(midsole_durometer_ha)" },
  { field: "foam_type", required: true, sources: ["бренды", "обзоры"] },
  { field: "plate", required: true, sources: ["rtings", "бренды"] },
  { field: "stability", required: true, sources: ["бренды", "обзоры"] },
  { field: "last_width", required: true, sources: ["rtings", "бренды"] },
  { field: "platform_width_heel_mm", required: true, sources: ["rtings"] },
  { field: "platform_width_fore_mm", required: true, sources: ["rtings"] },
  { field: "outsole_durability", required: true, sources: ["runrepeat"], note: "абразивный тест — больше нигде не публикуется" },
  { field: "outsole_thickness_mm", required: true, sources: ["runrepeat"] },
  { field: "membrane", required: true, sources: ["бренды", "магазины"] },
  { field: "winter_grip", required: true, sources: ["обзоры"], note: "шкала 1–10 сводится из формулировок, как и мягкость" },
  { field: "lug_depth_mm", required: true, sources: ["бренды", "обзоры"] },
  { field: "heel_counter_stiffness", required: false, sources: ["runrepeat"] },
  { field: "variant_of", required: true, sources: ["производное"], derived: "привязка GTX-версии к базовой модели" },
  { field: "price", required: true, sources: ["магазины", "бренды"] },
  { field: "available", required: true, sources: ["магазины"] },
  { field: "tier", required: true, sources: ["производное"], derived: "пороги по распределению собранных цен" },
  { field: "genders", required: true, sources: ["магазины", "бренды"] },
  { field: "image", required: false, sources: ["runrepeat", "магазины"], note: "решение дополнения №2: фотографий нет нигде" },
  { field: "sources", required: true, sources: ["производное"], derived: "происхождение каждого поля" },
];
