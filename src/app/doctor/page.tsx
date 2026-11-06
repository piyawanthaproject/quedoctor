'use client';

import { useCallback, useEffect, useState } from 'react';
import { AppShell, Field, LevelBadge, Notice, Section, StatusTag, useProfile } from '@/components/ui';
import { PatientSummary, vitalShort } from '@/components/staff';
import { useErrorText, useI18n } from '@/lib/i18n';
import { rpc, sb } from '@/lib/supabase/client';
import { VITAL_KEYS, vitalFlag } from '@/lib/triage';
import { STAFF_SELECT, type Department, type StaffAppointment, type VitalSigns } from '@/lib/types';
import type { DictKey } from '@/lib/dict';

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date());
const byPriority = (x: StaffAppointment, y: StaffAppointment) =>
  (x.triage_level ?? 4) - (y.triage_level ?? 4) || x.slot_start.localeCompare(y.slot_start);

export default function DoctorPage() {
  const profile = useProfile();
  const { t, pick, fmtTime } = useI18n();
  const errText = useErrorText();
  const [appts, setAppts] = useState<StaffAppointment[]>([]);
  const [depts, setDepts] = useState<Department[]>([]);
  const [rates, setRates] = useState<Record<string, number>>({});
  const [names, setNames] = useState<Record<string, string>>({});
  const [sel, setSel] = useState<string | null>(null);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    const { data } = await sb().from('appointments').select(STAFF_SELECT).eq('visit_date', today()).order('slot_start');
    setAppts((data as unknown as StaffAppointment[]) ?? []);
  }, []);

  useEffect(() => {
    load();
    sb().from('departments').select('id, name_th, name_en').then(({ data }) => setDepts((data as Department[]) ?? []));
    sb().from('coverage_rates').select('coverage, claim_ratio').then(({ data }) => setRates(Object.fromEntries((data ?? []).map((r) => [r.coverage, Number(r.claim_ratio)]))));
    sb().from('profiles').select('id, full_name').then(({ data }) => setNames(Object.fromEntries((data ?? []).map((p) => [p.id, p.full_name]))));
    const ch = sb().channel('doctor').on('postgres_changes', { event: '*', schema: 'public', table: 'appointments' }, () => load()).subscribe();
    return () => { sb().removeChannel(ch); };
  }, [load]);

  const queue = appts.filter((a) => a.status === 'waiting_doctor' || a.status === 'in_exam').sort(byPriority);
  const current = appts.find((a) => a.id === sel && (a.status === 'in_exam' || a.status === 'waiting_doctor'));
  const deptName = (id: string | null) => { const d = depts.find((x) => x.id === id); return d ? pick(d.name_th, d.name_en) : '–'; };

  async function openPatient(a: StaffAppointment) {
    setErr('');
    try { if (a.status === 'waiting_doctor') await rpc('start_exam', { p_id: a.id }); setSel(a.id); await load(); }
    catch (e) { setErr(errText(e)); }
  }

  return (
    <AppShell role="doctor" name={profile?.full_name}>
      {err && <Notice tone="crit">{err}</Notice>}
      <div className="cols cols-narrow-left">
        <Section title={t('d_queue')} aside={t('d_queue_hint')}>
          {queue.length ? (
            <ul className="rows">
              {queue.map((a) => (
                <li key={a.id} className={a.id === sel ? 'is-current' : ''}>
                  <span><b className="num">{a.queue_no}</b> {a.patients.full_name}<br />
                    <span className="actions small"><LevelBadge level={a.triage_level} /><span className="muted">{deptName(a.department_id)} · {fmtTime(a.slot_start)}</span></span></span>
                  <button className={`btn btn-sm ${a.id === sel ? '' : 'btn-primary'}`} onClick={() => openPatient(a)}>{a.status === 'in_exam' ? t('d_open') : t('d_call')}</button>
                </li>
              ))}
            </ul>
          ) : <p className="muted" style={{ margin: 0 }}>{t('d_empty')}</p>}
          <div className="small muted">{t('d_seen_today', { n: appts.filter((a) => a.status === 'done').length })}</div>
        </Section>
        {current ? <Exam key={current.id} a={current} rates={rates} names={names} deptName={deptName(current.department_id)} onDone={() => { setSel(null); load(); }} />
          : <Section><p className="muted" style={{ margin: 0 }}>{t('d_select')}</p></Section>}
      </div>
    </AppShell>
  );
}

function Exam({ a, rates, names, deptName, onDone }: { a: StaffAppointment; rates: Record<string, number>; names: Record<string, string>; deptName: string; onDone: () => void }) {
  const { t, fmtMoney } = useI18n();
  const errText = useErrorText();
  const [prev, setPrev] = useState<VitalSigns | null>(null);
  const [dx, setDx] = useState('');
  const [icd, setIcd] = useState('');
  const [tx, setTx] = useState('');
  const [money, setMoney] = useState({ consult: '200', medicine: '', procedure: '' });
  const [err, setErr] = useState('');

  useEffect(() => {
    sb().from('appointments').select('visit_date, vital_signs(*)').eq('patient_id', a.patient_id).neq('id', a.id)
      .order('visit_date', { ascending: false }).limit(5)
      .then(({ data }) => {
        const row = (data as unknown as { vital_signs: VitalSigns | null }[] | null)?.find((r) => r.vital_signs);
        setPrev(row?.vital_signs ?? null);
      });
  }, [a.id, a.patient_id]);

  const n = (s: string) => Number(s) || 0;
  const total = n(money.consult) + n(money.medicine) + n(money.procedure);
  const claim = Math.round(total * (rates[a.patients.coverage] ?? 0) * 100) / 100;
  const v = a.vital_signs;

  async function finish() {
    if (!dx.trim()) return setErr(t('err_DIAGNOSIS_REQUIRED'));
    try {
      await rpc('finish_visit', { p_id: a.id, p_diagnosis: dx, p_icd10: icd, p_treatment: tx, p_consult: n(money.consult), p_medicine: n(money.medicine), p_procedure: n(money.procedure) });
      onDone();
    } catch (e) { setErr(errText(e)); }
  }

  return (
    <Section title={<>{a.patients.full_name} <span className="num" style={{ color: 'var(--c1)' }}>{a.queue_no}</span></>}
      aside={<span className="actions"><LevelBadge level={a.triage_level} /><StatusTag status={a.status} /></span>}>
      <div className="small muted">{deptName} · {t(`cov_${a.patients.coverage}` as DictKey)}</div>
      <PatientSummary a={a} />

      <div>
        <div className="sub">{t('d_vitals')}</div>
        {v ? (
          <div className="vit-grid">
            {VITAL_KEYS.filter((k) => v[k] != null).map((k) => {
              const fl = vitalFlag(k, v[k]), p = prev?.[k];
              return (
                <div key={k} className={`vcard ${fl}`}>
                  <div className="p">{vitalShort(t, k)}</div><div className="v">{v[k]}</div>
                  {p != null && <div className="p">{t('v_previous', { v: p })}{Number(v[k]) > p ? ' ↑' : Number(v[k]) < p ? ' ↓' : ''}</div>}
                </div>
              );
            })}
          </div>
        ) : <span className="muted small">–</span>}
      </div>

      <div>
        <div className="sub">{t('d_triage_history')}</div>
        <ul className="rows">
          {[...a.triage_reviews].sort((x, y) => x.created_at.localeCompare(y.created_at)).map((r) => (
            <li key={r.id} className="small">
              <span>
                <span className="num">{new Date(r.created_at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' })}</span>{' '}
                {r.nurse_id ? names[r.nurse_id] : ''} · {r.from_level ? `${r.from_level} → ` : ''}<b>{t('lv')} {r.final_level}</b>
                {r.override_reason && <> · {r.override_reason}</>}
              </span>
              <span className="muted">{t('cr_level', { n: r.criteria_level })}</span>
            </li>
          ))}
        </ul>
      </div>

      <Field label={t('d_diagnosis')}>
        <textarea id="dx" className="textarea" rows={2} placeholder={t('d_diagnosis_ph')} value={dx} onChange={(e) => setDx(e.target.value)} />
      </Field>
      <div className="grid-fields">
        <Field label={t('d_icd')}><input id="icd" className="input" value={icd} onChange={(e) => setIcd(e.target.value.toUpperCase())} placeholder="K29.7" /></Field>
      </div>
      <Field label={t('d_treatment')}>
        <textarea id="tx" className="textarea" rows={3} placeholder={t('d_treatment_ph')} value={tx} onChange={(e) => setTx(e.target.value)} />
      </Field>
      <div className="grid-fields">
        {(['consult', 'medicine', 'procedure'] as const).map((k) => (
          <Field key={k} label={t(`d_${k}` as DictKey)}>
            <input id={`m-${k}`} className="input num" inputMode="numeric" value={money[k]} onChange={(e) => setMoney({ ...money, [k]: e.target.value.replace(/[^\d.]/g, '') })} />
          </Field>
        ))}
      </div>
      <div className="actions small">
        <span>{t('d_total')} <b className="num">{fmtMoney(total)}</b></span>
        <span>{t('d_claim', { cov: t(`cov_${a.patients.coverage}` as DictKey) })} <b className="num">{fmtMoney(claim)}</b></span>
        <span>{t('d_patient_pays')} <b className="num">{fmtMoney(total - claim)}</b></span>
      </div>
      {err && <div className="err">{err}</div>}
      <div className="actions"><button className="btn btn-primary" onClick={finish}>{t('d_finish')}</button></div>
    </Section>
  );
}
