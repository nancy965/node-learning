const pool = require("../config/databse");
const ExcelJS = require("exceljs");

const applyAnalyticsTaskInstanceScope = (whereConditions) => {
  return;
};

const applyAnalyticsUserScope = (
  whereConditions,
  params,
  userId,
  baseRole,
  employeeId,
) => {
  if (baseRole === "general_admin") {
    if (employeeId) {
      params.push(employeeId);
      whereConditions.push(`t.assigned_to = $${params.length}`);
    }

    return;
  }

  if (baseRole === "admin") {
    params.push(userId);
    whereConditions.push(`t.assigned_by = $${params.length}`);

    if (employeeId) {
      params.push(employeeId);
      whereConditions.push(`t.assigned_to = $${params.length}`);
    }

    return;
  }

  if (baseRole === "employee") {
    params.push(userId);
    whereConditions.push(`(t.assigned_by = $${params.length} OR t.assigned_by = (SELECT admin_id FROM users WHERE id = $${params.length}))`);

    if (employeeId) {
      params.push(employeeId);
      whereConditions.push(`t.assigned_to = $${params.length}`);
    }

    return;
  }
};

const applyAnalyticsTaskFilters = (
  whereConditions,
  params,
  taskType,
  status,
) => {
  if (taskType) {
    params.push(taskType);

    whereConditions.push(
      `(t.task_type::text = $${params.length} OR EXISTS (SELECT 1 FROM common_master cm_tt WHERE cm_tt.id = t.task_type AND LOWER(cm_tt.name) = LOWER($${params.length})))`,
    );
  }

  if (status === "completed") {
    whereConditions.push(`
      t.end_time IS NOT NULL
    `);
  }

  if (status === "in-progress") {
    whereConditions.push(`
      t.start_time IS NOT NULL
      AND t.end_time IS NULL
      AND t.due_date >= CURRENT_DATE
    `);
  }

  if (status === "pending") {
    whereConditions.push(`
      t.start_time IS NULL
      AND t.end_time IS NULL
      AND t.due_date >= CURRENT_DATE
    `);
  }

  if (status === "overdue") {
    whereConditions.push(`
      t.end_time IS NULL
      AND t.due_date < CURRENT_DATE
    `);
  }
};

const applyAnalyticsFilters = (
  whereConditions,
  params,
  userId,
  baseRole,
  employeeId,
  taskType,
  status,
  analyticsDateRange,
  dateColumn = "t.task_date",
) => {
  applyAnalyticsUserScope(
    whereConditions,
    params,
    userId,
    baseRole,
    employeeId,
  );

  applyAnalyticsTaskFilters(
    whereConditions,
    params,
    taskType,
    status,
  );

  applyAnalyticsDateFilter(
    whereConditions,
    params,
    analyticsDateRange,
    dateColumn,
  );
};

const getAnalyticsDateRange = (
  dateRange,
  customFrom,
  customTo,
) => {
  if (dateRange === "custom") {
    if (!customFrom || !customTo) {
      return {
        type: "invalid",
        message: "Both customFrom and customTo are required",
      };
    }

    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

    if (!dateRegex.test(customFrom) || !dateRegex.test(customTo)) {
      return {
        type: "invalid",
        message: "Invalid custom date format",
      };
    }

    if (customFrom > customTo) {
      return {
        type: "invalid",
        message: "customFrom cannot be after customTo",
      };
    }

    return {
      type: "custom",
      from: customFrom,
      to: customTo,
    };
  }

  if (!dateRange) {
    return null;
  }

  const days = Number(dateRange);

  if ([3, 7, 30, 90].includes(days)) {
    return {
      type: "preset",
      days,
    };
  }

  return {
    type: "invalid",
    message: "Invalid date range",
  };
};

const applyAnalyticsDateFilter = (
  whereConditions,
  params,
  analyticsDateRange,
  dateColumn = "t.task_date",
) => {
  if (!analyticsDateRange) {
    return;
  }

  if (analyticsDateRange.type === "custom") {
    params.push(analyticsDateRange.from);
    const fromParam = `$${params.length}`;

    params.push(analyticsDateRange.to);
    const toParam = `$${params.length}`;

    whereConditions.push(
      `${dateColumn} >= ${fromParam}::date AND ${dateColumn} <= ${toParam}::date`,
    );

    return;
  }

  if (analyticsDateRange.type === "preset") {
    params.push(analyticsDateRange.days);
    const daysParam = `$${params.length}`;

    whereConditions.push(
      `${dateColumn} >= CURRENT_DATE - (${daysParam} - 1) * INTERVAL '1 day' AND ${dateColumn} <= CURRENT_DATE`,
    );
  }
};

const getTaskOverviewData = async (
  userId,
  role,
  baseRole,
  dateRange,
  employeeId,
  taskType,
  status,
  customFrom,
  customTo,
) => {
  if (!["general_admin", "admin", "employee"].includes(baseRole)) {
    return {
      success: false,
      status: 403,
      message: "You do not have permission to view task analytics",
    };
  }

  const analyticsDateRange = getAnalyticsDateRange(
    dateRange,
    customFrom,
    customTo,
  );

  if (analyticsDateRange?.type === "invalid") {
    return {
      success: false,
      status: 400,
      message: analyticsDateRange.message,
    };
  }

  const whereConditions = [];
  const params = [];

  applyAnalyticsUserScope(
    whereConditions,
    params,
    userId,
    baseRole,
    employeeId,
  );

  if (taskType) {
    params.push(taskType);
    whereConditions.push(
      `(t.task_type::text = $${params.length} OR EXISTS (SELECT 1 FROM common_master cm_tt WHERE cm_tt.id = t.task_type AND LOWER(cm_tt.name) = LOWER($${params.length})))`,
    );
  }

  if (status === "completed") {
    whereConditions.push(`
      t.end_time IS NOT NULL
    `);
  } else if (status === "in-progress") {
    whereConditions.push(`
      t.start_time IS NOT NULL
      AND t.end_time IS NULL
      AND t.due_date >= CURRENT_DATE
    `);
  } else if (status === "pending") {
    whereConditions.push(`
      t.start_time IS NULL
      AND t.end_time IS NULL
      AND t.due_date >= CURRENT_DATE
    `);
  } else if (status === "overdue") {
    whereConditions.push(`
      t.end_time IS NULL
      AND t.due_date < CURRENT_DATE
    `);
  }

  const dateColumn =
    status === "overdue" ? "t.due_date" : "t.task_date";

  applyAnalyticsDateFilter(
    whereConditions,
    params,
    analyticsDateRange,
    dateColumn,
  );

  const whereClause =
    whereConditions.length > 0
      ? `WHERE ${whereConditions.join(" AND ")}`
      : "";

  const result = await pool.query(
    `
      SELECT
        COUNT(*)::int AS total_tasks,

        COUNT(*) FILTER (
          WHERE t.end_time IS NOT NULL
        )::int AS completed_tasks,

        COUNT(*) FILTER (
          WHERE t.start_time IS NOT NULL
          AND t.end_time IS NULL
          AND t.due_date >= CURRENT_DATE
        )::int AS in_progress_tasks,

        COUNT(*) FILTER (
          WHERE t.start_time IS NULL
          AND t.end_time IS NULL
          AND t.due_date >= CURRENT_DATE
        )::int AS pending_tasks,

        COUNT(*) FILTER (
          WHERE t.end_time IS NULL
          AND t.due_date < CURRENT_DATE
        )::int AS overdue_tasks

      FROM tasks t
      ${whereClause}
    `,
    params,
  );

  const data = result.rows[0];

  const totalTasks = Number(data.total_tasks || 0);
  const completedTasks = Number(data.completed_tasks || 0);

  const completionPercentage =
    totalTasks > 0
      ? Number(((completedTasks / totalTasks) * 100).toFixed(2))
      : 0;

  return {
    success: true,
    status: 200,
    analytics: {
      totalTasks,
      completedTasks,
      inProgressTasks: Number(data.in_progress_tasks || 0),
      pendingTasks: Number(data.pending_tasks || 0),
      overdueTasks: Number(data.overdue_tasks || 0),
      completionPercentage,
    },
  };
};

const getTaskAnalyticsOverview = async (
  userId,
  role,
  baseRole,
  dateRange,
  employeeId,
  taskType,
  status,
  customFrom,
  customTo,
) => {
  const analyticsDateRange = getAnalyticsDateRange(
    dateRange,
    customFrom,
    customTo,
  );

  if (analyticsDateRange?.type === "invalid") {
    return {
      success: false,
      status: 400,
      message: analyticsDateRange.message,
    };
  }

  const [
    overviewResult,
    statusResult,
    typeResult,
    trendResult,
    employeePerformanceResult,
    taskAgingResult,
    upcomingDeadlinesResult,
    atRiskTasksResult,
    resolutionTimeResult,
    employeeInsightsResult,
  ] = await Promise.all([
    getTaskOverviewData(
      userId,
      role,
      baseRole,
      dateRange,
      employeeId,
      taskType,
      status,
      customFrom,
      customTo,
    ),

    getTaskStatusAnalytics(
      userId,
      role,
      baseRole,
      dateRange,
      employeeId,
      taskType,
      status,
      customFrom,
      customTo,
    ),

    getTaskTypeAnalytics(
      userId,
      role,
      baseRole,
      dateRange,
      employeeId,
      taskType,
      status,
      customFrom,
      customTo,
    ),

    getTaskTrendAnalytics(
      userId,
      role,
      baseRole,
      dateRange,
      employeeId,
      taskType,
      status,
      customFrom,
      customTo,
    ),

    getEmployeePerformanceAnalytics(
      userId,
      role,
      baseRole,
      dateRange,
      employeeId,
      taskType,
      status,
      customFrom,
      customTo,
    ),

    getTaskAgingAnalytics(
      userId,
      role,
      baseRole,
      dateRange,
      employeeId,
      taskType,
      status,
      customFrom,
      customTo,
    ),

    getUpcomingDeadlinesAnalytics(
      userId,
      role,
      baseRole,
      dateRange,
      employeeId,
      taskType,
      status,
      customFrom,
      customTo,
    ),

    getAtRiskTasksAnalytics(
      userId,
      role,
      baseRole,
      dateRange,
      employeeId,
      taskType,
      status,
      customFrom,
      customTo,
    ),

    getTaskResolutionTimeAnalytics(
      userId,
      role,
      baseRole,
      dateRange,
      employeeId,
      taskType,
      status,
      customFrom,
      customTo,
    ),

    getEmployeeInsightsAnalytics(
      userId,
      role,
      baseRole,
      dateRange,
      employeeId,
      taskType,
      status,
      customFrom,
      customTo,
    ),
  ]);

  if (!overviewResult.success) {
    return overviewResult;
  }

  if (!statusResult.success) {
    return statusResult;
  }

  if (!typeResult.success) {
    return typeResult;
  }

  if (!trendResult.success) {
    return trendResult;
  }

  if (!employeePerformanceResult.success) {
    return employeePerformanceResult;
  }

  if (!taskAgingResult.success) {
    return taskAgingResult;
  }

  if (!upcomingDeadlinesResult.success) {
    return upcomingDeadlinesResult;
  }

  if (!atRiskTasksResult.success) {
    return atRiskTasksResult;
  }

  if (!resolutionTimeResult.success) {
    return resolutionTimeResult;
  }

  if (!employeeInsightsResult.success) {
    return employeeInsightsResult;
  }

  return {
    success: true,
    status: 200,
    data: {
      overview: overviewResult.analytics,
      taskStatus: statusResult.data,
      taskTypes: typeResult.data,
      taskTrend: trendResult.data,
      employeePerformance: employeePerformanceResult.data,
      taskAging: taskAgingResult.data,
      upcomingDeadlines: upcomingDeadlinesResult.data,
      atRiskTasks: atRiskTasksResult.data,
      resolutionTime: resolutionTimeResult.data,
      employeeInsights: employeeInsightsResult.data,
    },
  };
};

const getTaskStatusAnalytics = async (
  userId,
  role,
  baseRole,
  dateRange,
  employeeId,
  taskType,
  status,
  customFrom,
  customTo,
) => {
  const whereConditions = [];
  const params = [];

  if (!["general_admin", "admin", "employee"].includes(baseRole)) {
    return {
      success: false,
      status: 403,
      message: "You do not have permission to view task analytics",
    };
  }

  applyAnalyticsUserScope(
    whereConditions,
    params,
    userId,
    baseRole,
    employeeId,
  );

  if (taskType) {
    params.push(taskType);
    whereConditions.push(
      `(t.task_type::text = $${params.length} OR EXISTS (SELECT 1 FROM common_master cm_tt WHERE cm_tt.id = t.task_type AND LOWER(cm_tt.name) = LOWER($${params.length})))`,
    );
  }

  const analyticsDateRange = getAnalyticsDateRange(
    dateRange,
    customFrom,
    customTo,
  );

  if (analyticsDateRange?.type === "invalid") {
    return {
      success: false,
      status: 400,
      message: analyticsDateRange.message,
    };
  }

  applyAnalyticsDateFilter(
    whereConditions,
    params,
    analyticsDateRange,
    "t.task_date",
  );

  if (status === "completed") {
    whereConditions.push(`
      t.end_time IS NOT NULL
    `);
  } else if (status === "in-progress") {
    whereConditions.push(`
      t.start_time IS NOT NULL
      AND t.end_time IS NULL
      AND t.due_date >= CURRENT_DATE
    `);
  } else if (status === "pending") {
    whereConditions.push(`
      t.start_time IS NULL
      AND t.end_time IS NULL
      AND t.due_date >= CURRENT_DATE
    `);
  } else if (status === "overdue") {
    whereConditions.push(`
      t.end_time IS NULL
      AND t.due_date < CURRENT_DATE
    `);
  }

  const whereClause =
    whereConditions.length > 0
      ? `WHERE ${whereConditions.join(" AND ")}`
      : "";

  const result = await pool.query(
    `
      SELECT
        COUNT(*) FILTER (
          WHERE t.end_time IS NOT NULL
        )::int AS completed,

        COUNT(*) FILTER (
          WHERE t.start_time IS NOT NULL
          AND t.end_time IS NULL
          AND t.due_date >= CURRENT_DATE
        )::int AS in_progress,

        COUNT(*) FILTER (
          WHERE t.start_time IS NULL
          AND t.end_time IS NULL
          AND t.due_date >= CURRENT_DATE
        )::int AS pending,

        COUNT(*) FILTER (
          WHERE t.end_time IS NULL
          AND t.due_date < CURRENT_DATE
        )::int AS overdue

      FROM tasks t
      ${whereClause}
    `,
    params,
  );

  const data = result.rows[0];

  return {
    success: true,
    status: 200,
    data: [
      {
        status: "Completed",
        count: Number(data.completed),
      },
      {
        status: "In Progress",
        count: Number(data.in_progress),
      },
      {
        status: "Pending",
        count: Number(data.pending),
      },
      {
        status: "Overdue",
        count: Number(data.overdue),
      },
    ],
  };
};

const getTaskTypeAnalytics = async (
  userId,
  role,
  baseRole,
  dateRange,
  employeeId,
  taskType,
  status,
  customFrom,
  customTo,
) => {
  const whereConditions = [];
  const params = [];

  if (!["general_admin", "admin", "employee"].includes(baseRole)) {
    return {
      success: false,
      status: 403,
      message: "You do not have permission to view task analytics",
    };
  }

  applyAnalyticsUserScope(
    whereConditions,
    params,
    userId,
    baseRole,
    employeeId,
  );

  if (taskType) {
    params.push(taskType);
    whereConditions.push(
      `(t.task_type::text = $${params.length} OR EXISTS (SELECT 1 FROM common_master cm_tt WHERE cm_tt.id = t.task_type AND LOWER(cm_tt.name) = LOWER($${params.length})))`,
    );
  }

  if (status === "completed") {
    whereConditions.push(`t.end_time IS NOT NULL`);
  } else if (status === "in-progress") {
    whereConditions.push(`
      t.start_time IS NOT NULL
      AND t.end_time IS NULL
      AND t.due_date >= CURRENT_DATE
    `);
  } else if (status === "pending") {
    whereConditions.push(`
      t.start_time IS NULL
      AND t.end_time IS NULL
      AND t.due_date >= CURRENT_DATE
    `);
  } else if (status === "overdue") {
    whereConditions.push(`
      t.end_time IS NULL
      AND t.due_date < CURRENT_DATE
    `);
  }

  const analyticsDateRange = getAnalyticsDateRange(
    dateRange,
    customFrom,
    customTo,
  );

  if (analyticsDateRange?.type === "invalid") {
    return {
      success: false,
      status: 400,
      message: analyticsDateRange.message,
    };
  }

  applyAnalyticsDateFilter(
    whereConditions,
    params,
    analyticsDateRange,
    "t.task_date",
  );

  const whereClause =
    whereConditions.length > 0
      ? `WHERE ${whereConditions.join(" AND ")}`
      : "";

  const result = await pool.query(
    `
      SELECT
        LOWER(COALESCE(cm_tt.name, t.task_type::text)) AS task_type,
        COUNT(*)::int AS count
      FROM tasks t
      LEFT JOIN common_master cm_tt ON cm_tt.id = t.task_type
      ${whereClause}
      GROUP BY LOWER(COALESCE(cm_tt.name, t.task_type::text))
      ORDER BY
        CASE LOWER(COALESCE(cm_tt.name, t.task_type::text))
          WHEN 'basic' THEN 1
          WHEN 'normal' THEN 2
          WHEN 'hard' THEN 3
          ELSE 4
        END
    `,
    params,
  );

  return {
    success: true,
    status: 200,
    data: result.rows.map((row) => ({
      taskType:
        row.task_type.charAt(0).toUpperCase() +
        row.task_type.slice(1),
      count: Number(row.count),
    })),
  };
};

const getTaskTrendAnalytics = async (
  userId,
  role,
  baseRole,
  dateRange,
  employeeId,
  taskType,
  status,
  customFrom,
  customTo,
) => {
  const whereConditions = [];
  const params = [];

  if (!["general_admin", "admin", "employee"].includes(baseRole)) {
    return {
      success: false,
      status: 403,
      message: "You do not have permission to view task analytics",
    };
  }

  applyAnalyticsUserScope(
    whereConditions,
    params,
    userId,
    baseRole,
    employeeId,
  );

  if (taskType) {
    params.push(taskType);
    whereConditions.push(
      `(t.task_type::text = $${params.length} OR EXISTS (SELECT 1 FROM common_master cm_tt WHERE cm_tt.id = t.task_type AND LOWER(cm_tt.name) = LOWER($${params.length})))`,
    );
  }

  if (status === "completed") {
    whereConditions.push(`
      t.end_time IS NOT NULL
    `);
  } else if (status === "in-progress") {
    whereConditions.push(`
      t.start_time IS NOT NULL
      AND t.end_time IS NULL
      AND t.due_date >= CURRENT_DATE
    `);
  } else if (status === "pending") {
    whereConditions.push(`
      t.start_time IS NULL
      AND t.end_time IS NULL
      AND t.due_date >= CURRENT_DATE
    `);
  } else if (status === "overdue") {
    whereConditions.push(`
      t.end_time IS NULL
      AND t.due_date < CURRENT_DATE
    `);
  }

  const analyticsDateRange = getAnalyticsDateRange(
    dateRange,
    customFrom,
    customTo,
  );

  if (analyticsDateRange?.type === "invalid") {
    return {
      success: false,
      status: 400,
      message: analyticsDateRange.message,
    };
  }

  let dateStartExpression;
  let dateEndExpression;

  if (analyticsDateRange?.type === "custom") {
    params.push(analyticsDateRange.from);
    const fromParam = `$${params.length}`;

    params.push(analyticsDateRange.to);
    const toParam = `$${params.length}`;

    dateStartExpression = `${fromParam}::date`;
    dateEndExpression = `${toParam}::date`;
  } else {
    const days =
      analyticsDateRange?.type === "preset"
        ? analyticsDateRange.days
        : 7;

    params.push(days);

    const daysParam = `$${params.length}`;

    dateStartExpression =
      `CURRENT_DATE - (${daysParam} - 1) * INTERVAL '1 day'`;

    dateEndExpression = `CURRENT_DATE`;
  }

  const taskWhereClause =
    whereConditions.length > 0
      ? `WHERE ${whereConditions.join(" AND ")}`
      : "";

  const result = await pool.query(
    `
      WITH date_range AS (
        SELECT generate_series(
          ${dateStartExpression},
          ${dateEndExpression},
          INTERVAL '1 day'
        )::date AS trend_date
      ),

      created_tasks AS (
        SELECT
          td.created_at::date AS trend_date,
          COUNT(DISTINCT td.task_id)::int AS created
        FROM task_details td
        JOIN tasks t
          ON t.id = td.task_id
        ${taskWhereClause}
        ${
          taskWhereClause
            ? `AND td.created_at::date >= ${dateStartExpression}
               AND td.created_at::date <= ${dateEndExpression}`
            : `WHERE td.created_at::date >= ${dateStartExpression}
               AND td.created_at::date <= ${dateEndExpression}`
        }
        GROUP BY td.created_at::date
      ),

      completed_tasks AS (
        SELECT
          t.end_time::date AS trend_date,
          COUNT(*)::int AS completed
        FROM tasks t
        ${taskWhereClause}
        ${
          taskWhereClause
            ? `AND t.end_time IS NOT NULL
               AND t.end_time::date >= ${dateStartExpression}
               AND t.end_time::date <= ${dateEndExpression}`
            : `WHERE t.end_time IS NOT NULL
               AND t.end_time::date >= ${dateStartExpression}
               AND t.end_time::date <= ${dateEndExpression}`
        }
        GROUP BY t.end_time::date
      ),

      overdue_tasks AS (
        SELECT
          t.due_date AS trend_date,
          COUNT(*)::int AS overdue
        FROM tasks t
        ${taskWhereClause}
        ${
          taskWhereClause
            ? `AND t.due_date < CURRENT_DATE
               AND t.end_time IS NULL
               AND t.due_date >= ${dateStartExpression}
               AND t.due_date <= ${dateEndExpression}`
            : `WHERE t.due_date < CURRENT_DATE
               AND t.end_time IS NULL
               AND t.due_date >= ${dateStartExpression}
               AND t.due_date <= ${dateEndExpression}`
        }
        GROUP BY t.due_date
      )

      SELECT
        TO_CHAR(dr.trend_date, 'Mon DD') AS date,
        COALESCE(ct.created, 0) AS created,
        COALESCE(comp.completed, 0) AS completed,
        COALESCE(ot.overdue, 0) AS overdue
      FROM date_range dr
      LEFT JOIN created_tasks ct
        ON ct.trend_date = dr.trend_date
      LEFT JOIN completed_tasks comp
        ON comp.trend_date = dr.trend_date
      LEFT JOIN overdue_tasks ot
        ON ot.trend_date = dr.trend_date
      ORDER BY dr.trend_date
    `,
    params,
  );

  return {
    success: true,
    status: 200,
    data: result.rows.map((row) => ({
      date: row.date,
      created: Number(row.created),
      completed: Number(row.completed),
      overdue: Number(row.overdue),
    })),
  };
};

const getEmployeePerformanceAnalytics = async (
  userId,
  role,
  baseRole,
  dateRange,
  employeeId,
  taskType,
  status,
  customFrom,
  customTo,
) => {
  if (!["general_admin", "admin", "employee"].includes(baseRole)) {
    return {
      success: false,
      status: 403,
      message: "You do not have permission to view task analytics",
    };
  }

  const analyticsDateRange = getAnalyticsDateRange(
    dateRange,
    customFrom,
    customTo,
  );

  if (analyticsDateRange?.type === "invalid") {
    return {
      success: false,
      status: 400,
      message: analyticsDateRange.message,
    };
  }

  const params = [];
  const whereConditions = [];

  if (baseRole === "general_admin") {
    if (employeeId) {
      params.push(employeeId);
      whereConditions.push(
        `t.assigned_to = $${params.length}`,
      );
    }
  } else if (baseRole === "admin") {
    params.push(userId);
    whereConditions.push(
      `t.assigned_by = $${params.length}`,
    );

    if (employeeId) {
      params.push(employeeId);
      whereConditions.push(
        `t.assigned_to = $${params.length}`,
      );
    }
  } else if (baseRole === "employee") {
    params.push(userId);
    whereConditions.push(
      `t.assigned_to = $${params.length}`,
    );
  }

  if (taskType) {
    params.push(taskType);
    whereConditions.push(
      `(t.task_type::text = $${params.length} OR EXISTS (SELECT 1 FROM common_master cm_tt WHERE cm_tt.id = t.task_type AND LOWER(cm_tt.name) = LOWER($${params.length})))`,
    );
  }

  if (status === "completed") {
    whereConditions.push(`
      t.end_time IS NOT NULL
    `);
  } else if (status === "in-progress") {
    whereConditions.push(`
      t.start_time IS NOT NULL
      AND t.end_time IS NULL
      AND t.due_date >= CURRENT_DATE
    `);
  } else if (status === "pending") {
    whereConditions.push(`
      t.start_time IS NULL
      AND t.end_time IS NULL
      AND t.due_date >= CURRENT_DATE
    `);
  } else if (status === "overdue") {
    whereConditions.push(`
      t.end_time IS NULL
      AND t.due_date < CURRENT_DATE
    `);
  }

  applyAnalyticsDateFilter(
    whereConditions,
    params,
    analyticsDateRange,
    "t.task_date",
  );

  const whereClause =
    whereConditions.length > 0
      ? `AND ${whereConditions.join(" AND ")}`
      : "";

  const result = await pool.query(
    `
      SELECT
        u.id AS employee_id,
        u.name AS employee_name,

        COUNT(t.id)::int AS total_tasks,

        COUNT(t.id) FILTER (
          WHERE t.end_time IS NOT NULL
        )::int AS completed_tasks,

        COUNT(t.id) FILTER (
          WHERE t.start_time IS NOT NULL
          AND t.end_time IS NULL
          AND t.due_date >= CURRENT_DATE
        )::int AS in_progress_tasks,

        COUNT(t.id) FILTER (
          WHERE t.start_time IS NULL
          AND t.end_time IS NULL
          AND t.due_date >= CURRENT_DATE
        )::int AS pending_tasks,

        COUNT(t.id) FILTER (
          WHERE t.end_time IS NULL
          AND t.due_date < CURRENT_DATE
        )::int AS overdue_tasks

      FROM users u

      LEFT JOIN tasks t
        ON t.assigned_to = u.id

      WHERE u.role = 'employee'
        AND u.is_active = true

      ${whereClause}

      GROUP BY u.id, u.name

      ORDER BY u.name ASC
    `,
    params,
  );

  return {
    success: true,
    status: 200,
    data: result.rows.map((row) => ({
      employeeId: row.employee_id,
      employeeName: row.employee_name,
      totalTasks: Number(row.total_tasks || 0),
      completedTasks: Number(row.completed_tasks || 0),
      inProgressTasks: Number(
        row.in_progress_tasks || 0,
      ),
      pendingTasks: Number(row.pending_tasks || 0),
      overdueTasks: Number(row.overdue_tasks || 0),
    })),
  };
};

const getOverdueTasksAnalytics = async (
    role,
    baseRole,
    userId,
    filters = {}
) => {
    const {
        page = 1,
        limit = 5,
        search,
        startDate,
        endDate,
        employeeId,
        type,
        status,
    } = filters;

    let conditions = [
        `t.due_date < CURRENT_DATE`,
        `t.end_time IS NULL`,
    ];

    let values = [];
    let paramIndex = 1;

    if (startDate) {
        conditions.push(`t.task_date >= $${paramIndex}`);
        values.push(startDate);
        paramIndex++;
    }

    if (endDate) {
        conditions.push(`t.task_date <= $${paramIndex}`);
        values.push(endDate);
        paramIndex++;
    }

    if (type) {
        conditions.push(
            `(t.task_type::text = $${paramIndex} OR EXISTS (SELECT 1 FROM common_master cm_tt WHERE cm_tt.id = t.task_type AND LOWER(cm_tt.name) = LOWER($${paramIndex})))`
        );
        values.push(type);
        paramIndex++;
    }

    if (status) {
        conditions.push(
            `LOWER(t.status) = LOWER($${paramIndex})`
        );
        values.push(status);
        paramIndex++;
    }

    if (search) {
        conditions.push(`
            (
                LOWER(t.task_name) LIKE LOWER($${paramIndex})
                OR LOWER(u.name) LIKE LOWER($${paramIndex})
            )
        `);
        values.push(`%${search}%`);
        paramIndex++;
    }

    if (baseRole === "employee") {
        conditions.push(`
            EXISTS (
                SELECT 1
                FROM task_assignments ta_employee
                WHERE ta_employee.task_id = t.id
                  AND ta_employee.assigned_to = $${paramIndex}
            )
        `);

        values.push(userId);
        paramIndex++;
    } else if (employeeId) {
        conditions.push(`
            EXISTS (
                SELECT 1
                FROM task_assignments ta_employee
                WHERE ta_employee.task_id = t.id
                  AND ta_employee.assigned_to = $${paramIndex}
            )
        `);

        values.push(employeeId);
        paramIndex++;
    }

    const whereClause = conditions.join(" AND ");

    const countQuery = `
        SELECT COUNT(DISTINCT t.id) AS total
        FROM tasks t

        INNER JOIN task_assignments ta
            ON ta.task_id = t.id

        INNER JOIN users u
            ON u.id = ta.assigned_to

        WHERE ${whereClause}
    `;

    const countResult = await pool.query(countQuery, values);

    const totalRecords = Number(countResult.rows[0]?.total || 0);

    const safePage = Math.max(Number(page) || 1, 1);
    const safeLimit = [5, 10, 15, 20].includes(Number(limit))
        ? Number(limit)
        : 5;

    const offset = (safePage - 1) * safeLimit;

    const dataValues = [...values];

    const limitParam = dataValues.length + 1;
    const offsetParam = dataValues.length + 2;

    dataValues.push(safeLimit);
    dataValues.push(offset);

    const query = `
        SELECT DISTINCT
            t.id,
            t.task_name,
            t.task_date,
            t.due_date,
            COALESCE(cm_tt.name, t.task_type::text) AS task_type,
            t.start_time,
            t.end_time,
            t.status,
            u.id AS employee_id,
            u.name AS employee_name,
            CURRENT_DATE - t.due_date::date AS days_overdue
        FROM tasks t

        LEFT JOIN common_master cm_tt
            ON cm_tt.id = t.task_type

        INNER JOIN task_assignments ta
            ON ta.task_id = t.id

        INNER JOIN users u
            ON u.id = ta.assigned_to

        WHERE ${whereClause}

        ORDER BY t.due_date ASC

        LIMIT $${limitParam}
        OFFSET $${offsetParam}
    `;

    const result = await pool.query(query, dataValues);

    return {
        rows: result.rows.map((row) => ({
            taskId: row.id,
            taskName: row.task_name,
            employeeId: row.employee_id,
            employeeName: row.employee_name,
            taskDate: row.task_date,
            dueDate: row.due_date,
            taskType: row.task_type,
            startingAt: row.start_time,
            endingAt: row.end_time,
            taskStatus: row.status,
            daysOverdue: Number(row.days_overdue || 0),
        })),
        pagination: {
            page: safePage,
            limit: safeLimit,
            totalRecords,
            totalPages: Math.ceil(totalRecords / safeLimit),
        },
    };
};

const getTaskAgingAnalytics = async (
  userId,
  role,
  baseRole,
  dateRange,
  employeeId,
  taskType,
  status,
  customFrom,
  customTo,
) => {
  if (!["general_admin", "admin", "employee"].includes(baseRole)) {
    return {
      success: false,
      status: 403,
      message: "You do not have permission to view task analytics",
    };
  }

  const analyticsDateRange = getAnalyticsDateRange(
    dateRange,
    customFrom,
    customTo,
  );

  if (analyticsDateRange?.type === "invalid") {
    return {
      success: false,
      status: 400,
      message: analyticsDateRange.message,
    };
  }

  const whereConditions = [];
  const params = [];

  applyAnalyticsUserScope(
    whereConditions,
    params,
    userId,
    baseRole,
    employeeId,
  );

  if (taskType) {
    params.push(taskType);
    whereConditions.push(
      `(t.task_type::text = $${params.length} OR EXISTS (SELECT 1 FROM common_master cm_tt WHERE cm_tt.id = t.task_type AND LOWER(cm_tt.name) = LOWER($${params.length})))`,
    );
  }

  if (status === "completed") {
    whereConditions.push(`t.end_time IS NOT NULL`);
  } else if (status === "in-progress") {
    whereConditions.push(`
      t.start_time IS NOT NULL
      AND t.end_time IS NULL
      AND t.due_date >= CURRENT_DATE
    `);
  } else if (status === "pending") {
    whereConditions.push(`
      t.start_time IS NULL
      AND t.end_time IS NULL
      AND t.due_date >= CURRENT_DATE
    `);
  } else if (status === "overdue") {
    whereConditions.push(`
      t.end_time IS NULL
      AND t.due_date < CURRENT_DATE
    `);
  }

  applyAnalyticsDateFilter(
    whereConditions,
    params,
    analyticsDateRange,
    "t.task_date",
  );

  const whereClause =
    whereConditions.length > 0
      ? `WHERE ${whereConditions.join(" AND ")}`
      : "";

  const result = await pool.query(
    `
      SELECT
        CASE
          WHEN CURRENT_DATE - t.task_date <= 2
            THEN '0-2 days'
          WHEN CURRENT_DATE - t.task_date <= 7
            THEN '3-7 days'
          WHEN CURRENT_DATE - t.task_date <= 14
            THEN '8-14 days'
          WHEN CURRENT_DATE - t.task_date <= 30
            THEN '15-30 days'
          ELSE '30+ days'
        END AS age_range,
        COUNT(*)::int AS count

      FROM tasks t

      ${whereClause}

      GROUP BY
        CASE
          WHEN CURRENT_DATE - t.task_date <= 2
            THEN '0-2 days'
          WHEN CURRENT_DATE - t.task_date <= 7
            THEN '3-7 days'
          WHEN CURRENT_DATE - t.task_date <= 14
            THEN '8-14 days'
          WHEN CURRENT_DATE - t.task_date <= 30
            THEN '15-30 days'
          ELSE '30+ days'
        END

      ORDER BY
        MIN(t.task_date)
    `,
    params,
  );

  return {
    success: true,
    status: 200,
    data: result.rows.map((row) => ({
      range: row.age_range,
      count: Number(row.count),
    })),
  };
};

const getUpcomingDeadlinesAnalytics = async (
  userId,
  role,
  baseRole,
  dateRange,
  employeeId,
  taskType,
  status,
  customFrom,
  customTo,
) => {
  if (!["general_admin", "admin", "employee"].includes(baseRole)) {
    return {
      success: false,
      status: 403,
      message: "You do not have permission to view task analytics",
    };
  }

  const analyticsDateRange = getAnalyticsDateRange(
    dateRange,
    customFrom,
    customTo,
  );

  if (analyticsDateRange?.type === "invalid") {
    return {
      success: false,
      status: 400,
      message: analyticsDateRange.message,
    };
  }

  const whereConditions = [];
  const params = [];

  applyAnalyticsUserScope(
    whereConditions,
    params,
    userId,
    baseRole,
    employeeId,
  );

  whereConditions.push(`
    t.end_time IS NULL
    AND t.due_date >= CURRENT_DATE
    AND t.due_date <= CURRENT_DATE + INTERVAL '7 days'
  `);

  if (taskType) {
    params.push(taskType);
    whereConditions.push(
      `(t.task_type::text = $${params.length} OR EXISTS (SELECT 1 FROM common_master cm_tt WHERE cm_tt.id = t.task_type AND LOWER(cm_tt.name) = LOWER($${params.length})))`,
    );
  }

  applyAnalyticsDateFilter(
    whereConditions,
    params,
    analyticsDateRange,
    "t.task_date",
  );

  const whereClause =
    whereConditions.length > 0
      ? `WHERE ${whereConditions.join(" AND ")}`
      : "";

  const result = await pool.query(
    `
      SELECT
        t.id AS task_id,
        t.task_name,
        t.assigned_to AS employee_id,
        u.name AS employee_name,
        t.task_date,
        t.due_date,
        t.task_type,

        (t.due_date - CURRENT_DATE)::int AS days_remaining

      FROM tasks t

      JOIN users u
        ON u.id = t.assigned_to

      ${whereClause}

      ORDER BY t.due_date ASC
    `,
    params,
  );

  return {
    success: true,
    status: 200,
    data: result.rows.map((row) => ({
      taskId: row.task_id,
      taskName: row.task_name,
      employeeId: row.employee_id,
      employeeName: row.employee_name,
      taskDate: row.task_date,
      dueDate: row.due_date,
      taskType: row.task_type,
      daysRemaining: Number(row.days_remaining || 0),
    })),
  };
};

const getAtRiskTasksAnalytics = async (
  userId,
  role,
  baseRole,
  dateRange,
  employeeId,
  taskType,
  status,
  customFrom,
  customTo,
) => {
  if (!["general_admin", "admin", "employee"].includes(baseRole)) {
    return {
      success: false,
      status: 403,
      message: "You do not have permission to view task analytics",
    };
  }

  const analyticsDateRange = getAnalyticsDateRange(
    dateRange,
    customFrom,
    customTo,
  );

  if (analyticsDateRange?.type === "invalid") {
    return {
      success: false,
      status: 400,
      message: analyticsDateRange.message,
    };
  }

  const whereConditions = [];
  const params = [];

  applyAnalyticsUserScope(
    whereConditions,
    params,
    userId,
    baseRole,
    employeeId,
  );

  whereConditions.push(`
    t.end_time IS NULL
    AND (
      t.due_date < CURRENT_DATE
      OR (
        t.due_date >= CURRENT_DATE
        AND t.due_date <= CURRENT_DATE + INTERVAL '2 days'
        AND t.start_time IS NULL
      )
    )
  `);

  if (taskType) {
    params.push(taskType);
    whereConditions.push(
      `(t.task_type::text = $${params.length} OR EXISTS (SELECT 1 FROM common_master cm_tt WHERE cm_tt.id = t.task_type AND LOWER(cm_tt.name) = LOWER($${params.length})))`,
    );
  }

  applyAnalyticsDateFilter(
    whereConditions,
    params,
    analyticsDateRange,
    "t.task_date",
  );

  const whereClause =
    whereConditions.length > 0
      ? `WHERE ${whereConditions.join(" AND ")}`
      : "";

  const result = await pool.query(
    `
      SELECT
        t.id AS task_id,
        t.task_name,
        t.assigned_to AS employee_id,
        u.name AS employee_name,
        t.task_date,
        t.due_date,
        t.task_type,
        t.start_time,

        CASE
          WHEN t.due_date < CURRENT_DATE
            THEN 'Overdue'
          WHEN t.start_time IS NULL
            THEN 'Not Started'
          ELSE 'At Risk'
        END AS risk_status,

        CASE
          WHEN t.due_date < CURRENT_DATE
            THEN (CURRENT_DATE - t.due_date)::int
          ELSE (t.due_date - CURRENT_DATE)::int
        END AS risk_days

      FROM tasks t

      JOIN users u
        ON u.id = t.assigned_to

      ${whereClause}

      ORDER BY
        CASE
          WHEN t.due_date < CURRENT_DATE THEN 1
          ELSE 2
        END,
        t.due_date ASC
    `,
    params,
  );

  return {
    success: true,
    status: 200,
    data: result.rows.map((row) => ({
      taskId: row.task_id,
      taskName: row.task_name,
      employeeId: row.employee_id,
      employeeName: row.employee_name,
      taskDate: row.task_date,
      dueDate: row.due_date,
      taskType: row.task_type,
      startingAt: row.start_time,
      riskStatus: row.risk_status,
      riskDays: Number(row.risk_days || 0),
    })),
  };
};

const getTaskResolutionTimeAnalytics = async (
  userId,
  role,
  baseRole,
  dateRange,
  employeeId,
  taskType,
  status,
  customFrom,
  customTo,
) => {
  if (!["general_admin", "admin", "employee"].includes(baseRole)) {
    return {
      success: false,
      status: 403,
      message: "You do not have permission to view task analytics",
    };
  }

  const analyticsDateRange = getAnalyticsDateRange(
    dateRange,
    customFrom,
    customTo,
  );

  if (analyticsDateRange?.type === "invalid") {
    return {
      success: false,
      status: 400,
      message: analyticsDateRange.message,
    };
  }

  const whereConditions = [];
  const params = [];

  applyAnalyticsUserScope(
    whereConditions,
    params,
    userId,
    baseRole,
    employeeId,
  );

  whereConditions.push(`
    t.start_time IS NOT NULL
    AND t.end_time IS NOT NULL
  `);

  if (taskType) {
    params.push(taskType);
    whereConditions.push(
      `(t.task_type::text = $${params.length} OR EXISTS (SELECT 1 FROM common_master cm_tt WHERE cm_tt.id = t.task_type AND LOWER(cm_tt.name) = LOWER($${params.length})))`,
    );
  }

  applyAnalyticsDateFilter(
    whereConditions,
    params,
    analyticsDateRange,
    "t.task_date",
  );

  const whereClause =
    whereConditions.length > 0
      ? `WHERE ${whereConditions.join(" AND ")}`
      : "";

  const result = await pool.query(
    `
      SELECT
        COUNT(*)::int AS completed_tasks,

        ROUND(
          AVG(
            EXTRACT(
              EPOCH FROM (t.end_time - t.start_time)
            ) / 3600
          )::numeric,
          2
        ) AS average_resolution_hours,

        ROUND(
          MIN(
            EXTRACT(
              EPOCH FROM (t.end_time - t.start_time)
            ) / 3600
          )::numeric,
          2
        ) AS minimum_resolution_hours,

        ROUND(
          MAX(
            EXTRACT(
              EPOCH FROM (t.end_time - t.start_time)
            ) / 3600
          )::numeric,
          2
        ) AS maximum_resolution_hours

      FROM tasks t

      ${whereClause}
    `,
    params,
  );

  const data = result.rows[0];

  return {
    success: true,
    status: 200,
    data: {
      completedTasks: Number(data.completed_tasks || 0),
      averageResolutionHours: Number(
        data.average_resolution_hours || 0,
      ),
      minimumResolutionHours: Number(
        data.minimum_resolution_hours || 0,
      ),
      maximumResolutionHours: Number(
        data.maximum_resolution_hours || 0,
      ),
    },
  };
};

const getEmployeeInsightsAnalytics = async (
  userId,
  role,
  baseRole,
  dateRange,
  employeeId,
  taskType,
  status,
  customFrom,
  customTo,
) => {
  if (!["general_admin", "admin", "employee"].includes(baseRole)) {
    return {
      success: false,
      status: 403,
      message: "You do not have permission to view task analytics",
    };
  }

  const analyticsDateRange = getAnalyticsDateRange(
    dateRange,
    customFrom,
    customTo,
  );

  if (analyticsDateRange?.type === "invalid") {
    return {
      success: false,
      status: 400,
      message: analyticsDateRange.message,
    };
  }

  const params = [];
  let paramIndex = 1;

  let query = `
    SELECT
      t.assigned_to AS employee_id,
      COALESCE(u.name, 'Unknown') AS employee_name,

      COUNT(*)::int AS total_tasks,

      COUNT(*) FILTER (
        WHERE t.end_time IS NOT NULL
      )::int AS completed_tasks,

      COUNT(*) FILTER (
        WHERE t.start_time IS NOT NULL
          AND t.end_time IS NULL
          AND t.due_date >= CURRENT_DATE
      )::int AS in_progress_tasks,

      COUNT(*) FILTER (
        WHERE t.start_time IS NULL
          AND t.end_time IS NULL
          AND t.due_date >= CURRENT_DATE
      )::int AS pending_tasks,

      COUNT(*) FILTER (
        WHERE t.end_time IS NULL
          AND t.due_date < CURRENT_DATE
      )::int AS overdue_tasks,

      ROUND(
        (
          COUNT(*) FILTER (
            WHERE t.end_time IS NOT NULL
          )::numeric
          / NULLIF(COUNT(*), 0)
        ) * 100,
        2
      ) AS completion_rate,

      ROUND(
        AVG(
          CASE
            WHEN t.end_time IS NOT NULL
              AND td.created_at IS NOT NULL
            THEN EXTRACT(
              EPOCH FROM (t.end_time - td.created_at)
            ) / 86400
          END
        )::numeric,
        2
      ) AS average_resolution_days

    FROM tasks t

    LEFT JOIN users u
      ON u.id = t.assigned_to

    LEFT JOIN task_details td
      ON td.task_id = t.id

    WHERE 1 = 1
  `;

  if (baseRole === "general_admin") {
    if (employeeId) {
      query += ` AND t.assigned_to = $${paramIndex}`;
      params.push(employeeId);
      paramIndex++;
    }
  } else if (baseRole === "admin") {
    query += ` AND t.assigned_by = $${paramIndex}`;
    params.push(userId);
    paramIndex++;

    if (employeeId) {
      query += ` AND t.assigned_to = $${paramIndex}`;
      params.push(employeeId);
      paramIndex++;
    }
  } else if (baseRole === "employee") {
    query += ` AND t.assigned_to = $${paramIndex}`;
    params.push(userId);
    paramIndex++;
  }

  if (taskType) {
    query += ` AND (t.task_type::text = $${paramIndex} OR EXISTS (SELECT 1 FROM common_master cm_tt WHERE cm_tt.id = t.task_type AND LOWER(cm_tt.name) = LOWER($${paramIndex})))`;
    params.push(taskType);
    paramIndex++;
  }

  if (status === "completed") {
    query += `
      AND t.end_time IS NOT NULL
    `;
  } else if (status === "in-progress") {
    query += `
      AND t.start_time IS NOT NULL
      AND t.end_time IS NULL
      AND t.due_date >= CURRENT_DATE
    `;
  } else if (status === "pending") {
    query += `
      AND t.start_time IS NULL
      AND t.end_time IS NULL
      AND t.due_date >= CURRENT_DATE
    `;
  } else if (status === "overdue") {
    query += `
      AND t.end_time IS NULL
      AND t.due_date < CURRENT_DATE
    `;
  }

  if (analyticsDateRange?.type === "preset") {
    query += `
      AND t.task_date >= CURRENT_DATE
        - ($${paramIndex}::int - 1) * INTERVAL '1 day'
      AND t.task_date <= CURRENT_DATE
    `;

    params.push(analyticsDateRange.days);
    paramIndex++;
  }

  if (analyticsDateRange?.type === "custom") {
    query += `
      AND t.task_date >= $${paramIndex}::date
    `;

    params.push(analyticsDateRange.from);
    paramIndex++;

    query += `
      AND t.task_date <= $${paramIndex}::date
    `;

    params.push(analyticsDateRange.to);
    paramIndex++;
  }

  query += `
    GROUP BY t.assigned_to, u.name
    ORDER BY completed_tasks DESC, total_tasks DESC
  `;

  const result = await pool.query(query, params);

  return {
    success: true,
    status: 200,
    data: result.rows.map((row) => ({
      employeeId: row.employee_id,
      employeeName: row.employee_name,
      totalTasks: Number(row.total_tasks || 0),
      completedTasks: Number(row.completed_tasks || 0),
      inProgressTasks: Number(
        row.in_progress_tasks || 0,
      ),
      pendingTasks: Number(row.pending_tasks || 0),
      overdueTasks: Number(row.overdue_tasks || 0),
      completionRate: Number(
        row.completion_rate || 0,
      ),
      averageResolutionDays: Number(
        row.average_resolution_days || 0,
      ),
    })),
  };
};

const getTaskExplorer = async (
  userId,
  role,
  baseRole,
  page = 1,
  limit = 10,
  search = "",
  employeeId = "",
  taskType = "",
  status = "",
  dateRange = "",
  customFrom = "",
  customTo = "",
) => {
  const whereConditions = [];
  const params = [];

  if (baseRole === "general_admin") {
  } else if (baseRole === "admin") {
    params.push(userId);

    whereConditions.push(
      `t.assigned_by = $${params.length}`,
    );
  } else if (baseRole === "employee") {
    params.push(userId);

    whereConditions.push(
      `t.assigned_to = $${params.length}`,
    );
  } else {
    return {
      success: false,
      status: 403,
      message: "You do not have permission to view task explorer",
    };
  }

  if (employeeId && baseRole !== "employee") {
    params.push(employeeId);

    whereConditions.push(
      `t.assigned_to = $${params.length}`,
    );
  }

  if (taskType) {
    params.push(taskType);

    whereConditions.push(
      `(t.task_type::text = $${params.length} OR EXISTS (SELECT 1 FROM common_master cm_tt WHERE cm_tt.id = t.task_type AND LOWER(cm_tt.name) = LOWER($${params.length})))`,
    );
  }

  if (status) {
    if (status === "completed") {
      whereConditions.push(`
        t.end_time IS NOT NULL
      `);
    } else if (status === "in-progress") {
      whereConditions.push(`
        t.start_time IS NOT NULL
        AND t.end_time IS NULL
        AND t.due_date >= CURRENT_DATE
      `);
    } else if (status === "pending") {
      whereConditions.push(`
        t.start_time IS NULL
        AND t.end_time IS NULL
        AND t.due_date >= CURRENT_DATE
      `);
    } else if (status === "overdue") {
      whereConditions.push(`
        t.end_time IS NULL
        AND t.due_date < CURRENT_DATE
      `);
    }
  }

  const analyticsDateRange = getAnalyticsDateRange(
    dateRange,
    customFrom,
    customTo,
  );

  if (analyticsDateRange?.type === "invalid") {
    return {
      success: false,
      status: 400,
      message: analyticsDateRange.message,
    };
  }

  applyAnalyticsDateFilter(
    whereConditions,
    params,
    analyticsDateRange,
    "t.task_date",
  );

  if (search && search.trim()) {
    params.push(`%${search.trim()}%`);

    whereConditions.push(`
      (
        LOWER(t.task_name) LIKE LOWER($${params.length})
        OR LOWER(u.name) LIKE LOWER($${params.length})
      )
    `);
  }

  const whereClause =
    whereConditions.length > 0
      ? `WHERE ${whereConditions.join(" AND ")}`
      : "";

  const safePage = Math.max(Number(page) || 1, 1);

  const safeLimit = [5, 10, 15, 20].includes(
    Number(limit),
  )
    ? Number(limit)
    : 10;

  const offset = (safePage - 1) * safeLimit;

  const countResult = await pool.query(
    `
      SELECT COUNT(*)::int AS total_records

      FROM tasks t

      JOIN users u
        ON u.id = t.assigned_to

      ${whereClause}
    `,
    params,
  );

  const totalRecords = Number(
    countResult.rows[0].total_records,
  );

  const totalPages = Math.ceil(
    totalRecords / safeLimit,
  );

  const dataParams = [...params];

  dataParams.push(safeLimit);

  const limitParam =
    `$${dataParams.length}`;

  dataParams.push(offset);

  const offsetParam =
    `$${dataParams.length}`;

  const result = await pool.query(
    `
      SELECT
        t.id AS task_id,
        t.task_name,
        t.assigned_to AS employee_id,
        u.name AS employee_name,
        t.task_date,
        t.due_date,
        COALESCE(cm_tt.name, t.task_type::text) AS task_type,
        t.start_time,
        t.end_time,

        CASE
          WHEN t.end_time IS NOT NULL
            THEN 'Completed'

          WHEN t.due_date < CURRENT_DATE
            THEN 'Overdue'

          WHEN t.start_time IS NOT NULL
            THEN 'In Progress'

          ELSE 'Pending'
        END AS task_status,

        CASE
          WHEN t.end_time IS NULL
            AND t.due_date < CURRENT_DATE
          THEN (CURRENT_DATE - t.due_date)::int

          ELSE 0
        END AS days_overdue

      FROM tasks t

      LEFT JOIN common_master cm_tt
        ON cm_tt.id = t.task_type

      JOIN users u
        ON u.id = t.assigned_to

      ${whereClause}

      ORDER BY
        t.task_date DESC,
        t.id DESC

      LIMIT ${limitParam}
      OFFSET ${offsetParam}
    `,
    dataParams,
  );

  return {
    success: true,
    status: 200,
    data: result.rows.map((row) => ({
      taskId: row.task_id,
      taskName: row.task_name,
      employeeId: row.employee_id,
      employeeName: row.employee_name,
      taskDate: row.task_date,
      dueDate: row.due_date,
      taskType: row.task_type,
      startingAt: row.start_time,
      endingAt: row.end_time,
      taskStatus: row.task_status,
      daysOverdue: Number(
        row.days_overdue || 0,
      ),
    })),
    pagination: {
      page: safePage,
      limit: safeLimit,
      totalRecords,
      totalPages,
    },
  };
};

const exportTaskAnalytics = async (
  userId,
  role,
  baseRole,
  dateRange,
  employeeId,
  taskType,
  status,
  customFrom,
  customTo,
) => {
  let employeeName = "All Employees";

  if (baseRole === "employee") {
    const employeeResult = await pool.query(
      `
        SELECT name
        FROM users
        WHERE id = $1
          AND role = 'employee'
          AND is_active = true
      `,
      [userId],
    );

    if (employeeResult.rows.length === 0) {
      return {
        success: false,
        status: 403,
        message: "Employee account not found",
      };
    }

    employeeName = employeeResult.rows[0].name;

    employeeId = userId;
  }

  if (employeeId) {
    let employeeQuery = `
      SELECT id, name
      FROM users
      WHERE id = $1
        AND role = 'employee'
        AND is_active = true
    `;

    const queryParams = [employeeId];

    if (baseRole === "admin") {
      employeeQuery += ` AND admin_id = $2`;

      queryParams.push(userId);
    }

    const employeeResult = await pool.query(
      employeeQuery,
      queryParams,
    );

    if (employeeResult.rows.length === 0) {
      return {
        success: false,
        status: 403,
        message:
          "You are not authorized to export this employee's data",
      };
    }

    employeeName = employeeResult.rows[0].name;
  }

  const analyticsResult =
    await getTaskAnalyticsOverview(
      userId,
      role,
      baseRole,
      dateRange,
      employeeId,
      taskType,
      status,
      customFrom,
      customTo,
    );

  if (!analyticsResult.success) {
    return analyticsResult;
  }

  const data = analyticsResult.data;

  const whereConditions = [];
  const params = [];

  if (baseRole === "admin") {
    params.push(userId);

    whereConditions.push(
      `t.assigned_by = $${params.length}`,
    );
  }

  if (baseRole === "employee") {
    params.push(userId);

    whereConditions.push(
      `t.assigned_to = $${params.length}`,
    );
  } else if (employeeId) {
    params.push(employeeId);

    whereConditions.push(
      `t.assigned_to = $${params.length}`,
    );
  }

  if (taskType) {
    params.push(taskType);

    whereConditions.push(
      `(t.task_type::text = $${params.length} OR EXISTS (SELECT 1 FROM common_master cm_tt WHERE cm_tt.id = t.task_type AND LOWER(cm_tt.name) = LOWER($${params.length})))`,
    );
  }

  if (status === "completed") {
    whereConditions.push(`
      t.end_time IS NOT NULL
    `);
  } else if (status === "in-progress") {
    whereConditions.push(`
      t.start_time IS NOT NULL
      AND t.end_time IS NULL
      AND t.due_date >= CURRENT_DATE
    `);
  } else if (status === "pending") {
    whereConditions.push(`
      t.start_time IS NULL
      AND t.end_time IS NULL
      AND t.due_date >= CURRENT_DATE
    `);
  } else if (status === "overdue") {
    whereConditions.push(`
      t.end_time IS NULL
      AND t.due_date < CURRENT_DATE
    `);
  }

  const analyticsDateRange =
    getAnalyticsDateRange(
      dateRange,
      customFrom,
      customTo,
    );

  if (analyticsDateRange?.type === "invalid") {
    return {
      success: false,
      status: 400,
      message: analyticsDateRange.message,
    };
  }

  applyAnalyticsDateFilter(
    whereConditions,
    params,
    analyticsDateRange,
    status === "overdue"
      ? "t.due_date"
      : "t.task_date",
  );

  const whereClause =
    whereConditions.length > 0
      ? `WHERE ${whereConditions.join(" AND ")}`
      : "";

  const employeePerformanceParams = [];

  if (baseRole === "admin") {
    employeePerformanceParams.push(userId);
  } else if (baseRole === "employee") {
    employeePerformanceParams.push(userId);
  }

  if (baseRole !== "employee" && employeeId) {
    employeePerformanceParams.push(employeeId);
  }

  if (taskType) {
    employeePerformanceParams.push(taskType);
  }

  if (analyticsDateRange?.type === "preset") {
    employeePerformanceParams.push(
      analyticsDateRange.days,
    );
  }

  if (analyticsDateRange?.type === "custom") {
    employeePerformanceParams.push(
      analyticsDateRange.from,
    );

    employeePerformanceParams.push(
      analyticsDateRange.to,
    );
  }

  const employeeBaseParam =
    baseRole === "admin" || baseRole === "employee"
      ? 1
      : 0;

  const employeeFilterParam =
    baseRole === "admin" && employeeId
      ? 1
      : baseRole === "employee"
        ? 0
        : employeeId
          ? 1
          : 0;

  const employeeTaskTypeParam =
    taskType
      ? employeeBaseParam +
        employeeFilterParam +
        1
      : 0;

  const employeeDateParam =
    employeeBaseParam +
    employeeFilterParam +
    (taskType ? 1 : 0) +
    1;

  let employeeDateFilter = "";

  if (analyticsDateRange) {
    if (analyticsDateRange.type === "preset") {
      employeeDateFilter = `
        AND t.task_date >= CURRENT_DATE
          - ($${employeeDateParam}::int - 1)
            * INTERVAL '1 day'
        AND t.task_date <= CURRENT_DATE
      `;
    } else if (
      analyticsDateRange.type === "custom"
    ) {
      employeeDateFilter = `
        AND t.task_date >= $${employeeDateParam}::date
        AND t.task_date <= $${employeeDateParam + 1}::date
      `;
    }
  }

  let employeeAdminFilter = "";

  if (baseRole === "admin") {
    employeeAdminFilter =
      `AND t.assigned_by = $1`;
  }

  let employeeAssignedFilter = "";

  if (baseRole === "employee") {
    employeeAssignedFilter =
      `AND t.assigned_to = $1`;
  } else if (employeeId) {
    const employeeParam =
      baseRole === "admin"
        ? 2
        : 1;

    employeeAssignedFilter =
      `AND t.assigned_to = $${employeeParam}`;
  }

  let employeeTaskTypeFilter = "";

  if (taskType) {
    employeeTaskTypeFilter =
      `AND (t.task_type::text = $${employeeTaskTypeParam} OR EXISTS (SELECT 1 FROM common_master cm_tt WHERE cm_tt.id = t.task_type AND LOWER(cm_tt.name) = LOWER($${employeeTaskTypeParam})))`;
  }

  let employeeStatusFilter = "";

  if (status === "completed") {
    employeeStatusFilter = `
      AND t.end_time IS NOT NULL
    `;
  } else if (status === "in-progress") {
    employeeStatusFilter = `
      AND t.start_time IS NOT NULL
      AND t.end_time IS NULL
      AND t.due_date >= CURRENT_DATE
    `;
  } else if (status === "pending") {
    employeeStatusFilter = `
      AND t.start_time IS NULL
      AND t.end_time IS NULL
      AND t.due_date >= CURRENT_DATE
    `;
  } else if (status === "overdue") {
    employeeStatusFilter = `
      AND t.end_time IS NULL
      AND t.due_date < CURRENT_DATE
    `;
  }

  const employeePerformanceResult =
    await pool.query(
      `
        SELECT
          u.id AS employee_id,
          u.name AS employee_name,

          COUNT(t.id) FILTER (
            WHERE t.end_time IS NOT NULL
          )::int AS completed_tasks,

          COUNT(t.id) FILTER (
            WHERE t.start_time IS NULL
              AND t.end_time IS NULL
              AND t.due_date >= CURRENT_DATE
          )::int AS pending_tasks,

          COUNT(t.id) FILTER (
            WHERE t.start_time IS NOT NULL
              AND t.end_time IS NULL
              AND t.due_date >= CURRENT_DATE
          )::int AS in_progress_tasks,

          COUNT(t.id) FILTER (
            WHERE t.end_time IS NULL
              AND t.due_date < CURRENT_DATE
          )::int AS overdue_tasks

        FROM users u

        LEFT JOIN tasks t
          ON t.assigned_to = u.id

        ${employeeAdminFilter}

        ${employeeAssignedFilter}

        ${employeeTaskTypeFilter}

        ${employeeDateFilter}

        ${employeeStatusFilter}

        WHERE u.role = 'employee'
          AND u.is_active = true

        ${
          baseRole === "admin"
            ? `AND u.admin_id = $1`
            : ""
        }

        ${
          baseRole === "employee"
            ? `AND u.id = $1`
            : employeeId
              ? `AND u.id = ${
                  baseRole === "admin"
                    ? "$2"
                    : "$1"
                }`
              : ""
        }

        GROUP BY u.id, u.name

        ORDER BY u.name ASC
      `,
      employeePerformanceParams,
    );

  let overdueTasks = [];

  if (!status || status === "overdue") {
    const overdueConditions = [];
    const overdueParams = [];

    if (baseRole === "admin") {
      overdueParams.push(userId);

      overdueConditions.push(
        `t.assigned_by = $${overdueParams.length}`,
      );
    }

    if (baseRole === "employee") {
      overdueParams.push(userId);

      overdueConditions.push(
        `t.assigned_to = $${overdueParams.length}`,
      );
    } else if (employeeId) {
      overdueParams.push(employeeId);

      overdueConditions.push(
        `t.assigned_to = $${overdueParams.length}`,
      );
    }

    if (taskType) {
      overdueParams.push(taskType);

      overdueConditions.push(
        `(t.task_type::text = $${overdueParams.length} OR EXISTS (SELECT 1 FROM common_master cm_tt WHERE cm_tt.id = t.task_type AND LOWER(cm_tt.name) = LOWER($${overdueParams.length})))`,
      );
    }

    overdueConditions.push(`
      t.end_time IS NULL
      AND t.due_date < CURRENT_DATE
    `);

    if (analyticsDateRange?.type === "preset") {
      overdueParams.push(
        analyticsDateRange.days,
      );

      overdueConditions.push(`
        t.due_date >= CURRENT_DATE
          - ($${overdueParams.length} - 1)
            * INTERVAL '1 day'
        AND t.due_date <= CURRENT_DATE
      `);
    }

    if (
      analyticsDateRange?.type === "custom"
    ) {
      overdueParams.push(
        analyticsDateRange.from,
      );

      const fromParam =
        `$${overdueParams.length}`;

      overdueParams.push(
        analyticsDateRange.to,
      );

      const toParam =
        `$${overdueParams.length}`;

      overdueConditions.push(`
        t.due_date >= ${fromParam}::date
        AND t.due_date <= ${toParam}::date
      `);
    }

    const overdueWhereClause = `
      WHERE ${overdueConditions.join(" AND ")}
    `;

    const overdueResult =
      await pool.query(
        `
          SELECT
            t.id AS task_id,
            t.task_name,
            t.assigned_to AS employee_id,
            u.name AS employee_name,
            t.task_date,
            t.due_date,
            t.task_type,
            (CURRENT_DATE - t.due_date)::int
              AS days_overdue

          FROM tasks t

          JOIN users u
            ON u.id = t.assigned_to

          ${overdueWhereClause}

          ORDER BY t.due_date ASC
        `,
        overdueParams,
      );

    overdueTasks = overdueResult.rows;
  }

  const workbook =
    new ExcelJS.Workbook();

  workbook.creator =
    "Task Management System";

  workbook.created = new Date();

  workbook.modified = new Date();

  const worksheet =
    workbook.addWorksheet(
      "Task Analytics Report",
    );

  worksheet.views = [
    {
      state: "frozen",
      ySplit: 1,
    },
  ];

  const titleStyle = {
    font: {
      bold: true,
      size: 16,
      color: {
        argb: "FFFFFF",
      },
    },

    fill: {
      type: "pattern",
      pattern: "solid",
      fgColor: {
        argb: "263238",
      },
    },

    alignment: {
      vertical: "middle",
      horizontal: "center",
    },
  };

  const sectionStyle = {
    font: {
      bold: true,
      size: 12,
      color: {
        argb: "FFFFFF",
      },
    },

    fill: {
      type: "pattern",
      pattern: "solid",
      fgColor: {
        argb: "37474F",
      },
    },

    alignment: {
      vertical: "middle",
      horizontal: "left",
    },
  };

  const headerStyle = {
    font: {
      bold: true,
      color: {
        argb: "FFFFFF",
      },
    },

    fill: {
      type: "pattern",
      pattern: "solid",
      fgColor: {
        argb: "546E7A",
      },
    },

    alignment: {
      vertical: "middle",
      horizontal: "center",
    },

    border: {
      top: {
        style: "thin",
        color: {
          argb: "D9E0E5",
        },
      },

      bottom: {
        style: "thin",
        color: {
          argb: "D9E0E5",
        },
      },

      left: {
        style: "thin",
        color: {
          argb: "D9E0E5",
        },
      },

      right: {
        style: "thin",
        color: {
          argb: "D9E0E5",
        },
      },
    },
  };

  const applyRowBorders = (row) => {
    row.eachCell((cell) => {
      cell.border = {
        top: {
          style: "thin",
          color: {
            argb: "E1E6EA",
          },
        },

        bottom: {
          style: "thin",
          color: {
            argb: "E1E6EA",
          },
        },

        left: {
          style: "thin",
          color: {
            argb: "E1E6EA",
          },
        },

        right: {
          style: "thin",
          color: {
            argb: "E1E6EA",
          },
        },
      };

      cell.alignment = {
        vertical: "middle",
      };
    });
  };

  const addSectionTitle = (
    title,
  ) => {
    const row =
      worksheet.addRow([title]);

    worksheet.mergeCells(
      `A${row.number}:D${row.number}`,
    );

    row.getCell(1).style =
      sectionStyle;

    row.height = 22;

    return row.number;
  };

  const addHeader = (
    headers,
  ) => {
    const row =
      worksheet.addRow(headers);

    row.eachCell((cell) => {
      cell.style = headerStyle;
    });

    return row.number;
  };

  worksheet.mergeCells("A1:D1");

  worksheet.getCell("A1").value =
    "TASK ANALYTICS REPORT";

  worksheet.getCell("A1").style =
    titleStyle;

  worksheet.getRow(1).height = 30;

  addSectionTitle(
    "Applied Filters",
  );

  addHeader([
    "Filter",
    "Value",
  ]);

  worksheet.addRow([
    "Date Range",

    analyticsDateRange?.type ===
    "custom"
      ? `${customFrom} to ${customTo}`
      : analyticsDateRange?.type ===
          "preset"
        ? `Last ${analyticsDateRange.days} Days`
        : "All Dates",
  ]);

  worksheet.addRow([
    "Employee",
    employeeName,
  ]);

  worksheet.addRow([
    "Employee ID",
    employeeId || "—",
  ]);

  worksheet.addRow([
    "Task Type",
    taskType || "All",
  ]);

  worksheet.addRow([
    "Status",
    status || "All",
  ]);

  worksheet.addRow([
    "Generated At",
    new Date(),
  ]);

  worksheet.getCell(
    `B${worksheet.lastRow.number}`,
  ).numFmt =
    "dd-mmm-yyyy hh:mm AM/PM";

  worksheet.addRow([]);

  addSectionTitle(
    "Summary",
  );

  addHeader([
    "Metric",
    "Value",
  ]);

  worksheet.addRow([
    "Total Tasks",
    data.overview?.totalTasks || 0,
  ]);

  worksheet.addRow([
    "Completed",
    data.overview?.completedTasks || 0,
  ]);

  worksheet.addRow([
    "In Progress",
    data.overview?.inProgressTasks || 0,
  ]);

  worksheet.addRow([
    "Pending",
    data.overview?.pendingTasks || 0,
  ]);

  worksheet.addRow([
    "Overdue",
    data.overview?.overdueTasks || 0,
  ]);

  worksheet.addRow([
    "Completion Rate",
    `${data.overview?.completionPercentage || 0}%`,
  ]);

  worksheet.addRow([]);

  addSectionTitle(
    "Status Overview",
  );

  addHeader([
    "Status",
    "Count",
  ]);

  (
    data.taskStatus || []
  ).forEach((item) => {
    worksheet.addRow([
      item.status || "--",
      Number(item.count || 0),
    ]);
  });

  worksheet.addRow([]);

  addSectionTitle(
    "Employee Performance",
  );

  addHeader([
    "Employee",
    "Completed",
    "Pending",
    "In Progress",
    "Overdue",
  ]);

  employeePerformanceResult.rows.forEach(
    (employee) => {
      worksheet.addRow([
        employee.employee_name || "--",
        Number(
          employee.completed_tasks || 0,
        ),
        Number(
          employee.pending_tasks || 0,
        ),
        Number(
          employee.in_progress_tasks || 0,
        ),
        Number(
          employee.overdue_tasks || 0,
        ),
      ]);
    },
  );

  if (
    employeePerformanceResult.rows
      .length === 0
  ) {
    worksheet.addRow([
      "No employee data",
      0,
      0,
      0,
      0,
    ]);
  }

  worksheet.addRow([]);

  addSectionTitle(
    "Task Type Breakdown",
  );

  addHeader([
    "Task Type",
    "Count",
  ]);

  (
    data.taskTypes || []
  ).forEach((item) => {
    worksheet.addRow([
      item.taskType || "--",
      Number(item.count || 0),
    ]);
  });

  worksheet.addRow([]);

  addSectionTitle(
    "Task Trend",
  );

  addHeader([
    "Date",
    "Created",
    "Completed",
    "Overdue",
  ]);

  (
    data.taskTrend || []
  ).forEach((item) => {
    worksheet.addRow([
      item.date || "--",
      Number(item.created || 0),
      Number(item.completed || 0),
      Number(item.overdue || 0),
    ]);
  });

  worksheet.addRow([]);

  addSectionTitle(
    "Task Aging Analysis",
  );

  addHeader([
    "Age Range",
    "Count",
  ]);

  (
    data.taskAging || []
  ).forEach((item) => {
    worksheet.addRow([
      item.range || "--",
      Number(item.count || 0),
    ]);
  });

  worksheet.addRow([]);

  addSectionTitle(
    "Overdue Tasks",
  );

  addHeader([
    "Task",
    "Employee",
    "Task Date",
    "Due Date",
    "Task Type",
    "Days Overdue",
  ]);

  overdueTasks.forEach((task) => {
    worksheet.addRow([
      task.task_name || "--",
      task.employee_name || "--",
      task.task_date || "--",
      task.due_date || "--",
      task.task_type || "--",
      Number(
        task.days_overdue || 0,
      ),
    ]);
  });

  if (overdueTasks.length === 0) {
    worksheet.addRow([
      "No overdue tasks",
      "--",
      "--",
      "--",
      "--",
      0,
    ]);
  }

  worksheet.eachRow((row) => {
    if (row.number !== 1) {
      applyRowBorders(row);
    }
  });

  worksheet.getColumn(1).width = 28;
  worksheet.getColumn(2).width = 24;
  worksheet.getColumn(3).width = 18;
  worksheet.getColumn(4).width = 18;
  worksheet.getColumn(5).width = 18;
  worksheet.getColumn(6).width = 18;

  worksheet.eachRow((row) => {
    row.eachCell((cell) => {
      if (cell.value instanceof Date) {
        cell.numFmt =
          "dd-mmm-yyyy";
      }
    });
  });

  const buffer =
    await workbook.xlsx.writeBuffer();

  return {
    success: true,
    status: 200,
    data: buffer,
    employeeName,
  };
};

module.exports = {
  getTaskAnalyticsOverview,
  getTaskStatusAnalytics,
  getTaskTypeAnalytics,
  getTaskTrendAnalytics,
  getEmployeePerformanceAnalytics,
  getOverdueTasksAnalytics,
  getTaskAgingAnalytics,
  getUpcomingDeadlinesAnalytics,
  getAtRiskTasksAnalytics,
  getTaskResolutionTimeAnalytics,
  getEmployeeInsightsAnalytics,
  getTaskExplorer,
  exportTaskAnalytics,
};