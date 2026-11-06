'use client';

import { useState } from 'react';
import { BodyMap, Field, LevelBadge, Notice } from '@/components/ui';
import { useErrorText, useI18n } from '@/lib/i18n';
import { rpc } from '@/lib/supabase/client';
import { regionName, viewFor } from '@/lib/body';
import { ageFrom, criteriaLevel, LEVELS, vitalFlag, VITAL_KEYS, type CriteriaResult, type Level, type Reason, type VitalKey } from '@/lib/triage';
import type { Department, StaffAppointment } from '@/lib/types';
import type { DictKey } from '@/lib/dict';

export const vitalShort = (t: (k: DictKey) => string, k: VitalKey) => t(`v_${k}` as DictKey).replace(/\s*\(.*\)$/, '');

export function useReasonText() {
  const { t } = useI18n();
  return (r: Reason) => {
    const p = { ...(r.params ?? {}) };
    if (r.code === 'worse_flag') p.flag = t(`rf_${p.flag}` as DictKey);
    if (r.code === 'vital') p.key = vitalShort(t, p.key as VitalKey);
    return t(`cr_${r.code}` as DictKey, p);
  };
}

export function criteriaFor(a: StaffAppointment, vitalsOverride?: StaffAppointment['vital_signs']): CriteriaResult {
  return criteriaLevel({
    age: ageFrom(a.patients.birth_date),
    screening: a.screenings,
    symptoms: a.symptom_reports,
    vitals: vitalsOverride ?? a.vital_signs,
    worsened: a.worsened_at ? { flags: a.worsened_flags ?? [] } : null,
  });
}

/** Everything a clinician needs about the patient's reported symptoms, read-only. */
export function PatientSummary({ a }: { a: StaffAppointment }) {
  const { t, lang } = useI18n();
  const p = a.patients, s = a.screenings, age = ageFrom(p.birth_date);
  const parts = a.symptom_reports.map((x) => x.body_part);
  return (
    <div className="body-layout body-layout-sm">
      <BodyMap compact gender={p.gender} view={viewFor(parts)} selected={parts} />
      <div className="stack" style={{ gap: 8, fontSize: '.92rem' }}>
        <div><b>{p.full_name}</b> <span className="muted small">{p.gender === 'F' ? t('female') : t('male')} {age ?? '–'} {t('years')} · {a.queue_no}</span></div>
        {a.symptom_reports.length ? (
          <ul className="rows">
            {a.symptom_reports.map((x, i) => (
              <li key={i}><span><b>{regionName(x.body_part, lang)}</b> · {x.description}</span><span className="num small">{x.severity}/10</span></li>
            ))}
          </ul>
        ) : <span className="muted">{t('n_no_parts')}</span>}
        {s && (
          <div className="small">
            {s.onset && <>{t('n_onset')}: {t(`onset_${s.onset}` as DictKey)} · </>}
            {s.trend && <>{t('n_trend')}: <b>{t(`trend_${s.trend}` as DictKey)}</b></>}
            {s.associated.length > 0 && <> · {t('n_assoc')}: {s.associated.map((x) => t(`assoc_${x}` as DictKey)).join(', ')}</>}
            {s.pregnant && <> · <b>{t('pregnant')}</b></>}
          </div>
        )}
        {s?.note && <div className="small muted">“{s.note}”</div>}
        <div className="small">{t('n_chronic')}: {p.chronic_diseases || '–'} · {t('n_allergy')}: <b style={{ color: p.drug_allergies && p.drug_allergies !== '-' ? 'var(--crit)' : undefined }}>{p.drug_allergies || '–'}</b></div>
        {a.vital_signs && (
          <div className="small">
            {VITAL_KEYS.filter((k) => a.vital_signs?.[k] != null).map((k) => {
              const fl = vitalFlag(k, a.vital_signs?.[k]);
              return <span key={k} style={{ color: fl ? `var(--${fl})` : undefined, marginRight: 10 }}>{vitalShort(t, k)} {a.vital_signs?.[k]}</span>;
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export function CriteriaBox({ c }: { c: CriteriaResult }) {
  const { t } = useI18n();
  const text = useReasonText();
  return (
    <div className="criteria">
      <div className="small"><b>{t('cr_title')}: {t('cr_level', { n: c.level })} · {t(`lv_${c.level}` as DictKey)}</b> <span className="muted">· {t('cr_note')}</span></div>
      {c.reasons.length ? <ul>{c.reasons.map((r, i) => <li key={i}>{text(r)} → {t('lv')} {r.level}</li>)}</ul>
        : <div className="small muted">{t('cr_none')}</div>}
    </div>
  );
}

/** Nurse decision: department + level. A level that differs from the criteria needs a reason. */
export function TriageCard({ a, stage, depts, presetLevel, onDone, onClose }: {
  a: StaffAppointment; stage: 'pre_visit' | 'vitals' | 'worsened'; depts: Department[];
  presetLevel?: Level | null; onDone: () => void; onClose: () => void;
}) {
  const { t, pick, fmtTime } = useI18n();
  const errText = useErrorText();
  const c = criteriaFor(a);
  const [dept, setDept] = useState<string | null>(a.department_id);
  const [level, setLevel] = useState<Level | null>(presetLevel ?? (stage === 'pre_visit' && !a.triage_level ? null : a.triage_level));
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const differs = level != null && level !== c.level;

  async function save() {
    if (!level) return setErr(t('err_LEVEL_REQUIRED'));
    if (level > 2 && !dept) return setErr(t('err_DEPARTMENT_REQUIRED'));
    if (differs && !reason.trim()) return setErr(t('err_REASON_REQUIRED'));
    setBusy(true); setErr('');
    try {
      await rpc('save_triage', {
        p_id: a.id, p_stage: stage, p_department: dept, p_level: level,
        p_criteria_level: c.level, p_criteria_reasons: c.reasons, p_override_reason: differs ? reason : null,
      });
      onDone();
    } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  }

  return (
    <div className={`tcard level-${level ?? c.level}`}>
      <div className="actions" style={{ justifyContent: 'space-between' }}>
        <span className="small muted">{fmtTime(a.slot_start)} · {a.queue_no}</span>
        {a.triage_level && <span className="small">{t('n_current')} <LevelBadge level={a.triage_level} /></span>}
      </div>
      {a.worsened_at && (
        <Notice tone="crit" title={t('n_worse')}>
          {(a.worsened_flags ?? []).length ? (a.worsened_flags ?? []).map((f) => t(`rf_${f}` as DictKey)).join(' · ') : t('cr_worse_report')}
        </Notice>
      )}
      <PatientSummary a={a} />
      <CriteriaBox c={c} />
      <Field label={t('n_dept')}>
        <div className="toggles">
          {depts.map((d) => (
            <button key={d.id} type="button" className="toggle" aria-pressed={dept === d.id} onClick={() => setDept(d.id)}>{pick(d.name_th, d.name_en)}</button>
          ))}
        </div>
      </Field>
      <Field label={t('n_level')}>
        <div className="lvpick" role="radiogroup">
          {LEVELS.map((l) => (
            <button key={l} type="button" role="radio" aria-checked={level === l} style={{ ['--lvc' as string]: `var(--lv${l})` }} onClick={() => setLevel(l)}>
              <b>{l} · {t(`lv_${l}` as DictKey)}</b>{t(`lv_act_${l}` as DictKey)}
              {c.level === l && <span className="crit-mark">{t('cr_title')}</span>}
            </button>
          ))}
        </div>
      </Field>
      {differs && (
        <Field label={<span style={{ color: 'var(--warn)' }}>{t('n_reason')}</span>}>
          <textarea id={`reason-${a.id}`} className="textarea" rows={2} placeholder={t('n_reason_ph')} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      )}
      {err && <div className="err">{err}</div>}
      <div className="actions">
        <button className="btn btn-primary" disabled={busy} onClick={save}>{level && level <= 2 ? t('n_save_refer') : t('n_save')}</button>
        <button className="btn" onClick={onClose}>{t('close')}</button>
        <span className="muted small">{t('n_recorded_by')}</span>
      </div>
    </div>
  );
}
