import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

interface LocaleContextValue {
  locale: 'en' | 'ar';
  direction: 'ltr' | 'rtl';
  setLocale: (value: 'en' | 'ar') => void;
}

const LocaleContext = createContext<LocaleContextValue | undefined>(undefined);

export function useLocale() {
  const context = useContext(LocaleContext);
  if (!context) {
    throw new Error('useLocale must be used within LocaleProvider');
  }
  return context;
}

function getInitialLocale(): 'en' | 'ar' {
  if (typeof window === 'undefined') {
    return 'en';
  }

  const stored = window.localStorage.getItem('wain-locale');
  return stored === 'ar' ? 'ar' : 'en';
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<'en' | 'ar'>(getInitialLocale);

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.lang = locale;
      document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr';
    }

    if (typeof window !== 'undefined') {
      window.localStorage.setItem('wain-locale', locale);
    }
  }, [locale]);

  const value = useMemo(
    () => ({ locale, direction: locale === 'ar' ? 'rtl' : 'ltr', setLocale } as const),
    [locale],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}
