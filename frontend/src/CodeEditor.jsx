import React, { useMemo } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { cpp } from '@codemirror/lang-cpp';
import { EditorView, keymap } from '@codemirror/view';
import { useLanguage } from './i18n/LanguageContext.jsx';

export default function CodeEditor({ value, onChange, readOnly = false, fontSize = 15, onSave, onRun, editorRef, onCursor }) {
  const { t } = useLanguage();
  const extensions = useMemo(() => [cpp(), EditorView.lineWrapping, EditorView.theme({
    '&': { height: '100%', backgroundColor: '#17232c', color: '#e2e9ee', fontSize: `${fontSize}px` },
    '.cm-scroller': { fontFamily: '"Cascadia Code", Consolas, "SFMono-Regular", monospace', lineHeight: '1.8', overflow: 'auto' },
    '.cm-content': { padding: '18px 0', caretColor: '#8dd9bd' },
    '.cm-gutters': { backgroundColor: '#17232c', color: '#6c818f', border: 'none', paddingRight: '12px' },
    '.cm-activeLineGutter, .cm-activeLine': { backgroundColor: '#20313b' },
    '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor: '#315563 !important' },
    '.cm-cursor': { borderLeftColor: '#8dd9bd' },
    '&.cm-focused': { outline: 'none' }
  }, { dark: true }), keymap.of([
    { key: 'Mod-s', run: () => { onSave?.(); return true; } },
    { key: 'Mod-Enter', run: () => { onRun?.(); return true; } }
  ])], [fontSize, onSave, onRun]);
  return <CodeMirror value={value} height="100%" theme="dark" extensions={extensions} editable={!readOnly} readOnly={readOnly}
    basicSetup={{ lineNumbers: true, highlightActiveLine: true, bracketMatching: true, closeBrackets: true, foldGutter: true, autocompletion: false, tabSize: 4 }}
    onCreateEditor={view => { if (editorRef) editorRef.current = view; }}
    onChange={onChange} onUpdate={update => { if (update.selectionSet && onCursor) { const head = update.state.selection.main.head; const line = update.state.doc.lineAt(head); onCursor({ line: line.number, column: head - line.from + 1 }); } }}
    aria-label={readOnly ? t('editor.ariaReadOnly') : t('editor.aria')} />;
}
