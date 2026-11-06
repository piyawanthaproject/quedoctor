'use client';

import { useCallback, useEffect, useState } from 'react';
import { AppShell, Field, LevelBadge, Notice, Section, StatusTag, useProfile } from '@/components/ui';
import { CriteriaBox, PatientSummary, TriageCard, criteriaFor } from '@/components/staff';
import { useErrorText, useI18n } from '@/lib/i18n';
import { rpc, sb } from '@/lib/supabase/client';
import { VITAL_KEYS, vitalFlag, type Level, type VitalKey } from '@/lib/triage';
import { STAFF_SELECT, type Department, type StaffAppointment } from '@/lib/types';
import type { DictKey } from '@/lib/dict';

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date());
const byPriority = (x: StaffAppointment, y: StaffAppointment) =>
  (x.triage_level ?? 4) - (y.triage_level ?? 4) || x.slot_start.localeCompare(y.slot_start) || (x.checked_in_at ?? '').localeCompare(y.checked_in_at ?? '');

interface Alert { id: string; flags: string[]; created_at: string; patients: { full_name: string; phone: string | null } }
interface LogRow { id: number; actor_id: string | null; action: string; record_id: string | null; detail: Record<string, unknown> | null; created_at: string }
type Open = { id: string; stage: 'pre_visit' | 'vitals' | 'worsened'; preset?: Level | null };

export default function NursePage() {
  const profile = useProfile();
  const { t, pick, fmtTime } = useI18n();
  const errText = useErrorText();
  const [appts, setAppts] = useState<StaffAppointment[]>([]);
  const [depts, setDepts] = useState<Department[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<Open | null>(null);
  const [vitalsFor, setVitalsFor] = useState<string | null>(null);
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    await rpc('skip_overdue').catch(() => {});
    const [a, al, lg] = await Promise.all([
      sb().from('appointments').select(STAFF_SELECT).eq('visit_date', today()).order('slot_start'),
      sb().from('emergency_alerts').select('id, flags, created_at, patients(full_name, phone)').is('handled_at', null).order('created_at'),
      sb().from('audit_logs').select('*').gte('created_at', `${today()}T00:00:00+07:00`).order('created_at', { ascending: false }).limit(40),
    ]);
    setAppts((a.data as unknown as StaffAppointment[]) ?? []);
    setAlerts((al.data as unknown as Alert[]) ?? []);
    setLogs((lg.data as LogRow[]) ?? []);
  }, []);

  useEffect(() => {
    load();
    sb().from('departments').select('id, name_th, name_en').then(({ data }) => setDepts((data as Department[]) ?? []));
    sb().from('profiles').select('id, full_name').then(({ data }) => setNames(Object.fromEntries((data ?? []).map((p) => [p.id, p.full_name]))));
    const ch = sb().channel('nurse')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'appointments' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'emergency_alerts' }, () => load())
      .subscribe();
    const tick = setInterval(load, 60000); // deadlines pass even when nobody changes anything
    return () => { sb().removeChannel(ch); clearInterval(tick); };
  }, [load]);

  const act = async (fn: () => Promise<unknown>) => { setErr(''); try { await fn(); await load(); } catch (e) { setErr(errText(e)); } };

  const pending = appts.filter((a) => !a.triage_level && !['referred', 'cancelled', 'done'].includes(a.status));
  const worse = appts.filter((a) => a.worsened_at && !['done', 'referred'].includes(a.status));
  const waiting = appts.filter((a) => a.status === 'checked_in').sort(byPriority);
  const inVitals = appts.filter((a) => a.status === 'in_vitals');
  const vf = appts.find((a) => a.id === vitalsFor) ?? inVitals[0] ?? null;
  const openAppt = open && appts.find((a) => a.id === open.id);
  const count = (s: string) => appts.filter((a) => a.status === s).length;
  const deptName = (id: string | null) => { const d = depts.find((x) => x.id === id); return d ? pick(d.name_th, d.name_en) : '–'; };
  const stageFor = (a: StaffAppointment): Open['stage'] => a.worsened_at ? 'worsened' : a.vital_signs ? 'vitals' : 'pre_visit';

  return (
    <AppShell role="nurse" name={profile?.full_name}>
      {alerts.length > 0 && (
        <Notice tone="crit" title={t('n_alerts')}>
          <ul className="rows">
            {alerts.map((x) => (
              <li key={x.id}>
                <span><b>{x.patients.full_name}</b> · <span className="num">{x.patients.phone}</span><br /><span className="small">{x.flags.map((f) => t(`rf_${f}` as DictKey)).join(' · ')}</span></span>
                <button className="btn btn-sm" onClick={() => act(() => rpc('handle_alert', { p_id: x.id }))}>{t('n_alert_called')}</button>
              </li>
            ))}
          </ul>
        </Notice>
      )}
      {worse.length > 0 && (
        <Notice tone="crit" title={t('n_worse')}>
          <div className="actions">{worse.map((a) => (
            <button key={a.id} className="btn btn-sm btn-danger" onClick={() => setOpen({ id: a.id, stage: 'worsened' })}>{a.queue_no} {a.patients.full_name} · {t('n_retriage')}</button>
          ))}</div>
        </Notice>
      )}
      {err && <Notice tone="crit">{err}</Notice>}

      <div className="counts">
        {([['n_count_pending', pending.length], ['n_count_booked', count('booked')], ['n_count_vitals', waiting.length], ['n_count_doctor', count('waiting_doctor')], ['n_count_skipped', count('skipped')]] as const).map(([k, n]) => (
          <div key={k} className="count"><div className="n" style={k === 'n_count_skipped' && n ? { color: 'var(--crit)' } : undefined}>{n}</div><div className="l">{t(k)}</div></div>
        ))}
      </div>

      <div className="cols">
        <div className="stack">
          <Section title={t('n_triage_title')} aside={`${pending.length}`}>
            {openAppt && open && (
              <TriageCard key={open.id + open.stage} a={openAppt} stage={open.stage} depts={depts} presetLevel={open.preset}
                onClose={() => setOpen(null)} onDone={() => { setOpen(null); load(); }} />
            )}
            {pending.filter((a) => a.id !== open?.id).length ? (
              <ul className="rows">
                {pending.filter((a) => a.id !== open?.id).map((a) => {
                  const c = criteriaFor(a);
                  return (
                    <li key={a.id}>
                      <span style={{ minWidth: 0, flex: 1 }}>
                        <b>{a.patients.full_name}</b> <span className="muted small">{a.queue_no} · {fmtTime(a.slot_start)}</span><br />
                        <span className="small">{a.symptom_reports.map((x) => x.description).join(' · ') || a.screenings?.note}</span>
                      </span>
                      <span className="actions"><span className="small muted">{t('cr_level', { n: c.level })}</span>
                        <button className="btn btn-sm btn-primary" onClick={() => setOpen({ id: a.id, stage: 'pre_visit' })}>{t('n_triage_open')}</button></span>
                    </li>
                  );
                })}
              </ul>
            ) : !openAppt && <p className="muted" style={{ margin: 0 }}>{t('n_no_pending')}</p>}
          </Section>

          <Section title={t('n_queue_title')}>
            <div className="table-wrap">
              <table>
                <thead><tr><th>{t('n_col_time')}</th><th>{t('n_col_q')}</th><th>{t('n_col_name')}</th><th>{t('n_col_dept')}</th><th>{t('n_col_level')}</th><th>{t('n_col_status')}</th><th /></tr></thead>
                <tbody>
                  {appts.map((a) => (
                    <tr key={a.id} className={a.id === open?.id || a.id === vf?.id ? 'is-current' : ''}>
                      <td className="num">{fmtTime(a.slot_start)}{a.rescheduled_from && <div className="small muted">{t('n_was', { t: fmtTime(a.rescheduled_from) })}</div>}</td>
                      <td className="num">{a.queue_no}</td>
                      <td className="nowrap">{a.patients.full_name}</td>
                      <td className="small nowrap">{deptName(a.department_id)}</td>
                      <td><LevelBadge level={a.triage_level} /></td>
                      <td><StatusTag status={a.status} /></td>
                      <td>
                        <div className="actions" style={{ flexWrap: 'nowrap', gap: 6 }}>
                          {['booked', 'skipped'].includes(a.status) && <button className="btn btn-sm" onClick={() => act(() => rpc('check_in', { p_id: a.id }))}>{t('n_checkin_for')}</button>}
                          {a.triage_level && ['booked', 'skipped', 'checked_in', 'in_vitals', 'waiting_doctor'].includes(a.status) &&
                            <button className="btn btn-sm" onClick={() => setOpen({ id: a.id, stage: stageFor(a) })}>{t('n_retriage')}</button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        </div>

        <div className="stack">
          <Section title={t('n_vitals_title')}
            aside={<button className="btn btn-primary btn-sm" disabled={!waiting.length}
              onClick={() => act(async () => { const id = await rpc<string | null>('call_next_vitals'); if (id) setVitalsFor(id); })}>{t('n_call_next')}</button>}>
            {vf ? <VitalsForm key={vf.id} a={vf} onSaved={(status, preset) => {
              setVitalsFor(null);
              if (status === 'in_vitals') setOpen({ id: vf.id, stage: 'vitals', preset });
              load();
            }} /> : <p className="muted" style={{ margin: 0 }}>{t('n_vitals_empty')}</p>}
            <div>
              <div className="sub">{t('n_waiting_list')} ({waiting.length})</div>
              <ul className="rows">
                {waiting.map((a) => (
                  <li key={a.id}><span className="num">{a.queue_no} · {a.patients.full_name}</span><span className="actions small"><LevelBadge level={a.triage_level} />{fmtTime(a.slot_start)}</span></li>
                ))}
              </ul>
            </div>
          </Section>

          <Section title={t('n_log')} aside={t('n_log_hint')}>
            <div className="log">
              {logs.map((l) => {
                const a = appts.find((x) => x.id === l.record_id);
                const q = a?.queue_no ?? (l.detail?.queue_no as string | undefined) ?? '';
                return (
                  <div key={l.id}>
                    <time>{new Date(l.created_at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' })}</time>
                    <span>{t(`log_${l.action}` as DictKey)} {q && <b className="num">{q}</b>} <span className="muted">· {l.actor_id ? names[l.actor_id] ?? '' : t('log_system')}</span></span>
                  </div>
                );
              })}
            </div>
          </Section>
        </div>
      </div>
    </AppShell>
  );
}

function VitalsForm({ a, onSaved }: { a: StaffAppointment; onSaved: (status: string, preset: Level) => void }) {
  const { t } = useI18n();
  const errText = useErrorText();
  const [v, setV] = useState<Partial<Record<VitalKey, string>>>(() =>
    Object.fromEntries(VITAL_KEYS.map((k) => [k, a.vital_signs?.[k] != null ? String(a.vital_signs[k]) : ''])));
  const [err, setErr] = useState('');

  const nums = Object.fromEntries(VITAL_KEYS.map((k) => [k, v[k] === '' || v[k] == null ? null : Number(v[k])])) as Record<VitalKey, number | null>;
  const c = criteriaFor(a, nums);
  const raise = !a.triage_level || c.level < a.triage_level;
  const bmi = nums.weight && nums.height ? (nums.weight / (nums.height / 100) ** 2).toFixed(1) : '–';

  async function save() {
    try {
      const status = await rpc<string>('save_vitals', { p_id: a.id, p_vitals: nums, p_needs_retriage: raise });
      onSaved(status, c.level);
    } catch (e) { setErr(errText(e)); }
  }

  return (
    <div className="stack" style={{ gap: 14 }}>
      <PatientSummary a={a} />
      <div className="vit-grid">
        {VITAL_KEYS.map((k) => {
          const fl = vitalFlag(k, nums[k]);
          return (
            <Field key={k} label={t(`v_${k}` as DictKey)}>
              <input id={`v-${k}`} className={`input num ${fl}`} inputMode="decimal" value={v[k] ?? ''}
                onChange={(e) => setV({ ...v, [k]: e.target.value.replace(/[^\d.]/g, '') })} />
            </Field>
          );
        })}
      </div>
      <div className="small">{t('v_bmi')}: <b className="num">{bmi}</b></div>
      {a.triage_level && c.level < a.triage_level && (
        <Notice tone={c.level <= 2 ? 'crit' : 'warn'} title={t('v_raise', { n: c.level, m: a.triage_level })}>{t('v_raise_body')}</Notice>
      )}
      {c.reasons.some((r) => r.code === 'vital') && <CriteriaBox c={c} />}
      {err && <div className="err">{err}</div>}
      <div className="actions"><button className="btn btn-primary" onClick={save}>{t('n_vitals_save')}</button></div>
    </div>
  );
}
