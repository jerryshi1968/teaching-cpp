import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { LANGUAGE_STORAGE_KEY, localizeError, readLanguage, translate, writeLanguage } from '../i18n.mjs';

const LanguageContext = createContext(null);

export function LanguageProvider({ children }) {
  const [language, setLanguageState] = useState(() => readLanguage());
  const languageRef = useRef(language);
  languageRef.current = language;
  const setLanguage = useCallback(value => { const next = value === 'en' ? 'en' : 'zh'; writeLanguage(next); setLanguageState(next); }, []);
  useEffect(() => {
    document.documentElement.lang = language === 'en' ? 'en' : 'zh-CN';
    document.title = translate(language, 'document.title');
    document.querySelector('meta[name="description"]')?.setAttribute('content', translate(language, 'document.description'));
  }, [language]);
  useEffect(() => {
    const sync = event => { if (event.key === LANGUAGE_STORAGE_KEY) setLanguageState(event.newValue === 'en' ? 'en' : 'zh'); };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);
  const t = useCallback((key, params) => translate(languageRef.current, key, params), []);
  const errorMessage = useCallback(error => localizeError(languageRef.current, error), []);
  const value = useMemo(() => ({ language, setLanguage, t, errorMessage }), [errorMessage, language, setLanguage, t]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const value = useContext(LanguageContext);
  if (!value) throw new Error('useLanguage must be used inside LanguageProvider');
  return value;
}
