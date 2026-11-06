'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { AppShell, BodyMap, Choice, Field, Notice, Section, SeverityScale, StatusTag, Toggles, useProfile } from '@/components/ui';
import { useErrorText, useI18n } from '@/lib/i18n';
import { rpc, sb } from '@/lib/supabase/client';
import { regionName, type View } from '@/lib/body';
import { ASSOCIATED, ONSETS, RED_FLAGS, TRENDS } from '@/lib/triage';
import { COVERAGES, type Department, type MyAppointment, type Patient } from '@/lib/types';
import type { DictKey } from '@/lib/dict';

const bangkokDate = (offsetDays = 0) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date(Date.now() + offsetDays * 864e5));
const OPEN = ['booked', 'skipped', 'checked_in', 'in_vitals', 'waiting_doctor', 'in_exam', 'referred'];

interface Slot { slot: string; booked: number; capacity: number; checkin_deadline: string; open: boolean }
type PartInput = { description: string; severity: number };

export default function PatientPage() {
  const profile = useProfile();
  const { t, pick, fmtTime, fmtDate } = useI18n();
  const [patient, setPatient] = useState<Patient | null | undefined>(undefined);
  const [editing, setEditing] = useState(false);
  const [appts, setAppts] = useState<MyAppointment[]>([]);
  const [depts, setDepts] = useState<Department[]>([]);
  const [checkinBefore, setCheckinBefore] = useState(30);
  const [isDemo, setIsDemo] = useState(false);
  const [demoMsg, setDemoMsg] = useState('');

  const load = useCallback(async () => {
    const { data: { user } } = await sb().auth.getUser();
    if (!user) return;
    setIsDemo(!!user.email?.endsWith('@khiumor.demo'));
    const [{ data: p }, { data: d }, { data: s }] = await Promise.all([
      sb().from('patients').select('*').eq('user_id', user.id).maybeSingle(),
      sb().from('departments').select('id, name_th, name_en'),
      sb().from('clinic_settings').select('checkin_before_minutes').single(),
    ]);
    setPatient((p as Patient) ?? null);
    setDepts((d as Department[]) ?? []);
    if (s) setCheckinBefore(s.checkin_before_minutes);
    if (p) setAppts(await rpc<MyAppointment[]>('get_my_appointments'));
  }, []);

  useEffect(() => { load(); }, [load]);
  // the queue moves while the patient waits
  useEffect(() => { const id = setInterval(() => { if (patient) rpc<MyAppointment[]>('get_my_appointments').then(setAppts).catch(() => {}); }, 15000); return () => clearInterval(id); }, [patient]);

  const active = appts.find((a) => OPEN.includes(a.status) && a.visit_date >= bangkokDate());
  const deptName = (id: string | null) => { const d = depts.find((x) => x.id === id); return d ? pick(d.name_th, d.name_en) : null; };

  let body: React.ReactNode = <p className="muted">{t('loading')}</p>;
  if (patient === null || editing) body = <ProfileForm patient={patient ?? null} fallbackName={profile?.full_name ?? ''} onSaved={(p) => { setPatient(p); setEditing(false); load(); }} />;
  else if (patient && active) body = <Ticket a={active} patient={patient} deptName={deptName(active.department_id)} onChange={load} />;
  else if (patient) body = <Booking patient={patient} checkinBefore={checkinBefore} onBooked={load} />;

  return (
    <AppShell role="patient" name={profile?.full_name}>
      <div className="cols">
        <div className="stack">{body}</div>
        <div className="stack">
          {isDemo && patient && (
            <Notice tone="info" title={t('demo_title')}>
              <p style={{ margin: '0 0 8px' }}>{t('demo_body')}</p>
              <div className="actions">
                <button className="btn btn-primary" onClick={async () => {
                  try { await rpc('demo_reset_my_appointments'); setDemoMsg(t('demo_done')); setEditing(false); await load(); }
                  catch (e) { setDemoMsg(String((e as Error).message)); }
                }}>{t('demo_reset')}</button>
                {demoMsg && <span className="small">{demoMsg}</span>}
              </div>
            </Notice>
          )}
          <Section title={t('guide_title')}>
            <ol style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <li>{t('guide_1', { n: checkinBefore })}</li><li>{t('guide_2')}</li><li>{t('guide_3')}</li><li>{t('guide_4')}</li><li>{t('guide_5')}</li>
            </ol>
            <Notice tone="crit" title={t('emergency_line')} />
          </Section>
          {patient && !editing && (
            <Section title={t('profile_title')} aside={<button className="btn btn-sm" onClick={() => setEditing(true)}>{t('profile_edit')}</button>}>
              <dl className="kv">
                <dt>{t('f_full_name')}</dt><dd>{patient.full_name}</dd>
                <dt>{t('f_coverage')}</dt><dd>{t(`cov_${patient.coverage}` as DictKey)}</dd>
                <dt>{t('f_chronic')}</dt><dd>{patient.chronic_diseases || '–'}</dd>
                <dt>{t('f_allergy')}</dt><dd>{patient.drug_allergies || '–'}</dd>
              </dl>
            </Section>
          )}
          {appts.filter((a) => a !== active).slice(0, 5).length > 0 && (
            <Section title={t('p_past')}>
              <ul className="rows">
                {appts.filter((a) => a !== active).slice(0, 5).map((a) => (
                  <li key={a.id}><span className="num">{fmtDate(a.visit_date)} · {fmtTime(a.slot_start)}</span><span>{deptName(a.department_id) ?? '–'} <StatusTag status={a.status} /></span></li>
                ))}
              </ul>
            </Section>
          )}
        </div>
      </div>
    </AppShell>
  );
}

/* ───────── profile ───────── */
function ProfileForm({ patient, fallbackName, onSaved }: { patient: Patient | null; fallbackName: string; onSaved: (p: Patient) => void }) {
  const { t } = useI18n();
  const errText = useErrorText();
  const [f, setF] = useState({
    full_name: patient?.full_name ?? fallbackName, gender: patient?.gender ?? 'F', birth_date: patient?.birth_date ?? '',
    phone: patient?.phone ?? '', coverage: patient?.coverage ?? 'gold', chronic_diseases: patient?.chronic_diseases ?? '',
    regular_meds: patient?.regular_meds ?? '', drug_allergies: patient?.drug_allergies ?? '', emergency_contact: patient?.emergency_contact ?? '',
  });
  const [err, setErr] = useState('');
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const { data: { user } } = await sb().auth.getUser();
    if (!user) return;
    const row = { ...f, birth_date: f.birth_date || null, user_id: user.id };
    const q = patient ? sb().from('patients').update(row).eq('id', patient.id) : sb().from('patients').insert(row);
    const { data, error } = await q.select('*').single();
    if (error) setErr(errText(error)); else onSaved(data as Patient);
  }

  return (
    <Section title={t('profile_title')} aside={t('profile_hint')}>
      <form className="stack" style={{ gap: 14 }} onSubmit={save}>
        <div className="grid-fields">
          <Field label={t('f_full_name')}><input id="pf-name" className="input" required value={f.full_name} onChange={set('full_name')} /></Field>
          <Field label={t('f_gender')}><Choice value={f.gender} onChange={(g) => setF({ ...f, gender: g })} options={[{ value: 'F', label: t('female') }, { value: 'M', label: t('male') }]} /></Field>
          <Field label={t('f_birth')}><input id="pf-birth" className="input" type="date" required value={f.birth_date} onChange={set('birth_date')} /></Field>
          <Field label={t('f_phone')}><input id="pf-phone" className="input" type="tel" required value={f.phone} onChange={set('phone')} /></Field>
          <Field label={t('f_contact')}><input id="pf-contact" className="input" value={f.emergency_contact} onChange={set('emergency_contact')} /></Field>
        </div>
        <Field label={t('f_coverage')}>
          <Choice wide value={f.coverage} onChange={(c) => setF({ ...f, coverage: c })} options={COVERAGES.map((c) => ({ value: c, label: t(`cov_${c}` as DictKey) }))} />
        </Field>
        <div className="grid-fields">
          <Field label={t('f_chronic')}><textarea id="pf-chronic" className="textarea" rows={2} value={f.chronic_diseases} onChange={set('chronic_diseases')} /></Field>
          <Field label={t('f_meds')}><textarea id="pf-meds" className="textarea" rows={2} value={f.regular_meds} onChange={set('regular_meds')} /></Field>
          <Field label={t('f_allergy')}><textarea id="pf-allergy" className="textarea" rows={2} value={f.drug_allergies} onChange={set('drug_allergies')} /></Field>
        </div>
        {err && <div className="err">{err}</div>}
        <div className="actions"><button className="btn btn-primary">{t('profile_save')}</button></div>
      </form>
    </Section>
  );
}

/* ───────── booking ───────── */
function Booking({ patient, checkinBefore, onBooked }: { patient: Patient; checkinBefore: number; onBooked: () => void }) {
  const { t, lang, fmtTime } = useI18n();
  const errText = useErrorText();
  const [step, setStep] = useState<1 | 2>(1);
  const [view, setView] = useState<View>('front');
  const [parts, setParts] = useState<Record<string, PartInput>>({});
  const [activePart, setActivePart] = useState<string | null>(null);
  const [redFlags, setRedFlags] = useState<string[]>([]);
  const [rfSent, setRfSent] = useState(false);
  const [onset, setOnset] = useState<string>('d2_7');
  const [trend, setTrend] = useState<string>('same');
  const [assoc, setAssoc] = useState<string[]>([]);
  const [pregnant, setPregnant] = useState(false);
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const [day, setDay] = useState<0 | 1>(0);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [slot, setSlot] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (step !== 2) return;
    rpc<Slot[]>('slot_availability', { p_date: bangkokDate(day) }).then(setSlots).catch((e) => setErr(errText(e)));
    setSlot(null);
  }, [step, day]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectPart = (id: string) => {
    setActivePart(id);
    if (!parts[id]) setParts({ ...parts, [id]: { description: '', severity: 5 } });
  };
  const toSlots = () => {
    const list = Object.values(parts);
    if (!list.length && !note.trim()) return setErr(t('sym_need_one'));
    if (list.some((p) => !p.description.trim())) return setErr(t('sym_need_text'));
    setErr(''); setStep(2);
  };
  async function sendRedFlags() {
    try { await rpc('report_red_flags', { p_flags: redFlags }); setRfSent(true); } catch (e) { setErr(errText(e)); }
  }
  async function book() {
    if (!slot) return;
    setBusy(true); setErr('');
    try {
      await rpc('book_appointment', {
        p_date: bangkokDate(day), p_slot: slot,
        p_screening: { red_flags: [], onset, trend, associated: assoc, pregnant, note },
        p_symptoms: Object.entries(parts).map(([body_part, v]) => ({ body_part, description: v.description, severity: v.severity })),
      });
      onBooked();
    } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  }

  const cur = activePart ? parts[activePart] : null;
  const emergency = redFlags.length > 0;

  return (
    <>
      <div className="steps">
        <div className="step" aria-current={step === 1 ? 'step' : undefined}>1. {t('step_symptoms')}</div>
        <div className="step" aria-current={step === 2 ? 'step' : undefined}>2. {t('step_slot')}</div>
        <div className="step">3. {t('step_ticket')}</div>
      </div>

      {step === 1 && (
        <Section title={t('sym_title')} aside={t('sym_hint')}>
          <div>
            <div className="sub">{t('rf_title')}</div>
            <Toggles danger values={redFlags} onChange={setRedFlags} options={RED_FLAGS.map((f) => ({ value: f, label: t(`rf_${f}` as DictKey) }))} />
          </div>
          {emergency && (
            <Notice tone="crit" title={t('rf_alert_title')}>
              <p style={{ margin: '0 0 8px' }}>{t('rf_alert_body')}</p>
              {rfSent ? <b>{t('rf_sent')}</b> : <button className="btn btn-danger" onClick={sendRedFlags}>{t('rf_send')}</button>}
            </Notice>
          )}

          <div>
            <div className="sub">{t('body_title')}</div>
            <p className="muted small" style={{ margin: '-4px 0 10px' }}>{t('body_hint')}</p>
            <div className="body-layout">
              <div className="stack" style={{ gap: 10 }}>
                <Choice wide value={view} onChange={(v) => { setView(v); setActivePart(null); }} options={[{ value: 'front', label: t('front') }, { value: 'back', label: t('back_view') }]} />
                <BodyMap gender={patient.gender} view={view} selected={Object.keys(parts)} active={activePart} onSelect={selectPart} />
              </div>
              <div className="stack" style={{ gap: 12 }}>
                {activePart && cur ? (
                  <div className="criteria stack" style={{ gap: 10 }}>
                    <h3>{regionName(activePart, lang)}</h3>
                    <Field label={t('sym_describe')}>
                      <textarea id="sym-text" className="textarea" rows={3} autoFocus placeholder={t('sym_describe_ph')} value={cur.description}
                        onChange={(e) => setParts({ ...parts, [activePart]: { ...cur, description: e.target.value } })} />
                    </Field>
                    <Field label={t('sym_severity')}>
                      <SeverityScale value={cur.severity} onChange={(n) => setParts({ ...parts, [activePart]: { ...cur, severity: n } })} />
                    </Field>
                    <div><button className="btn btn-sm btn-danger" onClick={() => { const n = { ...parts }; delete n[activePart]; setParts(n); setActivePart(null); }}>{t('sym_remove')}</button></div>
                  </div>
                ) : <p className="muted small" style={{ margin: 0 }}>{t('body_none')}</p>}
                {Object.keys(parts).length > 0 && (
                  <ul className="rows">
                    {Object.entries(parts).map(([id, v]) => (
                      <li key={id} className={id === activePart ? 'is-current' : ''}>
                        <button className="btn btn-sm" onClick={() => setActivePart(id)}>{regionName(id, lang)}</button>
                        <span className="small" style={{ flex: 1, minWidth: 120 }}>{v.description || '…'}</span>
                        <span className="num small">{v.severity}/10</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>

          <Field label={t('onset_title')}><Choice wide value={onset} onChange={setOnset} options={ONSETS.map((o) => ({ value: o, label: t(`onset_${o}` as DictKey) }))} /></Field>
          <Field label={t('trend_title')}><Choice wide value={trend} onChange={setTrend} options={TRENDS.map((o) => ({ value: o, label: t(`trend_${o}` as DictKey) }))} /></Field>
          <div>
            <div className="sub">{t('assoc_title')}</div>
            <div className="actions">
              <Toggles values={assoc} onChange={setAssoc} options={ASSOCIATED.map((a) => ({ value: a, label: t(`assoc_${a}` as DictKey) }))} />
              {patient.gender === 'F' && <Toggles values={pregnant ? ['p'] : []} onChange={(v) => setPregnant(v.length > 0)} options={[{ value: 'p', label: t('pregnant') }]} />}
            </div>
          </div>
          <Field label={t('note_title')}><textarea id="note" className="textarea" rows={3} placeholder={t('note_ph')} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          {err && <div className="err">{err}</div>}
          <div className="actions"><button className="btn btn-primary" disabled={emergency} onClick={toSlots}>{t('next')}</button></div>
        </Section>
      )}

      {step === 2 && (
        <Section title={t('slot_title')}>
          <Notice tone="info" title={t('slot_dept_note_title')}>{t('slot_dept_note')}</Notice>
          <Choice value={day} onChange={setDay} options={[{ value: 0, label: t('slot_today') }, { value: 1, label: t('slot_tomorrow') }]} />
          <div className="slots" role="radiogroup">
            {slots.map((s) => {
              const full = s.booked >= s.capacity;
              return (
                <button key={s.slot} className="slot" role="radio" aria-checked={slot === s.slot} disabled={!s.open || full} onClick={() => setSlot(s.slot)}>
                  <b>{fmtTime(s.slot)}</b>
                  <span>{!s.open ? t('slot_passed') : full ? t('slot_full') : t('slot_checkin_by', { t: fmtTime(s.checkin_deadline) })}</span>
                </button>
              );
            })}
          </div>
          <p className="muted small" style={{ margin: 0 }}>{t('slot_rule', { n: checkinBefore })}</p>
          {err && <div className="err">{err}</div>}
          <div className="actions">
            <button className="btn" onClick={() => setStep(1)}>{t('back')}</button>
            <button className="btn btn-primary" disabled={!slot || busy} onClick={book}>{t('slot_confirm')}</button>
          </div>
        </Section>
      )}
    </>
  );
}

/* ───────── appointment slip ───────── */
function Ticket({ a, patient, deptName, onChange }: { a: MyAppointment; patient: Patient; deptName: string | null; onChange: () => void }) {
  const { t, fmtTime, fmtDate } = useI18n();
  const errText = useErrorText();
  const [msg, setMsg] = useState<string>('');
  const [worseOpen, setWorseOpen] = useState(false);
  const [flags, setFlags] = useState<string[]>([]);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const isToday = a.visit_date === bangkokDate();
  const canReportWorse = ['booked', 'skipped', 'checked_in', 'in_vitals', 'waiting_doctor'].includes(a.status);

  const checkIn = useMemo(() => async () => {
    try {
      const r = await rpc<{ status: string; slot?: string }>('check_in', { p_id: a.id });
      setMsg(r.status === 'no_slot' ? t('ci_no_slot') : '');
      onChange();
    } catch (e) { setMsg(errText(e)); }
  }, [a.id, onChange, t, errText]);

  async function cancel() {
    try { await rpc('cancel_appointment', { p_id: a.id }); setConfirmCancel(false); onChange(); } catch (e) { setMsg(errText(e)); }
  }

  async function sendWorse() {
    try { await rpc('report_worse', { p_id: a.id, p_flags: flags }); setWorseOpen(false); onChange(); } catch (e) { setMsg(errText(e)); }
  }

  return (
    <Section title={t('ticket_title')} aside={<StatusTag status={a.status} />}>
      <div className="slip">
        <div className="slip-main">
          <div><div className="muted small">{t('ticket_qno')}</div><div className="qno">{a.queue_no}</div></div>
          <dl className="kv">
            <dt>{t('ticket_name')}</dt><dd>{patient.full_name}</dd>
            <dt>{t('ticket_dept')}</dt><dd>{deptName ?? <span className="muted">{t('ticket_dept_pending')}</span>}</dd>
            <dt>{t('ticket_date')}</dt><dd>{fmtDate(a.visit_date)}</dd>
            <dt>{t('ticket_time')}</dt><dd className="num">{fmtTime(a.slot_start)}</dd>
            <dt>{t('ticket_checkin_by')}</dt><dd className="num">{fmtTime(a.checkin_deadline)}</dd>
          </dl>
        </div>
        <div className="slip-side">
          <div className="qr-box"><QRCodeSVG value={`KHIUMOR:${a.id}`} size={120} /></div>
        </div>
      </div>
      <p className="muted small" style={{ margin: 0 }}>{t('ticket_qr')}</p>

      {a.status === 'booked' && (
        <>
          <Notice tone="info" title={t('ci_due', { t: fmtTime(a.checkin_deadline) })}>{t('ci_due_body')}</Notice>
          {isToday ? <div className="actions"><button className="btn btn-primary" onClick={checkIn}>{t('ci_button')}</button></div>
            : <p className="muted small" style={{ margin: 0 }}>{t('ci_not_today')}</p>}
        </>
      )}
      {a.status === 'skipped' && (
        <>
          <Notice tone="crit" title={t('ci_skipped')}>{t('ci_skipped_body', { t: fmtTime(a.checkin_deadline) })}</Notice>
          {isToday && <div className="actions"><button className="btn btn-primary" onClick={checkIn}>{t('ci_skipped_button')}</button></div>}
        </>
      )}
      {['checked_in', 'in_vitals', 'waiting_doctor', 'in_exam'].includes(a.status) && (
        <Notice tone="good" title={t('ci_done')}>
          {a.rescheduled_from && <div>{t('ci_moved', { a: fmtTime(a.rescheduled_from), b: fmtTime(a.slot_start) })}</div>}
          {a.status === 'checked_in' && <div>{t('ci_ahead')}: <b className="num">{a.ahead_count}</b> · <span className="small">{t('ci_order_note')}</span></div>}
        </Notice>
      )}
      {a.status === 'referred' && <Notice tone="crit" title={t('ticket_referred')}>{t('ticket_referred_body')}</Notice>}
      {['booked', 'skipped'].includes(a.status) && (confirmCancel ? (
        <div className="criteria stack" style={{ gap: 10 }}>
          <b>{t('ticket_cancel_q')}</b>
          <div className="actions">
            <button className="btn btn-danger" onClick={cancel}>{t('ticket_cancel_yes')}</button>
            <button className="btn" onClick={() => setConfirmCancel(false)}>{t('back')}</button>
          </div>
        </div>
      ) : (
        <div className="actions">
          <button className="btn" onClick={() => setConfirmCancel(true)}>{t('ticket_cancel')}</button>
          <span className="muted small">{t('ticket_cancel_hint')}</span>
        </div>
      ))}
      {msg && <div className="err">{msg}</div>}

      {canReportWorse && (a.worsened_at
        ? <Notice tone="warn" title={t('worse_sent', { t: new Date(a.worsened_at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' }) })} />
        : worseOpen ? (
          <div className="criteria stack" style={{ gap: 10 }}>
            <h3>{t('worse_title')}</h3>
            <Toggles danger values={flags} onChange={setFlags} options={RED_FLAGS.map((f) => ({ value: f, label: t(`rf_${f}` as DictKey) }))} />
            {flags.length > 0 && <Notice tone="crit" title={t('worse_urgent')} />}
            <div className="actions">
              <button className="btn btn-primary" onClick={sendWorse}>{flags.length ? t('worse_send_flags') : t('worse_send_plain')}</button>
              <button className="btn" onClick={() => setWorseOpen(false)}>{t('cancel')}</button>
            </div>
          </div>
        ) : <div className="actions"><button className="btn btn-danger" onClick={() => { setFlags([]); setWorseOpen(true); }}>{t('worse_button')}</button></div>)}
    </Section>
  );
}
