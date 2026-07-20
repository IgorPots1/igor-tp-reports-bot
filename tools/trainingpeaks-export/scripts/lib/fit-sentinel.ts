// FIT "field present but unset" markers. The FIT protocol encodes an absent
// value as the MAX of the field's base integer type (uint8 0xFF, uint16 0xFFFF,
// uint32 0xFFFFFFFF; signed types use 0x7F.. but none of the fields we read are
// signed). fit-file-parser@3 run with `force: true` (tp-fit-ingest-scan.ts:295)
// surfaces those raw markers SCALED by the FIT profile instead of nulling them,
// so a lap can arrive with total_timer_time = 4294967.295 s (0xFFFFFFFF ÷ 1000)
// or total_distance = 42949672.95 m (0xFFFFFFFF ÷ 100). Summing such a lap
// poisons every aggregate (overall pace, distance, aerobic_ef). We reject the
// markers at normalization so ALL consumers get clean data.
//
// Field-AWARE on purpose: a blanket "is this 2^n−1 at any scale" test would
// reject real values — uint8 255 ÷ 100 = 2.55 m/s is an ordinary running speed,
// 32767 ÷ 10000 = 3.2767 m/s is a real pace. So each field passes the invalid
// marker(s) at ITS OWN declared scale, and only the large unsigned markers
// (which never collide with a physical speed/distance/time) are used.

export const U8_INVALID = 255; // 0xFF
export const U16_INVALID = 65535; // 0xFFFF
export const U32_INVALID = 4294967295; // 0xFFFFFFFF

// Same markers at the profile scales our fields use (÷100 cm→m, ÷1000 mm→m / ms→s).
export const U32_TIME_S = U32_INVALID / 1000; // total_timer_time / total_elapsed_time (uint32, ×1000 ms)
export const U32_DIST_M = U32_INVALID / 100; // total_distance / record distance (uint32, ×100 cm)
export const U32_SPEED_MPS = U32_INVALID / 1000; // enhanced_*_speed (uint32, ×1000 mm/s)
export const U16_SPEED_MPS = U16_INVALID / 1000; // avg_speed / max_speed (uint16, ×1000 mm/s)

function nearMarker(value: number, marker: number): boolean {
  // Relative tolerance absorbs the parser's scale rounding (observed 42949672.1
  // vs the exact 42949672.95) without reaching any real value.
  return Math.abs(value - marker) <= Math.max(Math.abs(marker) * 1e-5, 1e-6);
}

/** null if `value` is (within tolerance) any of the FIT invalid markers passed
 *  at the field's scale; otherwise `value` unchanged. */
export function rejectFitSentinel(value: number | null, ...markers: number[]): number | null {
  if (value === null) return null;
  return markers.some((m) => nearMarker(value, m)) ? null : value;
}
