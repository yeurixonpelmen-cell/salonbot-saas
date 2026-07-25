import { createContext, ReactNode, useContext, useMemo, useState } from 'react';
import {
  ADMIN_LANG_KEY,
  AdminLang,
  dictionaries,
  normalizeAdminLang,
} from '../i18n/locales';

type LocaleContextValue = {
  lang: AdminLang;
  setLang: (lang: AdminLang) => void;
  t: (key: string) => string;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

function readStoredLang(): AdminLang {
  try {
    return normalizeAdminLang(localStorage.getItem(ADMIN_LANG_KEY));
  } catch {
    return 'uk';
  }
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<AdminLang>(() => readStoredLang());

  const value = useMemo<LocaleContextValue>(() => {
    const dict = dictionaries[lang] ?? dictionaries.uk;
    return {
      lang,
      setLang: (next) => {
        const normalized = normalizeAdminLang(next);
        setLangState(normalized);
        try {
          localStorage.setItem(ADMIN_LANG_KEY, normalized);
        } catch {
          // ignore quota / private mode
        }
        document.documentElement.lang = normalized === 'uk' ? 'uk' : normalized;
      },
      t: (key) => dict[key] ?? dictionaries.uk[key] ?? key,
    };
  }, [lang]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error('useLocale must be used within LocaleProvider');
  return ctx;
}
