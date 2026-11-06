'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { AppShell, Choice, Notice, Section, useProfile } from '@/components/ui';
import { useErrorText, useI18n } from '@/lib/i18n';
import { rpc, sb } from '@/lib/supabase/client';
import { COVERAGES, type Department } from '@/lib/types';
import type { DictKey } from '@/lib/dict';

interface Stats {
  patients: number; days: number; revenue: number;
  on_time_pct: number | null; rescheduled_pct: number | null; urgent_pct: number | null;
  override_up: number; override_down: number;
  by_department: { department: string; n: number }[];
  age_gender: { age_group: string; gender: 'F' | 'M'; n: number }[];
  heatmap: { dow: number; hour: number; n: number }[];
  top_diagnoses: { label: string; n: number }[];
  revenue_by_department: { department: string | null; coverage: string; amount: number }[];
  revenue_weekly: { week: string; amount: number }[];
  levels: { level: number; as_criteria: number; raised: number; lowered: number }[];
}

const AGE_GROUPS = ['0-14', '15-29', '30-44', '45-59', '60+'];

/** Reads the chart colours from CSS so the charts follow light and dark mode. */
function useTokens() {
  const read = () => {
    if (typeof window === 'undefined') return {} as Record<string, string>;
    const s = getComputedStyle(document.documentElement);
    return Object.fromEntries(['--c1', '--c2', '--c3', '--c4', '--c5', '--lv1', '--lv2', '--lv3', '--lv4', '--lv5', '--rule', '--muted', '--ink', '--surface', '--brand']
      .map((k) => [k.slice(2), s.getPropertyValue(k).trim()]));
  };
  const [tok, setTok] = useState<Record<string, string>>({});
  useEffect(() => {
    setTok(read());
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const on = () => setTok(read());
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return tok;
}

export default function AdminPage() {
  const profile = useProfile();
  const { t, pick, fmtMoney, lang } = useI18n();
  const errText = useErrorText();
  const tok = useTokens();
  const [days, setDays] = useState(30);
  const [dept, setDept] = useState<string>('all');
  const [depts, setDepts] = useState<Department[]>([]);
  const [s, setS] = useState<Stats | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => { sb().from('departments').select('id, name_th, name_en').then(({ data }) => setDepts((data as Department[]) ?? [])); }, []);
  useEffect(() => {
    rpc<Stats>('admin_stats', { p_days: days, p_department: dept === 'all' ? null : dept }).then(setS).catch((e) => setErr(errText(e)));
  }, [days, dept]); // eslint-disable-line react-hooks/exhaustive-deps

  const dName = (id: string | null) => { const d = depts.find((x) => x.id === id); return d ? pick(d.name_th, d.name_en) : '–'; };
  const covColor = (i: number) => tok[`c${i + 1}`];
  const axis = { stroke: tok.rule, tick: { fill: tok.muted, fontSize: 12 } };
  const tip = { contentStyle: { background: tok.surface, border: `1px solid ${tok.rule}`, color: tok.ink, fontSize: 13 } };
  const legend = { wrapperStyle: { fontSize: 12 }, formatter: (v: string) => <span style={{ color: tok.ink }}>{v}</span> };
  const k = (v: number) => `฿${(v / 1000).toLocaleString(lang === 'th' ? 'th-TH' : 'en-US', { maximumFractionDigits: 0 })}k`;

  const revDept = useMemo(() => {
    if (!s) return [];
    const ids = Array.from(new Set(s.revenue_by_department.map((r) => r.department).filter(Boolean))) as string[];
    return ids.map((id) => ({ name: dName(id), ...Object.fromEntries(COVERAGES.map((c) => [c, s.revenue_by_department.filter((r) => r.department === id && r.coverage === c).reduce((a, r) => a + Number(r.amount), 0)])) }));
  }, [s, depts, lang]); // eslint-disable-line react-hooks/exhaustive-deps
  const revCov = useMemo(() => COVERAGES.map((c) => ({ name: t(`cov_${c}` as DictKey), value: (s?.revenue_by_department ?? []).filter((r) => r.coverage === c).reduce((a, r) => a + Number(r.amount), 0) })), [s, t]);
  const ages = useMemo(() => AGE_GROUPS.map((g) => ({ name: g, F: s?.age_gender.find((x) => x.age_group === g && x.gender === 'F')?.n ?? 0, M: s?.age_gender.find((x) => x.age_group === g && x.gender === 'M')?.n ?? 0 })), [s]);
  const hours = Array.from(new Set((s?.heatmap ?? []).map((h) => h.hour))).sort((a, b) => a - b);
  const weeks = Math.max(1, (s?.days ?? 6) / 6);
  const heatMax = Math.max(1, ...(s?.heatmap ?? []).map((h) => h.n / weeks));
  const covTotal = revCov.reduce((a, r) => a + r.value, 0) || 1;

  return (
    <AppShell role="admin" name={profile?.full_name}>
      <div className="actions" style={{ justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div><h1>{t('a_title')}</h1><div className="muted small">{t('a_hint')}</div></div>
        <div className="actions">
          <Choice value={days} onChange={setDays} label={t('a_period')} options={[7, 30, 90].map((n) => ({ value: n, label: t('a_days', { n }) }))} />
        </div>
      </div>
      <Choice wide value={dept} onChange={setDept} options={[{ value: 'all', label: t('a_all_depts') }, ...depts.map((d) => ({ value: d.id, label: pick(d.name_th, d.name_en) }))]} />
      {err && <Notice tone="crit">{err}</Notice>}
      {s && (s.patients === 0 ? <Notice tone="info">{t('a_empty')}</Notice> : (
        <>
          <div className="kpis">
            <div className="kpi"><div className="l">{t('a_patients')}</div><div className="n">{s.patients.toLocaleString()}</div><div className="l">{t('a_per_day', { n: Math.round(s.patients / Math.max(1, s.days)) })}</div></div>
            <div className="kpi"><div className="l">{t('a_revenue')}</div><div className="n">{fmtMoney(s.revenue)}</div><div className="l">{t('a_per_visit', { n: fmtMoney(s.revenue / Math.max(1, s.patients)) })}</div></div>
            <div className="kpi"><div className="l">{t('a_on_time')}</div><div className="n" style={{ color: 'var(--good)' }}>{s.on_time_pct ?? '–'}%</div><div className="l">{t('a_rescheduled', { n: s.rescheduled_pct ?? 0 })}</div></div>
            <div className="kpi"><div className="l">{t('a_urgent')}</div><div className="n">{s.urgent_pct ?? 0}%</div><div className="l">{t('a_overrides', { up: s.override_up, down: s.override_down })}</div></div>
          </div>
          <div className="charts">
            <Section title={t('a_rev_dept')}>
              <div className="chart"><ResponsiveContainer>
                <BarChart data={revDept}><CartesianGrid vertical={false} stroke={tok.rule} /><XAxis dataKey="name" {...axis} /><YAxis tickFormatter={k} {...axis} />
                  <Tooltip {...tip} formatter={(v: number) => fmtMoney(v)} /><Legend {...legend} />
                  {COVERAGES.map((c, i) => <Bar key={c} dataKey={c} name={t(`cov_${c}` as DictKey)} stackId="a" fill={covColor(i)} />)}
                </BarChart></ResponsiveContainer></div>
            </Section>
            <Section title={t('a_rev_cov')}>
              <div className="chart"><ResponsiveContainer>
                <PieChart><Pie data={revCov} dataKey="value" nameKey="name" innerRadius="55%" outerRadius="85%" stroke={tok.surface}>
                  {revCov.map((_, i) => <Cell key={i} fill={covColor(i)} />)}</Pie>
                  <Tooltip {...tip} formatter={(v: number) => fmtMoney(v)} />
                  <Legend layout="vertical" align="right" verticalAlign="middle" wrapperStyle={{ fontSize: 12 }}
                    formatter={(name: string, e) => <span style={{ color: tok.ink }}>{name} {Math.round(((e.payload as { value?: number })?.value ?? 0) / covTotal * 100)}%</span>} />
                </PieChart></ResponsiveContainer></div>
            </Section>
            <Section title={t('a_by_dept')}>
              <div className="chart"><ResponsiveContainer>
                <BarChart layout="vertical" data={s.by_department.map((d) => ({ name: dName(d.department), n: d.n }))}>
                  <CartesianGrid horizontal={false} stroke={tok.rule} /><XAxis type="number" {...axis} /><YAxis type="category" dataKey="name" width={110} {...axis} />
                  <Tooltip {...tip} /><Bar dataKey="n" name={t('a_patients')} fill={tok.c1} />
                </BarChart></ResponsiveContainer></div>
            </Section>
            <Section title={t('a_age')}>
              <div className="chart"><ResponsiveContainer>
                <BarChart data={ages}><CartesianGrid vertical={false} stroke={tok.rule} /><XAxis dataKey="name" {...axis} /><YAxis {...axis} />
                  <Tooltip {...tip} /><Legend {...legend} />
                  <Bar dataKey="F" name={t('female')} fill={tok.c4} /><Bar dataKey="M" name={t('male')} fill={tok.c2} />
                </BarChart></ResponsiveContainer></div>
            </Section>
            <Section title={t('a_dx')}>
              <div className="chart"><ResponsiveContainer>
                <BarChart layout="vertical" data={s.top_diagnoses}>
                  <CartesianGrid horizontal={false} stroke={tok.rule} /><XAxis type="number" {...axis} /><YAxis type="category" dataKey="label" width={210} {...axis} tick={{ fill: tok.muted, fontSize: 11 }} />
                  <Tooltip {...tip} /><Bar dataKey="n" name={t('a_patients')} fill={tok.c2} />
                </BarChart></ResponsiveContainer></div>
            </Section>
            <Section title={t('a_levels')} aside={t('a_levels_note')}>
              <div className="chart"><ResponsiveContainer>
                <BarChart data={s.levels.map((l) => ({ ...l, name: `${l.level} ${t(`lv_${l.level}` as DictKey)}` }))}>
                  <CartesianGrid vertical={false} stroke={tok.rule} /><XAxis dataKey="name" {...axis} /><YAxis {...axis} />
                  <Tooltip {...tip} /><Legend {...legend} />
                  <Bar dataKey="as_criteria" stackId="l" name={t('a_as_criteria')} fill={tok.c1} />
                  <Bar dataKey="raised" stackId="l" name={t('a_raised')} fill={tok.lv1} />
                  <Bar dataKey="lowered" stackId="l" name={t('a_lowered')} fill={tok.c3} />
                </BarChart></ResponsiveContainer></div>
            </Section>
            <Section title={t('a_heat')} aside={t('a_heat_unit')}>
              <div className="table-wrap">
                <div className="heat" style={{ ['--hours' as string]: hours.length }}>
                  <div />{hours.map((h) => <div key={h} className="h">{String(h).padStart(2, '0')}</div>)}
                  {[1, 2, 3, 4, 5, 6, 7].filter((d) => s.heatmap.some((h) => h.dow === d)).map((d) => (
                    <div key={d} style={{ display: 'contents' }}>
                      <div className="d">{t(`dow_${d}` as DictKey)}</div>
                      {hours.map((h) => {
                        const v = (s.heatmap.find((x) => x.dow === d && x.hour === h)?.n ?? 0) / weeks, a = v / heatMax;
                        return <div key={h} className="c" title={`${v.toFixed(1)}`} style={{ background: `color-mix(in srgb, var(--brand) ${Math.round(a * 85 + 4)}%, var(--sunken))`, color: a > 0.5 ? '#fff' : 'var(--muted)' }}>{v >= 1 ? Math.round(v) : ''}</div>;
                      })}
                    </div>
                  ))}
                </div>
              </div>
            </Section>
            <Section title={t('a_weekly')}>
              <div className="chart"><ResponsiveContainer>
                <LineChart data={s.revenue_weekly.map((w) => ({ name: new Date(w.week).toLocaleDateString(lang === 'th' ? 'th-TH' : 'en-GB', { day: 'numeric', month: 'short' }), amount: Number(w.amount) }))}>
                  <CartesianGrid vertical={false} stroke={tok.rule} /><XAxis dataKey="name" {...axis} /><YAxis tickFormatter={k} {...axis} />
                  <Tooltip {...tip} formatter={(v: number) => fmtMoney(v)} />
                  <Line type="monotone" dataKey="amount" name={t('a_revenue')} stroke={tok.c1} strokeWidth={2} dot={{ r: 2 }} />
                </LineChart></ResponsiveContainer></div>
            </Section>
          </div>
        </>
      ))}
    </AppShell>
  );
}
