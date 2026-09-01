const db = require('../config/db');

exports.createWithConnection = async (connection, { projectId, name, path }) => {
  await connection.query(
    'INSERT INTO files (project_id, name, path) VALUES (?, ?, ?)',
    [projectId, name, path]
  );
};

exports.deleteByProjectIdWithConnection = async (connection, projectId) => {
  const [result] = await connection.query('DELETE FROM files WHERE project_id = ?', [projectId]);
  return result.affectedRows;
};

exports.findByProjectId = async (projectId) => {
  const [rows] = await db.query(
    'SELECT id, name, path FROM files WHERE project_id = ? ORDER BY path ASC',
    [projectId]
  );
  return rows;
};

exports.findByProjectAndPath = async (projectId, filePath) => {
  const [rows] = await db.query(
    'SELECT id, name, path FROM files WHERE project_id = ? AND path = ?',
    [projectId, filePath]
  );
  return rows[0] || null;
};

exports.findById = async (fileId) => {
  const [rows] = await db.query(
    'SELECT id, project_id, name, path FROM files WHERE id = ?',
    [fileId]
  );
  return rows[0] || null;
};

exports.findOwnedFile = async (fileId, userId) => {
  const [rows] = await db.query(
    `SELECT f.id, f.name, f.path, f.project_id FROM files f
     JOIN projects p ON f.project_id = p.id
     WHERE f.id = ? AND p.user_id = ?`,
    [fileId, userId]
  );
  return rows[0] || null;
};

exports.create = async ({ projectId, name, path }) => {
  const [result] = await db.query(
    'INSERT INTO files (project_id, name, path) VALUES (?, ?, ?)',
    [projectId, name, path]
  );
  return {
    id: result.insertId,
    project_id: projectId,
    name,
    path
  };
};

exports.updateNameAndPath = async ({ fileId, name, path }) => {
  const [result] = await db.query(
    'UPDATE files SET name = ?, path = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [name, path, fileId]
  );
  return result.affectedRows;
};

exports.updateChildPaths = async ({ projectId, oldPrefix, newPrefix }) => {
  const [result] = await db.query(
    `UPDATE files
     SET path = CONCAT(?, SUBSTRING(path, ?)), updated_at = CURRENT_TIMESTAMP
     WHERE project_id = ? AND path LIKE ?`,
    [newPrefix, oldPrefix.length + 1, projectId, `${oldPrefix}/%`]
  );
  return result.affectedRows;
};

exports.deleteById = async (fileId) => {
  const [result] = await db.query('DELETE FROM files WHERE id = ?', [fileId]);
  return result.affectedRows;
};

exports.deleteByPathPrefix = async ({ projectId, pathPrefix }) => {
  const [result] = await db.query(
    'DELETE FROM files WHERE project_id = ? AND path LIKE ?',
    [projectId, `${pathPrefix}/%`]
  );
  return result.affectedRows;
};

exports.touchUpdatedAt = async (fileId) => {
  const [result] = await db.query(
    'UPDATE files SET updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [fileId]
  );
  return result.affectedRows;
};
