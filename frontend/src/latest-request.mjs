export function createLatestRequestCommitter() {
  let latest = 0;
  return async (request, commit) => {
    const requestId = ++latest;
    const value = await request();
    if (requestId !== latest) return null;
    commit(value);
    return value;
  };
}
