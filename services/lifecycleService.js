const pool = require("../config/databse");
const { createActivityLog } = require("./activityLogService");
const {
  createEmployeeNotification,
  createAdminNotification,
} = require("./notificationService");
const { decodeUUIDToId } = require("../utils/uuidUtils");

// Generate unique lifecycle code e.g. LC-1001
const generateRecordCode = async (client) => {
  try {
    const res = await client.query(`
      SELECT COALESCE(MAX(CAST(NULLIF(regexp_replace(record_code, '[^0-9]', '', 'g'), '') AS INTEGER)), 1000) + 1 AS next_num
      FROM employee_lifecycle_records;
    `);
    const nextNum = res.rows[0]?.next_num || 1001;
    return `LC-${nextNum}`;
  } catch {
    return `LC-${Date.now().toString().slice(-4)}`;
  }
};

// 1. Get all templates with item counts
const getTemplates = async () => {
  const result = await pool.query(`
    SELECT
      t.*,
      COUNT(i.id)::int AS total_items,
      COUNT(CASE WHEN i.is_required = true THEN 1 END)::int AS required_items,
      COALESCE(
        json_agg(
          json_build_object(
            'id', i.id,
            'title', i.title,
            'category', i.category,
            'assignee_role', i.assignee_role,
            'due_days_offset', i.due_days_offset,
            'is_required', i.is_required,
            'order_index', i.order_index
          ) ORDER BY i.order_index ASC
        ) FILTER (WHERE i.id IS NOT NULL),
        '[]'
      ) AS items
    FROM lifecycle_templates t
    LEFT JOIN lifecycle_template_items i ON i.template_id = t.id
    WHERE t.is_active = true
    GROUP BY t.id
    ORDER BY t.type ASC, t.id ASC;
  `);

  return result.rows;
};

// 2. Create custom template
const createTemplate = async (templateData, user) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { title, type, department, description, items = [] } = templateData;

    if (!title || !title.trim()) throw new Error("Template title is required");
    if (!["onboarding", "offboarding"].includes(type)) {
      throw new Error("Invalid type. Must be 'onboarding' or 'offboarding'");
    }

    const tplRes = await client.query(`
      INSERT INTO lifecycle_templates (title, type, department, description, is_active)
      VALUES ($1, $2, $3, $4, true)
      RETURNING *;
    `, [title.trim(), type, department || "General", description || ""]);

    const newTpl = tplRes.rows[0];

    if (items && items.length > 0) {
      for (let idx = 0; idx < items.length; idx++) {
        const itm = items[idx];
        await client.query(`
          INSERT INTO lifecycle_template_items
            (template_id, title, category, assignee_role, due_days_offset, is_required, order_index)
          VALUES ($1, $2, $3, $4, $5, $6, $7);
        `, [
          newTpl.id,
          itm.title.trim(),
          itm.category || "General",
          itm.assignee_role || "admin",
          parseInt(itm.due_days_offset, 10) || 1,
          itm.is_required !== false,
          idx + 1,
        ]);
      }
    }

    await createActivityLog(
      user.userId,
      "LIFECYCLE_TEMPLATE_CREATED",
      null,
      { templateId: newTpl.id, title: newTpl.title, type: newTpl.type }
    );

    await client.query("COMMIT");
    return newTpl;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
};

// 3. Get Eligible Employees for Onboarding / Offboarding
const getEligibleEmployees = async (type = "onboarding", search = "") => {
  let query = "";
  const params = [];

  if (type === "onboarding") {
    // Show only newly created employees who haven't completed or undergone onboarding
    query = `
      SELECT
        u.id,
        u.name,
        u.email,
        u.role,
        u.created_at,
        u.is_active,
        COALESCE(u.lifecycle_status, 'Active') AS lifecycle_status,
        r.record_code AS active_lifecycle_code
      FROM users u
      LEFT JOIN employee_lifecycle_records r
        ON r.employee_id = u.id AND r.type = 'onboarding'
      WHERE u.role = 'employee'
        AND r.id IS NULL
    `;
  } else {
    // Offboarding: Only active employees who do not have an active offboarding
    query = `
      SELECT
        u.id,
        u.name,
        u.email,
        u.role,
        u.created_at,
        u.is_active,
        COALESCE(u.lifecycle_status, 'Active') AS lifecycle_status,
        r.record_code AS active_lifecycle_code
      FROM users u
      LEFT JOIN employee_lifecycle_records r
        ON r.employee_id = u.id AND r.status = 'In Progress' AND r.type = 'offboarding'
      WHERE u.role = 'employee'
        AND u.is_active = true
        AND r.id IS NULL
    `;
  }

  if (search && search.trim()) {
    params.push(`%${search.trim().toLowerCase()}%`);
    query += ` AND (LOWER(u.name) LIKE $${params.length} OR LOWER(u.email) LIKE $${params.length})`;
  }

  if (type === "onboarding") {
    query += ` ORDER BY u.created_at DESC, u.id DESC LIMIT 50;`;
  } else {
    query += ` ORDER BY u.name ASC LIMIT 50;`;
  }

  const result = await pool.query(query, params);
  return result.rows;
};

// 4. Start Lifecycle Record (Launch Onboarding or Offboarding)
const startLifecycleRecord = async (data, user) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { employeeId, templateId, targetDate, notes } = data;

    if (!employeeId) throw new Error("Employee is required");
    if (!templateId) throw new Error("Template is required");
    if (!targetDate) throw new Error("Target date (joining or exit date) is required");

    // Fetch employee
    const empRes = await client.query(
      `SELECT id, name, email, is_active, admin_id FROM users WHERE id = $1;`,
      [employeeId]
    );
    if (empRes.rows.length === 0) throw new Error("Employee not found");
    const employee = empRes.rows[0];

    // Fetch template
    const tplRes = await client.query(
      `SELECT * FROM lifecycle_templates WHERE id = $1 AND is_active = true;`,
      [templateId]
    );
    if (tplRes.rows.length === 0) throw new Error("Template not found or inactive");
    const template = tplRes.rows[0];

    // Check if employee already has an active record of this type
    const dupCheck = await client.query(
      `SELECT id, record_code FROM employee_lifecycle_records WHERE employee_id = $1 AND type = $2 AND status = 'In Progress';`,
      [employeeId, template.type]
    );
    if (dupCheck.rows.length > 0) {
      throw new Error(`An active ${template.type} process (${dupCheck.rows[0].record_code}) is already in progress for ${employee.name}.`);
    }

    // Get user initiator name
    let initiatorName = "Administrator";
    const initRes = await client.query(
      `SELECT name FROM admin WHERE id = $1 UNION SELECT name FROM users WHERE id = $1 LIMIT 1;`,
      [user.userId]
    );
    if (initRes.rows.length > 0) initiatorName = initRes.rows[0].name;

    const recordCode = await generateRecordCode(client);

    // Insert record
    const insertRec = await client.query(`
      INSERT INTO employee_lifecycle_records
        (record_code, employee_id, template_id, type, target_date, status, progress_pct, notes, initiated_by, initiated_by_name)
      VALUES ($1, $2, $3, $4, $5, 'In Progress', 0, $6, $7, $8)
      RETURNING *;
    `, [
      recordCode,
      employeeId,
      templateId,
      template.type,
      targetDate,
      notes || "",
      user.userId,
      initiatorName,
    ]);

    const record = insertRec.rows[0];

    // Update user's lifecycle_status
    const newStatus = template.type === "onboarding" ? "Onboarding" : "Offboarding";
    await client.query(`UPDATE users SET lifecycle_status = $1 WHERE id = $2;`, [newStatus, employeeId]);

    // Fetch template items blueprint
    const itemsRes = await client.query(
      `SELECT * FROM lifecycle_template_items WHERE template_id = $1 ORDER BY order_index ASC;`,
      [templateId]
    );

    const baseTarget = new Date(targetDate);

    // Create checklist items and integrate with Task system
    for (const itm of itemsRes.rows) {
      const itemDue = new Date(baseTarget);
      itemDue.setDate(itemDue.getDate() + (itm.due_days_offset || 0));
      const formattedDueDate = itemDue.toISOString().split("T")[0];

      // Assignee defaults: if category is HR/IT, assign to the admin initiator; if Manager, assign to employee's manager
      let assignedToId = user.userId;
      let assignedToName = initiatorName;

      if (itm.assignee_role === "employee") {
        assignedToId = employee.id;
        assignedToName = employee.name;
      } else if (itm.assignee_role === "manager" && employee.admin_id) {
        assignedToId = employee.admin_id;
        const mgrRes = await client.query(`SELECT name FROM admin WHERE id = $1;`, [employee.admin_id]);
        if (mgrRes.rows.length > 0) assignedToName = mgrRes.rows[0].name;
      }

      // Automatically create a linked task in existing 'tasks' table for employee-assigned checklist items
      let linkedTaskId = null;
      if (itm.assignee_role === "employee" || String(assignedToId) === String(employee.id)) {
        try {
          await client.query("SAVEPOINT task_sp");
          const taskInsert = await client.query(`
            INSERT INTO tasks
              (task_name, assigned_to, assigned_by, task_date, due_date, task_type, status)
            VALUES ($1, $2, $3, CURRENT_DATE, $4, 'normal', 'Pending')
            RETURNING id;
          `, [
            `[${recordCode}] ${itm.title}`,
            employee.id,
            user.userId,
            formattedDueDate,
          ]);
          if (taskInsert.rows.length > 0) {
            linkedTaskId = taskInsert.rows[0].id;
          }
          await client.query("RELEASE SAVEPOINT task_sp");
        } catch (taskErr) {
          await client.query("ROLLBACK TO SAVEPOINT task_sp");
          console.warn("Could not auto-create linked task (continuing checklist item):", taskErr.message);
        }
      }

      await client.query(`
        INSERT INTO lifecycle_checklist_items
          (record_id, title, category, assignee_role, assigned_to, assigned_to_name, due_date, is_completed, linked_task_id, order_index)
        VALUES ($1, $2, $3, $4, $5, $6, $7, false, $8, $9);
      `, [
        record.id,
        itm.title,
        itm.category,
        itm.assignee_role,
        assignedToId,
        assignedToName,
        formattedDueDate,
        linkedTaskId,
        itm.order_index,
      ]);
    }

    // Send notifications to Employee
    await createEmployeeNotification(
      employee.id,
      `${template.type === "onboarding" ? "Welcome! Onboarding" : "Offboarding"} Started`,
      `Your ${template.type} process has been initiated with target date ${targetDate}. Reference: ${recordCode}`,
      "lifecycle_update"
    ).catch(() => {});

    // Notify Reporting Manager if assigned
    if (employee.admin_id) {
      await createAdminNotification(
        employee.admin_id,
        `New ${template.type === "onboarding" ? "Onboarding" : "Offboarding"} Workflow`,
        `A ${template.type} process has been initiated for your direct report ${employee.name}. Target date: ${targetDate}. Reference: ${recordCode}`,
      ).catch(() => {});
    }

    // Activity log
    await createActivityLog(
      user.userId,
      `LIFECYCLE_${template.type.toUpperCase()}_STARTED`,
      employee.id,
      { recordCode, employeeName: employee.name, templateTitle: template.title, targetDate }
    );

    await client.query("COMMIT");
    return record;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
};

// 5. Get Lifecycle Records with filter, search & stats
const getLifecycleRecords = async (filters = {}, user) => {
  const { type = "all", status = "all", search = "", page = 1, limit = 10 } = filters;
  const offset = (page - 1) * limit;

  let whereClauses = ["1=1"];
  const params = [];

  if (type && type !== "all") {
    params.push(type);
    whereClauses.push(`r.type = $${params.length}`);
  }

  if (status && status !== "all") {
    params.push(status);
    whereClauses.push(`r.status = $${params.length}`);
  }

  if (search && search.trim()) {
    params.push(`%${search.trim().toLowerCase()}%`);
    whereClauses.push(`(
      LOWER(r.record_code) LIKE $${params.length}
      OR LOWER(u.name) LIKE $${params.length}
      OR LOWER(u.email) LIKE $${params.length}
      OR LOWER(t.title) LIKE $${params.length}
    )`);
  }

  const whereStr = whereClauses.join(" AND ");

  // Total count
  const countRes = await pool.query(`
    SELECT COUNT(DISTINCT r.id)::int AS total
    FROM employee_lifecycle_records r
    JOIN users u ON u.id = r.employee_id
    LEFT JOIN lifecycle_templates t ON t.id = r.template_id
    WHERE ${whereStr};
  `, params);

  const totalRecords = countRes.rows[0]?.total || 0;

  // Main data with aggregated checklist statistics
  params.push(limit);
  const limitIdx = params.length;
  params.push(offset);
  const offsetIdx = params.length;

  const dataRes = await pool.query(`
    SELECT
      r.*,
      u.name AS employee_name,
      u.email AS employee_email,
      u.role AS employee_role,
      u.created_at AS employee_joined_date,
      u.is_active AS employee_is_active,
      COALESCE(u.lifecycle_status, 'Active') AS employee_lifecycle_status,
      t.title AS template_title,
      t.department AS template_department,
      COUNT(i.id)::int AS total_items,
      COUNT(CASE WHEN i.is_completed = true THEN 1 END)::int AS completed_items,
      COUNT(CASE WHEN i.is_completed = false AND i.due_date < CURRENT_DATE THEN 1 END)::int AS overdue_items
    FROM employee_lifecycle_records r
    JOIN users u ON u.id = r.employee_id
    LEFT JOIN lifecycle_templates t ON t.id = r.template_id
    LEFT JOIN lifecycle_checklist_items i ON i.record_id = r.id
    WHERE ${whereStr}
    GROUP BY r.id, u.id, t.id
    ORDER BY
      CASE WHEN r.status = 'In Progress' THEN 1 ELSE 2 END,
      r.target_date ASC,
      r.created_at DESC
    LIMIT $${limitIdx} OFFSET $${offsetIdx};
  `, params);

  return {
    records: dataRes.rows,
    totalRecords,
    currentPage: parseInt(page, 10),
    totalPages: Math.ceil(totalRecords / limit) || 1,
  };
};

// Helper: Resolve user role and custom role name accurately from database
const resolveUserRoleInfo = async (clientOrPool, user) => {
  let baseRole = String(user?.role || "").trim().toLowerCase();
  let roleName = "";

  if (user?.roleId) {
    const rRes = await clientOrPool.query("SELECT name FROM roles WHERE id = $1", [user.roleId]);
    if (rRes.rows.length > 0) {
      roleName = String(rRes.rows[0].name || "").trim().toLowerCase();
    }
  }

  if (!roleName && user?.userId) {
    const aRes = await clientOrPool.query(`
      SELECT a.role, r.name AS role_name
      FROM admin a
      LEFT JOIN roles r ON r.id = a.role_id
      WHERE a.id = $1
    `, [user.userId]);

    if (aRes.rows.length > 0) {
      baseRole = String(aRes.rows[0].role || baseRole).trim().toLowerCase();
      roleName = String(aRes.rows[0].role_name || "").trim().toLowerCase();
    } else {
      const uRes = await clientOrPool.query(`
        SELECT u.role, r.name AS role_name
        FROM users u
        LEFT JOIN roles r ON r.id = u.role_id
        WHERE u.id = $1
      `, [user.userId]);
      if (uRes.rows.length > 0) {
        baseRole = String(uRes.rows[0].role || baseRole).trim().toLowerCase();
        roleName = String(uRes.rows[0].role_name || "").trim().toLowerCase();
      }
    }
  }

  const isGeneralAdmin =
    baseRole === "general_admin" ||
    roleName.includes("general admin") ||
    roleName.includes("super admin") ||
    (baseRole === "admin" &&
      !roleName.includes("it") &&
      !roleName.includes("hr") &&
      !roleName.includes("manager") &&
      !roleName.includes("security") &&
      !roleName.includes("finance"));

  const isIT = !isGeneralAdmin && (roleName.includes("it") || baseRole.includes("it"));
  const isHR = !isGeneralAdmin && (roleName.includes("hr") || baseRole.includes("hr"));
  const isManager = !isGeneralAdmin && (roleName.includes("manager") || baseRole.includes("manager"));
  const isSecurity = !isGeneralAdmin && (roleName.includes("security") || baseRole.includes("security"));
  const isFinance = !isGeneralAdmin && (roleName.includes("finance") || baseRole.includes("finance"));

  return {
    baseRole,
    roleName,
    isGeneralAdmin,
    isIT,
    isHR,
    isManager,
    isSecurity,
    isFinance,
    canAccessChecklist: isGeneralAdmin || isIT || isHR || isManager || isSecurity || isFinance,
  };
};

// 6. Get single record with detailed checklist
const getLifecycleRecordById = async (recordId, user) => {
  // Access control: Only General Admin, IT Admin, HR Admin, and Manager can access the checklist
  const roleInfo = await resolveUserRoleInfo(pool, user);
  if (!roleInfo.canAccessChecklist) {
    const authErr = new Error("Access restricted: Only General Admin, IT Admin, HR Admin, and Manager can access the checklist.");
    authErr.status = 403;
    throw authErr;
  }

  const recRes = await pool.query(`
    SELECT
      r.*,
      u.name AS employee_name,
      u.email AS employee_email,
      u.role AS employee_role,
      u.created_at AS employee_joined_date,
      u.is_active AS employee_is_active,
      COALESCE(u.lifecycle_status, 'Active') AS employee_lifecycle_status,
      t.title AS template_title,
      t.department AS template_department
    FROM employee_lifecycle_records r
    JOIN users u ON u.id = r.employee_id
    LEFT JOIN lifecycle_templates t ON t.id = r.template_id
    WHERE r.id = $1;
  `, [recordId]);

  if (recRes.rows.length === 0) throw new Error("Lifecycle record not found");
  const record = recRes.rows[0];

  // Fetch checklist items ordered by category and order_index
  const itemsRes = await pool.query(`
    SELECT
      i.*,
      tk.status AS linked_task_status
    FROM lifecycle_checklist_items i
    LEFT JOIN tasks tk ON tk.id = i.linked_task_id
    WHERE i.record_id = $1
    ORDER BY i.order_index ASC, i.id ASC;
  `, [recordId]);

  record.checklist = itemsRes.rows;
  return record;
};

// 7. Toggle Checklist Item (Mark complete / incomplete)
const toggleChecklistItem = async (itemId, isCompleted, notes, user) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    let resolvedItemId = itemId;
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(resolvedItemId || "").trim());
    if (!isUuid && typeof resolvedItemId === "string" && resolvedItemId.includes("-")) {
      const decoded = decodeUUIDToId(resolvedItemId);
      if (decoded && decoded !== resolvedItemId) {
        resolvedItemId = decoded;
      }
    }
    if (!resolvedItemId || String(resolvedItemId) === "NaN" || String(resolvedItemId).trim() === "") {
      throw new Error("Invalid checklist item ID");
    }

    // Fetch item
    const itemRes = await client.query(`
      SELECT i.*, r.id AS record_id, r.employee_id, r.record_code, r.type, r.target_date, r.status AS record_status
      FROM lifecycle_checklist_items i
      JOIN employee_lifecycle_records r ON r.id = i.record_id
      WHERE i.id = $1;
    `, [resolvedItemId]);

    if (itemRes.rows.length === 0) throw new Error("Checklist item not found");
    const item = itemRes.rows[0];


    // Department / Role Permission Check:
    // Only the specific assigned department admin can complete their department's items.
    // General Admin is NOT allowed to check off department items!
    const roleInfo = await resolveUserRoleInfo(client, user);

    const itemCategory = String(item.category || "").trim().toLowerCase();
    let isAuthorized = false;

    if (itemCategory === "it") {
      isAuthorized = Boolean(roleInfo.isIT);
    } else if (itemCategory === "hr") {
      isAuthorized = Boolean(roleInfo.isHR);
    } else if (itemCategory === "manager") {
      isAuthorized = Boolean(roleInfo.isManager);
    } else if (itemCategory === "security") {
      isAuthorized = Boolean(roleInfo.isSecurity);
    } else if (itemCategory === "finance") {
      isAuthorized = Boolean(roleInfo.isFinance);
    } else if (itemCategory === "general") {
      isAuthorized = Boolean(roleInfo.isGeneralAdmin || roleInfo.baseRole === "admin" || roleInfo.baseRole === "general_admin");
    }

    if (!isAuthorized) {
      const authErr = new Error(`Action restricted: Only ${item.category} Admin can complete this step. General Admin cannot complete department tasks.`);
      authErr.status = 403;
      throw authErr;
    }

    let completedByName = null;
    if (isCompleted) {
      const uRes = await client.query(
        `SELECT name FROM admin WHERE id = $1 UNION SELECT name FROM users WHERE id = $1 LIMIT 1;`,
        [user.userId]
      );
      completedByName = uRes.rows[0]?.name || "Staff";
    }

    // Update item
    const updateRes = await client.query(`
      UPDATE lifecycle_checklist_items
      SET
        is_completed = $1,
        completed_at = $2,
        completed_by = $3,
        completed_by_name = $4,
        completion_notes = COALESCE($5, completion_notes)
      WHERE id = $6
      RETURNING *;
    `, [
      isCompleted,
      isCompleted ? new Date() : null,
      isCompleted ? user.userId : null,
      completedByName,
      notes || null,
      resolvedItemId,
    ]);

    // If linked to a task, update task status accordingly
    if (item.linked_task_id) {
      try {
        await client.query("SAVEPOINT task_update_sp");
        await client.query(`
          UPDATE tasks
          SET status = $1
          WHERE id = $2;
        `, [isCompleted ? "Completed" : "Pending", item.linked_task_id]);
        await client.query("RELEASE SAVEPOINT task_update_sp");
      } catch (tkErr) {
        await client.query("ROLLBACK TO SAVEPOINT task_update_sp");
        console.warn("Could not update linked task status:", tkErr.message);
      }
    }

    // Recalculate progress percentage for record
    const countRes = await client.query(`
      SELECT
        COUNT(*)::int AS total,
        COUNT(CASE WHEN is_completed = true THEN 1 END)::int AS completed
      FROM lifecycle_checklist_items
      WHERE record_id = $1;
    `, [item.record_id]);

    const total = countRes.rows[0].total || 1;
    const completed = countRes.rows[0].completed || 0;
    const progressPct = Math.round((completed / total) * 100);

    await client.query(`
      UPDATE employee_lifecycle_records
      SET progress_pct = $1, updated_at = NOW()
      WHERE id = $2;
    `, [progressPct, item.record_id]);

    // Activity log
    await createActivityLog(
      user.userId,
      isCompleted ? "LIFECYCLE_STEP_COMPLETED" : "LIFECYCLE_STEP_REOPENED",
      item.employee_id,
      { recordCode: item.record_code, stepTitle: item.title, progressPct }
    );

    await client.query("COMMIT");
    return {
      item: updateRes.rows[0],
      progressPct,
      total,
      completed,
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
};

// 8. Final Complete Lifecycle (Active employee or Deactivate employee)
const completeLifecycleRecord = async (recordId, user) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const recRes = await client.query(`
      SELECT r.*, u.name AS employee_name, u.email AS employee_email
      FROM employee_lifecycle_records r
      JOIN users u ON u.id = r.employee_id
      WHERE r.id = $1;
    `, [recordId]);

    if (recRes.rows.length === 0) throw new Error("Record not found");
    const record = recRes.rows[0];

    if (record.status === "Completed") {
      throw new Error("This lifecycle workflow is already completed.");
    }

    // Role check: Only General Admin can finalize onboarding or offboarding
    const roleInfo = await resolveUserRoleInfo(client, user);
    if (!roleInfo.isGeneralAdmin) {
      const authErr = new Error("Only General Admin can finalize onboarding or offboarding workflows.");
      authErr.status = 403;
      throw authErr;
    }

    // Check that ALL checklist items are completed before finalizing
    const pendingRes = await client.query(`
      SELECT COUNT(*)::int AS pending_count
      FROM lifecycle_checklist_items
      WHERE record_id = $1 AND is_completed = false;
    `, [recordId]);

    const pendingCount = pendingRes.rows[0]?.pending_count || 0;
    if (pendingCount > 0) {
      const valErr = new Error(`Cannot finalize workflow: ${pendingCount} checklist item(s) are still pending completion.`);
      valErr.status = 400;
      throw valErr;
    }

    // Mark record completed
    await client.query(`
      UPDATE employee_lifecycle_records
      SET
        status = 'Completed',
        progress_pct = 100,
        completed_at = NOW(),
        completed_by = $1,
        updated_at = NOW()
      WHERE id = $2;
    `, [user.userId, recordId]);

    // Transition employee status
    if (record.type === "onboarding") {
      await client.query(`
        UPDATE users
        SET lifecycle_status = 'Active', is_active = true
        WHERE id = $1;
      `, [record.employee_id]);

      await client.query(`
        UPDATE admin
        SET lifecycle_status = 'Active', is_active = true
        WHERE id = $1;
      `, [record.employee_id]);

      await createEmployeeNotification(
        record.employee_id,
        "Onboarding Completed!",
        "Congratulations! Your onboarding has been officially completed. Welcome aboard!",
        "onboarding_completed"
      );
    } else if (record.type === "offboarding") {
      await client.query(`
        UPDATE users
        SET lifecycle_status = 'Inactive', is_active = false
        WHERE id = $1;
      `, [record.employee_id]);

      await client.query(`
        UPDATE admin
        SET lifecycle_status = 'Inactive', is_active = false
        WHERE id = $1;
      `, [record.employee_id]);

      await createEmployeeNotification(
        record.employee_id,
        "Offboarding Finalized",
        "Your exit process and asset handovers have been officially concluded. Best wishes!",
        "offboarding_completed"
      );
    }

    await createActivityLog(
      user.userId,
      `LIFECYCLE_${record.type.toUpperCase()}_COMPLETED`,
      record.employee_id,
      { recordCode: record.record_code, employeeName: record.employee_name }
    );

    await client.query("COMMIT");
    return {
      success: true,
      message: `${record.type === "onboarding" ? "Onboarding" : "Offboarding"} successfully finalized! ${record.type === "onboarding" ? "Employee is now Active." : "Employee is now Inactive."}`,
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
};

// 9. Cancel Lifecycle Record
const cancelLifecycleRecord = async (recordId, reason, user) => {
  const result = await pool.query(`
    UPDATE employee_lifecycle_records
    SET status = 'Cancelled', notes = COALESCE($1, notes), updated_at = NOW()
    WHERE id = $2
    RETURNING *;
  `, [reason || "Cancelled by administrator", recordId]);

  if (result.rows.length === 0) throw new Error("Record not found");
  return result.rows[0];
};

// 10. Dashboard Stats
const getLifecycleStats = async () => {
  const statsRes = await pool.query(`
    SELECT
      COUNT(CASE WHEN status = 'In Progress' AND type = 'onboarding' THEN 1 END)::int AS active_onboarding,
      COUNT(CASE WHEN status = 'In Progress' AND type = 'offboarding' THEN 1 END)::int AS active_offboarding,
      COUNT(CASE WHEN status = 'Completed' THEN 1 END)::int AS completed_total,
      COUNT(CASE WHEN status = 'Completed' AND completed_at >= date_trunc('month', CURRENT_DATE) THEN 1 END)::int AS completed_this_month,
      COALESCE(ROUND(AVG(CASE WHEN status = 'In Progress' THEN progress_pct END)), 0)::int AS avg_progress
    FROM employee_lifecycle_records;
  `);

  const overdueRes = await pool.query(`
    SELECT COUNT(*)::int AS overdue_tasks
    FROM lifecycle_checklist_items i
    JOIN employee_lifecycle_records r ON r.id = i.record_id
    WHERE r.status = 'In Progress'
      AND i.is_completed = false
      AND i.due_date < CURRENT_DATE;
  `);

  return {
    ...statsRes.rows[0],
    overdue_tasks: overdueRes.rows[0]?.overdue_tasks || 0,
  };
};

module.exports = {
  getTemplates,
  createTemplate,
  getEligibleEmployees,
  startLifecycleRecord,
  getLifecycleRecords,
  getLifecycleRecordById,
  toggleChecklistItem,
  completeLifecycleRecord,
  cancelLifecycleRecord,
  getLifecycleStats,
};
