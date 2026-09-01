const db = require('../config/db');

exports.createWithConnection = async (connection, { projectId, name, path }) => {
  const [result] = await connection.query(
    'INSERT INTO files (project_id, name, path) SELECT ?, ?, ? FROM projects WHERE id = ? AND project_type = \'p5js\'',
    [projectId, name, path, projectId]
  );
  if (result.affectedRows !== 1) {
    const error = new Error('项目不存在或不属于 p5.js。');
    error.statusCode = 404;
    throw error;
  }
};

exports.deleteByProjectIdWithConnection = async (connection, projectId) => {
  const [result] = await connection.query('DELETE FROM files WHERE EXISTS (SELECT 1 FROM projects p WHERE p.id = files.project_id AND p.project_type = \'p5js\') AND project_id = ?', [projectId]);
  return result.affectedRows;
};

exports.findByProjectId = async (projectId) => {
  const [rows] = await db.query(
    'SELECT id, name, path FROM files WHERE EXISTS (SELECT 1 FROM projects p WHERE p.id = files.project_id AND p.project_type = \'p5js\') AND project_id = ? ORDER BY path ASC',
    [projectId]
  );
  return rows;
};

exports.findByProjectAndPath = async (projectId, filePath) => {
  const [rows] = await db.query(
    'SELECT id, name, path FROM files WHERE EXISTS (SELECT 1 FROM projects p WHERE p.id = files.project_id AND p.project_type = \'p5js\') AND project_id = ? AND path = ?',
    [projectId, filePath]
  );
  return rows[0] || null;
};

exports.findById = async (fileId) => {
  const [rows] = await db.query(
    'SELECT id, project_id, name, path FROM files WHERE EXISTS (SELECT 1 FROM projects p WHERE p.id = files.project_id AND p.project_type = \'p5js\') AND id = ?',
    [fileId]
  );
  return rows[0] || null;
};

exports.findOwnedFile = async (fileId, userId) => {
  const [rows] = await db.query(
    `SELECT f.id, f.name, f.path, f.project_id FROM files f
     JOIN projects p ON f.project_id = p.id
     WHERE p.project_type = 'p5js' AND f.id = ? AND p.user_id = ?`,
    [fileId, userId]
  );
  return rows[0] || null;
};

exports.create = async ({ projectId, name, path }) => {
  const [result] = await db.query(
    'INSERT INTO files (project_id, name, path) SELECT ?, ?, ? FROM projects WHERE id = ? AND project_type = \'p5js\'',
    [projectId, name, path, projectId]
  );
  if (result.affectedRows !== 1) {
    const error = new Error('项目不存在或不属于 p5.js。');
    error.statusCode = 404;
    throw error;
  }
  return {
    id: result.insertId,
    project_id: projectId,
    name,
    path
  };
};

exports.updateNameAndPath = async ({ fileId, name, path }) => {
  const [result] = await db.query(
    'UPDATE files SET name = ?, path = ?, updated_at = CURRENT_TIMESTAMP WHERE EXISTS (SELECT 1 FROM projects p WHERE p.id = files.project_id AND p.project_type = \'p5js\') AND id = ?',
    [name, path, fileId]
  );
  return result.affectedRows;
};

exports.updateChildPaths = async ({ projectId, oldPrefix, newPrefix }) => {
  const [result] = await db.query(
    `UPDATE files
     SET path = CONCAT(?, SUBSTRING(path, ?)), updated_at = CURRENT_TIMESTAMP
     WHERE EXISTS (SELECT 1 FROM projects p WHERE p.id = files.project_id AND p.project_type = 'p5js') AND project_id = ? AND path LIKE ?`,
    [newPrefix, oldPrefix.length + 1, projectId, `${oldPrefix}/%`]
  );
  return result.affectedRows;
};

exports.deleteById = async (fileId) => {
  const [result] = await db.query('DELETE FROM files WHERE EXISTS (SELECT 1 FROM projects p WHERE p.id = files.project_id AND p.project_type = \'p5js\') AND id = ?', [fileId]);
  return result.affectedRows;
};

exports.deleteByPathPrefix = async ({ projectId, pathPrefix }) => {
  const [result] = await db.query(
    'DELETE FROM files WHERE EXISTS (SELECT 1 FROM projects p WHERE p.id = files.project_id AND p.project_type = \'p5js\') AND project_id = ? AND path LIKE ?',
    [projectId, `${pathPrefix}/%`]
  );
  return result.affectedRows;
};

exports.touchUpdatedAt = async (fileId) => {
  const [result] = await db.query(
    'UPDATE files SET updated_at = CURRENT_TIMESTAMP WHERE EXISTS (SELECT 1 FROM projects p WHERE p.id = files.project_id AND p.project_type = \'p5js\') AND id = ?',
    [fileId]
  );
  return result.affectedRows;
};
