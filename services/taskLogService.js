const pool = require("../config/databse");

const createTaskLog = async (
  db,
  {
    taskId,
    adminId,
    userId,
    taskDetails,
    assignTo,
    assignBy,
  }
) => {
  const result = await db.query(
    `
      INSERT INTO task_log
      (
        task_id,
        admin_id,
        user_id,
        task_details,
        assign_to,
        assign_by
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `,
    [
      taskId,
      adminId,
      userId,
      taskDetails,
      assignTo,
      assignBy,
    ]
  );

  return result.rows[0];
};

const getTaskLogs = async (taskId, userId, role) => {
  let query = `
    SELECT
      tl.id,
      tl.task_id,
      tl.task_details,
      tl.created_at,

      tl.admin_id,
      a.name AS admin_name,

      tl.user_id,
      u.name AS user_name,

      tl.assign_to,
      assigned_user.name AS assigned_to_name,

      tl.assign_by,
      assigned_admin.name AS assigned_by_name

    FROM task_log tl

    LEFT JOIN admin a
      ON a.id = tl.admin_id

    LEFT JOIN users u
      ON u.id = tl.user_id

    LEFT JOIN users assigned_user
      ON assigned_user.id = tl.assign_to

    LEFT JOIN admin assigned_admin
      ON assigned_admin.id = tl.assign_by

    WHERE tl.task_id = $1
  `;

  const params = [taskId];

  if (role === "employee") {
    params.push(userId);

    query += `
      AND tl.assign_to = $2
      AND tl.task_id IN (
        SELECT t.id
        FROM tasks t
        WHERE t.id = $1
        AND t.assigned_to = $2
      )
    `;
  }

  

  query += `
    ORDER BY tl.created_at DESC
  `;

  const result = await pool.query(query, params);

  const logs = result.rows.map((log) => {
    const details = log.task_details || "";

    if (
      details.toLowerCase().includes("completed") ||
      details.toLowerCase().includes("task completed")
    ) {
      log.task_details = details.startsWith("Task is")
        ? details
        : `Task is completed by ${log.user_name || log.assigned_to_name || "Employee"}`;
    } else if (
      details.toLowerCase().includes("started") ||
      details.toLowerCase().includes("task started")
    ) {
      log.task_details = details.startsWith("Task is")
        ? details
        : `Task is started by ${log.user_name || log.assigned_to_name || "Employee"}`;
    } else if (
      details.toLowerCase().includes("created") ||
      details.toLowerCase().includes("task created")
    ) {
      log.task_details = details.startsWith("Task is")
        ? details
        : `Task is created for ${log.assigned_to_name || "Employee"} by ${log.assigned_by_name || "Admin"}`;
    } else if (
      details.toLowerCase().includes("reassigned") ||
      details.toLowerCase().includes("updated and reassigned")
    ) {
      log.task_details = details.startsWith("Task is")
        ? details
        : `Task is updated and reassigned to ${log.assigned_to_name || "Employee"}`;
    } else if (details.toLowerCase().includes("updated")) {
      log.task_details = details.startsWith("Task is") ? details : "Task is updated";
    }

    log.action = log.task_details;
    log.status = log.task_details;

    return log;
  });

  return logs;
};

module.exports = {
  createTaskLog,
  getTaskLogs,
};

