import { describe, expect, it } from 'vitest';
import { ageFrom, criteriaLevel, vitalFlag, vitalLevel } from './triage';

const base = { age: 40, screening: { onset: 'd2_7', trend: 'same', associated: [], pregnant: false }, symptoms: [] };

describe('criteriaLevel', () => {
  it('defaults to level 5 when no criteria are met', () => {
    expect(criteriaLevel(base)).toEqual({ level: 5, reasons: [] });
  });

  it('marks severe pain as level 3', () => {
    const r = criteriaLevel({ ...base, symptoms: [{ body_part: 'abdomen', severity: 8 }] });
    expect(r.level).toBe(3);
    expect(r.reasons[0].code).toBe('pain_severe');
  });

  it('raises an elderly patient with moderate pain who says it is "not much"', () => {
    const r = criteriaLevel({ ...base, age: 78, symptoms: [{ body_part: 'abdomen', severity: 6 }] });
    expect(r.level).toBe(3);
    expect(r.reasons.map((x) => x.code)).toContain('elderly_pain');
  });

  it('does not raise a worried patient with mild itching', () => {
    const r = criteriaLevel({ ...base, age: 24, symptoms: [{ body_part: 'arm_a', severity: 2 }] });
    expect(r.level).toBe(5);
  });

  it('lets abnormal vitals override a calm screening', () => {
    const r = criteriaLevel({ ...base, vitals: { bp_sys: 185, spo2: 98 } });
    expect(r.level).toBe(2);
    expect(r.reasons[0]).toMatchObject({ code: 'vital', params: { key: 'bp_sys', value: 185 } });
  });

  it('treats an emergency sign reported while waiting as level 2', () => {
    const r = criteriaLevel({ ...base, worsened: { flags: ['breath'] } });
    expect(r.level).toBe(2);
  });

  it('lists every reason, most urgent first', () => {
    const r = criteriaLevel({
      ...base, age: 70,
      screening: { onset: 'sudden', trend: 'worse', associated: ['dizzy'], pregnant: false },
      symptoms: [{ body_part: 'head', severity: 7 }], vitals: { temperature: 38.4 },
    });
    expect(r.level).toBe(3);
    expect(r.reasons.map((x) => x.level)).toEqual([...r.reasons.map((x) => x.level)].sort());
    expect(r.reasons.length).toBe(5);
  });
});

describe('vitals', () => {
  it('flags low oxygen as critical', () => {
    expect(vitalLevel('spo2', 90)).toBe(2);
    expect(vitalFlag('spo2', 90)).toBe('crit');
  });
  it('ignores empty values', () => {
    expect(vitalLevel('pulse', null)).toBe(0);
  });
});

describe('ageFrom', () => {
  it('counts birthdays correctly', () => {
    expect(ageFrom('1958-03-14', new Date('2026-03-13'))).toBe(67);
    expect(ageFrom('1958-03-14', new Date('2026-03-14'))).toBe(68);
  });
});
