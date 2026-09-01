import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readConfig } from '../backend/src/config.mjs';
import { MemoryRepository } from '../backend/src/repository.mjs';
import { SourceStore } from '../backend/src/source-store.mjs';
import { CppService } from '../backend/src/service.mjs';
export const image = `sha256:${'a'.repeat(64)}`;
export async function fixture(t, overrides = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'teaching-cpp-test-'));
  t.after(async () => {
    if (path.dirname(root) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith('teaching-cpp-test-')) throw new Error('测试清理路径异常');
    await fs.rm(root, { recursive: true, force: true });
  });
  const config = { ...readConfig({ APP_MODE: 'demo' }), minFreeBytes: 0, runEnabled: true, compilerImage: image, ...overrides };
  const users = [{ id: 1, username: 'Teacher', role: 'teacher', class_code: null, tokens: 100 }, { id: 2, username: 'Student', role: 'student', class_code: 'CLASS1', tokens: 100 }, { id: 3, username: 'Other', role: 'student', class_code: 'CLASS2', tokens: 100 }, { id: 4, username: 'Admin', role: 'admin', class_code: null, tokens: 100 }];
  const repo = new MemoryRepository({ users, classes: [{ id: 1, name: 'One', class_code: 'CLASS1', teacher_user_id: 1 }, { id: 2, name: 'Two', class_code: 'CLASS2', teacher_user_id: 4 }] });
  const sources = new SourceStore(path.join(root, 'sources'));
  await sources.init();
  const service = new CppService(repo, sources, config);
  return { root, config, repo, sources, service, users, teacher: users[0], student: users[1], other: users[2], admin: users[3] };
}
