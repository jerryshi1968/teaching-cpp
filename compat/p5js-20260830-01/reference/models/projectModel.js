const db = require('../config/db');

const canAccessAllProjects = () => false;
const canUseTeacherFeatures = (user) => user?.role === 'teacher' || user?.role === 'admin';

exports.getConnection = () => db.getConnection();

exports.listForUser = async (userId, parentId = null) => {
  const [rows] = await db.query(
    `SELECT id, name, parent_id, sort_order, created_at, updated_at FROM projects WHERE user_id = ? AND ${parentId === null ? 'parent_id IS NULL' : 'parent_id = ?'} ORDER BY sort_order ASC, updated_at DESC`,
    parentId === null ? [userId] : [userId, parentId]
  );
  return rows;
};

exports.listAdminPaginated = async ({ limit, offset, authorName = '' }) => {
  const keyword = authorName.trim();
  const whereClause = keyword ? ' WHERE u.username LIKE ?' : '';
  const params = keyword ? [`%${keyword}%`, limit, offset] : [limit, offset];
  const [rows] = await db.query(
    `SELECT p.id, p.name, u.username AS author_name, p.created_at FROM projects p JOIN users u ON p.user_id = u.id${whereClause} ORDER BY p.created_at DESC, p.id DESC LIMIT ? OFFSET ?`,
    params
  );
  return rows;
};

exports.countAdminProjects = async ({ authorName = '' } = {}) => {
  const keyword = authorName.trim();
  const whereClause = keyword ? ' WHERE u.username LIKE ?' : '';
  const params = keyword ? [`%${keyword}%`] : [];
  const [rows] = await db.query(`SELECT COUNT(*) AS total FROM projects p JOIN users u ON p.user_id = u.id${whereClause}`, params);
  return Number(rows[0]?.total || 0);
};

exports.listVisibleToUser = async ({ currentUser, studentId, parentId = null }) => {
  if (!studentId) {
    return exports.listForUser(currentUser.id, parentId);
  }

  if (canAccessAllProjects(currentUser)) {
    return exports.listForUser(studentId, parentId);
  }

  if (!canUseTeacherFeatures(currentUser)) {
    return null;
  }

  const [rows] = await db.query(
    `SELECT p.id, p.name, p.created_at, p.updated_at
     FROM projects p
     JOIN users u ON p.user_id = u.id
     JOIN classes c ON u.class_code = c.class_code
     WHERE p.user_id = ? AND u.role = "student" AND c.teacher_user_id = ? AND ${parentId === null ? 'p.parent_id IS NULL' : 'p.parent_id = ?'}
     ORDER BY p.sort_order ASC, p.updated_at DESC`,
    parentId === null ? [studentId, currentUser.id] : [studentId, currentUser.id, parentId]
  );
  return rows;
};

const findTeacherAccessibleProjectById = async (projectId, user) => {
  const [rows] = await db.query(
    `SELECT p.id, p.name, p.user_id
     FROM projects p
     JOIN users u ON p.user_id = u.id
     JOIN classes c ON u.class_code = c.class_code
     WHERE p.id = ? AND u.role = "student" AND c.teacher_user_id = ?`,
    [projectId, user.id]
  );
  return rows[0] || null;
};

const findTeacherAccessibleProjectWithOwnerById = async (projectId, user) => {
  const [rows] = await db.query(
    `SELECT p.id, p.name, p.user_id, u.username AS owner_name
     FROM projects p
     JOIN users u ON p.user_id = u.id
     JOIN classes c ON u.class_code = c.class_code
     WHERE p.id = ? AND u.role = "student" AND c.teacher_user_id = ?`,
    [projectId, user.id]
  );
  return rows[0] || null;
};

exports.createWithConnection = async (connection, { id, userId, name, parentId = null, sortOrder = 0 }) => {
  await connection.query(
    'INSERT INTO projects (id, user_id, name, parent_id, sort_order) VALUES (?, ?, ?, ?, ?)',
    [id, userId, name, parentId, sortOrder]
  );
};

exports.findOwnedById = async (projectId, userId) => {
  const [rows] = await db.query(
    'SELECT id, user_id, parent_id, sort_order FROM projects WHERE id = ? AND user_id = ?',
    [projectId, userId]
  );
  return rows[0] || null;
};

exports.findOwnedByIdWithConnection = async (connection, projectId, userId) => {
  const [rows] = await connection.query(
    'SELECT id, user_id, parent_id, sort_order FROM projects WHERE id = ? AND user_id = ? FOR UPDATE',
    [projectId, userId]
  );
  return rows[0] || null;
};

exports.findAccessibleById = async (projectId, user) => {
  if (canAccessAllProjects(user)) {
    const [rows] = await db.query('SELECT id, name, user_id FROM projects WHERE id = ?', [projectId]);
    return rows[0] || null;
  }

  if (canUseTeacherFeatures(user)) {
    const ownProject = await exports.findOwnedById(projectId, user.id);
    if (ownProject) {
      const [rows] = await db.query('SELECT id, name, user_id FROM projects WHERE id = ?', [projectId]);
      return rows[0] || null;
    }

    return findTeacherAccessibleProjectById(projectId, user);
  }

  const [rows] = await db.query(
    'SELECT id, name, user_id FROM projects WHERE id = ? AND user_id = ?',
    [projectId, user.id]
  );
  return rows[0] || null;
};

exports.findAccessibleWithOwnerById = async (projectId, user) => {
  if (canAccessAllProjects(user)) {
    const [rows] = await db.query(
      `SELECT p.id, p.name, p.user_id, u.username AS owner_name
       FROM projects p
       JOIN users u ON p.user_id = u.id
       WHERE p.id = ?`,
      [projectId]
    );
    return rows[0] || null;
  }

  if (canUseTeacherFeatures(user)) {
    const [ownRows] = await db.query(
      `SELECT p.id, p.name, p.user_id, u.username AS owner_name
       FROM projects p
       JOIN users u ON p.user_id = u.id
       WHERE p.id = ? AND p.user_id = ?`,
      [projectId, user.id]
    );
    if (ownRows[0]) return ownRows[0];

    return findTeacherAccessibleProjectWithOwnerById(projectId, user);
  }

  const [rows] = await db.query(
    `SELECT p.id, p.name, p.user_id, u.username AS owner_name
     FROM projects p
     JOIN users u ON p.user_id = u.id
     WHERE p.id = ? AND p.user_id = ?`,
    [projectId, user.id]
  );
  return rows[0] || null;
};

exports.deleteById = async (projectId) => {
  const [result] = await db.query('DELETE FROM projects WHERE id = ?', [projectId]);
  return result.affectedRows;
};

exports.updateName = async ({ projectId, userId, name }) => {
  const [result] = await db.query(
    'UPDATE projects SET name = ? WHERE id = ? AND user_id = ?',
    [name, projectId, userId]
  );
  return result.affectedRows;
};

exports.move = async ({ projectId, userId, parentId = null }) => {
  const [result] = await db.query(
    'UPDATE projects SET parent_id = ? WHERE id = ? AND user_id = ?',
    [parentId, projectId, userId]
  );
  return result.affectedRows;
};

exports.reposition = async ({ projectId, userId, parentId = null, beforeId = null }) => {
  const connection = await db.getConnection();

  const listSiblingIds = async (siblingParentId) => {
    const [rows] = await connection.query(
      `SELECT id FROM projects WHERE user_id = ? AND ${siblingParentId === null ? 'parent_id IS NULL' : 'parent_id = ?'} ORDER BY sort_order ASC, updated_at DESC FOR UPDATE`,
      siblingParentId === null ? [userId] : [userId, siblingParentId]
    );
    return rows.map((row) => String(row.id));
  };

  const updateSiblingOrder = async (siblingParentId, orderedIds) => {
    for (let index = 0; index < orderedIds.length; index += 1) {
      await connection.query(
        `UPDATE projects SET sort_order = ?, updated_at = updated_at WHERE id = ? AND user_id = ? AND ${siblingParentId === null ? 'parent_id IS NULL' : 'parent_id = ?'}`,
        siblingParentId === null ? [index, orderedIds[index], userId] : [index, orderedIds[index], userId, siblingParentId]
      );
    }
  };

  try {
    await connection.beginTransaction();

    const [sourceRows] = await connection.query(
      'SELECT id, parent_id FROM projects WHERE id = ? AND user_id = ? FOR UPDATE',
      [projectId, userId]
    );
    const sourceProject = sourceRows[0];
    if (!sourceProject) {
      await connection.rollback();
      return { status: 'not_found' };
    }

    if (parentId !== null) {
      const [parentRows] = await connection.query(
        'SELECT id FROM project_groups WHERE id = ? AND user_id = ? FOR UPDATE',
        [parentId, userId]
      );
      if (!parentRows[0]) {
        await connection.rollback();
        return { status: 'invalid_parent' };
      }
    }

    const sourceParentId = sourceProject.parent_id === null ? null : Number(sourceProject.parent_id);
    const sourceIds = await listSiblingIds(sourceParentId);
    const targetIds = sourceParentId === parentId ? sourceIds : await listSiblingIds(parentId);
    const nextTargetIds = targetIds.filter((id) => id !== projectId);

    if (beforeId !== null && !nextTargetIds.includes(beforeId)) {
      await connection.rollback();
      return { status: 'invalid_before' };
    }

    const insertIndex = beforeId === null ? nextTargetIds.length : nextTargetIds.indexOf(beforeId);
    nextTargetIds.splice(insertIndex, 0, projectId);

    await connection.query(
      'UPDATE projects SET parent_id = ? WHERE id = ? AND user_id = ?',
      [parentId, projectId, userId]
    );

    if (sourceParentId !== parentId) {
      await updateSiblingOrder(sourceParentId, sourceIds.filter((id) => id !== projectId));
    }
    await updateSiblingOrder(parentId, nextTargetIds);

    await connection.commit();
    return { status: 'updated' };
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
};

exports.reorder = async ({ userId, parentId = null, orderedIds }) => {
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    for (let index = 0; index < orderedIds.length; index += 1) {
      await connection.query(
        `UPDATE projects SET sort_order = ? WHERE id = ? AND user_id = ? AND ${parentId === null ? 'parent_id IS NULL' : 'parent_id = ?'}`,
        parentId === null ? [index, orderedIds[index], userId] : [index, orderedIds[index], userId, parentId]
      );
    }

    await connection.commit();
  } catch (err) {
    await connection.rollback();
    throw err;
  } finally {
    connection.release();
  }
};

exports.clearParentId = async ({ userId, parentId }) => {
  const [result] = await db.query(
    'UPDATE projects SET parent_id = NULL WHERE user_id = ? AND parent_id = ?',
    [userId, parentId]
  );
  return result.affectedRows;
};
