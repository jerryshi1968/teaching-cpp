import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Braces, ChevronDown, ChevronRight, Copy, Download, ExternalLink, FileCode2, Folder, GripVertical, GraduationCap, LogIn, MoveRight, Pencil, Play, Plus, RefreshCw, Save, Send, Settings2, Sparkles, Square, Trash2, User, Users, X, Check, AlertTriangle, Clock3, ArrowLeft, ArrowUp, ArrowDown } from 'lucide-react';
import { ProjectOrganizer } from '@tigao/organizer-react';
import { ACTIVE_STATES } from '../../shared/contracts.mjs';
import { api, configureApi, configureApiLanguage, downloadCode, readLocal, storeLocal } from './api.mjs';
import CodeEditor from './CodeEditor.jsx';
import Modal from './Modal.jsx';
import { createLatestRequestCommitter } from './latest-request.mjs';
import { chooseOrganizerClassId, chooseOrganizerStudentId, normalizeOrganizerId, readOrganizerFolderId, readOrganizerSelection, saveOrganizerClassId, saveOrganizerFolderId, saveOrganizerStudentId } from './organizer-state.mjs';
import { createCppProjectOrganizerAdapter } from './project-organizer-adapter.mjs';
import { getExampleCopy, getOrganizerMessages, getProfileName, getStateLabel, localizeServerMessage } from './i18n.mjs';
import { useLanguage } from './i18n/LanguageContext.jsx';
import LanguageSelect from './i18n/LanguageSelect.jsx';

const emptyWorkspace = { groups: [], projects: [], owner: null, readOnly: false };
const sourceOf = value => ({ code: value.code, stdin: value.stdin, profileId: value.profileId });
const sameSource = (a, b) => !!a && !!b && JSON.stringify(sourceOf(a)) === JSON.stringify(sourceOf(b));
const when = (value, language) => value ? new Date(value).toLocaleTimeString(language === 'en' ? 'en-US' : 'zh-CN', { hour: '2-digit', minute: '2-digit' }) : '';
const organizerIcons = {
  group: props => <Folder size={20} {...props} />, project: props => <Sparkles size={18} {...props} />, drag: props => <GripVertical size={24} {...props} />, up: props => <ArrowUp size={24} {...props} />, down: props => <ArrowDown size={24} {...props} />, rename: props => <Pencil size={24} {...props} />, move: props => <MoveRight size={24} {...props} />, delete: props => <Trash2 size={24} {...props} />
};

export default function App() {
  const { language, t, errorMessage } = useLanguage();
  const organizerMessages = useMemo(() => getOrganizerMessages(language), [language]);
  const [config, setConfig] = useState(null);
  const [user, setUser] = useState(null);
  const [sessionError, setSessionError] = useState(null);
  const [demoUser, setDemoUser] = useState(() => readLocal('cpp:demo-user', 1));
  const [workspace, setWorkspace] = useState(emptyWorkspace);
  const [targetStudent, setTargetStudent] = useState(null);
  const [workspaceView, setWorkspaceView] = useState('organizer');
  const [project, setProject] = useState(null);
  const [loadingProject, setLoadingProject] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState('saved');
  const [draft, setDraft] = useState(null);
  const [conflict, setConflict] = useState(false);
  const [run, setRun] = useState(null);
  const [runs, setRuns] = useState([]);
  const [activeRun, setActiveRun] = useState(null);
  const [resultTab, setResultTab] = useState('stdout');
  const [runBusy, setRunBusy] = useState(false);
  const [modal, setModal] = useState(null);
  const [notice, setNotice] = useState(null);
  const [classes, setClasses] = useState([]);
  const [students, setStudents] = useState([]);
  const [classId, setClassId] = useState('');
  const [folderId, setFolderId] = useState(null);
  const [organizerSelectionReady, setOrganizerSelectionReady] = useState(false);
  const [organizerRevision, setOrganizerRevision] = useState(0);
  const [aiOpen, setAiOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [fontSize, setFontSize] = useState(() => readLocal('cpp:font-size', 15));
  const [resultWidth, setResultWidth] = useState(() => readLocal('cpp:result-width', 340));
  const [cursor, setCursor] = useState({ line: 1, column: 1 });
  const projectRef = useRef(null);
  const savedRef = useRef(null);
  const userRef = useRef(null);
  const savePromise = useRef(null);
  const loadSerial = useRef(0);
  const editorRef = useRef(null);
  const runAttempt = useRef(null);
  const runBusyRef = useRef(false);
  const selectedRunRef = useRef(null);
  const workspaceCommitterRef = useRef(null);
  if (!workspaceCommitterRef.current) workspaceCommitterRef.current = createLatestRequestCommitter();
  const toast = useCallback((message, type = 'info') => setNotice({ message, type }), []);
  const draftKey = useCallback(projectId => `cpp:draft:${userRef.current?.id}:${projectId}`, []);
  useEffect(() => { configureApiLanguage(language); }, [language]);

  const refreshSession = useCallback(async () => {
    try {
      const cfg = await api('/config');
      configureApi(cfg, demoUser);
      setConfig(cfg);
      const current = await api('/me');
      const userChanged = String(userRef.current?.id ?? '') !== String(current.id);
      userRef.current = current;
      if (userChanged) { setOrganizerSelectionReady(false); setTargetStudent(null); setFolderId(readOrganizerFolderId(current.id, null) ?? null); setClassId(''); }
      setUser(current);
      setSessionError(null);
    } catch (error) {
      setSessionError(error);
      if (error.status === 401) { userRef.current = null; setUser(null); }
    }
  }, [demoUser]);
  useEffect(() => { refreshSession(); }, [refreshSession]);
  useEffect(() => {
    const focus = () => { if (config?.mode !== 'demo') refreshSession(); };
    const storage = event => { if (event.key === 'teaching_token') focus(); };
    window.addEventListener('focus', focus); window.addEventListener('storage', storage);
    return () => { window.removeEventListener('focus', focus); window.removeEventListener('storage', storage); };
  }, [config?.mode, refreshSession]);
  useEffect(() => {
    if (!notice || notice.type === 'error') return;
    const timer = setTimeout(() => setNotice(null), 6000); return () => clearTimeout(timer);
  }, [notice]);

  const refreshWorkspace = useCallback(async (studentId = targetStudent) => {
    return workspaceCommitterRef.current(
      () => api(`/workspace${studentId ? `?studentId=${studentId}` : ''}`),
      setWorkspace
    );
  }, [targetStudent]);

  const openProject = useCallback(async projectId => {
    const serial = ++loadSerial.current;
    setLoadingProject(true); setDraft(null); setConflict(false); setSettingsOpen(false);
    try {
      const [data, history] = await Promise.all([api(`/projects/${projectId}`), api(`/projects/${projectId}/runs`)]);
      const selected = history.find(item => ACTIVE_STATES.includes(item.state)) || history[0];
      const result = selected ? await api(`/runs/${selected.id}`).catch(error => { if (error.status === 404) return null; throw error; }) : null;
      if (serial !== loadSerial.current) return;
      projectRef.current = data; savedRef.current = data;
      setProject(data); setDirty(false); setSaveState('saved'); setRuns(history);
      const current = history.find(item => ACTIVE_STATES.includes(item.state));
      setActiveRun(current || null); setRun(result);
      selectedRunRef.current = current?.id || history[0]?.id || null;
      setResultTab('stdout');
      const local = readLocal(draftKey(projectId));
      if (!data.readOnly && local && !sameSource(local, data)) setDraft(local);
      storeLocal(`cpp:last-project:${userRef.current.id}`, projectId);
      setWorkspaceView('editor');
    } catch (error) { toast(errorMessage(error), 'error'); }
    finally { if (serial === loadSerial.current) setLoadingProject(false); }
  }, [draftKey, errorMessage, toast]);

  const refreshAfterOrganizerMutation = useCallback(async (path, options) => {
    try {
      const deletedProject = options.method === 'DELETE' ? /^\/projects\/([^/]+)$/.exec(path) : null;
      if (deletedProject) storeLocal(draftKey(decodeURIComponent(deletedProject[1])), null);
      const data = await refreshWorkspace();
      if (!data) return;
      const current = projectRef.current;
      if (!current) return;
      const summary = data.projects.find(item => item.id === current.id);
      if (summary) {
        const next = { ...current, name: summary.name, parent_id: summary.parent_id };
        projectRef.current = next; setProject(next);
      } else if (options.method === 'DELETE' && path === `/projects/${encodeURIComponent(current.id)}`) {
        projectRef.current = null; savedRef.current = null; setProject(null); setRun(null); setRuns([]); setDirty(false);
      }
    } catch (error) { toast(errorMessage(error), 'error'); }
  }, [draftKey, errorMessage, refreshWorkspace, toast]);
  const organizerRequest = useCallback(async (path, options = {}) => {
    const result = await api(path, options);
    if (options.method && /^\/(?:projects|groups)(?:\/|$)/.test(path)) void refreshAfterOrganizerMutation(path, options);
    return result;
  }, [refreshAfterOrganizerMutation]);
  const organizerAdapter = useMemo(() => createCppProjectOrganizerAdapter({ request: organizerRequest, openProject, writable: Boolean(config?.writesEnabled) }), [config?.writesEnabled, openProject, organizerRequest]);
  const organizerError = useCallback(error => { if (folderId !== null && (error?.status === 404 || error?.code === 'INVALID_GROUP_TREE')) setFolderId(null); toast(errorMessage(error), 'error'); }, [errorMessage, folderId, toast]);
  const selectProjectOwner = useCallback(studentId => {
    if (!user) return;
    const nextStudent = normalizeOrganizerId(studentId);
    saveOrganizerFolderId(user.id, targetStudent, folderId);
    saveOrganizerStudentId(user.id, nextStudent);
    setTargetStudent(nextStudent);
    setFolderId(readOrganizerFolderId(user.id, nextStudent) ?? null);
  }, [folderId, targetStudent, user?.id]);
  const changeClass = useCallback(nextClassId => {
    if (!user) return;
    saveOrganizerFolderId(user.id, targetStudent, folderId);
    saveOrganizerClassId(user.id, nextClassId);
    saveOrganizerStudentId(user.id, null);
    setOrganizerSelectionReady(false); setClassId(nextClassId); setTargetStudent(null); setFolderId(readOrganizerFolderId(user.id, null) ?? null);
  }, [folderId, targetStudent, user?.id]);

  useEffect(() => {
    if (!user) return;
    ++loadSerial.current; projectRef.current = null; savedRef.current = null; setProject(null); setWorkspace(emptyWorkspace);
    setWorkspaceView('organizer');
    setRun(null); setActiveRun(null); setRuns([]); setDirty(false); setDraft(null); setConflict(false);
    refreshWorkspace().catch(error => toast(errorMessage(error), 'error'));
  }, [user?.id, user?.role, targetStudent, errorMessage]);

  useEffect(() => {
    if (!user) return;
    if (!['teacher', 'admin'].includes(user.role)) {
      setClasses([]); setClassId(''); setStudents([]); setTargetStudent(null); setFolderId(readOrganizerFolderId(user.id, null) ?? null); setOrganizerSelectionReady(true);
      return;
    }
    let alive = true; setOrganizerSelectionReady(false);
    api('/classes').then(data => {
      if (!alive) return;
      const saved = readOrganizerSelection(user.id);
      const nextClassId = chooseOrganizerClassId(data, saved.classId);
      setClasses(data); setClassId(nextClassId === null ? '' : String(nextClassId)); saveOrganizerClassId(user.id, nextClassId);
      if (!nextClassId) { setStudents([]); saveOrganizerStudentId(user.id, null); setTargetStudent(null); setFolderId(readOrganizerFolderId(user.id, null) ?? null); setOrganizerSelectionReady(true); }
    }).catch(error => {
      if (!alive) return;
      setClasses([]); setClassId(''); setStudents([]); setTargetStudent(null); setFolderId(readOrganizerFolderId(user.id, null) ?? null); setOrganizerSelectionReady(true); toast(errorMessage(error), 'error');
    });
    return () => { alive = false; };
  }, [user?.id, user?.role, errorMessage, toast]);

  useEffect(() => {
    if (!classId || !user || !['teacher', 'admin'].includes(user.role)) { setStudents([]); return; }
    let alive = true; setStudents([]); setOrganizerSelectionReady(false);
    api(`/classes/${classId}/students`).then(data => {
      if (!alive) return;
      const savedStudentId = readOrganizerSelection(user.id).studentId;
      const nextStudent = chooseOrganizerStudentId(data, savedStudentId);
      setStudents(data); saveOrganizerStudentId(user.id, nextStudent); setTargetStudent(nextStudent); setFolderId(readOrganizerFolderId(user.id, nextStudent) ?? null); setOrganizerSelectionReady(true);
    }).catch(error => {
      if (!alive) return;
      setStudents([]); setTargetStudent(null); setFolderId(readOrganizerFolderId(user.id, null) ?? null); setOrganizerSelectionReady(true); toast(errorMessage(error), 'error');
    });
    return () => { alive = false; };
  }, [classId, user?.id, user?.role, errorMessage, toast]);

  useEffect(() => {
    if (!organizerSelectionReady || !user) return;
    saveOrganizerFolderId(user.id, targetStudent, folderId);
  }, [folderId, organizerSelectionReady, targetStudent, user?.id]);

  const edit = useCallback(changes => {
    const current = projectRef.current;
    if (!current || current.readOnly) return;
    const next = { ...current, ...changes };
    projectRef.current = next; setProject(next);
    const changed = !sameSource(next, savedRef.current);
    setDirty(changed); setSaveState(changed ? 'dirty' : 'saved');
    if (!storeLocal(draftKey(next.id), changed ? { ...sourceOf(next), version: next.version, savedAt: Date.now() } : null)) toast(t('notice.draftStorage'), 'error');
  }, [draftKey, t, toast]);

  const save = useCallback(async (runAfter = false) => {
    if (savePromise.current) await savePromise.current;
    const current = projectRef.current;
    if (!current || current.readOnly || !config?.writesEnabled) return null;
    if (conflict || draft) { toast(t('notice.resolveBeforeSave'), 'error'); return null; }
    const body = { ...sourceOf(current), version: current.version };
    if (runAfter) {
      const fingerprint = JSON.stringify({ projectId: current.id, ...body });
      if (!runAttempt.current || runAttempt.current.fingerprint !== fingerprint) runAttempt.current = { fingerprint, requestId: crypto.randomUUID() };
      body.requestId = runAttempt.current.requestId;
    }
    setSaveState('saving');
    const applySaved = data => {
      if (projectRef.current?.id !== current.id) return;
      const next = { ...projectRef.current, version: data.version, revisionId: data.revisionId };
      savedRef.current = { ...current, version: data.version, revisionId: data.revisionId };
      projectRef.current = next; setProject(next);
      const changed = !sameSource(next, savedRef.current);
      setDirty(changed); setSaveState(changed ? 'dirty' : 'saved');
      storeLocal(draftKey(current.id), changed ? { ...sourceOf(next), version: data.version, savedAt: Date.now() } : null);
    };
    const operation = (async () => {
      try {
        const data = await api(`/projects/${current.id}/${runAfter ? 'run' : 'source'}`, { method: runAfter ? 'POST' : 'PUT', body });
        applySaved(data);
        if (runAfter) {
          runAttempt.current = null;
          if (projectRef.current?.id === current.id) { setRun(data); selectedRunRef.current = data.id; setActiveRun(ACTIVE_STATES.includes(data.state) ? data : null); setResultTab('stdout'); }
        }
        return data;
      } catch (error) {
        if (error.saved && error.version) applySaved(error);
        else if (projectRef.current?.id === current.id) setSaveState('error');
        if (error.code === 'VERSION_CONFLICT' && projectRef.current?.id === current.id) setConflict(true);
        if (error.code === 'RUN_ACTIVE' && error.runId) api(`/runs/${error.runId}`).then(data => { if (projectRef.current?.id === data.project_id) { setActiveRun(data); setRun(data); selectedRunRef.current = data.id; } }).catch(() => {});
        toast(errorMessage(error), 'error');
        return null;
      }
    })();
    savePromise.current = operation;
    try { return await operation; } finally { if (savePromise.current === operation) savePromise.current = null; }
  }, [config?.writesEnabled, conflict, draft, draftKey, errorMessage, t, toast]);

  useEffect(() => {
    if (!dirty || conflict || draft || saveState === 'error' || project?.readOnly || !config?.writesEnabled) return;
    const timer = setTimeout(() => save(), 1800);
    return () => clearTimeout(timer);
  }, [project?.code, project?.stdin, project?.profileId, dirty, conflict, draft, config?.writesEnabled, saveState, save]);
  useEffect(() => {
    const leave = event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', leave); return () => window.removeEventListener('beforeunload', leave);
  }, [dirty]);

  const runCode = useCallback(async () => {
    if (runBusyRef.current || activeRun || loadingProject) return;
    runBusyRef.current = true; setRunBusy(true);
    try { await save(true); } finally { runBusyRef.current = false; setRunBusy(false); }
  }, [activeRun, loadingProject, save]);
  const stopRun = async () => {
    if (!activeRun) return;
    try { const data = await api(`/runs/${activeRun.id}/stop`, { method: 'POST', body: {} }); setActiveRun(ACTIVE_STATES.includes(data.state) ? data : null); setRun(data); selectedRunRef.current = data.id; }
    catch (error) { toast(errorMessage(error), 'error'); }
  };
  useEffect(() => {
    if (!activeRun?.id) return;
    let alive = true; let busy = false;
    const poll = async () => {
      if (busy) return; busy = true;
      try {
        const data = await api(`/runs/${activeRun.id}`);
        if (!alive) return;
        if (selectedRunRef.current === data.id) setRun(data);
        if (!ACTIVE_STATES.includes(data.state)) {
          const history = await api(`/projects/${data.project_id}/runs`);
          if (!alive) return;
          setRuns(history); setActiveRun(null);
          if (data.state === 'compile_error') setResultTab('compiler_output');
          else if (['runtime_error', 'system_error'].includes(data.state)) setResultTab('stderr');
        } else setActiveRun(data);
      } catch (error) {
        if (alive && [401, 403, 404].includes(error.status)) { setActiveRun(null); toast(errorMessage(error), 'error'); }
      } finally { busy = false; }
    };
    poll(); const timer = setInterval(poll, 1500);
    return () => { alive = false; clearInterval(timer); };
  }, [activeRun?.id, errorMessage, toast]);

  const executeModal = async values => {
    try {
      if (modal.type === 'create') {
        const data = await organizerAdapter.createProject({ name: values.name, templateId: values.exampleId || undefined, parentId: folderId });
        await organizerAdapter.openProject(data.id);
      } else if (modal.type === 'group') { await organizerAdapter.createGroup({ name: values.name, parentId: folderId }); setOrganizerRevision(value => value + 1); }
      else if (modal.type === 'project-settings') {
        await api(`/projects/${modal.item.id}`, { method: 'PATCH', body: { name: values.name, parentId: values.parentId || null } });
        if (projectRef.current?.id === modal.item.id) { projectRef.current = { ...projectRef.current, name: values.name, parent_id: values.parentId || null }; setProject(projectRef.current); }
        await refreshWorkspace();
      } else if (modal.type === 'group-settings') { await api(`/groups/${modal.item.id}`, { method: 'PATCH', body: { name: values.name, parentId: values.parentId || null } }); await refreshWorkspace(); }
      else if (modal.type === 'delete-project') {
        await api(`/projects/${modal.item.id}`, { method: 'DELETE' }); storeLocal(draftKey(modal.item.id), null);
        const data = await refreshWorkspace();
        if (data && projectRef.current?.id === modal.item.id) { projectRef.current = null; setProject(null); setRun(null); setRuns([]); setDirty(false); if (data.projects[0]) await openProject(data.projects[0].id); }
      } else if (modal.type === 'delete-group') { await api(`/groups/${modal.item.id}`, { method: 'DELETE' }); if (folderId === modal.item.id) setFolderId(null); await refreshWorkspace(); }
      else if (modal.type === 'distribute') {
        if (!modal.fromOrganizer) { const saved = await save(); if (!saved) return false; }
        const data = await api(`/projects/${modal.item.id}/distribute`, { method: 'POST', body: { classId: values.classId, requestId: modal.requestId } });
        toast(t('notice.distributed', { count: data.recipients_json.length }), 'success');
      } else if (modal.type === 'reload') { storeLocal(draftKey(project.id), null); await openProject(project.id); }
      else if (modal.type === 'discard-draft') { storeLocal(draftKey(project.id), null); setDraft(null); }
      setModal(null); return true;
    } catch (error) { toast(errorMessage(error), 'error'); return false; }
  };
  const copyProject = async () => {
    try {
      if (!project.readOnly && dirty && !await save()) return;
      const data = await api(`/projects/${project.id}/copy`, { method: 'POST', body: {} });
      if (targetStudent) { selectProjectOwner(null); storeLocal(`cpp:last-project:${user.id}`, data.id); }
      else { await refreshWorkspace(); await openProject(data.id); }
      toast(t('notice.copied'), 'success');
    } catch (error) { toast(errorMessage(error), 'error'); }
  };
  const viewSnapshot = async () => {
    try { const data = await api(`/runs/${run.id}/source`); setModal({ type: 'snapshot', data }); } catch (error) { toast(errorMessage(error), 'error'); }
  };
  const selectHistory = async item => {
    selectedRunRef.current = item.id;
    try {
      const data = await api(`/runs/${item.id}`);
      if (selectedRunRef.current === item.id && projectRef.current?.id === data.project_id) { setRun(data); setResultTab('stdout'); }
    } catch (error) { toast(errorMessage(error), 'error'); }
  };

  if (!config) return <main className="connection-page"><div className="connection-language"><LanguageSelect /></div><div className="brand-mark"><Braces /></div><h1>{t('connection.product')}</h1><p>{sessionError ? errorMessage(sessionError) : t('connection.connecting')}</p>{sessionError && <button onClick={refreshSession}><RefreshCw size={16} />{t('connection.reconnect')}</button>}</main>;
  if (!user) return <main className="connection-page"><div className="connection-language"><LanguageSelect /></div><div className="brand-mark"><Braces /></div><div className="eyebrow">{t('connection.eyebrow')}</div><h1>{t('connection.title')}</h1><p className="connection-copy">{t('connection.copy')}</p><a className="button primary" href={config.commonLogin} target="_blank" rel="noopener noreferrer"><LogIn size={17} />{t('connection.login')}</a><p className="muted">{t('connection.returnHint')}</p><button onClick={refreshSession}><RefreshCw size={16} />{t('connection.verify')}</button>{sessionError && <p className="error-text">{errorMessage(sessionError)}</p>}</main>;

  const isTeacher = ['teacher', 'admin'].includes(user.role);
  const readOnly = project?.readOnly || !config.writesEnabled;
  const changedSinceRun = run && project && (run.revision_id !== project.revisionId || dirty);

  return <div className="app-shell">
    <header className={`topbar${workspaceView === 'organizer' ? ' organizer-topbar' : ''}`}>
      <a href="/teaching-cpp/" className="brand"><span className="brand-mark"><Braces size={24} /></span><span><strong>{t('brand.name')}</strong></span></a>
      <div className="topbar-right"><LanguageSelect /><a className="platform-link" href={config.commonDashboard} target="_blank" rel="noopener noreferrer">{t('platform.link')}<ExternalLink size={13} /></a><span className="avatar">{user.username.slice(0, 1)}</span>{config.mode === 'demo' ? <select className="account-select" aria-label={t('demo.identity')} value={demoUser} onChange={event => { const value = Number(event.target.value); storeLocal('cpp:demo-user', value); setOrganizerSelectionReady(false); setTargetStudent(null); setFolderId(null); setDemoUser(value); }}><option value="1">{t('demo.teacher')}</option><option value="2">{t('demo.studentLin')}</option><option value="3">{t('demo.studentChen')}</option></select> : <span className="user-name">{user.username}<small>{isTeacher ? t('role.teacher') : t('role.student')}</small></span>}</div>
    </header>
    {config.mode === 'demo' && <div className="environment-banner"><span className="demo-dot" />{t('banner.demo')}</div>}
    {!config.writesEnabled && <div className="warning-banner"><AlertTriangle size={16} />{t('banner.writesDisabled')}</div>}
    {sessionError && <div className="warning-banner">{errorMessage(sessionError)}<button onClick={refreshSession}>{t('common.retrySession')}</button></div>}
    {notice && <div className={`toast ${notice.type}`} role={notice.type === 'error' ? 'alert' : 'status'}>{notice.type === 'error' ? <AlertTriangle size={17} /> : <Check size={17} />}<span>{notice.message}</span><button className="icon-button" aria-label={t('common.closeNotice')} onClick={() => setNotice(null)}><X size={16} /></button></div>}

    {workspaceView === 'organizer' ? <main className="organizer-page">
      <div className="organizer-page__inner">
        {isTeacher && <section className="organizer-teacher-panel">
          <div className="organizer-teacher-panel__heading"><h2><User size={18} /><span>{t('teacher.board')}</span></h2><label><span>{t('teacher.class')}</span><select value={classId} disabled={!classes.length} onChange={event => changeClass(event.target.value)}>{classes.length ? classes.map(item => <option key={item.id} value={item.id}>{item.name}</option>) : <option value="">{t('teacher.noClasses')}</option>}</select></label></div>
          {classes.length ? <div className="organizer-student-picker"><p>{t('teacher.currentClass')}<strong>{classes.find(item => String(item.id) === classId)?.name || t('teacher.classUnselected')}</strong></p><div><button className={targetStudent == null ? 'selected' : ''} onClick={() => selectProjectOwner(null)}>{t('teacher.me')}</button>{students.map(student => <button className={String(targetStudent) === String(student.id) ? 'selected' : ''} key={student.id} onClick={() => selectProjectOwner(student.id)}>👤 {student.username}</button>)}</div>{!students.length && <p>{t('teacher.noStudents')}</p>}</div> : <p className="organizer-teacher-empty">{t('teacher.noBindings')}</p>}
        </section>}
        <section className="organizer-showcase">
          <div className="organizer-showcase__heading">
            <div><h1><span>{targetStudent ? t('studio.supervising', { name: workspace.owner?.username || t('studio.studentFallback') }) : t('studio.mine')}</span> <Sparkles size={24} /></h1><p>{targetStudent ? t('studio.supervisingCopy') : t('studio.mineCopy')}</p></div>
            {!targetStudent && !workspace.readOnly && <div className="organizer-create-actions"><button className="organizer-create-group" disabled={!config.writesEnabled} onClick={() => setModal({ type: 'group' })}><Folder size={19} />{t('studio.createGroup')}</button><button className="organizer-create-project" disabled={!config.writesEnabled} onClick={() => setModal({ type: 'create' })}><Plus size={20} />{t('studio.createProject')}</button></div>}
          </div>
          <ProjectOrganizer key={`${targetStudent ?? 'me'}:${organizerRevision}`} adapter={organizerAdapter} ownerId={targetStudent} currentParentId={folderId} onCurrentParentIdChange={setFolderId} messages={organizerMessages} icons={organizerIcons} onError={organizerError} renderProjectExtraActions={item => <>{isTeacher && !targetStudent && <button type="button" className="tigao-organizer__icon-button organizer-distribute-button" aria-label={t('studio.distributeLabel', { name: item.name })} title={classId ? t('studio.distributeTitle') : t('studio.selectClassFirst')} disabled={!classId || !config.writesEnabled} onClick={() => setModal({ type: 'distribute', item, requestId: crypto.randomUUID(), fromOrganizer: true })}><Send size={24} /></button>}<span className="organizer-language-badge">{t('studio.badge')}</span></>} />
        </section>
      </div>
    </main> : <div className="workspace-layout editor-layout">
      <main className="main-workspace">
        {project ? <><div className="workspace-heading"><button className="editor-back-button" onClick={() => { setFolderId(project.parent_id || null); setWorkspaceView('organizer'); }}><ArrowLeft size={15} />{t('editor.back')}</button><div className="project-title"><div className="breadcrumb">{workspace.readOnly ? t('editor.studentPractice') : t('editor.myPractice')}<ChevronRight size={12} />{workspace.groups.find(group => group.id === project.parent_id)?.name || t('editor.ungrouped')}</div><h1>{project.name}{project.readOnly && <span className="pill readonly-pill">{t('editor.readOnly')}</span>}</h1></div><div className="project-tools"><button className="icon-button" aria-label={t('editor.download')} title={t('editor.download')} onClick={() => downloadCode(project.code)}><Download size={18} /></button><button className="icon-button" aria-label={t('editor.copy')} title={t('editor.copyTitle')} onClick={copyProject}><Copy size={17} /></button>{isTeacher && !project.readOnly && <button className="distribute-button" disabled={!classes.length || !config.writesEnabled} onClick={() => setModal({ type: 'distribute', item: project, requestId: crypto.randomUUID() })}><Users size={15} />{t('editor.distribute')}</button>}</div></div>
        {draft && <div className="draft-banner"><AlertTriangle size={16} /><span>{t('editor.draftFound', { date: new Date(draft.savedAt).toLocaleString(language === 'en' ? 'en-US' : 'zh-CN') })}</span><button onClick={() => { const mismatch = draft.version !== project.version; const restored = { ...project, ...sourceOf(draft) }; projectRef.current = restored; setProject(restored); setDirty(true); setDraft(null); setConflict(mismatch); setSaveState(mismatch ? 'error' : 'dirty'); }}>{t('editor.restoreDraft')}</button><button onClick={() => setModal({ type: 'discard-draft' })}>{t('editor.keepServer')}</button></div>}
        {conflict && <div className="draft-banner"><AlertTriangle size={16} /><span>{t('editor.conflict')}</span><button onClick={() => downloadCode(project.code, 'main-local-draft.cpp')}>{t('editor.downloadLocal')}</button><button onClick={() => setModal({ type: 'reload' })}>{t('editor.reload')}</button></div>}
        {project.readOnly && <div className="readonly-banner"><GraduationCap size={16} />{t('editor.readOnlyCopy', { name: project.ownerName })}<button onClick={copyProject}>{t('editor.copyToMine')}</button></div>}
        <div className="editor-toolbar"><div className="file-tab"><FileCode2 size={16} /><span>main.cpp</span>{dirty && <span className="unsaved-dot" />}</div><span className={`save-indicator ${saveState === 'error' ? 'error-text' : ''}`}>{saveState === 'saving' ? t('editor.saving') : saveState === 'error' ? t('editor.saveUnconfirmed') : dirty ? t('editor.pendingSave') : t('editor.saved')}</span><div className="toolbar-actions"><button className="icon-button" aria-label={t('editor.settings')} onClick={() => setSettingsOpen(!settingsOpen)}><Settings2 size={17} /></button><button className="save-button" disabled={readOnly || saveState === 'saving' || loadingProject} onClick={() => save()}><Save size={15} /><span>{t('editor.save')}</span></button><button className="primary run-button" disabled={readOnly || !!activeRun || runBusy || loadingProject || !!draft || conflict} onClick={runCode}><Play size={15} fill="currentColor" />{runBusy ? t('editor.submitting') : t('editor.saveAndRun')}<kbd>Ctrl ↵</kbd></button><button className="icon-button stop-button" aria-label={t('editor.stop')} disabled={!activeRun || readOnly || activeRun.state === 'stopping'} onClick={stopRun}><Square size={15} fill="currentColor" /></button></div></div>
        {settingsOpen && <div className="editor-settings"><label>{t('editor.fontSize')}<select value={fontSize} onChange={event => { setFontSize(Number(event.target.value)); storeLocal('cpp:font-size', Number(event.target.value)); }}>{[13, 14, 15, 16, 18, 20, 22].map(size => <option key={size}>{size}</option>)}</select></label><label>{t('editor.resultWidth')}<input aria-label={t('editor.resultWidth')} type="range" min="280" max="520" step="20" value={resultWidth} onChange={event => { setResultWidth(Number(event.target.value)); storeLocal('cpp:result-width', Number(event.target.value)); }} /></label></div>}
        <div className="coding-surface" style={{ '--result-width': `${resultWidth}px` }}><section className="code-pane" aria-label={t('editor.codeRegion')}>{loadingProject && <div className="loading-overlay">{t('editor.opening')}</div>}<CodeEditor value={project.code} onChange={code => edit({ code })} readOnly={!!readOnly || loadingProject} fontSize={fontSize} onSave={save} onRun={runCode} editorRef={editorRef} onCursor={setCursor} /><div className="code-status"><span>C++ · UTF-8</span><span>{t('editor.cursor', cursor)}</span><span>{t('editor.version', { version: project.version })}</span></div></section><aside className="execution-pane"><section className="input-panel"><div className="panel-heading"><h2>{t('input.title')}</h2><span>{t('input.standard')}</span></div><textarea aria-label={t('input.title')} spellCheck="false" placeholder={t('input.placeholder')} value={project.stdin} readOnly={!!readOnly} onChange={event => edit({ stdin: event.target.value })} /><div className="input-hint">{t('input.hint')}</div></section><section className="result-panel"><div className="panel-heading"><h2>{t('result.title')}</h2><span className={`run-state ${run?.state || ''}`}>{run ? getStateLabel(language, run.state) : t('result.waiting')}</span></div><div className="result-tabs" role="tablist" aria-label={t('result.types')}>{[['stdout', t('result.stdout')], ['stderr', t('result.stderr')], ['compiler_output', t('result.compiler')], ['history', t('result.history')]].map(([value, label]) => <button role="tab" aria-selected={resultTab === value} className={resultTab === value ? 'selected' : ''} key={value} onClick={() => setResultTab(value)}>{label}{value === 'compiler_output' && run?.diagnostics?.length > 0 && <span>{run.diagnostics.length}</span>}</button>)}</div>{run && <div className="run-meta"><span>{t('editor.version', { version: run.version })} · {when(run.created_at, language)}</span><span>{run.elapsed_ms == null ? t('result.elapsedEmpty') : t('result.elapsed', { value: run.elapsed_ms })}</span><span>{run.memory_bytes == null ? t('result.memoryEmpty') : t('result.memory', { value: (run.memory_bytes / 1048576).toFixed(1) })}</span></div>}{changedSinceRun && <div className="version-note">{t('result.changed')}</div>}{activeRun && <div className="active-note"><Clock3 size={14} />{getStateLabel(language, activeRun.state)}{activeRun.queuePosition ? ` · ${t('result.queuePosition', { position: activeRun.queuePosition })}` : ''}{activeRun.message && <span>{localizeServerMessage(language, activeRun.message)}</span>}</div>}
          <div className="result-content">{resultTab === 'history' ? <>{runs.map(item => <button className={`history-item ${run?.id === item.id ? 'selected' : ''}`} key={item.id} onClick={() => selectHistory(item)}><span>{getStateLabel(language, item.state)}</span><small>v{item.version} · {when(item.created_at, language)}</small></button>)}{!runs.length && <p className="empty-copy">{t('result.noHistory')}</p>}</> : !run ? <div className="result-empty"><span className="terminal-symbol">&gt;_</span><h3>{t('result.ready')}</h3><p className="result-ready-copy">{t('result.readyCopy')}</p>{!config.runEnabled && <span className="pill">{t('result.runnerDisabled')}</span>}</div> : <>{resultTab === 'compiler_output' && run.diagnostics?.map((item, index) => <button disabled={!!changedSinceRun} className="diagnostic" key={index} onClick={() => { const view = editorRef.current; if (!view) return; const line = view.state.doc.line(Math.min(item.line, view.state.doc.lines)); view.dispatch({ selection: { anchor: Math.min(line.to, line.from + item.column - 1) }, scrollIntoView: true }); view.focus(); }}><span>{t('result.diagnosticLine', { severity: item.severity === 'warning' ? t('result.warning') : t('result.note'), line: item.line })}</span>{item.message}</button>)}<pre aria-live="polite">{run[resultTab] || (resultTab === 'stdout' && run.state === 'completed' ? t('result.noStdout') : t('result.noContent'))}</pre>{run.message && !ACTIVE_STATES.includes(run.state) && <p className="run-message">{localizeServerMessage(language, run.message)}</p>}</>}</div>{run && <button className="snapshot-button" onClick={viewSnapshot}>{t('result.snapshot')}<ChevronRight size={13} /></button>}<div className="result-disclaimer">{t('result.disclaimer')}</div></section></aside></div>
        <footer className="workspace-footer"><span><span className="status-dot" />{config.runEnabled ? t('footer.runnerEnabled') : t('footer.runnerDisabled')}</span><label>{t('footer.profile')}<select aria-label={t('footer.profile')} disabled={!!readOnly} value={project.profileId} onChange={event => edit({ profileId: event.target.value })}>{config.profiles.map(profile => <option key={profile.id} value={profile.id}>{getProfileName(language, profile)}</option>)}</select></label><button className={aiOpen ? 'ai-toggle selected' : 'ai-toggle'} onClick={() => setAiOpen(!aiOpen)}><Sparkles size={14} />{t('footer.ai')}<span>{t('footer.reserved')}</span></button></footer>{aiOpen && <div className="ai-placeholder"><Sparkles size={20} /><div><strong>{t('ai.title')}</strong><p>{t('ai.copy')}</p></div><button className="icon-button" aria-label={t('ai.collapse')} onClick={() => setAiOpen(false)}><X size={17} /></button></div>}</> : <div className="empty-workspace"><Braces size={46} /><div className="eyebrow">YOUR NEXT SMALL STEP</div><h1>{workspace.readOnly ? t('empty.studentTitle') : t('empty.mineTitle')}</h1><p>{workspace.readOnly ? t('empty.studentCopy') : t('empty.mineCopy')}</p>{!workspace.readOnly && <button className="primary" onClick={() => setModal({ type: 'create' })}><Sparkles size={16} />{t('empty.createFromExample')}</button>}</div>}
      </main>
    </div>}
    {modal && <ActionModal key={`${modal.type}:${modal.item?.id || ''}`} modal={modal} groups={workspace.groups} classes={classes} onClose={() => setModal(null)} onSubmit={executeModal} onDelete={type => setModal({ type, item: modal.item })} />}
  </div>;
}

function ActionModal({ modal, groups, classes, onClose, onSubmit, onDelete }) {
  const { language, t } = useLanguage();
  const [name, setName] = useState(modal.item?.name || (modal.type.includes('group') ? t('modal.newGroupName') : t('modal.newProjectName')));
  const [parentId, setParentId] = useState(modal.item?.parent_id || '');
  const [exampleId, setExampleId] = useState('hello');
  const [classId, setClassId] = useState(String(classes[0]?.id || ''));
  const [examples, setExamples] = useState([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (modal.type === 'create') api('/examples').then(setExamples).catch(() => {}); }, [modal.type]);
  const submit = async event => { event.preventDefault(); if (busy) return; setBusy(true); try { await onSubmit({ name, parentId, exampleId, classId }); } finally { setBusy(false); } };
  const titles = { create: t('modal.createProject'), group: t('modal.createGroup'), 'project-settings': t('modal.manageProject'), 'group-settings': t('modal.manageGroup'), 'delete-project': t('modal.deleteProjectTitle'), 'delete-group': t('modal.deleteGroupTitle'), distribute: t('modal.distributeTitle'), reload: t('modal.reloadTitle'), 'discard-draft': t('modal.discardDraftTitle'), snapshot: t('modal.snapshotTitle') };
  const confirmOnly = ['delete-project', 'delete-group', 'reload', 'discard-draft'].includes(modal.type);
  return <Modal title={titles[modal.type]} onClose={busy ? () => {} : onClose} wide={modal.type === 'snapshot'}>{modal.type === 'snapshot' ? <><p className="muted">{t('modal.snapshotMeta', { version: modal.data.version, profile: getProfileName(language, { id: modal.data.profileId, name: modal.data.profileId }) })}</p><div className="snapshot-editor"><CodeEditor value={modal.data.code} readOnly /></div><label className="form-label">{t('modal.snapshotInput')}<pre className="snapshot-input">{modal.data.stdin || t('modal.noInput')}</pre></label><div className="modal-actions"><button onClick={() => downloadCode(modal.data.code, `main-v${modal.data.version}.cpp`)}><Download size={15} />{t('modal.downloadVersion')}</button><button className="primary" onClick={onClose}>{t('common.close')}</button></div></> : <form onSubmit={submit}>{confirmOnly ? <p className="modal-copy">{modal.type === 'delete-project' ? t('modal.deleteProjectCopy') : modal.type === 'delete-group' ? t('modal.deleteGroupCopy') : t('modal.discardCopy')}</p> : modal.type === 'distribute' ? <><p className="modal-copy">{modal.fromOrganizer ? t('modal.distributeOrganizerCopy', { name: modal.item.name }) : t('modal.distributeEditorCopy', { name: modal.item.name })}</p><label className="form-label">{t('modal.selectClass')}<select required value={classId} onChange={event => setClassId(event.target.value)}>{classes.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><p className="muted">{t('modal.distributeRetry')}</p></> : <><label className="form-label">{modal.type.includes('group') ? t('modal.groupName') : t('modal.projectName')}<input required maxLength={100} autoFocus value={name} onChange={event => setName(event.target.value)} /></label>{modal.type.includes('settings') && <label className="form-label">{t('modal.parentGroup')}<select value={parentId} onChange={event => setParentId(event.target.value)}><option value="">{t('modal.rootGroup')}</option>{groups.filter(group => !(modal.type === 'group-settings' && group.id === modal.item.id)).map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>}{modal.type === 'create' && <><label className="form-label">{t('modal.fromExample')}</label><div className="example-grid">{examples.map(item => { const copy = getExampleCopy(language, item); return <button type="button" key={item.id} className={`example-card ${exampleId === item.id ? 'selected' : ''}`} onClick={() => { setExampleId(item.id); setName(copy.name); }}><FileCode2 size={20} /><strong>{copy.name}</strong><span>{copy.topic}</span><small>{copy.description}</small></button>; })}</div></>}</>}<div className="modal-actions">{modal.type.includes('settings') && <button type="button" className="danger-text" onClick={() => onDelete(modal.type === 'group-settings' ? 'delete-group' : 'delete-project')}><Trash2 size={15} />{t('common.delete')}</button>}<span className="spacer" /><button type="button" disabled={busy} onClick={onClose}>{t('common.cancel')}</button><button className={modal.type.startsWith('delete') ? 'danger' : 'primary'} disabled={busy}>{busy ? t('common.processing') : modal.type === 'distribute' ? t('modal.saveAndDistribute') : confirmOnly ? t('common.confirm') : t('common.ok')}</button></div></form>}</Modal>;
}
