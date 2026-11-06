/**
 * Triage criteria (เกณฑ์คัดกรอง).
 *
 * A transparent, rule-based checklist that shows the nurse which criteria a patient meets and the
 * level those criteria point to. The nurse always makes the final decision; choosing a different
 * level requires a written reason (enforced again in the database by save_triage).
 *
 * The thresholds below are EXAMPLES for the prototype. Before real use they must be set by the
 * hospital's nursing and medical team, following the triage guideline the hospital uses.
 */

export type Level = 1 | 2 | 3 | 4 | 5;
export const LEVELS: Level[] = [1, 2, 3, 4, 5];

export const RED_FLAGS = ['chest', 'breath', 'stroke', 'seizure', 'bleed', 'headache', 'anaphylaxis'] as const;
export const ONSETS = ['sudden', 'today', 'd2_7', 'w1_4', 'm1'] as const;
export const TRENDS = ['better', 'same', 'worse'] as const;
export const ASSOCIATED = ['fever', 'vomit', 'dizzy', 'cough', 'tired', 'noeat'] as const;

export const VITAL_KEYS = ['weight', 'height', 'bp_sys', 'bp_dia', 'pulse', 'temperature', 'spo2', 'blood_sugar'] as const;
export type VitalKey = (typeof VITAL_KEYS)[number];
export type Vitals = Partial<Record<VitalKey, number | null>>;

export interface ScreeningInput {
  onset?: string | null;
  trend?: string | null;
  associated?: string[] | null;
  pregnant?: boolean | null;
}
export interface SymptomInput {
  body_part: string;
  severity: number;
}
export interface Reason {
  level: Level;
  code: string;
  params?: Record<string, string | number>;
}
export interface CriteriaResult {
  level: Level;
  reasons: Reason[];
}

/** Level suggested by one vital sign, or 0 when it is within the example normal range. */
export function vitalLevel(key: VitalKey, value: number | null | undefined): 0 | 2 | 3 | 4 {
  if (value == null || Number.isNaN(value)) return 0;
  const v = Number(value);
  switch (key) {
    case 'bp_sys': return v >= 180 || v < 90 ? 2 : v >= 160 ? 3 : v >= 140 ? 4 : 0;
    case 'bp_dia': return v >= 120 ? 2 : v >= 100 ? 3 : v >= 90 ? 4 : 0;
    case 'pulse': return v > 130 || v < 45 ? 2 : v > 110 || v < 50 ? 3 : v > 100 ? 4 : 0;
    case 'temperature': return v >= 39.5 ? 3 : v >= 38 ? 4 : 0;
    case 'spo2': return v < 92 ? 2 : v < 95 ? 3 : 0;
    case 'blood_sugar': return v < 70 ? 2 : v >= 300 ? 3 : v > 180 ? 4 : 0;
    default: return 0;
  }
}

export function vitalFlag(key: VitalKey, value: number | null | undefined): '' | 'warn' | 'crit' {
  const l = vitalLevel(key, value);
  return l === 0 ? '' : l <= 2 ? 'crit' : 'warn';
}

export function criteriaLevel(input: {
  age: number | null;
  screening: ScreeningInput | null;
  symptoms: SymptomInput[];
  vitals?: Vitals | null;
  worsened?: { flags: string[] } | null;
}): CriteriaResult {
  const reasons: Reason[] = [];
  const add = (level: number, code: string, params?: Reason['params']) =>
    reasons.push({ level: Math.min(5, Math.max(1, level)) as Level, code, params });

  const s = input.screening ?? {};
  const assoc = s.associated ?? [];
  const maxPain = input.symptoms.length ? Math.max(...input.symptoms.map((x) => x.severity)) : 0;
  const age = input.age ?? 0;

  for (const f of input.worsened?.flags ?? []) add(2, 'worse_flag', { flag: f });
  if (input.worsened && !input.worsened.flags.length) add(3, 'worse_report');

  if (maxPain >= 8) add(3, 'pain_severe', { n: maxPain });
  else if (maxPain >= 5) add(4, 'pain_moderate', { n: maxPain });
  if (s.onset === 'sudden' && maxPain >= 5) add(3, 'sudden_pain');
  if (s.trend === 'worse') add(3, 'worsening');
  if (assoc.includes('dizzy') && age >= 65) add(3, 'elderly_dizzy', { age });
  if (assoc.includes('vomit') && assoc.includes('noeat')) add(3, 'vomit_noeat');
  if (assoc.includes('fever') && maxPain >= 5) add(4, 'fever_pain');
  if (s.pregnant && maxPain >= 5) add(3, 'pregnant_pain');
  if (age >= 75 && maxPain >= 5) add(3, 'elderly_pain', { age });

  const graded: VitalKey[] = ['bp_sys', 'bp_dia', 'pulse', 'temperature', 'spo2', 'blood_sugar'];
  for (const k of graded) {
    const v = input.vitals?.[k];
    const l = vitalLevel(k, v);
    if (l) add(l, 'vital', { key: k, value: Number(v) });
  }

  reasons.sort((a, b) => a.level - b.level);
  return { level: (reasons[0]?.level ?? 5) as Level, reasons };
}

export function ageFrom(birth: string | null | undefined, on = new Date()): number | null {
  if (!birth) return null;
  const b = new Date(birth);
  let age = on.getFullYear() - b.getFullYear();
  const m = on.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && on.getDate() < b.getDate())) age--;
  return age;
}
