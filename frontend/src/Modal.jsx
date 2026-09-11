import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { useLanguage } from './i18n/LanguageContext.jsx';
export default function Modal({ title, children, onClose, wide = false }) {
  const { t } = useLanguage();
  const ref = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const dialog = ref.current;
    dialog.showModal();
    const cancel = event => { event.preventDefault(); closeRef.current(); };
    dialog.addEventListener('cancel', cancel);
    return () => { dialog.removeEventListener('cancel', cancel); dialog.close(); };
  }, []);
  return <dialog ref={ref} className={`modal ${wide ? 'wide' : ''}`} aria-labelledby="dialog-title"><div className="modal-heading"><h2 id="dialog-title">{title}</h2><button className="icon-button" onClick={onClose} aria-label={t('common.close')}><X size={20} /></button></div><div className="modal-body">{children}</div></dialog>;
}
