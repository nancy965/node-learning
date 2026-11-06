const pool = require("../config/databse");
const { createActivityLog } = require("./activityLogService");
const { createTaskLog } = require("./taskLogService");
const {
  createEmployeeNotification,
  createAdminNotification,
} = require("./notificationService");
const {
  isTaskBlocked,
  enrichTasksWithDependencies,
  getTaskDependencies,
  setTaskDependencies,
} = require("./taskDependencyService");

// Validate task dates
const validateTaskDates = (taskDate, dueDate, frequency) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const selectedTaskDate = new Date(taskDate);
  const selectedDueDate = new Date(dueDate);

  selectedTaskDate.setHours(0, 0, 0, 0);
  selectedDueDate.setHours(0, 0, 0, 0);

  if (Number.isNaN(selectedTaskDate.getTime())) {
    return {
      valid: false,
      message: "Invalid task date",
    };
  }

  if (Number.isNaN(selectedDueDate.getTime())) {
    return {
      valid: false,
      message: "Invalid due date",
    };
  }

  if (selectedTaskDate < today) {
    return {
      valid: false,
      message: "Task date cannot be in the past",
    };
  }

  if (frequency === "daily") {
    if (selectedDueDate < selectedTaskDate) {
      return {
        valid: false,
        message: "Due date cannot be before task date",
      };
    }
  } else {
    if (selectedDueDate <= today) {
      return {
        valid: false,
        message: "Due date must be a future date",
      };
    }

    if (selectedDueDate <= selectedTaskDate) {
      return {
        valid: false,
        message: "Due date must be after task date",
      };
    }
  }

  return {
    valid: true,
  };
};

// Resolve task_type name or UUID to valid UUID from common_master
const resolveTaskTypeUUID = async (clientOrPool, typeInput) => {
  if (!typeInput) return null;
  const str = String(typeInput).trim();
  const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
  if (isUUID) return str;
  const res = await clientOrPool.query(
    "SELECT id FROM common_master WHERE LOWER(type) = 'task_type' AND LOWER(name) = LOWER($1) AND is_active = true LIMIT 1",
    [str]
  );
  if (res.rows.length > 0) return res.rows[0].id;
  const fallback = await clientOrPool.query(
    "SELECT id FROM common_master WHERE LOWER(type) = 'task_type' AND is_active = true ORDER BY (CASE WHEN LOWER(name) = 'basic' THEN 1 ELSE 2 END), created_at ASC LIMIT 1"
  );
  return fallback.rows[0]?.id || null;
};

// Resolve frequency name or UUID to valid UUID from common_master
const resolveFrequencyUUID = async (clientOrPool, freqInput) => {
  if (!freqInput) return null;
  const str = String(freqInput).trim();
  const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
  if (isUUID) return str;
  const res = await clientOrPool.query(
    "SELECT id FROM common_master WHERE LOWER(type) = 'task_frequency' AND LOWER(name) = LOWER($1) AND is_active = true LIMIT 1",
    [str]
  );
  if (res.rows.length > 0) return res.rows[0].id;
  const fallback = await clientOrPool.query(
    "SELECT id FROM common_master WHERE LOWER(type) = 'task_frequency' AND is_active = true ORDER BY (CASE WHEN LOWER(name) = 'daily' THEN 1 ELSE 2 END), created_at ASC LIMIT 1"
  );
  return fallback.rows[0]?.id || null;
};

const formatTaskRow = (row) => {
  if (!row) return row;
  const typeName = row.task_type_name || row.task_type;
  const freqName = row.frequency_name || row.frequency || "one-time";
  return {
    ...row,
    task_type_id: row.task_type,
    task_type_name: typeName,
    task_type: typeName,
    frequency_id: row.frequency,
    frequency_name: freqName,
    frequency: freqName,
  };
};

// Validate task type (dynamically against common_master with fallback, supporting UUID or string name)
const validateTaskType = async (taskType) => {
  if (!taskType) return false;
  const str = String(taskType).trim();
  const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
  if (isUUID) {
    try {
      const res = await pool.query(
        `SELECT id FROM common_master WHERE LOWER(type) = 'task_type' AND id = $1 AND is_active = true LIMIT 1`,
        [str]
      );
      if (res.rows.length > 0) return true;
    } catch (err) {
      console.error("Error validating task type UUID against common_master:", err);
    }
  }
  const cleanType = str.toLowerCase();
  try {
    const res = await pool.query(
      `SELECT id FROM common_master WHERE LOWER(type) = 'task_type' AND LOWER(name) = $1 AND is_active = true LIMIT 1`,
      [cleanType]
    );
    if (res.rows.length > 0) return true;
  } catch (err) {
    console.error("Error validating task type against common_master:", err);
  }
  const defaultTypes = ["basic", "normal", "hard"];
  return defaultTypes.includes(cleanType);
};

// Create task
const createTask = async (
  taskName,
  taskDate,
  dueDate,
  isActive,
  taskType,
  assignedTo,
  assignedBy,
  role,
  frequency,
  dependsOnTaskIds = [],
) => {
  const client = await pool.connect();

  try {
    const employeeIds = Array.isArray(assignedTo) ? assignedTo : [assignedTo];

    if (employeeIds.length === 0) {
      return {
        success: false,
        status: 400,
        message: "Please select at least one employee",
      };
    }

    const dateValidation = validateTaskDates(
      taskDate,
      dueDate,
      frequency,
    );

    if (!dateValidation.valid) {
      return {
        success: false,
        status: 400,
        message: dateValidation.message,
      };
    }

    const isValidTaskType = await validateTaskType(taskType);
    if (!isValidTaskType) {
      return {
        success: false,
        status: 400,
        message: "Invalid task type",
      };
    }

    const activeStatus = typeof isActive === "boolean" ? isActive : true;

    await client.query("BEGIN");

    const createdTasks = [];

    for (const employeeId of employeeIds) {
      const employeeResult = await client.query(
        `SELECT
           id,
           name,
           email,
           role,
           is_active,
           admin_id
         FROM users
         WHERE id = $1
         AND role = 'employee'`,
        [employeeId],
      );

      if (employeeResult.rows.length === 0) {
        await client.query("ROLLBACK");

        return {
          success: false,
          status: 404,
          message: "Employee not found",
        };
      }

      const employee = employeeResult.rows[0];

      if (!employee.is_active) {
        await client.query("ROLLBACK");

        return {
          success: false,
          status: 400,
          message: `Cannot assign task to inactive employee: ${employee.name}`,
        };
      }

      if (
        role === "admin" &&
        String(employee.admin_id) !== String(assignedBy)
      ) {
        await client.query("ROLLBACK");

        return {
          success: false,
          status: 403,
          message: `You can only assign tasks to your own employees: ${employee.name}`,
        };
      }

      const adminResult = await client.query(
        `SELECT
           id,
           name
         FROM admin
         WHERE id = $1`,
        [assignedBy],
      );

      const adminName = adminResult.rows[0]?.name || "Admin";

      const taskResult = await client.query(
        `INSERT INTO tasks
         (
           task_name,
           assigned_to,
           assigned_by,
           task_date,
           due_date,
           task_type,
           status
         )
         VALUES
         ($1, $2, $3, $4, $5, $6, 'Pending')
         RETURNING *`,
        [
          taskName.trim(),
          employeeId,
          assignedBy,
          taskDate,
          dueDate,
          await resolveTaskTypeUUID(client, taskType),
        ],
      );

      const task = taskResult.rows[0];

      if (frequency === "daily") {
        const resolvedFreqUUID = await resolveFrequencyUUID(client, frequency || "daily");
        await client.query(
          `
          INSERT INTO task_schedules (
            task_id,
            frequency,
            is_active
          )
          VALUES ($1, $2, $3)
          `,
          [task.id, resolvedFreqUUID, activeStatus],
        );
      }

      const assignmentResult = await client.query(
        `INSERT INTO task_assignments
         (
           task_id,
           assigned_to,
           assigned_by
         )
         VALUES ($1, $2, $3)
         RETURNING *`,
        [task.id, employeeId, assignedBy],
      );

      const detailsResult = await client.query(
        `INSERT INTO task_details
         (
           task_id,
           assigned_to,
           assigned_by,
           task_date,
           due_date,
           is_active
         )
         VALUES
         ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [
          task.id,
          employeeId,
          assignedBy,
          taskDate,
          dueDate,
          activeStatus,
        ],
      );

      if (dependsOnTaskIds && dependsOnTaskIds.length > 0) {
        await setTaskDependencies(task.id, dependsOnTaskIds, client);
      }

      await createTaskLog(client, {
        taskId: task.id,
        adminId: assignedBy,
        userId: employeeId,
        taskDetails: `Task is created for ${employee.name} by ${adminName}`,
        assignTo: employeeId,
        assignBy: assignedBy,
      });

      await createActivityLog(assignedBy, "CREATE_TASK", employeeId, {
        taskId: task.id,
        taskName: task.task_name,
        assignedTo: employee.name,
        assignedToEmail: employee.email,
        taskDate,
        dueDate,
        taskType: taskType.toLowerCase(),
      });

      await createEmployeeNotification(
        employeeId,
        "New Task Assigned",
        `You have been assigned a new task: ${task.task_name}`,
        "task_assigned",
      );

      await createAdminNotification(
        assignedBy,
        "Task Assigned",
        `Task "${task.task_name}" has been assigned to ${employee.name}.`,
        "task_assigned",
      );

      createdTasks.push({
        task,
        assignment: assignmentResult.rows[0],
        details: detailsResult.rows[0],
        employee,
      });
    }

    await client.query("COMMIT");

    return {
      success: true,
      status: 201,
      message:
        createdTasks.length === 1
          ? "Task created successfully"
          : `${createdTasks.length} tasks created successfully`,
      tasks: createdTasks,
    };
  } catch (error) {
    await client.query("ROLLBACK");

    console.error("CREATE TASK SERVICE ERROR:", error);

    throw error;
  } finally {
    client.release();
  }
};

// Get employees for task
const getEmployeesForTask = async (adminId, role) => {
  let result;

  if (role === "general_admin") {
    result = await pool.query(
      `SELECT
         id,
         name,
         email,
         admin_id
       FROM users
       WHERE role = 'employee'
       AND is_active = true
       ORDER BY name ASC`,
    );
  } else if (role === "admin" || role === "employee") {
    result = await pool.query(
      `SELECT
         id,
         name,
         email,
         admin_id
       FROM users
       WHERE role = 'employee'
       AND (admin_id = $1 OR admin_id = (SELECT admin_id FROM users WHERE id = $1))
       AND is_active = true
       ORDER BY name ASC`,
      [adminId],
    );
  }

  return {
    success: true,
    status: 200,
    employees: result.rows,
  };
};

// Find all tasks with pagination and filters
const getTasks = async (
  userId,
  role,
  page = 1,
  limit = 5,
  status = "",
  employeeId = "",
  taskType = "",
  search = "",
  dateRange = "",
  customFrom = "",
  customTo = "",
) => {
  const offset = (page - 1) * limit;

  let whereConditions = [];
  let params = [];

  let userRole = (role || "").toLowerCase().trim();

  if (!["general_admin", "admin", "employee"].includes(userRole)) {
    const adminCheck = await pool.query("SELECT role FROM admin WHERE id = $1", [userId]);
    if (adminCheck.rows.length > 0) {
      userRole = adminCheck.rows[0].role;
    } else {
      const userCheck = await pool.query("SELECT role FROM users WHERE id = $1", [userId]);
      if (userCheck.rows.length > 0) {
        userRole = userCheck.rows[0].role;
      }
    }
  }

  if (userRole === "general_admin") {
    whereConditions.push(`t.schedule_id IS NULL`);
  } else if (userRole === "admin") {
    params.push(userId);
    whereConditions.push(
      `(t.assigned_to IN (SELECT id FROM users WHERE admin_id = $${params.length}) OR t.assigned_by = $${params.length})`
    );
    whereConditions.push(`t.schedule_id IS NULL`);
  } else if (userRole === "employee") {
    params.push(userId);
    whereConditions.push(`t.assigned_to = $${params.length}`);
    whereConditions.push(`t.schedule_id IS NULL`);
  } else {
    return {
      success: false,
      status: 403,
      message: "You do not have permission to view tasks",
    };
  }

  if (employeeId) {
    params.push(employeeId);
    whereConditions.push(`t.assigned_to = $${params.length}`);
  }

  if (taskType) {
    params.push(taskType);
    whereConditions.push(
      `(t.task_type::text = $${params.length} OR LOWER(cm_tt.name) = LOWER($${params.length}))`,
    );
  }

  if (search.trim()) {
    params.push(`%${search.trim()}%`);

    whereConditions.push(`
      (
        t.task_name ILIKE $${params.length}
        OR u.name ILIKE $${params.length}
      )
    `);
  }

  if (dateRange === "custom") {
    if (customFrom && customTo) {
      params.push(customFrom);
      const fromIndex = params.length;

      params.push(customTo);
      const toIndex = params.length;

      whereConditions.push(
        `t.task_date >= $${fromIndex}::date
         AND t.task_date <= $${toIndex}::date`,
      );
    }
  } else if (dateRange) {
    const days = Number(dateRange);

    if ([3, 7, 30, 90].includes(days)) {
      whereConditions.push(
        `t.task_date >= CURRENT_DATE - (${days} - 1) * INTERVAL '1 day'
         AND t.task_date <= CURRENT_DATE`,
      );
    }
  }

  if (status === "completed") {
    whereConditions.push(`
      t.end_time IS NOT NULL
    `);
  } else if (status === "in-progress") {
    whereConditions.push(`
      t.start_time IS NOT NULL
      AND t.end_time IS NULL
    `);
  } else if (status === "pending") {
    whereConditions.push(`
      t.start_time IS NULL
      AND t.end_time IS NULL
    `);
  } else if (status === "overdue") {
    whereConditions.push(`
      t.due_date < CURRENT_DATE
      AND t.end_time IS NULL
    `);
  } else if (status === "active") {
    whereConditions.push(`
      td.is_active = true
    `);
  } else if (status === "inactive") {
    whereConditions.push(`
      td.is_active = false
    `);
  }

  const whereClause =
    whereConditions.length > 0
      ? `WHERE ${whereConditions.join(" AND ")}`
      : "";

  const countResult = await pool.query(
    `
      SELECT COUNT(*) AS total
      FROM tasks t

      LEFT JOIN task_details td
        ON t.id = td.task_id

      LEFT JOIN common_master cm_tt
        ON t.task_type = cm_tt.id

      LEFT JOIN users u
        ON t.assigned_to = u.id

      ${whereClause}
    `,
    params,
  );

  const totalRecords = Number(countResult.rows[0].total);

  const totalPages =
    totalRecords === 0 ? 0 : Math.ceil(totalRecords / limit);

  const taskParams = [...params, limit, offset];

  const taskSelect = `
    SELECT
      t.id,
      t.task_name,
      t.task_date,
      t.due_date,
      t.task_type,
      cm_tt.name AS task_type_name,
      t.status,
      t.start_time,
      t.end_time,
      td.is_active,
      COALESCE(cm_tf.name, ts.frequency::text, 'one-time') AS frequency,
      COALESCE(ts.frequency::text, cm_tf.id::text) AS frequency_id,
      t.assigned_to AS assigned_to,
      u.id AS assigned_to_id,
      u.name AS assigned_to_name

    FROM tasks t

    LEFT JOIN task_details td
      ON t.id = td.task_id

    LEFT JOIN task_schedules ts
      ON t.id = ts.task_id

    LEFT JOIN common_master cm_tt
      ON t.task_type = cm_tt.id

    LEFT JOIN common_master cm_tf
      ON ts.frequency = cm_tf.id

    LEFT JOIN users u
      ON t.assigned_to = u.id

    ${whereClause}

    ORDER BY t.id DESC

    LIMIT $${params.length + 1}
    OFFSET $${params.length + 2}
  `;

  const result = await pool.query(taskSelect, taskParams);

  const rangeStart =
    totalRecords === 0 ? 0 : offset + 1;

  const rangeEnd =
    Math.min(offset + limit, totalRecords);

  const formattedTasks = result.rows.map(formatTaskRow);
  const enrichedTasks = await enrichTasksWithDependencies(formattedTasks);

  return {
    success: true,
    status: 200,
    tasks: enrichedTasks,
    pagination: {
      page,
      limit,
      totalRecords,
      totalPages,
      range: `${rangeStart}-${rangeEnd}`,
    },
  };
};

// Find task by ID
const getTaskById = async (taskId, userId, role) => {
  let userRole = (role || "").toLowerCase().trim();

  if (!["general_admin", "admin", "employee"].includes(userRole)) {
    const adminCheck = await pool.query("SELECT role FROM admin WHERE id = $1", [userId]);
    if (adminCheck.rows.length > 0) {
      userRole = adminCheck.rows[0].role;
    } else {
      const userCheck = await pool.query("SELECT role FROM users WHERE id = $1", [userId]);
      if (userCheck.rows.length > 0) {
        userRole = userCheck.rows[0].role;
      }
    }
  }

  let result;

  const selectTaskQuery = (whereClause) => `
    SELECT
      t.*,
      cm_tt.name AS task_type_name,
      COALESCE(cm_tf.name, ts.frequency::text, 'one-time') AS frequency,
      COALESCE(ts.frequency::text, cm_tf.id::text) AS frequency_id,
      td.is_active,
      u.name AS assigned_to_name,
      u.email AS assigned_to_email,
      a.name AS assigned_by_name,
      a.email AS assigned_by_email
    FROM tasks t
    LEFT JOIN task_details td ON t.id = td.task_id
    LEFT JOIN task_schedules ts ON t.id = ts.task_id
    LEFT JOIN common_master cm_tt ON t.task_type = cm_tt.id
    LEFT JOIN common_master cm_tf ON ts.frequency = cm_tf.id
    LEFT JOIN users u ON t.assigned_to = u.id
    LEFT JOIN admin a ON t.assigned_by = a.id
    WHERE ${whereClause}
  `;

  if (userRole === "general_admin") {
    result = await pool.query(selectTaskQuery("t.id = $1"), [taskId]);
  } else if (userRole === "admin") {
    result = await pool.query(
      selectTaskQuery("t.id = $1 AND (t.assigned_to IN (SELECT id FROM users WHERE admin_id = $2) OR t.assigned_by = $2)"),
      [taskId, userId],
    );
  } else if (userRole === "employee") {
    result = await pool.query(
      selectTaskQuery("t.id = $1 AND t.assigned_to = $2"),
      [taskId, userId],
    );
  } else {
    return {
      success: false,
      status: 403,
      message: "You do not have permission to view this task",
    };
  }

  if (result.rows.length === 0) {
    return {
      success: false,
      status: 404,
      message: "Task not found",
    };
  }

  const formattedTask = formatTaskRow(result.rows[0]);
  const depInfo = await getTaskDependencies(taskId);
  formattedTask.dependencies = depInfo;
  formattedTask.is_blocked = depInfo.is_blocked;
  formattedTask.blocking_tasks = depInfo.blocking_tasks;
  formattedTask.predecessors = depInfo.predecessors;
  formattedTask.successors = depInfo.successors;

  return {
    success: true,
    status: 200,
    task: formattedTask,
  };
};

// Find employee's tasks
// Find employee's tasks
// Find employee's tasks
const getMyTasks = async (
  employeeId,
  page = 1,
  limit = 5,
  search = "",
  status = "",
) => {
  const offset = (page - 1) * limit;

  let params = [employeeId];

  let whereConditions = [
    `t.assigned_to = $1`,
    `EXISTS (
      SELECT 1
      FROM task_details td_active
      WHERE td_active.task_id = t.id
        AND td_active.is_active = true
    )`,
  ];

  if (search.trim()) {
    params.push(`%${search.trim()}%`);

    whereConditions.push(`
      (
        t.task_name ILIKE $${params.length}
        OR a.name ILIKE $${params.length}
      )
    `);
  }

  if (status === "completed") {
    whereConditions.push(`
      t.end_time IS NOT NULL
    `);
  } else if (status === "in-progress") {
    whereConditions.push(`
      t.start_time IS NOT NULL
      AND t.end_time IS NULL
    `);
  } else if (status === "pending") {
    whereConditions.push(`
      t.start_time IS NULL
      AND t.end_time IS NULL
    `);
  } else if (status === "overdue") {
    whereConditions.push(`
      t.due_date < CURRENT_DATE
      AND t.end_time IS NULL
    `);
  }

  const whereClause = `WHERE ${whereConditions.join(
    " AND ",
  )}`;

  const countResult = await pool.query(
    `
      SELECT COUNT(*) AS total

      FROM tasks t

      LEFT JOIN admin a
        ON t.assigned_by = a.id

      ${whereClause}
    `,
    params,
  );

  const totalRecords = Number(
    countResult.rows[0].total,
  );

  const totalPages =
    totalRecords === 0
      ? 0
      : Math.ceil(totalRecords / limit);

  const taskParams = [
    ...params,
    limit,
    offset,
  ];

  const result = await pool.query(
    `
      SELECT
        t.id,
        t.task_name,
        t.task_date,
        t.due_date,
        t.task_type,
        cm_tt.name AS task_type_name,
        t.start_time,
        t.end_time,
        t.status,

        CASE
          WHEN t.end_time IS NOT NULL
            THEN 'Completed'

          WHEN t.start_time IS NOT NULL
               AND t.due_date < CURRENT_DATE
            THEN 'Overdue'

          WHEN t.start_time IS NOT NULL
            THEN 'In Progress'

          WHEN t.due_date < CURRENT_DATE
            THEN 'Overdue'

          ELSE 'Pending'
        END AS task_status,

        EXISTS (
          SELECT 1
          FROM task_details td
          WHERE td.task_id = t.id
            AND td.is_active = true
        ) AS is_active,

        a.id AS assigned_by_id,
        a.name AS assigned_by_name,
        a.email AS assigned_by_email

      FROM tasks t

      LEFT JOIN common_master cm_tt
        ON t.task_type = cm_tt.id

      LEFT JOIN admin a
        ON t.assigned_by = a.id

      ${whereClause}

      ORDER BY t.id DESC

      LIMIT $${params.length + 1}
      OFFSET $${params.length + 2}
    `,
    taskParams,
  );

  const rangeStart =
    totalRecords === 0
      ? 0
      : offset + 1;

  const rangeEnd = Math.min(
    offset + limit,
    totalRecords,
  );

  const formattedTasks = result.rows.map(formatTaskRow);
  const enrichedTasks = await enrichTasksWithDependencies(formattedTasks);

  return {
    success: true,
    status: 200,
    tasks: enrichedTasks,
    pagination: {
      page,
      limit,
      totalRecords,
      totalPages,
      range: `${rangeStart}-${rangeEnd}`,
    },
  };
};

// Delete task
const deleteTask = async (taskId, userId, role) => {
  const client = await pool.connect();

  try {
    let userRole = (role || "").toLowerCase().trim();

    if (!["general_admin", "admin", "employee"].includes(userRole)) {
      const adminCheck = await client.query("SELECT role FROM admin WHERE id = $1", [userId]);
      if (adminCheck.rows.length > 0) {
        userRole = adminCheck.rows[0].role;
      } else {
        const userCheck = await client.query("SELECT role FROM users WHERE id = $1", [userId]);
        if (userCheck.rows.length > 0) {
          userRole = userCheck.rows[0].role;
        }
      }
    }

    if (userRole === "general_admin") {
      taskResult = await client.query(
        `SELECT
           t.id,
           t.task_name,
           t.assigned_to,
           t.assigned_by,
           t.start_time,
           t.end_time,
           u.name AS assigned_to_name,
           u.email AS assigned_to_email
         FROM tasks t
         LEFT JOIN users u
           ON t.assigned_to = u.id
         WHERE t.id = $1`,
        [taskId],
      );
    } else if (userRole === "admin") {
      taskResult = await client.query(
        `SELECT
           t.id,
           t.task_name,
           t.assigned_to,
           t.assigned_by,
           t.start_time,
           t.end_time,
           u.name AS assigned_to_name,
           u.email AS assigned_to_email
         FROM tasks t
         LEFT JOIN users u
           ON t.assigned_to = u.id
         WHERE t.id = $1
         AND (t.assigned_to IN (SELECT id FROM users WHERE admin_id = $2) OR t.assigned_by = $2)`,
        [taskId, userId],
      );
    } else if (userRole === "employee") {
      taskResult = await client.query(
        `SELECT
           t.id,
           t.task_name,
           t.assigned_to,
           t.assigned_by,
           t.start_time,
           t.end_time,
           u.name AS assigned_to_name,
           u.email AS assigned_to_email
         FROM tasks t
         LEFT JOIN users u
           ON t.assigned_to = u.id
         WHERE t.id = $1
         AND t.assigned_to = $2`,
        [taskId, userId],
      );
    } else {
      return {
        success: false,
        status: 403,
        message: "You do not have permission to delete tasks",
      };
    }

    if (taskResult.rows.length === 0) {
      return {
        success: false,
        status: 404,
        message: "Task not found",
      };
    }

    const task = taskResult.rows[0];

    await client.query("BEGIN");

    await client.query(
      `DELETE FROM task_details
       WHERE task_id = $1`,
      [taskId],
    );

    await client.query(
      `DELETE FROM task_assignments
       WHERE task_id = $1`,
      [taskId],
    );

    await client.query(
      `DELETE FROM tasks
       WHERE id = $1`,
      [taskId],
    );

    await createActivityLog(userId, "DELETE_TASK", task.assigned_to, {
      taskId: task.id,
      taskName: task.task_name,
      assignedTo: task.assigned_to_name,
      assignedToEmail: task.assigned_to_email,
    });

    if (task.assigned_by) {
      await createAdminNotification(
        task.assigned_by,
        "Task Deleted",
        `Task "${task.task_name}" has been deleted.`,
        "task_deleted",
      );
    }

    if (task.assigned_to) {
      await createEmployeeNotification(
        task.assigned_to,
        "Task Deleted",
        `Task "${task.task_name}" has been deleted.`,
        "task_deleted",
      );
    }

    await client.query("COMMIT");

    return {
      success: true,
      status: 200,
      message: "Task deleted successfully",
    };
  } catch (error) {
    await client.query("ROLLBACK");

    console.error("DELETE TASK SERVICE ERROR:", error);

    throw error;
  } finally {
    client.release();
  }
};

// Update task
const updateTask = async (
  taskId,
  taskName,
  taskDate,
  dueDate,
  isActive,
  taskType,
  assignedTo,
  userId,
  role,
  dependsOnTaskIds,
) => {
  const client = await pool.connect();

  try {
    const employeeId = Array.isArray(assignedTo)
      ? assignedTo[0]
      : assignedTo;

    if (!employeeId) {
      return {
        success: false,
        status: 400,
        message: "Employee must be selected",
      };
    }

    let userRole = (role || "").toLowerCase().trim();

    if (!["general_admin", "admin", "employee"].includes(userRole)) {
      const adminCheck = await client.query("SELECT role FROM admin WHERE id = $1", [userId]);
      if (adminCheck.rows.length > 0) {
        userRole = adminCheck.rows[0].role;
      } else {
        const userCheck = await client.query("SELECT role FROM users WHERE id = $1", [userId]);
        if (userCheck.rows.length > 0) {
          userRole = userCheck.rows[0].role;
        }
      }
    }

    let taskResult;

    if (userRole === "general_admin") {
      taskResult = await client.query(
        `SELECT
           id,
           task_name,
           assigned_to,
           assigned_by,
           start_time,
           end_time,
           status
         FROM tasks
         WHERE id = $1`,
        [taskId],
      );
    } else if (userRole === "admin") {
      taskResult = await client.query(
        `SELECT
           id,
           task_name,
           assigned_to,
           assigned_by,
           start_time,
           end_time,
           status
         FROM tasks
         WHERE id = $1
         AND (assigned_to IN (SELECT id FROM users WHERE admin_id = $2) OR assigned_by = $2)`,
        [taskId, userId],
      );
    } else if (userRole === "employee") {
      taskResult = await client.query(
        `SELECT
           id,
           task_name,
           assigned_to,
           assigned_by,
           start_time,
           end_time,
           status
         FROM tasks
         WHERE id = $1
         AND assigned_to = $2`,
        [taskId, userId],
      );
    } else {
      return {
        success: false,
        status: 403,
        message: "You do not have permission to update tasks",
      };
    }

    if (taskResult.rows.length === 0) {
      return {
        success: false,
        status: 404,
        message: "Task not found",
      };
    }

    const existingTask = taskResult.rows[0];

    if (
      existingTask.end_time !== null ||
      existingTask.status === "Completed"
    ) {
      return {
        success: false,
        status: 400,
        message: "Completed task cannot be edited",
      };
    }

    const employeeResult = await client.query(
      `SELECT
         id,
         name,
         email,
         role,
         is_active,
         admin_id
       FROM users
       WHERE id = $1
       AND role = 'employee'`,
      [employeeId],
    );

    if (employeeResult.rows.length === 0) {
      return {
        success: false,
        status: 404,
        message: "Employee not found",
      };
    }

    const employee = employeeResult.rows[0];

    if (!employee.is_active) {
      return {
        success: false,
        status: 400,
        message: "Cannot assign task to an inactive employee",
      };
    }

    if (
      role === "admin" &&
      String(employee.admin_id) !== String(userId)
    ) {
      return {
        success: false,
        status: 403,
        message: "You can only assign tasks to your own employees",
      };
    }

    const dateValidation = validateTaskDates(
      taskDate,
      dueDate,
      "one-time",
    );

    if (!dateValidation.valid) {
      return {
        success: false,
        status: 400,
        message: dateValidation.message,
      };
    }

    const isValidTaskType = await validateTaskType(taskType);
    if (!isValidTaskType) {
      return {
        success: false,
        status: 400,
        message: "Invalid task type",
      };
    }

    const activeStatus =
      typeof isActive === "boolean" ? isActive : true;

    const wasStarted = existingTask.start_time !== null;

    const wasReassigned =
      String(existingTask.assigned_to) !== String(employeeId);

    await client.query("BEGIN");

    const adminResult = await client.query(
      `SELECT
         id,
         name
       FROM admin
       WHERE id = $1`,
      [existingTask.assigned_by],
    );

    const adminName = adminResult.rows[0]?.name || "Admin";

    const updatedTask = await client.query(
      `UPDATE tasks
       SET
         task_name = $1,
         assigned_to = $2,
         task_date = $3,
         due_date = $4,
         task_type = $5,
         start_time = CASE
           WHEN $7 = true THEN NULL
           ELSE start_time
         END,
         end_time = CASE
           WHEN $7 = true THEN NULL
           ELSE end_time
         END,
         status = CASE
           WHEN $7 = true THEN 'Pending'
           ELSE status
         END
       WHERE id = $6
       RETURNING *`,
      [
        taskName.trim(),
        employeeId,
        taskDate,
        dueDate,
        await resolveTaskTypeUUID(client, taskType),
        taskId,
        wasStarted,
      ],
    );

    await client.query(
      `UPDATE task_assignments
       SET
         assigned_to = $1,
         assigned_by = $2
       WHERE task_id = $3`,
      [employeeId, existingTask.assigned_by, taskId],
    );

    const updatedDetails = await client.query(
      `UPDATE task_details
       SET
         assigned_to = $1,
         assigned_by = $2,
         task_date = $3,
         due_date = $4,
         is_active = $5
       WHERE task_id = $6
       RETURNING *`,
      [
        employeeId,
        existingTask.assigned_by,
        taskDate,
        dueDate,
        activeStatus,
        taskId,
      ],
    );

    let taskLogMessage;

    if (wasReassigned) {
      taskLogMessage = `Task is updated and reassigned to ${employee.name}`;
    } else {
      taskLogMessage = "Task is updated";
    }

    await createTaskLog(client, {
      taskId,
      adminId: existingTask.assigned_by,
      userId: employeeId,
      taskDetails: taskLogMessage,
      assignTo: employeeId,
      assignBy: existingTask.assigned_by,
    });

    await createActivityLog(userId, "UPDATE_TASK", employeeId, {
      taskId,
      taskName,
      assignedTo: employee.name,
      assignedToEmail: employee.email,
      taskDate,
      dueDate,
      taskType: taskType.toLowerCase(),
      isActive: activeStatus,
      taskWasStarted: wasStarted,
      taskReset: wasStarted,
    });

    if (existingTask.assigned_by) {
      await createAdminNotification(
        existingTask.assigned_by,
        "Task Updated",
        `Task "${taskName}" has been updated.`,
        "task_updated",
      );
    }

    if (employeeId) {
      await createEmployeeNotification(
        employeeId,
        "Task Updated",
        wasStarted
          ? `The task "${taskName}" was updated by admin and must be started again.`
          : `The task "${taskName}" has been updated.`,
        "task_updated",
      );
    }

    if (dependsOnTaskIds !== undefined) {
      await setTaskDependencies(taskId, dependsOnTaskIds, client);
    }

    await client.query("COMMIT");

    return {
      success: true,
      status: 200,
      message: wasStarted
        ? "Task updated successfully. The task has been reset and must be started again."
        : "Task updated successfully",
      task: updatedTask.rows[0],
      details: updatedDetails.rows[0],
    };
  } catch (error) {
    await client.query("ROLLBACK");

    console.error("UPDATE TASK SERVICE ERROR:", error);

    throw error;
  } finally {
    client.release();
  }
};

// Start task
const startTask = async (taskId, employeeId) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const taskResult = await client.query(
      `SELECT
         t.id,
         t.task_name,
         t.assigned_to,
         t.assigned_by,
         t.start_time,
         t.end_time,
         t.status,
         t.task_date,
         t.due_date,
         (t.task_date > CURRENT_DATE) AS is_future_task,
         TO_CHAR(t.task_date, 'DD/MM/YYYY') AS formatted_task_date,
         td.is_active,
         u.name AS employee_name
       FROM tasks t
       JOIN users u
         ON t.assigned_to = u.id
       JOIN task_details td
         ON t.id = td.task_id
       WHERE t.id = $1
       FOR UPDATE`,
      [taskId],
    );

    if (taskResult.rows.length === 0) {
      await client.query("ROLLBACK");

      return {
        success: false,
        status: 404,
        message: "Task not found",
      };
    }

    const task = taskResult.rows[0];

    if (String(task.assigned_to) !== String(employeeId)) {
      await client.query("ROLLBACK");

      return {
        success: false,
        status: 403,
        message: "Only the assigned employee can start this task",
      };
    }

    if (!task.is_active) {
      await client.query("ROLLBACK");

      return {
        success: false,
        status: 400,
        message: "This task is inactive and cannot be started",
      };
    }

    if (task.end_time) {
      await client.query("ROLLBACK");

      return {
        success: false,
        status: 400,
        message: "Completed task cannot be started again",
      };
    }

    if (task.start_time) {
      await client.query("ROLLBACK");

      return {
        success: false,
        status: 400,
        message: "Task has already been started",
      };
    }

    // Check if task starting date has arrived
    if (task.is_future_task) {
      await client.query("ROLLBACK");
      return {
        success: false,
        status: 400,
        message: `Cannot start task yet. This task is scheduled to start on ${task.formatted_task_date || task.task_date}. It cannot be started before its scheduled start date.`,
      };
    }

    const { isBlocked, blockingTasks } = await isTaskBlocked(taskId, client);
    if (isBlocked) {
      await client.query("ROLLBACK");
      const names = blockingTasks.map((t) => `"${t.task_name}"`).join(", ");
      return {
        success: false,
        status: 400,
        message: `This task is blocked. Prerequisite task(s) must be completed first: ${names}`,
      };
    }

    const updatedTask = await client.query(
      `UPDATE tasks
       SET
         start_time = NOW(),
         status = 'In Progress'
       WHERE id = $1
       RETURNING *`,
      [taskId],
    );

    const startedTask = updatedTask.rows[0];

    await createTaskLog(client, {
      taskId: startedTask.id,
      adminId: task.assigned_by,
      userId: employeeId,
      taskDetails: `Task is started by ${task.employee_name}`,
      assignTo: task.assigned_to,
      assignBy: task.assigned_by,
    });

    await createActivityLog(employeeId, "TASK_STARTED", employeeId, {
      taskId: startedTask.id,
      taskName: startedTask.task_name,
      startTime: startedTask.start_time,
      message: `${task.employee_name} started ${startedTask.task_name}`,
    });

    const adminsResult = await client.query(
      `SELECT DISTINCT id
       FROM admin
       WHERE (
         id = (SELECT admin_id FROM users WHERE id = $1)
         OR (role = 'general_admin' AND is_active = true)
       )`,
      [task.assigned_to],
    );

    for (const adminRow of adminsResult.rows) {
      await createAdminNotification(
        adminRow.id,
        "Task Started",
        `${task.employee_name} started the task: ${startedTask.task_name}`,
        "task_started",
      );
    }

    await createEmployeeNotification(
      employeeId,
      "Task Started",
      `You started the task: ${startedTask.task_name}`,
      "task_started",
    );

    await client.query("COMMIT");

    return {
      success: true,
      status: 200,
      message: "Task started successfully",
      task: startedTask,
    };
  } catch (error) {
    await client.query("ROLLBACK");

    console.error("START TASK SERVICE ERROR:", error);

    throw error;
  } finally {
    client.release();
  }
};

// End task
const endTask = async (taskId, employeeId) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const taskResult = await client.query(
      `SELECT
         t.id,
         t.task_name,
         t.assigned_to,
         t.assigned_by,
         t.start_time,
         t.end_time,
         t.status,
         td.is_active,
         u.name AS employee_name
       FROM tasks t
       JOIN users u
         ON t.assigned_to = u.id
       JOIN task_details td
         ON t.id = td.task_id
       WHERE t.id = $1
       FOR UPDATE`,
      [taskId],
    );

    if (taskResult.rows.length === 0) {
      await client.query("ROLLBACK");

      return {
        success: false,
        status: 404,
        message: "Task not found",
      };
    }

    const task = taskResult.rows[0];

    if (String(task.assigned_to) !== String(employeeId)) {
      await client.query("ROLLBACK");

      return {
        success: false,
        status: 403,
        message: "Only the assigned employee can end this task",
      };
    }

    if (!task.is_active) {
      await client.query("ROLLBACK");

      return {
        success: false,
        status: 400,
        message: "This task is inactive and cannot be ended",
      };
    }

    if (!task.start_time) {
      await client.query("ROLLBACK");

      return {
        success: false,
        status: 400,
        message: "Task has not been started yet",
      };
    }

    if (task.end_time) {
      await client.query("ROLLBACK");

      return {
        success: false,
        status: 400,
        message: "Task has already been completed",
      };
    }

    const updatedTask = await client.query(
      `UPDATE tasks
       SET
         end_time = NOW(),
         status = 'Completed'
       WHERE id = $1
       RETURNING *`,
      [taskId],
    );

    const endedTask = updatedTask.rows[0];

    // Two-Way Sync with Employee Lifecycle Checklist
    try {
      const chkRes = await client.query(
        `SELECT id, record_id FROM lifecycle_checklist_items WHERE linked_task_id = $1 AND is_completed = false LIMIT 1`,
        [taskId]
      );
      if (chkRes.rows.length > 0) {
        const chkItem = chkRes.rows[0];
        await client.query(
          `UPDATE lifecycle_checklist_items
           SET is_completed = true, completed_at = NOW(), completed_by = $1, completed_by_name = $2
           WHERE id = $3`,
          [employeeId, task.employee_name || "Staff", chkItem.id]
        );

        // Recalculate progress percentage for record
        const countRes = await client.query(
          `SELECT
             COUNT(*)::int AS total,
             COUNT(CASE WHEN is_completed = true THEN 1 END)::int AS completed
           FROM lifecycle_checklist_items
           WHERE record_id = $1`,
          [chkItem.record_id]
        );
        const total = countRes.rows[0].total || 1;
        const completed = countRes.rows[0].completed || 0;
        const progressPct = Math.round((completed / total) * 100);

        await client.query(
          `UPDATE employee_lifecycle_records
           SET progress_pct = $1, updated_at = NOW()
           WHERE id = $2`,
          [progressPct, chkItem.record_id]
        );
      }
    } catch (syncErr) {
      console.warn("Could not sync task with lifecycle checklist:", syncErr.message);
    }

    await createTaskLog(client, {
      taskId: endedTask.id,
      adminId: task.assigned_by,
      userId: employeeId,
      taskDetails: `Task is completed by ${task.employee_name}`,
      assignTo: employeeId,
      assignBy: task.assigned_by,
    });

    await createActivityLog(employeeId, "TASK_ENDED", employeeId, {
      taskId: endedTask.id,
      taskName: endedTask.task_name,
      endTime: endedTask.end_time,
      message: `${task.employee_name} ended ${endedTask.task_name}`,
    });

    const adminsResult = await client.query(
      `SELECT DISTINCT id
       FROM admin
       WHERE (
         id = (SELECT admin_id FROM users WHERE id = $1)
         OR (role = 'general_admin' AND is_active = true)
       )`,
      [employeeId],
    );

    for (const adminRow of adminsResult.rows) {
      await createAdminNotification(
        adminRow.id,
        "Task Completed",
        `${task.employee_name} completed the task: ${endedTask.task_name}`,
        "task_completed",
      );
    }

    await createEmployeeNotification(
      employeeId,
      "Task Completed",
      `You completed the task: ${endedTask.task_name}`,
      "task_completed",
    );

    await client.query("COMMIT");

    return {
      success: true,
      status: 200,
      message: "Task ended successfully",
      task: endedTask,
    };
  } catch (error) {
    await client.query("ROLLBACK");

    console.error("END TASK SERVICE ERROR:", error);

    throw error;
  } finally {
    client.release();
  }
};

module.exports = {
  createTask,
  getEmployeesForTask,
   getTasks,
  getTaskById,
  getMyTasks,
  deleteTask,
  updateTask,
  startTask,
  endTask,
};