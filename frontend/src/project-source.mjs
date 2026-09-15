const isSource = value => /\.(?:c|cc|cpp|cxx)$/i.test(value);

export function normalizeProjectSource(value) {
  if (Array.isArray(value?.files)) return { schemaVersion: 2, entrypoint: value.entrypoint, files: value.files.map(file => ({ path: file.path, content: file.content })), stdin: value.stdin, profileId: value.profileId, build: { sources: [...value.build.sources] } };
  return { schemaVersion: 2, entrypoint: 'main.cpp', files: [{ path: 'main.cpp', content: value?.code || '' }], stdin: value?.stdin || '', profileId: value?.profileId || 'cpp17', build: { sources: ['main.cpp'] } };
}

export function sourceOf(value) { return normalizeProjectSource(value); }
export const sameSource = (a, b) => !!a && !!b && JSON.stringify(sourceOf(a)) === JSON.stringify(sourceOf(b));
export const fileOf = (value, filePath) => value.files.find(file => file.path === filePath) || value.files[0];

export function updateFile(value, filePath, content) {
  return { ...value, files: value.files.map(file => file.path === filePath ? { ...file, content } : file) };
}

export function createFile(value, filePath) {
  const files = [...value.files, { path: filePath, content: '' }].sort((a, b) => a.path.localeCompare(b.path, 'en'));
  const sources = isSource(filePath) ? [...value.build.sources, filePath] : value.build.sources;
  return { ...value, files, build: { sources } };
}

export function renameFile(value, oldPath, newPath) {
  const files = value.files.map(file => file.path === oldPath ? { ...file, path: newPath } : file).sort((a, b) => a.path.localeCompare(b.path, 'en'));
  let sources = value.build.sources.map(filePath => filePath === oldPath ? newPath : filePath);
  if (!isSource(newPath)) sources = sources.filter(filePath => filePath !== newPath);
  else if (!sources.includes(newPath)) sources.push(newPath);
  return { ...value, entrypoint: value.entrypoint === oldPath ? newPath : value.entrypoint, files, build: { sources } };
}

export function deleteFile(value, filePath) {
  return { ...value, files: value.files.filter(file => file.path !== filePath), build: { sources: value.build.sources.filter(source => source !== filePath) } };
}
