'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useI18n } from '@/lib/i18n';
import { sb } from '@/lib/supabase/client';
import type { DictKey } from '@/lib/dict';
import type { Level } from '@/lib/triage';
import type { Role, Status } from '@/lib/types';
import { regions, type View } from '@/lib/body';

/* ───────── page frame ───────── */
export function AppShell({ role, name, children }: { role: Role | null; name?: string | null; children: ReactNode }) {
  const { t, lang, setLang } = useI18n();
  const router = useRouter();
  return (
    <>
      <header className="topbar">
        <div className="wrap topbar-row">
          <div className="brand">
            <span className="brand-mark" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none"><path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z" fill="currentColor" /></svg>
            </span>
            <div><div className="brand-name">{t('app_name')}</div><div className="brand-sub">{t('app_tagline')}</div></div>
          </div>
          <div className="topbar-right">
            {role && <span className="who">{name} · {t(`role_${role}` as DictKey)}</span>}
            <button className="btn btn-quiet" onClick={() => setLang(lang === 'th' ? 'en' : 'th')} aria-label="Language">
              {t('lang_switch')}
            </button>
            {role && (
              <button className="btn btn-quiet" onClick={async () => { await sb().auth.signOut(); router.replace('/login'); router.refresh(); }}>
                {t('sign_out')}
              </button>
            )}
          </div>
        </div>
      </header>
      {role && (
        <div className="subbar">
          <div className="wrap subbar-row">
            <span className="subbar-role">{t(`role_${role}` as DictKey)}</span>
            <span>{new Date().toLocaleDateString(lang === 'th' ? 'th-TH' : 'en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Bangkok' })}</span>
          </div>
        </div>
      )}
      <main className="wrap page">{children}</main>
    </>
  );
}

/** Loads the signed-in user's profile (name and role). */
export function useProfile() {
  const [p, setP] = useState<{ id: string; role: Role; full_name: string | null } | null>(null);
  useEffect(() => {
    (async () => {
      const { data: { user } } = await sb().auth.getUser();
      if (!user) return;
      const { data } = await sb().from('profiles').select('id, role, full_name').eq('id', user.id).single();
      if (data) setP(data as typeof p);
    })();
  }, []);
  return p;
}

/* ───────── small pieces ───────── */
export function Section({ title, aside, children, className = '' }: { title?: ReactNode; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`section ${className}`}>
      {(title || aside) && <div className="section-head"><h2>{title}</h2>{aside && <div className="section-aside">{aside}</div>}</div>}
      <div className="section-body">{children}</div>
    </section>
  );
}

export function LevelBadge({ level }: { level: Level | null | undefined }) {
  const { t } = useI18n();
  if (!level) return <span className="level level-0">{t('lv_none')}</span>;
  return <span className={`level level-${level}`}>{t('lv')} {level} · {t(`lv_${level}` as DictKey)}</span>;
}

export function StatusTag({ status }: { status: Status }) {
  const { t } = useI18n();
  return <span className={`status status-${status}`}>{t(`st_${status}` as DictKey)}</span>;
}

export function Notice({ tone, title, children }: { tone: 'info' | 'warn' | 'crit' | 'good'; title?: ReactNode; children?: ReactNode }) {
  return (
    <div className={`notice notice-${tone}`} role={tone === 'crit' ? 'alert' : undefined}>
      {title && <strong>{title}</strong>}
      {children && <div>{children}</div>}
    </div>
  );
}

/** A row of mutually exclusive buttons, used instead of drop-down lists. */
export function Choice<T extends string | number>({ value, options, onChange, label, wide }: {
  value: T | null; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void; label?: string; wide?: boolean;
}) {
  return (
    <div className={`choice ${wide ? 'choice-wide' : ''}`} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" role="radio" aria-checked={value === o.value}
          className="choice-btn" onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

/** Toggle buttons for a set of codes. */
export function Toggles({ values, options, onChange, danger }: {
  values: string[]; options: { value: string; label: ReactNode }[]; onChange: (v: string[]) => void; danger?: boolean;
}) {
  return (
    <div className="toggles">
      {options.map((o) => {
        const on = values.includes(o.value);
        return (
          <button key={o.value} type="button" aria-pressed={on} className={`toggle ${danger ? 'toggle-danger' : ''}`}
            onClick={() => onChange(on ? values.filter((x) => x !== o.value) : [...values, o.value])}>{o.label}</button>
        );
      })}
    </div>
  );
}

/** 0–10 severity as tappable numbers. */
export function SeverityScale({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const { t } = useI18n();
  return (
    <div>
      <div className="scale" role="radiogroup" aria-label={t('sym_severity')}>
        {Array.from({ length: 11 }, (_, n) => (
          <button key={n} type="button" role="radio" aria-checked={value === n} onClick={() => onChange(n)}
            className={`scale-btn ${n >= 8 ? 'scale-high' : n >= 5 ? 'scale-mid' : ''}`}>{n}</button>
        ))}
      </div>
      <div className="scale-legend"><span>{t('sev_low')}</span><span>{t('sev_mid')}</span><span>{t('sev_high')}</span></div>
    </div>
  );
}

export function Field({ label, children, hint }: { label: ReactNode; children: ReactNode; hint?: ReactNode }) {
  return <label className="field"><span className="field-label">{label}</span>{children}{hint && <span className="field-hint">{hint}</span>}</label>;
}

/* ───────── body diagram ───────── */
export function BodyMap({ gender, view, selected, active, onSelect, compact }: {
  gender: 'F' | 'M'; view: View; selected: string[]; active?: string | null; onSelect?: (id: string) => void; compact?: boolean;
}) {
  const { t } = useI18n();
  const list = regions(gender, view);
  return (
    <svg className={`body ${onSelect ? 'body-interactive' : ''} ${compact ? 'body-compact' : ''}`} viewBox="0 0 200 424" role="img"
      aria-label={`${gender === 'F' ? t('female') : t('male')} · ${view === 'front' ? t('front') : t('back_view')}`}>
      {list.map((r) => {
        const cls = ['region', selected.includes(r.id) ? 'region-on' : '', active === r.id ? 'region-active' : ''].join(' ');
        return (
          <g key={r.id} className={cls} onClick={onSelect ? () => onSelect(r.id) : undefined}
            role={onSelect ? 'button' : undefined} tabIndex={onSelect ? 0 : undefined} aria-label={r.th}
            onKeyDown={onSelect ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(r.id); } } : undefined}>
            {r.shapes.map((s, i) => s.t === 'ellipse'
              ? <ellipse key={i} cx={s.cx} cy={s.cy} rx={s.rx} ry={s.ry} />
              : <rect key={i} x={s.x} y={s.y} width={s.w} height={s.h} rx={s.r} />)}
          </g>
        );
      })}
      <text x="100" y="421" textAnchor="middle" className="body-caption">
        {view === 'front' ? t('front') : t('back_view')} · {gender === 'F' ? t('female') : t('male')}
      </text>
    </svg>
  );
}
