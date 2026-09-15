import { ACTIVE_STATES, DEFAULT_CODE, EXAMPLES, PROFILES, TERMINAL_STATES, diagnostics } from '../../shared/contracts.mjs';
import { assert, fail } from './errors.mjs';
import { id, name, numberId, snapshot, uuid } from './validation.mjs';

const now = () => new Date().toISOString();
const active = run => ACTIVE_STATES.includes(run.state);
const teacher = user => ['teacher', 'admin'].includes(user.role);
const same = (a, b) => String(a) === String(b);
const oldest = (a, b) => a.created_at.localeCompare(b.created_at) || String(a.id).localeCompare(String(b.id));
const queueOrder = (a, b) => Number(a.queue_order) - Number(b.queue_order) || oldest(a, b);
const byOrder = (a, b) => a.sort_order - b.sort_order || b.updated_at.localeCompare(a.updated_at);

export class CppService {
  constructor(repo, sources, config) { this.repo = repo; this.sources = sources; this.config = config; }
  writable() { assert(this.config.writesEnabled, 503, 'WRITES_DISABLED', '生产写入尚未开放：请先完成旧平台类别隔离与迁移审核'); }
  async user(userId, tx = this.repo) {
    const user = await tx.one('users', { id: numberId(userId) });
    assert(user && ['student', 'teacher', 'admin'].includes(user.role), 401, 'SESSION_INVALID', '账号不存在或身份已失效，请重新登录');
    return user;
  }
  async canViewOwner(tx, user, ownerId) {
    if (same(user.id, ownerId)) return true;
    if (!teacher(user)) return false;
    const owner = await tx.one('users', { id: Number(ownerId) });
    return !!(owner?.role === 'student' && owner.class_code && await tx.one('classes', { class_code: owner.class_code, teacher_user_id: user.id }));
  }
  async projectAccess(tx, user, projectId, write = false) {
    const project = await tx.one('projects', { id: id(projectId) });
    assert(project && (write ? same(project.user_id, user.id) : await this.canViewOwner(tx, user, project.user_id)), 404, 'PROJECT_NOT_FOUND', '项目不存在或无权访问');
    return project;
  }
  async parentAccess(tx, userId, parentId) {
    parentId = numberId(parentId, true);
    if (parentId !== null) assert(await tx.one('groups', { id: parentId, user_id: userId }), 400, 'INVALID_GROUP', '目标作品组不属于当前用户或 C++ 平台');
    return parentId;
  }
  position(body, kind) {
    assert(body && Object.hasOwn(body, 'parentId') && Object.hasOwn(body, 'beforeId'), 400, 'INVALID_ID', '定位时必须显式提供 parentId 和 beforeId');
    return {
      parentId: body.parentId === null ? null : numberId(body.parentId),
      beforeId: body.beforeId === null ? null : kind === 'projects' ? id(body.beforeId) : numberId(body.beforeId)
    };
  }
  async groupAccess(tx, user, groupId) {
    groupId = numberId(groupId);
    const group = await tx.one('groups', { id: groupId, user_id: user.id });
    assert(group, 404, 'GROUP_NOT_FOUND', '作品组不存在或无权访问');
    return group;
  }
  async groupParentAccess(tx, userId, groupId, parentId) {
    parentId = await this.parentAccess(tx, userId, parentId);
    let cursor = parentId;
    const visited = new Set([groupId]);
    while (cursor !== null) {
      assert(!visited.has(cursor), 400, 'GROUP_CYCLE', '不能将作品组移入自身或其子组');
      visited.add(cursor);
      const ancestor = await tx.one('groups', { id: cursor, user_id: userId });
      assert(ancestor, 400, 'INVALID_GROUP', '父作品组关系不完整');
      cursor = ancestor.parent_id;
    }
    return parentId;
  }
  async reposition(tx, user, kind, source, parentId, beforeId) {
    if (kind === 'groups') parentId = await this.groupParentAccess(tx, user.id, source.id, parentId);
    else parentId = await this.parentAccess(tx, user.id, parentId);
    const sourceParentId = source.parent_id ?? null;
    const sourceRows = (await tx.find(kind, { user_id: user.id, parent_id: sourceParentId })).sort(byOrder);
    const sameParent = same(sourceParentId, parentId);
    const targetRows = sameParent ? sourceRows : (await tx.find(kind, { user_id: user.id, parent_id: parentId })).sort(byOrder);
    const sourceOrder = sourceRows.filter(row => !same(row.id, source.id));
    const targetOrder = targetRows.filter(row => !same(row.id, source.id));
    let targetIndex = targetOrder.length;
    if (beforeId !== null) {
      targetIndex = targetOrder.findIndex(row => same(row.id, beforeId));
      assert(targetIndex >= 0, 400, 'INVALID_BEFORE', '目标位置不属于指定作品组或当前用户');
    }
    targetOrder.splice(targetIndex, 0, source);
    const updatedAt = now();
    await tx.update(kind, { id: source.id, user_id: user.id }, { parent_id: parentId, updated_at: updatedAt });
    const rewrite = async (rows, rowParentId) => {
      for (const [index, row] of rows.entries()) await tx.update(kind, { id: row.id, user_id: user.id, parent_id: rowParentId }, { sort_order: index });
    };
    if (sameParent) await rewrite(targetOrder, parentId);
    else {
      await rewrite(sourceOrder, sourceParentId);
      await rewrite(targetOrder, parentId);
    }
    return { ...source, parent_id: parentId, sort_order: targetIndex, updated_at: updatedAt };
  }
  async workspace(user, targetId = null) {
    const ownerId = targetId ? numberId(targetId) : user.id;
    assert(await this.canViewOwner(this.repo, user, ownerId), 403, 'STUDENT_FORBIDDEN', '只能查看自己班级中的学生');
    const [projects, groups, owner] = await Promise.all([
      this.repo.find('projects', { user_id: ownerId }), this.repo.find('groups', { user_id: ownerId }), this.user(ownerId)
    ]);
    return { projects: projects.sort(byOrder), groups: groups.sort(byOrder), owner: { id: owner.id, username: owner.username }, readOnly: !same(user.id, ownerId) };
  }
  async getProject(user, projectId) {
    // 读取与清理共用短事务，避免读取中的旧版本被并发回收。
    return this.repo.transaction(async tx => {
      const project = await this.projectAccess(tx, user, projectId);
      const document = await tx.one('documents', { project_id: project.id });
      assert(document, 409, 'DOCUMENT_MISSING', '项目源码索引缺失，请联系管理员');
      const content = await this.sources.read(document.revision_id);
      const owner = await this.user(project.user_id, tx);
      return { ...project, ...content, revisionId: document.revision_id, version: document.version, ownerName: owner.username, readOnly: !same(user.id, project.user_id) };
    });
  }
  async syncFileIndex(tx, projectId, files, time) {
    const current = await tx.find('files', { project_id: projectId });
    const wanted = new Map(files.map(file => [file.path, file]));
    for (const file of current) {
      if (!wanted.has(file.path)) await tx.remove('files', { project_id: projectId, path: file.path });
      else await tx.update('files', { project_id: projectId, path: file.path }, { name: file.path.split('/').at(-1), updated_at: time });
    }
    for (const file of files) if (!current.some(existing => existing.path === file.path)) await tx.insert('files', { project_id: projectId, name: file.path.split('/').at(-1), path: file.path, created_at: time, updated_at: time });
  }
  async makeProject(tx, userId, title, parentId, content) {
    assert((await tx.find('projects', { user_id: userId })).length < 1000, 409, 'PROJECT_QUOTA', '项目数量已达到上限 1000，请整理后再创建');
    content = snapshot(content);
    const projectId = uuid();
    const revisionId = uuid();
    const time = now();
    const bytes = await this.sources.write(revisionId, content);
    const siblings = await tx.find('projects', { user_id: userId, parent_id: parentId });
    const sortOrder = siblings.reduce((maximum, project) => Math.max(maximum, project.sort_order), -1) + 1;
    await tx.insert('projects', { id: projectId, user_id: userId, name: title, parent_id: parentId, sort_order: sortOrder, project_type: 'cpp', created_at: time, updated_at: time });
    await this.syncFileIndex(tx, projectId, content.files, time);
    await tx.insert('documents', { project_id: projectId, revision_id: revisionId, version: 1 });
    await tx.insert('revisions', { id: revisionId, project_id: projectId, user_id: userId, source_bytes: bytes, created_at: time });
    return projectId;
  }
  async createProject(user, body) {
    this.writable();
    const title = name(body.name);
    const example = body.exampleId ? EXAMPLES.find(item => item.id === body.exampleId) : null;
    assert(!body.exampleId || example, 400, 'EXAMPLE_NOT_FOUND', '示例不存在');
    const content = { schemaVersion: 2, entrypoint: 'main.cpp', files: [{ path: 'main.cpp', content: example?.code ?? DEFAULT_CODE }], stdin: example?.stdin ?? '', profileId: 'cpp17', build: { sources: ['main.cpp'] } };
    const projectId = await this.repo.transaction(async tx => this.makeProject(tx, user.id, title, await this.parentAccess(tx, user.id, body.parentId), content));
    return this.getProject(user, projectId);
  }
  async saveProject(user, projectId, body, transaction = null) {
    this.writable();
    const content = snapshot(body);
    assert(Number.isSafeInteger(body.version) && body.version > 0, 400, 'VERSION_REQUIRED', '保存时必须携带当前代码版本');
    const save = async tx => {
      const project = await this.projectAccess(tx, user, projectId, true);
      const document = await tx.one('documents', { project_id: project.id });
      assert(document && document.version === body.version, 409, 'VERSION_CONFLICT', '代码已在其他页面更新。本地草稿已保留，请重新载入后比较', { currentVersion: document?.version });
      const previous = await this.sources.read(document.revision_id);
      if (JSON.stringify(content) === JSON.stringify(previous)) return { version: document.version, revisionId: document.revision_id, saved: true };
      const revisionId = uuid();
      const bytes = await this.sources.write(revisionId, content);
      const time = now();
      await tx.insert('revisions', { id: revisionId, project_id: project.id, user_id: user.id, source_bytes: bytes, created_at: time });
      await tx.update('documents', { project_id: project.id }, { revision_id: revisionId, version: document.version + 1 });
      await tx.update('projects', { id: project.id, user_id: user.id }, { updated_at: time });
      await this.syncFileIndex(tx, project.id, content.files, time);
      return { version: document.version + 1, revisionId, saved: true };
    };
    if (transaction) return save(transaction);
    const result = await this.repo.transaction(save);
    await this.cleanup();
    return result;
  }
  async updateProject(user, projectId, body) {
    this.writable();
    return this.repo.transaction(async tx => {
      let project = await this.projectAccess(tx, user, projectId, true);
      const changes = { updated_at: now() };
      if ('name' in body) changes.name = name(body.name);
      if ('parentId' in body) {
        const parentId = await this.parentAccess(tx, user.id, body.parentId);
        if (!same(project.parent_id ?? null, parentId)) project = await this.reposition(tx, user, 'projects', project, parentId, null);
      }
      await tx.update('projects', { id: project.id, user_id: user.id }, changes);
      return { ...project, ...changes };
    });
  }
  async repositionProject(user, projectId, body) {
    this.writable();
    const position = this.position(body, 'projects');
    return this.repo.transaction(async tx => {
      const project = await this.projectAccess(tx, user, projectId, true);
      return { repositioned: true, project: await this.reposition(tx, user, 'projects', project, position.parentId, position.beforeId) };
    });
  }
  async copyProject(user, projectId, body) {
    this.writable();
    const copied = await this.repo.transaction(async tx => {
      const project = await this.projectAccess(tx, user, projectId);
      const document = await tx.one('documents', { project_id: project.id });
      return this.makeProject(tx, user.id, name(body.name || `${project.name.slice(0, 90)} · 副本`), await this.parentAccess(tx, user.id, body.parentId), await this.sources.read(document.revision_id));
    });
    return this.getProject(user, copied);
  }
  async deleteProject(user, projectId) {
    this.writable();
    const revisions = await this.repo.transaction(async tx => {
      const project = await this.projectAccess(tx, user, projectId, true);
      assert(!(await tx.find('runs', { project_id: project.id })).some(active), 409, 'RUN_ACTIVE', '请先停止运行任务，再删除项目');
      const rows = await tx.find('revisions', { project_id: project.id });
      for (const table of ['runs', 'revisions', 'documents', 'files']) await tx.remove(table, { project_id: project.id });
      await tx.remove('projects', { id: project.id, user_id: user.id });
      return rows;
    });
    const snapshotCleanupPending = !(await Promise.all(revisions.map(revision => this.sources.removeEventually(revision.id)))).every(Boolean);
    return { deleted: true, snapshotCleanupPending };
  }
  async createGroup(user, body) {
    this.writable();
    return this.repo.transaction(async tx => {
      const groups = await tx.find('groups', { user_id: user.id });
      assert(groups.length < 200, 409, 'GROUP_QUOTA', '作品组数量已达到上限 200');
      const time = now();
      const row = { user_id: user.id, name: name(body.name), parent_id: await this.parentAccess(tx, user.id, body.parentId), sort_order: groups.length, project_type: 'cpp', created_at: time, updated_at: time };
      return { ...row, id: await tx.insert('groups', row) };
    });
  }
  async updateGroup(user, groupId, body) {
    this.writable();
    return this.repo.transaction(async tx => {
      let group = await this.groupAccess(tx, user, groupId);
      const changes = { updated_at: now() };
      if ('name' in body) changes.name = name(body.name);
      if ('parentId' in body) {
        const parentId = await this.groupParentAccess(tx, user.id, group.id, body.parentId);
        if (!same(group.parent_id ?? null, parentId)) group = await this.reposition(tx, user, 'groups', group, parentId, null);
      }
      await tx.update('groups', { id: group.id, user_id: user.id }, changes);
      return { ...group, ...changes };
    });
  }
  async repositionGroup(user, groupId, body) {
    this.writable();
    const position = this.position(body, 'groups');
    return this.repo.transaction(async tx => {
      const group = await this.groupAccess(tx, user, groupId);
      return { repositioned: true, group: await this.reposition(tx, user, 'groups', group, position.parentId, position.beforeId) };
    });
  }
  async deleteGroup(user, groupId) {
    this.writable();
    return this.repo.transaction(async tx => {
      groupId = numberId(groupId);
      assert(await tx.one('groups', { id: groupId, user_id: user.id }), 404, 'GROUP_NOT_FOUND', '作品组不存在或无权访问');
      assert(!(await tx.find('groups', { parent_id: groupId })).length && !(await tx.find('projects', { parent_id: groupId })).length, 409, 'GROUP_NOT_EMPTY', '请先移出组内的项目和子组，再删除空作品组');
      await tx.remove('groups', { id: groupId, user_id: user.id });
      return { deleted: true };
    });
  }
  async reorder(user, kind, body) {
    this.writable();
    assert(['projects', 'groups'].includes(kind), 400, 'INVALID_KIND', '排序类型无效');
    return this.repo.transaction(async tx => {
      const parentId = await this.parentAccess(tx, user.id, body.parentId);
      const rows = await tx.find(kind, { user_id: user.id, parent_id: parentId });
      assert(Array.isArray(body.ids) && body.ids.length === rows.length && new Set(body.ids.map(String)).size === rows.length && rows.every(row => body.ids.some(value => same(value, row.id))), 400, 'INVALID_ORDER', '排序必须且只能包含当前作品组内的全部项目');
      for (const [index, rowId] of body.ids.entries()) await tx.update(kind, { id: rowId, user_id: user.id, parent_id: parentId }, { sort_order: index });
      return { reordered: true };
    });
  }
  async classes(user) {
    assert(teacher(user), 403, 'TEACHER_REQUIRED', '此功能仅供教师使用');
    return this.repo.find('classes', { teacher_user_id: user.id });
  }
  async students(user, classId) {
    assert(teacher(user), 403, 'TEACHER_REQUIRED', '此功能仅供教师使用');
    const classroom = await this.repo.one('classes', { id: numberId(classId), teacher_user_id: user.id });
    assert(classroom, 404, 'CLASS_NOT_FOUND', '班级不存在或不属于当前教师');
    return (await this.repo.find('users', { class_code: classroom.class_code, role: 'student' })).map(student => ({ id: student.id, username: student.username }));
  }
  async distribute(user, projectId, body) {
    this.writable();
    assert(teacher(user), 403, 'TEACHER_REQUIRED', '此功能仅供教师使用');
    const requestId = id(body.requestId);
    return this.repo.transaction(async tx => {
      const source = await this.projectAccess(tx, user, projectId, true);
      const classroom = await tx.one('classes', { id: numberId(body.classId), teacher_user_id: user.id });
      assert(classroom, 404, 'CLASS_NOT_FOUND', '班级不存在或不属于当前教师');
      const existing = await tx.one('distributions', { teacher_user_id: user.id, request_id: requestId });
      if (existing) {
        assert(same(existing.class_id, classroom.id) && existing.source_project_id === source.id, 409, 'REQUEST_CONFLICT', '请求编号已用于其他分发');
        return existing;
      }
      const recipients = await tx.find('users', { role: 'student', class_code: classroom.class_code });
      assert(recipients.length && recipients.length <= 200, 400, 'CLASS_SIZE', '班级没有学生，或超过单次分发上限 200 人');
      const document = await tx.one('documents', { project_id: source.id });
      const content = await this.sources.read(document.revision_id);
      const distributedTitle = name([...`来自${user.username} - ${source.name}`].slice(0, 100).join(''));
      const copies = [];
      for (const student of recipients) copies.push({ userId: student.id, projectId: await this.makeProject(tx, student.id, distributedTitle, null, content) });
      const delivery = { id: uuid(), teacher_user_id: user.id, source_project_id: source.id, class_id: classroom.id, request_id: requestId, recipients_json: copies, created_at: now() };
      await tx.insert('distributions', delivery);
      return delivery;
    });
  }
  async saveAndRun(user, projectId, body) {
    this.writable();
    const requestId = id(body.requestId);
    const content = snapshot(body);
    const outcome = await this.repo.transaction(async tx => {
      await this.projectAccess(tx, user, projectId, true);
      const duplicate = await tx.one('runs', { user_id: user.id, request_id: requestId });
      if (duplicate) {
        assert(duplicate.project_id === id(projectId), 409, 'REQUEST_CONFLICT', '请求编号已用于其他项目');
        assert(JSON.stringify(await this.sources.read(duplicate.revision_id)) === JSON.stringify(content), 409, 'REQUEST_CONFLICT', '同一请求编号不能用于不同代码或输入');
        return { run: duplicate };
      }
      const pending = await tx.find('runs', { state: { $in: ACTIVE_STATES } });
      const current = pending.find(item => same(item.user_id, user.id));
      assert(!current, 409, 'RUN_ACTIVE', '已有任务排队或运行中，请等待完成或停止后再试', { runId: current?.id });
      const saved = await this.saveProject(user, projectId, body, tx);
      if (!this.config.runEnabled) return { error: [503, 'RUNNER_DISABLED', '代码已保存；此环境尚未启用真实 C++ 执行服务', saved] };
      if (pending.length >= this.config.maxPending) return { error: [429, 'QUEUE_FULL', '代码已保存，运行队列已满，请稍后再试', saved] };
      const time = now();
      const row = {
        id: uuid(), user_id: user.id, project_id: id(projectId), revision_id: saved.revisionId, version: saved.version, request_id: requestId,
        state: 'queued', profile_json: { ...PROFILES[content.profileId], image: this.config.compilerImage },
        compiler_output: '', stdout: '', stderr: '', message: '', elapsed_ms: null, memory_bytes: null, result_bytes: 0,
        created_at: time, updated_at: time, finished_at: null
      };
      await tx.insert('runs', row);
      return { run: row };
    });
    await this.cleanup();
    if (outcome.error) fail(...outcome.error);
    return this.presentRun(outcome.run);
  }
  presentRun(run) { return { ...run, diagnostics: diagnostics(run.compiler_output), saved: true, revisionId: run.revision_id, version: run.version }; }
  async runs(user, projectId) {
    await this.projectAccess(this.repo, user, projectId);
    return (await this.repo.find('runs', { project_id: projectId }, { recent: true, limit: 50 })).map(run => {
      const { stdout, stderr, compiler_output, diagnostics, ...summary } = this.presentRun(run);
      return summary;
    });
  }
  async getRun(user, runId) {
    const run = await this.repo.one('runs', { id: id(runId) });
    assert(run, 404, 'RUN_NOT_FOUND', '任务不存在，或历史缓存已清理');
    await this.projectAccess(this.repo, user, run.project_id);
    const pending = (await this.repo.find('runs', { state: { $in: ACTIVE_STATES } })).sort(queueOrder);
    return { ...this.presentRun(run), queuePosition: run.state === 'queued' ? pending.findIndex(item => item.id === run.id) + 1 : null };
  }
  async stopRun(user, runId) {
    this.writable();
    return this.repo.transaction(async tx => {
      const run = await tx.one('runs', { id: id(runId), user_id: user.id });
      assert(run, 404, 'RUN_NOT_FOUND', '任务不存在或无权停止');
      if (!active(run)) return this.presentRun(run);
      const state = run.state === 'queued' ? 'cancelled' : 'stopping';
      const update = { state, updated_at: now(), finished_at: state === 'cancelled' ? now() : null };
      await tx.update('runs', { id: run.id }, update);
      return this.presentRun({ ...run, ...update });
    });
  }
  async getRunSource(user, runId) {
    return this.repo.transaction(async tx => {
      const run = await tx.one('runs', { id: id(runId) });
      assert(run, 404, 'RUN_NOT_FOUND', '任务不存在，或历史缓存已清理');
      await this.projectAccess(tx, user, run.project_id);
      return { ...await this.sources.read(run.revision_id), version: run.version, revisionId: run.revision_id };
    });
  }
  async nextRun() {
    return this.repo.transaction(async tx => {
      const pending = (await tx.find('runs', { state: { $in: ACTIVE_STATES } })).sort(queueOrder);
      const running = pending.find(run => run.state !== 'queued');
      if (running) return running;
      if (!pending.length) return null;
      await tx.update('runs', { id: pending[0].id }, { state: 'compiling', updated_at: now() });
      return { ...pending[0], state: 'compiling' };
    });
  }
  async updateRun(runId, result) {
    return this.repo.transaction(async tx => {
      const current = await tx.one('runs', { id: runId });
      if (!current || !active(current)) return;
      const terminal = TERMINAL_STATES.includes(result.state);
      if (current.state === 'stopping' && !terminal) return;
      assert(terminal || ['compiling', 'running'].includes(result.state), 502, 'RUNNER_PROTOCOL', '执行服务返回了无效状态');
      const values = { state: result.state, updated_at: now(), message: String(result.message || '').slice(0, 1000) };
      if (terminal) {
        for (const key of ['stdout', 'stderr', 'compiler_output']) values[key] = String(result[key] || '').slice(0, 262144);
        values.elapsed_ms = Number.isFinite(result.elapsed_ms) && result.elapsed_ms >= 0 ? Math.round(result.elapsed_ms) : null;
        values.memory_bytes = Number.isFinite(result.memory_bytes) && result.memory_bytes >= 0 ? Math.round(result.memory_bytes) : null;
        values.result_bytes = Buffer.byteLength(values.stdout + values.stderr + values.compiler_output);
        values.finished_at = now();
      }
      await tx.update('runs', { id: runId }, values);
    });
  }
  async cleanup() {
    const removed = await this.repo.transaction(async tx => {
      const documents = await tx.find('documents');
      let runs = await tx.find('runs');
      let revisions = await tx.find('revisions');
      const protectedIds = new Set([...documents.map(doc => doc.revision_id), ...runs.filter(active).map(run => run.revision_id)]);
      const deleted = [];
      const deleteRun = async run => { await tx.remove('runs', { id: run.id }); runs = runs.filter(item => item.id !== run.id); };
      const deleteRevision = async revision => {
        for (const run of runs.filter(item => item.revision_id === revision.id && !active(item))) await deleteRun(run);
        await tx.remove('revisions', { id: revision.id });
        revisions = revisions.filter(item => item.id !== revision.id);
        deleted.push(revision.id);
      };
      const expiry = Date.now() - this.config.retentionMs;
      for (const run of [...runs]) if (!active(run) && Date.parse(run.finished_at || run.created_at) < expiry) await deleteRun(run);
      for (const revision of [...revisions]) if (!protectedIds.has(revision.id) && Date.parse(revision.created_at) < expiry) await deleteRevision(revision);
      const usage = userId => revisions.filter(revision => !protectedIds.has(revision.id) && (userId === null || same(revision.user_id, userId))).reduce((total, revision) => total + Number(revision.source_bytes), 0)
        + runs.filter(run => !active(run) && (userId === null || same(run.user_id, userId))).reduce((total, run) => total + Number(run.result_bytes), 0);
      const candidates = [...runs.filter(run => !active(run)).map(run => ({ ...run, kind: 'run' })), ...revisions.filter(revision => !protectedIds.has(revision.id)).map(revision => ({ ...revision, kind: 'revision' }))].sort(oldest);
      for (const candidate of candidates) {
        if (usage(null) <= this.config.globalCacheBytes && usage(candidate.user_id) <= this.config.userCacheBytes) continue;
        if (candidate.kind === 'run' && runs.some(run => run.id === candidate.id)) await deleteRun(candidate);
        if (candidate.kind === 'revision' && revisions.some(revision => revision.id === candidate.id)) await deleteRevision(candidate);
      }
      return { deleted, known: new Set(revisions.map(revision => revision.id)) };
    });
    for (const revision of removed.deleted) await this.sources.removeEventually(revision);
    await this.sources.retryPending();
    await this.sources.removeOrphans(removed.known, this.config.retentionMs);
  }
}
