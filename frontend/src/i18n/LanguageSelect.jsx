import React from 'react';
import { Languages } from 'lucide-react';
import { useLanguage } from './LanguageContext.jsx';

export default function LanguageSelect({ compact = false }) {
  const { language, setLanguage, t } = useLanguage();
  return <label className={`language-select${compact ? ' compact' : ''}`}><Languages size={15} /><span>{t('language.label')}</span><select aria-label={t('language.label')} value={language} onChange={event => setLanguage(event.target.value)}><option value="zh">{t('language.zh')}</option><option value="en">{t('language.en')}</option></select></label>;
}
