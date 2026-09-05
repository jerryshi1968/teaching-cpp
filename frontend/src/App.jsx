import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Braces, ChevronDown, ChevronRight, Copy, Download, ExternalLink, FileCode2, Folder, GripVertical, GraduationCap, LogIn, MoveRight, Pencil, Play, Plus, RefreshCw, Save, Send, Settings2, Sparkles, Square, Trash2, User, Users, X, Check, AlertTriangle, Clock3, ArrowLeft, ArrowUp, ArrowDown } from 'lucide-react';
import { ProjectOrganizer } from '@tigao/organizer-react';
import { ACTIVE_STATES, STATE_LABELS } from '../../shared/contracts.mjs';
import { api, configureApi, downloadCode, readLocal, storeLocal } from './api.mjs';
import CodeEditor from './CodeEditor.jsx';
import Modal from './Modal.jsx';
import { createLatestRequestCommitter } from './latest-request.mjs';
import { createCppProjectOrganizerAdapter } from './project-organizer-adapter.mjs';

const emptyWorkspace = { groups: [], projects: [], owner: null, readOnly: false };
const sourceOf = value => ({ code: value.code, stdin: value.stdin, profileId: value.profileId });
const sameSource = (a, b) => !!a && !!b && JSON.stringify(sourceOf(a)) === JSON.stringify(sourceOf(b));
const when = value => value ? new Date(value).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '';
const organizerMessages = {
  title: '作品管理', root: '根作品组', groups: '作品组', projects: '作品', createGroup: '新建作品组', createProject: '新建作品', groupName: '作品组名称', projectName: '作品名称', open: '打开', rename: '重命名', move: '移动到', delete: '删除', moveUp: '向上排序', moveDown: '向下排序', drag: '拖放排序或移动', dropInside: '放入此作品组', loading: '正在召唤作品集，请稍候…', loadingTargets: '正在读取目标位置…', empty: '你的画板还是空空的哦！', readOnly: '当前是只读查看，不能修改作品。', saving: '正在保存变更…', retry: '重新读取', cancel: '取消', confirm: '确定', renameTitle: '重命名作品', moveTitle: '移动作品', deleteTitle: '删除作品', deleteQuestion: '确认删除这个作品？', chooseDestination: '选择目标作品组', structureBlocked: '作品组结构异常，已暂停编辑。', noDestinations: '没有可用的目标位置。'
};
const organizerIcons = {
  group: props => <Folder size={20} {...props} />, project: props => <Sparkles size={18} {...props} />, drag: props => <GripVertical size={20} {...props} />, up: props => <ArrowUp size={20} {...props} />, down: props => <ArrowDown size={20} {...props} />, rename: props => <Pencil size={20} {...props} />, move: props => <MoveRight size={20} {...props} />, delete: props => <Trash2 size={20} {...props} />
};

export default function App() {
  const [config, setConfig] = useState(null);
  const [user, setUser] = useState(null);
  const [sessionError, setSessionError] = useState('');
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

  const refreshSession = useCallback(async () => {
    try {
      const cfg = await api('/config');
      configureApi(cfg, demoUser);
      setConfig(cfg);
      const current = await api('/me');
      userRef.current = current;
      setUser(current);
      setSessionError('');
    } catch (error) {
      setSessionError(error.message);
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
    } catch (error) { toast(error.message, 'error'); }
    finally { if (serial === loadSerial.current) setLoadingProject(false); }
  }, [draftKey, toast]);

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
    } catch (error) { toast(error.message, 'error'); }
  }, [draftKey, refreshWorkspace, toast]);
  const organizerRequest = useCallback(async (path, options = {}) => {
    const result = await api(path, options);
    if (options.method && /^\/(?:projects|groups)(?:\/|$)/.test(path)) void refreshAfterOrganizerMutation(path, options);
    return result;
  }, [refreshAfterOrganizerMutation]);
  const organizerAdapter = useMemo(() => createCppProjectOrganizerAdapter({ request: organizerRequest, openProject, writable: Boolean(config?.writesEnabled) }), [config?.writesEnabled, openProject, organizerRequest]);
  const organizerError = useCallback(error => toast(error.message, 'error'), [toast]);

  useEffect(() => {
    if (!user) return;
    let alive = true;
    ++loadSerial.current; projectRef.current = null; savedRef.current = null; setProject(null); setWorkspace(emptyWorkspace);
    setWorkspaceView('organizer');
    setRun(null); setActiveRun(null); setRuns([]); setDirty(false); setDraft(null); setConflict(false);
    refreshWorkspace().catch(error => toast(error.message, 'error'));
    if (['teacher', 'admin'].includes(user.role)) api('/classes').then(data => { if (alive) { setClasses(data); setClassId(value => value || String(data[0]?.id || '')); } }).catch(error => toast(error.message, 'error'));
    return () => { alive = false; };
  }, [user?.id, user?.role, targetStudent]);

  useEffect(() => {
    if (!classId || !user || !['teacher', 'admin'].includes(user.role)) { setStudents([]); return; }
    let alive = true; setStudents([]);
    api(`/classes/${classId}/students`).then(data => { if (alive) setStudents(data); }).catch(error => toast(error.message, 'error'));
    return () => { alive = false; };
  }, [classId, user?.id, user?.role, toast]);

  const edit = useCallback(changes => {
    const current = projectRef.current;
    if (!current || current.readOnly) return;
    const next = { ...current, ...changes };
    projectRef.current = next; setProject(next);
    const changed = !sameSource(next, savedRef.current);
    setDirty(changed); setSaveState(changed ? 'dirty' : 'saved');
    if (!storeLocal(draftKey(next.id), changed ? { ...sourceOf(next), version: next.version, savedAt: Date.now() } : null)) toast('浏览器草稿空间不足，请及时保存或下载代码', 'error');
  }, [draftKey, toast]);

  const save = useCallback(async (runAfter = false) => {
    if (savePromise.current) await savePromise.current;
    const current = projectRef.current;
    if (!current || current.readOnly || !config?.writesEnabled) return null;
    if (conflict || draft) { toast('请先处理恢复草稿或版本冲突，再保存运行', 'error'); return null; }
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
        toast(error.message, 'error');
        return null;
      }
    })();
    savePromise.current = operation;
    try { return await operation; } finally { if (savePromise.current === operation) savePromise.current = null; }
  }, [config?.writesEnabled, conflict, draft, draftKey, toast]);

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
    catch (error) { toast(error.message, 'error'); }
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
        if (alive && [401, 403, 404].includes(error.status)) { setActiveRun(null); toast(error.message, 'error'); }
      } finally { busy = false; }
    };
    poll(); const timer = setInterval(poll, 1500);
    return () => { alive = false; clearInterval(timer); };
  }, [activeRun?.id, toast]);

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
        toast(`已向 ${data.recipients_json.length} 位学生分发独立副本，不会覆盖已有作品`, 'success');
      } else if (modal.type === 'reload') { storeLocal(draftKey(project.id), null); await openProject(project.id); }
      else if (modal.type === 'discard-draft') { storeLocal(draftKey(project.id), null); setDraft(null); }
      setModal(null); return true;
    } catch (error) { toast(error.message, 'error'); return false; }
  };
  const copyProject = async () => {
    try {
      if (!project.readOnly && dirty && !await save()) return;
      const data = await api(`/projects/${project.id}/copy`, { method: 'POST', body: {} });
      if (targetStudent) { setTargetStudent(null); storeLocal(`cpp:last-project:${user.id}`, data.id); }
      else { await refreshWorkspace(); await openProject(data.id); }
      toast('已创建自己的独立副本', 'success');
    } catch (error) { toast(error.message, 'error'); }
  };
  const viewSnapshot = async () => {
    try { const data = await api(`/runs/${run.id}/source`); setModal({ type: 'snapshot', data }); } catch (error) { toast(error.message, 'error'); }
  };
  const selectHistory = async item => {
    selectedRunRef.current = item.id;
    try {
      const data = await api(`/runs/${item.id}`);
      if (selectedRunRef.current === item.id && projectRef.current?.id === data.project_id) { setRun(data); setResultTab('stdout'); }
    } catch (error) { toast(error.message, 'error'); }
  };

  if (!config) return <main className="connection-page"><div className="brand-mark"><Braces /></div><h1>C++ 练习室</h1><p>{sessionError || '正在连接练习室…'}</p>{sessionError && <button onClick={refreshSession}><RefreshCw size={16} />重新连接</button>}</main>;
  if (!user) return <main className="connection-page"><div className="brand-mark"><Braces /></div><div className="eyebrow">提高编程 · C++ 练习室</div><h1>用代码，解开下一道题。</h1><p>与 p5.js 共用一个账号。登录、注册和班级码入班<br />均在原平台完成，不需要再次注册。</p><a className="button primary" href={config.commonLogin} target="_blank" rel="noopener noreferrer"><LogIn size={17} />前往公共账号登录</a><p className="muted">登录完成后回到此标签页，练习室会自动验证身份。</p><button onClick={refreshSession}><RefreshCw size={16} />我已登录，重新验证</button>{sessionError && <p className="error-text">{sessionError}</p>}</main>;

  const isTeacher = ['teacher', 'admin'].includes(user.role);
  const readOnly = project?.readOnly || !config.writesEnabled;
  const changedSinceRun = run && project && (run.revision_id !== project.revisionId || dirty);

  return <div className="app-shell">
    <header className={`topbar${workspaceView === 'organizer' ? ' organizer-topbar' : ''}`}>
      <a href="/teaching-cpp/" className="brand"><span className="brand-mark"><Braces size={24} /></span><span><strong>C++ 创意编程乐园</strong></span></a>
      <div className="topbar-right"><a className="platform-link" href={config.commonDashboard} target="_blank" rel="noopener noreferrer">p5.js 平台<ExternalLink size={13} /></a><span className="avatar">{user.username.slice(0, 1)}</span>{config.mode === 'demo' ? <select className="account-select" aria-label="演示身份" value={demoUser} onChange={event => { const value = Number(event.target.value); storeLocal('cpp:demo-user', value); setTargetStudent(null); setFolderId(null); setDemoUser(value); }}><option value="1">林老师 · 演示</option><option value="2">小林同学 · 演示</option><option value="3">小陈同学 · 演示</option></select> : <span className="user-name">{user.username}<small>{isTeacher ? '教师' : '学生'}</small></span>}</div>
    </header>
    {config.mode === 'demo' && <div className="environment-banner"><span className="demo-dot" />本机演示 · 使用示例账号和临时数据，可体验编辑与教学流程；尚未连接真实编译服务，重启后演示数据重置。</div>}
    {!config.writesEnabled && <div className="warning-banner"><AlertTriangle size={16} />生产写入已关闭。需完成旧平台类别隔离审核后才能保存或运行。</div>}
    {sessionError && <div className="warning-banner">{sessionError}<button onClick={refreshSession}>重新验证</button></div>}
    {notice && <div className={`toast ${notice.type}`} role={notice.type === 'error' ? 'alert' : 'status'}>{notice.type === 'error' ? <AlertTriangle size={17} /> : <Check size={17} />}<span>{notice.message}</span><button className="icon-button" aria-label="关闭提示" onClick={() => setNotice(null)}><X size={16} /></button></div>}

    {workspaceView === 'organizer' ? <main className="organizer-page">
      <div className="organizer-page__inner">
        {isTeacher && <section className="organizer-teacher-panel">
          <div className="organizer-teacher-panel__heading"><h2><User size={18} /><span>👩‍🏫 班级学生作品督导看板</span></h2><label><span>班级</span><select value={classId} disabled={!classes.length} onChange={event => { setClassId(event.target.value); setTargetStudent(null); setFolderId(null); }}>{classes.length ? classes.map(item => <option key={item.id} value={item.id}>{item.name}</option>) : <option value="">暂无班级</option>}</select></label></div>
          {classes.length ? <div className="organizer-student-picker"><p>当前班级：<strong>{classes.find(item => String(item.id) === classId)?.name || '未选择班级'}</strong></p><div><button className={targetStudent == null ? 'selected' : ''} onClick={() => { setTargetStudent(null); setFolderId(null); }}>🙋‍♂️ 我（我的项目）</button>{students.map(student => <button className={String(targetStudent) === String(student.id) ? 'selected' : ''} key={student.id} onClick={() => { setTargetStudent(student.id); setFolderId(null); }}>👤 {student.username}</button>)}</div>{!students.length && <p>该班级暂无学生。</p>}</div> : <p className="organizer-teacher-empty">你还没有绑定任何班级，请联系管理员。</p>}
        </section>}
        <section className="organizer-showcase">
          <div className="organizer-showcase__heading">
            <div><h1><span>{targetStudent ? <>📂 正在督导 [{workspace.owner?.username || '学生'}] 的作品</> : '🎨 我的创意工坊'}</span> <Sparkles size={24} /></h1><p>{targetStudent ? '请保护好学生作品，在这里您可以直接阅览并运行他们的精彩代码。' : '在这里收集你所有的精彩想法，开始天马行空的创意代码吧！'}</p></div>
            {!targetStudent && !workspace.readOnly && <div className="organizer-create-actions"><button className="organizer-create-group" disabled={!config.writesEnabled} onClick={() => setModal({ type: 'group' })}><Folder size={19} />新建作品组</button><button className="organizer-create-project" disabled={!config.writesEnabled} onClick={() => setModal({ type: 'create' })}><Plus size={20} />动手做个新作品</button></div>}
          </div>
          <ProjectOrganizer key={`${targetStudent ?? 'me'}:${organizerRevision}`} adapter={organizerAdapter} ownerId={targetStudent} currentParentId={folderId} onCurrentParentIdChange={setFolderId} messages={organizerMessages} icons={organizerIcons} onError={organizerError} renderProjectExtraActions={item => <>{isTeacher && !targetStudent && <button type="button" className="tigao-organizer__icon-button organizer-distribute-button" aria-label={`分发给当前班级: ${item.name}`} title={classId ? '分发给当前班级' : '请先选择班级'} disabled={!classId || !config.writesEnabled} onClick={() => setModal({ type: 'distribute', item, requestId: crypto.randomUUID(), fromOrganizer: true })}><Send size={20} /></button>}<span className="organizer-language-badge">C++ 魔法箱</span></>} />
        </section>
      </div>
    </main> : <div className="workspace-layout editor-layout">
      <main className="main-workspace">
        {project ? <><div className="workspace-heading"><button className="editor-back-button" onClick={() => { setFolderId(project.parent_id || null); setWorkspaceView('organizer'); }}><ArrowLeft size={15} />返回作品工坊</button><div className="project-title"><div className="breadcrumb">{workspace.readOnly ? '学生练习' : '我的练习'}<ChevronRight size={12} />{workspace.groups.find(group => group.id === project.parent_id)?.name || '未分组'}</div><h1>{project.name}{project.readOnly && <span className="pill readonly-pill">只读查看</span>}</h1></div><div className="project-tools"><button className="icon-button" aria-label="下载 main.cpp" title="下载 main.cpp" onClick={() => downloadCode(project.code)}><Download size={18} /></button><button className="icon-button" aria-label="复制项目" title="创建自己的副本" onClick={copyProject}><Copy size={17} /></button>{isTeacher && !project.readOnly && <button className="distribute-button" disabled={!classes.length || !config.writesEnabled} onClick={() => setModal({ type: 'distribute', item: project, requestId: crypto.randomUUID() })}><Users size={15} />分发到班级</button>}</div></div>
        {draft && <div className="draft-banner"><AlertTriangle size={16} /><span>发现未保存的本地草稿（{new Date(draft.savedAt).toLocaleString('zh-CN')}）</span><button onClick={() => { const mismatch = draft.version !== project.version; const restored = { ...project, ...sourceOf(draft) }; projectRef.current = restored; setProject(restored); setDirty(true); setDraft(null); setConflict(mismatch); setSaveState(mismatch ? 'error' : 'dirty'); }}>恢复草稿</button><button onClick={() => setModal({ type: 'discard-draft' })}>保留服务器版本</button></div>}
        {conflict && <div className="draft-banner"><AlertTriangle size={16} /><span>版本冲突：自动保存已暂停，请先下载本地代码，再重新载入并合并修改。</span><button onClick={() => downloadCode(project.code, 'main-local-draft.cpp')}>下载本地代码</button><button onClick={() => setModal({ type: 'reload' })}>重新载入</button></div>}
        {project.readOnly && <div className="readonly-banner"><GraduationCap size={16} />正在查看 {project.ownerName} 的代码。不能保存、运行或停止学生任务。<button onClick={copyProject}>复制到我的练习</button></div>}
        <div className="editor-toolbar"><div className="file-tab"><FileCode2 size={16} /><span>main.cpp</span>{dirty && <span className="unsaved-dot" />}</div><span className={`save-indicator ${saveState === 'error' ? 'error-text' : ''}`}>{saveState === 'saving' ? '正在保存…' : saveState === 'error' ? '保存未确认' : dirty ? '待保存' : '已保存'}</span><div className="toolbar-actions"><button className="icon-button" aria-label="编辑器设置" onClick={() => setSettingsOpen(!settingsOpen)}><Settings2 size={17} /></button><button className="save-button" disabled={readOnly || saveState === 'saving' || loadingProject} onClick={() => save()}><Save size={15} /><span>保存</span></button><button className="primary run-button" disabled={readOnly || !!activeRun || runBusy || loadingProject || !!draft || conflict} onClick={runCode}><Play size={15} fill="currentColor" />{runBusy ? '正在提交…' : '保存并运行'}<kbd>Ctrl ↵</kbd></button><button className="icon-button stop-button" aria-label="停止运行" disabled={!activeRun || readOnly || activeRun.state === 'stopping'} onClick={stopRun}><Square size={15} fill="currentColor" /></button></div></div>
        {settingsOpen && <div className="editor-settings"><label>代码字号<select value={fontSize} onChange={event => { setFontSize(Number(event.target.value)); storeLocal('cpp:font-size', Number(event.target.value)); }}>{[13, 14, 15, 16, 18, 20, 22].map(size => <option key={size}>{size}</option>)}</select></label><label>结果区宽度<input aria-label="结果区宽度" type="range" min="280" max="520" step="20" value={resultWidth} onChange={event => { setResultWidth(Number(event.target.value)); storeLocal('cpp:result-width', Number(event.target.value)); }} /></label></div>}
        <div className="coding-surface" style={{ '--result-width': `${resultWidth}px` }}><section className="code-pane" aria-label="代码编辑区">{loadingProject && <div className="loading-overlay">正在打开练习…</div>}<CodeEditor value={project.code} onChange={code => edit({ code })} readOnly={!!readOnly || loadingProject} fontSize={fontSize} onSave={save} onRun={runCode} editorRef={editorRef} onCursor={setCursor} /><div className="code-status"><span>C++ · UTF-8</span><span>第 {cursor.line} 行，第 {cursor.column} 列</span><span>版本 {project.version}</span></div></section><aside className="execution-pane"><section className="input-panel"><div className="panel-heading"><h2>测试输入</h2><span>标准输入 stdin</span></div><textarea aria-label="测试输入" spellCheck="false" placeholder="在这里一次填入完整输入数据，例如：\n12 30" value={project.stdin} readOnly={!!readOnly} onChange={event => edit({ stdin: event.target.value })} /><div className="input-hint">输入会随代码一起保存。运行开始后不再追加输入。</div></section><section className="result-panel"><div className="panel-heading"><h2>运行结果</h2><span className={`run-state ${run?.state || ''}`}>{run ? STATE_LABELS[run.state] : '等待运行'}</span></div><div className="result-tabs" role="tablist" aria-label="结果类型">{[['stdout', '输出'], ['stderr', '错误'], ['compiler_output', '编译信息'], ['history', '历史']].map(([value, label]) => <button role="tab" aria-selected={resultTab === value} className={resultTab === value ? 'selected' : ''} key={value} onClick={() => setResultTab(value)}>{label}{value === 'compiler_output' && run?.diagnostics?.length > 0 && <span>{run.diagnostics.length}</span>}</button>)}</div>{run && <div className="run-meta"><span>版本 {run.version} · {when(run.created_at)}</span><span>{run.elapsed_ms == null ? '耗时 —' : `${run.elapsed_ms} ms`}</span><span>{run.memory_bytes == null ? '内存 —' : `${(run.memory_bytes / 1048576).toFixed(1)} MB`}</span></div>}{changedSinceRun && <div className="version-note">结果对应之前保存的版本，当前代码或输入已有变化。</div>}{activeRun && <div className="active-note"><Clock3 size={14} />{STATE_LABELS[activeRun.state]}{activeRun.queuePosition ? ` · 队列位置 ${activeRun.queuePosition}` : ''}{activeRun.message && <span>{activeRun.message}</span>}</div>}
          <div className="result-content">{resultTab === 'history' ? <>{runs.map(item => <button className={`history-item ${run?.id === item.id ? 'selected' : ''}`} key={item.id} onClick={() => selectHistory(item)}><span>{STATE_LABELS[item.state]}</span><small>v{item.version} · {when(item.created_at)}</small></button>)}{!runs.length && <p className="empty-copy">暂无历史运行记录。缓存最多保留一天。</p>}</> : !run ? <div className="result-empty"><span className="terminal-symbol">&gt;_</span><h3>准备好，运行你的想法。</h3><p>填写测试输入，点击「保存并运行」。<br />这里会显示程序输出和编译信息。</p>{!config.runEnabled && <span className="pill">当前环境未启用真实编译</span>}</div> : <>{resultTab === 'compiler_output' && run.diagnostics?.map((item, index) => <button disabled={!!changedSinceRun} className="diagnostic" key={index} onClick={() => { const view = editorRef.current; if (!view) return; const line = view.state.doc.line(Math.min(item.line, view.state.doc.lines)); view.dispatch({ selection: { anchor: Math.min(line.to, line.from + item.column - 1) }, scrollIntoView: true }); view.focus(); }}><span>{item.severity === 'warning' ? '警告' : '提示'} · 第 {item.line} 行</span>{item.message}</button>)}<pre aria-live="polite">{run[resultTab] || (resultTab === 'stdout' && run.state === 'completed' ? '程序已结束，没有标准输出。' : '暂无内容')}</pre>{run.message && !ACTIVE_STATES.includes(run.state) && <p className="run-message">{run.message}</p>}</>}</div>{run && <button className="snapshot-button" onClick={viewSnapshot}>查看本次运行的代码与输入<ChevronRight size={13} /></button>}<div className="result-disclaimer">运行完成不代表答案正确 · 耗时为执行阶段墙钟时间</div></section></aside></div>
        <footer className="workspace-footer"><span><span className="status-dot" />{config.runEnabled ? '运行任务由独立服务执行' : '编辑与保存可用 · 真实执行未启用'}</span><label>编译配置<select aria-label="编译配置" disabled={!!readOnly} value={project.profileId} onChange={event => edit({ profileId: event.target.value })}>{config.profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></label><button className={aiOpen ? 'ai-toggle selected' : 'ai-toggle'} onClick={() => setAiOpen(!aiOpen)}><Sparkles size={14} />AI 学习助手<span>预留</span></button></footer>{aiOpen && <div className="ai-placeholder"><Sparkles size={20} /><div><strong>AI 学习助手 · 暂未开放</strong><p>未来可用于解释编译错误、提供分级提示和检查边界条件。首版不调用 AI，也不扣除 Token。</p></div><button className="icon-button" aria-label="收起 AI 面板" onClick={() => setAiOpen(false)}><X size={17} /></button></div>}</> : <div className="empty-workspace"><Braces size={46} /><div className="eyebrow">YOUR NEXT SMALL STEP</div><h1>{workspace.readOnly ? '这位同学还没有 C++ 练习' : '从第一行代码开始。'}</h1><p>{workspace.readOnly ? '学生保存练习后，可以在这里查看。' : '请在左侧新建练习，或者从课堂示例开始。每次运行前，代码都会先保存。'}</p>{!workspace.readOnly && <button className="primary" onClick={() => setModal({ type: 'create' })}><Sparkles size={16} />从课堂示例创建</button>}</div>}
      </main>
    </div>}
    {modal && <ActionModal key={`${modal.type}:${modal.item?.id || ''}`} modal={modal} groups={workspace.groups} classes={classes} onClose={() => setModal(null)} onSubmit={executeModal} onDelete={type => setModal({ type, item: modal.item })} />}
  </div>;
}

function ActionModal({ modal, groups, classes, onClose, onSubmit, onDelete }) {
  const [name, setName] = useState(modal.item?.name || (modal.type.includes('group') ? '新的作品组' : '新的 C++ 作品'));
  const [parentId, setParentId] = useState(modal.item?.parent_id || '');
  const [exampleId, setExampleId] = useState('hello');
  const [classId, setClassId] = useState(String(classes[0]?.id || ''));
  const [examples, setExamples] = useState([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (modal.type === 'create') api('/examples').then(setExamples).catch(() => {}); }, [modal.type]);
  const submit = async event => { event.preventDefault(); if (busy) return; setBusy(true); try { await onSubmit({ name, parentId, exampleId, classId }); } finally { setBusy(false); } };
  const titles = { create: '新建 C++ 作品', group: '新建作品组', 'project-settings': '管理练习', 'group-settings': '管理作品组', 'delete-project': '删除这个练习？', 'delete-group': '删除这个作品组？', distribute: '分发课堂模板', reload: '重新载入服务器版本？', 'discard-draft': '放弃恢复本地草稿？', snapshot: '运行时的代码与输入' };
  const confirmOnly = ['delete-project', 'delete-group', 'reload', 'discard-draft'].includes(modal.type);
  return <Modal title={titles[modal.type]} onClose={busy ? () => {} : onClose} wide={modal.type === 'snapshot'}>{modal.type === 'snapshot' ? <><p className="muted">版本 {modal.data.version} · {modal.data.profileId} · 此处只读，不会覆盖当前代码。</p><div className="snapshot-editor"><CodeEditor value={modal.data.code} readOnly /></div><label className="form-label">本次输入<pre className="snapshot-input">{modal.data.stdin || '（无输入）'}</pre></label><div className="modal-actions"><button onClick={() => downloadCode(modal.data.code, `main-v${modal.data.version}.cpp`)}><Download size={15} />下载该版本</button><button className="primary" onClick={onClose}>关闭</button></div></> : <form onSubmit={submit}>{confirmOnly ? <p className="modal-copy">{modal.type === 'delete-project' ? '这会删除该练习及其运行缓存，不能在平台中撤销。建议先下载源代码。' : modal.type === 'delete-group' ? '只允许删除空作品组。有练习或子组时，需要先把它们移走。' : '请确认已经下载或保留需要的本地代码。此操作会放弃对应本地草稿。'}</p> : modal.type === 'distribute' ? <><p className="modal-copy">{modal.fromOrganizer ? `为班内每位学生创建「${modal.item.name}」的独立副本，不会覆盖学生已有作品。` : `将先保存「${modal.item.name}」，再为班内每位学生创建独立副本。不会覆盖学生已有练习。`}</p><label className="form-label">选择班级<select required value={classId} onChange={event => setClassId(event.target.value)}>{classes.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><p className="muted">同一次分发重试不会重复创建；主动再次分发会新增副本。</p></> : <><label className="form-label">{modal.type.includes('group') ? '作品组名称' : '作品名称'}<input required maxLength={100} autoFocus value={name} onChange={event => setName(event.target.value)} /></label>{modal.type.includes('settings') && <label className="form-label">所属作品组<select value={parentId} onChange={event => setParentId(event.target.value)}><option value="">未分组 / 根作品组</option>{groups.filter(group => !(modal.type === 'group-settings' && group.id === modal.item.id)).map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>}{modal.type === 'create' && <><label className="form-label">从一个示例开始</label><div className="example-grid">{examples.map(item => <button type="button" key={item.id} className={`example-card ${exampleId === item.id ? 'selected' : ''}`} onClick={() => { setExampleId(item.id); setName(item.name); }}><FileCode2 size={20} /><strong>{item.name}</strong><span>{item.topic}</span><small>{item.description}</small></button>)}</div></>}</>}<div className="modal-actions">{modal.type.includes('settings') && <button type="button" className="danger-text" onClick={() => onDelete(modal.type === 'group-settings' ? 'delete-group' : 'delete-project')}><Trash2 size={15} />删除</button>}<span className="spacer" /><button type="button" disabled={busy} onClick={onClose}>取消</button><button className={modal.type.startsWith('delete') ? 'danger' : 'primary'} disabled={busy}>{busy ? '正在处理…' : modal.type === 'distribute' ? '保存并分发' : confirmOnly ? '确认' : '确定'}</button></div></form>}</Modal>;
}
