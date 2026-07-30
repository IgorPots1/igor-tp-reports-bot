// Privacy part (б): personal/medical topics that must never reach a GROUP-bound draft — a linked group
// topic can hold 70+ people, so an operation / illness / injury / mental-health detail there is a breach
// even when the STUDENT wrote it themselves. Two uses: strip such messages from a group-bound packet
// before factor extraction, and a factcheck insurance gate on the finished group draft.
//
// Deliberately narrow to clearly-sensitive stems (medical/health/personal), NOT ordinary training talk:
// «устал», «тяжело», «ноги забиты» are normal reports and stay. Cyrillic-safe boundaries (JS \b is
// ASCII-only). «бол…» is pinned to pain forms (болит/болел/больно/болевой/побаливает) so it doesn't
// fire on «больше/более/болтать». Scoped to group drafts only — DM drafts keep the full private context.
const SENSITIVE_RE =
  /операц|диагноз|онколог|опухол|биопси|химиотерап|госпитал|больниц|инсульт|инфаркт|(?<![а-яё])болезн|заболел|хроническ|выгоран|депресс|тревожн|панич|психотерап|психолог|антидепресс|обследован|беремен|выкидыш|месячн|(?<![а-яё])врач|травм|перелом|растяжен|ушиб|(?<![а-яё])бол(?:ит|ел|ьно|евой|ям|ями|ями|ел[аи])|побаливает/iu;

export function isSensitiveTopic(text: string | null | undefined): boolean {
  return SENSITIVE_RE.test((text ?? "").toLowerCase());
}
