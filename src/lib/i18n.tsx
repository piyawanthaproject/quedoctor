'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { DICTS, type DictKey, type Lang } from './dict';

type Params = Record<string, string | number>;
interface I18n {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: DictKey, params?: Params) => string;
  /** pick the right field from a bilingual record, e.g. a department {name_th, name_en} */
  pick: (th: string | null | undefined, en: string | null | undefined) => string;
  fmtTime: (t: string | null | undefined) => string;
  fmtDate: (d: string | Date) => string;
  fmtMoney: (n: number) => string;
}

const Ctx = createContext<I18n | null>(null);
const KEY = 'khiumor.lang';

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>('th');

  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY);
      if (saved === 'th' || saved === 'en') setLangState(saved);
    } catch { /* storage unavailable */ }
  }, []);

  useEffect(() => { document.documentElement.lang = lang; }, [lang]);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try { localStorage.setItem(KEY, l); } catch { /* ignore */ }
  }, []);

  const t = useCallback((key: DictKey, params?: Params) => {
    let s = DICTS[lang][key] ?? key;
    if (params) for (const [k, v] of Object.entries(params)) s = s.replaceAll(`{${k}}`, String(v));
    return s;
  }, [lang]);

  const value: I18n = {
    lang, setLang, t,
    pick: (th, en) => (lang === 'en' ? en || th : th || en) ?? '',
    fmtTime: (v) => (v ? v.slice(0, 5) : '–'),
    fmtDate: (d) => new Date(d).toLocaleDateString(lang === 'th' ? 'th-TH' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
    fmtMoney: (n) => `฿${Math.round(n).toLocaleString(lang === 'th' ? 'th-TH' : 'en-US')}`,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useI18n must be used inside I18nProvider');
  return v;
}

/** Translates a database error such as "SLOT_FULL" into a readable message. */
export function useErrorText() {
  const { t } = useI18n();
  return (e: unknown) => {
    const msg = e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String((e as { message: unknown }).message) : String(e);
    const code = msg.match(/[A-Z_]{5,}/)?.[0];
    const key = `err_${code}` as DictKey;
    return code && key in DICTS.th ? t(key) : t('err_generic', { msg });
  };
}
