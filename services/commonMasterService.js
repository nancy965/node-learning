const pool = require("../config/databse");
const { createActivityLog } = require("./activityLogService");

/**
 * Get all active common master records for UI display
 */
const getAllMasterRecords = async () => {
  const result = await pool.query(`
    SELECT id, type, name, is_active, created_at, updated_at
    FROM common_master
    WHERE is_active = true
    ORDER BY type ASC, created_at ASC
  `);
  return result.rows;
};

/**
 * Get active common master records by type
 */
const getMasterRecordsByType = async (type) => {
  if (!type) {
    return [];
  }

  const result = await pool.query(
    `
    SELECT id, type, name, is_active, created_at, updated_at
    FROM common_master
    WHERE LOWER(type) = LOWER($1) AND is_active = true
    ORDER BY created_at ASC
    `,
    [type.trim()]
  );

  return result.rows;
};

/**
 * Add a new common master record (or reactivate soft-deleted one)
 */
const addMasterRecord = async (type, name, userId = null) => {
  const cleanType = String(type || "").trim();
  const cleanName = String(name || "").trim();

  if (!cleanType) {
    return {
      success: false,
      status: 400,
      message: "Type is required",
    };
  }

  if (!cleanName) {
    return {
      success: false,
      status: 400,
      message: "Name is required",
    };
  }

  // Check for duplicate within the same type (case-insensitive)
  const duplicateCheck = await pool.query(
    `
    SELECT id, is_active FROM common_master
    WHERE LOWER(type) = LOWER($1) AND LOWER(name) = LOWER($2)
    LIMIT 1
    `,
    [cleanType, cleanName]
  );

  if (duplicateCheck.rows.length > 0) {
    const existing = duplicateCheck.rows[0];
    if (existing.is_active) {
      return {
        success: false,
        status: 409,
        message: `"${cleanName}" already exists in ${cleanType}`,
      };
    } else {
      // Reactivate previously soft-deleted record
      const reactivateResult = await pool.query(
        `
        UPDATE common_master
        SET is_active = true, updated_at = NOW()
        WHERE id = $1
        RETURNING id, type, name, is_active, created_at, updated_at
        `,
        [existing.id]
      );

      const reactivatedRecord = reactivateResult.rows[0];

      if (userId) {
        try {
          await createActivityLog(
            userId,
            "CREATE_COMMON_MASTER",
            userId,
            {
              masterId: reactivatedRecord.id,
              module: "Common Master",
              type: cleanType,
              newData: {
                name: cleanName,
                type: cleanType,
                status: "Active",
              },
            }
          );
        } catch (logErr) {
          console.error("Activity log error (CREATE_COMMON_MASTER):", logErr);
        }
      }

      return {
        success: true,
        status: 200,
        data: reactivatedRecord,
        message: "Master value added successfully",
      };
    }
  }

  const insertResult = await pool.query(
    `
    INSERT INTO common_master (type, name, is_active)
    VALUES ($1, $2, true)
    RETURNING id, type, name, is_active, created_at, updated_at
    `,
    [cleanType, cleanName]
  );

  const newRecord = insertResult.rows[0];

  if (userId) {
    try {
      await createActivityLog(
        userId,
        "CREATE_COMMON_MASTER",
        userId,
        {
          masterId: newRecord.id,
          module: "Common Master",
          type: cleanType,
          newData: {
            name: cleanName,
            type: cleanType,
            status: "Active",
          },
        }
      );
    } catch (logErr) {
      console.error("Activity log error (CREATE_COMMON_MASTER):", logErr);
    }
  }

  return {
    success: true,
    status: 201,
    data: newRecord,
    message: "Master value added successfully",
  };
};

/**
 * Update / rename a master record and propagate changes to referenced tables
 */
const updateMasterRecord = async (id, newName, userId = null) => {
  const cleanName = String(newName || "").trim();

  if (!cleanName) {
    return {
      success: false,
      status: 400,
      message: "Name is required",
    };
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 1. Fetch current record
    const existingResult = await client.query(
      `SELECT id, type, name FROM common_master WHERE id = $1`,
      [id]
    );

    if (existingResult.rows.length === 0) {
      await client.query("ROLLBACK");
      return {
        success: false,
        status: 404,
        message: "Record not found",
      };
    }

    const currentRecord = existingResult.rows[0];
    const oldName = currentRecord.name;
    const type = currentRecord.type;

    // 2. Check for duplicate with other records of the same type
    const duplicateCheck = await client.query(
      `
      SELECT id FROM common_master
      WHERE LOWER(type) = LOWER($1) AND LOWER(name) = LOWER($2) AND id != $3
      LIMIT 1
      `,
      [type, cleanName, id]
    );

    if (duplicateCheck.rows.length > 0) {
      await client.query("ROLLBACK");
      return {
        success: false,
        status: 409,
        message: `"${cleanName}" already exists in ${type}`,
      };
    }

    // 3. Update common_master
    const updateResult = await client.query(
      `
      UPDATE common_master
      SET name = $1, updated_at = NOW()
      WHERE id = $2
      RETURNING id, type, name, is_active, created_at, updated_at
      `,
      [cleanName, id]
    );

    // 4. Propagate rename if name actually changed
    if (oldName.toLowerCase() !== cleanName.toLowerCase()) {
      if (
        type.toLowerCase() === "task_type" ||
        type.toLowerCase() === "task_frequency" ||
        type.toLowerCase() === "ticket_category" ||
        type.toLowerCase() === "ticket_priority" ||
        type.toLowerCase() === "approval_request_type"
      ) {
        // Child tables store common_master UUID foreign keys; references automatically persist on rename!
      }
    }

    await client.query("COMMIT");

    if (userId) {
      try {
        await createActivityLog(
          userId,
          "UPDATE_COMMON_MASTER",
          userId,
          {
            masterId: id,
            module: "Common Master",
            type: type,
            oldData: {
              name: oldName,
              type: type,
            },
            newData: {
              name: cleanName,
              type: type,
            },
          }
        );
      } catch (logErr) {
        console.error("Activity log error (UPDATE_COMMON_MASTER):", logErr);
      }
    }

    return {
      success: true,
      status: 200,
      data: updateResult.rows[0],
      message: "Master value updated successfully",
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
};

/**
 * Soft-delete a master record: set is_active = false so it disappears from UI while preserving the DB record
 */
const deleteMasterRecord = async (id, userId = null) => {
  const existingResult = await pool.query(
    `SELECT id, type, name, is_active FROM common_master WHERE id = $1`,
    [id]
  );

  if (existingResult.rows.length === 0) {
    return {
      success: false,
      status: 404,
      message: "Record not found",
    };
  }

  const { type, name } = existingResult.rows[0];

  // Soft delete: update is_active to false in database without deleting the row
  const updateResult = await pool.query(
    `
    UPDATE common_master
    SET is_active = false, updated_at = NOW()
    WHERE id = $1
    RETURNING id, type, name, is_active, created_at, updated_at
    `,
    [id]
  );

  if (userId) {
    try {
      await createActivityLog(
        userId,
        "DELETE_COMMON_MASTER",
        userId,
        {
          masterId: id,
          module: "Common Master",
          type: type,
          oldData: {
            name: name,
            type: type,
            status: "Active",
          },
          newData: {
            name: name,
            type: type,
            status: "Inactive",
          },
        }
      );
    } catch (logErr) {
      console.error("Activity log error (DELETE_COMMON_MASTER):", logErr);
    }
  }

  return {
    success: true,
    status: 200,
    data: updateResult.rows[0],
    message: `"${name}" deleted successfully`,
  };
};

/**
 * Toggle active status
 */
const toggleMasterStatus = async (id, userId = null) => {
  const existingResult = await pool.query(
    `SELECT id, type, name, is_active FROM common_master WHERE id = $1`,
    [id]
  );

  if (existingResult.rows.length === 0) {
    return {
      success: false,
      status: 404,
      message: "Record not found",
    };
  }

  const previousRecord = existingResult.rows[0];

  const result = await pool.query(
    `
    UPDATE common_master
    SET is_active = NOT is_active, updated_at = NOW()
    WHERE id = $1
    RETURNING id, type, name, is_active, created_at, updated_at
    `,
    [id]
  );

  const updatedRecord = result.rows[0];

  if (userId) {
    try {
      await createActivityLog(
        userId,
        "TOGGLE_COMMON_MASTER_STATUS",
        userId,
        {
          masterId: id,
          module: "Common Master",
          type: updatedRecord.type,
          oldData: {
            name: previousRecord.name,
            status: previousRecord.is_active ? "Active" : "Inactive",
          },
          newData: {
            name: updatedRecord.name,
            status: updatedRecord.is_active ? "Active" : "Inactive",
          },
        }
      );
    } catch (logErr) {
      console.error("Activity log error (TOGGLE_COMMON_MASTER_STATUS):", logErr);
    }
  }

  return {
    success: true,
    status: 200,
    data: updatedRecord,
    message: `Master value ${updatedRecord.is_active ? "activated" : "deactivated"} successfully`,
  };
};

module.exports = {
  getAllMasterRecords,
  getMasterRecordsByType,
  addMasterRecord,
  updateMasterRecord,
  deleteMasterRecord,
  toggleMasterStatus,
};
