const pool = require("../config/databse");
const { createActivityLog } = require("./activityLogService");
const { createTaskLog } = require("./taskLogService");
const {
  createAdminNotification,
  createEmployeeNotification,
} = require("./notificationService");

const { isTaskBlocked } = require("./taskDependencyService");

const startTaskSession = async (taskId, userId) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const taskResult = await client.query(
      `SELECT id, assigned_to, status, start_time, end_time, task_date,
              (task_date > CURRENT_DATE) AS is_future_task,
              TO_CHAR(task_date, 'DD/MM/YYYY') AS formatted_task_date
       FROM tasks
       WHERE id = $1
       FOR UPDATE`,
      [taskId],
    );

    if (taskResult.rows.length === 0) {
      const error = new Error("Task not found.");
      error.statusCode = 404;
      throw error;
    }

    const task = taskResult.rows[0];

    if (String(task.assigned_to) !== String(userId)) {
      const error = new Error(
        "Only the assigned employee can start this task.",
      );
      error.statusCode = 403;
      throw error;
    }

    if (task.end_time || task.status === "Completed") {
      const error = new Error(
        "This task has already been completed and cannot be started again.",
      );
      error.statusCode = 400;
      throw error;
    }

    // Check if task starting date has arrived
    if (task.is_future_task) {
      await client.query("ROLLBACK");
      const error = new Error(
        `Cannot start task yet. This task is scheduled to start on ${task.formatted_task_date || task.task_date}. It cannot be started before its scheduled start date.`
      );
      error.statusCode = 400;
      throw error;
    }

    const { isBlocked, blockingTasks } = await isTaskBlocked(taskId, client);
    if (isBlocked) {
      const names = blockingTasks.map((t) => `"${t.task_name}"`).join(", ");
      const error = new Error(
        `This task is blocked. Prerequisite task(s) must be completed first: ${names}`
      );
      error.statusCode = 400;
      throw error;
    }

    const completedSessionCheck = await client.query(
      `SELECT id FROM task_time_entries WHERE task_id = $1 AND status = 'completed' LIMIT 1`,
      [taskId],
    );
    if (completedSessionCheck.rows.length > 0) {
      const error = new Error(
        "This task has already been completed and cannot be started again.",
      );
      error.statusCode = 400;
      throw error;
    }

    const activeResult = await client.query(
      `SELECT id, task_id, started_at, status
       FROM task_time_entries
       WHERE user_id = $1 AND status IN ('running', 'paused')
       LIMIT 1`,
      [userId],
    );

    if (activeResult.rows.length > 0) {
      const error = new Error("You already have an active tracking session.");
      error.statusCode = 409;
      error.activeSession = activeResult.rows[0];
      throw error;
    }

    const sessionResult = await client.query(
      `INSERT INTO task_time_entries (task_id, user_id)
       VALUES ($1, $2)
       RETURNING id, task_id, user_id, started_at, ended_at,
                 duration_seconds, hours, minutes, seconds, formatted_duration,
                 work_summary, status`,
      [taskId, userId],
    );

    await client.query(
      `UPDATE tasks
       SET start_time = COALESCE(start_time, CURRENT_TIMESTAMP),
           status = CASE
             WHEN status = 'Pending' THEN 'In Progress'
             ELSE status
           END
       WHERE id = $1`,
      [taskId],
    );

    const taskInfoResult = await client.query(
      `SELECT t.task_name AS task_title, COALESCE(u.name, a.name, 'Employee') AS assigned_to_name,
              u.admin_id, t.assigned_by
       FROM tasks t
       LEFT JOIN users u ON u.id = t.assigned_to
       LEFT JOIN admin a ON a.id = t.assigned_to
       WHERE t.id = $1`,
      [taskId],
    );

    const taskTitle = taskInfoResult.rows[0]?.task_title || "Task";
    const assignedName = taskInfoResult.rows[0]?.assigned_to_name || "Employee";
    const assignedTargetId = taskInfoResult.rows[0]?.assigned_to || userId;

    try {
      await createEmployeeNotification(
        userId,
        "Task Started",
        `You started working on task: ${taskTitle}`,
        "task_started",
      );

      const adminsResult = await client.query(
        `SELECT DISTINCT id
         FROM admin
         WHERE (
           id = (SELECT admin_id FROM users WHERE id = $1)
           OR (role = 'general_admin' AND is_active = true)
         )`,
        [assignedTargetId],
      );

      for (const adminRow of adminsResult.rows) {
        await createAdminNotification(
          adminRow.id,
          "Task Started",
          `${assignedName} started working on task: ${taskTitle}`,
          "task_started",
        );
      }
    } catch (notifErr) {
      console.error("Start task session notification error:", notifErr);
    }

    await client.query("COMMIT");

    return {
      ...sessionResult.rows[0],
      task_title: taskInfoResult.rows[0]?.task_title || "",
      assigned_to_name: taskInfoResult.rows[0]?.assigned_to_name || "",
    };
  } catch (error) {
    await client.query("ROLLBACK");

    if (error.code === "23505") {
      const conflictError = new Error(
        "You already have an active tracking session.",
      );
      conflictError.statusCode = 409;
      throw conflictError;
    }

    throw error;
  } finally {
    client.release();
  }
};

const endTaskSession = async (taskId, userId, sessionId, workSummary) => {
  const summary = String(workSummary || "").trim();

  if (!summary) {
    const error = new Error(
      "Please enter a summary of the work you completed.",
    );
    error.statusCode = 400;
    throw error;
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const sessionResult = await client.query(
      `SELECT s.id, s.task_id, s.user_id, s.started_at, s.status, s.duration_seconds, t.assigned_to
       FROM task_time_entries s
       JOIN tasks t ON s.task_id = t.id
       WHERE s.id = $1 AND s.task_id = $2
       FOR UPDATE`,
      [sessionId, taskId],
    );

    if (sessionResult.rows.length === 0) {
      const error = new Error("Tracking session not found.");
      error.statusCode = 404;
      throw error;
    }

    if (
      String(sessionResult.rows[0].assigned_to) !== String(userId) ||
      String(sessionResult.rows[0].user_id) !== String(userId)
    ) {
      const error = new Error("Only the assigned employee can end this task.");
      error.statusCode = 403;
      throw error;
    }

    const sessionRow = sessionResult.rows[0];
    if (sessionRow.status !== "running" && sessionRow.status !== "paused") {
      const error = new Error("This tracking session has already ended.");
      error.statusCode = 400;
      throw error;
    }

    const startedAt = sessionRow.started_at;
    const now = new Date();
    const durationSeconds =
      sessionRow.status === "paused"
        ? Math.max(0, parseInt(sessionRow.duration_seconds, 10) || 0)
        : Math.max(
            0,
            Math.floor((now.getTime() - new Date(startedAt).getTime()) / 1000),
          );
    const hours = Math.floor(durationSeconds / 3600);
    const minutes = Math.floor((durationSeconds % 3600) / 60);
    const seconds = durationSeconds % 60;
    const formattedDuration = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;

    const result = await client.query(
      `UPDATE task_time_entries
       SET ended_at = CURRENT_TIMESTAMP,
           duration_seconds = $1,
           hours = $2,
           minutes = $3,
           seconds = $4,
           formatted_duration = $5,
           work_summary = $6,
           status = 'completed',
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $7
       RETURNING id, task_id, user_id, started_at, ended_at,
                 duration_seconds, hours, minutes, seconds, formatted_duration,
                 work_summary, status`,
      [
        durationSeconds,
        hours,
        minutes,
        seconds,
        formattedDuration,
        summary,
        sessionId,
      ],
    );

    const updatedTask = await client.query(
      `UPDATE tasks
       SET end_time = CURRENT_TIMESTAMP,
           status = 'Completed'
       WHERE id = $1
       RETURNING *`,
      [taskId],
    );

    const endedTask = updatedTask.rows[0];

    const taskResult = await client.query(
      `SELECT t.id, t.task_name, t.assigned_to, t.assigned_by, u.name AS employee_name
       FROM tasks t
       LEFT JOIN users u ON t.assigned_to = u.id
       WHERE t.id = $1`,
      [taskId],
    );

    if (taskResult.rows.length > 0 && endedTask) {
      const task = taskResult.rows[0];
      const employeeName = task.employee_name || "Employee";

      try {
        await createTaskLog(client, {
          taskId: endedTask.id,
          adminId: task.assigned_by,
          userId: userId,
          taskDetails: `Task is completed by ${employeeName} (Duration: ${formattedDuration})`,
          assignTo: task.assigned_to,
          assignBy: task.assigned_by,
        });

        await createActivityLog(userId, "TASK_ENDED", task.assigned_to, {
          taskId: endedTask.id,
          taskName: endedTask.task_name,
          endTime: endedTask.end_time,
          message: `${employeeName} completed ${endedTask.task_name}`,
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
            "Task Completed",
            `${employeeName} completed the task: ${endedTask.task_name}`,
            "task_completed",
          );
        }

        if (task.assigned_to) {
          await createEmployeeNotification(
            task.assigned_to,
            "Task Completed",
            `You completed the task: ${endedTask.task_name} (Duration: ${formattedDuration})`,
            "task_completed",
          );
        }
      } catch (logErr) {
        console.error("Log/notification error on task completion:", logErr);
      }
    }

    await client.query("COMMIT");

    return result.rows[0];
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

const pauseTaskSession = async (taskId, userId, sessionId) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const sessionResult = await client.query(
      `SELECT s.id, s.task_id, s.user_id, s.started_at, s.status, s.duration_seconds, t.assigned_to,
              t.task_name AS task_title, COALESCE(u.name, a.name, 'Employee') AS assigned_to_name
       FROM task_time_entries s
       JOIN tasks t ON s.task_id = t.id
       LEFT JOIN users u ON u.id = t.assigned_to
       LEFT JOIN admin a ON a.id = t.assigned_to
       WHERE s.id = $1 AND s.task_id = $2
       FOR UPDATE`,
      [sessionId, taskId],
    );

    if (sessionResult.rows.length === 0) {
      const error = new Error("Tracking session not found.");
      error.statusCode = 404;
      throw error;
    }

    const session = sessionResult.rows[0];

    if (
      String(session.assigned_to) !== String(userId) ||
      String(session.user_id) !== String(userId)
    ) {
      const error = new Error("Only the assigned employee can pause this task.");
      error.statusCode = 403;
      throw error;
    }

    if (session.status === "paused") {
      await client.query("COMMIT");
      return session;
    }

    if (session.status !== "running") {
      const error = new Error("Only a running tracking session can be paused.");
      error.statusCode = 400;
      throw error;
    }

    const startedAt = session.started_at;
    const now = new Date();
    const durationSeconds = Math.max(
      0,
      Math.floor((now.getTime() - new Date(startedAt).getTime()) / 1000),
    );
    const hours = Math.floor(durationSeconds / 3600);
    const minutes = Math.floor((durationSeconds % 3600) / 60);
    const seconds = durationSeconds % 60;
    const formattedDuration = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;

    const updateResult = await client.query(
      `UPDATE task_time_entries
       SET status = 'paused',
           duration_seconds = $1,
           hours = $2,
           minutes = $3,
           seconds = $4,
           formatted_duration = $5,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $6
       RETURNING id, task_id, user_id, started_at, ended_at,
                 duration_seconds, hours, minutes, seconds, formatted_duration,
                 work_summary, status`,
      [durationSeconds, hours, minutes, seconds, formattedDuration, sessionId],
    );

    await client.query("COMMIT");

    return {
      ...updateResult.rows[0],
      task_title: session.task_title || "",
      assigned_to_name: session.assigned_to_name || "",
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

const resumeTaskSession = async (taskId, userId, sessionId) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const sessionResult = await client.query(
      `SELECT s.id, s.task_id, s.user_id, s.started_at, s.status, s.duration_seconds, t.assigned_to,
              t.task_name AS task_title, COALESCE(u.name, a.name, 'Employee') AS assigned_to_name
       FROM task_time_entries s
       JOIN tasks t ON s.task_id = t.id
       LEFT JOIN users u ON u.id = t.assigned_to
       LEFT JOIN admin a ON a.id = t.assigned_to
       WHERE s.id = $1 AND s.task_id = $2
       FOR UPDATE`,
      [sessionId, taskId],
    );

    if (sessionResult.rows.length === 0) {
      const error = new Error("Tracking session not found.");
      error.statusCode = 404;
      throw error;
    }

    const session = sessionResult.rows[0];

    if (
      String(session.assigned_to) !== String(userId) ||
      String(session.user_id) !== String(userId)
    ) {
      const error = new Error("Only the assigned employee can resume this task.");
      error.statusCode = 403;
      throw error;
    }

    if (session.status === "running") {
      await client.query("COMMIT");
      return session;
    }

    if (session.status !== "paused") {
      const error = new Error("Only a paused tracking session can be resumed.");
      error.statusCode = 400;
      throw error;
    }

    const accumulatedSeconds = Math.max(0, parseInt(session.duration_seconds, 10) || 0);
    const newStartedAt = new Date(Date.now() - accumulatedSeconds * 1000);

    const updateResult = await client.query(
      `UPDATE task_time_entries
       SET status = 'running',
           started_at = $1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $2
       RETURNING id, task_id, user_id, started_at, ended_at,
                 duration_seconds, hours, minutes, seconds, formatted_duration,
                 work_summary, status`,
      [newStartedAt, sessionId],
    );

    await client.query("COMMIT");

    return {
      ...updateResult.rows[0],
      task_title: session.task_title || "",
      assigned_to_name: session.assigned_to_name || "",
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

const getActiveTaskSession = async (userId) => {
  const result = await pool.query(
    `SELECT e.id, e.task_id, e.user_id, e.started_at,
            e.duration_seconds, e.formatted_duration,
            e.status, t.task_name AS task_title,
            COALESCE(u.name, a.name, 'Employee') AS assigned_to_name
     FROM task_time_entries e
     JOIN tasks t ON t.id = e.task_id
     LEFT JOIN users u ON u.id = t.assigned_to
     LEFT JOIN admin a ON a.id = t.assigned_to
     WHERE e.user_id = $1 AND e.status IN ('running', 'paused')
     ORDER BY e.created_at DESC
     LIMIT 1`,
    [userId],
  );

  return result.rows[0] || null;
};

const getTaskSessionHistory = async (taskId, userId) => {
  const result = await pool.query(
    `SELECT e.id, e.task_id, e.user_id, e.started_at, e.ended_at,
            e.duration_seconds, e.hours, e.minutes, e.seconds, e.formatted_duration,
            e.work_summary, e.status, e.created_at,
            COALESCE(u.name, a.name, 'User #' || e.user_id) AS user_name
     FROM task_time_entries e
     LEFT JOIN users u ON u.id = e.user_id
     LEFT JOIN admin a ON a.id = e.user_id
     WHERE e.task_id = $1
     ORDER BY e.started_at DESC`,
    [taskId],
  );

  return result.rows;
};

module.exports = {
  startTaskSession,
  endTaskSession,
  pauseTaskSession,
  resumeTaskSession,
  getActiveTaskSession,
  getTaskSessionHistory,
};
