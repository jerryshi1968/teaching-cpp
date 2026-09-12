import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseOrganizerClassId, chooseOrganizerStudentId, normalizeOrganizerId, readOrganizerFolderId, readOrganizerSelection, saveOrganizerClassId, saveOrganizerFolderId, saveOrganizerStudentId } from '../frontend/src/organizer-state.mjs';

function createStorage() {
  const values = new Map();
  return {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key)
  };
}

test.beforeEach(() => { globalThis.localStorage = createStorage(); });

test('作品页按登录用户恢复班级和学生', () => {
  saveOrganizerClassId(1, 12);
  saveOrganizerStudentId(1, 34);
  saveOrganizerClassId(2, 56);

  assert.deepEqual(readOrganizerSelection(1), { classId: 12, studentId: 34 });
  assert.deepEqual(readOrganizerSelection(2), { classId: 56, studentId: null });
});

test('每个作品所有者分别记忆所在作品组', () => {
  saveOrganizerFolderId(1, null, 10);
  saveOrganizerFolderId(1, 21, 31);
  saveOrganizerFolderId(1, 22, 32);
  saveOrganizerFolderId(2, 21, 41);

  assert.equal(readOrganizerFolderId(1, null), 10);
  assert.equal(readOrganizerFolderId(1, 21), 31);
  assert.equal(readOrganizerFolderId(1, 22), 32);
  assert.equal(readOrganizerFolderId(2, 21), 41);
  assert.equal(readOrganizerFolderId(1, 99), undefined);
});

test('根作品组和无效编号都按空值处理', () => {
  saveOrganizerFolderId(1, null, null);
  saveOrganizerClassId(1, 'invalid');
  saveOrganizerStudentId(1, -1);

  assert.equal(readOrganizerFolderId(1, null), null);
  assert.deepEqual(readOrganizerSelection(1), { classId: null, studentId: null });
  assert.equal(normalizeOrganizerId('8'), 8);
  assert.equal(normalizeOrganizerId(0), null);
});

test('已失效的班级和学生缓存回退到仍然有效的选择', () => {
  assert.equal(chooseOrganizerClassId([{ id: 2 }, { id: 3 }], 3), 3);
  assert.equal(chooseOrganizerClassId([{ id: 2 }], 99), 2);
  assert.equal(chooseOrganizerClassId([], 99), null);
  assert.equal(chooseOrganizerStudentId([{ id: 7 }], 7), 7);
  assert.equal(chooseOrganizerStudentId([{ id: 7 }], 99), null);
});
