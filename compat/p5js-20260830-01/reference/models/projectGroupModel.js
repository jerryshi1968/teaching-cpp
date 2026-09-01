const db = require('../config/db');

exports.listForUser = async ({ userId, parentId = null }) => {
  const [rows] = await db.query(
    `SELECT id, user_id, name, parent_id, sort_order, created_at, updated_at
     FROM project_groups
     WHERE user_id = ? AND ${parentId === null ? 'parent_id IS NULL' : 'parent_id = ?'}
     ORDER BY sort_order ASC, created_at DESC, id DESC`,
    parentId === null ? [userId] : [userId, parentId]
  );
  return rows;
};

exports.listAllForUser = async (userId) => {
  const [rows] = await db.query(
    `SELECT id, user_id, name, parent_id, sort_order, created_at, updated_at
     FROM project_groups
     WHERE user_id = ?
     ORDER BY parent_id IS NOT NULL ASC, parent_id ASC, sort_order ASC, created_at DESC, id DESC`,
    [userId]
  );
  return rows;
};

exports.findOwnedById = async ({ id, userId }) => {
  const [rows] = await db.query(
    'SELECT id, user_id, name, parent_id, sort_order FROM project_groups WHERE id = ? AND user_id = ?',
    [id, userId]
  );
  return rows[0] || null;
};

exports.isDescendantOf = async ({ userId, groupId, possibleDescendantId }) => {
  const [rows] = await db.query(
    `WITH RECURSIVE group_tree AS (
       SELECT id FROM project_groups WHERE id = ? AND user_id = ?
       UNION ALL
       SELECT pg.id FROM project_groups pg
       JOIN group_tree gt ON pg.parent_id = gt.id
       WHERE pg.user_id = ?
     )
     SELECT id FROM group_tree WHERE id = ? LIMIT 1`,
    [groupId, userId, userId, possibleDescendantId]
  );
  return rows.length > 0;
};

exports.create = async ({ userId, name, parentId = null, sortOrder = 0 }) => {
  const [result] = await db.query(
    'INSERT INTO project_groups (user_id, name, parent_id, sort_order) VALUES (?, ?, ?, ?)',
    [userId, name, parentId, sortOrder]
  );
  return result.insertId;
};

exports.updateName = async ({ id, userId, name }) => {
  const [result] = await db.query(
    'UPDATE project_groups SET name = ? WHERE id = ? AND user_id = ?',
    [name, id, userId]
  );
  return result.affectedRows;
};

exports.move = async ({ id, userId, parentId = null }) => {
  const [result] = await db.query(
    'UPDATE project_groups SET parent_id = ? WHERE id = ? AND user_id = ?',
    [parentId, id, userId]
  );
  return result.affectedRows;
};

exports.reposition = async ({ id, userId, parentId = null, beforeId = null }) => {
  const connection = await db.getConnection();

  const listSiblingIds = async (siblingParentId) => {
    const [rows] = await connection.query(
      `SELECT id FROM project_groups WHERE user_id = ? AND ${siblingParentId === null ? 'parent_id IS NULL' : 'parent_id = ?'} ORDER BY sort_order ASC, created_at DESC, id DESC FOR UPDATE`,
      siblingParentId === null ? [userId] : [userId, siblingParentId]
    );
    return rows.map((row) => Number(row.id));
  };

  const updateSiblingOrder = async (siblingParentId, orderedIds) => {
    for (let index = 0; index < orderedIds.length; index += 1) {
      await connection.query(
        `UPDATE project_groups SET sort_order = ? WHERE id = ? AND user_id = ? AND ${siblingParentId === null ? 'parent_id IS NULL' : 'parent_id = ?'}`,
        siblingParentId === null ? [index, orderedIds[index], userId] : [index, orderedIds[index], userId, siblingParentId]
      );
    }
  };

  try {
    await connection.beginTransaction();

    const [sourceRows] = await connection.query(
      'SELECT id, parent_id FROM project_groups WHERE id = ? AND user_id = ? FOR UPDATE',
      [id, userId]
    );
    const sourceGroup = sourceRows[0];
    if (!sourceGroup) {
      await connection.rollback();
      return { status: 'not_found' };
    }

    if (parentId === id) {
      await connection.rollback();
      return { status: 'invalid_parent' };
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

      const [descendantRows] = await connection.query(
        `WITH RECURSIVE group_tree AS (
           SELECT id FROM project_groups WHERE id = ? AND user_id = ?
           UNION ALL
           SELECT pg.id FROM project_groups pg
           JOIN group_tree gt ON pg.parent_id = gt.id
           WHERE pg.user_id = ?
         )
         SELECT id FROM group_tree WHERE id = ? LIMIT 1`,
        [id, userId, userId, parentId]
      );
      if (descendantRows.length > 0) {
        await connection.rollback();
        return { status: 'descendant' };
      }
    }

    const sourceParentId = sourceGroup.parent_id === null ? null : Number(sourceGroup.parent_id);
    const sourceIds = await listSiblingIds(sourceParentId);
    const targetIds = sourceParentId === parentId ? sourceIds : await listSiblingIds(parentId);
    const nextTargetIds = targetIds.filter((groupId) => groupId !== id);

    if (beforeId !== null && !nextTargetIds.includes(beforeId)) {
      await connection.rollback();
      return { status: 'invalid_before' };
    }

    const insertIndex = beforeId === null ? nextTargetIds.length : nextTargetIds.indexOf(beforeId);
    nextTargetIds.splice(insertIndex, 0, id);

    await connection.query(
      'UPDATE project_groups SET parent_id = ? WHERE id = ? AND user_id = ?',
      [parentId, id, userId]
    );

    if (sourceParentId !== parentId) {
      await updateSiblingOrder(sourceParentId, sourceIds.filter((groupId) => groupId !== id));
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
        `UPDATE project_groups SET sort_order = ? WHERE id = ? AND user_id = ? AND ${parentId === null ? 'parent_id IS NULL' : 'parent_id = ?'}`,
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

exports.countProjectsRecursive = async ({ userId, groupId }) => {
  const [rows] = await db.query(
    `WITH RECURSIVE group_tree AS (
       SELECT id FROM project_groups WHERE id = ? AND user_id = ?
       UNION ALL
       SELECT pg.id FROM project_groups pg
       JOIN group_tree gt ON pg.parent_id = gt.id
       WHERE pg.user_id = ?
     )
     SELECT COUNT(*) AS total
     FROM projects p
     JOIN group_tree gt ON p.parent_id = gt.id
     WHERE p.user_id = ?`,
    [groupId, userId, userId, userId]
  );
  return Number(rows[0]?.total || 0);
};

exports.countDescendantGroups = async ({ userId, groupId }) => {
  const [rows] = await db.query(
    `WITH RECURSIVE group_tree AS (
       SELECT id FROM project_groups WHERE id = ? AND user_id = ?
       UNION ALL
       SELECT pg.id FROM project_groups pg
       JOIN group_tree gt ON pg.parent_id = gt.id
       WHERE pg.user_id = ?
     )
     SELECT COUNT(*) AS total
     FROM group_tree
     WHERE id <> ?`,
    [groupId, userId, userId, groupId]
  );
  return Number(rows[0]?.total || 0);
};

exports.deleteEmptyById = async ({ id, userId }) => {
  const [result] = await db.query(
    'DELETE FROM project_groups WHERE id = ? AND user_id = ?',
    [id, userId]
  );
  return result.affectedRows;
};

exports.getBreadcrumbs = async ({ userId, groupId }) => {
  if (groupId === null) return [];

  const [rows] = await db.query(
    `WITH RECURSIVE breadcrumbs AS (
       SELECT id, name, parent_id, 0 AS depth
       FROM project_groups
       WHERE id = ? AND user_id = ?
       UNION ALL
       SELECT pg.id, pg.name, pg.parent_id, b.depth + 1 AS depth
       FROM project_groups pg
       JOIN breadcrumbs b ON b.parent_id = pg.id
       WHERE pg.user_id = ?
     )
     SELECT id, name, parent_id
     FROM breadcrumbs
     ORDER BY depth DESC`,
    [groupId, userId, userId]
  );
  return rows;
};
