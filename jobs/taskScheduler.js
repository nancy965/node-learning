const cron = require("node-cron");
const pool = require("../config/databse");

const generateDailyTasks = async () => {
  const client = await pool.connect();

  try {
    const schedulesResult = await client.query(`
      SELECT
        ts.id AS schedule_id,
        ts.task_id,
        t.task_name,
        t.assigned_to,
        t.assigned_by,
        t.task_date,
        t.due_date,
        t.task_type,
        td.is_active
      FROM task_schedules ts
      JOIN tasks t
        ON t.id = ts.task_id
      JOIN task_details td
        ON td.task_id = t.id
      WHERE ts.frequency = 'daily'
        AND ts.is_active = TRUE
        AND td.is_active = TRUE
        AND CURRENT_DATE >= t.task_date
    `);

    for (const schedule of schedulesResult.rows) {
      const existingTask = await client.query(
        `
          SELECT id
          FROM tasks
          WHERE schedule_id = $1
            AND task_date = CURRENT_DATE
          LIMIT 1
        `,
        [schedule.schedule_id],
      );

      if (existingTask.rows.length > 0) {
        continue;
      }

      await client.query("BEGIN");

      const taskResult = await client.query(
        `
          INSERT INTO tasks (
  task_name,
  assigned_to,
  assigned_by,
  task_date,
  due_date,
  task_type,
  schedule_id,
  status
)
VALUES ($1, $2, $3, CURRENT_DATE, CURRENT_DATE, $4, $5, 'pending')
          RETURNING id
        `,
        [
          schedule.task_name,
          schedule.assigned_to,
          schedule.assigned_by,
          schedule.task_type,
          schedule.schedule_id,
        ],
      );

      const newTaskId = taskResult.rows[0].id;

      await client.query(
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
  `,
  [
    newTaskId,
    schedule.assigned_by,
    schedule.assigned_to,
    "Task created",
    schedule.assigned_to,
    schedule.assigned_by,
  ],
);

      await client.query(
        `
          INSERT INTO task_assignments (
            task_id,
            assigned_to,
            assigned_by
          )
          VALUES ($1, $2, $3)
        `,
        [newTaskId, schedule.assigned_to, schedule.assigned_by],
      );

      await client.query(
        `
          INSERT INTO task_details (
  task_id,
  assigned_to,
  assigned_by,
  task_date,
  due_date,
  is_active
)
VALUES ($1, $2, $3, CURRENT_DATE, CURRENT_DATE, TRUE) 
        `,
        [
  newTaskId,
  schedule.assigned_to,
  schedule.assigned_by,
],
      );

      await client.query("COMMIT");

      console.log(
        `Daily task generated: ${schedule.task_name} for employee ${schedule.assigned_to}`,
      );
    }
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("DAILY TASK CRON ERROR:", error);
  } finally {
    client.release();
  }
};

cron.schedule(
  "0 11 * * *",
  async () => {
    console.log("Daily task scheduler started...");
    await generateDailyTasks();
  },
  {
    timezone: "Asia/Kolkata",
  },
);

console.log("Daily task scheduler initialized.");

module.exports = {
  generateDailyTasks,
};
