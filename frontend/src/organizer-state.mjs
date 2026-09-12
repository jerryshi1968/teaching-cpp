import { readLocal, storeLocal } from './api.mjs';

const SELECTED_CLASS_KEY_PREFIX = 'cpp:organizer:selected-class';
const SELECTED_STUDENT_KEY_PREFIX = 'cpp:organizer:selected-student';
const GROUP_PATHS_KEY_PREFIX = 'cpp:organizer:group-paths-v1';

const storageKey = (prefix, userId) => `${prefix}:${userId}`;
const ownerKey = studentId => studentId === null ? 'me' : `student:${studentId}`;

export function normalizeOrganizerId(value) {
  if (value === null || value === undefined || value === '') return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export function chooseOrganizerClassId(classes, savedClassId) {
  const saved = normalizeOrganizerId(savedClassId);
  return saved !== null && classes.some(item => String(item.id) === String(saved)) ? saved : normalizeOrganizerId(classes[0]?.id);
}

export function chooseOrganizerStudentId(students, savedStudentId) {
  const saved = normalizeOrganizerId(savedStudentId);
  return saved !== null && students.some(item => String(item.id) === String(saved)) ? saved : null;
}

export function readOrganizerSelection(userId) {
  return {
    classId: normalizeOrganizerId(readLocal(storageKey(SELECTED_CLASS_KEY_PREFIX, userId))),
    studentId: normalizeOrganizerId(readLocal(storageKey(SELECTED_STUDENT_KEY_PREFIX, userId)))
  };
}

export function saveOrganizerClassId(userId, classId) {
  return storeLocal(storageKey(SELECTED_CLASS_KEY_PREFIX, userId), normalizeOrganizerId(classId));
}

export function saveOrganizerStudentId(userId, studentId) {
  return storeLocal(storageKey(SELECTED_STUDENT_KEY_PREFIX, userId), normalizeOrganizerId(studentId));
}

export function readOrganizerFolderId(userId, studentId) {
  const paths = readLocal(storageKey(GROUP_PATHS_KEY_PREFIX, userId), {});
  const key = ownerKey(normalizeOrganizerId(studentId));
  if (!paths || typeof paths !== 'object' || Array.isArray(paths) || !Object.hasOwn(paths, key)) return undefined;
  return normalizeOrganizerId(paths[key]);
}

export function saveOrganizerFolderId(userId, studentId, folderId) {
  const key = storageKey(GROUP_PATHS_KEY_PREFIX, userId);
  const stored = readLocal(key, {});
  const paths = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
  return storeLocal(key, { ...paths, [ownerKey(normalizeOrganizerId(studentId))]: normalizeOrganizerId(folderId) });
}
