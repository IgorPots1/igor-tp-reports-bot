/**
 * Трек с nakarte.me по id: https://tracks.nakarte.me/track/<id> отдаёт строку формата nktk
 * (разбор по исходникам nakarte: src/lib/leaflet.control.track-list/lib/parsers/nktk.js и nktk.proto).
 *
 *   npx tsx scripts/race-course/nakarte.ts <id> <out.gpx>
 *
 * Формат: base64url; первый символ — версия (charCode − 64), поддерживаем 4 (protobuf TrackView:
 * track.segments[].lats/lons — упакованные sint32, приращения в единицах 360/(2^24−1) градуса).
 * Несколько фрагментов разделены «/». Высот в nktk нет: рельеф берём из DEM.
 * Сеть только на чтение (robots.txt у tracks.nakarte.me нет, данные отдаются открыто).
 */

import { writeFileSync } from "node:fs";

import type { LatLon } from "./geo";
import { politeFetch } from "../lib/polite-fetch";

const ARC_UNIT = ((1 << 24) - 1) / 360;

/** Минимальный читатель protobuf: поля сообщения в [start, end) с явными смещениями. */
type Field = { f: number; w: number; v: number; s: number; e: number };

function varint(b: Uint8Array, pos: number): [number, number] {
  let r = 0, mul = 1, x: number;
  do {
    x = b[pos++];
    r += (x & 0x7f) * mul;
    mul *= 128;
  } while (x & 0x80 && pos < b.length);
  return [r, pos];
}

function fields(b: Uint8Array, start: number, end: number): Field[] {
  const out: Field[] = [];
  let pos = start;
  while (pos < end) {
    const [tag, p1] = varint(b, pos);
    const f = Math.floor(tag / 8), w = tag & 7;
    if (w === 0) { const [v, p2] = varint(b, p1); out.push({ f, w, v, s: p1, e: p2 }); pos = p2; }
    else if (w === 2) { const [len, p2] = varint(b, p1); out.push({ f, w, v: len, s: p2, e: p2 + len }); pos = p2 + len; }
    else if (w === 1) { out.push({ f, w, v: 0, s: p1, e: p1 + 8 }); pos = p1 + 8; }
    else if (w === 5) { out.push({ f, w, v: 0, s: p1, e: p1 + 4 }); pos = p1 + 4; }
    else throw new Error(`nktk: неизвестный wire type ${w} на ${pos}`);
  }
  return out;
}

const zigzag = (n: number) => (n % 2 === 1 ? -(n + 1) / 2 : n / 2);

/** sint32: упакованный (wire 2) или одиночный (wire 0). */
function sints(b: Uint8Array, fl: Field): number[] {
  if (fl.w === 0) return [zigzag(fl.v)];
  const out: number[] = [];
  let pos = fl.s;
  while (pos < fl.e) { const [v, p] = varint(b, pos); out.push(zigzag(v)); pos = p; }
  return out;
}

export type NakarteTrack = { name: string; segments: LatLon[][] };

function readSegment(b: Uint8Array, start: number, end: number): LatLon[] {
  const lats: number[] = [], lons: number[] = [];
  for (const fl of fields(b, start, end)) {
    if (fl.f === 1) lats.push(...sints(b, fl));
    else if (fl.f === 2) lons.push(...sints(b, fl));
  }
  let la = 0, lo = 0;
  return lats.map((d, i) => {
    la += d;
    lo += lons[i];
    return [la / ARC_UNIT, lo / ARC_UNIT] as LatLon;
  });
}

function readTrack(b: Uint8Array, start: number, end: number): NakarteTrack {
  const out: NakarteTrack = { name: "", segments: [] };
  for (const fl of fields(b, start, end)) {
    if (fl.f === 1 && fl.w === 2) out.name = new TextDecoder().decode(b.subarray(fl.s, fl.e));
    else if (fl.f === 2 && fl.w === 2) out.segments.push(readSegment(b, fl.s, fl.e));
  }
  return out;
}

/** Разбор строки nktk (один или несколько фрагментов через «/»). */
export function parseNktk(text: string): NakarteTrack[] {
  return text.trim().split("/").filter(Boolean).map((frag) => {
    const bin = Buffer.from(frag.replace(/-/g, "+").replace(/_/g, "/"), "base64");
    const version = bin[0] - 64;
    if (version !== 4) throw new Error(`nktk: версия ${version} не поддерживается (только 4)`);
    const b = new Uint8Array(bin.subarray(1));
    const t = fields(b, 0, b.length).find((fl) => fl.f === 2 && fl.w === 2);
    return t ? readTrack(b, t.s, t.e) : { name: "", segments: [] };
  });
}

export async function fetchNakarte(id: string): Promise<NakarteTrack[]> {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error(`nakarte: странный id ${id}`);
  const res = await politeFetch(`https://tracks.nakarte.me/track/${id}`, { headers: { "User-Agent": "igorp.run race-course (+https://igorp.run)" } });
  if (!res.ok) throw new Error(`nakarte ${id}: HTTP ${res.status}`);
  return parseNktk(await res.text());
}

async function main() {
  const [id, out] = process.argv.slice(2);
  if (!id || !out) throw new Error("nakarte.ts <id> <out.gpx>");
  const tracks = await fetchNakarte(id);
  const segs = tracks.flatMap((t) => t.segments);
  const name = tracks.map((t) => t.name).filter(Boolean).join(" / ");
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const body = segs.map((s) => `<trkseg>\n${s.map(([la, lo]) => `<trkpt lat="${la.toFixed(6)}" lon="${lo.toFixed(6)}"/>`).join("\n")}\n</trkseg>`).join("\n");
  writeFileSync(out, `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="igorp.run nakarte" xmlns="http://www.topografix.com/GPX/1/1">\n<trk><name>${esc(name)}</name>\n${body}\n</trk>\n</gpx>\n`);
  console.log(`${id}: «${name}», сегментов ${segs.length}, точек ${segs.reduce((n, s) => n + s.length, 0)} → ${out}`);
}

if (process.argv[1]?.endsWith("nakarte.ts")) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
