'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell, Field, Notice, Section } from '@/components/ui';
import { useI18n } from '@/lib/i18n';
import { sb } from '@/lib/supabase/client';
import type { DictKey } from '@/lib/dict';

const DEMO = [
  { role: 'patient', email: 'patient@khiumor.demo' },
  { role: 'nurse', email: 'nurse@khiumor.demo' },
  { role: 'doctor', email: 'doctor@khiumor.demo' },
  { role: 'admin', email: 'admin@khiumor.demo' },
];
const DEMO_PASSWORD = 'KhiuMor-demo-2026';

export default function LoginPage() {
  const { t } = useI18n();
  const router = useRouter();
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [msg, setMsg] = useState<{ tone: 'crit' | 'info'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      if (mode === 'in') {
        const { data, error } = await sb().auth.signInWithPassword({ email, password });
        if (error || !data.user) { setMsg({ tone: 'crit', text: t('login_failed') }); return; }
        const { data: p } = await sb().from('profiles').select('role').eq('id', data.user.id).single();
        router.replace(`/${p?.role ?? 'patient'}`);
        router.refresh();
      } else {
        const { data, error } = await sb().auth.signUp({ email, password, options: { data: { full_name: name } } });
        if (error) { setMsg({ tone: 'crit', text: error.message }); return; }
        if (data.session) { router.replace('/patient'); router.refresh(); }
        else setMsg({ tone: 'info', text: t('login_check_email') });
      }
    } finally { setBusy(false); }
  }

  return (
    <AppShell role={null}>
      <div className="login">
        <Section title={mode === 'in' ? t('login_title') : t('login_signup')}>
          <form onSubmit={submit} className="stack" style={{ gap: 14 }}>
            {mode === 'up' && (
              <Field label={t('login_full_name')}><input id="name" className="input" required value={name} onChange={(e) => setName(e.target.value)} /></Field>
            )}
            <Field label={t('login_email')}><input id="email" className="input" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
            <Field label={t('login_password')}><input id="password" className="input" type="password" required minLength={6} autoComplete={mode === 'in' ? 'current-password' : 'new-password'} value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
            {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
            <div className="actions">
              <button className="btn btn-primary" disabled={busy}>{mode === 'in' ? t('login_submit') : t('login_signup_submit')}</button>
              <button type="button" className="btn" onClick={() => { setMode(mode === 'in' ? 'up' : 'in'); setMsg(null); }}>
                {mode === 'in' ? t('login_signup') : t('login_have_account')}
              </button>
            </div>
          </form>
        </Section>
        <Section title={t('login_demo')} aside={t('login_demo_hint')}>
          <div className="demo-list">
            {DEMO.map((d) => (
              <button key={d.role} type="button" onClick={() => { setMode('in'); setEmail(d.email); setPassword(DEMO_PASSWORD); }}>
                <b>{t(`role_${d.role}` as DictKey)}</b><span className="muted small">{d.email}</span>
              </button>
            ))}
          </div>
          <p className="muted small" style={{ margin: 0 }}>{t('login_privacy')}</p>
        </Section>
      </div>
    </AppShell>
  );
}
