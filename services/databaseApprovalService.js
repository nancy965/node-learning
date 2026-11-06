const pool = require("../config/databse");
const { createActivityLog } = require("./activityLogService");
const {
  createAdminNotification,
  createEmployeeNotification,
} = require("./notificationService");

const sendNotificationSafely = async (userId, role, title, message, type) => {
  if (!userId) return;
  try {
    if (role === "employee") {
      await createEmployeeNotification(userId, title, message, type);
    } else {
      await createAdminNotification(userId, title, message, type);
    }
  } catch (err) {
    try {
      await createEmployeeNotification(userId, title, message, type);
    } catch {}
  }
};

// Generate unique request code e.g. DB-CHG-1001, DB-CHG-1002
const generateChangeRequestCode = async (client) => {
  try {
    const res = await client.query(`
      SELECT COALESCE(MAX(CAST(NULLIF(regexp_replace(request_code, '[^0-9]', '', 'g'), '') AS INTEGER)), 1000) + 1 AS next_num
      FROM database_change_approvals
    `);
    const num = res.rows[0]?.next_num || 1001;
    return `DB-CHG-${num}`;
  } catch {
    const countRes = await client.query("SELECT COUNT(*) AS cnt FROM database_change_approvals");
    const nextNumber = 1001 + Number(countRes.rows[0]?.cnt || 0);
    return `DB-CHG-${nextNumber}`;
  }
};

/**
 * Create a new Database Change Approval Request (Maker-Checker workflow)
 */
const createChangeRequest = async ({
  moduleName = "USER_MANAGEMENT",
  tableName = "users",
  recordId,
  recordIdentifier,
  changeType = "UPDATE",
  changeSummary,
  oldData = {},
  newData = {},
  diffFields = [],
  user,
}) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    if (!recordId) throw new Error("Record ID is required for database change approval");
    if (!recordIdentifier) recordIdentifier = `Record #${recordId}`;
    recordIdentifier = String(recordIdentifier).replace(/\s*\([^)]*@[^)]*\)/g, "").trim() || recordIdentifier;
    if (!changeSummary) changeSummary = `Data change requested for ${tableName} (${recordIdentifier})`;

    const requestCode = await generateChangeRequestCode(client);
    const requestedBy = String(user.userId || user.id || "");
    const requestedByName = user.name || user.email || "Admin User";
    const requestedByRole = user.role || user.baseRole || "admin";

    const insertRes = await client.query(
      `INSERT INTO database_change_approvals (
        request_code,
        module_name,
        table_name,
        record_id,
        record_identifier,
        change_type,
        change_summary,
        old_data,
        new_data,
        diff_fields,
        status,
        requested_by,
        requested_by_name,
        requested_by_role,
        created_at,
        updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'PENDING', $11, $12, $13, NOW(), NOW())
      RETURNING *`,
      [
        requestCode,
        moduleName,
        tableName,
        String(recordId),
        recordIdentifier,
        changeType,
        changeSummary,
        JSON.stringify(oldData),
        JSON.stringify(newData),
        JSON.stringify(diffFields),
        requestedBy,
        requestedByName,
        requestedByRole,
      ]
    );

    const createdRecord = insertRes.rows[0];

    // Log Activity
    try {
      await createActivityLog(
        requestedBy,
        "DATABASE_CHANGE_REQUESTED",
        recordId,
        {
          requestCode,
          moduleName,
          tableName,
          changeSummary,
          diffFields,
        }
      );
    } catch (logErr) {
      console.warn("Failed to create activity log for DB change request:", logErr.message);
    }

    // Notify Admins
    try {
      const isUUID = (val) =>
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          String(val || "").trim()
        );
      const adminUsers = isUUID(requestedBy)
        ? await client.query(
            "SELECT id FROM admin WHERE role IN ('general_admin', 'super_admin', 'admin') AND id != $1 LIMIT 5",
            [requestedBy]
          )
        : await client.query(
            "SELECT id FROM admin WHERE role IN ('general_admin', 'super_admin', 'admin') LIMIT 5"
          );
      for (const adm of adminUsers.rows) {
        await createAdminNotification(
          adm.id,
          "Database Change Pending Approval",
          `${requestCode}: ${requestedByName} submitted changes for ${recordIdentifier}. Approval required before changes take effect.`,
          "db_approval_pending"
        );
      }
    } catch (notifErr) {
      console.warn("Notification error:", notifErr.message);
    }

    await client.query("COMMIT");
    return createdRecord;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Fetch database change requests with filters, search, and pagination
 */
const getChangeRequests = async ({
  status = "all",
  moduleName = "all",
  search = "",
  page = 1,
  limit = 10,
}) => {
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.max(1, parseInt(limit, 10) || 10);
  const offset = (pageNum - 1) * limitNum;

  const conditions = [];
  const params = [];
  let paramIdx = 1;

  if (status && status !== "all") {
    conditions.push(`LOWER(status) = LOWER($${paramIdx++})`);
    params.push(status);
  }

  if (moduleName && moduleName !== "all") {
    conditions.push(`LOWER(module_name) = LOWER($${paramIdx++})`);
    params.push(moduleName);
  }

  if (search && search.trim()) {
    conditions.push(`(
      request_code ILIKE $${paramIdx} OR
      record_identifier ILIKE $${paramIdx} OR
      change_summary ILIKE $${paramIdx} OR
      requested_by_name ILIKE $${paramIdx} OR
      reviewer_name ILIKE $${paramIdx}
    )`);
    params.push(`%${search.trim()}%`);
    paramIdx++;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  // Count query
  const countRes = await pool.query(
    `SELECT COUNT(*) AS total FROM database_change_approvals ${whereClause}`,
    params
  );
  const totalRecords = parseInt(countRes.rows[0]?.total || 0, 10);
  const totalPages = Math.ceil(totalRecords / limitNum) || 1;

  // Data query
  const dataQuery = `
    SELECT *
    FROM database_change_approvals
    ${whereClause}
    ORDER BY created_at DESC
    LIMIT $${paramIdx++} OFFSET $${paramIdx++}
  `;
  params.push(limitNum, offset);

  const dataRes = await pool.query(dataQuery, params);

  return {
    success: true,
    data: dataRes.rows,
    pagination: {
      page: pageNum,
      limit: limitNum,
      totalRecords,
      totalPages,
    },
  };
};

/**
 * Get summary stats for Database Changes
 */
const getChangeStats = async () => {
  const res = await pool.query(`
    SELECT
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE LOWER(status) = 'pending') AS pending,
      COUNT(*) FILTER (WHERE LOWER(status) = 'approved') AS approved,
      COUNT(*) FILTER (WHERE LOWER(status) = 'rejected') AS rejected,
      COUNT(*) FILTER (WHERE LOWER(status) = 'reverted') AS reverted
    FROM database_change_approvals
  `);

  const row = res.rows[0] || {};
  return {
    total: parseInt(row.total || 0, 10),
    pending: parseInt(row.pending || 0, 10),
    approved: parseInt(row.approved || 0, 10),
    rejected: parseInt(row.rejected || 0, 10),
    reverted: parseInt(row.reverted || 0, 10),
  };
};

/**
 * Get single request details by ID or code
 */
const getChangeRequestById = async (id) => {
  let query = "SELECT * FROM database_change_approvals WHERE id = $1";
  let param = id;

  if (typeof id === "string" && id.startsWith("DB-CHG-")) {
    query = "SELECT * FROM database_change_approvals WHERE request_code = $1";
  }

  const res = await pool.query(query, [param]);
  if (res.rows.length === 0) {
    return null;
  }
  return res.rows[0];
};

/**
 * Approve a Database Change Request and atomically apply proposed changes
 */
const approveChangeRequest = async (id, reviewerUser, comment = "") => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Fetch and lock the change row
    const lockRes = await client.query(
      "SELECT * FROM database_change_approvals WHERE id = $1 FOR UPDATE",
      [id]
    );

    if (lockRes.rows.length === 0) {
      throw new Error("Change request not found");
    }

    const request = lockRes.rows[0];
    if (request.status !== "PENDING") {
      throw new Error(`Request cannot be approved because current status is '${request.status}'`);
    }

    const { table_name, record_id, new_data, old_data } = request;
    const reviewerId = String(reviewerUser.userId || reviewerUser.id || "");
    const reviewerName = reviewerUser.name || reviewerUser.email || "Admin Reviewer";

    // Atomically Apply changes to target table
    if (table_name === "users") {
      const updates = [];
      const updateParams = [];
      let pIdx = 1;

      // Check fields in new_data
      const allowedFields = [
        "name",
        "email",
        "age",
        "role",
        "is_active",
        "admin_id",
        "role_id",
        "country_id",
        "state_id",
        "city_id",
        "pincode_id",
      ];

      for (const field of allowedFields) {
        if (new_data[field] !== undefined) {
          updates.push(`${field} = $${pIdx++}`);
          updateParams.push(new_data[field]);
        }
      }

      if (updates.length > 0) {
        updateParams.push(record_id);
        const updateSql = `UPDATE users SET ${updates.join(", ")} WHERE id = $${pIdx} RETURNING *`;
        const userUpdateRes = await client.query(updateSql, updateParams);
        if (userUpdateRes.rows.length === 0) {
          throw new Error(`Target user record '${record_id}' not found in live database`);
        }
      }

      // Handle admin employee_count adjustments if assigned admin changed
      if (new_data.admin_id && old_data.admin_id && new_data.admin_id !== old_data.admin_id) {
        await client.query(
          "UPDATE admin SET employee_count = GREATEST(0, employee_count - 1) WHERE id = $1",
          [old_data.admin_id]
        );
        await client.query(
          "UPDATE admin SET employee_count = employee_count + 1 WHERE id = $1",
          [new_data.admin_id]
        );
      }
    } else if (table_name === "common_master") {
      const updates = [];
      const updateParams = [];
      let pIdx = 1;

      if (new_data.name !== undefined) {
        updates.push(`name = $${pIdx++}`);
        updateParams.push(new_data.name);
      }
      if (new_data.type !== undefined) {
        updates.push(`type = $${pIdx++}`);
        updateParams.push(new_data.type);
      }
      if (new_data.is_active !== undefined) {
        updates.push(`is_active = $${pIdx++}`);
        updateParams.push(new_data.is_active);
      }

      if (updates.length > 0) {
        updates.push(`updated_at = NOW()`);
        updateParams.push(record_id);
        await client.query(
          `UPDATE common_master SET ${updates.join(", ")} WHERE id = $${pIdx}`,
          updateParams
        );
      }
    }

    // Update approval status to APPROVED
    const updatedApprovalRes = await client.query(
      `UPDATE database_change_approvals
       SET status = 'APPROVED',
           reviewer_id = $1,
           reviewer_name = $2,
           reviewed_at = NOW(),
           updated_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [reviewerId, reviewerName, id]
    );

    // Audit Log
    try {
      await createActivityLog(
        reviewerId,
        "DATABASE_CHANGE_APPROVED",
        record_id,
        {
          requestCode: request.request_code,
          comment,
          tableName: table_name,
          diffFields: request.diff_fields,
        }
      );
    } catch (logErr) {
      console.warn("Log error:", logErr.message);
    }

    // Notify Requester
    const cleanTargetName = String(request.record_identifier || "record").replace(/\s*\([^)]*@[^)]*\)/g, "").trim();
    await sendNotificationSafely(
      request.requested_by,
      request.requested_by_role,
      "Database Change Approved & Applied",
      `${request.request_code}: Your requested database change for ${cleanTargetName} has been approved by ${reviewerName} and committed to the live database.`,
      "db_change_approved"
    );

    await client.query("COMMIT");
    return updatedApprovalRes.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Reject a Database Change Request
 */
const rejectChangeRequest = async (id, reviewerUser, reason = "") => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const lockRes = await client.query(
      "SELECT * FROM database_change_approvals WHERE id = $1 FOR UPDATE",
      [id]
    );

    if (lockRes.rows.length === 0) {
      throw new Error("Change request not found");
    }

    const request = lockRes.rows[0];
    if (request.status !== "PENDING") {
      throw new Error(`Request cannot be rejected because current status is '${request.status}'`);
    }

    const reviewerId = String(reviewerUser.userId || reviewerUser.id || "");
    const reviewerName = reviewerUser.name || reviewerUser.email || "Admin Reviewer";

    const updateRes = await client.query(
      `UPDATE database_change_approvals
       SET status = 'REJECTED',
           rejection_reason = $1,
           reviewer_id = $2,
           reviewer_name = $3,
           reviewed_at = NOW(),
           updated_at = NOW()
       WHERE id = $4
       RETURNING *`,
      [reason || "Rejected by reviewer", reviewerId, reviewerName, id]
    );

    // Audit Log
    try {
      await createActivityLog(
        reviewerId,
        "DATABASE_CHANGE_REJECTED",
        request.record_id,
        {
          requestCode: request.request_code,
          reason,
          tableName: request.table_name,
        }
      );
    } catch (logErr) {
      console.warn("Log error:", logErr.message);
    }

    // Notify Requester
    const cleanTargetName = String(request.record_identifier || "record").replace(/\s*\([^)]*@[^)]*\)/g, "").trim();
    await sendNotificationSafely(
      request.requested_by,
      request.requested_by_role,
      "Database Change Request Rejected",
      `${request.request_code}: Your change request for ${cleanTargetName} was rejected. Reason: ${reason || "No reason specified."}`,
      "db_change_rejected"
    );

    await client.query("COMMIT");
    return updateRes.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Rollback / Revert an Approved Database Change Request back to previous values
 */
const rollbackChangeRequest = async (id, reviewerUser, rollbackReason = "") => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const lockRes = await client.query(
      "SELECT * FROM database_change_approvals WHERE id = $1 FOR UPDATE",
      [id]
    );

    if (lockRes.rows.length === 0) {
      throw new Error("Change request not found");
    }

    const request = lockRes.rows[0];
    if (request.status !== "APPROVED") {
      throw new Error("Only approved changes can be rolled back");
    }
    if (request.is_reverted) {
      throw new Error("This change has already been rolled back");
    }

    const { table_name, record_id, old_data, new_data } = request;
    const reviewerId = String(reviewerUser.userId || reviewerUser.id || "");
    const reviewerName = reviewerUser.name || reviewerUser.email || "Admin Reviewer";

    // Atomically revert live table back to old_data
    if (table_name === "users") {
      const updates = [];
      const updateParams = [];
      let pIdx = 1;

      const allowedFields = [
        "name",
        "email",
        "age",
        "role",
        "is_active",
        "admin_id",
        "role_id",
        "country_id",
        "state_id",
        "city_id",
        "pincode_id",
      ];

      for (const field of allowedFields) {
        if (old_data[field] !== undefined) {
          updates.push(`${field} = $${pIdx++}`);
          updateParams.push(old_data[field]);
        }
      }

      if (updates.length > 0) {
        updateParams.push(record_id);
        const updateSql = `UPDATE users SET ${updates.join(", ")} WHERE id = $${pIdx} RETURNING *`;
        const userRevertRes = await client.query(updateSql, updateParams);
        if (userRevertRes.rows.length === 0) {
          throw new Error(`Target user record '${record_id}' not found in live database for rollback`);
        }
      }

      // Revert employee_count adjustments if assigned admin was previously changed
      if (new_data.admin_id && old_data.admin_id && new_data.admin_id !== old_data.admin_id) {
        await client.query(
          "UPDATE admin SET employee_count = GREATEST(0, employee_count - 1) WHERE id = $1",
          [new_data.admin_id]
        );
        await client.query(
          "UPDATE admin SET employee_count = employee_count + 1 WHERE id = $1",
          [old_data.admin_id]
        );
      }
    } else if (table_name === "common_master") {
      const updates = [];
      const updateParams = [];
      let pIdx = 1;

      if (old_data.name !== undefined) {
        updates.push(`name = $${pIdx++}`);
        updateParams.push(old_data.name);
      }
      if (old_data.type !== undefined) {
        updates.push(`type = $${pIdx++}`);
        updateParams.push(old_data.type);
      }
      if (old_data.is_active !== undefined) {
        updates.push(`is_active = $${pIdx++}`);
        updateParams.push(old_data.is_active);
      }

      if (updates.length > 0) {
        updates.push(`updated_at = NOW()`);
        updateParams.push(record_id);
        await client.query(
          `UPDATE common_master SET ${updates.join(", ")} WHERE id = $${pIdx}`,
          updateParams
        );
      }
    }

    // Mark as REVERTED
    const revertRes = await client.query(
      `UPDATE database_change_approvals
       SET status = 'REVERTED',
           is_reverted = TRUE,
           reverted_by = $1,
           reverted_by_name = $2,
           reverted_at = NOW(),
           rollback_reason = $3,
           updated_at = NOW()
       WHERE id = $4
       RETURNING *`,
      [reviewerId, reviewerName, rollbackReason || "Rolled back to previous version by reviewer", id]
    );

    // Audit Log for Rollback
    try {
      await createActivityLog(
        reviewerId,
        "DATABASE_CHANGE_ROLLBACK",
        record_id,
        {
          requestCode: request.request_code,
          rollbackReason,
          tableName: table_name,
          restoredData: old_data,
        }
      );
    } catch (logErr) {
      console.warn("Log error:", logErr.message);
    }

    // Notify Requester
    const cleanTargetName = String(request.record_identifier || "record").replace(/\s*\([^)]*@[^)]*\)/g, "").trim();
    await sendNotificationSafely(
      request.requested_by,
      request.requested_by_role,
      "Database Change Rolled Back",
      `${request.request_code}: The change on ${cleanTargetName} has been rolled back and restored to previous database values.`,
      "db_change_rollback"
    );

    await client.query("COMMIT");
    return revertRes.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

module.exports = {
  createChangeRequest,
  getChangeRequests,
  getChangeStats,
  getChangeRequestById,
  approveChangeRequest,
  rejectChangeRequest,
  rollbackChangeRequest,
};
